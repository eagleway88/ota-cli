import { format } from 'node:util'
import { redact } from './redact'
import type { ProgressDisplay } from './progress'
import { DeploymentError } from '../../node/publisher'
import { OtaApiError } from '../../transport/http'

let display: ProgressDisplay | undefined
export async function withProgress<T>(progress: ProgressDisplay, handler: () => Promise<T>) {
  const previous = display
  display = progress
  try {
    return await handler()
  } finally {
    progress.close()
    display = previous
  }
}
export function result(value: unknown) {
  process.stdout.write(redact(JSON.stringify(value, null, 2)) + '\n')
}
export function progress(message: string) {
  if (display) display.log(message)
  else process.stderr.write(redact(message) + '\n')
}
export function errorResult(error: unknown) {
  const record: Record<string, unknown> = {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : 'Command failed'
  }
  const apiError =
    error instanceof OtaApiError
      ? error
      : error instanceof DeploymentError
        ? error.apiError
        : undefined
  if (apiError) {
    Object.assign(record, {
      code: apiError.code,
      status: apiError.status,
      requestId: apiError.requestId,
      kind: apiError.kind
    })
    if (apiError.status === 401) record.hint = 'API Key is invalid, expired or revoked'
    if (apiError.status === 403)
      record.hint = 'API Key lacks application access or operation permission'
  }
  if (error instanceof DeploymentError)
    Object.assign(record, {
      phase: error.state?.phase,
      deploymentId: error.state?.deploymentId,
      releaseId: error.state?.releaseId,
      artifactId: error.state?.artifact?.artifactId,
      publication: error.state?.publication,
      stateFile: error.stateFile
    })
  return JSON.parse(redact(JSON.stringify(record))) as Record<string, unknown>
}
/** Configuration callbacks must not corrupt machine-readable stdout. */
export async function withHookOutput<T>(handler: () => Promise<T>): Promise<T> {
  const original = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
    error: console.error
  }
  const redirect = (...values: unknown[]) => progress(format(...values))
  console.log = redirect
  console.info = redirect
  console.debug = redirect
  console.warn = redirect
  console.error = redirect
  try {
    return await handler()
  } finally {
    Object.assign(console, original)
  }
}
