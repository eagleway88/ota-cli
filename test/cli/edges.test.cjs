const { test } = require('node:test')
const assert = require('node:assert/strict')
const { writeFile } = require('node:fs/promises')
const path = require('node:path')
const { fixture } = require('../fixtures/api.cjs')
const { cli } = require('../fixtures/cli.cjs')
test('malformed key input produces structured errors without making a request', async (t) => {
  const f = await fixture(t)
  const output = await cli(
    f,
    ['--no-config', '--base-url', f.baseURL, '--app', 'desktop', 'release', 'list'],
    { OTA_ACCESS_KEY: '"' }
  )
  assert.equal(output.code, 1)
  assert.equal(JSON.parse(output.stderr).message, 'Invalid accessKey')
  assert.equal(f.calls.length, 0)
})
test('configuration logs and callback warnings cannot corrupt JSON or expose API Key material', async (t) => {
  const f = await fixture(t)
  await writeFile(
    path.join(f.directory, 'ota-cli.config.ts'),
    'console.log("configuration loaded"); export default { ...' +
      JSON.stringify({
        baseURL: f.baseURL,
        appName: 'desktop',
        targets: {
          desktop: {
            file: f.zip,
            targetVersion: '1.3.10',
            platforms: ['windows', 'macos', 'linux'],
            updateType: 'hot',
            releaseScope: 'public',
            userIds: []
          }
        }
      }) +
      ', onPublished() { console.warn(process.env.OTA_ACCESS_KEY); console.error(process.env.OTA_ACCESS_KEY.split(".")[1]) } }'
  )
  const output = await cli(f, ['release', 'deploy', '--target', 'desktop'])
  assert.equal(output.code, 0, output.stderr)
  assert.equal(JSON.parse(output.stdout).deployments[0].result.status, 'published')
  assert.match(output.stderr, /configuration loaded/)
  assert.ok(!output.stderr.includes(f.accessKey))
  assert.ok(!output.stderr.includes('s'.repeat(43)))
})
