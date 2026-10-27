import { Command } from 'commander'
import { version } from '../../package.json'
import { registerReleases } from './commands/releases'
import { registerApp } from './commands/app'
import { registerMessages } from './commands/messages'
import { registerQueries } from './commands/queries'
import { errorResult, withHookOutput } from './output'

export async function run(argv = process.argv) {
  const program = new Command()
    .name('ota-cli')
    .description('OTA API v1 client, publishing and management tools')
    .version(version)
    .option('--request-id <id>')
    .option('--json', 'Results use stdout JSON; diagnostics use stderr')
  registerReleases(program)
  registerApp(program)
  registerMessages(program)
  registerQueries(program)
  try {
    await withHookOutput(() => program.parseAsync(argv))
  } catch (error) {
    process.stderr.write(JSON.stringify(errorResult(error), null, 2) + '\n')
    process.exitCode = 1
  }
}
