const capture = (url, init) => ({ ...init, url: String(url) })
const response = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'trace-1' }
  })
module.exports = { capture, response }
