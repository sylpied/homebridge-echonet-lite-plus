const fs = require('node:fs')
const path = require('node:path')
const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils')
class EchonetLiteUiServer extends HomebridgePluginUiServer {
  constructor() {
    super()
    this.onRequest('/rediscover', async () => {
      fs.writeFileSync(path.join(this.homebridgeStoragePath, 'echonet-lite-plus-rediscover.json'), JSON.stringify({ requestedAt: Date.now() }))
      return { accepted: true }
    })
    this.onRequest('/devices', async () => {
      try {
        return JSON.parse(fs.readFileSync(path.join(this.homebridgeStoragePath, 'echonet-lite-plus-devices.json'), 'utf8'))
      } catch {
        return { devices: [], updatedAt: 0 }
      }
    })
    this.ready()
  }
}
(() => new EchonetLiteUiServer())()
