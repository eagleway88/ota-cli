# @eagleway/ota-cli

OTA API v1 的命令行工具与 TypeScript SDK。支持共享包发布、客户端更新检查、安装上报、Socket 消息，以及第三方后台的统计、任务和应用审计查询。

Node CLI / 上传工具要求 Node.js >= 18。SDK 提供独立的 ESM、CommonJS 和类型声明入口。

## 安装与入口

~~~bash
npm install @eagleway/ota-cli axios
# 全局命令行
npm install -g @eagleway/ota-cli axios
~~~

| 入口 | 运行环境与用途 |
| --- | --- |
| @eagleway/ota-cli | 客户端更新检查、安装与运行错误上报 |
| @eagleway/ota-cli/manage | 受控后端的发布、消息与管理查询 |
| @eagleway/ota-cli/node | Node 文件压缩、资源上传和发布编排 |
| @eagleway/ota-cli/ws | 客户端 Socket.IO 订阅、更新与消息 ACK |

axios 是 peer dependency，由接入项目提供。只有使用 Socket SDK 时才需要 socket.io-client，或自行注入适配器。React Native 和 Electron Renderer 不要导入 node 入口，也不要持有管理 Key。

## API Key 与服务地址

baseURL 必须包含 /api/v1，例如 https://ota.example.com/api/v1；反向代理前缀可写为 https://example.com/ota/api/v1。

受保护命令从 OTA_ACCESS_KEY 环境变量取 Key，通过 CI Secret 或本机环境安全注入；配置和命令行不保存明文凭证。支持 --key-env 指定另一个环境变量。无需登录，也不会在本机缓存凭证。

401 表示 Key 无效、到期或撤销；403 表示应用授权或权限不足，不会自动重新认证或重放请求。已有 Key 追加应用授权后无需更换工具配置。

Key 签发/撤销、应用授权调整、数据库初始化、应用准备和全局运维审计，均由服务端本地 yarn ota 命令管理。本工具不连接数据库、不替调用方扩展授权。发布用 publisher/full；查询按对应权限使用 observer/full；消息用 messenger/full。

## 共享桌面热更新包

在项目根目录创建 ota-cli.config.ts：

~~~ts
import type { OtaCliConfig } from '@eagleway/ota-cli/node'

export default {
  baseURL: 'https://ota.example.com/api/v1',
  appName: 'desktop',
  accessKeyEnv: 'OTA_ACCESS_KEY',
  defaults: {
    updateType: 'hot',
    releaseScope: 'public',
    userIds: [],
    mandatory: false,
    showUpdateDialog: true
  },
  targets: {
    desktop: {
      file: './dist/desktop-update.zip',
      platforms: ['windows', 'macos', 'linux'],
    }
  }
} satisfies OtaCliConfig
~~~

~~~bash
ota-cli release deploy --target desktop --target-version 1.3.10 --dry-run
ota-cli release deploy --target desktop --target-version 1.3.10 --wait --json
~~~

同一份包、同一套发布策略：只上传一次、创建一条草稿、发布一次，同时覆盖三个平台。目标不是平台的同义词，不根据执行机器猜测平台。

同一应用中，相同 ZIP 即使路径不同，也按最终 ZIP 的 SHA-256 在一次 Publisher 执行内复用；同一目录只压缩一次，目录条目排序并固定 ZIP 日期。不同渠道/名单策略可配置多个目标，共用 file；同一次 deploy --target stable,beta 只上传一次，再创建各自发布。不同应用不自动复用资源；独立命令执行不共享永久上传缓存。也可显式使用已有 artifactId 创建发布。

目录内不接受符号链接；上传源只能是 ZIP 或目录。多个目标分别报告结果，不提供跨发布事务。任一目标失败时退出码为 1，已完成的发布不会被回滚。

## 分阶段发布与恢复

~~~bash
# 只上传资源
ota-cli artifact upload --app desktop --file ./dist/desktop-update.zip

# release.json 使用正式 DraftInput JSON 字段，包含 artifactId 或对应下载 URL
ota-cli release create --app desktop --input release.json --idempotency-key YOUR_OPERATION_ID

# 只在显式 publish/deploy 时发布
ota-cli release publish --app desktop --id RELEASE_UUID

ota-cli release list --app desktop --status draft
ota-cli release show --app desktop --id RELEASE_UUID
ota-cli release update --app desktop --id RELEASE_UUID --input patch.json
ota-cli release disable --app desktop --id RELEASE_UUID
ota-cli release enable --app desktop --id RELEASE_UUID
ota-cli release redispatch --app desktop --id RELEASE_UUID
ota-cli release users --app desktop --id RELEASE_UUID
ota-cli release set-users --app desktop --id RELEASE_UUID --input users.json --expected-revision 1
ota-cli release set-scope --app desktop --id RELEASE_UUID --scope allowlist --expected-revision 2
~~~

