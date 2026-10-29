import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Command } from 'commander'
import { createManageClient } from '../manage'
import { validateAccessKey } from '../transport/http'
import type { PublisherOptions } from '../node/publisher'
import { appName, integer } from '../contracts/validation'
import { loadConfig, type OtaCliConfig } from './config'
import { secrets } from './output/redact'
import { ProgressDisplay, type ProgressMode } from './output/progress'

export type CliOptions = Record<string, string | boolean | undefined>
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
  const names: string[] = []
  for (let current: Command | null = command; current?.parent; current = current.parent)
    names.unshift(current.name())
  const progress = new ProgressDisplay(
    (args.progress ?? 'auto') as ProgressMode,
    Boolean(args.json),
    names.join(' ')
  )
  const { config, directory } = await loadConfig()
  const baseURL = String(config.baseURL ?? '')
  if (!baseURL) throw new Error('baseURL is required in ota-cli.config')
  const { timeout, uploadTimeout } = config
  const keyEnv = String(config.accessKeyEnv ?? 'OTA_ACCESS_KEY')
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyEnv)) throw new Error('Invalid accessKeyEnv')
  const control = { requestId: args.requestId as string | undefined }
  const resolveApp = (fallback?: string) => appName(String(fallback ?? config.appName ?? ''))
  const credentials = (): PublisherOptions => {
    const accessKey = process.env[keyEnv]
    if (!accessKey) throw new Error('Missing API Key in environment variable ' + keyEnv)
    validateAccessKey(accessKey)
    secrets.add(accessKey)
    if (accessKey.includes('.')) secrets.add(accessKey.split('.')[1])
    return {
      baseURL,
      timeout,
      uploadTimeout,
      accessKey,
      onRequest: progress.onRequest,
      onProgress: progress.onProgress
    }
  }
  const manage = () => createManageClient(credentials()).forApp(resolveApp())
  return {
    args,
    config,
    directory,
    baseURL,
    timeout,
    control,
    resolveApp,
    credentials,
    manage,
    progress
  }
}
export type CliContext = Awaited<ReturnType<typeof context>>
export type CliConfig = OtaCliConfig
