const http = require('node:http')
const { createHash, randomUUID } = require('node:crypto')
const { mkdtemp, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const accessKey = 'ota_ak_12345678-1234-4123-8123-123456789abc.' + 's'.repeat(43)
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'ota-cli-test-'))
  const zip = path.join(directory, 'bundle.zip')
  await writeFile(zip, Buffer.from('504b0304140000000000000000000000000000000000000000000000000062756e646c65', 'hex'))
  const calls = [], drafts = new Map(), publications = new Map(), idempotency = new Map()
  let lostCreate = false, lostUpload = false
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks)
      const url = new URL(req.url, 'http://localhost')
      const call = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, raw: body }
      if (req.headers['content-type']?.includes('application/json') && body.length) call.body = JSON.parse(body.toString())
      calls.push(call)
      const send = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': 'test-request' }); res.end(JSON.stringify(status < 400 ? { code: 0, data } : { code: status, message: data })) }
      if (options.handle && await options.handle(call, send, res)) return
      if (url.pathname.includes('/manage/') && req.headers.authorization !== 'Bearer ' + accessKey) { send('Unauthorized', 401); return }
      if (url.pathname.endsWith('/artifacts')) {
        const start = body.indexOf(Buffer.from('\r\n\r\n')) + 4
        const end = body.lastIndexOf(Buffer.from('\r\n--'))
        const zipBody = body.subarray(start, end)
        const artifact = { artifactId: randomUUID(), url: 'https://example.test/bundle.zip', sizeBytes: zipBody.length, checksumSha256: createHash('sha256').update(zipBody).digest('hex'), status: 'pending' }
        if (options.loseUpload && !lostUpload) { lostUpload = true; res.destroy(); return }
        send(artifact, 201); return
      }
      if (url.pathname.endsWith('/releases') && req.method === 'POST') {
        const key = req.headers['idempotency-key']
        let draft = key && idempotency.get(key)
        if (!draft) { draft = { ...call.body, releaseId: randomUUID(), releaseSequence: null, status: 'draft' }; drafts.set(draft.releaseId, draft); if (key) idempotency.set(key, draft) }
        if (options.loseCreate && !lostCreate) { lostCreate = true; res.destroy(); return }
        send(draft, 201); return
      }
      const publish = url.pathname.match(/\/releases\/([^/]+)\/publish$/)
      if (publish) {
        let publication = publications.get(publish[1])
        if (!publication) { publication = { releaseId: publish[1], releaseSequence: publications.size + 1, taskId: randomUUID(), status: 'published' }; publications.set(publish[1], publication) }
        send(publication, 201); return
      }
      if (/\/tasks\/[^/]+$/.test(url.pathname)) { send({ task: { task_id: url.pathname.split('/').at(-1), status: options.taskStatus ?? 'succeeded' }, latestLog: { metrics_complete: 1 } }); return }
      send([], 200)
    } catch { res.writeHead(500); res.end() }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  return { directory, zip, calls, drafts, publications, baseURL: 'http://127.0.0.1:' + server.address().port + '/api/v1', accessKey }
}
module.exports = { fixture, accessKey }
