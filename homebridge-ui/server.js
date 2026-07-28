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
      const clearedMarker = () => path.join(storagePath(), 'echonet-lite-plus-device-history-cleared')
      const removedFile = () => path.join(storagePath(), 'echonet-lite-plus-removed-device-ids.json')
      const canonicalId = value => typeof value === 'string' ? value.trim().toLowerCase() : ''
      const readRemovedIds = () => {
        try { const value = JSON.parse(fs.readFileSync(removedFile(), 'utf8')); return Array.isArray(value) ? value.map(canonicalId).filter(Boolean) : [] } catch { return [] }
      }
      const readDevices = () => {
        const file = deviceFile()
        try {
          const result = JSON.parse(fs.readFileSync(file, 'utf8'))
          if (!Array.isArray(result?.devices)) throw new Error('devices is not an array')
          return { ...result, cleared: fs.existsSync(clearedMarker()), removedIds: readRemovedIds() }
        } catch (error) {
          if (error?.code === 'ENOENT') return { devices: [], updatedAt: 0, cleared: fs.existsSync(clearedMarker()), removedIds: readRemovedIds() }
          console.error(`ECHONET Lite device cache could not be read: ${file}: ${String(error)}`)
          return { devices: [], updatedAt: 0, cleared: fs.existsSync(clearedMarker()), removedIds: readRemovedIds() }
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
      this.onRequest('/clear-devices', async () => {
        fs.rmSync(deviceFile(), { force: true })
        fs.rmSync(removedFile(), { force: true })
        fs.writeFileSync(clearedMarker(), String(Date.now()))
        const result = { devices: [], updatedAt: Date.now(), cleared: true }
        this.pushEvent('echonet-devices', result)
        return result
      })
      this.onRequest('/remove-device', async payload => {
        // Accept both the documented direct payload and the wrapped form used
        // by some Homebridge UI releases.
        const id = canonicalId(payload?.id ?? payload?.body?.id)
        if (!id) throw new Error('A device id is required')
        const current = readDevices()
        const devices = current.devices.filter(device => canonicalId(device?.id) !== id)
        fs.writeFileSync(deviceFile(), JSON.stringify({ devices, updatedAt: Date.now() }))
        const removedIds = [...new Set([...readRemovedIds(), id])]
        fs.writeFileSync(removedFile(), JSON.stringify(removedIds))
        const result = { devices, updatedAt: Date.now(), removedIds }
        this.pushEvent('echonet-devices', result)
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
