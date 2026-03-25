import type { OtaCliConfig } from '@eagleway/ota-cli'

const config: OtaCliConfig = {
  baseURL: 'http://127.0.0.1:3001',
  timeout: 15000,
  name: 'app-demo',
  ver: 101,
  platform: 'ios',
  desc: '1.0.1 update',
  mandatory: 1,
  iosPath: './test/ios',
  androidPath: './test/android',
  onSuccess(result) {
    console.log('create/upload success', result)
  },
  onError(error) {
    console.error('create/upload failed', error)
  }
}

export default config