const { test } = require('node:test')
const assert = require('node:assert/strict')
const { writeFile } = require('node:fs/promises')
const path = require('node:path')
const { fixture } = require('../fixtures/api.cjs')
const { cli, writeConfig } = require('../fixtures/cli.cjs')

test('CLI uses the configured connection and credential variable without environment overrides or fallback', async (t) => {
  const f = await fixture(t)
  await writeConfig(f, { appName: 'configured-app', accessKeyEnv: 'STAGING_OTA_KEY' })
  const output = await cli(f, ['release', 'list'], {
    OTA_BASE_URL: 'http://127.0.0.1:1/api/v1',
    OTA_ACCESS_KEY: '',
    STAGING_OTA_KEY: f.accessKey
  })
  assert.equal(output.code, 0, output.stderr)
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].path, '/api/v1/manage/apps/configured-app/releases')

  const missingKey = await cli(f, ['release', 'list'])
  assert.equal(missingKey.code, 1)
  assert.match(JSON.parse(missingKey.stderr).message, /STAGING_OTA_KEY/)
  assert.equal(f.calls.length, 1)
})

test('CLI requires a configured baseURL even when OTA_BASE_URL is set', async (t) => {
  const f = await fixture(t)
  const output = await cli(f, ['release', 'list'], { OTA_BASE_URL: f.baseURL })
  assert.equal(output.code, 1)
  assert.equal(JSON.parse(output.stderr).message, 'baseURL is required in ota-cli.config')
  assert.equal(f.calls.length, 0)
})

test('CLI rejects connection and configuration flags before or after subcommands', async (t) => {
  const f = await fixture(t)
  await writeConfig(f)
  for (const args of [
    ['--base-url', f.baseURL],
    ['--app', 'other-app'],
    ['--key-env', 'OTHER_KEY'],
    ['--profile', 'staging'],
    ['--config', 'other.config.ts'],
    ['--no-config'],
    ['--timeout', '1000'],
    ['--upload-timeout', '2000']
  ]) {
    for (const command of [
      [...args, 'release', 'list'],
      ['release', 'list', ...args]
    ]) {
      const output = await cli(f, command)
      assert.equal(output.code, 1)
      assert.ok(output.stderr.includes("unknown option '" + args[0] + "'"), output.stderr)
    }
  }
  assert.equal(f.calls.length, 0)
})

test('deploy uses defaults and target configuration and rejects release overrides', async (t) => {
  const f = await fixture(t)
  await writeConfig(f, {
    defaults: {
      targetVersion: '1.3.9',
      updateType: 'hot',
      releaseScope: 'public',
      userIds: [],
      mandatory: false,
      releaseNotes: 'Configured release'
    },
    targets: {
      windows: {
        appName: 'target-app',
        file: './bundle.zip',
        targetVersion: '1.3.10'
      }
    }
  })
  const command = ['release', 'deploy', '--target', 'windows', '--dry-run']
  const output = await cli(f, command, { OTA_ACCESS_KEY: '' })
  assert.equal(output.code, 0, output.stderr)
  const target = JSON.parse(output.stdout).targets[0]
  assert.equal(target.appName, 'target-app')
  assert.equal(target.file, f.zip)
  assert.equal(target.release.targetVersion, '1.3.10')
  assert.equal(target.release.updateType, 'hot')
  assert.equal(target.release.releaseNotes, 'Configured release')
  assert.deepEqual(target.release.platforms, ['windows'])
  for (const args of [
    ['--target-version', '2.0.0'],
    ['--update-type', 'full'],
    ['--release-notes', 'Override'],
    ['--installer-source-url', 'https://example.test/app.exe'],
    ['--file', f.zip]
  ]) {
    const rejected = await cli(f, [...command, ...args])
    assert.equal(rejected.code, 1)
    assert.ok(rejected.stderr.includes("unknown option '" + args[0] + "'"), rejected.stderr)
  }
  assert.equal(f.calls.length, 0)
})

