import type { CreatePayload, OtaCliConfig, PlatformType, VersionRecord } from '../types'
import type { VersionCreateCommandOptions, VersionUploadCommandOptions } from './options'
import { logStep, logWarn } from './logger'
import { toOptionalNumber } from './utils'

const PLATFORM_PATH_KEYS = {
  ios: 'iosPath',
  android: 'androidPath',
  windows: 'windowsPath',
  linux: 'linuxPath',
  macos: 'macosPath'
} as const

export function buildCreatePayload(options: VersionCreateCommandOptions, config: OtaCliConfig): CreatePayload {
  const payload: CreatePayload = {
    name: options.name || config.name || '',
    ver: Number(options.ver || config.ver),
    platform: options.platform || config.platform || '',
    desc: options.desc ?? config.desc,
    fileSize: toOptionalNumber(options.fileSize) ?? config.fileSize,
    enable: toOptionalNumber(options.enable) ?? config.enable,
    mandatory: toOptionalNumber(options.mandatory) ?? config.mandatory,
    installUrl: options.installUrl ?? config.installUrl,
    packageUrl: options.packageUrl ?? config.packageUrl,
    channel: options.channel ?? config.channel
  }

  if (!payload.name) {
    throw new Error('name is required. Pass --name or set config.name')
  }
  if (!Number.isFinite(payload.ver)) {
    throw new Error('ver is required. Pass --ver or set config.ver')
  }
  if (!payload.platform) {
    throw new Error('platform is required. Pass --platform or set config.platform')
  }

  return payload
}

export function resolveUploadTarget(
  options: VersionUploadCommandOptions,
  config: OtaCliConfig
): { filePath: string; payload: CreatePayload } {
  const runtimePlatform = detectRuntimePlatform()
  const payload = buildCreatePayload(options, {
    ...config,
    platform: options.platform || config.platform || runtimePlatform
  })
  const filePath = resolveUploadFilePath(options.file, payload.platform, config)
  return { filePath, payload }
}

export async function invokeSuccessHook(config: OtaCliConfig, result: VersionRecord) {
  if (!config.onSuccess) {
    return
  }

  logStep('running onSuccess callback')
  await config.onSuccess(result)
}

export async function invokeErrorHook(config: OtaCliConfig, error: unknown) {
  if (!config.onError) {
    return
  }

  try {
    logWarn('running onError callback')
    await config.onError(error)
  } catch (hookError) {
    logWarn(`onError callback failed: ${hookError instanceof Error ? hookError.message : String(hookError)}`)
  }
}

function resolveUploadFilePath(
  explicitFile: string | undefined,
  platformValue: string | undefined,
  config: OtaCliConfig
) {
  if (explicitFile) {
    return explicitFile
  }

  const candidates = parsePlatformCandidates(platformValue)
  if (!candidates.length) {
    const runtimePlatform = detectRuntimePlatform()
    if (!runtimePlatform) {
      throw new Error('unable to determine runtime platform, please pass --file or --platform')
    }
    candidates.push(runtimePlatform)
  }

  for (const platform of candidates) {
    const key = PLATFORM_PATH_KEYS[platform]
    const filePath = config[key]
    if (filePath === undefined) {
      continue
    }
    if (!filePath.trim()) {
      throw new Error(`${key} cannot be empty when defined in ota-cli.config.ts`)
    }
    logStep(`resolved upload file from config.${key}`)
    return filePath
  }

  throw new Error(
    `upload file is required. Pass --file or configure ${candidates
      .map(platform => `config.${PLATFORM_PATH_KEYS[platform]}`)
      .join(' / ')}`
  )
}

function parsePlatformCandidates(platformValue: string | undefined): PlatformType[] {
  return (platformValue || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .filter(isPlatformType)
}

function detectRuntimePlatform(): PlatformType | undefined {
  switch (process.platform) {
    case 'darwin':
      return 'macos'
    case 'win32':
      return 'windows'
    case 'linux':
      return 'linux'
    default:
      return undefined
  }
}

function isPlatformType(value: string): value is PlatformType {
  return value === 'ios' || value === 'android' || value === 'windows' || value === 'linux' || value === 'macos'
}
