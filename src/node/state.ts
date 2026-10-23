import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Artifact, DraftInput, PublishResult } from '../contracts'

export type DeploymentPhase =
  | 'prepared'
  | 'uploading'
  | 'uploaded'
  | 'creating'
  | 'draft'
  | 'publishing'
  | 'published'
export interface DeploymentState {
  version: 1
  deploymentId: string
  baseURL: string
  appName: string
  intentHash: string
  startedAt: string
  phase: DeploymentPhase
  idempotencyKey: string
  artifact?: Artifact
  releaseId?: string
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
