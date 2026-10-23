import { Command } from 'commander'
import type { JsonValue } from '../../contracts'
import { jsonValue } from '../../contracts/validation'
import { context, jsonFile, type CliContext } from '../context'
import { result } from '../output'

async function data(ctx: CliContext): Promise<JsonValue | undefined> {
  if (ctx.args.data !== undefined && ctx.args.dataFile !== undefined)
    throw new Error('Choose --data or --data-file')
  const value: unknown =
    ctx.args.dataFile !== undefined
      ? await jsonFile(String(ctx.args.dataFile))
      : ctx.args.data !== undefined
        ? JSON.parse(String(ctx.args.data))
        : undefined
  if (value !== undefined) jsonValue(value)
  return value as JsonValue | undefined
}
function action(command: Command, handler: (ctx: CliContext) => Promise<unknown>) {
  command.action(async (_options, cmd: Command) => result(await handler(await context(cmd))))
}
function dataOptions(command: Command) {
  return command.option('--data <json>').option('--data-file <path>')
}
export function registerMessages(program: Command) {
  const message = program
    .command('message')
    .description('Messages scoped to one application; not OTA redispatch')
  action(message.command('subscriptions'), (ctx) => ctx.manage().messages.subscriptions())
  action(dataOptions(message.command('application')), async (ctx) =>
    ctx.manage().messages.application(await data(ctx), ctx.control)
  )
  action(
    dataOptions(message.command('user').requiredOption('--user-id <id>')).option('--resend'),
    async (ctx) =>
      ctx
        .manage()
        .messages.user(
          String(ctx.args.userId),
          { data: await data(ctx), resend: Boolean(ctx.args.resend) },
          ctx.control
        )
  )
  action(
    dataOptions(message.command('device').requiredOption('--unique-id <id>')).option('--resend'),
    async (ctx) =>
      ctx
        .manage()
        .messages.device(
          String(ctx.args.uniqueId),
          { data: await data(ctx), resend: Boolean(ctx.args.resend) },
          ctx.control
        )
  )
}
