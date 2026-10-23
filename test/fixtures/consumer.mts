import { createAppClient, type Release } from '@eagleway/ota-cli'
import { createManageClient } from '@eagleway/ota-cli/manage'
import { createPublisher, type OtaCliConfig } from '@eagleway/ota-cli/node'
import { createWsClient, type WsAdapter } from '@eagleway/ota-cli/ws'
const client = createAppClient({ baseURL: 'https://example.test/api/v1', appName: 'desktop' })
void client.checkUpdate({ platform: 'windows', nativeVersionCode: 100 })
// @ts-expect-error App clients do not accept a management key.
createAppClient({ baseURL: 'https://example.test/api/v1', appName: 'desktop', accessKey: 'secret' })
// @ts-expect-error Installation reports require a release sequence.
client.reportSuccess({ platform: 'windows', versionCode: 110 })
const result: Partial<Release> = { bundleUrl: null, mandatory: false }
const config: OtaCliConfig = { targets: { desktop: { platforms: ['windows', 'macos', 'linux'] } } }
void result
void config
void createManageClient
void createPublisher
void createWsClient
const adapter: WsAdapter | undefined = undefined
void adapter
