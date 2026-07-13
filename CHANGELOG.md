# Changelog

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

