const { test } = require('node:test')
const assert = require('node:assert/strict')
const { writeFile } = require('node:fs/promises')
const path = require('node:path')
const { fixture } = require('../fixtures/api.cjs')
const { cli, writeConfig } = require('../fixtures/cli.cjs')
test('real CLI exposes app-scoped statistics, telemetry, task and audit query commands', async (t) => {
  const f = await fixture(t)
  await writeConfig(f)
  const commands = [
    [
      ['statistics', 'summary', '--release-sequence', '1'],
      '/statistics/summary',
      { releaseSequence: '1' }
    ],
    [['telemetry', 'successes', '--page', '2'], '/telemetry/successes', { page: '2' }],
    [['telemetry', 'failures'], '/telemetry/failures', {}],
    [['telemetry', 'app-errors', '--kind', 'crash'], '/telemetry/app-errors', { kind: 'crash' }],
    [['task', 'list', '--status', 'running'], '/tasks', { status: 'running' }],
    [['task', 'show', '--id', 't'], '/tasks/t', {}],
    [['task', 'logs', '--id', 't', '--status', 'failed'], '/tasks/t/logs', { status: 'failed' }],
    [['release', 'delivery', '--id', 'r'], '/releases/r/delivery', {}],
    [['audit', 'list', '--operation-id', 'op'], '/audit-logs', { operationId: 'op' }],
    [['message', 'subscriptions'], '/messages/user-id-subscriptions', {}]
  ]
  for (const [args, suffix, query] of commands) {
    const output = await cli(f, ['--json', ...args])
    assert.equal(output.code, 0, output.stderr)
    JSON.parse(output.stdout)
    assert.equal(f.calls.at(-1).method, 'GET')
    assert.equal(f.calls.at(-1).path, '/api/v1/manage/apps/desktop' + suffix)
    assert.deepEqual(f.calls.at(-1).query, query)
  }
})
test('real CLI message commands retain JSON types and always require application scope', async (t) => {
  const f = await fixture(t)
  await writeConfig(f)
  for (const [args, suffix, body] of [
    [['message', 'application', '--data', 'false'], '/messages/application', { data: false }],
    [
      ['message', 'user', '--user-id', 'desktop:windows:42', '--data', '{"x":[null,1]}'],
      '/messages/users',
      { userId: 'desktop:windows:42', data: { x: [null, 1] }, resend: false }
    ],
    [
      ['message', 'device', '--unique-id', 'device-1', '--resend'],
      '/messages/devices',
      { uniqueId: 'device-1', resend: true }
    ]
  ]) {
    const output = await cli(f, args)
    assert.equal(output.code, 0, output.stderr)
    assert.equal(f.calls.at(-1).path, '/api/v1/manage/apps/desktop' + suffix)
    assert.deepEqual(f.calls.at(-1).body, body)
  }
  await writeConfig(f, { appName: undefined })
  const output = await cli(f, ['message', 'application', '--data', '1'])
  assert.equal(output.code, 1)
  assert.equal(f.calls.length, 3)
})
test('public CLI never sends an API Key, including when a key is present in the environment', async (t) => {
  const f = await fixture(t)
  await writeConfig(f)
  const check = await cli(f, [
    'app',
    'check',
    '--platform',
    'windows',
    '--current-version',
    '1.3.10'
  ])
  assert.equal(check.code, 0, check.stderr)
  const input = path.join(f.directory, 'report.json')
  await writeFile(
    input,
    JSON.stringify({ platform: 'windows', version: '1.3.10', releaseSequence: 1, extras: false })
  )
  const report = await cli(f, ['app', 'success', '--input', input], { OTA_ACCESS_KEY: '' })
  assert.equal(report.code, 0, report.stderr)
  assert.ok(f.calls.every((call) => call.headers.authorization === undefined))
  assert.equal(f.calls[1].path, '/api/v1/app/apps/desktop/telemetry/successes')
})
test('invalid options or filters fail locally', async (t) => {
  const f = await fixture(t)
  await writeConfig(f)
  for (const args of [
    ['task', 'list', '--page-size', '101'],
    ['release', 'list', '--platform', 'windows'],
    ['telemetry', 'successes', '--from', 'invalid']
  ]) {
    const output = await cli(f, args)
    assert.equal(output.code, 1)
  }
  assert.equal(f.calls.length, 0)
})
