import { createReadStream } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import FormData from 'form-data'
import type { Artifact, DraftInput, ManageOptions, PublishResult, RequestControl, TaskDetail } from '../contracts'
import { appName, draftInput } from '../contracts/validation'
import { createManageClient } from '../manage'
import { createTransport, normalizeBaseURL } from '../transport/http'
import { prepareSource, type PreparedSource } from './source'
import { fingerprint, stateSession, type DeploymentState } from './state'

export interface PublisherOptions extends ManageOptions { uploadTimeout?: number }
export interface DeployTarget { appName: string; file?: string; release: DraftInput }
export interface DeployOptions extends RequestControl {
  stateFile?: string
  resume?: boolean
  wait?: boolean
  waitTimeout?: number
  pollInterval?: number
  onPublished?: (result: PublishResult) => void | Promise<void>
  onError?: (error: unknown) => void | Promise<void>
}
export interface DeploymentResult extends PublishResult {
  appName: string
  deploymentId: string
  artifactId?: string
  stateFile?: string
  warnings: string[]
  task?: TaskDetail
}
export class DeploymentError extends Error {
  constructor(message: string, readonly state?: DeploymentState, readonly stateFile?: string) {
    super(message); this.name = 'DeploymentError'
  }
}
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
export async function waitForTask(options: ManageOptions, app: string, taskId: string, settings: { timeout?: number; pollInterval?: number; signal?: AbortSignal } = {}): Promise<TaskDetail> {
  appName(app)
  const timeout = settings.timeout ?? 300000, interval = settings.pollInterval ?? 1000
  if (!Number.isFinite(timeout) || timeout <= 0 || !Number.isFinite(interval) || interval <= 0) throw new Error('Polling timeout and interval must be positive')
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (settings.signal?.aborted) throw new Error('Task wait aborted; release remains published')
    const request = createTransport({ ...options, timeout: Math.max(1, Math.min(options.timeout ?? 15000, deadline - Date.now())) }, options.accessKey)
    const detail = await request<TaskDetail>('GET', 'manage/apps/' + encodeURIComponent(app) + '/tasks/' + encodeURIComponent(taskId), undefined, undefined, { signal: settings.signal })
    if (detail.task.status === 'succeeded') return detail
    if (detail.task.status === 'failed') throw new Error('Dispatch task failed; release remains published: ' + taskId)
    await new Promise<void>((resolve, reject) => {
      const aborted = () => { clearTimeout(timer); reject(new Error('Task wait aborted; release remains published')) }
      const timer = setTimeout(() => { settings.signal?.removeEventListener('abort', aborted); resolve() }, Math.min(interval, Math.max(0, deadline - Date.now())))
      settings.signal?.addEventListener('abort', aborted, { once: true })
      if (settings.signal?.aborted) aborted()
    })
  }
  throw new Error('Task wait timed out; release remains published: ' + taskId)
}
export function createPublisher(options: PublisherOptions) {
  const baseURL = normalizeBaseURL(options.baseURL)
  const manage = createManageClient(options)
  const upload = createTransport({ ...options, timeout: options.uploadTimeout ?? 150000 }, options.accessKey)
  const sources = new Map<string, Promise<PreparedSource>>()
  const artifacts = new Map<string, Promise<Artifact>>()
  let closed = false
  const ensureOpen = () => { if (closed) throw new Error('Publisher is closed') }
  const prepare = async (file: string) => {
    ensureOpen()
    const canonical = await realpath(file)
    if (!sources.has(canonical)) sources.set(canonical, prepareSource(canonical))
    return sources.get(canonical)!
  }
  const validate = (target: DeployTarget) => {
    appName(target.appName)
    if (target.file && (target.release.artifactId || target.release.bundleUrl || target.release.installerSourceUrl)) throw new Error('file cannot be combined with artifactId or source URLs')
    draftInput(target.file ? { ...target.release, artifactId: 'pending-upload' } : target.release, target.appName)
  }
  const uploadPrepared = async (app: string, source: PreparedSource, control?: RequestControl) => {
    ensureOpen(); appName(app)
    const key = JSON.stringify([baseURL, app, source.checksumSha256])
    if (!artifacts.has(key)) artifacts.set(key, (async () => {
      const stream = createReadStream(source.filePath)
      const form = new FormData()
      form.append('file', stream, { filename: 'bundle.zip', contentType: 'application/zip', knownLength: source.sizeBytes })
      try {
        const result = await upload<Artifact>('POST', 'manage/apps/' + encodeURIComponent(app) + '/artifacts', form, undefined, control, form.getHeaders())
        if (!result || !result.artifactId || result.checksumSha256 !== source.checksumSha256 || Number(result.sizeBytes) !== source.sizeBytes) throw new Error('Uploaded artifact metadata does not match the local ZIP; verify server state')
        return result
      } finally { stream.destroy() }
    })())
    return artifacts.get(key)!
  }
  const api = {
    async uploadArtifact(app: string, file: string, control?: RequestControl) {
      appName(app)
      return uploadPrepared(app, await prepare(file), control)
    },
    async deploy(target: DeployTarget, settings: DeployOptions = {}): Promise<DeploymentResult> {
      ensureOpen(); validate(target)
      const source = target.file ? await prepare(target.file) : undefined
      const intentHash = fingerprint({ appName: target.appName, release: target.release }, source?.checksumSha256, sha)
      const session = await stateSession(settings.stateFile, settings.resume ?? false)
      const deploymentId = randomUUID()
      const state: DeploymentState = session.initial ?? { version: 1, deploymentId, baseURL, appName: target.appName, intentHash, startedAt: new Date().toISOString(), phase: 'prepared', idempotencyKey: deploymentId }
      const warnings: string[] = []
      try {
        if (state.baseURL !== baseURL || state.appName !== target.appName || state.intentHash !== intentHash) throw new Error('Deployment state does not match server, application, release input or file content')
        if (!/^[0-9a-f-]{36}$/.test(state.idempotencyKey) || !['prepared', 'uploading', 'uploaded', 'creating', 'draft', 'publishing', 'published'].includes(state.phase)) throw new Error('Invalid deployment state')
        if (state.phase === 'uploading' && !state.artifact) throw new Error('Upload outcome unknown; verify server state before starting a new deployment')
        if (['draft', 'publishing', 'published'].includes(state.phase) && !state.releaseId) throw new Error('Deployment state is missing releaseId')
        if (state.phase === 'published' && !state.publication) throw new Error('Deployment state is missing publication')
        if (source && state.artifact) {
          if (state.artifact.checksumSha256 !== source.checksumSha256 || Number(state.artifact.sizeBytes) !== source.sizeBytes) throw new Error('Deployment artifact does not match source content')
          artifacts.set(JSON.stringify([baseURL, target.appName, source.checksumSha256]), Promise.resolve(state.artifact))
        }
        await session.save(state)
        if (source && !state.artifact) {
          state.phase = 'uploading'; await session.save(state)
          state.artifact = await uploadPrepared(target.appName, source, settings)
          state.phase = 'uploaded'; await session.save(state)
        }
        const input = state.artifact ? { ...target.release, artifactId: state.artifact.artifactId } : target.release
        if (!state.releaseId) {
          state.phase = 'creating'; await session.save(state)
          const draft = await manage.forApp(target.appName).releases.create(input, { ...settings, idempotencyKey: state.idempotencyKey })
          state.releaseId = draft.releaseId; state.phase = 'draft'; await session.save(state)
        }
        if (!state.publication) {
          state.phase = 'publishing'; await session.save(state)
          state.publication = await manage.forApp(target.appName).releases.publish(state.releaseId, settings)
          state.phase = 'published'; await session.save(state)
          try { await settings.onPublished?.(state.publication) } catch { warnings.push('onPublished callback failed; release remains published') }
        }
        const result: DeploymentResult = { ...state.publication, appName: state.appName, deploymentId: state.deploymentId, artifactId: state.artifact?.artifactId, stateFile: settings.stateFile, warnings }
        if (settings.wait) {
          if (!result.taskId) throw new Error('Release is published but taskId is unavailable; query release delivery')
          result.task = await waitForTask(options, state.appName, result.taskId, { timeout: settings.waitTimeout, pollInterval: settings.pollInterval, signal: settings.signal })
        }
        return result
      } catch (error) {
        try { await settings.onError?.(error) } catch { /* The deployment outcome must not be replaced by a callback error. */ }
        throw new DeploymentError(error instanceof Error ? error.message : 'Deployment failed', state, settings.stateFile)
      } finally { await session.close() }
    },
    async deployMany(targets: DeployTarget[], settings: (target: DeployTarget, index: number) => DeployOptions = () => ({})) {
      ensureOpen()
      // Validate and prepare every target before the first write request.
      for (const target of targets) { validate(target); if (target.file) await prepare(target.file) }
      const results: Array<{ appName: string; result?: DeploymentResult; error?: DeploymentError }> = []
      for (const [index, target] of targets.entries()) {
        try { results.push({ appName: target.appName, result: await api.deploy(target, settings(target, index)) }) }
        catch (error) { results.push({ appName: target.appName, error: error instanceof DeploymentError ? error : new DeploymentError(error instanceof Error ? error.message : 'Deployment failed') }) }
      }
      return results
    },
    async close() {
      if (closed) return
      closed = true
      const prepared = await Promise.allSettled(sources.values())
      await Promise.all(prepared.flatMap(result => result.status === 'fulfilled' ? [result.value.cleanup()] : []))
      sources.clear(); artifacts.clear()
    }
  }
  return api
}
export async function uploadArtifact(options: PublisherOptions, app: string, file: string, control?: RequestControl) {
  const publisher = createPublisher(options)
  try { return await publisher.uploadArtifact(app, file, control) } finally { await publisher.close() }
}
