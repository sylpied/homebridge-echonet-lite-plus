import {EchonetLitePlatform} from './platform';
import {MraRepository} from './mra';
import * as EL from 'echonet-lite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('ECHONET Lite property handling',()=>{
  const platform=Object.create(EchonetLitePlatform.prototype) as any;

  test('parses list and bitmap property maps',()=>{
    expect(Object.keys(platform.propertyRequests('0380b0b3'))).toEqual(['80','b0','b3']);
    expect(Object.keys(platform.propertyRequests(`1040${'00'.repeat(15)}`))).toEqual(['e0']);
  });

  test('rejects malformed property maps and removes duplicate EPC entries',()=>{
    expect(platform.propertyRequests('03zz80')).toEqual({});
    expect(Object.keys(platform.propertyRequests('038080b0'))).toEqual(['80','b0']);
  });

  test('requests energy conversion dependencies with cumulative energy',()=>{
    platform.config={deviceSettings:[{id:'meter',properties:['e0']}]};
    expect(platform.selectedDetails('meter',{d3:'00000001',e0:'00000064',e1:'00',e7:'00000100'})).toEqual({d3:'00000001',e0:'00000064',e1:'00'});
  });

  test('applies Apple Home meter compatibility rules',()=>{
    platform.config={meterDisplayMode:'appleHome'};
    expect(platform.meterAllowed('028801')).toBe(false);
    expect(platform.meterAllowed('028101')).toBe(true);
    platform.config={meterDisplayMode:'extended'};
    expect(platform.meterAllowed('028801')).toBe(true);
  });

  test('publishes only explicitly mapped HomeKit device classes',()=>{
    platform.config={meterDisplayMode:'extended'};
    expect(platform.supportedClass('013401')).toBe(true);
    expect(platform.supportedClass('026301')).toBe(true);
    expect(platform.supportedClass('026b01')).toBe(true);
    expect(platform.supportedClass('027b01')).toBe(true);
    expect(platform.supportedClass('027301')).toBe(true);
    expect(platform.supportedClass('027901')).toBe(true);
    expect(platform.meterAllowed('027901')).toBe(true);
    expect(platform.supportedClass('05fd01')).toBe(true);
    expect(platform.supportedClass('02a301')).toBe(false);
  });

  test('requires explicit opt-in before publishing a discovered device',()=>{
    platform.config={meterDisplayMode:'appleHome',deviceSettings:[]};
    expect(platform.allowed('192.168.1.2-013001','192.168.1.2','013001')).toBe(false);
    platform.config={meterDisplayMode:'appleHome',deviceSettings:[{id:'192.168.1.2-013001',enabled:false}]};
    expect(platform.allowed('192.168.1.2-013001','192.168.1.2','013001')).toBe(false);
    platform.config={meterDisplayMode:'appleHome',deviceSettings:[{id:'192.168.1.2-013001',enabled:true}]};
    expect(platform.allowed('192.168.1.2-013001','192.168.1.2','013001')).toBe(true);
  });

  test('keeps disabled devices in the discovered-device list',()=>{
    const instance=Object.create(EchonetLitePlatform.prototype) as any;
    instance.config={meterDisplayMode:'extended',deviceSettings:[]};
    instance.recordDevice=jest.fn();
    instance.accessory=jest.fn(()=>({}));
    instance.allowed=jest.fn(()=>false);
    const facilities=(EL as any).facilities,previous={...facilities};
    for(const key of Object.keys(facilities))delete facilities[key];
    Object.assign(facilities,{'192.168.1.2':{'013001':{b3:'19'},'028801':{e7:'00000100'}}});
    try{instance.syncFacilities();}finally{for(const key of Object.keys(facilities))delete facilities[key];Object.assign(facilities,previous);}
    expect(instance.recordDevice).toHaveBeenCalledTimes(2);
    expect(instance.recordDevice).toHaveBeenCalledWith('192.168.1.2','028801',{e7:'00000100'});
    expect(instance.accessory).not.toHaveBeenCalled();
    expect(instance.allowed).toHaveBeenCalledTimes(2);
  });

  test('removes disabled cached accessories from HomeKit',()=>{
    const instance=Object.create(EchonetLitePlatform.prototype) as any;
    const accessory={UUID:'disabled-device',context:{ip:'192.168.100.2',eoj:'028801'}};
    instance.config={meterDisplayMode:'extended',deviceSettings:[{id:'192.168.100.2-028801',enabled:false}]};
    instance.cached=new Map();
    instance.pendingRemoval=[];
    instance.api={unregisterPlatformAccessories:jest.fn()};
    instance.configureAccessory(accessory);
    expect(instance.cached.has('disabled-device')).toBe(false);
    expect(instance.pendingRemoval).toEqual([accessory]);
    expect(instance.api.unregisterPlatformAccessories).not.toHaveBeenCalled();
  });

  test('restores enabled cached accessories with their HomeKit services intact',()=>{
    const instance=Object.create(EchonetLitePlatform.prototype) as any;
    const accessory={UUID:'enabled-device',context:{ip:'192.168.100.2',eoj:'013001'}};
    instance.config={meterDisplayMode:'extended',deviceSettings:[{id:'192.168.100.2-013001',enabled:true}]};
    instance.cached=new Map();
    instance.pendingRemoval=[];
    instance.api={unregisterPlatformAccessories:jest.fn()};
    instance.configureAccessory(accessory);
    expect(instance.cached.get('enabled-device')).toBe(accessory);
    expect(instance.pendingRemoval).toEqual([]);
    expect(instance.api.unregisterPlatformAccessories).not.toHaveBeenCalled();
  });

  test('removes an enabled extended meter in Apple Home mode and restores it when extended mode returns',()=>{
    const accessory={UUID:'smart-meter',context:{ip:'192.168.100.2',eoj:'028801'}};
    const create=(mode:'appleHome'|'extended')=>{
      const instance=Object.create(EchonetLitePlatform.prototype) as any;
      instance.config={meterDisplayMode:mode,deviceSettings:[{id:'192.168.100.2-028801',enabled:true}]};
      instance.cached=new Map();
      instance.pendingRemoval=[];
      instance.configureAccessory(accessory);
      return instance;
    };
    const apple=create('appleHome');
    expect(apple.cached.size).toBe(0);
    expect(apple.pendingRemoval).toEqual([accessory]);
    const extended=create('extended');
    expect(extended.cached.get('smart-meter')).toBe(accessory);
    expect(extended.pendingRemoval).toEqual([]);
  });

  test('writes all discovered devices to the UI cache regardless of publication',()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'echonet-cache-'));
    const instance=Object.create(EchonetLitePlatform.prototype) as any;
    instance.discovered=new Map();
    const carrier={context:{}};
    instance.cached=new Map([['carrier',carrier]]);
    instance.mra={describe:()=>undefined,device:()=>undefined};
    instance.api={user:{storagePath:()=>directory},updatePlatformAccessories:jest.fn()};
    instance.logger={info:jest.fn(),debug:jest.fn()};
    try{
      for(const eoj of ['013001','029001','001101','028801','028701','028101','028201'])instance.recordDevice('192.168.100.2',eoj,{e0:'00'});
      clearTimeout(instance.deviceCacheTimer);
      instance.writeDeviceCache();
      const cache=JSON.parse(fs.readFileSync(path.join(directory,'echonet-lite-plus-devices.json'),'utf8'));
      expect(cache.devices).toHaveLength(7);
      expect(cache.devices.map((device:any)=>device.eoj)).toContain('028801');
      expect((carrier.context as any).echonetDiscoveredDevices).toHaveLength(7);
      expect(instance.api.updatePlatformAccessories).toHaveBeenCalledWith([carrier]);
    }finally{fs.rmSync(directory,{recursive:true,force:true});}
  });

  test('keeps the complete discovery file when every HomeKit device is disabled',()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'echonet-all-off-'));
    const instance=Object.create(EchonetLitePlatform.prototype) as any;
    instance.discovered=new Map();
    instance.cached=new Map();
    instance.mra={describe:()=>undefined,device:()=>undefined};
    instance.api={user:{storagePath:()=>directory},updatePlatformAccessories:jest.fn()};
    instance.logger={info:jest.fn(),debug:jest.fn()};
    try{
      for(const eoj of ['013001','029001','001101','028801','028701','028101','028201'])instance.recordDevice('192.168.100.2',eoj,{e0:'00'});
      clearTimeout(instance.deviceCacheTimer);
      instance.writeDeviceCache();
      const cache=JSON.parse(fs.readFileSync(path.join(directory,'echonet-lite-plus-devices.json'),'utf8'));
      expect(cache.devices).toHaveLength(7);
      expect(instance.api.updatePlatformAccessories).not.toHaveBeenCalled();
    }finally{fs.rmSync(directory,{recursive:true,force:true});}
  });

  test('ignores empty SET response values',()=>{
    platform.mra=new MraRepository();
    expect(platform.decodedDetails('013001',{b3:'',bb:'1a'})).toEqual({roomTemperature:26});
  });

  test('does not convert MRA undefined states into NaN HomeKit values',()=>{
    expect(platform.finiteNumber('undefined')).toBeUndefined();
    expect(platform.finiteNumber('unmeasurable')).toBeUndefined();
    expect(platform.finiteNumber(26)).toBe(26);
  });

  test('uses the MRA 1.4.0 water-meter unit multipliers',()=>{
    expect(platform.waterUnit('00')).toBe(1);
    expect(platform.waterUnit('03')).toBe(0.001);
    expect(platform.waterUnit('06')).toBe(0.000001);
  });

  test('derives the HomeKit heater/cooler state without treating a partial INF as off',()=>{
    const C={CurrentHeaterCoolerState:{INACTIVE:0,IDLE:1,HEATING:2,COOLING:3}};
    expect(platform.currentHeaterCoolerState(true,'cooling',C)).toBe(3);
    expect(platform.currentHeaterCoolerState(true,'heating',C)).toBe(2);
    expect(platform.currentHeaterCoolerState(true,'auto',C)).toBe(1);
    expect(platform.currentHeaterCoolerState(false,'cooling',C)).toBe(0);
  });
});
