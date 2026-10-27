import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createJiti } from 'jiti'
import { platforms, type DraftInput, type Platform, type PublishResult } from '../../contracts'
import { draftKeys, knownKeys, object } from '../../contracts/validation'

/** CLI 连接设置；由当前执行目录的 ota-cli.config.* 提供。 */
export interface ConnectionConfig {
  /** 完整 API 根地址，必须包含 /api/v1；CLI 执行请求时必填。 */
  baseURL?: string
  /** 服务端已准备好的应用标识；目标可单独指定 appName。 */
  appName?: string
  /** 保存 API Key 的环境变量名称，默认 OTA_ACCESS_KEY；这里填写变量名而非 Key。 */
  accessKeyEnv?: string
  /** 普通 HTTP 请求超时，单位毫秒，默认 15000；不控制任务等待总时长。 */
  timeout?: number
  /** 单次资源上传超时，单位毫秒，默认 150000。 */
  uploadTimeout?: number
}
/** 一个已知平台的发布配置；平台由 targets 的键确定，不再填写 platforms 字段。 */
export interface ReleaseTarget extends Partial<Omit<DraftInput, 'platforms'>> {
  /** 此目标所属应用；设置后优先于根配置的 appName。 */
  appName?: string
  /** ZIP 或待压缩目录，相对配置文件目录解析；不能与 artifactId、下载 URL 同用。 */
  file?: string
}
/** CLI 配置对象；也可由配置文件默认导出的异步函数返回。 */
export interface OtaCliConfig extends ConnectionConfig {
  /** deploy 的公共发布字段，不含 platforms；目标同名字段覆盖这里的值，数组整体替换。 */
  defaults?: Partial<Omit<DraftInput, 'platforms'>>
  /** 以已知平台为键；省略 --target 时发布全部，提供时仅选择对应平台，不能定义新目标。 */
  targets?: Partial<Record<Platform, ReleaseTarget>>
  /** 远端发布成功后的回调，早于可选任务等待；回调失败只产生警告。 */
  onPublished?: (result: PublishResult) => void | Promise<void>
  /** 发布器捕获部署错误后的回调，不含配置加载等前置错误；其自身抛错不替换原错误。 */
  onError?: (error: unknown) => void | Promise<void>
}
const connectionKeys = ['baseURL', 'appName', 'accessKeyEnv', 'timeout', 'uploadTimeout']
const releaseKeys = draftKeys.filter((key) => key !== 'platforms')
export async function loadConfig(): Promise<{ config: OtaCliConfig; directory: string }> {
  const cwd = process.cwd()
  const found = ['ts', 'js', 'mjs', 'cjs']
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
  knownKeys(value, [...connectionKeys, 'defaults', 'targets', 'onPublished', 'onError'])
  if (value.defaults !== undefined) {
    object(value.defaults)
    knownKeys(value.defaults, releaseKeys)
  }
  if (value.targets !== undefined) {
    object(value.targets, 'targets')
    for (const [name, target] of Object.entries(value.targets)) {
      if (!platforms.includes(name as Platform)) throw new Error('Unknown target platform: ' + name)
      object(target, 'target')
      knownKeys(target, [...releaseKeys, 'appName', 'file'])
    }
  }
  for (const key of ['onPublished', 'onError'])
    if (value[key] !== undefined && typeof value[key] !== 'function')
      throw new Error(key + ' must be a function')
  return { config: value as OtaCliConfig, directory: path.dirname(found) }
}
