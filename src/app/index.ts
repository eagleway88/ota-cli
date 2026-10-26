import type {
  AppOptions,
  CheckInput,
  RequestControl,
  Release,
  SuccessInput,
  FailureInput,
  AppErrorInput,
  ReportRecord,
  AppErrorRecord,
  ReportInput
} from '../contracts'
import {
  appName,
  appVersion,
  checkInput,
  integer,
  jsonValue,
  knownKeys,
  object,
  platform,
  text
} from '../contracts/validation'
import { createTransport } from '../transport/http'

export function createAppClient(options: AppOptions) {
  const app = appName(options.appName)
  const request = createTransport(options)
  const root = 'app/apps/' + encodeURIComponent(app)
  const report = (input: ReportInput, extraKeys: string[]) => {
    object(input)
    knownKeys(input, ['platform', 'version', 'reportedUsername', 'extras', ...extraKeys])
    platform(input.platform)
    appVersion(input.version, 'version')
    if (input.reportedUsername !== undefined && input.reportedUsername !== null)
      text(input.reportedUsername, 'reportedUsername')
    if (input.extras !== undefined) jsonValue(input.extras)
  }
  const status = (input: SuccessInput) => {
    integer(input.releaseSequence, 'releaseSequence', 1)
    if (
      input.reportId !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.reportId
      )
    )
      throw new Error('reportId must be a UUID')
  }
  const api = {
    checkUpdate: (input: CheckInput, control?: RequestControl) => {
      checkInput(input, app)
      return request<Release | null>('POST', root + '/updates/check', input, undefined, control)
    },
    reportSuccess: (input: SuccessInput, control?: RequestControl) => {
      report(input, ['releaseSequence', 'reportId'])
      status(input)
      return request<ReportRecord>('POST', root + '/telemetry/successes', input, undefined, control)
    },
    reportFailure: (input: FailureInput, control?: RequestControl) => {
      report(input, ['releaseSequence', 'reportId', 'message', 'recordId'])
      status(input)
      text(input.message, 'message', Number.MAX_SAFE_INTEGER)
      if (input.recordId !== undefined) integer(input.recordId, 'recordId', 1)
      return request<ReportRecord>('POST', root + '/telemetry/failures', input, undefined, control)
    },
    reportAppError: (input: AppErrorInput, control?: RequestControl) => {
      report(input, ['kind', 'message', 'stack'])
      text(input.kind, 'kind', 64)
      text(input.message, 'message', Number.MAX_SAFE_INTEGER)
      if (input.stack !== undefined && input.stack !== null && typeof input.stack !== 'string')
        throw new Error('stack must be a string')
      return request<AppErrorRecord>(
        'POST',
        root + '/telemetry/app-errors',
        input,
        undefined,
        control
      )
    },
    captureAppError: (
      error: unknown,
      context: ReportInput & { kind?: string },
      control?: RequestControl
    ) => {
      let message: string
      if (error instanceof Error) message = error.message || error.name
      else if (typeof error === 'string') message = error
      else {
        try {
          message = JSON.stringify(error) ?? String(error)
        } catch {
          message = String(error)
        }
      }
      return api.reportAppError(
        {
          ...context,
          kind: context.kind ?? 'error',
          message,
          stack: error instanceof Error ? error.stack : undefined
        },
        control
      )
    }
  }
  return api
}
export type * from '../contracts'