DraftInput 使用显示版本字符串 targetVersion（如 1.3.10）、platforms 数组、updateType、releaseScope 和 userIds 数组，布尔值为 true/false。userId 格式为 appName:platform:businessId，必须匹配应用和平台。全量发布可单独配置不带 file 的目标，使用 updateType=full 和 installerSourceUrl；工具不上传 APK/EXE/DMG 安装文件。

deploy 默认把不含 API Key 的状态保存到当前目录 .ota-cli/deployments/，也可通过 --state 指定新文件。文件含应用、资源/发布 ID、幂等键及阶段，使用 0600 权限；不要提交到 Git。支持单目标恢复：

~~~bash
ota-cli release deploy --target desktop --target-version 1.3.10 --resume .ota-cli/deployments/DEPLOYMENT_UUID.json
~~~

恢复时保留相同发布参数及源文件内容。草稿创建重用原幂等键，发布重用原 releaseId。上传响应丢失时没有资源查询幂等保证，工具会停止并提示结果未知，不自动重新上传；先核对服务端再决定新建执行。状态文件的 .lock 表示正在执行或上次异常退出，确认没有相关进程后才可人工移除。

--wait 只等待分发任务；不代表客户端下载、接收或安装成功。任务失败或等待超时不回滚已发布版本。恢复时若服务端未返回 taskId，使用 release delivery/task list 查询。网络请求默认不自动重试。

onPublished/onError 可配置异步回调；发布后回调失败会返回警告，不把远端发布改报为失败。

恢复路径以命令输出的 stateFile 为准；示例中的 UUID 路径需要替换为实际文件。开发验证使用 Node.js 22。

## 查询与消息 CLI

~~~bash
ota-cli statistics summary --app desktop --release-sequence 1
ota-cli telemetry successes --app desktop --page-size 100
ota-cli telemetry failures --app desktop
ota-cli telemetry app-errors --app desktop --kind crash
ota-cli task list --app desktop --status running
ota-cli task show --app desktop --id TASK_UUID
ota-cli task logs --app desktop --id TASK_UUID
ota-cli task wait --app desktop --id TASK_UUID --wait-timeout 300000
ota-cli release delivery --app desktop --id RELEASE_UUID
ota-cli audit list --app desktop --operation-id OPERATION_UUID
ota-cli message subscriptions --app desktop
ota-cli message application --app desktop --data '{"notice":"maintenance"}'
ota-cli message user --app desktop --user-id desktop:windows:42 --data '{"refresh":true}'
ota-cli message device --app desktop --unique-id device-1 --resend
~~~

消息支持 --data-file 读取任意合法 JSON，不能与 --data 同用。普通应用消息与 OTA 重新分发相互独立。

分页查询支持 --page/--page-size（最多 100）、--from/--to；汇总不分页。默认时间范围由服务端决定（最近 30 天），单次最多 90 天。任务和审计永久保存，查更早数据需显式传时间并分段查询，不是只能保存 90 天。

原样保留分页元数据、任务/日志 snake_case 字段和 retention 等声明。成功/失败计数是上报记录数；错误组 reportCount 是聚合累计数；分发计数不是独立接收人数。应用审计可能分段，需读取各页再按 operation_id/part_no 组织完整差异。这里不提供服务器标准输出、PM2 文件或全局运维审计查询。

## 客户端 SDK

~~~ts
import { createAppClient } from '@eagleway/ota-cli'

const app = createAppClient({
  baseURL: 'https://ota.example.com/api/v1',
  appName: 'desktop'
})

const update = await app.checkUpdate({
  platform: 'windows',
  architecture: 'x64',
  currentVersion: '1.3.10',
  installedReleaseSequence: 0,
  distributionChannel: 'stable'
})
~~~

无更新返回 null。currentVersion 是原生安装包的显示版本字符串（如 1.3.10），热更新不能改变它；installedReleaseSequence 是实际已加载发布的序号，不是 UUID。全量使用 installerSourceUrl，热更新使用 bundleUrl。

app.reportSuccess / app.reportFailure 使用 platform、显示版本字符串 version、releaseSequence，可带 reportedUsername、extras 和 reportId。reportId 由业务为一次安装事件生成并保存，重试同一事件时沿用原 UUID 与相同内容；SDK 不替每次请求生成新 ID。无键上报逐次计数。只有实际重启并确认加载后才上报成功。

app.reportAppError 接收 kind/message/stack；app.captureAppError(error, context) 可规范化异常。它们不携带 releaseSequence/reportId。extras 保持 JSON 类型，不转换业务键名。

CLI 调试入口：

