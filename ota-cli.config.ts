import type { OtaCliConfig } from '@eagleway/ota-cli/node'

const config: OtaCliConfig = {
  baseURL: 'http://127.0.0.1:3001/api/v1',
  appName: 'app-demo',
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
      targetVersion: '1.3.10',
      platforms: ['windows', 'macos', 'linux']
    }
  },
  onPublished(result) {
    console.info('Published release:', result.releaseId)
  }
}
export default config
