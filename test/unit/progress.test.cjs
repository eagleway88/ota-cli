const { test } = require('node:test')
const assert = require('node:assert/strict')
const { writeFile, readFile, mkdir } = require('node:fs/promises')
const path = require('node:path')
const { createPublisher, waitForTask } = require('../../dist/node.cjs')
const { fixture } = require('../fixtures/api.cjs')
const options = (f) => ({ baseURL: f.baseURL, accessKey: f.accessKey })
const release = {
  targetVersion: '1.0.0',
  platforms: ['windows'],
  updateType: 'hot',
  releaseScope: 'public',
  userIds: []
}

test('upload bytes are monotonic and sending 100% still waits for server confirmation', async (t) => {
  let releaseResponse
  const gate = new Promise((resolve) => {
    releaseResponse = resolve
  })
  t.after(() => releaseResponse())
  const f = await fixture(t, {
    handle: async (call) => {
      if (call.path.endsWith('/artifacts')) await gate
      return false
    }
  })
  await writeFile(f.zip, Buffer.alloc(2 * 1024 * 1024, 0x42))
  let sent
  const sentEvent = new Promise((resolve) => {
    sent = resolve
  })
  const events = []
  const publisher = createPublisher({
    ...options(f),
    onProgress: (event) => {
      events.push(event)
      if (event.phase === 'upload-sent') sent()
    }
  })
  t.after(() => publisher.close())
  let settled = false
  const pending = publisher.uploadArtifact('desktop', f.zip).finally(() => {
    settled = true
  })
  await sentEvent
  assert.equal(settled, false)
  assert.ok(!events.some((event) => event.phase === 'uploaded'))
  const transfers = events.filter((event) => event.phase === 'uploading')
  assert.equal(transfers[0].loaded, 0)
  assert.ok(transfers.length > 3)
  for (let i = 1; i < transfers.length; i++) {
    assert.ok(transfers[i].loaded >= transfers[i - 1].loaded)
    assert.ok(transfers[i].loaded <= transfers[i].total)
  }
  const last = events.at(-1)
  assert.equal(last.loaded, last.total)
  releaseResponse()
  const artifact = await pending
  assert.equal(artifact.sizeBytes, 2 * 1024 * 1024)
  assert.equal(last.total, f.calls[0].raw.length)
  assert.equal(Number(f.calls[0].headers['content-length']), last.total)
  assert.equal(events.at(-1).phase, 'completed')
  const count = f.calls.length
  await publisher.uploadArtifact('desktop', f.zip)
  assert.equal(f.calls.length, count)
  assert.ok(events.some((event) => event.phase === 'reused'))
})

test('preparation, multi-target stages, reuse and resume are observable without changing publication', async (t) => {
  const f = await fixture(t)
  const directory = path.join(f.directory, 'source')
  await mkdir(directory)
  await writeFile(path.join(directory, 'main.js'), 'bundle')
  const events = []
  const publisher = createPublisher({ ...options(f), onProgress: (event) => events.push(event) })
  t.after(() => publisher.close())
  const stateFile = path.join(f.directory, 'progress-state.json')
  const targets = ['windows', 'macos'].map((platform) => ({
    appName: 'desktop',
    file: directory,
    release: { ...release, platforms: [platform] }
  }))
  const result = await publisher.deployMany(targets, (_target, index) =>
    index === 0 ? { stateFile } : {}
  )
  assert.ok(result.every((entry) => entry.result))
  assert.ok(
    events.findIndex((event) => event.phase === 'packing') <
      events.findIndex((event) => event.phase === 'target')
  )
  assert.deepEqual(
    events.filter((event) => event.phase === 'target').map(({ index, count }) => [index, count]),
    [
      [1, 2],
      [2, 2]
    ]
  )
  assert.equal(events.filter((event) => event.phase === 'uploaded').length, 1)
  assert.equal(events.filter((event) => event.phase === 'published').length, 2)
  assert.equal(events.filter((event) => event.phase === 'reused').length, 1)
  const count = f.calls.length
  await publisher.deploy(targets[0], { stateFile, resume: true })
  assert.equal(f.calls.length, count)
  assert.equal(events.find((event) => event.phase === 'resuming').resumePhase, 'published')
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).phase, 'published')
})

test('task progress retains status transitions and observer failures never fail a committed write', async (t) => {
  let polls = 0
  const f = await fixture(t, {
    handle: async (call, send) => {
      if (!call.path.includes('/tasks/')) return false
      send({
        task: { status: ['pending', 'running', 'retry_wait', 'succeeded'][polls++] },
        latestLog: null
      })
      return true
    }
  })
  const events = []
  await waitForTask(options(f), 'desktop', 'task', {
    pollInterval: 1,
    requestId: 'progress-trace',
    onProgress: (event) => {
      events.push(event)
      throw new Error('observer')
    }
  })
  assert.deepEqual(
    events.filter((event) => event.phase === 'task').map((event) => event.taskStatus),
    ['pending', 'running', 'retry_wait', 'succeeded']
  )
  assert.equal(events.at(-1).phase, 'completed')
  assert.ok(f.calls.every((call) => call.headers['x-request-id'] === 'progress-trace'))
  const publisher = createPublisher({
    ...options(f),
    onProgress: async () => {
      throw new Error('async observer')
    },
    onRequest: () => {
      throw new Error('request observer')
    }
  })
  t.after(() => publisher.close())
  assert.equal(
    (await publisher.deploy({ appName: 'desktop', file: f.zip, release })).status,
    'published'
  )
  assert.equal(f.publications.size, 1)
})

test('failed upload metadata produces failure progress and never reports confirmed or completed', async (t) => {
  const f = await fixture(t, {
    handle: async (call, send) => {
      if (!call.path.endsWith('/artifacts')) return false
      send({ artifactId: 'wrong', checksumSha256: 'wrong', sizeBytes: 1 })
      return true
    }
  })
  const events = []
  const publisher = createPublisher({ ...options(f), onProgress: (event) => events.push(event) })
  t.after(() => publisher.close())
  await assert.rejects(publisher.uploadArtifact('desktop', f.zip), /does not match/)
  assert.equal(events.at(-1).phase, 'failed')
  assert.ok(!events.some((event) => ['uploaded', 'completed'].includes(event.phase)))
  assert.equal(f.calls.length, 1)
})
