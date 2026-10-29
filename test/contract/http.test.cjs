const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createAppClient } = require('../../dist/index.cjs')
const { createManageClient } = require('../../dist/manage.cjs')
const { capture, response } = require('../fixtures/http.cjs')
const key = 'ota_ak_12345678-1234-4123-8123-123456789abc.' + 's'.repeat(43)
test('public reports preserve JSON and reportId without body appName or key', async () => {
  const calls = []
  const app = createAppClient({
    baseURL: 'https://example.test/api/v1',
    appName: 'app-a',
    fetch: async (url, init) => {
      calls.push(capture(url, init))
      return response({ code: 0, data: { id: 1 } })
    }
  })
  const payload = {
    platform: 'windows',
    version: '1.3.10',
    releaseSequence: 1,
    reportId: '12345678-1234-4123-8123-123456789abc',
    extras: { num: 1, flag: false, nested: [null, 'x'] }
  }
  await app.reportSuccess(payload)
  await app.reportFailure({ ...payload, message: 'failed' })
  await app.captureAppError(new Error('crash'), {
    platform: 'windows',
    version: '1.3.10',
    extras: false
  })
  assert.deepEqual(JSON.parse(calls[0].body), payload)
  assert.equal(calls[0].url, 'https://example.test/api/v1/app/apps/app-a/telemetry/successes')
  assert.equal(calls[1].url, 'https://example.test/api/v1/app/apps/app-a/telemetry/failures')
  assert.equal(calls[2].url, 'https://example.test/api/v1/app/apps/app-a/telemetry/app-errors')
  assert.equal(JSON.parse(calls[2].body).extras, false)
})
test('a shared desktop ZIP needs one draft covering three platforms', async () => {
  let captured
  const app = createManageClient({
    baseURL: 'https://example.test/api/v1',
    accessKey: key,
    fetch: async (url, init) => {
      captured = capture(url, init)
      return response({ code: 0, data: { releaseId: 'r', status: 'draft' } }, 201)
    }
  }).forApp('desktop')
  const input = {
    targetVersion: '1.3.10',
    platforms: ['windows', 'macos', 'linux'],
    updateType: 'hot',
    releaseScope: 'public',
    userIds: [],
    artifactId: 'artifact-1',
    mandatory: false
  }
  await app.releases.create(input, { idempotencyKey: 'stable-operation', requestId: 'request-1' })
  assert.deepEqual(JSON.parse(captured.body), input)
  assert.equal(captured.headers.get('idempotency-key'), 'stable-operation')
  assert.equal(captured.headers.get('x-request-id'), 'request-1')
  assert.throws(() => app.releases.create({ ...input, platforms: 'windows,macos' }), /array/)
  assert.throws(() => app.releases.create({ ...input, mandatory: 1 }), /boolean/)
})
