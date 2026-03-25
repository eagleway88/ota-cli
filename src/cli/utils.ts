import type { AuthOptions, OtaCliConfig, RequestOptions } from '../types'
import type { GlobalCliOptions } from './options'

export interface ResolvedCliOptions extends RequestOptions {
  username?: string
  password?: string
}

export function parseJsonInput<T>(value: string | undefined, fallback: T): T {
  if (!value) {
    return fallback
  }

  return JSON.parse(value) as T
}

export function toOptionalNumber(value: string | undefined) {
  if (value === undefined) {
    return undefined
  }
  return Number(value)
}

export function resolveCliOptions(
  input: GlobalCliOptions,
  config: OtaCliConfig
): ResolvedCliOptions {
  const auth = config.auth || {}
  const timeout = input.timeout ? Number(input.timeout) : config.timeout
  const headers = input.headers ? parseJsonInput<Record<string, string>>(input.headers, {}) : (config.headers || {})
  const baseURL = input.baseUrl || config.baseURL

  if (!baseURL) {
    throw new Error('baseURL is required. Pass --base-url or create ota-cli.config.ts')
  }

  return {
    baseURL,
    token: input.token || auth.token,
    timeout,
    headers,
    username: input.authUsername || auth.username,
    password: input.authPassword || auth.password
  }
}

export function requireCredentials(auth: AuthOptions) {
  if (!auth.username || !auth.password) {
    throw new Error('username and password are required when token is not provided')
  }
}

export function stringifyOutput(data: unknown) {
  return JSON.stringify(data, null, 2)
}

export function maskToken(token: string) {
  if (token.length <= 10) {
    return `${token.slice(0, 3)}***`
  }

  return `${token.slice(0, 6)}...${token.slice(-4)}`
}
