# @eagleway/ota-cli

用于调用 ota-api 的 CLI 与 SDK。

## 能力

- 通过命令行调用 ota-api 的全部现有接口
- 导出 `check`、`success`、`error` 三个 SDK 方法，兼容 React Native、Electron Renderer、Electron Main
- 支持 `ota-cli.config.ts` 配置文件
- 支持受保护接口自动登录换取 token
- 支持 ESM、CommonJS、TypeScript 类型声明

## 安装

```bash
npm install @eagleway/ota-cli axios
```

全局安装 CLI：

```bash
npm install -g @eagleway/ota-cli axios
```

说明：

- `axios` 作为 peer dependency，由外部项目决定安装版本
- CLI 命令名仍然是 `ota-cli`

## 配置文件

在执行命令的目录下创建 `ota-cli.config.ts`：

```ts
import type { OtaCliConfig } from '@eagleway/ota-cli'

const config: OtaCliConfig = {
  baseURL: 'http://127.0.0.1:3001',
  timeout: 15000,
  name: 'app-demo',
  ver: 101,
  platform: 'ios,android',
  desc: '1.0.1 update',
  mandatory: 1,
  iosPath: './dist/ios/main.bundle',
  androidPath: './dist/android/index.bundle',
  auth: {
    username: 'admin',
    password: '123456'
  },
  onSuccess(result) {
    console.log('create/upload success', result)
  },
  onError(error) {
    console.error('create/upload failed', error)
  }
}

export default config
```

说明：

- `baseURL` 可以写成 `http://127.0.0.1:3001`，内部会自动补成 `/api`
- 命令行参数优先级高于配置文件
- 受保护接口可传 `--token`
- 也可传 `--auth-username` 和 `--auth-password` 自动登录
- 如果没有 token 和账号密码，CLI 会在控制台交互输入账号密码
- 登录成功后会把 token 缓存到本机，后续受保护命令优先复用缓存
- 如果接口返回 `401` 或 `403`，CLI 会自动清除本机缓存 token，并重新登录后重试一次受保护请求
- `OtaCliConfig` 支持 `CreatePayload` 的所有可选字段，`create` 和 `upload` 会优先使用命令行参数，其次回退到配置文件
- `iosPath`、`androidPath`、`windowsPath`、`linuxPath`、`macosPath` 用于 `upload` 自动选择上传文件
- `upload` 优先按 `--platform` 拆分后的平台顺序匹配对应 `*Path`，如果没有传 `--platform`，则按当前命令行运行环境匹配
- `upload` 只接受 `.zip` 文件或目录：
- 如果是 `.zip` 文件则直接上传
- 如果是目录则先压缩成临时 `.zip` 再上传
- 如果是其它类型则直接报错
- `onSuccess` 和 `onError` 只在 CLI 的 `create`、`upload` 命令中执行，并接收实际结果或错误对象

## CLI 用法

查看帮助：

```bash
ota-cli --help
ota-cli version --help
```

CLI 在执行时会输出关键过程日志，例如：

- 加载配置
- 是否命中本地 token 缓存
- 是否触发登录
- 接口调用开始与完成
- 401/403 自动清理缓存 token
- create/upload 的回调执行

### 管理员接口

创建管理员：

```bash
ota-cli admin create --base-url http://127.0.0.1:3001 --username admin --password 123456
```

登录：

```bash
ota-cli admin login --base-url http://127.0.0.1:3001 --username admin --password 123456
```

### 通知接口

发送通知：

```bash
ota-cli notify send --type ota-update --data '{"ver":101}'
```

### 版本接口

检查更新：

```bash
ota-cli version check --name app-demo --ver 100 --platform ios --channel appstore
```

创建全量更新：

```bash
ota-cli version create \
  --name app-demo \
  --ver 101 \
  --platform ios,android \
  --desc "1.0.1 full update" \
  --install-url https://cdn.example.com/app-demo-1.0.1.apk \
  --mandatory 1 \
  --auth-username admin \
  --auth-password 123456
```

上传热更新包：

```bash
ota-cli version upload \
  --name app-demo \
  --ver 101 \
  --platform ios,android \
  --desc "1.0.1 hot update" \
  --auth-username admin \
  --auth-password 123456
```

如果没有传 `--file`，CLI 会尝试从 `ota-cli.config.ts` 的 `iosPath`、`androidPath` 等字段自动解析上传文件。

上传文件规则：

- `.zip` 文件会直接上传
- 目录会被压缩成临时 `.zip` 后上传
- 其它文件类型会直接报错

上报更新成功：

```bash
ota-cli version success \
  --name app-demo \
  --platform ios \
  --ver 101 \
  --ver-id 12 \
  --username byron \
  --extras '{"device":"iphone"}'
```

上报更新失败：

```bash
ota-cli version error \
  --name app-demo \
  --platform ios \
  --ver 101 \
  --ver-id 12 \
  --message "apply patch failed" \
  --extras '{"device":"iphone"}'
```

更新已有错误记录：

```bash
ota-cli version error \
  --id 5 \
  --name app-demo \
  --platform ios \
  --ver 101 \
  --ver-id 12 \
  --message "retry failed"
```

## SDK 用法

### React Native / Electron

```ts
import { check, success, error } from '@eagleway/ota-cli'

const baseURL = 'http://127.0.0.1:3001'

const latest = await check(
  { baseURL },
  {
    name: 'app-demo',
    ver: 100,
    platform: 'ios',
    channel: 'appstore'
  }
)

await success(
  { baseURL },
  {
    name: 'app-demo',
    platform: 'ios',
    ver: 101,
    verId: 12,
    extras: {
      device: 'iphone'
    }
  }
)

await error(
  { baseURL },
  {
    name: 'app-demo',
    platform: 'ios',
    ver: 101,
    verId: 12,
    message: 'apply patch failed',
    extras: {
      device: 'iphone'
    }
  }
)
```

### 创建客户端

```ts
import { createOtaClient } from '@eagleway/ota-cli'

const client = createOtaClient({
  baseURL: 'http://127.0.0.1:3001',
  token: 'your-token'
})

const token = await client.admin.login({
  username: 'admin',
  password: '123456'
})

const version = await client.version.check({
  name: 'app-demo',
  ver: 100,
  platform: 'android'
})
```

## 发布

```bash
npm run build
# 带 Scope 的包默认是私有的，直接发布可能会失败，需要添加 --access public 参数
npm publish --access public
```
