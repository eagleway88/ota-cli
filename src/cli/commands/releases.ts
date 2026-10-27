import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Command } from 'commander'
import type { DraftInput, Platform } from '../../contracts'
import { draftInput, object, platform } from '../../contracts/validation'
import { createPublisher } from '../../node/publisher'
import { context, jsonFile, numberOption, type CliContext } from '../context'
import { result, errorResult, progress, withHookOutput } from '../output'

function action(command: Command, handler: (ctx: CliContext) => Promise<unknown>) {
  command.action(async (_options, cmd: Command) => result(await handler(await context(cmd))))
  return command
}
function target(ctx: CliContext, name: Platform) {
  const configured = ctx.config.targets?.[name]
  if (!configured) throw new Error('Unknown release target: ' + name)
  const { file, appName: targetApp, ...release } = configured
  const merged = { ...ctx.config.defaults, ...release, platforms: [name] } as DraftInput
  const filePath = file ? path.resolve(ctx.directory, file) : undefined
  return { appName: ctx.resolveApp(targetApp), file: filePath, release: merged }
}
export function registerReleases(program: Command) {
  const artifacts = program
    .command('artifact')
    .description('Upload ZIP resources; does not publish')
  action(artifacts.command('upload').requiredOption('--file <path>'), async (ctx) => {
    const publisher = createPublisher(ctx.credentials())
    try {
      return await publisher.uploadArtifact(
        ctx.resolveApp(),
        path.resolve(String(ctx.args.file)),
        ctx.control
      )
    } finally {
      await publisher.close()
    }
  })
  const release = program
    .command('release')
    .description('Drafts, publication and shared-file deployment')
  action(
    release
      .command('list')
      .option('--status <status>')
      .option('--page <number>')
      .option('--page-size <number>'),
    async (ctx) => {
      const status = ctx.args.status
      if (status !== undefined && status !== 'draft' && status !== 'published')
        throw new Error('status must be draft or published')
      return ctx.manage().releases.list({
        status,
        page: ctx.args.page !== undefined ? numberOption(ctx.args.page, 'page', 1) : undefined,
        pageSize:
          ctx.args.pageSize !== undefined
            ? numberOption(ctx.args.pageSize, 'pageSize', 1)
            : undefined
      })
    }
  )
  action(release.command('show').requiredOption('--id <releaseId>'), (ctx) =>
    ctx.manage().releases.get(String(ctx.args.id))
  )
  action(
    release
      .command('create')
      .requiredOption('--input <jsonFile>')
      .option('--idempotency-key <key>'),
    async (ctx) => {
      const input = await jsonFile(String(ctx.args.input))
      object(input)
      const idempotencyKey = String(ctx.args.idempotencyKey ?? randomUUID())
      return {
        draft: await ctx
          .manage()
          .releases.create(input as unknown as DraftInput, { ...ctx.control, idempotencyKey }),
        idempotencyKey
      }
    }
  )
  action(
    release
      .command('update')
      .requiredOption('--id <releaseId>')
      .requiredOption('--input <jsonFile>'),
    async (ctx) => {
      const input = await jsonFile(String(ctx.args.input))
      object(input)
      return ctx.manage().releases.update(String(ctx.args.id), input, ctx.control)
    }
  )
  for (const operation of ['publish', 'enable', 'disable', 'redispatch'] as const)
    action(release.command(operation).requiredOption('--id <releaseId>'), (ctx) =>
      ctx.manage().releases[operation](String(ctx.args.id), ctx.control)
    )
  action(release.command('users').requiredOption('--id <releaseId>'), (ctx) =>
    ctx.manage().releases.users(String(ctx.args.id))
  )
  action(
    release
      .command('set-users')
      .requiredOption('--id <releaseId>')
      .requiredOption('--input <jsonFile>')
      .option('--expected-revision <revision>'),
    async (ctx) => {
      const input = await jsonFile(String(ctx.args.input))
      if (!Array.isArray(input) || !input.every((value) => typeof value === 'string'))
        throw new Error('Input must be a JSON array of userIds')
      return ctx
        .manage()
        .releases.replaceUsers(
          String(ctx.args.id),
          input,
          ctx.args.expectedRevision !== undefined
            ? numberOption(ctx.args.expectedRevision, 'expectedRevision', 1)
            : undefined,
          ctx.control
        )
    }
  )
  action(
    release
      .command('set-scope')
      .requiredOption('--id <releaseId>')
      .requiredOption('--scope <public|allowlist>')
      .option('--expected-revision <revision>'),
    (ctx) =>
      ctx
        .manage()
        .releases.changeScope(
          String(ctx.args.id),
          String(ctx.args.scope) as 'public' | 'allowlist',
          ctx.args.expectedRevision !== undefined
            ? numberOption(ctx.args.expectedRevision, 'expectedRevision', 1)
            : undefined,
          ctx.control
        )
  )
  action(
    release
      .command('deploy')
      .option(
        '--target <platform[,platform]>',
        'Select configured platforms (default: all targets)'
      )
      .option('--dry-run')
      .option('--state <path>')
      .option('--resume <stateFile>')
      .option('--wait')
      .option('--wait-timeout <ms>')
      .option('--poll-interval <ms>'),
    async (ctx) => {
      const selected =
        ctx.args.target === undefined
          ? Object.keys(ctx.config.targets ?? {})
          : String(ctx.args.target).split(',')
      if (!selected.length) throw new Error('No release targets configured in ota-cli.config')
      const names = selected.map((name) => {
        platform(name)
        return name
      })
      if (names.some((name) => !name) || new Set(names).size !== names.length)
        throw new Error('Choose distinct target names')
      if (names.length > 1 && (ctx.args.state || ctx.args.resume))
        throw new Error('--state and --resume require exactly one target')
      const targets = names.map((name) => target(ctx, name))
      if (ctx.args.state && ctx.args.resume) throw new Error('Choose --state or --resume')
      if (ctx.args.dryRun) {
        for (const value of targets) {
          if (
            value.file &&
            (value.release.artifactId ||
              value.release.bundleUrl ||
              value.release.installerSourceUrl)
          )
            throw new Error('file cannot be combined with artifactId or source URLs')
          draftInput(
            value.file ? { ...value.release, artifactId: 'pending-upload' } : value.release,
            value.appName
          )
          if (value.file) {
            const source = await stat(value.file)
            if (
              !source.isDirectory() &&
              (!source.isFile() || path.extname(value.file).toLowerCase() !== '.zip')
            )
              throw new Error('Upload source must be a ZIP file or a directory')
          }
        }
        return { dryRun: true, targets }
      }
      const publisher = createPublisher(ctx.credentials())
      try {
        const entries = await publisher.deployMany(targets, () => ({
          ...ctx.control,
          stateFile: ctx.args.resume
            ? path.resolve(String(ctx.args.resume))
            : ctx.args.state
              ? path.resolve(String(ctx.args.state))
              : path.join(process.cwd(), '.ota-cli', 'deployments', randomUUID() + '.json'),
          resume: Boolean(ctx.args.resume),
          wait: Boolean(ctx.args.wait),
          waitTimeout:
            ctx.args.waitTimeout !== undefined
              ? numberOption(ctx.args.waitTimeout, 'waitTimeout', 1)
              : undefined,
          pollInterval:
            ctx.args.pollInterval !== undefined
              ? numberOption(ctx.args.pollInterval, 'pollInterval', 1)
              : undefined,
          onPublished: async (publication) =>
            withHookOutput(async () => {
              await ctx.config.onPublished?.(publication)
            }),
          onError: async (error) =>
            withHookOutput(async () => {
              await ctx.config.onError?.(error)
            })
        }))
        const output = entries.map((entry, index) => ({
          target: names[index],
          appName: entry.appName,
          ...(entry.result ? { result: entry.result } : { error: errorResult(entry.error) })
        }))
        if (entries.some((entry) => entry.error)) process.exitCode = 1
        for (const item of output)
          if ('result' in item && item.result.warnings.length)
            progress(item.result.warnings.join('\n'))
        return { deployments: output }
      } finally {
        await publisher.close()
      }
    }
  )
}
