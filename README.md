# @eagleway/ota-cli

OTA API v1 的命令行工具与 TypeScript SDK，用于发布热更新、客户端检查更新和上报安装结果，也提供消息、任务和审计查询。

一次完整的热更新包含两部分：**发布端上传资源并创建发布；客户端查询更新、下载资源、切换加载并上报结果。** CLI 完成发布端的工作，客户端 SDK 提供查询和上报接口；下载、解压、资源校验、加载切换和重启需要由你的应用实现。

第一次接入按下面的流程操作。已经接入的项目可以直接看[日常发布](#daily-release)。

- [首次接入与发布](#getting-started)：准备服务、安装依赖、接入客户端、构建资源、配置和发布。
- [命令与配置说明](#configuration)：目标选择、配置字段、部署参数和输出。
- [发布失败与恢复](#recovery)：确认远端状态、继续执行和停用发布。
- [进阶发布](#advanced-release)：多目标、名单、全量更新、分阶段发布和 CI。
- [查询与其他 SDK](#reference)：统计、消息、后台管理和 Socket。
- [常见问题](#faq)：客户端查不到更新、版本号、权限和安装结果。

<a id="getting-started"></a>

## 首次接入与发布

下面以应用 `desktop` 的 Windows 客户端为例：

| 项目 | 示例值 | 含义 |
| --- | --- | --- |
| API 地址 | `https://ota.example.com/api/v1` | 替换成你的 OTA 服务地址 |
| 应用标识 | `desktop` | 服务端、发布端、客户端使用同一个标识 |
| 当前原生安装包版本 | `1.3.10` | 客户端正在运行的原生版本 |
| 发布目标平台 | `windows` | 配置文件的 `targets.windows`，同时决定客户端适用平台 |
| 热更新构建目录 | `./build/hot-update` | 你的应用生成的可热更新资源 |

示例域名、应用名和目录都需要按项目修改。**本文的接入命令在你的客户端项目根目录执行，该目录应包含 `package.json` 和 `ota-cli.config.ts`。**

### 1. 准备 OTA 服务和客户端加载能力

先从服务端维护者处取得：

- 已部署的 OTA API 地址，包含 `/api/v1`；反向代理前缀可以是 `https://example.com/ota/api/v1`。
- 已在服务端准备好的应用标识 `appName`。
- 有该应用发布权限的 API Key，例如 `publisher/full`；后续任务、统计查询还需要对应读取权限。
- 客户端可访问的资源下载服务；发布后返回的资源 URL 必须能被客户端访问。

应用准备、Key 签发/撤销、应用授权和数据库初始化由服务端管理。本 CLI 没有登录或创建应用命令，也不会自动部署 OTA 服务。

同时确认你的客户端具备加载外部更新资源的能力。例如，桌面应用需要有一个启动入口，能选择加载内置资源或已安装的热更新目录。若当前应用始终加载安装包内固定的资源目录，应先完成这个入口，再发布包含它的原生安装包。

### 2. 安装依赖

在客户端项目中，按项目已经使用的包管理器选择一列执行，不需要重复安装：

| 操作 | npm | Yarn | pnpm |
| --- | --- | --- | --- |
| 安装依赖 | `npm install @eagleway/ota-cli` | `yarn add @eagleway/ota-cli` | `pnpm add @eagleway/ota-cli` |
| 查看 CLI 版本 | `npm exec -- ota-cli --version` | `yarn run ota-cli --version` | `pnpm exec ota-cli --version` |
| 构建业务资源 | `npm run build` | `yarn run build` | `pnpm build` |
| 试运行全部已配置平台 | `npm exec -- ota-cli release deploy --dry-run` | `yarn run ota-cli release deploy --dry-run` | `pnpm exec ota-cli release deploy --dry-run` |
| 发布全部已配置平台 | `npm exec -- ota-cli release deploy --wait` | `yarn run ota-cli release deploy --wait` | `pnpm exec ota-cli release deploy --wait` |
| 只发布 Windows | `npm exec -- ota-cli release deploy --target windows --wait` | `yarn run ota-cli release deploy --target windows --wait` | `pnpm exec ota-cli release deploy --target windows --wait` |

HTTP 请求使用运行环境的原生 `fetch`，无需额外安装 HTTP 库。CLI 和 Node 上传工具要求 Node.js >= 18；客户端环境需提供 Fetch API。

后文以 `pnpm exec ota-cli` 展示完整流程。npm 用户将此前缀替换为 `npm exec -- ota-cli`，Yarn 用户替换为 `yarn run ota-cli`，后面的子命令和参数相同。npm 的 `--` 用于把后续参数交给 CLI；Yarn 的 `run` 可执行已安装依赖提供的命令，参见 [npm exec](https://docs.npmjs.com/cli/commands/npm-exec/) 和 [Yarn run](https://yarnpkg.com/cli/run)。

使用全局命令时可先执行 `npm install -g @eagleway/ota-cli`，之后直接运行 `ota-cli release deploy`。本地安装更便于让项目与 CI 使用同一依赖版本。

### 3. 接入客户端更新检查

在客户端创建 `ota-client.ts`：

~~~ts
import { createAppClient } from '@eagleway/ota-cli'

export const ota = createAppClient({
  baseURL: 'https://ota.example.com/api/v1',
  appName: 'desktop'
})

// 参数来自客户端本地已加载的更新记录；首次使用 OTA 时传 0。
export function checkForUpdate(installedReleaseSequence: number) {
  return ota.checkUpdate({
    platform: 'windows',
    currentVersion: '1.3.10',
    installedReleaseSequence
  })
}
~~~

在应用启动或用户点击“检查更新”时调用 `checkForUpdate`。将示例中的平台和原生版本替换为应用运行时的真实值；macOS 使用 `macos`，Linux 使用 `linux`。

客户端 SDK 显式接收连接参数，不读取发布端的 `ota-cli.config`，也不需要管理 API Key。React Native、Electron Renderer 等客户端环境使用根入口 `@eagleway/ota-cli`，避免引入 `/node` 或 `/manage`。

查询结果为 `null` 时没有匹配的更新；有更新时会返回 `Release`，主要关注：

| 字段 | 客户端如何使用 |
| --- | --- |
| `updateType` | `hot` 走热更新资源流程；`full` 走原生安装包更新流程 |
| `bundleUrl` | 热更新资源下载地址 |
| `installerSourceUrl` | 全量安装包地址 |
| `targetVersion` | 发布配置中的目标原生版本 |
| `releaseSequence` | 此次发布的序号；实际加载成功后保存 |
| `releaseNotes` | 展示更新内容 |
| `mandatory` / `showUpdateDialog` | 供应用决定更新交互，SDK 不自动弹框 |

**原生版本号与热更新序号是两个不同字段。** 原生 `1.3.10` 上连续发两次热更新，`targetVersion` 都可以是 `1.3.10`，服务端分配的 `releaseSequence` 会不同。客户端每次检查时仍传真实原生版本和当前已经加载的发布序号。

### 4. 构建热更新资源

使用你的应用已有的构建流程生成资源。例如，如果应用的 `build` 脚本负责构建资源：

~~~bash
pnpm build
~~~

这个脚本由接入项目提供，ota-cli 不会编译业务代码。以下示例假设构建后得到：

~~~text
your-client-project/
├─ package.json
├─ ota-cli.config.ts
└─ build/
   └─ hot-update/
      ├─ index.html
      └─ assets/
         ├─ app.js
         └─ app.css
~~~

这里的 HTML/JS/CSS 只是资源结构示例。实际应放入客户端加载器能识别的文件；React Native bundle 或其他资源同样需要约定自己的入口和布局。

配置 `file: './build/hot-update'` 后，CLI 会把目录**内部文件**打成 ZIP，ZIP 根目录是 `index.html`、`assets/`，不会额外套一层 `hot-update/`。也可以直接指定已经准备好的 `.zip`。

上传目录不能包含符号链接。原生依赖或安装器等无法通过当前加载器替换的内容，应走全量更新。

### 5. 创建发布配置

在同一项目根目录创建 `ota-cli.config.ts`：

~~~ts
import type { OtaCliConfig } from '@eagleway/ota-cli/node'

export default {
  baseURL: 'https://ota.example.com/api/v1',
  appName: 'desktop',
  accessKeyEnv: 'OTA_ACCESS_KEY',
  timeout: 15000,
  uploadTimeout: 150000,
  defaults: {
    updateType: 'hot',
    releaseScope: 'public',
    userIds: [],
    mandatory: false,
    showUpdateDialog: true
  },
  targets: {
    windows: {
      file: './build/hot-update',
      targetVersion: '1.3.10',
      releaseNotes: '修复首页显示问题'
    }
  }
} satisfies OtaCliConfig
~~~

这个配置表示：把构建目录打包，给应用 `desktop` 中原生版本为 `1.3.10` 的 Windows 客户端发布一次公开热更新。

`defaults` 提供所有目标共用的发布字段，`targets.windows` 提供 Windows 的字段；同名字段以目标为准，数组会整体替换。适用平台由键 `windows` 推导，不在 `defaults` 或目标内填写 `platforms`。

`targets` 只允许 `windows`、`macos`、`linux`、`android`、`ios` 五种键。`desktop` 是本例的应用标识，不能作为目标键；架构和渠道分别写入 `architectures`、`distributionChannel`，不拼进目标名称。

**省略 `--target` 时发布配置中的全部平台；提供 `--target windows` 时只选择 `targets.windows`。** 终端不能创建新目标、覆盖版本或替换源文件。

### 6. 试运行，检查即将发布的内容

先执行：

~~~bash
pnpm exec ota-cli release deploy --dry-run
~~~

逐段解释：

| 命令部分 | 含义 |
| --- | --- |
| `pnpm exec ota-cli` | 运行项目中安装的 CLI |
| `release` | 进入发布管理命令组 |
| `deploy` | 按配置执行“准备资源 → 上传 → 创建草稿 → 正式发布”流程 |
| 省略 `--target` | 选择 `targets` 中全部已配置平台；本例只有 Windows |
| 可选 `--target windows` | 只选择已配置的 Windows 平台 |
| `--dry-run` | 本次只做本地检查并打印合并后的配置，停止在上传之前 |

成功时退出码为 `0`，stdout 返回包含 `dryRun: true` 和 `targets` 的 JSON。核对其中的应用名、源文件绝对路径、版本、平台和发布范围。

试运行不需要 API Key，不请求服务端，也不写部署状态文件。它会校验发布字段及源路径是否为 ZIP 文件或目录，**不会实际压缩、完整检查 ZIP 内容、验证 Key 权限或验证服务端是否可用**。正式发布仍可能在这些阶段失败。

### 7. 注入 Key，正式发布

在执行发布的环境设置 `OTA_ACCESS_KEY`。这里放服务端实际签发的完整 Key，示例占位文字需要替换；CI 中通过 Secret 注入。

PowerShell：

~~~powershell
$env:OTA_ACCESS_KEY = '替换为服务端签发的完整 API Key'
~~~

Bash / zsh：

~~~bash
export OTA_ACCESS_KEY='替换为服务端签发的完整 API Key'
~~~

在设置变量的同一个终端、同一个项目目录执行：

~~~bash
pnpm exec ota-cli release deploy --wait
~~~

与试运行相比，去掉了 `--dry-run`，因此会真正上传和发布。`--wait` 表示发布后继续等待服务端分发任务完成，默认最多等 5 分钟；它需要任务读取权限。省略 `--wait` 时，CLI 在取得发布结果后返回。

CLI 依次执行：

1. 合并目标配置并检查源文件；目录会先打成 ZIP。
2. 上传 ZIP 并核对服务端返回的 SHA-256 和字节数。
3. 使用资源 ID 创建草稿。
4. 正式发布草稿，取得 `releaseId`、`releaseSequence`，以及可能返回的 `taskId`。
5. 指定 `--wait` 时，继续查询分发任务状态。

stdout 中的成功结果包含 `deployments` 数组。下面是部分字段示例，ID 和序号以实际输出为准：

~~~json
{
  "deployments": [
    {
        "target": "windows",
      "appName": "desktop",
      "result": {
        "releaseId": "11111111-1111-4111-8111-111111111111",
        "releaseSequence": 7,
        "status": "published",
        "taskId": "22222222-2222-4222-8222-222222222222"
      }
    }
  ]
}
~~~

| 结果字段 | 用途 |
| --- | --- |
| `result.releaseId` | 管理此发布，传给 `release show/disable/delivery --id` |
| `result.releaseSequence` | 客户端已加载版本跟踪及统计查询，例如上面的 `7` |
| `result.taskId` | 查询此次分发任务，可能省略 |
| `result.stateFile` | 保存本次执行进度的文件路径，失败恢复时使用 |
| `result.warnings` | 非致命警告，例如发布后的回调失败 |
| `error` | 此目标执行失败时返回；多目标要逐项检查 |

`status: published` 表示发布已提交；分发任务成功也只表示服务端任务完成。客户端是否下载、加载成功，需要下一步验收。等待失败或超时可能使命令以 `1` 退出，但已经完成的发布仍然有效，应先检查结果和远端状态。

### 8. 验证客户端能够获取并加载更新

先用 CLI 模拟一个还没安装 OTA 的 Windows 客户端：

~~~bash
pnpm exec ota-cli app check --platform windows --current-version 1.3.10 --installed-release-sequence 0
~~~

`app check` 是公开更新检查接口，不需要 API Key。平台、原生版本和已加载序号都是本次模拟请求的条件，不会修改发布配置。正常应返回可用的 `Release`；`null` 表示当前条件下没有匹配更新。

然后在实际客户端调用第 3 步的 `checkForUpdate`。有更新时，应用需要完成：

1. 按 `updateType` 进入热更新流程，使用 `bundleUrl` 下载资源；`full` 则交给原生安装器流程。
2. 校验资源完整性并解压到独立的候选目录，保留上一份可运行资源。
3. 按应用约定切换资源入口，重新加载或重启；启动失败时按自己的恢复策略退回可用资源。
4. 启动后确认实际加载的是新资源，再把其 `releaseSequence` 保存为当前已加载序号。
5. 上报成功；下载、安装或加载失败则上报失败。

以上是需要接入方实现的客户端流程，SDK 没有 `download/install/restart` 方法，也不规定 ZIP 内部的业务入口。`Release` 类型也不包含 ZIP 的 `checksumSha256`；有完整性或签名校验要求时，需要在应用的资源清单或可信元数据通道中提供校验信息。

上报成功的示例：与 `ota-client.ts` 放在同一目录，在启动后确认加载成功时调用：

~~~ts
import { ota } from './ota-client'

export function reportLoadedUpdate(releaseSequence: number, reportId: string) {
  return ota.reportSuccess({
    platform: 'windows',
    version: '1.3.10',
    releaseSequence,
    reportId
  })
}
~~~

`releaseSequence` 取此次实际加载的发布序号，不能写死为 `7`。`reportId` 由应用为一次安装事件生成 UUID 并持久化；同一事件重试时沿用同一个 UUID 和相同内容，避免重复计数。不要每次普通启动都生成一个新的“安装成功”事件。

失败时调用 `ota.reportFailure`，在相同的基本字段上增加 `message`。应用运行错误使用 `ota.reportAppError` 或 `ota.captureAppError`，它们与安装上报不同，不接受 `releaseSequence/reportId`。

最后，使用实际发布序号查询上报情况；下面的 `7` 要替换为本次序号：

~~~bash
pnpm exec ota-cli statistics summary --release-sequence 7
pnpm exec ota-cli telemetry successes --release-sequence 7
pnpm exec ota-cli telemetry failures --release-sequence 7
~~~

确认新资源已加载、成功上报可查询，并且客户端再次检查时携带新序号。这才完成一次客户端热更新验收。

<a id="daily-release"></a>

## 日常发布

完成首次接入后，每次发布按下面操作：

1. 修改业务代码，运行应用构建脚本生成新的热更新资源。
2. 更新 `ota-cli.config.ts` 中的资源路径、更新说明和目标策略。原生版本没有变化时，热更新的 `targetVersion` 继续使用相同版本；发布序号由服务端分配。
3. 运行试运行命令，核对发布内容。
4. 确认发布环境已注入 API Key，执行正式发布。
5. 在实际客户端验证加载结果，并查询安装上报。

~~~bash
# 项目自身的构建脚本
pnpm build

# 只检查配置和源路径
pnpm exec ota-cli release deploy --dry-run

# 实际上传、创建草稿、发布，并等待服务端分发
pnpm exec ota-cli release deploy --wait
~~~

这两条部署命令会处理配置中的全部平台。只发部分平台时，加 `--target windows` 或 `--target windows,macos`。同次执行、同应用、相同最终 ZIP 内容只上传一次，每个平台分别创建和发布版本。

每次普通 `deploy` 都是一次新的部署和发布。要继续中断的同一次执行，使用原状态文件 `--resume`，参见[发布失败与恢复](#recovery)。

<a id="configuration"></a>

## 命令与配置说明

### 配置从哪里读取

CLI 只在**当前执行目录**中按 `ota-cli.config.ts`、`.js`、`.mjs`、`.cjs` 顺序查找。支持默认导出对象，或返回配置对象的异步函数。

所有连接和部署内容以配置文件为准；不支持 `--base-url`、`--app`、`--key-env`、`--config`、`--no-config`、`--profile`、`--timeout`、`--upload-timeout`，也不读取 `OTA_BASE_URL`。没有配置或配置缺少 `baseURL` 时，执行请求会报错。

`file` 相对配置文件目录解析。若从子目录启动命令，CLI 不会自动向上寻找项目配置，应先切回配置所在目录。

### 配置字段

| 字段 | 含义与使用方式 |
| --- | --- |
| `baseURL` | 完整 API 地址，必须包含 `/api/v1` |
| `appName` | 根应用标识，管理和公开查询命令使用；目标可单独设置 `appName` |
| `accessKeyEnv` | Key 所在的环境变量名称，默认 `OTA_ACCESS_KEY`；填写变量名，不填写 Key |
| `timeout` | 普通请求超时，毫秒，默认 `15000` |
| `uploadTimeout` | 资源上传超时，毫秒，默认 `150000` |
| `defaults` | deploy 的公共发布字段，不会自动用于 `release create --input` |
| `targets` | 以已知平台为键的发布配置；每项可以设置 `file`、`appName` 和发布字段，不含 `platforms` |
| `onPublished` | 远端发布成功后的回调，早于任务等待；失败只返回警告 |
| `onError` | 发布器捕获部署错误后的回调，不包括配置加载等前置错误 |

目标中的主要发布字段：

| 字段 | 含义 |
| --- | --- |
| `targetVersion` | 必填；三段数字原生版本，例如 `1.3.10`，不支持 `v1.3.10`、`1.3.10-beta` |
| 适用平台 | 由 `targets` 的键自动生成；配置中不填写 `platforms` |
| `updateType` | 必填；`hot` 或 `full` |
| `releaseScope` | 必填；`public` 或 `allowlist` |
| `userIds` | 必填数组；公开发布通常用 `[]`，名单项为 `appName:platform:businessId` |
| `file` | ZIP 或待压缩目录；由 CLI 上传 |
| `artifactId` | 使用已上传的资源时指定 |
| `bundleUrl` | 直接使用已有热更新资源 URL 时指定 |
| `installerSourceUrl` | 全量更新使用的原生安装包 URL |
| `architectures` | 可选架构列表，例如 `['x64', 'arm64']` |
| `distributionChannel` | 可选渠道，例如 `stable`；客户端检查时传同一渠道 |
| `releaseNotes` | 更新说明 |
| `mandatory` / `showUpdateDialog` | 更新交互标记，具体交互由客户端实现 |

除自动推导的平台外，必填发布字段可放在 `defaults` 或目标中，合并后齐全即可。`file` 不能与 `artifactId`、`bundleUrl`、`installerSourceUrl` 同时配置。`hot` 需要热更新资源，`full` 需要原生安装包资源或地址。直接使用 SDK 或 `release create --input` 时仍需在 `DraftInput` 中显式提供 `platforms` 数组。

公开类型从 `@eagleway/ota-cli` 导出协议类型；配置、发布器类型从 `@eagleway/ota-cli/node` 导出。类型及字段含 JSDoc 注释，可在编辑器悬停查看。

### deploy 参数

| 参数 | 解释 |
| --- | --- |
| 省略 `--target` | 默认选择 `targets` 中全部已配置平台；没有目标时报错 |
| `--target windows` | 只选择配置中的 Windows 平台，不定义目标内容 |
| `--target windows,macos` | 选择多个不同平台，逗号两侧不要加空格；每个平台都必须已配置 |
| `--dry-run` | 仅做本地配置和源路径检查，打印计划；不上传、不发布 |
| `--wait` | 发布后等待服务端分发任务；不等待客户端安装 |
| `--wait-timeout 300000` | 任务等待上限，毫秒，默认 5 分钟；需配合 `--wait` |
| `--poll-interval 1000` | 查询任务的间隔，毫秒，默认 1 秒；需配合 `--wait` |
| `--state PATH` | 为单个目标指定新的状态文件；该文件不能已经存在 |
| `--resume PATH` | 从单个目标的已有状态文件继续执行 |
| `--json` | 显式声明机器调用；成功结果本身始终是 JSON |
| `--progress auto\|always\|never` | 全局进度选项；默认 `auto`，`--json` 始终关闭进度 |
| `--request-id ID` | 为支持追踪控制的请求设置关联标识 |
| `--help` | 查看对应命令的语法帮助 |

`--state` 和 `--resume` 不能同用，且都只支持单目标。配置了多个平台时，使用它们必须通过 `--target` 只选一个平台；配置仅有一个平台时可以省略选择参数。`deploy` 不再接受 `--file`、`--target-version`、`--update-type`、`--release-notes`、`--installer-source-url`；修改配置文件后重新试运行。

所有成功结果写 stdout，诊断、配置日志和回调日志写 stderr。单命令失败输出结构化错误；多目标失败输出逐项目标结果，并以 `1` 退出。

交互终端默认在 stderr 展示网络请求的等待动画和耗时；短于约 200ms 的普通请求不显示动画。上传显示 multipart 请求体的字节进度、百分比和速度，发送结束后继续等待服务端确认及资源校验。部署依次展示文件准备、上传或资源复用、草稿创建、发布和可选的分发任务状态；任务状态不代表客户端已安装。

CI、非 TTY 和 `--json` 默认不输出新增进度。使用 `--progress always` 可在 CI 或重定向时输出无动画控制字符的阶段日志，上传日志最多每秒刷新一次，任务轮询仅在状态变化时输出；`--progress never` 关闭进度。配置、回调日志和错误仍按上述规则输出。

<a id="recovery"></a>

## 发布失败与恢复

### 先确认失败发生在哪个阶段

CLI 默认把进度写到 `.ota-cli/deployments/` 下，输出中会给出 `stateFile`。状态包含应用、资源/发布 ID、幂等键和执行阶段，不包含 API Key。将 `.ota-cli/` 加入接入项目的 `.gitignore`。

| 失败情况 | 下一步 |
| --- | --- |
| 本地配置或源路径错误 | 修正配置/文件后再试运行 |
| Key 缺失、`401`、`403` | 检查环境变量、Key 有效性及应用权限 |
| 草稿创建或发布请求中断 | 保留原配置和文件内容，用原 `stateFile` 恢复 |
| `Upload outcome unknown` | 上传结果未知，先核对服务端，工具不会自动重新上传 |
| 已发布但任务失败/超时 | 先查发布和任务；不要因退出码为 `1` 就重复创建发布 |
| `taskId` 缺失 | 查 `release delivery` 或按发布 ID 查询任务 |
| 状态文件锁定 | 确认无相关进程后再处理对应 `.lock`，工具不会自动移除旧锁 |

恢复示例：将 `ACTUAL_DEPLOYMENT_ID` 替换为输出中实际状态文件的名称，也可以直接粘贴完整 `stateFile` 路径。

~~~bash
pnpm exec ota-cli release deploy --target windows --resume .ota-cli/deployments/ACTUAL_DEPLOYMENT_ID.json --wait
~~~

恢复时保持服务地址、应用、发布字段和源文件内容一致。恢复会复用原草稿幂等键和发布 ID；修改了文件或发布意图时，应作为新部署处理。网络写请求默认不自动重试。

### 查询远端状态

下面大写的 `RELEASE_UUID`、`TASK_UUID` 都是占位符，分别替换为实际发布 ID 和任务 ID：

~~~bash
# 查看发布详情及其启用状态
pnpm exec ota-cli release show --id RELEASE_UUID

# 查看该发布的分发任务
pnpm exec ota-cli release delivery --id RELEASE_UUID
pnpm exec ota-cli task list --release-id RELEASE_UUID

# 查看某个任务与执行日志
pnpm exec ota-cli task show --id TASK_UUID
pnpm exec ota-cli task logs --id TASK_UUID

# 重新等待一个已有任务，不创建新发布
pnpm exec ota-cli task wait --id TASK_UUID --wait-timeout 300000
~~~

### 停用和重新分发

~~~bash
# 停用指定发布
pnpm exec ota-cli release disable --id RELEASE_UUID

# 重新启用指定发布
pnpm exec ota-cli release enable --id RELEASE_UUID

# 重新分发已有发布的信息
pnpm exec ota-cli release redispatch --id RELEASE_UUID
~~~

停用或重新分发不会替客户端完成资源回滚。客户端可能通过 Socket 收到 `enabled: false` 的更新事件，应按应用的撤销/恢复策略处理。多个目标分别报告结果，不提供跨发布事务，部分目标失败不会撤销其他成功目标。

<a id="advanced-release"></a>

## 进阶发布

### 多平台共用资源包

如果同一份资源兼容三个桌面平台，为每个平台配置一个目标，并指向同一个目录：

~~~ts
import type { OtaCliConfig } from '@eagleway/ota-cli/node'

export default {
  baseURL: 'https://ota.example.com/api/v1',
  appName: 'desktop',
  defaults: {
    targetVersion: '1.3.10',
    updateType: 'hot',
    releaseScope: 'public',
    userIds: []
  },
  targets: {
    windows: {
      file: './build/hot-update'
    },
    macos: {
      file: './build/hot-update'
    },
    linux: {
      file: './build/hot-update'
    }
  }
} satisfies OtaCliConfig
~~~

~~~bash
# 默认处理 windows、macos、linux 三个平台
pnpm exec ota-cli release deploy --dry-run
pnpm exec ota-cli release deploy --wait

# 只处理其中两个平台
pnpm exec ota-cli release deploy --target windows,macos --wait
~~~

默认执行会将同一目录压缩一次、上传一次，然后分别创建并发布三个版本，各自的 `platforms` 分别为 `['windows']`、`['macos']`、`['linux']`。不同平台的 ZIP 只要内容相同，也可在同次执行的同应用中复用上传。

每个平台会获得自己的发布 ID、序号和分发任务。不同应用不会自动共用资源，独立命令之间没有永久上传缓存。执行顺序遵循配置中的键顺序；显式选择时遵循 `--target` 的顺序。确认要发布全部平台后再使用不带选择参数的命令。

### 架构、渠道和名单

一个平台只配置一项目标，架构、渠道和名单都是该目标的字段。下面示例可替换上面的 `targets.windows`：

~~~ts
import type { ReleaseTarget } from '@eagleway/ota-cli/node'

const windows: ReleaseTarget = {
  file: './build/hot-update',
  architectures: ['x64', 'arm64'],
  distributionChannel: 'beta',
  releaseScope: 'allowlist',
  userIds: ['desktop:windows:42']
}
~~~

公共必填字段继续从 `defaults` 继承。`windows-stable`、`windows-x64`、`beta` 都不是合法目标键；如果同一平台需要按不同渠道或架构使用不同文件，分次修改或由配置函数生成对应配置，再选择该平台发布。

本例客户端检查时需传相应架构、`distributionChannel: 'beta'` 和匹配的 `userId`。CLI 模拟：

~~~bash
pnpm exec ota-cli app check --platform windows --current-version 1.3.10 --installed-release-sequence 0 --architecture x64 --distribution-channel beta --user-id desktop:windows:42
~~~

### 全量安装包更新

全量发布使用 `updateType: 'full'` 和客户端可访问的安装包地址。例如，把 `targets.windows` 替换为下面的配置：

~~~ts
import type { ReleaseTarget } from '@eagleway/ota-cli/node'

const windows: ReleaseTarget = {
  targetVersion: '1.4.0',
  updateType: 'full',
  releaseScope: 'public',
  userIds: [],
  installerSourceUrl: 'https://downloads.example.com/desktop-1.4.0.exe'
}
~~~

命令为 `pnpm exec ota-cli release deploy --target windows`。这里不设置 `file`，安装包应先由你的构建/存储流程上传；CLI 不负责上传 EXE/APK/DMG。客户端使用自己的安装器流程安装 `installerSourceUrl`。

热更新要求 `targetVersion === currentVersion` 且发布序号更高；全量更新按三段数字比较版本，目标版本更高的全量包优先。平台、架构、渠道和用户范围也会影响匹配。

### 分阶段上传、建草稿和发布

通常使用 `deploy` 即可。如果流程要求先上传、审核草稿、再正式发布，可以拆成三步。以下命令都使用配置文件根层的应用和连接设置。

第一步，只上传目录或 ZIP：

~~~bash
pnpm exec ota-cli artifact upload --file ./build/hot-update
~~~

该命令返回 `Artifact`，包含 `artifactId`、`url`、`sizeBytes`、`checksumSha256`；不会创建草稿或发布。此处 `--file` 是独立上传操作的输入，不会改写 `targets`。

第二步，创建 `release.json`，把 `artifactId` 替换成刚才返回的实际资源 ID：

~~~json
{
  "targetVersion": "1.3.10",
  "platforms": ["windows"],
  "updateType": "hot",
  "releaseScope": "public",
  "userIds": [],
  "mandatory": false,
  "showUpdateDialog": true,
  "releaseNotes": "修复首页显示问题",
  "artifactId": "替换为上传返回的实际 artifactId"
}
~~~

~~~bash
pnpm exec ota-cli release create --input release.json --idempotency-key desktop-1.3.10-hotfix-001
~~~

`--input` 读取完整 `DraftInput` JSON，不与配置中的 `defaults/targets` 合并。`--idempotency-key` 标识一次草稿创建操作；重试相同操作沿用同一个值，新的发布操作使用新值。返回的 `draft.releaseId` 用于下一步。

第三步，检查草稿并显式发布：

~~~bash
pnpm exec ota-cli release show --id RELEASE_UUID
pnpm exec ota-cli release publish --id RELEASE_UUID
~~~

其他草稿和策略操作：

| 命令 | 用途 |
| --- | --- |
| `release list --status draft` | 查看草稿列表 |
| `release list --status published` | 查看已发布列表 |
| `release update --id RELEASE_UUID --input patch.json` | 修改草稿，JSON 使用部分 `DraftInput` 字段 |
| `release users --id RELEASE_UUID` | 查看发布用户名单 |
| `release set-users --id RELEASE_UUID --input users.json --expected-revision N` | 用字符串数组替换名单 |
| `release set-scope --id RELEASE_UUID --scope allowlist --expected-revision N` | 修改发布范围 |

表内命令前均加 `pnpm exec ota-cli`。`N` 替换为当前策略修订号，用于并发校验；`users.json` 示例为 `["desktop:windows:42"]`。

### CI 发布与多环境

CI 中按顺序安装依赖、构建资源、执行试运行、再发布，并通过 CI Secret 注入 Key。运行目录必须是配置文件所在目录。成功结果可保存为 JSON：

~~~bash
pnpm install --frozen-lockfile
pnpm build
pnpm exec ota-cli release deploy --dry-run
pnpm exec ota-cli release deploy --wait --json > deployment-result.json
~~~

CI 也可以使用项目现有的包管理器，发布命令与本机相同：

~~~bash
# npm：仓库有 package-lock.json 时使用 npm ci
npm ci
npm run build
npm exec -- ota-cli release deploy --dry-run
npm exec -- ota-cli release deploy --wait --json > deployment-result.json
~~~

~~~bash
# Yarn：按项目已经锁定的 Yarn 版本安装依赖
yarn install
yarn run build
yarn run ota-cli release deploy --dry-run
yarn run ota-cli release deploy --wait --json > deployment-result.json
~~~

`deployment-result.json` 的 `deployments` 逐项记录目标结果；同时检查退出码。若需要恢复一次中断的部署，应保留对应 `.ota-cli/deployments/` 状态文件及相同的源文件。

多环境选择逻辑写在配置文件中，例如默认导出函数根据项目环境变量返回不同的 `baseURL` 和 `accessKeyEnv`。CLI 不提供 `profiles` 或终端配置覆盖。指定的凭证变量缺失时，不回退到其他 Key。

<a id="reference"></a>

## 查询与其他 SDK

### 包入口

| 入口 | 用途 |
| --- | --- |
| `@eagleway/ota-cli` | 客户端更新检查、安装及运行错误上报 |
| `@eagleway/ota-cli/manage` | 受控后端的发布、消息与管理查询 |
| `@eagleway/ota-cli/node` | Node 压缩、资源上传、发布编排和配置类型 |
| `@eagleway/ota-cli/ws` | Socket.IO 订阅、更新通知和消息 ACK |

SDK 提供 ESM、CommonJS 和类型声明。只有使用 Socket SDK 时才需要额外安装 `socket.io-client`，或自行提供适配器。

### 统计、任务和审计

~~~bash
# 安装记录与运行错误
pnpm exec ota-cli statistics summary --release-sequence 7
pnpm exec ota-cli telemetry successes --release-sequence 7 --page-size 100
pnpm exec ota-cli telemetry failures --release-sequence 7
pnpm exec ota-cli telemetry app-errors --kind crash

# 分发任务与应用审计
pnpm exec ota-cli task list --status running
pnpm exec ota-cli audit list --operation-id OPERATION_UUID
~~~

`7` 和 `OPERATION_UUID` 替换为实际发布序号和操作标识。分页命令支持 `--page`、`--page-size`（最多 100）；汇总不分页。时间查询使用带时区的 `--from/--to`，默认范围由服务端决定（通常最近 30 天），单次最多 90 天。

任务和审计可永久保存，查询更早数据时显式指定时间并分段查询；90 天是单次查询窗口限制。计数是上报记录数或分发计数，不能直接当成独立安装人数。读取完整审计时，应按 `operation_id/part_no` 组织分段。

### 普通消息

~~~bash
pnpm exec ota-cli message subscriptions
pnpm exec ota-cli message application --data-file notice.json
pnpm exec ota-cli message user --user-id desktop:windows:42 --data-file notice.json
pnpm exec ota-cli message device --unique-id device-1 --resend
~~~

`notice.json` 中填写任意合法 JSON，例如 `{"notice":"maintenance"}`。`--data-file` 与直接传 JSON 的 `--data` 二选一；`--resend` 请求重发。普通业务消息与 OTA 发布和重新分发相互独立。

### 管理 SDK 与 Node 发布器

管理 SDK 供可信后端使用，由第三方后台自行认证它的用户：

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
~~~

`/node` 入口提供 `createPublisher`、`uploadArtifact` 和 `waitForTask`。Publisher 可在同一实例中复用同应用资源；`deployMany` 会在首次写请求前校验全部目标并准备文件，然后逐项目标执行。使用后在 `finally` 中调用 `publisher.close()` 清理临时 ZIP。

Node SDK 仅在显式传入 `stateFile` 时写恢复状态，CLI 默认保存。SDK 参数与 CLI 配置互相独立，`DeployTarget` 需要传完整 `release`。

HTTP SDK 支持可选的 `fetch` 参数以注入 Fetch 实现，以及 `onRequest(event)` 请求生命周期观察器。Publisher 支持 `onProgress(event)` 阶段和上传字节观察器，`waitForTask` 的第四个参数也支持 `onProgress`。SDK 默认保持静默，观察器异常不会改变操作结果。上传字节指进入请求流的数据，不表示服务端已确认接收；超时覆盖请求和响应体读取。

### Socket 更新通知

先完成 HTTP 检查和客户端安装流程，再按需接入实时通知：

| npm | Yarn | pnpm |
| --- | --- | --- |
| `npm install socket.io-client` | `yarn add socket.io-client` | `pnpm add socket.io-client` |

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
  if (!release.enabled) {
    // 应用在此处理发布撤销，勿把此事件当成新的更新包安装。
    return
  }
  // 交给与 HTTP 检查共用的客户端更新流程；SDK 不自动下载或安装。
  console.info('Update available:', release.releaseSequence)
})

await ws.subscribeApp({
  appName: 'desktop',
  platform: 'windows',
  currentVersion: '1.3.10',
  installedReleaseSequence: 0
})
~~~

`serverURL` 是 origin，不含 `/api/v1`；反向代理 Socket 路径通过 `path` 设置。Socket 只用 WebSocket transport，不携带 API Key。此示例的 `0` 只适用于从未加载 OTA 的客户端，实际接入时使用当前已加载序号。

重连会恢复当前订阅和最近的上下文；实际加载新资源后，再次 `subscribeApp` 更新序号。HTTP 检查可继续用于启动时查更，不应只依赖在线推送。

业务消息可通过 `onApplicationMessage` 接收。用户和设备消息分别通过 `subscribeUser/onUserMessage`、`subscribeDevice/onDeviceMessage` 接入；需要 ACK 的消息在业务处理成功后调用 `ackUser/ackDevice`，SDK 不自动提前确认。同一个设备标识按应用隔离。

`unsubscribeApp/unsubscribeUser/unsubscribeDevice` 移除订阅及重连意图；`suspend` 暂停连接并保留意图，`connect` 恢复；`disconnect` 释放实例，之后需要重新创建。

<a id="faq"></a>

## 常见问题

| 现象 | 检查方式 |
| --- | --- |
| 不带 `--target` 会发到哪里？ | 发布 `targets` 中全部已配置平台；不会自动添加未配置的平台 |
| `--target windows` 是在终端定义目标吗？ | 不是。它选择配置中已有的 `targets.windows` |
| `Unknown target platform` | 配置键只能是 `windows/macos/linux/android/ios`，不能使用 `desktop` 或架构/渠道组合 |
| `Unknown release target` | 指定的平台未在 `targets` 中配置 |
| `No release targets configured` | 配置中没有可发布目标，先填写 `targets` |
| `Unknown fields: platforms` | 从 `defaults` 和平台目标中移除该字段；CLI 从目标键推导平台 |
| `baseURL is required in ota-cli.config` | 切回配置文件所在目录，检查配置导出和 `baseURL` |
| `Missing API Key in environment variable ...` | 在同一个终端或 CI 任务中设置 `accessKeyEnv` 指定的变量 |
| `401` / `403` | `401` 检查 Key 是否无效、到期或撤销；`403` 检查应用授权和操作权限 |
| 热更新为什么不是把 `1.3.10` 改成 `1.3.11`？ | 热更新适配当前原生版本，按更高的发布序号区分；原生版本升级走 `full` |
| 已发布但检查返回 `null` | 检查是否正式发布且启用；核对应用、原生版本、平台、架构、渠道、名单及已加载序号 |
| `--wait` 成功但客户端没更新 | 检查客户端是否执行查更或订阅、资源 URL 是否可访问、下载/加载流程是否实现 |
| CLI 发布成功等于安装成功吗？ | 不等于。实际加载确认后由客户端上报，再查询上报记录 |
| 修改包后又执行一次 deploy 会怎样？ | 产生新部署；恢复上次执行应使用原状态文件和相同输入 |
| 目录包含符号链接 | 构建独立的资源目录后再上传，不要把依赖目录整体作为更新包 |

SDK 2.0.0 需与配套的 OTA API 和客户端协议同步使用。真实 OTA 服务、资源存储和客户端运行时应进行一次完整的发布、下载、加载与失败恢复验收。

## 本仓库开发验证

以下命令用于开发 ota-cli 本身，客户端项目的业务构建脚本由各项目提供：

~~~bash
pnpm install --frozen-lockfile
pnpm test:verify
~~~

测试集中在 `test/`，覆盖本机 HTTP/CLI、类型消费者、浏览器打包、Socket 生命周期及发布恢复；使用隔离测试服务，不访问生产库或资源存储。构建和验证命令不会发布 npm 包。
