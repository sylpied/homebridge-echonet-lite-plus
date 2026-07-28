# Changelog

## 0.7.5

- Fixed individual device removal being undone by automatic discovery after a child-bridge restart.
- Removed device cards now disappear immediately and are restored if the deletion request fails.
- Normalized device identifiers to prevent case differences from restoring removed history entries.

## 0.7.4

- Added a detected-device history clear action that removes persisted discovery results and per-device choices without allowing Homebridge accessory-cache fallbacks to restore stale devices.
- Added per-device removal for equipment that has been decommissioned; a later live rediscovery automatically restores it.
- A newly detected live ECHONET Lite device automatically ends the cleared-history state.

## 0.7.3

- Clarified how HEMS commonly uses ECHONET Lite and why some HEMS-compatible devices may be discoverable by this plugin.
- Documented that standard ECHONET Lite air-conditioner temperature control uses 1°C steps, while manufacturer-specific local APIs may support 0.5°C.
- Rejected fractional numeric writes that an ECHONET property schema cannot represent instead of silently rounding them.
- Corrected cumulative water-meter unit multipliers to match MRA 1.4.0 EPC E1.
- Prevented undefined or unmeasurable MRA states from being sent to HomeKit as `NaN`.
- Aligned the declared Node.js versions with the versions supported by Homebridge.
- Preserved the last air-conditioner Active and mode values across partial ECHONET Lite INF updates.

## 0.7.2

- Added the MRA redistribution notice and clarified the relationship between HEMS and ECHONET Lite.
- Documented standard ECHONET Lite air-conditioner temperature control in 1°C steps.

## 0.7.1

- Added a bilingual `NOTICE-MRA.md` identifying the ECHONET Consortium as the copyright holder and documenting the source of the bundled MRA data.
- Clarified that the plugin's MIT License does not alter the copyright, license, or other terms applicable to the MRA data.
- Hardened ECHONET Lite property-map parsing against malformed and duplicate EPC entries.

## 0.7.0

- Kept disabled devices out of Apple Home while retaining the complete discovered-device registry in the settings UI.
- Newly discovered devices now remain disabled until the user explicitly publishes them to HomeKit.
- Added bilingual per-device publication, naming and property controls to the custom configuration UI.
- Added reliable rediscovery handling with save/restart guidance and cached-list fallbacks.
- Added regression coverage for all-devices-off operation and Apple Home/extended meter-mode transitions.
- Removed routine custom-UI diagnostic logging and no longer reports a missing first-run device cache as an error.

## 0.6.6

- Aligned custom UI server loading with the current `@homebridge/plugin-ui-utils` 2.2.5 dynamic-import pattern used by the reference plugins.
- Added an IPC integration test that starts the real UI server and verifies a seven-device `/devices` response.
- Added a cache integration test that verifies all seven detected devices are written even when some are not published to HomeKit.

## 0.6.5

- Fixed a regression where opt-in filtering ran before the settled ECHONET facility list was saved, causing disabled devices to disappear from the settings page.
- Kept every detected device in the configuration list while applying opt-in filtering only to HomeKit publication.
- Added an Info log with the number of devices written to the detected-device cache.

## 0.6.4

- Added server-pushed device-list and restart-status events for Homebridge UI environments where custom request responses do not resolve reliably.
- Pushed the refreshed device cache to the settings page automatically after rediscovery.

## 0.6.3

- Preserved the complete configured device list when the live UI device-cache request is delayed or unavailable.
- Merged saved device settings, Homebridge accessory cache and live discovery results instead of falling back to published accessories only.

## 0.6.2

- Prevented the custom settings page from waiting indefinitely for UI-server status requests.
- Rendered the settings form immediately and loaded restart/discovery status asynchronously with explicit timeouts.

## 0.6.1

- Changed newly discovered devices to opt-in: they remain off until explicitly enabled for HomeKit.
- Blocked rediscovery while saved settings are waiting for a child bridge restart.
- Added bilingual guidance for saving and restarting after changing meter compatibility or device publication settings.

## 0.6.0

- Added periodic GET polling for devices that do not send state-change notifications.
- Added HomeKit mappings for air-conditioning ventilators, shutters, water heaters, bathroom heater/dryers, floor heating, hybrid water heaters and JEM-A/HA switches.
- Added read-only extended measurements for residential solar generation and EV charge/discharge equipment.
- Kept non-standard meter and energy values hidden in Apple Home compatible mode instead of representing them as unrelated HomeKit sensor types.
- Added safe handling for detected but unmapped device classes.
- Improved MRA decoding and encoding when a device defines multiple release-specific schemas for the same EPC.

## 0.5.6

- Added direct ECHONET Lite communication over UDP/3610 without MQTT.
- Added MRA 1.4.0 based property discovery, decoding and encoding.
- Added HomeKit mappings for air conditioners, lighting, temperature and humidity sensors, locks and fans.
- Added Apple Home compatible and extended display modes for electricity, distribution board, water and gas meters.
- Added a bilingual English/Japanese custom configuration UI with device discovery and per-device property selection.
- Limited frequent INF/push packet logging to Debug level.
- Prevented repeated disk and Homebridge cache writes for unchanged push data.
- Fixed ECHONET property-map parsing, empty SET response handling and air-conditioner target-temperature conversion.
- Added automated tests for MRA conversion, property maps, meter compatibility and SET response handling.
