const { test } = require('node:test')
const assert = require('node:assert/strict')
const axios = require('axios')
const { createAppClient, OtaApiError, normalizeBaseURL } = require('../../dist/index.cjs')
const { createManageClient } = require('../../dist/manage.cjs')
const key = 'ota_ak_12345678-1234-4123-8123-123456789abc.' + 's'.repeat(43)
const response = (config, data, status = 200) => ({ config, data, status, statusText: 'OK', headers: { 'x-request-id': 'trace-1' } })
test('canonical API base URL has one explicit version prefix', () => {
  assert.equal(normalizeBaseURL('https://example.test/ota/api/v1/'), 'https://example.test/ota/api/v1')
  for (const value of ['https://example.test', 'https://example.test/api', 'ftp://example.test/api/v1', 'https://u:p@example.test/api/v1', 'https://example.test/api/v1?q=1']) assert.throws(() => normalizeBaseURL(value))
})
test('App and Manage entry points are separate and apps never inherit global axios credentials', async t => {
  const previous = axios.defaults.headers.common.Authorization
  axios.defaults.headers.common.Authorization = 'Bearer global-secret'
  t.after(() => { if (previous === undefined) delete axios.defaults.headers.common.Authorization; else axios.defaults.headers.common.Authorization = previous })
  const calls = []
  const adapter = async config => { calls.push(config); return response(config, { code: 0, data: null }) }
  const app = createAppClient({ baseURL: 'https://example.test/api/v1', appName: 'app-a', adapter })
  assert.equal(app.admin, undefined); assert.equal(app.releases, undefined)
  assert.equal(await app.checkUpdate({ platform: 'windows', nativeVersionCode: 100 }), null)
  assert.equal(calls[0].headers.get('Authorization'), undefined)
  assert.equal(calls[0].url, 'app/apps/app-a/updates/check')
  assert.throws(() => createAppClient({ baseURL: 'https://example.test/api/v1', appName: 'a', accessKey: key }), /must not receive/)
  assert.throws(() => createAppClient({ baseURL: 'https://example.test/api/v1', appName: 'a', headers: { authorization: key } }), /overridden/)
  const manage = createManageClient({ baseURL: 'https://example.test/api/v1', accessKey: key, adapter })
  await manage.forApp('app-b').releases.list()
  assert.equal(calls[1].headers.get('Authorization'), 'Bearer ' + key)
  assert.equal(calls[1].maxRedirects, 0)
  assert.equal(calls[1].url, 'manage/apps/app-b/releases')
})
test('strict inputs use numbers and exact app context', () => {
  const app = createAppClient({ baseURL: 'https://example.test/api/v1', appName: 'app-a' })
  assert.throws(() => app.checkUpdate({ platform: 'windows', nativeVersionCode: '100' }), /integer/)
  assert.throws(() => app.checkUpdate({ platform: 'windows', nativeVersionCode: 100, ver: 100 }), /Unknown/)
  assert.throws(() => app.checkUpdate({ platform: 'windows', nativeVersionCode: 100, userId: 'app-b:windows:1' }), /must match/)
})
test('HTTP failures preserve status, code and trace, redact credentials and never retry', async () => {
  let calls = 0
  const adapter = async config => { calls++; throw new axios.AxiosError('rejected', 'ERR_BAD_REQUEST', config, undefined, response(config, { code: 403, message: 'denied ' + key }, 403)) }
  const manage = createManageClient({ baseURL: 'https://example.test/api/v1', accessKey: key, adapter })
  await assert.rejects(manage.forApp('a').releases.list(), error => {
    assert.ok(error instanceof OtaApiError)
    assert.equal(error.status, 403); assert.equal(error.code, 403); assert.equal(error.requestId, 'trace-1')
    assert.ok(!error.message.includes(key)); assert.ok(!error.message.includes('s'.repeat(43))); return true
  })
  assert.equal(calls, 1)
})
test('invalid envelopes fail closed, business errors retain their metadata', async () => {
  for (const [payload, code] of [[{}, -1], [{ code: 9, data: null }, 9]]) {
    const app = createAppClient({ baseURL: 'https://example.test/api/v1', appName: 'a', adapter: async config => response(config, payload) })
    await assert.rejects(app.checkUpdate({ platform: 'ios', nativeVersionCode: 1 }), error => error.code === code && error.status === 200)
  }
})
