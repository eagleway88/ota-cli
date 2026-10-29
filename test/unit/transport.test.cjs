const { test } = require('node:test')
const assert = require('node:assert/strict')
const { capture, response } = require('../fixtures/http.cjs')
const { createAppClient, OtaApiError, normalizeBaseURL } = require('../../dist/index.cjs')
const { createManageClient } = require('../../dist/manage.cjs')
const key = 'ota_ak_12345678-1234-4123-8123-123456789abc.' + 's'.repeat(43)
test('canonical API base URL has one explicit version prefix', () => {
  assert.equal(
    normalizeBaseURL('https://example.test/ota/api/v1/'),
    'https://example.test/ota/api/v1'
  )
  for (const value of [
    'https://example.test',
    'https://example.test/api',
    'ftp://example.test/api/v1',
    'https://u:p@example.test/api/v1',
    'https://example.test/api/v1?q=1'
  ])
    assert.throws(() => normalizeBaseURL(value))
})
test('App and Manage requests use Fetch with isolated credentials and no automatic redirects', async () => {
  const calls = []
  const fetch = async (url, init) => {
    calls.push(capture(url, init))
    return response({ code: 0, data: null })
  }
  const app = createAppClient({ baseURL: 'https://example.test/api/v1', appName: 'app-a', fetch })
  assert.equal(app.admin, undefined)
  assert.equal(app.releases, undefined)
  assert.equal(await app.checkUpdate({ platform: 'windows', currentVersion: '1.3.10' }), null)
  assert.equal(calls[0].headers.get('Authorization'), null)
  assert.equal(calls[0].credentials, 'omit')
  assert.equal(calls[0].url, 'https://example.test/api/v1/app/apps/app-a/updates/check')
  assert.throws(
    () => createAppClient({ baseURL: 'https://example.test/api/v1', appName: 'a', accessKey: key }),
    /must not receive/
  )
  assert.throws(
    () =>
      createAppClient({
        baseURL: 'https://example.test/api/v1',
        appName: 'a',
        headers: { authorization: key }
      }),
    /overridden/
  )
  const manage = createManageClient({
    baseURL: 'https://example.test/api/v1',
    accessKey: key,
    fetch
  })
  await manage.forApp('app-b').releases.list()
  assert.equal(calls[1].headers.get('Authorization'), 'Bearer ' + key)
  assert.equal(calls[1].redirect, 'manual')
  assert.equal(calls[1].url, 'https://example.test/api/v1/manage/apps/app-b/releases')
})
test('strict inputs use numbers and exact app context', () => {
  const app = createAppClient({ baseURL: 'https://example.test/api/v1', appName: 'app-a' })
  assert.throws(
    () => app.checkUpdate({ platform: 'windows', currentVersion: '100' }),
    /display version/
  )
  assert.throws(
    () => app.checkUpdate({ platform: 'windows', currentVersion: '1.3.10', ver: 100 }),
    /Unknown/
  )
  assert.throws(
    () =>
      app.checkUpdate({ platform: 'windows', currentVersion: '1.3.10', userId: 'app-b:windows:1' }),
    /must match/
  )
})
test('HTTP failures preserve status, code and trace, redact credentials and never retry', async () => {
  let calls = 0
  const fetch = async () => {
    calls++
    return response({ code: 403, message: 'denied ' + key }, 403)
  }
  const manage = createManageClient({
    baseURL: 'https://example.test/api/v1',
    accessKey: key,
    fetch
  })
  await assert.rejects(manage.forApp('a').releases.list(), (error) => {
    assert.ok(error instanceof OtaApiError)
    assert.equal(error.status, 403)
    assert.equal(error.code, 403)
    assert.equal(error.requestId, 'trace-1')
    assert.ok(!error.message.includes(key))
    assert.ok(!error.message.includes('s'.repeat(43)))
    return true
  })
  assert.equal(calls, 1)
})
test('invalid envelopes fail closed, business errors retain their metadata', async () => {
  for (const [payload, code] of [
    [{}, -1],
    [{ code: 9, data: null }, 9]
  ]) {
    const app = createAppClient({
      baseURL: 'https://example.test/api/v1',
      appName: 'a',
      fetch: async () => response(payload)
    })
    await assert.rejects(
      app.checkUpdate({ platform: 'ios', currentVersion: '1.0.0' }),
      (error) => error.code === code && error.status === 200
    )
  }
})

test('request events exclude credentials and observers cannot change a successful response', async () => {
  const events = []
  const manage = createManageClient({
    baseURL: 'https://example.test/api/v1',
    accessKey: key,
    fetch: async (url) => {
      assert.equal(new URL(url).searchParams.get('status'), 'published')
      return response({ code: 0, data: [] })
    },
    onRequest: (event) => {
      events.push(event)
      if (event.phase === 'start') throw new Error('observer failed')
      return Promise.reject(new Error('async observer failed'))
    }
  })
  assert.deepEqual(await manage.forApp('a').releases.list({ status: 'published' }), [])
  assert.deepEqual(
    events.map((event) => event.phase),
    ['start', 'success']
  )
  assert.equal(events[0].id, events[1].id)
  assert.ok(events[1].elapsedMs >= 0)
  assert.ok(!JSON.stringify(events).includes(key))
  assert.ok(!JSON.stringify(events).includes('published'))
})

test('non-JSON responses preserve HTTP errors and successful malformed JSON is a protocol error', async () => {
  for (const status of [200, 503]) {
    const manage = createManageClient({
      baseURL: 'https://example.test/api/v1',
      accessKey: key,
      fetch: async () =>
        new Response('<html>unavailable</html>', {
          status,
          headers: { 'x-request-id': 'html-trace' }
        })
    })
    await assert.rejects(
      manage.forApp('a').releases.list(),
      (error) =>
        error.status === status &&
        error.requestId === 'html-trace' &&
        error.kind === (status === 200 ? 'protocol' : 'api')
    )
  }
})

test('network errors remain redacted and emit a terminal error event without retries', async () => {
  const events = []
  let calls = 0
  const manage = createManageClient({
    baseURL: 'https://example.test/api/v1',
    accessKey: key,
    fetch: async () => {
      calls++
      throw new Error('network ' + key)
    },
    onRequest: (event) => events.push(event)
  })
  await assert.rejects(
    manage.forApp('a').releases.list(),
    (error) =>
      error.kind === 'network' &&
      !error.message.includes(key) &&
      error.message.includes('[REDACTED]')
  )
  assert.equal(calls, 1)
  assert.deepEqual(
    events.map((event) => event.phase),
    ['start', 'error']
  )
})
