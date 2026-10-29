const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
test('ESM and CJS public entries expose only their own capabilities', async () => {
  const app = require('../../dist/index.cjs')
  assert.equal(app.createManageClient, undefined)
  assert.equal(app.createPublisher, undefined)
  for (const [entry, capability] of [
    ['index', 'createAppClient'],
    ['manage', 'createManageClient'],
    ['node', 'createPublisher'],
    ['ws', 'createWsClient']
  ]) {
    const esm = await import('../../dist/' + entry + '.js')
    const cjs = require('../../dist/' + entry + '.cjs')
    assert.equal(typeof esm[capability], 'function')
    assert.equal(typeof cjs[capability], 'function')
  }
})
test('App and Socket SDKs bundle for browsers without Node or CLI modules', async () => {
  const esbuild = createRequire(require.resolve('tsup'))('esbuild')
  for (const entry of ['src/index.ts', 'src/ws.ts']) {
    const build = await esbuild.build({
      entryPoints: [entry],
      platform: 'browser',
      format: 'esm',
      bundle: true,
      write: false,
      metafile: true,
      logLevel: 'silent'
    })
    assert.ok(build.outputFiles.length)
    assert.ok(
      Object.keys(build.metafile.inputs).every(
        (file) =>
          !file.startsWith('src/node/') &&
          !file.startsWith('src/cli/') &&
          !file.startsWith('src/manage/')
      )
    )
  }
})

test('HTTP entries and published declarations have no Axios runtime or type dependency', async () => {
  const { readdirSync, readFileSync } = require('node:fs')
  const { join } = require('node:path')
  const pkg = require('../../package.json')
  assert.equal(pkg.dependencies?.axios, undefined)
  assert.equal(pkg.peerDependencies?.axios, undefined)
  assert.equal(pkg.devDependencies?.axios, undefined)
  assert.doesNotMatch(readFileSync('pnpm-lock.yaml', 'utf8'), /^\s+axios(?:@|:)/m)
  for (const file of readdirSync('dist').filter((name) => /\.(?:js|cjs|ts|cts)$/.test(name)))
    assert.doesNotMatch(readFileSync(join('dist', file), 'utf8'), /axios/i, file)
})
