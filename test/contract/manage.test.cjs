const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createManageClient } = require('../../dist/manage.cjs')
const { createAppClient } = require('../../dist/index.cjs')
const { accessKey } = require('../fixtures/api.cjs')
function client() {
  const calls = []
  const manage = createManageClient({
    baseURL: 'https://example.test/api/v1',
    accessKey,
    adapter: async (config) => {
      calls.push(config)
      return {
        config,
        headers: {},
        status: 200,
        statusText: 'OK',
        data: { code: 0, data: { data: [], total: 0, retention: 'permanent' } }
      }
    }
  })
  return { app: manage.forApp('desktop'), calls }
}
test('every management read uses GET, correct scoped paths and preserves pagination metadata', async () => {
  const { app, calls } = client()
  const time = { from: '2026-10-01T00:00:00Z', to: '2026-10-20T00:00:00Z', pageSize: 100 }
  const routes = [
    [() => app.statistics.summary({ from: time.from, to: time.to }), '/statistics/summary'],
    [() => app.telemetry.successes({ ...time, releaseSequence: 1 }), '/telemetry/successes'],
    [() => app.telemetry.failures(time), '/telemetry/failures'],
    [() => app.telemetry.appErrors({ ...time, kind: 'crash' }), '/telemetry/app-errors'],
    [() => app.tasks.list({ ...time, status: 'running' }), '/tasks'],
    [() => app.tasks.get('task-1'), '/tasks/task-1'],
    [() => app.tasks.logs('task-1', time), '/tasks/task-1/logs'],
    [() => app.releases.delivery('release-1', time), '/releases/release-1/delivery'],
    [() => app.audit.list({ ...time, operationId: 'op' }), '/audit-logs'],
    [() => app.messages.subscriptions(), '/messages/user-id-subscriptions']
  ]
  for (const [request, suffix] of routes) {
    const response = await request()
    assert.equal(response.retention, 'permanent')
    assert.equal(calls.at(-1).method, 'get')
    assert.equal(calls.at(-1).url, 'manage/apps/desktop' + suffix)
  }
})
test('writes use formal JSON and revision checks, with no global message or administration route', async () => {
  const { app, calls } = client()
  await app.releases.update('r', { enabled: false })
  await app.releases.replaceUsers('r', ['desktop:windows:42'], 2)
  await app.releases.changeScope('r', 'allowlist', 3)
  await app.releases.enable('r')
  await app.releases.disable('r')
  await app.releases.redispatch('r')
  await app.messages.application(false)
  await app.messages.user('desktop:windows:42', { data: { nested: [null, 1] } })
  await app.messages.device('device-1', { resend: true })
  assert.equal(calls[0].method, 'patch')
  assert.deepEqual(JSON.parse(calls[1].data), {
    userIds: ['desktop:windows:42'],
    expectedRevision: 2
  })
  assert.deepEqual(JSON.parse(calls[2].data), { releaseScope: 'allowlist', expectedRevision: 3 })
  assert.deepEqual(JSON.parse(calls[6].data), { data: false })
  assert.deepEqual(JSON.parse(calls[8].data), { uniqueId: 'device-1', resend: true })
  assert.ok(calls.every((call) => call.url.startsWith('manage/apps/desktop/')))
})
test('invalid filters, partial fields and JSON are rejected before HTTP', () => {
  const { app, calls } = client()
  for (const operation of [
    () => app.releases.list({ platform: 'windows' }),
    () => app.tasks.list({ pageSize: 101 }),
    () => app.tasks.list({ status: 'unknown' }),
    () => app.tasks.logs('t', { status: 'pending' }),
    () => app.telemetry.appErrors({ kind: 'unknown' }),
    () => app.audit.list({ result: 'unknown' }),
    () => app.audit.list({ from: '2026-01-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }),
    () => app.releases.update('r', { mandatory: 1 }),
    () => app.releases.update('r', { ver: 1 }),
    () => app.messages.user('another:windows:42', { data: 1 }),
    () => app.messages.device('device', { resend: 1 }),
    () => app.messages.application(Number.NaN)
  ])
    assert.throws(operation)
  assert.equal(calls.length, 0)
  assert.throws(() => createManageClient({ baseURL: 'https://example.test/api/v1' }), /requires/)
  const appClient = createAppClient({ baseURL: 'https://example.test/api/v1', appName: 'desktop' })
  const cyclic = {}
  cyclic.self = cyclic
  for (const extras of [cyclic, { unsupported: undefined }, new Date(), Infinity])
    assert.throws(
      () =>
        appClient.reportSuccess({
          platform: 'windows',
          versionCode: 1,
          releaseSequence: 1,
          extras
        }),
      /JSON/
    )
})
