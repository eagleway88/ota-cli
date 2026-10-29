const { test } = require('node:test')
const assert = require('node:assert/strict')
const { writeFile } = require('node:fs/promises')
const path = require('node:path')
const { fixture } = require('../fixtures/api.cjs')
const { cli, writeConfig } = require('../fixtures/cli.cjs')

test('forced progress keeps stdout JSON and pipe logs free of terminal control characters', async (t) => {
  const f = await fixture(t)
  await writeConfig(f)
  for (const args of [
    ['release', 'list'],
    ['statistics', 'summary'],
    ['message', 'application', '--data', 'false'],
    ['app', 'check', '--platform', 'windows', '--current-version', '1.0.0']
  ]) {
    const output = await cli(f, ['--progress', 'always', ...args])
    assert.equal(output.code, 0, output.stderr)
    JSON.parse(output.stdout)
    assert.match(output.stderr, /waiting for response/)
    assert.match(output.stderr, /\[ok\]/)
    assert.doesNotMatch(output.stderr, /[\r\x1b]/)
  }
  assert.equal(f.calls.length, 4)
})

test('auto, never, CI and JSON modes do not add progress to machine output', async (t) => {
  const f = await fixture(t)
  await writeConfig(f)
  for (const [flags, env, tty] of [
    [[], {}, false],
    [['--progress', 'never'], {}, true],
    [['--progress', 'always', '--json'], {}, true],
    [[], { CI: 'true' }, true]
  ]) {
    const output = await cli(f, [...flags, 'release', 'list'], env, { tty })
    assert.equal(output.code, 0, output.stderr)
    assert.equal(output.stderr, '')
    JSON.parse(output.stdout)
  }
})

test('deploy progress shows each target, shared upload reuse and task transitions without polling spam', async (t) => {
  const counts = new Map()
  const f = await fixture(t, {
    handle: async (call, send) => {
      if (!call.path.includes('/tasks/')) return false
      const count = counts.get(call.path) ?? 0
      counts.set(call.path, count + 1)
      send({ task: { status: count < 3 ? 'running' : 'succeeded' }, latestLog: null })
      return true
    }
  })
  const target = {
    file: f.zip,
    targetVersion: '1.0.0',
    updateType: 'hot',
    releaseScope: 'public',
    userIds: []
  }
  await writeConfig(f, { targets: { windows: target, macos: target } })
  const output = await cli(f, [
    'release',
    'deploy',
    '--wait',
    '--poll-interval',
    '5',
    '--progress',
    'always'
  ])
  assert.equal(output.code, 0, output.stderr)
  const result = JSON.parse(output.stdout)
  assert.equal(result.deployments.length, 2)
  assert.match(output.stderr, /\[1\/2 windows\]/)
  assert.match(output.stderr, /\[2\/2 macos\]/)
  assert.match(output.stderr, /Upload sent; waiting for server confirmation \(100%\)/)
  assert.match(output.stderr, /Upload confirmed and verified/)
  assert.match(output.stderr, /Reusing uploaded artifact/)
  assert.match(output.stderr, /Creating draft/)
  assert.match(output.stderr, /Release published/)
  assert.equal((output.stderr.match(/Dispatch task: running/g) ?? []).length, 2)
  assert.equal((output.stderr.match(/Dispatch task: succeeded/g) ?? []).length, 2)
  assert.doesNotMatch(output.stderr, /waiting for response/)
  assert.equal(f.calls.filter((call) => call.path.endsWith('/artifacts')).length, 1)
  assert.equal(f.publications.size, 2)
  const before = f.calls.length
  const resumed = await cli(f, [
    'release',
    'deploy',
    '--target',
    'windows',
    '--resume',
    result.deployments[0].result.stateFile,
    '--progress',
    'always'
  ])
  assert.equal(resumed.code, 0, resumed.stderr)
  assert.match(resumed.stderr, /Resuming deployment from published/)
  assert.equal(f.calls.length, before)
})

test('task wait reports status and passes request ID to polling requests', async (t) => {
  const f = await fixture(t)
  await writeConfig(f)
  const output = await cli(f, [
    'task',
    'wait',
    '--id',
    'task',
    '--request-id',
    'wait-trace',
    '--progress',
    'always'
  ])
  assert.equal(output.code, 0, output.stderr)
  assert.equal(JSON.parse(output.stdout).task.status, 'succeeded')
  assert.match(output.stderr, /Waiting for dispatch task/)
  assert.match(output.stderr, /Dispatch task: succeeded/)
  assert.equal(f.calls[0].headers['x-request-id'], 'wait-trace')
})

test('TTY request animation is delayed, supports log output and clears before a structured failure', async (t) => {
  const f = await fixture(t, {
    handle: async (_call, send) => {
      await new Promise((resolve) => setTimeout(resolve, 350))
      send('Forbidden', 403)
      return true
    }
  })
  await writeConfig(f)
  const output = await cli(f, ['release', 'list'], {}, { tty: true })
  assert.equal(output.code, 1)
  assert.match(output.stderr, /\x1b\[2K/)
  assert.match(output.stderr, /\[failed\]/)
  const errorStart = output.stderr.indexOf('{\n')
  assert.ok(errorStart >= 0)
  const errorText = output.stderr.slice(errorStart)
  assert.equal(JSON.parse(errorText).status, 403)
  assert.doesNotMatch(errorText, /[\r\x1b]/)
  assert.equal(output.stdout, '')
})

test('TTY deployment hook logs are preserved and credentials stay redacted during animation', async (t) => {
  const f = await fixture(t)
  await writeFile(
    path.join(f.directory, 'ota-cli.config.ts'),
    'export default { ...' +
      JSON.stringify({
        baseURL: f.baseURL,
        appName: 'desktop',
        targets: {
          windows: {
            file: f.zip,
            targetVersion: '1.0.0',
            updateType: 'hot',
            releaseScope: 'public',
            userIds: []
          }
        }
      }) +
      ', async onPublished() { console.log("hook diagnostic " + process.env.OTA_ACCESS_KEY); await new Promise(resolve => setTimeout(resolve, 150)) } }'
  )
  const output = await cli(f, ['release', 'deploy', '--progress', 'always'], {}, { tty: true })
  assert.equal(output.code, 0, output.stderr)
  JSON.parse(output.stdout)
  assert.match(output.stderr, /hook diagnostic \[REDACTED\]/)
  assert.match(output.stderr, /\[ok\].*Completed/)
  assert.ok(!output.stderr.includes(f.accessKey))
  assert.ok(!output.stderr.includes('s'.repeat(43)))
})

test('invalid inputs and dry-run do not start network progress', async (t) => {
  const f = await fixture(t)
  await writeConfig(f, {
    targets: {
      windows: {
        file: f.zip,
        targetVersion: '1.0.0',
        updateType: 'hot',
        releaseScope: 'public',
        userIds: []
      }
    }
  })
  const invalid = await cli(f, ['release', 'list', '--page', '0', '--progress', 'always'])
  assert.equal(invalid.code, 1)
  JSON.parse(invalid.stderr)
  const dry = await cli(f, ['release', 'deploy', '--dry-run', '--progress', 'always'])
  assert.equal(dry.code, 0, dry.stderr)
  assert.equal(dry.stderr, '')
  assert.equal(JSON.parse(dry.stdout).dryRun, true)
  assert.equal(f.calls.length, 0)
})
