const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fixture } = require('../fixtures/api.cjs')
const { cli, writeConfig } = require('../fixtures/cli.cjs')

test('CLI deploys a Web refresh without preparing or uploading a file', async (t) => {
  const f = await fixture(t)
  const release = {
    targetVersion: '1.3.11',
    updateType: 'full',
    releaseScope: 'public',
    userIds: [],
    mandatory: false,
    showUpdateDialog: true
  }
  await writeConfig(f, { appName: 'website', targets: { web: release } })
  const dryRun = await cli(f, ['release', 'deploy', '--target', 'web', '--dry-run'], {
    OTA_ACCESS_KEY: ''
  })
  assert.equal(dryRun.code, 0, dryRun.stderr)
  assert.deepEqual(JSON.parse(dryRun.stdout).targets[0].release, {
    ...release,
    platforms: ['web']
  })
  assert.equal(f.calls.length, 0)

  const output = await cli(f, ['release', 'deploy', '--target', 'web', '--wait'])
  assert.equal(output.code, 0, output.stderr)
  const deployment = JSON.parse(output.stdout).deployments[0]
  assert.equal(deployment.target, 'web')
  assert.equal(deployment.result.status, 'published')
  assert.equal(f.calls.filter((call) => call.path.endsWith('/artifacts')).length, 0)
  assert.equal(f.drafts.size, 1)
  assert.equal(f.publications.size, 1)
  const draft = [...f.drafts.values()][0]
  assert.deepEqual(draft.platforms, ['web'])
  assert.equal(draft.artifactId, undefined)
  assert.equal(draft.bundleUrl, undefined)
  assert.equal(draft.installerSourceUrl, undefined)
  assert.equal(draft.targetVersion, '1.3.11')
  assert.equal(draft.showUpdateDialog, true)
})
