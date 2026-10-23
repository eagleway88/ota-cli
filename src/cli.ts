import { Command } from 'commander'
import { version } from '../package.json'

const program = new Command().name('ota-cli').description('OTA API v1 client and publishing tools').version(version)
void program.parseAsync().catch(() => { process.stderr.write('Command failed\n'); process.exitCode = 1 })
