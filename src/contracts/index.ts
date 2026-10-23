import type { AxiosAdapter } from 'axios'

export const platforms = ['ios', 'android', 'windows', 'linux', 'macos'] as const
export type Platform = (typeof platforms)[number]
export type UpdateType = 'hot' | 'full'
export type ReleaseScope = 'public' | 'allowlist'
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }
export interface HttpOptions {
  /** Complete API root, e.g. https://ota.example.com/api/v1 */
  baseURL: string
  timeout?: number
  headers?: Record<string, string>
  adapter?: AxiosAdapter
}
export interface RequestControl {
  signal?: AbortSignal
  requestId?: string
}
export interface AppOptions extends HttpOptions {
  appName: string
}
export interface ManageOptions extends HttpOptions {
  accessKey: string
}
export interface CheckInput {
  platform: Platform
  nativeVersionCode: number
  installedReleaseSequence?: number
  architecture?: string
  distributionChannel?: string
  userId?: string
}
export interface ReportInput {
  platform: Platform
  versionCode: number
  reportedUsername?: string | null
  extras?: JsonValue
}
export interface SuccessInput extends ReportInput {
  releaseSequence: number
  reportId?: string
}
export interface FailureInput extends SuccessInput {
  message: string
  recordId?: number
}
export interface AppErrorInput extends ReportInput {
  kind: string
  message: string
  stack?: string | null
}
export interface ReportRecord extends ReportInput {
  id: number
  appName: string
  releaseSequence: number
  reportId?: string | null
  message?: string
  sourceIp?: string
  createdAt: string
  updatedAt?: string
}
export interface AppErrorRecord extends AppErrorInput {
  id: number
  appName: string
  errorHash: string
  reportCount: number
  firstSeenAt: string
  lastSeenAt: string
}
export interface DraftInput {
  targetVersionCode: number
  baseVersionCodes: number[]
  platforms: Platform[]
  architectures?: string[]
  distributionChannel?: string
  updateType: UpdateType
  releaseScope: ReleaseScope
  userIds: string[]
  releaseNotes?: string
  artifactId?: string
  installerSourceUrl?: string
  bundleUrl?: string
  artifactSizeBytes?: number
  enabled?: boolean
  mandatory?: boolean
  showUpdateDialog?: boolean
}
export interface Release
  extends Omit<
    DraftInput,
    'userIds' | 'releaseNotes' | 'artifactSizeBytes' | 'installerSourceUrl' | 'bundleUrl'
  > {
  releaseNotes?: string | null
  artifactSizeBytes?: number | null
  installerSourceUrl?: string | null
  bundleUrl?: string | null
  appName?: string
  releaseId: string
  releaseSequence: number
  enabled: boolean
  mandatory: boolean
  showUpdateDialog: boolean
  policyRevision?: number
  createdAt?: string
  updatedAt?: string
  status?: 'published' | 'disabled'
}
export interface Draft extends DraftInput {
  releaseId: string
  releaseSequence: null
  status: 'draft'
  createdAt?: string
  updatedAt?: string
}
export type CatalogRelease = Release | Draft
export interface PublishResult {
  releaseId: string
  releaseSequence: number
  status: 'published'
  taskId?: string
  operationId?: string
}
export interface Artifact {
  artifactId: string
  url: string
  sizeBytes: number
  checksumSha256: string
  status: 'pending' | 'published'
}
export interface Page<T> {
  data: T[]
  total: number
}
export interface PageQuery {
  page?: number
  pageSize?: number
}
export interface TimeQuery extends PageQuery {
  from?: string
  to?: string
}
export interface WindowPage<T> extends Page<T> {
  page: number
  pageSize: number
  from: string
  to: string
  retention?: 'permanent'
}
export interface TelemetryQuery extends TimeQuery {
  platform?: Platform
  releaseSequence?: number
}
export interface AppErrorsQuery extends TimeQuery {
  platform?: Platform
  kind?: 'crash' | 'error'
  errorHash?: string
}
export type TaskStatus = 'pending' | 'running' | 'retry_wait' | 'succeeded' | 'failed'
export type TaskLogStatus = 'running' | 'succeeded' | 'failed' | 'lease_expired'
export interface TaskQuery extends TimeQuery {
  status?: TaskStatus
  releaseId?: string
}
export interface TaskLogQuery extends TimeQuery {
  status?: TaskLogStatus
}
export interface TaskRecord extends Record<string, unknown> {
  task_id: string
  release_id: string
  status: TaskStatus
}
export interface TaskLog extends Record<string, unknown> {
  task_id: string
  status: TaskLogStatus
  metrics_complete: number
}
export interface TaskDetail {
  task: TaskRecord
  latestLog: TaskLog | null
}
export interface AuditQuery extends TimeQuery {
  action?: string
  result?: 'succeeded' | 'failed'
  actorKeyId?: string
  requestId?: string
  operationId?: string
  releaseId?: string
  taskId?: string
}
export interface AuditRecord extends Record<string, unknown> {
  audit_id: string
  operation_id: string
  action: string
  result: 'succeeded' | 'failed'
  part_no: number
  change_summary: JsonValue
  change_detail?: JsonValue
}
export interface StatisticsSummary {
  appName: string
  from: string
  to: string
  successCount: number
  errorCount: number
  countSemantics: 'report-records'
  receiveConfirmationAvailable: false
}
export interface Delivery extends Omit<WindowPage<TaskRecord>, 'data'> {
  releaseId: string
  tasks: Array<TaskRecord & { latestLog: TaskLog | null }>
  receiveConfirmationAvailable: false
  countSemantics: string
}
export interface TargetedMessage<T = JsonValue> {
  messageId: string | null
  data: T
  updatedAt: string
  expiresAt: string | null
  ackRequired: boolean
}
export interface SendTargetInput {
  data?: JsonValue
  resend?: boolean
}
