import { Command } from 'commander'
import { appError, createOtaClient, check, error, success } from './client'
import { OtaApiError } from './http'
import { APP_ERROR_KINDS } from './types'
import type { AppErrorKind, AppErrorPayload, ErrorPayload, OtaCliConfig } from './types'
import { clearCachedSession, writeCachedSession } from './cli/cache'
import { loadCliConfig } from './cli/config'
import { resolveAuthToken, stripCredentials } from './cli/auth'
import { logError, logJson, logStep, logSuccess, logWarn } from './cli/logger'
import type {
  AdminAuthCommandOptions,
  MessageClearUniqueIdCommandOptions,
  MessageClearUserIdCommandOptions,
  MessageSendGlobalCommandOptions,
  MessageSendOtaNameCommandOptions,
  MessageSendUniqueIdCommandOptions,
  MessageSendUserIdCommandOptions,
  VersionCheckCommandOptions,
  VersionCreateCommandOptions,
  VersionAppErrorCommandOptions,
  VersionErrorCommandOptions,
  VersionSuccessCommandOptions,
  VersionUploadCommandOptions
} from './cli/options'
import { uploadVersion } from './cli/upload'
import { maskToken, parseJsonInput, resolveCliOptions, stringifyOutput, toOptionalNumber } from './cli/utils'
import {
  buildCreatePayload,
  invokeErrorHook,
  invokeSuccessHook,
  resolveUploadTarget
} from './cli/version'

function withGlobalOptions(command: Command) {
  return command
    .option('--base-url <url>', 'ota-api base url, e.g. http://127.0.0.1:3001')
    .option('--token <token>', 'bearer token for protected endpoints')
    .option('--auth-username <username>', 'admin username for auto login')
    .option('--auth-password <password>', 'admin password for auto login')
    .option('--timeout <ms>', 'request timeout in milliseconds')
    .option('--headers <json>', 'extra headers as JSON object')
}

async function withConfig<T>(handler: (config: OtaCliConfig) => Promise<T>) {
  logStep('loading CLI config')
  const config = await loadCliConfig()
  logSuccess('config resolved')
  return handler(config)
}

async function runLogged<T>(title: string, action: () => Promise<T>) {
  logStep(title)
  const result = await action()
  logSuccess(`${title} completed`)
  return result
}

async function withProtectedAuth<T>(
  options: ReturnType<typeof resolveCliOptions>,
  action: (token: string) => Promise<T>
) {
  let token = await resolveAuthToken(options)

  try {
    return await action(token)
  } catch (error) {
    if (isUnauthorizedError(error)) {
      logWarn('received 401/403, clearing local cached token')
      await clearCachedSession(options.baseURL)

      if (options.token) {
        throw error
      }

      logStep('retrying protected request with a fresh login')
      token = await resolveAuthToken({ ...options, token: undefined })
      return action(token)
    }

    throw error
  }
}

function isUnauthorizedError(error: unknown) {
  return error instanceof OtaApiError && (error.status === 401 || error.status === 403)
}

function parseAppErrorKind(kind: string): AppErrorKind {
  if (APP_ERROR_KINDS.includes(kind as AppErrorKind)) {
    return kind as AppErrorKind
  }

  throw new Error(`kind must be one of: ${APP_ERROR_KINDS.join(', ')}`)
}

function parseOptionalJsonData(value: string | undefined) {
  return value === undefined ? undefined : parseJsonInput(value, {})
}

