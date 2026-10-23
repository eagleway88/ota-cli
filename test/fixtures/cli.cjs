const { execFile } = require('node:child_process')
const path = require('node:path')
function cli(fixture, args, env = {}) {
  return new Promise((resolve) =>
    execFile(
      process.execPath,
      [path.resolve(__dirname, '../../dist/cli.cjs'), ...args],
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
module.exports = { cli }
