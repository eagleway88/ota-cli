import type { HttpOptions, RequestControl } from '../contracts'
import { emit } from './events'

let requestSequence = 0

const errorBrand = Symbol.for('@eagleway/ota-cli/OtaApiError')
export class OtaApiError extends Error {
  readonly [errorBrand] = true
  static [Symbol.hasInstance](value: unknown) {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as { [errorBrand]?: unknown })[errorBrand] === true
    )
  }
  constructor(
    message: string,
    readonly code = -1,
    readonly status?: number,
    readonly requestId?: string,
    readonly kind: 'api' | 'network' | 'protocol' = 'api'
  ) {
    super(message)
    this.name = 'OtaApiError'
  }
}
export function normalizeBaseURL(value: string) {
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid baseURL')
  const base = url.toString().replace(/\/+$/, '')
  if (!new URL(base).pathname.endsWith('/api/v1')) throw new Error('baseURL must include /api/v1')
  return base
}
export function validateAccessKey(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^ota_ak_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/.test(
      value
    )
  )
    throw new Error('Invalid accessKey')
}
export function createTransport(options: HttpOptions, accessKey?: string) {
  const baseURL = normalizeBaseURL(options.baseURL)
  if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0))
    throw new Error('timeout must be positive')
  for (const key of Object.keys(options.headers ?? {}))
    if (['authorization', 'cookie', 'proxy-authorization'].includes(key.toLowerCase()))
      throw new Error('Authentication headers cannot be overridden')
  if (accessKey !== undefined) validateAccessKey(accessKey)
  if (accessKey === undefined && 'accessKey' in options)
    throw new Error('App API must not receive an accessKey')
  const fetchRequest = options.fetch ?? globalThis.fetch
  if (typeof fetchRequest !== 'function') throw new Error('This runtime must provide fetch')
  const sanitize = (value: string) => {
    if (!accessKey) return value
    return value
      .split(accessKey)
      .join('[REDACTED]')
      .split(accessKey.split('.')[1])
      .join('[REDACTED]')
  }
  return async function request<T>(
    method: string,
    path: string,
    data?: unknown,
    query?: object,
    control: RequestControl = {},
    headers?: Record<string, string>,
    body?: ReadableStream<Uint8Array>
  ): Promise<T> {
    const id = ++requestSequence
    const started = Date.now()
    const controller = new AbortController()
    const aborted = () => controller.abort(control.signal?.reason)
    control.signal?.addEventListener('abort', aborted, { once: true })
    if (control.signal?.aborted) aborted()
    const timer = setTimeout(
      () => controller.abort(new Error('Request timed out')),
      options.timeout ?? 15000
    )
    const observe = (phase: 'start' | 'success' | 'error') =>
      emit(options.onRequest, { id, method, path, phase, elapsedMs: Date.now() - started })
    let response: Response | undefined
    observe('start')
    try {
      const url = new URL(baseURL + '/' + path)
      for (const [key, value] of Object.entries(query ?? {}))
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
      const requestHeaders = new Headers(options.headers)
      for (const [key, value] of Object.entries(headers ?? {})) requestHeaders.set(key, value)
      for (const key of ['authorization', 'cookie', 'proxy-authorization'])
        requestHeaders.delete(key)
      if (accessKey !== undefined) requestHeaders.set('authorization', 'Bearer ' + accessKey)
      if (control.requestId) requestHeaders.set('x-request-id', control.requestId)
      if (data !== undefined) requestHeaders.set('content-type', 'application/json')
      const init: RequestInit & { duplex?: 'half' } = {
        method,
        headers: requestHeaders,
        body: body ?? (data !== undefined ? JSON.stringify(data) : undefined),
        signal: controller.signal,
        redirect: 'manual',
        credentials: 'omit',
        ...(body ? { duplex: 'half' } : {})
      }
      response = await fetchRequest(url, init)
      const requestId = response.headers.get('x-request-id') ?? undefined
      const text = await response.text()
      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch {
        if (response.ok)
          throw new OtaApiError('Invalid API envelope', -1, response.status, requestId, 'protocol')
      }
      if (!response.ok) {
        const error = payload as { code?: unknown; message?: unknown } | undefined
        throw new OtaApiError(
          sanitize(
            typeof error?.message === 'string'
              ? error.message
              : 'HTTP request failed: ' + response.status
          ),
          typeof error?.code === 'number' ? error.code : -1,
          response.status,
          requestId
        )
      }
      if (
        !payload ||
        typeof payload !== 'object' ||
        !('code' in payload) ||
        !('data' in payload) ||
        typeof payload.code !== 'number'
      )
        throw new OtaApiError('Invalid API envelope', -1, response.status, requestId, 'protocol')
      if (payload.code !== 0)
        throw new OtaApiError('Request failed', payload.code, response.status, requestId)
      observe('success')
      return payload.data as T
    } catch (error) {
      observe('error')
      if (error instanceof OtaApiError) throw error
      const reason: unknown = controller.signal.aborted ? controller.signal.reason : error
      throw new OtaApiError(
        sanitize(
          reason instanceof Error
            ? reason.message
            : controller.signal.aborted
              ? 'Request aborted'
              : 'Request failed'
        ),
        -1,
        response?.status,
        response?.headers.get('x-request-id') ?? undefined,
        'network'
      )
    } finally {
      clearTimeout(timer)
      control.signal?.removeEventListener('abort', aborted)
    }
  }
}
export type Transport = ReturnType<typeof createTransport>
