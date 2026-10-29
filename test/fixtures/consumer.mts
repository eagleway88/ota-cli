import { createAppClient, type Release } from '@eagleway/ota-cli'
import { createManageClient } from '@eagleway/ota-cli/manage'
import { createPublisher, type OtaCliConfig, type ReleaseTarget } from '@eagleway/ota-cli/node'
import { createWsClient, type WsAdapter } from '@eagleway/ota-cli/ws'
const client = createAppClient({ baseURL: 'https://example.test/api/v1', appName: 'desktop' })
createAppClient({
  baseURL: 'https://example.test/api/v1',
  appName: 'desktop',
  fetch: globalThis.fetch,
  onRequest: (event) => {
    const phase: 'start' | 'success' | 'error' = event.phase
    void phase
  }
})
void client.checkUpdate({ platform: 'windows', currentVersion: '1.3.10' })
// @ts-expect-error App clients do not accept a management key.
createAppClient({ baseURL: 'https://example.test/api/v1', appName: 'desktop', accessKey: 'secret' })
// @ts-expect-error Installation reports require a release sequence.
client.reportSuccess({ platform: 'windows', version: '1.3.10' })
const result: Partial<Release> = { bundleUrl: null, mandatory: false }
const config: OtaCliConfig = { targets: { windows: {}, macos: {}, linux: {} } }
// @ts-expect-error CLI targets must use known platform names.
const invalidTargets: OtaCliConfig = { targets: { desktop: {} } }
// @ts-expect-error The target key determines the platform.
const invalidTarget: ReleaseTarget = { platforms: ['windows'] }
// @ts-expect-error Common release defaults cannot override target platforms.
const invalidDefaults: OtaCliConfig = { defaults: { platforms: ['windows'] } }
void invalidTargets
void invalidTarget
void invalidDefaults
void result
void config
void createManageClient
void createPublisher
void createWsClient
const adapter: WsAdapter | undefined = undefined
void adapter