~~~bash
ota-cli app check --app desktop --platform windows --current-version 1.3.10
ota-cli app success --app desktop --input success.json
ota-cli app failure --app desktop --input failure.json
ota-cli app app-error --app desktop --input app-error.json
~~~

## 第三方后台与 Node SDK

~~~ts
import { createManageClient } from '@eagleway/ota-cli/manage'

const accessKey = process.env.OTA_ACCESS_KEY
if (!accessKey) throw new Error('Missing OTA_ACCESS_KEY')

const app = createManageClient({
  baseURL: 'https://ota.example.com/api/v1',
  accessKey
}).forApp('desktop')

const statistics = await app.statistics.summary()
const tasks = await app.tasks.list({ pageSize: 100 })
const audit = await app.audit.list({ operationId: 'OPERATION_UUID' })
~~~

Manage SDK 供受控后端使用，由第三方后台自行认证其用户。不要将这些凭证和调用放进浏览器页面。

Node 入口提供 createPublisher、uploadArtifact 和 waitForTask。Publisher 的多次 uploadArtifact/deploy 可在当前实例内复用同应用资源；deployMany 会先校验所有目标并准备所有文件，再逐项执行。务必 finally 调用 publisher.close() 清理临时 ZIP。Node SDK 仅在显式设置 stateFile 时写恢复状态；CLI 则默认保存。

## Socket SDK

~~~bash
npm install socket.io-client
~~~

~~~ts
import { io } from 'socket.io-client'
import { createWsClient } from '@eagleway/ota-cli/ws'

const ws = createWsClient({
  serverURL: 'https://ota.example.com',
  adapter: io,
  path: '/socket.io'
})
ws.onError(error => console.error(error.message))
ws.onUpdate('desktop', release => {
  // enabled=false 是服务端撤销之前推送版本的通知；由业务决定处理方式。
})
ws.onApplicationMessage('desktop', message => {
  // 普通应用消息，不是 OTA 更新。
})
await ws.subscribeApp({
  appName: 'desktop',
  platform: 'windows',
  currentVersion: '1.3.10',
  installedReleaseSequence: 0
})
await ws.subscribeUser('desktop:windows:42')
await ws.subscribeDevice({ appName: 'desktop', uniqueId: 'device-1' })
~~~

Socket 只走 WebSocket transport，不携带 API Key。浏览器/RN 推荐显式注入 io；Node 环境也可 await loadSocketIoAdapter() 得到适配器。serverURL 为 origin；反向代理路径通过 path 单独指定。

onUserMessage/onDeviceMessage 接收 TargetedMessage 信封。业务成功处理后，使用 ackUser({ userId, messageId }) 或 ackDevice({ appName, uniqueId, messageId })；SDK 不自动提前 ACK。相同设备 ID 按应用隔离。

重连会恢复当前订阅和最后一次订阅上下文；实际加载版本后再次 subscribeApp 更新 installedReleaseSequence。unsubscribeApp/unsubscribeUser/unsubscribeDevice 同时移除重连意图。suspend 保留意图，connect 恢复；disconnect 完全释放实例，之后重新创建。

## 配置、输出与验证

配置发现顺序为 ota-cli.config.ts/js/mjs/cjs，支持导出对象或返回对象的异步函数。--config 指定文件；--no-config 禁用配置。file 相对配置文件目录解析，显式 --file 相对执行目录解析。

可配置 profiles，使用 --profile NAME 选择 baseURL/appName/accessKeyEnv/timeout/uploadTimeout。服务地址优先级为命令行 > OTA_BASE_URL > profile > 根配置；应用为 --app > 目标应用 > profile/根配置。选中的凭证变量缺失时不回退其它 Key。

所有成功结果以 JSON 写 stdout，诊断和配置/回调日志写 stderr，支持 --json 显式声明机器调用。多目标失败输出逐项结果并退出 1；单命令失败在 stderr 输出结构化错误。--request-id 可关联服务端审计。--timeout 控制普通请求；--upload-timeout 控制上传（默认 150 秒）；等待任务有独立 --wait-timeout。

~~~bash
pnpm install --frozen-lockfile
pnpm test:verify
~~~

测试集中在 test/。构建同时验证 ESM/CJS 导出、类型声明和配置示例；测试覆盖本机 HTTP/CLI、浏览器打包、Socket 生命周期和发布恢复。测试不访问生产库、业务服务或 OSS。真实客户端、OSS 和目标服务联调仍需单独验收。构建及验证不会发布 npm 包。

热更新要求 targetVersion === currentVersion，且 releaseSequence 大于已安装序号，并匹配平台、架构、渠道及用户范围；完整更新按数字分段比较 targetVersion 与 currentVersion，目标更高的全量包优先。SDK 2.0.0 需与配套的 OTA API 和客户端同步升级。
