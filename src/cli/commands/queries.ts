import { Command } from 'commander'
import type {
  AuditQuery,
  AppErrorsQuery,
  TaskQuery,
  TaskLogQuery,
  TelemetryQuery,
  TimeQuery
} from '../../contracts'
import { waitForTask } from '../../node/publisher'
import { numberOption, type CliContext } from '../context'
import { action } from '../action'

function timeOptions(command: Command, paginated = true) {
  command.option('--from <iso>').option('--to <iso>')
  if (paginated) command.option('--page <number>').option('--page-size <number>')
  return command
}
function query(ctx: CliContext, extra: string[] = []): Record<string, string | number> {
  const output: Record<string, string | number> = {}
  for (const key of ['from', 'to', 'page', 'pageSize', ...extra]) {
    const value = ctx.args[key]
    if (value !== undefined)
      output[key] = ['page', 'pageSize', 'releaseSequence'].includes(key)
        ? numberOption(value, key, 1)
        : String(value)
  }
  return output
}
export function registerQueries(program: Command) {
  const statistics = program
    .command('statistics')
    .description('Installation report counts, not unique installations')
  action(
    timeOptions(statistics.command('summary'), false)
      .option('--platform <platform>')
      .option('--release-sequence <number>'),
    (ctx) => ctx.manage().statistics.summary(query(ctx, ['platform', 'releaseSequence']))
  )
  const telemetry = program
    .command('telemetry')
    .description('Read installation reports and aggregated application errors')
  for (const kind of ['successes', 'failures'] as const)
    action(
      timeOptions(telemetry.command(kind))
        .option('--platform <platform>')
        .option('--release-sequence <number>'),
      (ctx) =>
        ctx.manage().telemetry[kind](query(ctx, ['platform', 'releaseSequence']) as TelemetryQuery)
    )
  action(
    timeOptions(telemetry.command('app-errors'))
      .option('--platform <platform>')
      .option('--kind <crash|error>')
      .option('--error-hash <hash>'),
    (ctx) =>
      ctx
        .manage()
        .telemetry.appErrors(query(ctx, ['platform', 'kind', 'errorHash']) as AppErrorsQuery)
  )
  const task = program.command('task').description('Dispatch tasks and permanent execution records')
  action(
    timeOptions(task.command('list')).option('--status <status>').option('--release-id <id>'),
    (ctx) => ctx.manage().tasks.list(query(ctx, ['status', 'releaseId']) as TaskQuery)
  )
  action(task.command('show').requiredOption('--id <taskId>'), (ctx) =>
    ctx.manage().tasks.get(String(ctx.args.id))
  )
  action(
    timeOptions(task.command('logs').requiredOption('--id <taskId>')).option('--status <status>'),
    (ctx) => ctx.manage().tasks.logs(String(ctx.args.id), query(ctx, ['status']) as TaskLogQuery)
  )
  action(
    task
      .command('wait')
      .requiredOption('--id <taskId>')
      .option('--wait-timeout <ms>')
      .option('--poll-interval <ms>'),
    (ctx) =>
      waitForTask(ctx.credentials(), ctx.resolveApp(), String(ctx.args.id), {
        ...ctx.control,
        onProgress: ctx.progress.onProgress,
        timeout:
          ctx.args.waitTimeout !== undefined
            ? numberOption(ctx.args.waitTimeout, 'waitTimeout', 1)
            : undefined,
        pollInterval:
          ctx.args.pollInterval !== undefined
            ? numberOption(ctx.args.pollInterval, 'pollInterval', 1)
            : undefined
      })
  )
  const audit = program
    .command('audit')
    .description('Application audit; global operator audit stays server-local')
  action(
    timeOptions(audit.command('list'))
      .option('--action <action>')
      .option('--result <succeeded|failed>')
      .option('--actor-key-id <id>')
      .option('--operation-id <id>')
      .option('--request-id <id>')
      .option('--release-id <id>')
      .option('--task-id <id>'),
    (ctx) =>
      ctx
        .manage()
        .audit.list(
          query(ctx, [
            'action',
            'result',
            'actorKeyId',
            'operationId',
            'requestId',
            'releaseId',
            'taskId'
          ]) as AuditQuery
        )
  )
  const release = program.commands.find((command) => command.name() === 'release')!
  action(timeOptions(release.command('delivery').requiredOption('--id <releaseId>')), (ctx) =>
    ctx.manage().releases.delivery(String(ctx.args.id), query(ctx) as TimeQuery)
  )
}
