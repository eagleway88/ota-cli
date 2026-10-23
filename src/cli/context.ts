import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Command } from 'commander'
import { createManageClient } from '../manage'
import { validateAccessKey } from '../transport/http'
import type { PublisherOptions } from '../node/publisher'
import { appName, integer } from '../contracts/validation'
import { loadConfig, type ConnectionConfig, type OtaCliConfig } from './config'

export type CliOptions = Record<string, string | boolean | undefined>
export const secrets = new Set<string>()
export function redact(value: string) {
  let result = value.replace(/ota_ak_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}/g, '[REDACTED]')
  for (const secret of secrets) result = result.split(secret).join('[REDACTED]')
  return result
}
export function numberOption(value: unknown, label: string, min = 0) {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  integer(parsed, label, min)
  return parsed
}
export function booleanOption(value: string) {
  if (value !== 'true' && value !== 'false')
    throw new Error('Boolean options must be true or false')
  return value === 'true'
}
export async function jsonFile(file: string): Promise<unknown> {
  return JSON.parse(await readFile(path.resolve(file), 'utf8'))
}
export async function context(command: Command) {
  const args = command.optsWithGlobals<CliOptions>()
  const { config, directory } = await loadConfig(
    args.config as string | undefined,
    args.config === false
  )
  const profile = args.profile ? config.profiles?.[String(args.profile)] : undefined
  if (args.profile && !profile) throw new Error('Unknown profile')
  const connection: ConnectionConfig = { ...config, ...profile }
  const baseURL = String(args.baseUrl ?? process.env.OTA_BASE_URL ?? connection.baseURL ?? '')
  if (!baseURL) throw new Error('baseURL is required (--base-url or configuration)')
  const timeout =
    args.timeout !== undefined ? numberOption(args.timeout, 'timeout', 1) : connection.timeout
  const uploadTimeout =
    args.uploadTimeout !== undefined
      ? numberOption(args.uploadTimeout, 'uploadTimeout', 1)
      : connection.uploadTimeout
  const keyEnv = String(args.keyEnv ?? connection.accessKeyEnv ?? 'OTA_ACCESS_KEY')
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyEnv)) throw new Error('Invalid accessKeyEnv')
  const control = { requestId: args.requestId as string | undefined }
  const resolveApp = (fallback?: string) =>
    appName(String(args.app ?? fallback ?? connection.appName ?? ''))
  const credentials = (): PublisherOptions => {
    const accessKey = process.env[keyEnv]
    if (!accessKey) throw new Error('Missing API Key in environment variable ' + keyEnv)
    validateAccessKey(accessKey)
    secrets.add(accessKey)
    if (accessKey.includes('.')) secrets.add(accessKey.split('.')[1])
    return { baseURL, timeout, uploadTimeout, accessKey }
  }
  const manage = () => createManageClient(credentials()).forApp(resolveApp())
  return { args, config, directory, baseURL, timeout, control, resolveApp, credentials, manage }
}
export type CliContext = Awaited<ReturnType<typeof context>>
export type CliConfig = OtaCliConfig
