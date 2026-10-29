const { execFile } = require('node:child_process')
const { writeFile } = require('node:fs/promises')
const path = require('node:path')
async function writeConfig(fixture, config = {}) {
  await writeFile(
    path.join(fixture.directory, 'ota-cli.config.ts'),
    'export default ' + JSON.stringify({ baseURL: fixture.baseURL, appName: 'desktop', ...config })
  )
}
function cli(fixture, args, env = {}, { tty = false } = {}) {
  return new Promise((resolve) =>
    execFile(
      process.execPath,
      [
        ...(tty
          ? [
              '-e',
              "Object.defineProperty(process.stderr, 'isTTY', { value: true }); process.stderr.columns = 100; require(process.argv[1])"
            ]
          : []),
        path.resolve(__dirname, '../../dist/cli.cjs'),
        ...args
      ],
      {
        cwd: fixture.directory,
        timeout: 15000,
        env: { PATH: process.env.PATH, NODE_ENV: 'test', OTA_ACCESS_KEY: fixture.accessKey, ...env }
      },
      (error, stdout, stderr) =>
        resolve({
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          stdout,
          stderr
        })
    )
  )
}
module.exports = { cli, writeConfig }