test('CLI infers each known platform and preserves explicit platform selection order', async (t) => {
  const f = await fixture(t)
  const platforms = ['windows', 'macos', 'linux', 'android', 'ios']
  await writeConfig(f, {
    defaults: {
      targetVersion: '1.3.10',
      updateType: 'hot',
      releaseScope: 'public',
      userIds: [],
      architectures: ['x64', 'arm64']
    },
    targets: Object.fromEntries(platforms.map((name) => [name, { file: f.zip }]))
  })
  const all = await cli(f, ['release', 'deploy', '--dry-run'], { OTA_ACCESS_KEY: '' })
  assert.equal(all.code, 0, all.stderr)
  const targets = JSON.parse(all.stdout).targets
  assert.deepEqual(
    targets.map((target) => target.release.platforms),
    platforms.map((name) => [name])
  )
  assert.deepEqual(targets[0].release.architectures, ['x64', 'arm64'])
  const selected = await cli(f, ['release', 'deploy', '--target', 'ios,windows', '--dry-run'])
  assert.equal(selected.code, 0, selected.stderr)
  assert.deepEqual(
    JSON.parse(selected.stdout).targets.map((target) => target.release.platforms),
    [['ios'], ['windows']]
  )
  assert.equal(f.calls.length, 0)
})

test('CLI rejects unknown platform keys and duplicate platform declarations in config', async (t) => {
  const f = await fixture(t)
  for (const name of ['desktop', 'windows-stable', 'Windows']) {
    await writeConfig(f, { targets: { [name]: {} } })
    const output = await cli(f, ['release', 'deploy', '--dry-run'])
    assert.equal(output.code, 1)
    assert.equal(JSON.parse(output.stderr).message, 'Unknown target platform: ' + name)
  }
  for (const config of [
    { targets: { windows: { platforms: ['macos'] } } },
    { defaults: { platforms: ['windows'] }, targets: { windows: {} } }
  ]) {
    await writeConfig(f, config)
    const output = await cli(f, ['release', 'deploy', '--dry-run'])
    assert.equal(output.code, 1)
    assert.equal(JSON.parse(output.stderr).message, 'Unknown fields: platforms')
  }
  assert.equal(f.calls.length, 0)
})

test('CLI rejects empty, unknown, unconfigured and duplicate target selections locally', async (t) => {
  const f = await fixture(t)
  for (const config of [{}, { targets: {} }]) {
    await writeConfig(f, config)
    const output = await cli(f, ['release', 'deploy'])
    assert.equal(output.code, 1)
    assert.equal(
      JSON.parse(output.stderr).message,
      'No release targets configured in ota-cli.config'
    )
  }
  await writeConfig(f, { targets: { windows: {} } })
  for (const [selection, message] of [
    ['', 'Invalid platform'],
    ['desktop', 'Invalid platform'],
    ['macos', 'Unknown release target: macos'],
    ['windows,windows', 'Choose distinct target names']
  ]) {
    const output = await cli(f, ['release', 'deploy', '--target', selection])
    assert.equal(output.code, 1)
    assert.equal(JSON.parse(output.stderr).message, message)
  }
  assert.equal(f.calls.length, 0)
})

test('state and resume options require a single selected platform even when selection is implicit', async (t) => {
  const f = await fixture(t)
  await writeConfig(f, { targets: { windows: {}, macos: {} } })
  for (const option of ['--state', '--resume']) {
    const output = await cli(f, ['release', 'deploy', option, 'deployment.json'])
    assert.equal(output.code, 1)
    assert.equal(
      JSON.parse(output.stderr).message,
      '--state and --resume require exactly one target'
    )
  }
  assert.equal(f.calls.length, 0)
})

test('CLI discovers supported config formats and accepts async configuration factories', async (t) => {
  for (const extension of ['ts', 'js', 'mjs', 'cjs']) {
    const f = await fixture(t)
    await writeFile(
      path.join(f.directory, 'ota-cli.config.' + extension),
      (extension === 'cjs' ? 'module.exports = ' : 'export default ') +
        'async () => (' +
        JSON.stringify({ baseURL: f.baseURL, appName: 'desktop' }) +
        ')'
    )
    const output = await cli(f, ['release', 'list'])
    assert.equal(output.code, 0, output.stderr)
    assert.equal(f.calls.length, 1)
  }
})
