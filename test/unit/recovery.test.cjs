const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { createPublisher, waitForTask } = require('../../dist/node.cjs')
const { fixture } = require('../fixtures/api.cjs')
const input = (f) => ({
  appName: 'desktop',
  file: f.zip,
  release: {
    targetVersion: '1.3.10',
    platforms: ['windows', 'macos', 'linux'],
    updateType: 'hot',
    releaseScope: 'public',
    userIds: []
  }
})
const options = (f) => ({ baseURL: f.baseURL, accessKey: f.accessKey })
test('a lost publish response resumes the same release without duplicating uploads or publications', async (t) => {
  const f = await fixture(t, { losePublish: true })
  const file = path.join(f.directory, 'publish.json')
  const first = createPublisher(options(f))
  await assert.rejects(
    first.deploy(input(f), { stateFile: file }),
    (error) => error.state.phase === 'publishing'
  )
  await first.close()
  const second = createPublisher(options(f))
  t.after(() => second.close())
  const recovered = await second.deploy(input(f), { stateFile: file, resume: true })
  assert.equal(recovered.status, 'published')
  assert.equal(recovered.taskId, undefined)
  assert.equal(f.publications.size, 1)
  assert.equal(f.drafts.size, 1)
  assert.equal(f.calls.filter((call) => call.path.endsWith('/artifacts')).length, 1)
  const count = f.calls.length
  await second.deploy(input(f), { stateFile: file, resume: true })
  assert.equal(f.calls.length, count)
})
test('multi-target errors retain their API status and do not roll back other successful policies', async (t) => {
  const f = await fixture(t, {
    handle: async (call, send) => {
      if (call.path.endsWith('/releases') && call.body?.distributionChannel === 'denied') {
        send('Forbidden', 403)
        return true
      }
      return false
    }
  })
  const publisher = createPublisher(options(f))
  t.after(() => publisher.close())
  const results = await publisher.deployMany([
    input(f),
    { ...input(f), release: { ...input(f).release, distributionChannel: 'denied' } },
    { ...input(f), release: { ...input(f).release, distributionChannel: 'beta' } }
  ])
  assert.equal(results[0].result.status, 'published')
  assert.equal(results[2].result.status, 'published')
  assert.equal(results[1].error.apiError.status, 403)
  assert.equal(f.publications.size, 2)
  assert.equal(f.calls.filter((call) => call.path.endsWith('/artifacts')).length, 1)
})
test('task wait has a real deadline and abort does not issue further requests', async (t) => {
  const f = await fixture(t, { taskStatus: 'running' })
  await assert.rejects(
    waitForTask(options(f), 'desktop', 'task', { timeout: 80, pollInterval: 5 }),
    /timed out/
  )
  const count = f.calls.length
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    waitForTask(options(f), 'desktop', 'task', { signal: controller.signal }),
    /aborted/
  )
  assert.equal(f.calls.length, count)
})
test('a damaged saved artifact or publication is rejected without new writes', async (t) => {
  const f = await fixture(t),
    publisher = createPublisher(options(f))
  t.after(() => publisher.close())
  const stateFile = path.join(f.directory, 'state.json')
  await publisher.deploy(input(f), { stateFile })
  const original = JSON.parse(await readFile(stateFile, 'utf8'))
  const count = f.calls.length
  const missingArtifact = { ...original }
  delete missingArtifact.artifact
  await writeFile(stateFile, JSON.stringify(missingArtifact))
  await assert.rejects(publisher.deploy(input(f), { stateFile, resume: true }), /missing artifact/)
  await writeFile(
    stateFile,
    JSON.stringify({
      ...original,
      publication: { ...original.publication, releaseId: 'another-release' }
    })
  )
  await assert.rejects(
    publisher.deploy(input(f), { stateFile, resume: true }),
    /Invalid saved publication/
  )
  assert.equal(f.calls.length, count)
})
test('authenticated redirects are not followed to another destination', async (t) => {
  const other = await fixture(t)
  const f = await fixture(t, {
    handle: async (_call, _send, response) => {
      response.writeHead(307, { location: other.baseURL + '/manage/apps/desktop/releases' })
      response.end()
      return true
    }
  })
  const { createManageClient } = require('../../dist/manage.cjs')
  await assert.rejects(
    createManageClient(options(f)).forApp('desktop').releases.list(),
    (error) => error.status === 307
  )
  assert.equal(f.calls.length, 1)
  assert.equal(other.calls.length, 0)
})
