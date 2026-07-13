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
  logLevel?: 'error'|'warn'|'info'|'debug';
}
