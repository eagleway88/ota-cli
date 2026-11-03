const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createAppClient } = require('../../dist/index.cjs')
const { createManageClient } = require('../../dist/manage.cjs')
const { capture, response } = require('../fixtures/http.cjs')
const key = 'ota_ak_12345678-1234-4123-8123-123456789abc.' + 's'.repeat(43)
const draft = {
  targetVersion: '1.3.11',
  platforms: ['web'],
  updateType: 'full',
  releaseScope: 'public',
  userIds: [],
  mandatory: false,
  showUpdateDialog: true
}

test('Web full drafts need no resource and preserve explicit source URLs', async () => {
  const calls = []
  const app = createManageClient({
    baseURL: 'https://example.test/api/v1',
    accessKey: key,
    fetch: async (url, init) => {
      calls.push(capture(url, init))
      return response({ code: 0, data: { ...JSON.parse(init.body), releaseId: 'web-draft' } })
    }
  }).forApp('website')
  await app.releases.create(draft)
  assert.deepEqual(JSON.parse(calls[0].body), draft)
  const withUrl = { ...draft, installerSourceUrl: 'https://example.test/website' }
  await app.releases.create(withUrl)
  assert.deepEqual(JSON.parse(calls[1].body), withUrl)
  for (const input of [
    ...['ios', 'android', 'windows', 'linux', 'macos'].map((platform) => ({
      ...draft,
      platforms: [platform]
    })),
    { ...draft, platforms: ['web', 'windows'] },
    { ...draft, platforms: ['windows', 'web'] },
    { ...draft, platforms: [] },
    { ...draft, updateType: 'hot' }
  ]) {
    assert.throws(() => app.releases.create(input), /artifact|nonempty/)
  }
  assert.throws(
    () => app.releases.create({ ...draft, installerSourceUrl: 'file:///website' }),
    /Invalid installerSourceUrl/
  )
  assert.equal(calls.length, 2)
  await app.releases.create({
    ...draft,
    updateType: 'hot',
    bundleUrl: 'https://example.test/bundle.zip'
  })
  assert.equal(calls.length, 3)
})

test('Web checks, reports, user IDs and statistics accept the same platform', async () => {
  const calls = []
  const options = {
    baseURL: 'https://example.test/api/v1',
    fetch: async (url, init) => {
      calls.push(capture(url, init))
      return response({ code: 0, data: null })
    }
  }
  const app = createAppClient({ ...options, appName: 'website' })
  const input = {
    platform: 'web',
    currentVersion: '1.3.10',
    userId: 'website:web:42'
  }
  await app.checkUpdate(input)
  assert.deepEqual(JSON.parse(calls[0].body), input)
  await app.reportSuccess({ platform: 'web', version: '1.3.11', releaseSequence: 1 })
  assert.equal(JSON.parse(calls[1].body).platform, 'web')
  await createManageClient({ ...options, accessKey: key })
    .forApp('website')
    .statistics.summary({ platform: 'web' })
  assert.equal(new URL(calls[2].url).searchParams.get('platform'), 'web')
  assert.throws(
    () => app.checkUpdate({ ...input, userId: 'website:windows:42' }),
    /userId must match/
  )
  assert.equal(calls.length, 3)
})
