import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios'
import type { ApiEnvelope, RequestOptions } from './types'

export class OtaApiError extends Error {
  code: number
  status?: number
  details?: unknown

  constructor(message: string, code = -1, status?: number, details?: unknown) {
    super(message)
    this.name = 'OtaApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export function normalizeBaseURL(baseURL: string) {
  const trimmed = baseURL.trim().replace(/\/+$/, '')
  // return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`
  return trimmed
}

export function createHttpClient(options: RequestOptions) {
  const headers: Record<string, string> = { ...(options.headers || {}) }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`
  }

  return axios.create({
    baseURL: normalizeBaseURL(options.baseURL),
    timeout: options.timeout ?? 15000,
    headers
  })
}

export async function apiRequest<T>(
  options: RequestOptions,
  config: AxiosRequestConfig
): Promise<T> {
  const client = createHttpClient(options)

  try {
    const response = await client.request<ApiEnvelope<T>>(config)
    return unwrapEnvelope(response)
  } catch (error) {
    throw normalizeApiError(error)
  }
}

export function unwrapEnvelope<T>(response: AxiosResponse<ApiEnvelope<T>>) {
  const payload = response.data
  if (typeof payload?.code === 'number' && payload.code !== 0) {
    throw new OtaApiError('Request failed', payload.code, response.status, payload)
  }
  return payload.data
}

export function normalizeApiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    return fromAxiosError(error)
  }
  if (error instanceof Error) {
    return new OtaApiError(error.message)
  }
  return new OtaApiError('Unknown request error')
}

function fromAxiosError(error: AxiosError) {
  const responseData = error.response?.data as { code?: number; message?: string } | undefined
  const message = responseData?.message || error.message || 'Request failed'
  return new OtaApiError(
    message,
    responseData?.code ?? -1,
    error.response?.status,
    responseData
  )
}
