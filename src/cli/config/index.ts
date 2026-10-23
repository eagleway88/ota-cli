import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createJiti } from 'jiti'
import type { DraftInput, PublishResult } from '../../contracts'
import { draftKeys, knownKeys, object } from '../../contracts/validation'

export interface ConnectionConfig {
  baseURL?: string
  appName?: string
  accessKeyEnv?: string
  timeout?: number
  uploadTimeout?: number
}
export interface ReleaseTarget extends Partial<DraftInput> {
  appName?: string
  file?: string
}
export interface OtaCliConfig extends ConnectionConfig {
  defaults?: Partial<DraftInput>
  targets?: Record<string, ReleaseTarget>
  profiles?: Record<string, ConnectionConfig>
  onPublished?: (result: PublishResult) => void | Promise<void>
  onError?: (error: unknown) => void | Promise<void>
}
const connectionKeys = ['baseURL', 'appName', 'accessKeyEnv', 'timeout', 'uploadTimeout']
export async function loadConfig(
  file?: string,
  disabled = false
): Promise<{ config: OtaCliConfig; directory: string }> {
  const cwd = process.cwd()
  if (disabled) return { config: {}, directory: cwd }
  const found = file
    ? path.resolve(file)
    : ['ts', 'js', 'mjs', 'cjs']
        .map((ext) => path.join(cwd, 'ota-cli.config.' + ext))
        .find(existsSync)
  if (!found) return { config: {}, directory: cwd }
  const importer = createJiti(path.join(cwd, 'ota-cli-loader.cjs'), {
    interopDefault: true,
    moduleCache: false,
    fsCache: false
  })
  const imported: unknown = await importer.import(pathToFileURL(found).href)
  const candidate =
    imported && typeof imported === 'object' && 'default' in imported ? imported.default : imported
  const value: unknown = typeof candidate === 'function' ? await candidate() : candidate
  object(value, 'configuration')
  knownKeys(value, [...connectionKeys, 'defaults', 'targets', 'profiles', 'onPublished', 'onError'])
  if (value.defaults !== undefined) {
    object(value.defaults)
    knownKeys(value.defaults, draftKeys)
  }
  if (value.targets !== undefined) {
    object(value.targets, 'targets')
    for (const [name, target] of Object.entries(value.targets)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error('Invalid target name')
      object(target, 'target')
      knownKeys(target, [...draftKeys, 'appName', 'file'])
    }
  }
  if (value.profiles !== undefined) {
    object(value.profiles, 'profiles')
    for (const profile of Object.values(value.profiles)) {
      object(profile)
      knownKeys(profile, connectionKeys)
    }
  }
  for (const key of ['onPublished', 'onError'])
    if (value[key] !== undefined && typeof value[key] !== 'function')
      throw new Error(key + ' must be a function')
  return { config: value as OtaCliConfig, directory: path.dirname(found) }
}
