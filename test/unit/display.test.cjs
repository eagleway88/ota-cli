const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createRequire, Module } = require('node:module')
const esbuild = createRequire(require.resolve('tsup'))('esbuild')
const compiled = esbuild.buildSync({
  entryPoints: ['src/cli/output/progress.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  logLevel: 'silent'
})
const implementation = new Module(__filename)
implementation._compile(compiled.outputFiles[0].text, __filename)
const { ProgressDisplay } = implementation.exports
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function output(isTTY = true, columns = 80) {
  const chunks = []
  return {
    chunks,
    stream: {
      isTTY,
      columns,
      write: (value) => {
        chunks.push(value)
        return true
      }
    }
  }
}
const request = (phase) => ({ id: 1, method: 'GET', path: 'hidden', phase, elapsedMs: 0 })

test('fast requests cancel their delayed TTY animation and leave no timer output', async () => {
  const { chunks, stream } = output()
  const display = new ProgressDisplay('auto', false, 'release list', stream, false)
  display.onRequest(request('start'))
  display.onRequest(request('success'))
  await pause(230)
  assert.equal(chunks.join(''), '')
})

test('TTY progress is width-bounded, survives diagnostic logs and stops after failure', async () => {
  const { chunks, stream } = output(true, 24)
  const display = new ProgressDisplay('always', false, 'release list', stream, false)
  display.onRequest(request('start'))
  display.log('diagnostic\n')
  await pause(120)
  display.finish(false)
  const count = chunks.length
  await pause(120)
  assert.equal(chunks.length, count)
  assert.match(chunks.join(''), /diagnostic\n/)
  assert.match(chunks.join(''), /\[failed\]/)
  for (const chunk of chunks.filter((value) => value.startsWith('\r') && !value.includes('\x1b')))
    assert.ok(chunk.length <= 24)
})

test('unknown upload totals show bytes without percentages and repeated task statuses stay quiet', () => {
  const { chunks, stream } = output(false)
  const display = new ProgressDisplay('always', false, 'artifact upload', stream, false)
  display.onProgress({ appName: 'a', phase: 'uploading', loaded: 1024 })
  display.onProgress({ appName: 'a', phase: 'upload-sent', loaded: 1024 })
  assert.match(chunks.join(''), /1.0 KiB/)
  assert.doesNotMatch(chunks.join(''), /%/)
  display.onProgress({ appName: 'a', phase: 'waiting' })
  for (let i = 0; i < 10; i++)
    display.onProgress({ appName: 'a', phase: 'task', taskStatus: 'running' })
  assert.equal((chunks.join('').match(/Dispatch task: running/g) ?? []).length, 1)
  display.close()
})
