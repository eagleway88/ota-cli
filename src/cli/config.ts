import { existsSync } from 'node:fs'
import path from 'node:path'
import { createJiti } from 'jiti'
import type { OtaCliConfig } from '../types'

const CONFIG_FILES = [
  'ota-cli.config.ts',
  'ota-cli.config.js',
  'ota-cli.config.mjs',
  'ota-cli.config.cjs'
]

export async function loadCliConfig(cwd = process.cwd()): Promise<OtaCliConfig> {
  const configPath = CONFIG_FILES
    .map(fileName => path.join(cwd, fileName))
    .find(filePath => existsSync(filePath))

  if (!configPath) {
    return {}
  }

  const importer = createJiti(cwd, { interopDefault: true })
  const loaded = await importer.import(configPath)
  const config = typeof loaded === 'function' ? await loaded() : loaded
  return (config?.default || config || {}) as OtaCliConfig
}
