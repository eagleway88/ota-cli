const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFile, writeFile, mkdir, symlink, stat } = require('node:fs/promises')
const path = require('node:path')
const { createPublisher, DeploymentError, waitForTask } = require('../../dist/node.cjs')
const { fixture } = require('../fixtures/api.cjs')
const release = {
  targetVersion: '1.3.10',
  platforms: ['windows', 'macos', 'linux'],
  updateType: 'hot',
  releaseScope: 'public',
  userIds: [],
  mandatory: false
}
const options = (f) => ({ baseURL: f.baseURL, accessKey: f.accessKey })
const target = (f) => ({ appName: 'desktop', file: f.zip, release: { ...release } })
test('one shared desktop archive is uploaded once and published once for three platforms', async (t) => {
  const f = await fixture(t),
    publisher = createPublisher(options(f))
  t.after(() => publisher.close())
  const stateFile = path.join(f.directory, 'deployment.json')
  const result = await publisher.deploy(target(f), { stateFile, wait: true, pollInterval: 1 })
  assert.equal(f.calls.filter((call) => call.path.endsWith('/artifacts')).length, 1)
  assert.equal(f.drafts.size, 1)
  assert.equal(f.publications.size, 1)
  assert.deepEqual([...f.drafts.values()][0].platforms, ['windows', 'macos', 'linux'])
  assert.equal(result.task.task.status, 'succeeded')
  const stored = await readFile(stateFile, 'utf8')
  assert.ok(!stored.includes(f.accessKey))
  assert.ok(!stored.includes('s'.repeat(43)))
  assert.equal(JSON.parse(stored).phase, 'published')
  assert.equal((await stat(stateFile)).mode & 0o777, 0o600)
})
test('same-app policies and identical ZIPs at different paths reuse a single artifact; apps remain isolated', async (t) => {
  const f = await fixture(t),
    publisher = createPublisher(options(f))
  t.after(() => publisher.close())
  const copy = path.join(f.directory, 'copy.zip')
  await writeFile(copy, await readFile(f.zip))
  const results = await publisher.deployMany([
    target(f),
    { ...target(f), file: copy, release: { ...release, distributionChannel: 'beta' } },
    { ...target(f), appName: 'another-app' }
  ])
  assert.ok(results.every((entry) => entry.result))
  assert.equal(f.calls.filter((call) => call.path.endsWith('/artifacts')).length, 2)
  const inputs = [...f.drafts.values()]
  assert.equal(inputs[0].artifactId, inputs[1].artifactId)
  assert.notEqual(inputs[0].artifactId, inputs[2].artifactId)
})
test('all target inputs are validated before any write, and directories are zipped deterministically', async (t) => {
  const f = await fixture(t),
    publisher = createPublisher(options(f))
  t.after(() => publisher.close())
  await assert.rejects(
    publisher.deployMany([target(f), { ...target(f), release: { ...release, platforms: [] } }]),
    /nonempty/
  )
  assert.equal(f.calls.length, 0)
  const a = path.join(f.directory, 'a'),
    b = path.join(f.directory, 'b')
  await mkdir(a)
  await mkdir(b)
  await writeFile(path.join(a, 'main.js'), 'same bundle')
  await writeFile(path.join(b, 'main.js'), 'same bundle')
  const first = await publisher.uploadArtifact('desktop', a),
    second = await publisher.uploadArtifact('desktop', b)
  assert.equal(first.artifactId, second.artifactId)
  assert.equal(f.calls.length, 1)
})
test('symlinks in an upload directory are rejected before any HTTP request', async (t) => {
  const f = await fixture(t),
    publisher = createPublisher(options(f))
  t.after(() => publisher.close())
  const dir = path.join(f.directory, 'unsafe')
  await mkdir(dir)
  await symlink(f.zip, path.join(dir, 'outside.zip'))
  await assert.rejects(publisher.uploadArtifact('desktop', dir), /Symbolic/)
  assert.equal(f.calls.length, 0)
})
test('a lost create response resumes with the same idempotency key, without reuploading', async (t) => {
  const f = await fixture(t, { loseCreate: true })
  const stateFile = path.join(f.directory, 'resume.json')
  const first = createPublisher(options(f))
  await assert.rejects(
    first.deploy(target(f), { stateFile }),
    (error) => error instanceof DeploymentError && error.state.phase === 'creating'
  )
  await first.close()
  const second = createPublisher(options(f))
  t.after(() => second.close())
  await second.deploy(target(f), { stateFile, resume: true })
  assert.equal(f.drafts.size, 1)
  assert.equal(f.publications.size, 1)
  assert.equal(f.calls.filter((call) => call.path.endsWith('/artifacts')).length, 1)
  const creates = f.calls.filter((call) => call.path.endsWith('/releases'))
  assert.equal(creates[0].headers['idempotency-key'], creates[1].headers['idempotency-key'])
  assert.deepEqual(creates[0].body, creates[1].body)
})
test('an unknown upload outcome is not silently replayed', async (t) => {
  const f = await fixture(t, { loseUpload: true }),
    publisher = createPublisher(options(f))
  t.after(() => publisher.close())
  const stateFile = path.join(f.directory, 'unknown.json')
  await assert.rejects(publisher.deploy(target(f), { stateFile }), /socket hang up/)
  await assert.rejects(
    publisher.deploy(target(f), { stateFile, resume: true }),
    /Upload outcome unknown/
  )
  assert.equal(f.calls.length, 1)
  assert.equal(f.drafts.size, 0)
})
test('resume refuses changed content or intent and does not overwrite an existing state file', async (t) => {
  const f = await fixture(t),
    publisher = createPublisher(options(f))
  t.after(() => publisher.close())
  const stateFile = path.join(f.directory, 'state.json')
  await publisher.deploy(target(f), { stateFile })
  const count = f.calls.length
  await assert.rejects(publisher.deploy(target(f), { stateFile }), /EEXIST/)
  await assert.rejects(
    publisher.deploy(
      { ...target(f), release: { ...release, targetVersion: '1.3.11' } },
      { stateFile, resume: true }
    ),
    /does not match/
  )
  assert.equal(f.calls.length, count)
})
test('callback failures do not misreport a committed publication as failed', async (t) => {
  const f = await fixture(t),
    publisher = createPublisher(options(f))
  t.after(() => publisher.close())
  const result = await publisher.deploy(target(f), {
    onPublished: () => {
      throw new Error('local callback failed')
    }
  })
  assert.equal(result.status, 'published')
  assert.equal(result.warnings.length, 1)
  assert.equal(f.publications.size, 1)
})
test('failed or timed-out dispatch does not roll back or repeat the publication', async (t) => {
  const f = await fixture(t, { taskStatus: 'failed' }),
    publisher = createPublisher(options(f))
  t.after(() => publisher.close())
  await assert.rejects(
    publisher.deploy(target(f), { wait: true }),
    (error) => error.state.phase === 'published' && error.message.includes('remains published')
  )
  assert.equal(f.publications.size, 1)
  await assert.rejects(waitForTask(options(f), 'desktop', 'task', { timeout: 0 }), /positive/)
})
test('full releases can publish an installer URL without uploading a ZIP', async (t) => {
  const f = await fixture(t),
    publisher = createPublisher(options(f))
  t.after(() => publisher.close())
  const result = await publisher.deploy({
    appName: 'desktop',
    release: {
      ...release,
      updateType: 'full',
      installerSourceUrl: 'https://example.test/app.exe'
    }
  })
  assert.equal(result.status, 'published')
  assert.equal(f.calls.filter((call) => call.path.endsWith('/artifacts')).length, 0)
})
