import type { ManageOptions, RequestControl, DraftInput, Draft, CatalogRelease, PublishResult, Release, Page, PageQuery, TimeQuery, TelemetryQuery, AppErrorsQuery, TaskQuery, TaskLogQuery, AuditQuery, WindowPage, ReportRecord, AppErrorRecord, StatisticsSummary, TaskRecord, TaskDetail, TaskLog, AuditRecord, Delivery, TargetedMessage, SendTargetInput, JsonValue, ReleaseScope } from '../contracts'
import { appName, draftInput, integer, text, userId } from '../contracts/validation'
import { createTransport } from '../transport/http'

export function createManageClient(options: ManageOptions) {
  const request = createTransport(options, options.accessKey)
  return {
    forApp(name: string) {
      const app = appName(name)
      const root = 'manage/apps/' + encodeURIComponent(app)
      const releases = root + '/releases'
      const id = (value: string) => { text(value, 'ID'); return encodeURIComponent(value) }
      return {
        releases: {
          list: (query: PageQuery & { status?: 'draft' | 'published' } = {}) => request<Page<CatalogRelease>>('GET', releases, undefined, query),
          get: (releaseId: string) => request<CatalogRelease>('GET', releases + '/' + id(releaseId)),
          create: (input: DraftInput, control: RequestControl & { idempotencyKey?: string } = {}) => {
            draftInput(input, app)
            if (control.idempotencyKey !== undefined) text(control.idempotencyKey, 'idempotencyKey')
            return request<Draft>('POST', releases, input, undefined, control, control.idempotencyKey ? { 'idempotency-key': control.idempotencyKey } : undefined)
          },
          update: (releaseId: string, input: Partial<DraftInput>, control?: RequestControl) => request<Draft>('PATCH', releases + '/' + id(releaseId), input, undefined, control),
          publish: (releaseId: string, control?: RequestControl) => request<PublishResult>('POST', releases + '/' + id(releaseId) + '/publish', undefined, undefined, control),
          enable: (releaseId: string, control?: RequestControl) => request<Release>('POST', releases + '/' + id(releaseId) + '/enable', undefined, undefined, control),
          disable: (releaseId: string, control?: RequestControl) => request<Release>('POST', releases + '/' + id(releaseId) + '/disable', undefined, undefined, control),
          redispatch: (releaseId: string, control?: RequestControl) => request<{ taskId: string }>('POST', releases + '/' + id(releaseId) + '/redispatch', undefined, undefined, control),
          users: (releaseId: string) => request<string[]>('GET', releases + '/' + id(releaseId) + '/users'),
          replaceUsers: (releaseId: string, userIds: string[], expectedRevision?: number, control?: RequestControl) => {
            if (!Array.isArray(userIds) || userIds.length > 5000) throw new Error('At most 5000 userIds')
            userIds.forEach(value => userId(value, app))
            if (expectedRevision !== undefined) integer(expectedRevision, 'expectedRevision', 1)
            return request<Release | Draft>('PUT', releases + '/' + id(releaseId) + '/users', { userIds, expectedRevision }, undefined, control)
          },
          changeScope: (releaseId: string, releaseScope: ReleaseScope, expectedRevision?: number, control?: RequestControl) => {
            if (!['public', 'allowlist'].includes(releaseScope)) throw new Error('Invalid releaseScope')
            if (expectedRevision !== undefined) integer(expectedRevision, 'expectedRevision', 1)
            return request<Release | Draft>('PATCH', releases + '/' + id(releaseId) + '/scope', { releaseScope, expectedRevision }, undefined, control)
          },
          delivery: (releaseId: string, query: TimeQuery = {}) => request<Delivery>('GET', releases + '/' + id(releaseId) + '/delivery', undefined, query)
        },
        statistics: { summary: (query: Omit<TelemetryQuery, 'page' | 'pageSize'> = {}) => request<StatisticsSummary>('GET', root + '/statistics/summary', undefined, query) },
        telemetry: {
          successes: (query: TelemetryQuery = {}) => request<WindowPage<ReportRecord>>('GET', root + '/telemetry/successes', undefined, query),
          failures: (query: TelemetryQuery = {}) => request<WindowPage<ReportRecord>>('GET', root + '/telemetry/failures', undefined, query),
          appErrors: (query: AppErrorsQuery = {}) => request<WindowPage<AppErrorRecord>>('GET', root + '/telemetry/app-errors', undefined, query)
        },
        tasks: {
          list: (query: TaskQuery = {}) => request<WindowPage<TaskRecord>>('GET', root + '/tasks', undefined, query),
          get: (taskId: string) => request<TaskDetail>('GET', root + '/tasks/' + id(taskId)),
          logs: (taskId: string, query: TaskLogQuery = {}) => request<WindowPage<TaskLog>>('GET', root + '/tasks/' + id(taskId) + '/logs', undefined, query)
        },
        audit: { list: (query: AuditQuery = {}) => request<WindowPage<AuditRecord>>('GET', root + '/audit-logs', undefined, query) },
        messages: {
          subscriptions: () => request<string[]>('GET', root + '/messages/user-id-subscriptions'),
          application: (data?: JsonValue, control?: RequestControl) => request<string>('POST', root + '/messages/application', { data }, undefined, control),
          user: (target: string, input: SendTargetInput = {}, control?: RequestControl) => {
            userId(target, app)
            return request<TargetedMessage & { userId: string }>('POST', root + '/messages/users', { userId: target, ...input }, undefined, control)
          },
          device: (uniqueId: string, input: SendTargetInput = {}, control?: RequestControl) => {
            text(uniqueId, 'uniqueId')
            return request<TargetedMessage & { uniqueId: string }>('POST', root + '/messages/devices', { uniqueId, ...input }, undefined, control)
          }
        }
      }
    }
  }
}
export type ManageAppClient = ReturnType<ReturnType<typeof createManageClient>['forApp']>
export type * from '../contracts'
