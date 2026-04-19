export type Primitive = string | number | boolean | null | undefined

export interface ApiEnvelope<T> {
  code: number
  data: T
}

export interface ApiErrorPayload {
  code: number
  message: string
}

export interface RequestOptions {
  baseURL: string
  token?: string
  timeout?: number
  headers?: Record<string, string>
}

export interface AuthOptions {
  username?: string
  password?: string
  token?: string
}

export interface CliHooks {
  onSuccess?: (result: VersionRecord) => void | Promise<void>
  onError?: (error: unknown) => void | Promise<void>
}

export interface OtaCliConfig extends Partial<RequestOptions>, Partial<CreatePayload>, CliHooks {
  auth?: AuthOptions
  iosPath?: string
  androidPath?: string
  windowsPath?: string
  linuxPath?: string
  macosPath?: string
}

export interface AdminCredentials {
  username: string
  password: string
}

export interface MessageGlobalPayload {
  type: string
  data?: unknown
}

export interface MessageOtaNamePayload {
  otaName: string
  data?: unknown
}

export interface MessageUserIdPayload {
  userId: string
  data?: unknown
}

export interface MessageUniqueIdPayload {
  uniqueId: string
  data?: unknown
}

export type PlatformType = 'ios' | 'android' | 'windows' | 'linux' | 'macos'
export type UpdateType = 'full' | 'hot'
export const APP_ERROR_KINDS = ['crash', 'error'] as const
export type AppErrorKind = 'crash' | 'error'

export interface VersionRecord {
  id?: number
  ver: number
  name: string
  platform: string
  architecture?: string
  desc?: string
  fileSize?: number
  enable?: number
  mandatory?: number
  installUrl?: string
  packageUrl?: string
  channel?: string
  updateType?: UpdateType
  ip?: string
  createTime?: string
}

export interface CheckPayload {
  id?: number
  ver: number
  name: string
  platform: PlatformType
  architecture?: string
  channel?: string
}

export interface StatusPayload {
  id?: number
  ver: number
  verId: number
  name: string
  platform: PlatformType
  username?: string
  extras?: string | Record<string, unknown>
}

export interface ErrorPayload extends StatusPayload {
  message: string
}

export interface AppErrorPayload {
  name: string
  platform: PlatformType
  ver: number
  username?: string
  extras?: string | Record<string, unknown>
  kind: AppErrorKind
  message: string
  stack?: string
}

export interface CaptureAppErrorPayload extends Omit<AppErrorPayload, 'message' | 'stack' | 'kind'> {
  error: unknown
  kind?: AppErrorKind
  message?: string
  stack?: string
}

export interface SuccessPayload extends StatusPayload {}

export interface CreatePayload extends Omit<VersionRecord, 'id' | 'updateType'> {}

export interface UploadPayload extends Omit<VersionRecord, 'id' | 'packageUrl' | 'updateType' | 'fileSize'> {}
