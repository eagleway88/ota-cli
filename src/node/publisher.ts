import { createReadStream } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import FormData from 'form-data'
import { Readable, Transform } from 'node:stream'
import type {
  Artifact,
  DraftInput,
  ManageOptions,
  PublishResult,
  RequestControl,
  TaskDetail
} from '../contracts'
import { appName, draftInput, text } from '../contracts/validation'
import { createManageClient } from '../manage'
import { createTransport, normalizeBaseURL, OtaApiError } from '../transport/http'
import { prepareSource, type PreparedSource } from './source'
import { fingerprint, stateSession, type DeploymentState } from './state'
import { emit } from '../transport/events'
import type { PublisherProgressEvent, WaitOptions } from './progress'

/** Node 发布器连接设置；API Key 应由受控环境注入。 */
export interface PublisherOptions extends ManageOptions {
  /** 单次 ZIP 上传超时，单位毫秒，默认 150000；普通请求使用 timeout。 */
  uploadTimeout?: number
  /** 可选阶段和上传进度观察器；默认不输出，观察器异常不会影响发布。 */
  onProgress?: (event: PublisherProgressEvent) => void
}
/** Node SDK 的一个部署输入；CLI 会从配置中的目标生成此对象。 */
export interface DeployTarget {
  /** 资源上传、草稿和发布所属的服务端应用标识。 */
  appName: string
  /** ZIP 或待压缩目录；Node SDK 相对执行目录解析，CLI 先按配置目录解析。 */
  file?: string
  /** 完整发布内容；有 file 时上传后填入 artifactId，勿再指定资源或下载 URL。 */
  release: DraftInput
}
/** 单次部署的执行控制，与发布内容分开设置。 */
export interface DeployOptions extends RequestControl {
  /** 恢复状态文件；Node SDK 默认不写，CLI 默认保存到 .ota-cli/deployments/。 */
  stateFile?: string
  /** 从 stateFile 继续执行，默认 false；需保持服务地址、应用、发布内容及文件内容一致。 */
  resume?: boolean
  /** 发布后等待服务端分发任务成功，默认 false；不等待客户端下载安装。 */
  wait?: boolean
  /** 任务等待总时长，单位毫秒，默认 300000；超时不会撤销已完成的发布。 */
  waitTimeout?: number
  /** 查询任务状态的间隔，单位毫秒，默认 1000。 */
  pollInterval?: number
  /** 远端发布成功后调用；回调失败会加入结果 warnings。 */
  onPublished?: (result: PublishResult) => void | Promise<void>
  /** 部署失败后调用；回调异常不会覆盖原始错误。 */
  onError?: (error: unknown) => void | Promise<void>
}
/** 部署结果；published 表示远端发布已提交，客户端加载情况需另查上报。 */
export interface DeploymentResult extends PublishResult {
  /** 本次发布所属应用。 */
  appName: string
  /** 本次部署的 UUID；恢复执行会沿用保存的部署标识。 */
  deploymentId: string
  /** 通过本次文件上传或恢复状态取得的资源 ID；使用已有 URL 时可能没有。 */
  artifactId?: string
  /** 实际使用的恢复状态文件路径；未设置状态文件时省略。 */
  stateFile?: string
  /** 非致命警告，例如发布成功后的回调失败。 */
  warnings: string[]
  /** wait=true 且任务等待成功时返回的任务详情。 */
  task?: TaskDetail
}
export class DeploymentError extends Error {
  constructor(
    message: string,
    readonly state?: DeploymentState,
    readonly stateFile?: string,
    readonly apiError?: OtaApiError
  ) {
    super(message)
    this.name = 'DeploymentError'
  }
}
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
export async function waitForTask(
  options: ManageOptions,
  app: string,
  taskId: string,
  settings: WaitOptions = {}
): Promise<TaskDetail> {
  appName(app)
  text(taskId, 'taskId')
  const timeout = settings.timeout ?? 300000,
    interval = settings.pollInterval ?? 1000
  if (!Number.isFinite(timeout) || timeout <= 0 || !Number.isFinite(interval) || interval <= 0)
    throw new Error('Polling timeout and interval must be positive')
  const report = (event: Omit<PublisherProgressEvent, 'appName'>) =>
    emit(settings.onProgress, { ...event, appName: app })
  const deadline = Date.now() + timeout
  report({ phase: 'waiting' })
  try {
    while (Date.now() < deadline) {
      if (settings.signal?.aborted) throw new Error('Task wait aborted; release remains published')
      const request = createTransport(
        {
          ...options,
          timeout: Math.max(1, Math.min(options.timeout ?? 15000, deadline - Date.now()))
        },
        options.accessKey
      )
      const detail = await request<TaskDetail>(
        'GET',
        'manage/apps/' + encodeURIComponent(app) + '/tasks/' + encodeURIComponent(taskId),
        undefined,
        undefined,
        { signal: settings.signal, requestId: settings.requestId }
      )
      report({ phase: 'task', taskStatus: detail.task.status })
      if (detail.task.status === 'succeeded') {
        report({ phase: 'completed' })
        return detail
      }
      if (detail.task.status === 'failed')
        throw new Error('Dispatch task failed; release remains published: ' + taskId)
      await new Promise<void>((resolve, reject) => {
        const aborted = () => {
          clearTimeout(timer)
          settings.signal?.removeEventListener('abort', aborted)
          reject(new Error('Task wait aborted; release remains published'))
        }
        const timer = setTimeout(
          () => {
            settings.signal?.removeEventListener('abort', aborted)
            resolve()
          },
          Math.min(interval, Math.max(0, deadline - Date.now()))
        )
        settings.signal?.addEventListener('abort', aborted, { once: true })
        if (settings.signal?.aborted) aborted()
      })
    }
    throw new Error('Task wait timed out; release remains published: ' + taskId)
  } catch (error) {
    report({ phase: 'failed' })
    throw error
  }
}
export function createPublisher(options: PublisherOptions) {
  const baseURL = normalizeBaseURL(options.baseURL)
  const manage = createManageClient(options)
  const upload = createTransport(
    { ...options, timeout: options.uploadTimeout ?? 150000 },
    options.accessKey
  )
  const sources = new Map<string, Promise<PreparedSource>>()
  const artifacts = new Map<string, Promise<Artifact>>()
  const report = (event: PublisherProgressEvent) => emit(options.onProgress, event)
  let closed = false
  const ensureOpen = () => {
    if (closed) throw new Error('Publisher is closed')
  }
  type Scope = Pick<PublisherProgressEvent, 'appName' | 'target'>
  const prepare = async (file: string, scope: Scope) => {
    ensureOpen()
    const canonical = await realpath(file)
    if (!sources.has(canonical)) {
      report({ ...scope, phase: 'preparing' })
      sources.set(
        canonical,
        prepareSource(canonical, (phase) => report({ ...scope, phase })).then((source) => {
          report({ ...scope, phase: 'prepared' })
          return source
        })
      )
    }
    return sources.get(canonical)!
  }
  const validate = (target: DeployTarget) => {
    appName(target.appName)
    if (
      target.file &&
      (target.release.artifactId || target.release.bundleUrl || target.release.installerSourceUrl)
    )
      throw new Error('file cannot be combined with artifactId or source URLs')
    draftInput(
      target.file ? { ...target.release, artifactId: 'pending-upload' } : target.release,
      target.appName
    )
  }
  const uploadPrepared = async (
    app: string,
    source: PreparedSource,
    control?: RequestControl,
    scope: Scope = { appName: app }
  ) => {
    ensureOpen()
    appName(app)
    const key = JSON.stringify([baseURL, app, source.checksumSha256])
    if (artifacts.has(key)) report({ ...scope, phase: 'reused' })
    if (!artifacts.has(key))
      artifacts.set(
        key,
        (async () => {
          const stream = createReadStream(source.filePath)
          const form = new FormData()
          form.append('file', stream, {
            filename: 'bundle.zip',
            contentType: 'application/zip',
            knownLength: source.sizeBytes
          })
          let loaded = 0
          let total = 0
          const body = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              loaded += chunk.length
              report({ ...scope, phase: 'uploading', loaded, total })
              callback(null, chunk)
            },
            flush(callback) {
              report({ ...scope, phase: 'upload-sent', loaded, total })
              callback()
            }
          })
          const webBody = Readable.toWeb(body, {
            strategy: { highWaterMark: 1 }
          }) as ReadableStream<Uint8Array>
          const failed = (error: Error) => body.destroy(error)
          stream.on('error', failed)
          form.on('error', failed)
          try {
            total = await new Promise<number>((resolve, reject) =>
              form.getLength((error, length) => (error ? reject(error) : resolve(length)))
            )
            report({ ...scope, phase: 'uploading', loaded, total })
            form.pipe(body)
            const result = await upload<Artifact>(
              'POST',
              'manage/apps/' + encodeURIComponent(app) + '/artifacts',
              undefined,
              undefined,
              control,
              { ...form.getHeaders(), 'content-length': String(total) },
              webBody
            )
            if (
              !result ||
              !result.artifactId ||
              result.checksumSha256 !== source.checksumSha256 ||
              Number(result.sizeBytes) !== source.sizeBytes
            )
              throw new Error(
                'Uploaded artifact metadata does not match the local ZIP; verify server state'
              )
            report({ ...scope, phase: 'uploaded' })
            return result
          } finally {
            form.destroy()
            body.destroy()
            stream.destroy()
          }
        })()
      )
    return artifacts.get(key)!
  }
  const api = {
    async uploadArtifact(app: string, file: string, control?: RequestControl) {
      appName(app)
      try {
        const result = await uploadPrepared(app, await prepare(file, { appName: app }), control)
        report({ appName: app, phase: 'completed' })
        return result
      } catch (error) {
        report({ appName: app, phase: 'failed' })
        throw error
      }
    },
    async deploy(target: DeployTarget, settings: DeployOptions = {}): Promise<DeploymentResult> {
      ensureOpen()
      validate(target)
      const scope = { appName: target.appName, target: target.release.platforms.join(',') }
      const source = target.file ? await prepare(target.file, scope) : undefined
      const intentHash = fingerprint(
        { appName: target.appName, release: target.release },
        source?.checksumSha256,
        sha
      )
      const session = await stateSession(settings.stateFile, settings.resume ?? false)
      const deploymentId = randomUUID()
      const state: DeploymentState = session.initial ?? {
        version: 1,
        deploymentId,
        baseURL,
        appName: target.appName,
        intentHash,
        startedAt: new Date().toISOString(),
        phase: 'prepared',
        idempotencyKey: deploymentId
      }
      const warnings: string[] = []
      try {
        if (
          state.baseURL !== baseURL ||
          state.appName !== target.appName ||
          state.intentHash !== intentHash
        )
          throw new Error(
            'Deployment state does not match server, application, release input or file content'
          )
        if (
          !/^[0-9a-f-]{36}$/.test(state.idempotencyKey) ||
          ![
            'prepared',
            'uploading',
            'uploaded',
            'creating',
            'draft',
            'publishing',
            'published'
          ].includes(state.phase)
        )
          throw new Error('Invalid deployment state')
        if (state.phase === 'uploading' && !state.artifact)
          throw new Error(
            'Upload outcome unknown; verify server state before starting a new deployment'
          )
        if (['draft', 'publishing', 'published'].includes(state.phase) && !state.releaseId)
          throw new Error('Deployment state is missing releaseId')
        if (state.phase === 'published' && !state.publication)
          throw new Error('Deployment state is missing publication')
        if (
          source &&
          ['uploaded', 'creating', 'draft', 'publishing', 'published'].includes(state.phase) &&
          !state.artifact
        )
          throw new Error('Deployment state is missing artifact metadata')
        if (
          state.publication &&
          (state.publication.releaseId !== state.releaseId ||
            !Number.isInteger(state.publication.releaseSequence) ||
            state.publication.releaseSequence < 1 ||
            state.publication.status !== 'published')
        )
          throw new Error('Invalid saved publication')
        if (source && state.artifact) {
          if (
            state.artifact.checksumSha256 !== source.checksumSha256 ||
            Number(state.artifact.sizeBytes) !== source.sizeBytes
          )
            throw new Error('Deployment artifact does not match source content')
          artifacts.set(
            JSON.stringify([baseURL, target.appName, source.checksumSha256]),
            Promise.resolve(state.artifact)
          )
          report({ ...scope, phase: 'reused' })
        }
        if (settings.resume) report({ ...scope, phase: 'resuming', resumePhase: state.phase })
        await session.save(state)
        if (source && !state.artifact) {
          state.phase = 'uploading'
          await session.save(state)
          state.artifact = await uploadPrepared(target.appName, source, settings, scope)
          state.phase = 'uploaded'
          await session.save(state)
        }
        const input = state.artifact
          ? { ...target.release, artifactId: state.artifact.artifactId }
          : target.release
        if (!state.releaseId) {
          state.phase = 'creating'
          await session.save(state)
          report({ ...scope, phase: 'creating' })
          const draft = await manage
            .forApp(target.appName)
            .releases.create(input, { ...settings, idempotencyKey: state.idempotencyKey })
          state.releaseId = draft.releaseId
          state.phase = 'draft'
          await session.save(state)
          report({ ...scope, phase: 'draft' })
        }
        if (!state.publication) {
          state.phase = 'publishing'
          await session.save(state)
          report({ ...scope, phase: 'publishing' })
          state.publication = await manage
            .forApp(target.appName)
            .releases.publish(state.releaseId, settings)
          state.phase = 'published'
          await session.save(state)
          report({ ...scope, phase: 'published' })
          try {
            await settings.onPublished?.(state.publication)
          } catch {
            warnings.push('onPublished callback failed; release remains published')
          }
        }
        const result: DeploymentResult = {
          ...state.publication,
          appName: state.appName,
          deploymentId: state.deploymentId,
          artifactId: state.artifact?.artifactId,
          stateFile: settings.stateFile,
          warnings
        }
        if (settings.wait) {
          if (!result.taskId)
            throw new Error(
              'Release is published but taskId is unavailable; query release delivery'
            )
          result.task = await waitForTask(options, state.appName, result.taskId, {
            timeout: settings.waitTimeout,
            pollInterval: settings.pollInterval,
            signal: settings.signal,
            requestId: settings.requestId,
            onProgress: (event) => {
              if (event.phase !== 'completed' && event.phase !== 'failed')
                report({ ...event, ...scope })
            }
          })
        }
        report({ ...scope, phase: 'completed' })
        return result
      } catch (error) {
        report({ ...scope, phase: 'failed' })
        try {
          await settings.onError?.(error)
        } catch {
          /* The deployment outcome must not be replaced by a callback error. */
        }
        throw new DeploymentError(
          error instanceof Error ? error.message : 'Deployment failed',
          state,
          settings.stateFile,
          error instanceof OtaApiError ? error : undefined
        )
      } finally {
        await session.close()
      }
    },
    async deployMany(
      targets: DeployTarget[],
      settings: (target: DeployTarget, index: number) => DeployOptions = () => ({})
    ) {
      ensureOpen()
      // Validate and prepare every target before the first write request.
      for (const target of targets) {
        validate(target)
        if (target.file) await prepare(target.file, { appName: target.appName })
      }
      const results: Array<{
        appName: string
        result?: DeploymentResult
        error?: DeploymentError
      }> = []
      for (const [index, target] of targets.entries()) {
        report({
          phase: 'target',
          appName: target.appName,
          target: target.release.platforms.join(','),
          index: index + 1,
          count: targets.length
        })
        try {
          results.push({
            appName: target.appName,
            result: await api.deploy(target, settings(target, index))
          })
        } catch (error) {
          results.push({
            appName: target.appName,
            error:
              error instanceof DeploymentError
                ? error
                : new DeploymentError(error instanceof Error ? error.message : 'Deployment failed')
          })
        }
      }
      return results
    },
    async close() {
      if (closed) return
      closed = true
      const prepared = await Promise.allSettled(sources.values())
      await Promise.all(
        prepared.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value.cleanup()] : []
        )
      )
      sources.clear()
      artifacts.clear()
    }
  }
  return api
}
export async function uploadArtifact(
  options: PublisherOptions,
  app: string,
  file: string,
  control?: RequestControl
) {
  const publisher = createPublisher(options)
  try {
    return await publisher.uploadArtifact(app, file, control)
  } finally {
    await publisher.close()
  }
}
