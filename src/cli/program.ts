import { Command } from 'commander'
import { version } from '../../package.json'
import { registerReleases } from './commands/releases'
import { errorResult } from './output'

export async function run(argv = process.argv) {
  const program = new Command().name('ota-cli').description('OTA API v1 client, publishing and management tools').version(version)
    .option('--base-url <url>', 'Complete API root including /api/v1')
    .option('--app <appName>', 'Application name')
    .option('--key-env <variable>', 'API Key environment variable (default OTA_ACCESS_KEY)')
    .option('--profile <name>').option('--config <path>').option('--no-config')
    .option('--timeout <ms>').option('--upload-timeout <ms>').option('--request-id <id>')
    .option('--json', 'Results use stdout JSON; diagnostics use stderr')
  registerReleases(program)
  try { await program.parseAsync(argv) }
  catch (error) { process.stderr.write(JSON.stringify(errorResult(error), null, 2) + '\n'); process.exitCode = 1 }
}
