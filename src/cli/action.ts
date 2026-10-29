import type { Command } from 'commander'
import { context, type CliContext } from './context'
import { result, withProgress } from './output'

export function action(command: Command, handler: (ctx: CliContext) => Promise<unknown>) {
  command.action(async (_options, cmd: Command) => {
    const ctx = await context(cmd)
    await withProgress(ctx.progress, async () => {
      try {
        const value = await handler(ctx)
        ctx.progress.finish(process.exitCode !== 1)
        result(value)
      } catch (error) {
        ctx.progress.finish(false)
        throw error
      }
    })
  })
  return command
}
