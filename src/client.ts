import { apiRequest } from './http'
import type {
  AdminCredentials,
  CheckPayload,
  CreatePayload,
  ErrorPayload,
  NotifyPayload,
  RequestOptions,
  SuccessPayload,
  UploadPayload,
  VersionRecord
} from './types'

export function createOtaClient(options: RequestOptions) {
  return {
    admin: {
      create: (body: AdminCredentials) => apiRequest<{ id: number; username: string }>(options, {
        method: 'POST',
        url: '/admin/create',
        data: body
      }),
      login: (body: AdminCredentials) => apiRequest<string>(options, {
        method: 'POST',
        url: '/admin/login',
        data: body
      })
    },
    notify: {
      send: (body: NotifyPayload) => apiRequest<string>(options, {
        method: 'POST',
        url: '/notify/send',
        data: body
      })
    },
    version: {
      check: (body: CheckPayload) => apiRequest<VersionRecord | null>(options, {
        method: 'POST',
        url: '/version/check',
        data: body
      }),
      create: (body: CreatePayload) => apiRequest<VersionRecord>(options, {
        method: 'POST',
        url: '/version/create',
        data: body
      }),
      success: (body: SuccessPayload) => apiRequest<Record<string, unknown>>(options, {
        method: 'POST',
        url: '/version/success',
        data: body
      }),
      error: (body: ErrorPayload) => apiRequest<Record<string, unknown>>(options, {
        method: 'POST',
        url: '/version/error',
        data: body
      })
    }
  }
}

export async function check(options: RequestOptions, body: CheckPayload) {
  return createOtaClient(options).version.check(body)
}

export async function success(options: RequestOptions, body: SuccessPayload) {
  return createOtaClient(options).version.success(body)
}

export async function error(options: RequestOptions, body: ErrorPayload) {
  return createOtaClient(options).version.error(body)
}

export type { UploadPayload }
