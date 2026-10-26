const test = require('node:test')
const assert = require('node:assert/strict')
const { isAppVersion, compareVersions, createAppClient } = require('../../dist/index.cjs')
test('display versions compare numeric components, including multi-digit and large components', () => {
  for (const [a, b] of [
    ['1.3.10', '1.3.9'],
    ['1.10.0', '1.9.99'],
    ['2.0.0', '1.99.99'],
    ['9007199254740993.0.0', '9007199254740992.0.0']
  ]) {
    assert.equal(compareVersions(a, b), 1)
    assert.equal(compareVersions(b, a), -1)
  }
  assert.equal(compareVersions('1.3.10', '1.3.10'), 0)
  for (const value of [
    68,
    '68',
    '1.03.10',
    '1.3',
    '1.3.10-beta',
    '1.3.10 ',
    null,
    '9'.repeat(129) + '.0.0'
  ]) {
    assert.equal(isAppVersion(value), false)
    assert.throws(() => compareVersions(value, '1.3.10'), /version/)
  }
})
test('HTTP check and telemetry reject non-display versions before sending requests', () => {
  const client = createAppClient({ baseURL: 'https://example.test/api/v1', appName: 'app' })
  for (const value of [68, '68', '1.03.10']) {
    assert.throws(
      () => client.checkUpdate({ platform: 'ios', currentVersion: value }),
      /display version/
    )
    assert.throws(
      () => client.reportSuccess({ platform: 'ios', version: value, releaseSequence: 1 }),
      /display version/
    )
  }
})
