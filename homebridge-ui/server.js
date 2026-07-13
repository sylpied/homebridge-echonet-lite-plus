const fs = require('node:fs')
const path = require('node:path')
;(async () => {
  const { HomebridgePluginUiServer } = await import('@homebridge/plugin-ui-utils')
  class EchonetLiteUiServer extends HomebridgePluginUiServer {
    constructor() {
      super()
      const storagePath = () => {
        if (!this.homebridgeStoragePath) throw new Error('Homebridge storage path is unavailable')
        return this.homebridgeStoragePath
      }
      const restartMarker = () => path.join(storagePath(), 'echonet-lite-plus-restart-required')
      const deviceFile = () => path.join(storagePath(), 'echonet-lite-plus-devices.json')
      const readDevices = () => {
        const file = deviceFile()
        try {
          const result = JSON.parse(fs.readFileSync(file, 'utf8'))
          if (!Array.isArray(result?.devices)) throw new Error('devices is not an array')
          return result
        } catch (error) {
          if (error?.code === 'ENOENT') return { devices: [], updatedAt: 0 }
          console.error(`ECHONET Lite device cache could not be read: ${file}: ${String(error)}`)
          return { devices: [], updatedAt: 0 }
        }
      }
      const pushDevices = () => this.pushEvent('echonet-devices', readDevices())
      this.onRequest('/settings-changed', async () => {
        fs.writeFileSync(restartMarker(), String(Date.now()))
        this.pushEvent('echonet-settings-status', { restartRequired: true })
        return { restartRequired: true }
      })
      this.onRequest('/settings-status', async () => {
        const status = { restartRequired: fs.existsSync(restartMarker()) }
        this.pushEvent('echonet-settings-status', status)
        return status
      })
      this.onRequest('/rediscover', async () => {
        if (fs.existsSync(restartMarker())) {
          this.pushEvent('echonet-settings-status', { restartRequired: true })
          return { accepted: false, restartRequired: true }
        }
        fs.writeFileSync(path.join(storagePath(), 'echonet-lite-plus-rediscover.json'), JSON.stringify({ requestedAt: Date.now() }))
        setTimeout(pushDevices, 6500)
        return { accepted: true }
      })
      this.onRequest('/devices', async () => {
        const result = readDevices()
        // Send the normal request response first, then provide the same list as
        // a stream event. Some Homebridge UI/browser combinations have lost a
        // request response while keeping the custom UI process alive.
        setTimeout(() => this.pushEvent('echonet-devices', result), 0)
        return result
      })
      this.ready()
    }
  }
  new EchonetLiteUiServer()
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
