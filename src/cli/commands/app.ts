import { Command } from 'commander'
import { createAppClient } from '../../app'
import type { AppErrorInput, FailureInput, Platform, SuccessInput } from '../../contracts'
import { object } from '../../contracts/validation'
import { jsonFile, numberOption, type CliContext } from '../context'
import { action } from '../action'

function client(ctx: CliContext) {
  return createAppClient({
    baseURL: ctx.baseURL,
    appName: ctx.resolveApp(),
    timeout: ctx.timeout,
    onRequest: ctx.progress.onRequest
  })
}
export function registerApp(program: Command) {
  const app = program.command('app').description('Public client checks and reports; no API Key')
  action(
    app
      .command('check')
      .requiredOption('--platform <platform>')
      .requiredOption('--current-version <version>')
      .option('--installed-release-sequence <number>')
      .option('--architecture <architecture>')
      .option('--distribution-channel <channel>')
      .option('--user-id <id>'),
    (ctx) =>
      client(ctx).checkUpdate(
        {
          platform: String(ctx.args.platform) as Platform,
          currentVersion: String(ctx.args.currentVersion),
          installedReleaseSequence:
            ctx.args.installedReleaseSequence !== undefined
              ? numberOption(ctx.args.installedReleaseSequence, 'installedReleaseSequence')
              : undefined,
          architecture: ctx.args.architecture as string | undefined,
          distributionChannel: ctx.args.distributionChannel as string | undefined,
          userId: ctx.args.userId as string | undefined
        },
        ctx.control
      )
  )
  action(app.command('success').requiredOption('--input <jsonFile>'), async (ctx) => {
    const body = await jsonFile(String(ctx.args.input))
    object(body)
    return client(ctx).reportSuccess(body as unknown as SuccessInput, ctx.control)
  })
  action(app.command('failure').requiredOption('--input <jsonFile>'), async (ctx) => {
    const body = await jsonFile(String(ctx.args.input))
    object(body)
    return client(ctx).reportFailure(body as unknown as FailureInput, ctx.control)
  })
  action(app.command('app-error').requiredOption('--input <jsonFile>'), async (ctx) => {
    const body = await jsonFile(String(ctx.args.input))
    object(body)
    return client(ctx).reportAppError(body as unknown as AppErrorInput, ctx.control)
  })
}
