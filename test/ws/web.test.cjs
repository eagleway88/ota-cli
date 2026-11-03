const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createWsClient } = require('../../dist/ws.cjs')
const { FakeSocket } = require('../fixtures/socket.cjs')

test('Web subscriptions restore their loaded build version and deliver URL-free updates', async () => {
  const socket = new FakeSocket()
  const client = createWsClient({
    serverURL: 'https://example.test',
    adapter: () => socket
  })
  try {
    const updates = []
    client.onUpdate('website', (release) => updates.push(release))
    await client.subscribeApp({
      appName: 'website',
      platform: 'web',
      currentVersion: '1.3.10'
    })
    const release = {
      appName: 'website',
      platforms: ['web'],
      updateType: 'full',
      targetVersion: '1.3.11',
      releaseSequence: 1,
      enabled: true,
      mandatory: false,
      showUpdateDialog: true
    }
    socket.dispatch('app:website:update', release)
    assert.deepEqual(updates, [release])
    await client.subscribeApp({
      appName: 'website',
      platform: 'web',
      currentVersion: '1.3.11'
    })
    socket.calls.length = 0
    socket.disconnect()
    socket.connect()
    await client.ready()
    assert.deepEqual(socket.calls, [
      {
        event: 'app:subscribe',
        payload: { appName: 'website', platform: 'web', currentVersion: '1.3.11' }
      }
    ])
  } finally {
    client.disconnect()
  }
})
