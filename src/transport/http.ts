import axios, { type AxiosRequestConfig } from 'axios'
import type { HttpOptions, RequestControl } from '../contracts'

const errorBrand = Symbol.for('@eagleway/ota-cli/OtaApiError')
export class OtaApiError extends Error {
  readonly [errorBrand] = true
  static [Symbol.hasInstance](value: unknown) {
    return typeof value === 'object' && value !== null && (value as { [errorBrand]?: unknown })[errorBrand] === true
  }
  constructor(message: string, readonly code = -1, readonly status?: number, readonly requestId?: string, readonly kind: 'api' | 'network' | 'protocol' = 'api') {
    super(message)
    this.name = 'OtaApiError'
  }
}
export function normalizeBaseURL(value: string) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid baseURL')
  const base = url.toString().replace(/\/+$/, '')
  if (!new URL(base).pathname.endsWith('/api/v1')) throw new Error('baseURL must include /api/v1')
  return base
}
export function createTransport(options: HttpOptions, accessKey?: string) {
  const baseURL = normalizeBaseURL(options.baseURL)
  if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0)) throw new Error('timeout must be positive')
  for (const key of Object.keys(options.headers ?? {})) if (['authorization', 'cookie', 'proxy-authorization'].includes(key.toLowerCase())) throw new Error('Authentication headers cannot be overridden')
  if (accessKey !== undefined && !/^ota_ak_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/.test(accessKey)) throw new Error('Invalid accessKey')
  if (accessKey === undefined && 'accessKey' in options) throw new Error('App API must not receive an accessKey')
  const client = axios.create({
    baseURL: baseURL + '/', timeout: options.timeout ?? 15000,
    headers: options.headers, adapter: options.adapter, maxRedirects: 0, withCredentials: false
  })
  client.interceptors.request.use(config => {
    // Do not inherit credentials from the consumer's global axios defaults.
    config.headers.delete('Authorization'); config.headers.delete('Cookie'); config.headers.delete('Proxy-Authorization')
    if (accessKey !== undefined) config.headers.set('Authorization', 'Bearer ' + accessKey)
    return config
  })
  const sanitize = (value: string) => {
    if (!accessKey) return value
    return value.split(accessKey).join('[REDACTED]').split(accessKey.split('.')[1]).join('[REDACTED]')
  }
  return async function request<T>(method: string, path: string, data?: unknown, query?: object, control: RequestControl = {}, headers?: Record<string, string>): Promise<T> {
    try {
      const config: AxiosRequestConfig = { method, url: path, data, params: query, signal: control.signal, headers: { ...headers, ...(control.requestId ? { 'x-request-id': control.requestId } : {}) } }
      const response = await client.request<unknown>(config)
      const payload = response.data
      if (!payload || typeof payload !== 'object' || !('code' in payload) || !('data' in payload) || typeof payload.code !== 'number') throw new OtaApiError('Invalid API envelope', -1, response.status, response.headers['x-request-id'] as string | undefined, 'protocol')
      if (payload.code !== 0) throw new OtaApiError('Request failed', payload.code, response.status, response.headers['x-request-id'] as string | undefined)
      return payload.data as T
    } catch (error) {
      if (error instanceof OtaApiError) throw error
      if (axios.isAxiosError(error)) {
        const payload = error.response?.data as { code?: unknown; message?: unknown } | undefined
        throw new OtaApiError(sanitize(typeof payload?.message === 'string' ? payload.message : error.message), typeof payload?.code === 'number' ? payload.code : -1, error.response?.status, error.response?.headers['x-request-id'] as string | undefined, error.response ? 'api' : 'network')
      }
      throw new OtaApiError(sanitize(error instanceof Error ? error.message : 'Request failed'), -1, undefined, undefined, 'network')
    }
  }
}
export type Transport = ReturnType<typeof createTransport>
