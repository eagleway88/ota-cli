import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Artifact, DraftInput, PublishResult } from '../contracts'

/** 部署已记录的阶段；uploading 且无资源元数据表示上传结果未知。 */
export type DeploymentPhase =
  | 'prepared'
  | 'uploading'
  | 'uploaded'
  | 'creating'
  | 'draft'
  | 'publishing'
  | 'published'
/** 可恢复的部署状态；不包含 API Key，恢复时会校验输入指纹。 */
export interface DeploymentState {
  /** 状态文件格式版本。 */
  version: 1
  /** 首次部署生成的 UUID。 */
  deploymentId: string
  /** 标准化后的 API 根地址，用于防止恢复到其他服务。 */
  baseURL: string
  /** 原部署所属应用。 */
  appName: string
  /** 应用、发布字段及源 ZIP 内容的指纹；不是客户端版本号。 */
  intentHash: string
  /** 首次部署开始时间。 */
  startedAt: string
  /** 最近一次保存的部署阶段。 */
  phase: DeploymentPhase
  /** 草稿创建使用的幂等键；恢复时沿用，避免重复创建草稿。 */
  idempotencyKey: string
  /** 已确认上传成功的资源元数据。 */
  artifact?: Artifact
  /** 已创建的草稿或发布 ID；恢复发布时复用。 */
  releaseId?: string
  /** 已确认提交成功的发布结果。 */
  publication?: PublishResult
}
export function fingerprint(
  input: { appName: string; release: DraftInput },
  checksum: string | undefined,
  hash: (value: string) => string
) {
  // Stable canonical JSON, including nested audience ordering. No credentials are accepted.
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, v]) => v !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, stable(item)])
          )
        : value
  return hash(JSON.stringify(stable({ ...input, checksum })))
}
export async function stateSession(file: string | undefined, resume: boolean) {
  if (!file) {
    if (resume) throw new Error('resume requires a stateFile')
    return {
      initial: undefined as DeploymentState | undefined,
      save: async (_state: DeploymentState) => {},
      close: async () => {}
    }
  }
  const target = path.resolve(file)
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  const lockPath = target + '.lock'
  const lock = await open(lockPath, 'wx', 0o600).catch(() => {
    throw new Error(
      'Deployment state is locked; verify no process is running before removing its .lock file'
    )
  })
  try {
    let initial: DeploymentState | undefined
    if (resume) {
      const parsed: unknown = JSON.parse(await readFile(target, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || (parsed as DeploymentState).version !== 1)
        throw new Error('Invalid deployment state')
      initial = parsed as DeploymentState
    } else {
      const handle = await open(target, 'wx', 0o600)
      await handle.close()
    }
    return {
      initial,
      async save(state: DeploymentState) {
        const temporary = target + '.' + randomUUID() + '.tmp'
        try {
          const handle = await open(temporary, 'wx', 0o600)
          try {
            await handle.writeFile(JSON.stringify(state, null, 2))
            await handle.sync()
          } finally {
            await handle.close()
          }
          await rename(temporary, target)
        } finally {
          await rm(temporary, { force: true })
        }
      },
      async close() {
        await lock.close()
        await rm(lockPath, { force: true })
      }
    }
  } catch (error) {
    await lock.close()
    await rm(lockPath, { force: true })
    throw error
  }
}
