const assert = require('node:assert/strict')
const { existsSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const pkg = require('../package.json')
for (const entry of Object.values(pkg.exports))
  for (const format of ['import', 'require'])
    for (const value of Object.values(entry[format]))
      assert.ok(existsSync(value), 'Missing package entry: ' + value)
assert.ok(existsSync('dist/cli.cjs'))
const result = spawnSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    '--noEmit',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2020',
    '--strict',
    '--skipLibCheck',
    'test/fixtures/consumer.mts',
    'test/fixtures/consumer.cts',
    'ota-cli.config.ts'
  ],
  { stdio: 'inherit' }
)
if (result.status !== 0) process.exit(result.status ?? 1)
assert.ok(pkg.files.every((value) => value === 'dist' || value === 'README.md'))
console.log('Verified ESM/CJS entries, declarations, configuration example and CLI artifact.')
