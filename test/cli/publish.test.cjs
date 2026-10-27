const { test } = require('node:test')
const assert = require('node:assert/strict')
const { writeFile, access } = require('node:fs/promises')
const path = require('node:path')
const { fixture } = require('../fixtures/api.cjs')
const { cli, writeConfig } = require('../fixtures/cli.cjs')
const release = {
  targetVersion: '1.3.10',
  updateType: 'hot',
  releaseScope: 'public',
  userIds: [],
  mandatory: false
}
async function config(f, targets = { windows: { file: f.zip, ...release } }) {
  await writeConfig(f, { targets })
}
test('CLI package version comes from the manifest', async (t) => {
  const f = await fixture(t)
  const output = await cli(f, ['--version'])
  assert.equal(output.code, 0)
  assert.equal(output.stdout.trim(), require('../../package.json').version)
})
test('CLI deploy defaults to all configured platforms and uploads their shared ZIP once', async (t) => {
  const f = await fixture(t)
  await writeFile(
    path.join(f.directory, 'ota-cli.config.ts'),
    'export default { ...' +
      JSON.stringify({
        baseURL: f.baseURL,
        appName: 'desktop',
        defaults: release,
        targets: {
          windows: { file: f.zip },
          macos: { file: f.zip },
          linux: { file: f.zip }
        }
      }) +
      ', onPublished() { console.log("hook diagnostic") } }'
  )
  const output = await cli(f, ['release', 'deploy', '--json'])
  assert.equal(output.code, 0, output.stderr)
  const { deployments } = JSON.parse(output.stdout)
  assert.deepEqual(
    deployments.map((item) => item.target),
    ['windows', 'macos', 'linux']
  )
  assert.ok(deployments.every((item) => item.result.status === 'published'))
  assert.equal(new Set(deployments.map((item) => item.result.artifactId)).size, 1)
  assert.match(output.stderr, /hook diagnostic/)
  assert.equal(f.calls.filter((call) => call.path.endsWith('/artifacts')).length, 1)
  assert.equal(f.drafts.size, 3)
  assert.equal(f.publications.size, 3)
  assert.deepEqual(
    [...f.drafts.values()].map((draft) => draft.platforms),
    [['windows'], ['macos'], ['linux']]
  )
  assert.ok(!output.stdout.includes(f.accessKey))
  assert.ok(!output.stderr.includes(f.accessKey))
})
test('CLI deploy selects only requested platforms and dry-run never writes remotely or requires a key', async (t) => {
  const f = await fixture(t)
  await config(f, {
    windows: { file: f.zip, ...release },
    macos: { file: f.zip, ...release, distributionChannel: 'beta' },
    linux: { file: './not-built.zip', ...release }
  })
  const dryRun = await cli(f, ['release', 'deploy', '--target', 'windows,macos', '--dry-run'], {
    OTA_ACCESS_KEY: ''
  })
  assert.equal(dryRun.code, 0, dryRun.stderr)
  assert.equal(JSON.parse(dryRun.stdout).dryRun, true)
  assert.deepEqual(
    JSON.parse(dryRun.stdout).targets.map((target) => target.release.platforms),
    [['windows'], ['macos']]
  )
  assert.equal(f.calls.length, 0)
  await assert.rejects(access(path.join(f.directory, '.ota-cli')))
  const output = await cli(f, ['release', 'deploy', '--target', 'windows,macos'])
  assert.equal(output.code, 0, output.stderr)
  assert.equal(JSON.parse(output.stdout).deployments.length, 2)
  assert.equal(f.calls.filter((call) => call.path.endsWith('/artifacts')).length, 1)
  assert.equal(f.publications.size, 2)
})
test('a single implicit platform can save state and explicit selection can resume it without republishing', async (t) => {
  const f = await fixture(t)
  await config(f)
  const stateFile = path.join(f.directory, 'deployment.json')
  const first = await cli(f, ['release', 'deploy', '--state', stateFile])
  assert.equal(first.code, 0, first.stderr)
  assert.equal(JSON.parse(first.stdout).deployments[0].target, 'windows')
  assert.equal(f.publications.size, 1)
  const calls = f.calls.length
  await config(f, {
    windows: { file: f.zip, ...release },
    macos: { file: f.zip, ...release }
  })
  const resumed = await cli(f, ['release', 'deploy', '--target', 'windows', '--resume', stateFile])
  assert.equal(resumed.code, 0, resumed.stderr)
  assert.equal(JSON.parse(resumed.stdout).deployments[0].result.status, 'published')
  assert.equal(f.publications.size, 1)
  assert.equal(f.calls.length, calls)
})

test('resource upload and draft creation never publish implicitly', async (t) => {
  const f = await fixture(t)
  await writeConfig(f)
  const uploaded = await cli(f, ['artifact', 'upload', '--file', f.zip])
  assert.equal(uploaded.code, 0, uploaded.stderr)
  assert.equal(f.drafts.size, 0)
  assert.equal(f.publications.size, 0)
  const input = path.join(f.directory, 'release.json')
  await writeFile(
    input,
    JSON.stringify({
      ...release,
      platforms: ['windows'],
      artifactId: JSON.parse(uploaded.stdout).artifactId
    })
  )
  const created = await cli(f, [
    'release',
    'create',
    '--input',
    input,
    '--idempotency-key',
    'cli-stable-key'
  ])
  assert.equal(created.code, 0, created.stderr)
  assert.equal(JSON.parse(created.stdout).draft.status, 'draft')
  assert.equal(f.drafts.size, 1)
  assert.equal(f.publications.size, 0)
})
test('CLI makes one request on 401/403, gives distinct hints and never prints credentials', async (t) => {
  for (const status of [401, 403]) {
    const f = await fixture(t, {
      handle: async (call, send) => {
        send('denied ' + call.headers.authorization, status)
        return true
      }
    })
    await writeConfig(f)
    const output = await cli(f, ['release', 'list'])
    assert.equal(output.code, 1)
    const error = JSON.parse(output.stderr)
    assert.equal(error.status, status)
    assert.match(error.hint, status === 401 ? /invalid/ : /lacks/)
    assert.equal(f.calls.length, 1)
    assert.ok(!output.stderr.includes(f.accessKey))
    assert.ok(!output.stderr.includes('s'.repeat(43)))
  }
})
