const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createWsClient, loadSocketIoAdapter } = require('../../dist/ws.cjs')
const { FakeSocket } = require('../fixtures/socket.cjs')
function fixture(options = {}) {
  const socket = new FakeSocket()
  let received
  const client = createWsClient({
    serverURL: 'https://example.test',
    adapter: (url, config) => {
      received = { url, config }
      return socket
    },
    ...options
  })
  return { socket, client, received }
}
test('application subscription uses native context and separates updates from messages', async () => {
  const { client, socket, received } = fixture()
  assert.deepEqual(received.config.transports, ['websocket'])
  const updates = [],
    messages = []
  const off = client.onUpdate('a', (value) => updates.push(value))
  client.onApplicationMessage('a', (value) => messages.push(value))
  await client.subscribeApp({
    appName: 'a',
    platform: 'windows',
    currentVersion: '1.3.10',
    installedReleaseSequence: 2
  })
  assert.equal(socket.calls[0].event, 'app:subscribe')
  socket.dispatch('app:a:update', { releaseSequence: 3, enabled: false })
  socket.dispatch('app:a:message', { data: 'hello' })
  assert.deepEqual(updates, [{ releaseSequence: 3, enabled: false }])
  assert.equal(messages.length, 1)
  off()
  socket.dispatch('app:a:update', {})
  assert.equal(updates.length, 1)
  client.disconnect()
  assert.equal(
    [...socket.handlers.values()].reduce((n, set) => n + set.size, 0),
    0
  )
})
test('reconnection restores only current subscriptions, with the latest loaded release context', async () => {
  const { client, socket } = fixture()
  await client.subscribeApp({ appName: 'a', platform: 'windows', currentVersion: '1.3.10' })
  await client.subscribeApp({
    appName: 'a',
    platform: 'windows',
    currentVersion: '1.3.10',
    installedReleaseSequence: 2
  })
  await client.subscribeUser('a:windows:42')
  await client.subscribeDevice({ appName: 'a', uniqueId: 'device-1' })
  await client.unsubscribeUser('a:windows:42')
  socket.calls.length = 0
  socket.disconnect()
  socket.connect()
  await client.ready()
  assert.deepEqual(
    socket.calls.map((call) => call.event),
    ['app:subscribe', 'uniqueId:subscribe']
  )
  assert.equal(socket.calls[0].payload.installedReleaseSequence, 2)
  client.disconnect()
})
test('a device ID is isolated by application, including message events and acknowledgements', async () => {
  const { client, socket } = fixture()
  const a = { appName: 'a', uniqueId: 'same-device' },
    b = { appName: 'b', uniqueId: 'same-device' }
  const received = []
  client.onDeviceMessage(a, (value) => received.push(value))
  await client.subscribeDevice(a)
  await client.subscribeDevice(b)
  socket.dispatch('device:b:same-device', { messageId: 'b-message' })
  assert.equal(received.length, 0)
  socket.dispatch('device:a:same-device', { messageId: 'a-message' })
  assert.equal(received.length, 1)
  assert.equal(socket.calls.filter((call) => call.event.endsWith(':ack')).length, 0)
  await client.ackDevice({ ...a, messageId: 'a-message' })
  assert.deepEqual(socket.calls.at(-1).payload, { ...a, messageId: 'a-message' })
  await client.unsubscribeDevice(b)
  assert.throws(() => client.ackDevice({ ...b, messageId: 'b-message' }), /not subscribed/)
  client.disconnect()
})
test('server error ACKs are rejected; reconnect failures reach error handlers without unhandled rejection', async () => {
  const { client, socket } = fixture()
  socket.nextResponse = { error: 'Invalid application subscription' }
  await assert.rejects(
    client.subscribeApp({ appName: 'a', platform: 'ios', currentVersion: '1.3.10' }),
    /Invalid application/
  )
  const errors = []
  client.onError((error) => errors.push(error.message))
  socket.nextResponse = { error: 'restore rejected' }
  socket.disconnect()
  socket.connect()
  await client.ready()
  await Promise.resolve()
  assert.deepEqual(errors, ['restore rejected'])
  client.disconnect()
})
test('disconnected unsubscribe is not replayed and no duplicate initial subscriptions are sent', async () => {
  const { client, socket } = fixture({ autoConnect: false })
  await client.subscribeUser('a:windows:42')
  await client.ready()
  assert.equal(socket.calls.filter((call) => call.event === 'userId:subscribe').length, 1)
  client.suspend()
  await client.unsubscribeUser('a:windows:42')
  socket.calls.length = 0
  client.connect()
  await client.ready()
  assert.deepEqual(socket.calls, [])
  client.disconnect()
  assert.throws(() => client.connect(), /disposed/)
})
test('Socket rejects credential injection and loads only explicit adapters', async () => {
  assert.throws(() => fixture({ accessKey: 'secret' }), /must not receive/)
  assert.throws(() => fixture({ serverURL: 'https://example.test/api/v1' }), /origin/)
  await assert.rejects(
    loadSocketIoAdapter(async () => ({})),
    /Install/
  )
  const adapter = () => new FakeSocket()
  assert.equal(await loadSocketIoAdapter(async () => ({ io: adapter })), adapter)
})
