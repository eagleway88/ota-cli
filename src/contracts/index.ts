/** 协议支持的平台名称；Windows/macOS 等系统名称需转换为这里的小写值。 */
export const platforms = ['ios', 'android', 'windows', 'linux', 'macos'] as const
/** 客户端真实运行平台；发布目标名称与此类型无关。 */
export type Platform = (typeof platforms)[number]
/** hot 为同一原生版本内的资源热更新；full 为原生安装包更新。 */
export type UpdateType = 'hot' | 'full'
/** public 面向符合条件的客户端；allowlist 还要求匹配 userIds。 */
export type ReleaseScope = 'public' | 'allowlist'
/** 可传输的 JSON 数据；数值必须有限，不能包含循环引用或函数。 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }
/** 请求生命周期；不包含请求头、正文或查询参数。 */
export interface RequestEvent {
  id: number
  method: string
  path: string
  phase: 'start' | 'success' | 'error'
  elapsedMs: number
}
/** 各 HTTP SDK 共用的连接设置；SDK 不自动读取 ota-cli.config。 */
export interface HttpOptions {
  /** 完整 API 根地址，例如 https://ota.example.com/api/v1；必须包含 /api/v1。 */
  baseURL: string
  /** 单次普通请求超时，单位毫秒，默认 15000。 */
  timeout?: number
  /** 附加请求头；禁止覆盖 Authorization、Cookie 和 Proxy-Authorization。 */
  headers?: Record<string, string>
  /** 可选 Fetch 实现，默认使用运行环境的原生 fetch。 */
  fetch?: typeof globalThis.fetch
  /** 可选请求观察器；观察器异常不会改变请求结果。 */
  onRequest?: (event: RequestEvent) => void
}
/** 单次请求控制；中止等待或请求不会撤销服务端已提交的操作。 */
export interface RequestControl {
  /** 用于中止当前请求或支持中止的任务等待。 */
  signal?: AbortSignal
  /** 通过 x-request-id 发送的追踪标识，可用于关联服务端审计。 */
  requestId?: string
}
/** 公开客户端 API 设置；更新检查和安装上报不需要管理 Key。 */
export interface AppOptions extends HttpOptions {
  /** 服务端已准备好的应用标识，须与发布端一致。 */
  appName: string
}
/** 管理 API 设置，仅供发布环境或受控后端使用。 */
export interface ManageOptions extends HttpOptions {
  /** 完整管理 API Key；由环境或密钥服务注入，勿放入客户端。 */
  accessKey: string
}
/** 查询与当前客户端匹配的更新；无可用更新时返回 null。 */
export interface CheckInput {
  /** 客户端真实运行的平台。 */
  platform: Platform
  /** 原生安装包的三段数字显示版本，例如 1.3.10；热更新不会改变它。 */
  currentVersion: string
  /** 当前实际已加载的发布序号；从未安装 OTA 时传 0，勿填写 UUID 或待安装序号。 */
  installedReleaseSequence?: number
  /** 客户端架构，例如 x64、arm64；使用架构定向发布时应与发布配置一致。 */
  architecture?: string
  /** 客户端渠道，例如 stable、beta；使用渠道定向发布时应与发布配置一致。 */
  distributionChannel?: string
  /** 名单匹配用的用户标识，格式为 appName:platform:businessId。 */
  userId?: string
}
/** 安装上报与应用错误上报的公共字段。 */
export interface ReportInput {
  /** 发生安装或错误的实际平台。 */
  platform: Platform
  /** 原生安装包显示版本，例如 1.3.10；不是发布序号。 */
  version: string
  /** 可选业务用户名，用于展示与排查。 */
  reportedUsername?: string | null
  /** 业务附加 JSON；SDK 原样保留键名和值类型。 */
  extras?: JsonValue
}
/** 已实际加载新包并确认成功后提交的安装上报。 */
export interface SuccessInput extends ReportInput {
  /** 本次安装事件的发布序号，必须大于 0；失败上报填写尝试安装的序号。 */
  releaseSequence: number
  /** 一次安装事件的 UUID；同一事件重试时沿用并保持内容一致，SDK 不自动生成。 */
  reportId?: string
}
/** 下载、安装或加载失败时提交的上报。 */
export interface FailureInput extends SuccessInput {
  /** 本次失败原因。 */
  message: string
  /** 可选关联记录 ID，具体关联语义由服务端处理。 */
  recordId?: number
}
/** 应用运行错误上报；不携带安装事件的 releaseSequence 或 reportId。 */
export interface AppErrorInput extends ReportInput {
  /** 错误类别，例如 error、crash。 */
  kind: string
  /** 错误描述。 */
  message: string
  /** 可选原始堆栈。 */
  stack?: string | null
}
/** 服务端返回的安装成功或失败上报记录。 */
export interface ReportRecord extends ReportInput {
  /** 上报记录 ID。 */
  id: number
  /** 上报所属应用。 */
  appName: string
  /** 上报对应的发布序号。 */
  releaseSequence: number
  /** 接入方提交的安装事件 UUID；未提交时可为空。 */
  reportId?: string | null
  /** 失败记录的错误描述。 */
  message?: string
  /** 服务端记录的请求来源地址。 */
  sourceIp?: string
  /** 记录创建时间。 */
  createdAt: string
  /** 记录最后更新时间。 */
  updatedAt?: string
}
/** 按错误特征聚合的应用错误记录。 */
export interface AppErrorRecord extends AppErrorInput {
  /** 错误组记录 ID。 */
  id: number
  /** 错误所属应用。 */
  appName: string
  /** 服务端用于聚合相同错误的特征哈希。 */
  errorHash: string
  /** 此错误组累计上报次数，不是独立用户数。 */
  reportCount: number
  /** 首次观察到此错误的时间。 */
  firstSeenAt: string
  /** 最近观察到此错误的时间。 */
  lastSeenAt: string
}
/** 创建草稿的完整内容；CLI deploy 合并配置后按目标键补入 platforms。 */
export interface DraftInput {
  /** 目标原生版本，例如 1.3.10；hot 必须等于客户端 currentVersion，full 应更高。 */
  targetVersion: string
  /** 适用平台，至少一个；SDK 可指定多个，CLI deploy 则由单个平台目标的键生成。 */
  platforms: Platform[]
  /** 可选架构范围，例如 ['x64', 'arm64']。 */
  architectures?: string[]
  /** 可选发布渠道，例如 stable；客户端需上报对应渠道。 */
  distributionChannel?: string
  /** 更新方式：hot 使用资源包，full 使用原生安装包。 */
  updateType: UpdateType
  /** 必须显式选择 public 或 allowlist，避免隐式改变发布范围。 */
  releaseScope: ReleaseScope
  /** 用户名单，最多 5000 项；公开发布通常传 []，每项须匹配应用及适用平台。 */
  userIds: string[]
  /** 展示给用户的更新说明。 */
  releaseNotes?: string
  /** 已上传资源的 ID；CLI/Publisher 提供 file 时会在上传后自动填入。 */
  artifactId?: string
  /** full 更新的 HTTP(S) 安装包地址；CLI 不上传 APK/EXE/DMG 文件。 */
  installerSourceUrl?: string
  /** hot 更新的 HTTP(S) 资源包地址；使用已有 URL 时可省去上传。 */
  bundleUrl?: string
  /** 资源大小，单位字节。 */
  artifactSizeBytes?: number
  /** 是否启用该发布。 */
  enabled?: boolean
  /** 强制更新策略标记；具体交互由客户端实现。 */
  mandatory?: boolean
  /** 更新提示标记；SDK 不负责渲染对话框。 */
  showUpdateDialog?: boolean
}
/** 已发布版本及其当前策略；检查更新和 Socket 更新事件使用此结构。 */
export interface Release
  extends Omit<
    DraftInput,
    'userIds' | 'releaseNotes' | 'artifactSizeBytes' | 'installerSourceUrl' | 'bundleUrl'
  > {
  /** 更新说明，服务端未设置时可为空。 */
  releaseNotes?: string | null
  /** 资源大小，单位字节，未提供时可为空。 */
  artifactSizeBytes?: number | null
  /** full 更新的安装包下载地址。 */
  installerSourceUrl?: string | null
  /** hot 更新的资源包下载地址；应用自行下载、解压和加载。 */
  bundleUrl?: string | null
  /** 发布所属应用。 */
  appName?: string
  /** 发布 UUID，用于管理命令的 --id；不是客户端版本序号。 */
  releaseId: string
  /** 服务端分配的发布序号；客户端确认加载后保存并用于下次检查。 */
  releaseSequence: number
  /** 是否启用；Socket 可能推送 false 通知撤销，勿作为新包安装。 */
  enabled: boolean
  /** 强制更新策略标记，由接入方实现交互。 */
  mandatory: boolean
  /** 是否展示更新提示，由接入方实现交互。 */
  showUpdateDialog: boolean
  /** 名单或发布范围等策略的修订号，用于乐观并发校验。 */
  policyRevision?: number
  /** 创建时间。 */
  createdAt?: string
  /** 最后更新时间。 */
  updatedAt?: string
  /** 服务端声明的当前发布状态。 */
  status?: 'published' | 'disabled'
}
/** 已创建但尚未发布的草稿；此时还没有发布序号。 */
export interface Draft extends DraftInput {
  /** 草稿 UUID，后续 publish 操作使用此 ID。 */
  releaseId: string
  /** 草稿尚未分配序号；正式发布后取得数字序号。 */
  releaseSequence: null
  /** 固定为 draft，创建草稿不会自动触发发布。 */
  status: 'draft'
  /** 草稿创建时间。 */
  createdAt?: string
  /** 草稿最后更新时间。 */
  updatedAt?: string
}
/** 发布列表或详情中的草稿与正式发布联合类型，可用 status 区分。 */
export type CatalogRelease = Release | Draft
/** 发布提交成功的结果；不代表客户端已经下载或安装。 */
export interface PublishResult {
  /** 已发布版本的 UUID，供后续管理查询使用。 */
  releaseId: string
  /** 服务端分配的发布序号，供客户端检查与安装上报使用。 */
  releaseSequence: number
  /** 远端发布已提交。 */
  status: 'published'
  /** 此次分发任务 ID；重复发布的响应可能省略，需另查发布分发记录。 */
  taskId?: string
  /** 服务端操作标识，可用于关联应用审计。 */
  operationId?: string
}
/** ZIP 上传完成后的资源元数据；上传本身不会创建发布。 */
export interface Artifact {
  /** 后续创建草稿时使用的资源 ID。 */
  artifactId: string
  /** 服务端返回的资源下载地址。 */
  url: string
  /** 最终 ZIP 的字节数。 */
  sizeBytes: number
  /** 最终 ZIP 的 SHA-256；发布器会与本地文件校验。 */
  checksumSha256: string
  /** 资源当前处于待发布或已发布状态。 */
  status: 'pending' | 'published'
}
/** 常规分页结果。 */
export interface Page<T> {
  /** 当前页记录。 */
  data: T[]
  /** 服务端返回的记录总数。 */
  total: number
}
/** 分页查询条件；未传的默认值由服务端决定。 */
export interface PageQuery {
  /** 页码，从 1 开始，最大 999999。 */
  page?: number
  /** 每页记录数，取值 1 到 100。 */
  pageSize?: number
}
/** 带时间窗口的查询；单次最多 90 天，省略范围时通常查询最近 30 天。 */
export interface TimeQuery extends PageQuery {
  /** 起始 ISO 时间，必须包含时区，例如 2026-10-01T00:00:00+08:00。 */
  from?: string
  /** 截止 ISO 时间，必须包含时区且晚于 from。 */
  to?: string
}
/** 带实际查询窗口的分页响应；保留服务端返回的元数据。 */
export interface WindowPage<T> extends Page<T> {
  /** 实际页码。 */
  page: number
  /** 实际每页记录数。 */
  pageSize: number
  /** 实际查询起始时间。 */
  from: string
  /** 实际查询截止时间。 */
  to: string
  /** 服务端声明记录永久保存；查询窗口限制不代表数据保留期。 */
  retention?: 'permanent'
}
/** 安装成功或失败记录的查询条件。 */
export interface TelemetryQuery extends TimeQuery {
  /** 按客户端平台筛选。 */
  platform?: Platform
  /** 按发布序号筛选，必须大于 0。 */
  releaseSequence?: number
}
/** 聚合应用错误的查询条件。 */
export interface AppErrorsQuery extends TimeQuery {
  /** 按错误发生平台筛选。 */
  platform?: Platform
  /** 按 crash 或 error 类别筛选。 */
  kind?: 'crash' | 'error'
  /** 按服务端错误聚合哈希筛选。 */
  errorHash?: string
}
/** 分发任务状态；succeeded 表示任务完成，不表示客户端安装成功。 */
export type TaskStatus = 'pending' | 'running' | 'retry_wait' | 'succeeded' | 'failed'
/** 单次任务执行日志状态；lease_expired 表示该次执行租约已过期。 */
export type TaskLogStatus = 'running' | 'succeeded' | 'failed' | 'lease_expired'
/** 分发任务查询条件。 */
export interface TaskQuery extends TimeQuery {
  /** 按任务状态筛选。 */
  status?: TaskStatus
  /** 按发布 UUID 筛选。 */
  releaseId?: string
}
/** 单个任务的执行日志查询条件。 */
export interface TaskLogQuery extends TimeQuery {
  /** 按单次执行状态筛选。 */
  status?: TaskLogStatus
}
/** 服务端任务记录，保留原始 snake_case 字段及扩展字段。 */
export interface TaskRecord extends Record<string, unknown> {
  /** 分发任务 ID。 */
  task_id: string
  /** 关联的发布 UUID。 */
  release_id: string
  /** 当前任务状态。 */
  status: TaskStatus
}
/** 服务端任务执行日志，保留原始字段及扩展字段。 */
export interface TaskLog extends Record<string, unknown> {
  /** 关联的任务 ID。 */
  task_id: string
  /** 该次执行的状态。 */
  status: TaskLogStatus
  /** 服务端统计完整性标记；不应据此推断客户端安装成功。 */
  metrics_complete: number
}
/** 任务当前状态及最近一次执行日志。 */
export interface TaskDetail {
  /** 当前任务记录。 */
  task: TaskRecord
  /** 最近一次执行日志；尚未执行时可为空。 */
  latestLog: TaskLog | null
}
/** 单应用审计查询条件；不包含服务端全局运维审计。 */
export interface AuditQuery extends TimeQuery {
  /** 按操作动作筛选。 */
  action?: string
  /** 按操作成功或失败筛选。 */
  result?: 'succeeded' | 'failed'
  /** 按执行操作的 API Key 标识筛选，非 Key 明文。 */
  actorKeyId?: string
  /** 按请求追踪标识筛选。 */
  requestId?: string
  /** 按服务端操作标识筛选。 */
  operationId?: string
  /** 按关联发布 UUID 筛选。 */
  releaseId?: string
  /** 按关联分发任务 ID 筛选。 */
  taskId?: string
}
/** 应用审计记录；同一操作可能按 part_no 拆成多条。 */
export interface AuditRecord extends Record<string, unknown> {
  /** 审计记录 ID。 */
  audit_id: string
  /** 操作标识，用于归并同一操作的多个分段。 */
  operation_id: string
  /** 执行的操作动作。 */
  action: string
  /** 操作结果。 */
  result: 'succeeded' | 'failed'
  /** 当前操作的审计分段编号。 */
  part_no: number
  /** 变更摘要。 */
  change_summary: JsonValue
  /** 可选变更详情。 */
  change_detail?: JsonValue
}
/** 安装上报汇总；计数为上报记录数，不是独立安装人数。 */
export interface StatisticsSummary {
  /** 统计所属应用。 */
  appName: string
  /** 实际统计起始时间。 */
  from: string
  /** 实际统计截止时间。 */
  to: string
  /** 成功上报记录数。 */
  successCount: number
  /** 失败上报记录数。 */
  errorCount: number
  /** 声明计数口径为上报记录。 */
  countSemantics: 'report-records'
  /** 固定为 false：接口不提供客户端接收确认统计。 */
  receiveConfirmationAvailable: false
}
/** 一个发布的分发任务分页；分发统计与客户端安装上报独立。 */
export interface Delivery extends Omit<WindowPage<TaskRecord>, 'data'> {
  /** 查询的发布 UUID。 */
  releaseId: string
  /** 当前页分发任务及各自最近执行日志。 */
  tasks: Array<TaskRecord & { latestLog: TaskLog | null }>
  /** 固定为 false：任务完成不等于客户端接收确认。 */
  receiveConfirmationAvailable: false
  /** 服务端声明的计数口径。 */
  countSemantics: string
}
/** 用户或设备定向消息信封；需业务处理后再按要求主动 ACK。 */
export interface TargetedMessage<T = JsonValue> {
  /** 消息标识；为空时不能按 ID 确认。 */
  messageId: string | null
  /** 消息正文，保留原始 JSON 类型。 */
  data: T
  /** 消息最后更新时间。 */
  updatedAt: string
  /** 消息过期时间；为空表示服务端未提供过期时间。 */
  expiresAt: string | null
  /** 是否要求客户端在业务处理成功后主动确认。 */
  ackRequired: boolean
}
/** 发送或重发用户、设备定向消息的输入。 */
export interface SendTargetInput {
  /** 可选消息正文，支持任意合法 JSON 值。 */
  data?: JsonValue
  /** 是否请求重发；由服务端处理现有消息的重发语义。 */
  resend?: boolean
}
