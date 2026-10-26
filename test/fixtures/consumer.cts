import app = require('@eagleway/ota-cli')
import manage = require('@eagleway/ota-cli/manage')
import node = require('@eagleway/ota-cli/node')
import ws = require('@eagleway/ota-cli/ws')
const client = app.createAppClient({ baseURL: 'https://example.test/api/v1', appName: 'desktop' })
void client.checkUpdate({ platform: 'windows', currentVersion: '1.3.10' })
// @ts-expect-error App entry must not export management operations.
app.createManageClient({})
void manage.createManageClient
void node.createPublisher
void ws.createWsClient
