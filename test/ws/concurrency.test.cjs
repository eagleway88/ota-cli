const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createWsClient } = require('../../dist/ws.cjs')
const { FakeSocket } = require('../fixtures/socket.cjs')
test('a queued subscription replacement explicitly rejects the superseded intent', async () => {
  const socket = new FakeSocket()
  const client = createWsClient({ serverURL: 'https://example.test', adapter: () => socket })
  const first = client.subscribeApp({
    appName: 'desktop',
    platform: 'windows',
    nativeVersionCode: 100
  })
  const second = client.subscribeApp({
    appName: 'desktop',
    platform: 'windows',
    nativeVersionCode: 100,
    installedReleaseSequence: 2
  })
  await assert.rejects(first, /superseded/)
  assert.deepEqual(await second, { appName: 'desktop' })
  assert.equal(socket.calls.length, 1)
  assert.equal(socket.calls[0].payload.installedReleaseSequence, 2)
  client.disconnect()
})
