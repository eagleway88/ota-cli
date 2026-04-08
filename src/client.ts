import { apiRequest } from './http'
import type {
  AdminCredentials,
  AppErrorPayload,
  CaptureAppErrorPayload,
  CheckPayload,
  CreatePayload,
  ErrorPayload,
  MessageGlobalPayload,
  MessageOtaNamePayload,
  MessageUniqueIdPayload,
  MessageUserIdPayload,
  RequestOptions,
  SuccessPayload,
  UploadPayload,
  VersionRecord
} from './types'

export function createOtaClient(options: RequestOptions) {
  const message = {
    sendGlobal: (body: MessageGlobalPayload) => apiRequest<string>(options, {
      method: 'POST',
      url: '/message/send-global',
      data: body
    }),
    sendOtaName: (body: MessageOtaNamePayload) => apiRequest<string>(options, {
      method: 'POST',
      url: '/message/send-ota-name',
      data: body
    }),
    sendUserId: (body: MessageUserIdPayload) => apiRequest<string>(options, {
      method: 'POST',
      url: '/message/send-user-id',
      data: body
    }),
    sendUniqueId: (body: MessageUniqueIdPayload) => apiRequest<string>(options, {
      method: 'POST',
      url: '/message/send-unique-id',
      data: body
    }),
    clearUserId: (body: MessageUserIdPayload) => apiRequest<string>(options, {
      method: 'POST',
      url: '/message/clear-user-id',
      data: body
    }),
    clearUniqueId: (body: MessageUniqueIdPayload) => apiRequest<string>(options, {
      method: 'POST',
      url: '/message/clear-unique-id',
      data: body
    })
  }

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
    message,
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
      }),
      appError: (body: AppErrorPayload) => apiRequest<Record<string, unknown>>(options, {
        method: 'POST',
        url: '/version/app-error',
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

export async function appError(options: RequestOptions, body: AppErrorPayload) {
  return createOtaClient(options).version.appError(body)
}

export async function captureAppError(options: RequestOptions, body: CaptureAppErrorPayload) {
  const normalizedError = normalizeUnknownAppError(body.error)

  return appError(options, {
    name: body.name,
    platform: body.platform,
    ver: body.ver,
    username: body.username,
    extras: body.extras,
    kind: body.kind ?? 'error',
    message: body.message ?? normalizedError.message,
    stack: body.stack ?? normalizedError.stack
  })
}

function normalizeUnknownAppError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || 'Unknown error',
      stack: error.stack
    }
  }

  if (typeof error === 'string') {
    return {
      message: error,
      stack: undefined
    }
  }

  return {
    message: stringifyUnknownError(error),
    stack: undefined
  }
}

function stringifyUnknownError(error: unknown) {
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export type { UploadPayload }
