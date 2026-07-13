import type { PlatformConfig } from 'homebridge';

export interface EchonetConfig extends PlatformConfig {
  language?: 'auto'|'en'|'ja';
  targetNetwork?: string;
  knownDeviceIps?: string[];
  autoDiscovery?: boolean;
  includeDevices?: string[];
  excludeDevices?: string[];
  deviceSettings?: Array<{id:string;name?:string;enabled?:boolean;properties?:string[]}>;
  meterDisplayMode?: 'appleHome'|'extended';
  pollInterval?: 0|30|60|300;
  logLevel?: 'error'|'warn'|'info'|'debug';
}
