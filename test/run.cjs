const { readdirSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')
const discover = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? discover(join(dir, entry.name))
      : entry.name.endsWith('.test.cjs')
        ? [join(dir, entry.name)]
        : []
  )
const result = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', ...discover('test').sort()],
  { stdio: 'inherit' }
)
process.exitCode = result.status ?? 1
