import app = require('@eagleway/ota-cli')
import manage = require('@eagleway/ota-cli/manage')
import node = require('@eagleway/ota-cli/node')
import ws = require('@eagleway/ota-cli/ws')
const client = app.createAppClient({ baseURL: 'https://example.test/api/v1', appName: 'desktop' })
void client.checkUpdate({ platform: 'windows', currentVersion: '1.3.10' })
// @ts-expect-error App entry must not export management operations.
app.createManageClient({})
const config: node.OtaCliConfig = { targets: { windows: {}, ios: {}, android: {} } }
// @ts-expect-error CLI targets cannot combine a platform and channel in the key.
const invalidTargets: node.OtaCliConfig = { targets: { 'windows-stable': {} } }
// @ts-expect-error Platform selection is inferred from the target key.
const invalidTarget: node.ReleaseTarget = { platforms: ['windows'] }
void config
void invalidTargets
void invalidTarget
void manage.createManageClient
void node.createPublisher
void ws.createWsClient
