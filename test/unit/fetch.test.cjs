const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createManageClient } = require('../../dist/manage.cjs')
const { fixture } = require('../fixtures/api.cjs')

test('Fetch deadlines include a response body that never completes', async (t) => {
  const f = await fixture(t, {
    handle: async (_call, _send, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'body-trace' })
      res.write('{"code":0,"data":')
      return true
    }
  })
  const events = []
  const client = createManageClient({
    baseURL: f.baseURL,
    accessKey: f.accessKey,
    timeout: 150,
    onRequest: (event) => events.push(event)
  })
  const started = Date.now()
  await assert.rejects(
    client.forApp('desktop').releases.list(),
    (error) =>
      error.kind === 'network' &&
      /timed out/.test(error.message) &&
      error.status === 200 &&
      error.requestId === 'body-trace'
  )
  assert.ok(Date.now() - started < 2000)
  assert.equal(f.calls.length, 1)
  assert.deepEqual(
    events.map((event) => event.phase),
    ['start', 'error']
  )
})

test('Fetch honors caller cancellation before HTTP and while reading a response', async (t) => {
  const controller = new AbortController()
  const f = await fixture(t, {
    handle: async (_call, _send, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"code":0,"data":')
      setTimeout(() => controller.abort(new Error('caller cancelled')), 20)
      return true
    }
  })
  const app = createManageClient({ baseURL: f.baseURL, accessKey: f.accessKey }).forApp('desktop')
  // Writes expose request cancellation through RequestControl.
  await assert.rejects(
    app.releases.publish('release', { signal: controller.signal }),
    /caller cancelled/
  )
  const count = f.calls.length
  await assert.rejects(
    app.releases.publish('release', { signal: controller.signal }),
    /caller cancelled/
  )
  assert.equal(f.calls.length, count)
})
