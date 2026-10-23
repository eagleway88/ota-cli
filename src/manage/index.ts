import type {
  ManageOptions,
  RequestControl,
  DraftInput,
  Draft,
  CatalogRelease,
  PublishResult,
  Release,
  Page,
  PageQuery,
  TimeQuery,
  TelemetryQuery,
  AppErrorsQuery,
  TaskQuery,
  TaskLogQuery,
  AuditQuery,
  WindowPage,
  ReportRecord,
  AppErrorRecord,
  StatisticsSummary,
  TaskRecord,
  TaskDetail,
  TaskLog,
  AuditRecord,
  Delivery,
  TargetedMessage,
  SendTargetInput,
  JsonValue,
  ReleaseScope
} from '../contracts'
import {
  appName,
  draftInput,
  draftPatch,
  integer,
  jsonValue,
  knownKeys,
  object,
  queryInput,
  text,
  userId
} from '../contracts/validation'
import { createTransport } from '../transport/http'

export function createManageClient(options: ManageOptions) {
  if (typeof options.accessKey !== 'string') throw new Error('Manage API requires an accessKey')
  const request = createTransport(options, options.accessKey)
  return {
    forApp(name: string) {
      const app = appName(name)
      const root = 'manage/apps/' + encodeURIComponent(app)
      const releases = root + '/releases'
      const id = (value: string) => {
        text(value, 'ID')
        return encodeURIComponent(value)
      }
      const pageFields = ['page', 'pageSize']
      const timeFields = [...pageFields, 'from', 'to']
      const get = <T>(path: string, query: object, fields: string[]) => {
        queryInput(query, fields)
        return request<T>('GET', path, undefined, query)
      }
      const sendInput = (input: SendTargetInput) => {
        object(input)
        knownKeys(input, ['data', 'resend'])
        if (input.data !== undefined) jsonValue(input.data)
        if (input.resend !== undefined && typeof input.resend !== 'boolean')
          throw new Error('resend must be boolean')
      }
      return {
        releases: {
          list: (query: PageQuery & { status?: 'draft' | 'published' } = {}) => {
            if (query.status !== undefined && !['draft', 'published'].includes(query.status))
              throw new Error('Invalid catalog status')
            return get<Page<CatalogRelease>>(releases, query, [...pageFields, 'status'])
          },
          get: (releaseId: string) =>
            request<CatalogRelease>('GET', releases + '/' + id(releaseId)),
          create: (
            input: DraftInput,
            control: RequestControl & { idempotencyKey?: string } = {}
          ) => {
            draftInput(input, app)
            if (control.idempotencyKey !== undefined) text(control.idempotencyKey, 'idempotencyKey')
            return request<Draft>(
              'POST',
              releases,
              input,
              undefined,
              control,
              control.idempotencyKey ? { 'idempotency-key': control.idempotencyKey } : undefined
            )
          },
          update: (releaseId: string, input: Partial<DraftInput>, control?: RequestControl) => {
            draftPatch(input, app)
            return request<Draft>(
              'PATCH',
              releases + '/' + id(releaseId),
              input,
              undefined,
              control
            )
          },
          publish: (releaseId: string, control?: RequestControl) =>
            request<PublishResult>(
              'POST',
              releases + '/' + id(releaseId) + '/publish',
              undefined,
              undefined,
              control
            ),
          enable: (releaseId: string, control?: RequestControl) =>
            request<Release>(
              'POST',
              releases + '/' + id(releaseId) + '/enable',
              undefined,
              undefined,
              control
            ),
          disable: (releaseId: string, control?: RequestControl) =>
            request<Release>(
              'POST',
              releases + '/' + id(releaseId) + '/disable',
              undefined,
              undefined,
              control
            ),
          redispatch: (releaseId: string, control?: RequestControl) =>
            request<{ taskId: string }>(
              'POST',
              releases + '/' + id(releaseId) + '/redispatch',
              undefined,
              undefined,
              control
            ),
          users: (releaseId: string) =>
            request<string[]>('GET', releases + '/' + id(releaseId) + '/users'),
          replaceUsers: (
            releaseId: string,
            userIds: string[],
            expectedRevision?: number,
            control?: RequestControl
          ) => {
            if (!Array.isArray(userIds) || userIds.length > 5000)
              throw new Error('At most 5000 userIds')
            userIds.forEach((value) => userId(value, app))
            if (expectedRevision !== undefined) integer(expectedRevision, 'expectedRevision', 1)
            return request<Release | Draft>(
              'PUT',
              releases + '/' + id(releaseId) + '/users',
              { userIds, expectedRevision },
              undefined,
              control
            )
          },
          changeScope: (
            releaseId: string,
            releaseScope: ReleaseScope,
            expectedRevision?: number,
            control?: RequestControl
          ) => {
            if (!['public', 'allowlist'].includes(releaseScope))
              throw new Error('Invalid releaseScope')
            if (expectedRevision !== undefined) integer(expectedRevision, 'expectedRevision', 1)
            return request<Release | Draft>(
              'PATCH',
              releases + '/' + id(releaseId) + '/scope',
              { releaseScope, expectedRevision },
              undefined,
              control
            )
          },
          delivery: (releaseId: string, query: TimeQuery = {}) =>
            get<Delivery>(releases + '/' + id(releaseId) + '/delivery', query, timeFields)
        },
        statistics: {
          summary: (query: Omit<TelemetryQuery, 'page' | 'pageSize'> = {}) =>
            get<StatisticsSummary>(root + '/statistics/summary', query, [
              'from',
              'to',
              'platform',
              'releaseSequence'
            ])
        },
        telemetry: {
          successes: (query: TelemetryQuery = {}) =>
            get<WindowPage<ReportRecord>>(root + '/telemetry/successes', query, [
              ...timeFields,
              'platform',
              'releaseSequence'
            ]),
          failures: (query: TelemetryQuery = {}) =>
            get<WindowPage<ReportRecord>>(root + '/telemetry/failures', query, [
              ...timeFields,
              'platform',
              'releaseSequence'
            ]),
          appErrors: (query: AppErrorsQuery = {}) => {
            if (query.kind !== undefined && !['crash', 'error'].includes(query.kind))
              throw new Error('Invalid error kind')
            return get<WindowPage<AppErrorRecord>>(root + '/telemetry/app-errors', query, [
              ...timeFields,
              'platform',
              'kind',
              'errorHash'
            ])
          }
        },
        tasks: {
          list: (query: TaskQuery = {}) => {
            if (
              query.status !== undefined &&
              !['pending', 'running', 'retry_wait', 'succeeded', 'failed'].includes(query.status)
            )
              throw new Error('Invalid task status')
            return get<WindowPage<TaskRecord>>(root + '/tasks', query, [
              ...timeFields,
              'status',
              'releaseId'
            ])
          },
          get: (taskId: string) => request<TaskDetail>('GET', root + '/tasks/' + id(taskId)),
          logs: (taskId: string, query: TaskLogQuery = {}) => {
            if (
              query.status !== undefined &&
              !['running', 'succeeded', 'failed', 'lease_expired'].includes(query.status)
            )
              throw new Error('Invalid task log status')
            return get<WindowPage<TaskLog>>(root + '/tasks/' + id(taskId) + '/logs', query, [
              ...timeFields,
              'status'
            ])
          }
        },
        audit: {
          list: (query: AuditQuery = {}) => {
            if (query.result !== undefined && !['succeeded', 'failed'].includes(query.result))
              throw new Error('Invalid audit result')
            return get<WindowPage<AuditRecord>>(root + '/audit-logs', query, [
              ...timeFields,
              'action',
              'result',
              'actorKeyId',
              'requestId',
              'operationId',
              'releaseId',
              'taskId'
            ])
          }
        },
        messages: {
          subscriptions: () => request<string[]>('GET', root + '/messages/user-id-subscriptions'),
          application: (data?: JsonValue, control?: RequestControl) => {
            if (data !== undefined) jsonValue(data)
            return request<string>(
              'POST',
              root + '/messages/application',
              { data },
              undefined,
              control
            )
          },
          user: (target: string, input: SendTargetInput = {}, control?: RequestControl) => {
            userId(target, app)
            sendInput(input)
            return request<TargetedMessage & { userId: string }>(
              'POST',
              root + '/messages/users',
              { userId: target, ...input },
              undefined,
              control
            )
          },
          device: (uniqueId: string, input: SendTargetInput = {}, control?: RequestControl) => {
            text(uniqueId, 'uniqueId')
            sendInput(input)
            return request<TargetedMessage & { uniqueId: string }>(
              'POST',
              root + '/messages/devices',
              { uniqueId, ...input },
              undefined,
              control
            )
          }
        }
      }
    }
  }
}
export type ManageAppClient = ReturnType<ReturnType<typeof createManageClient>['forApp']>
export type * from '../contracts'