async function run() {
  const program = new Command()

  program
    .name('ota-cli')
    .description('CLI and SDK for ota-api')
    .version('0.1.0')

  const admin = program.command('admin').description('admin APIs')
  withGlobalOptions(
    admin.command('create')
      .requiredOption('--username <username>', 'admin username')
      .requiredOption('--password <password>', 'admin password')
      .action(async (options: AdminAuthCommandOptions) => withConfig(async config => {
        const username = options.username
        const password = options.password
        const resolved = resolveCliOptions(options, config)
        const client = createOtaClient(resolved)
        const result = await runLogged('creating admin account', async () => {
          return client.admin.create({
            username,
            password
          })
        })
        logJson('admin created', result)
      }))
  )

  withGlobalOptions(
    admin.command('login')
      .requiredOption('--username <username>', 'admin username')
      .requiredOption('--password <password>', 'admin password')
      .action(async (options: AdminAuthCommandOptions) => withConfig(async config => {
        const username = options.username
        const password = options.password
        const resolved = resolveCliOptions(options, config)
        const client = createOtaClient(resolved)
        const token = await runLogged('logging in', async () => {
          return client.admin.login({
            username,
            password
          })
        })
        await writeCachedSession(resolved.baseURL, {
          username,
          token
        })
        logSuccess('token cached locally')
        logSuccess(`token received: ${maskToken(token)}`)
        console.log(token)
      }))
  )

  const message = program.command('message').description('message APIs')
  withGlobalOptions(
    message.command('send-global')
      .requiredOption('--type <type>', 'notification type')
      .option('--data <json>', 'notification payload as JSON string')
      .action(async (options: MessageSendGlobalCommandOptions) => withConfig(async config => {
        const type = options.type
        const resolved = resolveCliOptions(options, config)
        const client = createOtaClient(resolved)
        const result = await runLogged('sending global message', async () => {
          return client.message.sendGlobal({
            type,
            data: parseOptionalJsonData(options.data)
          })
        })
        logJson('message sent', result)
      }))
  )

  withGlobalOptions(
    message.command('send-ota-name')
      .requiredOption('--ota-name <otaName>', 'ota name')
      .option('--data <json>', 'notification payload as JSON string')
      .action(async (options: MessageSendOtaNameCommandOptions) => withConfig(async config => {
        const resolved = resolveCliOptions(options, config)
        const client = createOtaClient(resolved)
        const result = await runLogged('sending ota message', async () => {
          return client.message.sendOtaName({
            otaName: options.otaName,
            data: parseOptionalJsonData(options.data)
          })
        })
        logJson('message sent', result)
      }))
  )

  withGlobalOptions(
    message.command('send-user-id')
      .requiredOption('--user-id <userId>', 'user id')
      .option('--data <json>', 'notification payload as JSON string')
      .option('--resend', 'resend the cached message')
      .action(async (options: MessageSendUserIdCommandOptions) => withConfig(async config => {
        const resolved = resolveCliOptions(options, config)
        const client = createOtaClient(resolved)
        const result = await runLogged('sending user message', async () => {
          return client.message.sendUserId({
            userId: options.userId,
            data: parseOptionalJsonData(options.data),
            resend: options.resend
          })
        })
        logJson('message sent', result)
      }))
  )

  withGlobalOptions(
    message.command('send-unique-id')
      .requiredOption('--unique-id <uniqueId>', 'unique device id')
      .option('--data <json>', 'notification payload as JSON string')
      .option('--resend', 'resend the cached message')
      .action(async (options: MessageSendUniqueIdCommandOptions) => withConfig(async config => {
        const resolved = resolveCliOptions(options, config)
        const client = createOtaClient(resolved)
        const result = await runLogged('sending device message', async () => {
          return client.message.sendUniqueId({
            uniqueId: options.uniqueId,
            data: parseOptionalJsonData(options.data),
            resend: options.resend
          })
        })
        logJson('message sent', result)
      }))
  )

  withGlobalOptions(
    message.command('clear-user-id')
      .requiredOption('--user-id <userId>', 'user id')
      .action(async (options: MessageClearUserIdCommandOptions) => withConfig(async config => {
        const resolved = resolveCliOptions(options, config)
        const client = createOtaClient(resolved)
        const result = await runLogged('clearing user message', async () => {
          return client.message.clearUserId({
            userId: options.userId
          })
        })
        logJson('message cleared', result)
      }))
  )

  withGlobalOptions(
    message.command('clear-unique-id')
      .requiredOption('--unique-id <uniqueId>', 'unique device id')
      .action(async (options: MessageClearUniqueIdCommandOptions) => withConfig(async config => {
        const resolved = resolveCliOptions(options, config)
        const client = createOtaClient(resolved)
        const result = await runLogged('clearing device message', async () => {
          return client.message.clearUniqueId({
            uniqueId: options.uniqueId
          })
        })
        logJson('message cleared', result)
      }))
  )

  const version = program.command('version').description('version APIs')
  withGlobalOptions(
    version.command('check')
      .requiredOption('--name <name>', 'app name')
      .requiredOption('--ver <ver>', 'current version number')
      .requiredOption('--platform <platform>', 'ios/android/windows/linux/macos')
      .option('--architecture <architecture>', 'target architecture, e.g. arm64 or x64')
      .option('--channel <channel>', 'channel name')
      .option('--id <id>', 'current version table id')
      .action(async (options: VersionCheckCommandOptions) => withConfig(async config => {
        const name = options.name
        const ver = options.ver
        const platform = options.platform as never
        const resolved = resolveCliOptions(options, config)
        const result = await runLogged('checking update', async () => {
          return check(resolved, {
            name,
            ver: Number(ver),
            platform,
            architecture: options.architecture,
            channel: options.channel,
            id: toOptionalNumber(options.id)
          })
        })
        logJson('check result', result)
      }))
  )

  withGlobalOptions(
    version.command('create')
      .option('--name <name>', 'app name')
      .option('--ver <ver>', 'version number')
      .option('--platform <platform>', 'comma-separated target platforms')
      .option('--architecture <architecture>', 'comma-separated target architectures')
      .option('--desc <desc>', 'update description')
      .option('--file-size <size>', 'file size')
      .option('--enable <enable>', '1 or 0')
      .option('--mandatory <mandatory>', '1 or 0')
      .option('--install-url <url>', 'full update install url')
      .option('--package-url <url>', 'hot update package url')
      .option('--channel <channel>', 'channel name')
      .action(async (options: VersionCreateCommandOptions) => withConfig(async config => {
        const resolved = resolveCliOptions(options, config)
        const payload = buildCreatePayload(options, config)

        try {
          const result = await runLogged('creating version record', async () => {
            return withProtectedAuth(resolved, async token => {
              const client = createOtaClient({ ...stripCredentials(resolved), token })
              return client.version.create(payload)
            })
          })
          await invokeSuccessHook(config, result)
          logJson('version created', result)
        } catch (error) {
          await invokeErrorHook(config, error)
          throw error
        }
      }))
  )

  withGlobalOptions(
    version.command('upload')
      .option('--file <path>', 'path to update bundle')
      .option('--name <name>', 'app name')
      .option('--ver <ver>', 'version number')
      .option('--platform <platform>', 'comma-separated target platforms')
      .option('--architecture <architecture>', 'comma-separated target architectures')
      .option('--desc <desc>', 'update description')
      .option('--enable <enable>', '1 or 0')
      .option('--mandatory <mandatory>', '1 or 0')
      .option('--install-url <url>', 'optional install url')
      .option('--channel <channel>', 'channel name')
      .action(async (options: VersionUploadCommandOptions) => withConfig(async config => {
        const resolved = resolveCliOptions(options, config)
        const { filePath, payload } = resolveUploadTarget(options, config)

        try {
          const result = await runLogged('uploading hot update package', async () => {
            return withProtectedAuth(resolved, async token => {
              return uploadVersion({ ...stripCredentials(resolved), token }, filePath, payload)
            })
          })
          await invokeSuccessHook(config, result)
          logJson('upload completed', result)
        } catch (error) {
          await invokeErrorHook(config, error)
          throw error
        }
      }))
  )

  withGlobalOptions(
    version.command('success')
      .requiredOption('--name <name>', 'app name')
      .requiredOption('--platform <platform>', 'platform')
      .requiredOption('--ver <ver>', 'version number')
      .requiredOption('--ver-id <verId>', 'version table id')
      .option('--username <username>', 'username')
      .option('--extras <json>', 'extras payload as JSON string')
      .action(async (options: VersionSuccessCommandOptions) => withConfig(async config => {
        const name = options.name
        const platform = options.platform as never
        const ver = options.ver
        const verId = options.verId
        const resolved = resolveCliOptions(options, config)
        const result = await runLogged('reporting update success', async () => {
          return success(resolved, {
            name,
            platform,
            ver: Number(ver),
            verId: Number(verId),
            username: options.username,
            extras: options.extras ? parseJsonInput(options.extras, {}) : undefined
          })
        })
        logJson('success reported', result)
      }))
  )

  withGlobalOptions(
    version.command('error')
      .requiredOption('--name <name>', 'app name')
      .requiredOption('--platform <platform>', 'platform')
      .requiredOption('--ver <ver>', 'version number')
      .requiredOption('--ver-id <verId>', 'version table id')
      .requiredOption('--message <message>', 'error message')
      .option('--id <id>', 'existing error record id for update')
      .option('--username <username>', 'username')
      .option('--extras <json>', 'extras payload as JSON string')
      .action(async (options: VersionErrorCommandOptions) => withConfig(async config => {
        const name = options.name
        const platform = options.platform as never
        const ver = options.ver
        const verId = options.verId
        const message = options.message
        const payload: ErrorPayload = {
          id: toOptionalNumber(options.id),
          name,
          platform,
          ver: Number(ver),
          verId: Number(verId),
          username: options.username,
          extras: options.extras ? parseJsonInput(options.extras, {}) : undefined,
          message
        }
        const resolved = resolveCliOptions(options, config)
        const result = await runLogged('reporting update error', async () => {
          return error(resolved, payload)
        })
        logJson('error reported', result)
      }))
  )

  withGlobalOptions(
    version.command('app-error')
      .requiredOption('--name <name>', 'app name')
      .requiredOption('--platform <platform>', 'platform')
      .requiredOption('--ver <ver>', 'version number')
      .requiredOption('--kind <kind>', 'error kind: crash or error')
      .requiredOption('--message <message>', 'error message')
      .option('--stack <stack>', 'error stack')
      .option('--username <username>', 'username')
      .option('--extras <json>', 'extras payload as JSON string')
      .action(async (options: VersionAppErrorCommandOptions) => withConfig(async config => {
        const payload: AppErrorPayload = {
          name: options.name,
          platform: options.platform as never,
          ver: Number(options.ver),
          kind: parseAppErrorKind(options.kind),
          message: options.message,
          stack: options.stack,
          username: options.username,
          extras: options.extras ? parseJsonInput(options.extras, {}) : undefined
        }
        const resolved = resolveCliOptions(options, config)
        const result = await runLogged('reporting application error', async () => {
          return appError(resolved, payload)
        })
        logJson('application error reported', result)
      }))
  )

  program
    .addHelpText('after', `\nConfig file:\n  Create ota-cli.config.ts in the current working directory and export an object:\n  export default {\n    baseURL: 'http://127.0.0.1:3001',\n    auth: { username: 'admin', password: 'secret' }\n  }\n\nCLI auth cache:\n  Protected commands will reuse a cached token from the local machine when possible.\n  If no token is available, ota-cli will prompt for admin username and password in the terminal.\n`)

  await program.parseAsync(process.argv)
}

run().catch(error => {
  if (error instanceof OtaApiError) {
    logError(error.message)
    console.error(stringifyOutput({
      name: error.name,
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details
    }))
    process.exitCode = 1
    return
  }

  logError(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
