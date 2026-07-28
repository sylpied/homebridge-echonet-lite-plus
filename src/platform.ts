import type { API, CharacteristicValue, DynamicPlatformPlugin, Logger, PlatformAccessory, Service } from 'homebridge';
import fs from 'node:fs';
import path from 'node:path';
import * as EL from 'echonet-lite';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { EchonetConfig } from './types';
import { PluginLogger } from './logger';
import { MraRepository } from './mra';

type ElData=EL.ElData;
type RInfo=EL.RInfo;

/** Direct ECHONET Lite platform. MQTT is intentionally not involved. */
export class EchonetLitePlatform implements DynamicPlatformPlugin {
  private readonly cached=new Map<string,PlatformAccessory>();
  private readonly pendingRemoval:PlatformAccessory[]=[];
  private readonly meterState=new Map<string,{coefficient:number;unit:number}>();
  private readonly logger:PluginLogger;
  private readonly mra=new MraRepository();
  private rediscoveryTimer?:NodeJS.Timeout;
  private facilitySyncTimer?:NodeJS.Timeout;
  private deviceCacheTimer?:NodeJS.Timeout;
  private statePollTimer?:NodeJS.Timeout;
  private lastRediscovery=0;
  private readonly discovered=new Map<string,{id:string;ip:string;eoj:string;name:string;properties:Record<string,{name:string;ja:string;en:string}>}>();
  constructor(log:Logger,private readonly config:EchonetConfig,private readonly api:API){
    this.logger=new PluginLogger(log,config.logLevel??'info');
    api.on('didFinishLaunching',()=>void this.start());
    api.on('shutdown',()=>{
      if(this.rediscoveryTimer)clearInterval(this.rediscoveryTimer);
      if(this.facilitySyncTimer)clearTimeout(this.facilitySyncTimer);
      if(this.deviceCacheTimer)clearTimeout(this.deviceCacheTimer);
      if(this.statePollTimer)clearInterval(this.statePollTimer);
      try{EL.release();}catch(error){this.logger.debug(`ECHONET Lite終了処理エラー: ${String(error)}`);}
    });
  }
  configureAccessory(a:PlatformAccessory){
    const id=a.context?.ip&&a.context?.eoj?`${a.context.ip}-${a.context.eoj}`:'';
    if(id&&!this.allowed(id,a.context.ip,a.context.eoj)){this.pendingRemoval.push(a);return;}
    this.cached.set(a.UUID,a);
  }
  private async start(){
    try{
      // The running child bridge has now loaded the saved configuration.
      // Clearing this marker lets the custom UI safely enable rediscovery.
      try{fs.rmSync(path.join(this.api.user.storagePath(),'echonet-lite-plus-restart-required'),{force:true});}catch{/* UI marker is optional */}
      if(this.pendingRemoval.length){
        this.api.unregisterPlatformAccessories(PLUGIN_NAME,PLATFORM_NAME,this.pendingRemoval);
        this.logger.info(`設定により${this.pendingRemoval.length}台をHomeKitから除外しました`);
        this.pendingRemoval.length=0;
      }
      this.logger.info('ECHONET Lite直接通信を開始します（UDP/3610）');
      EL.initialize(['05ff01'],((r:RInfo,e:ElData|null,error?:Error|null)=>{
        if(error){this.logger.warn(`ECHONET Lite受信処理エラー: ${String(error)}`);return;}
        if(!e)return;
        try{this.receive(r as RInfo,e as ElData);}catch(receiveError){this.logger.error(`ECHONET Lite機器の処理に失敗しました: ${String(receiveError)}`);}
      }) as any,4,{
        v4:this.config.targetNetwork,ignoreMe:true,autoGetProperties:false,debugMode:false,
      });
      for(const ip of this.config.knownDeviceIps??[]) EL.sendOPC1(ip,'05ff01','0ef001',EL.GET,'d6','');
      if(this.config.autoDiscovery!==false){this.logger.info('ECHONET Lite機器を探索しています');EL.search();}
      this.watchRediscoveryRequests();
      this.startStatePolling();
    }catch(e){this.logger.error(`ECHONET Liteの初期化に失敗しました: ${String(e)}`);}
  }
  private watchRediscoveryRequests(){
    const marker=path.join(this.api.user.storagePath(),'echonet-lite-plus-rediscover.json');
    try{this.lastRediscovery=(JSON.parse(fs.readFileSync(marker,'utf8')) as {requestedAt?:number}).requestedAt??0;}catch{/* no previous request */}
    this.rediscoveryTimer=setInterval(()=>{
      try{
        const request=JSON.parse(fs.readFileSync(marker,'utf8')) as {requestedAt?:number};
        if((request.requestedAt??0)>this.lastRediscovery){this.lastRediscovery=request.requestedAt!;this.rediscover();fs.rmSync(marker,{force:true});}
      }catch{/* The marker is created by the UI on first use. */}
    },1000);
  }
  private rediscover(){
    this.logger.info('UIからECHONET Lite機器の再探索を開始しました');
    for(const ip of this.config.knownDeviceIps??[])EL.sendOPC1(ip,'05ff01','0ef001',EL.GET,'d6','');
    EL.search();
    this.scheduleFacilitySync();
  }
  private startStatePolling(){
    const seconds=Number(this.config.pollInterval??60);
    if(!Number.isFinite(seconds)||seconds<=0)return;
    const interval=Math.max(30,seconds);
    this.logger.info(`ECHONET Lite機器の状態を${interval}秒間隔で更新します`);
    this.statePollTimer=setInterval(()=>this.pollDeviceStates(),interval*1000);
  }
  private pollDeviceStates(){
    for(const device of this.discovered.values()){
      if(!this.allowed(device.id,device.ip,device.eoj))continue;
      const selected=this.config.deviceSettings?.find(x=>x.id===device.id)?.properties;
      const epcs=(Array.isArray(selected)?selected:Object.keys(device.properties)).map(epc=>epc.toLowerCase()).filter(epc=>!['9d','9e','9f'].includes(epc)&&this.mra.isReadable(device.eoj,epc));
      for(let offset=0;offset<epcs.length;offset+=10){
        const details=epcs.slice(offset,offset+10).map(epc=>({[epc]:''}));
        if(details.length)try{(EL as any).sendDetails(device.ip,'05ff01',device.eoj,EL.GET,details);}catch(error){this.logger.debug(`状態更新要求の送信に失敗しました: ${device.ip} / ${device.eoj}: ${String(error)}`);}
      }
    }
  }
  private receive(r:RInfo,e:ElData){
    // INF/GET_RESは非常に多いため受信電文そのものはdebugに限定する。
    this.logger.debug(`recv ${r.address} ${e.SEOJ} ESV=${e.ESV} ${JSON.stringify(e.DETAILs)}`);
    if(e.SEOJ==='0ef001'){
      const list=e.DETAILs?.d6;
      if(typeof list==='string'&&list.length>=2){
        const count=parseInt(list.slice(0,2),16);
        for(let i=0;i<count;i++){
          const eoj=list.slice(2+i*6,8+i*6);
          if(/^[0-9a-f]{6}$/i.test(eoj))(EL as any).sendDetails(r,'05ff01',eoj,EL.GET,[{'9d':''},{'9e':''},{'9f':''}]);
        }
      }
      this.scheduleFacilitySync();return;
    }
    const map=e.DETAILs?.['9f'];
    if(typeof map==='string'){
      const details=this.propertyRequests(map);
      if(Object.keys(details).length)(EL as any).sendDetails(r,'05ff01',e.SEOJ,EL.GET,details);
    }
    this.recordDevice(r.address,e.SEOJ,e.DETAILs);
    const id=`${r.address}-${e.SEOJ}`;
    if(!this.allowed(id,r.address,e.SEOJ)){this.logger.debug(`機器をフィルターにより除外しました: ${r.address} / ${e.SEOJ}`);return;}
    this.logger.debug(`ECHONET Lite機器を検出しました: ${r.address} / ${e.SEOJ}`);
    const a=this.accessory(id,r.address,e.SEOJ);this.cacheDetectedProperties(a,id);this.apply(a,r.address,e.SEOJ,this.selectedDetails(id,e.DETAILs));
  }
  private recordDevice(ip:string,eoj:string,details:Record<string,string>){
    const id=`${ip}-${eoj}`,existing=this.discovered.get(id),current=existing??{id,ip,eoj,name:this.className(eoj),properties:{}};
    this.restoreRediscoveredDevice(id);
    let changed=!existing;
    for(const epc of Object.keys(details))if(!['9d','9e','9f'].includes(epc.toLowerCase())){
      const description=this.mra.describe(eoj,epc)??{name:epc.toUpperCase(),ja:`EPC ${epc.toUpperCase()}`,en:`EPC ${epc.toUpperCase()}`};
      if(JSON.stringify(current.properties[epc])!==JSON.stringify(description)){current.properties[epc]=description;changed=true;}
    }
    this.discovered.set(id,current);
    if(changed)this.scheduleDeviceCacheWrite();
  }
  private restoreRediscoveredDevice(id:string){
    const file=path.join(this.api.user.storagePath(),'echonet-lite-plus-removed-device-ids.json');
    try{
      const ids=JSON.parse(fs.readFileSync(file,'utf8')) as unknown;
      if(!Array.isArray(ids)||!ids.includes(id))return;
      const remaining=ids.filter(value=>typeof value==='string'&&value!==id);
      if(remaining.length)fs.writeFileSync(file,JSON.stringify(remaining));else fs.rmSync(file,{force:true});
    }catch{/* No individually removed device history. */}
  }
  private scheduleDeviceCacheWrite(){
    if(this.deviceCacheTimer)clearTimeout(this.deviceCacheTimer);
    this.deviceCacheTimer=setTimeout(()=>this.writeDeviceCache(),250);
  }
  private writeDeviceCache(){
    const file=path.join(this.api.user.storagePath(),'echonet-lite-plus-devices.json'),temporary=`${file}.tmp`;
    try{
      const devices=[...this.discovered.values()],payload={updatedAt:Date.now(),devices};
      fs.writeFileSync(temporary,JSON.stringify(payload));fs.renameSync(temporary,file);
      if(devices.length)fs.rmSync(path.join(this.api.user.storagePath(),'echonet-lite-plus-device-history-cleared'),{force:true});
      const carriers=[...this.cached.values()];
      for(const accessory of carriers)accessory.context.echonetDiscoveredDevices=devices;
      if(carriers.length)this.api.updatePlatformAccessories(carriers);
      this.logger.info(`検出機器一覧を更新しました: ${this.discovered.size}台`);
    }catch(error){this.logger.debug(`機器一覧の保存に失敗しました: ${String(error)}`);}
  }
  private selectedDetails(id:string,details:Record<string,string>){
    const selected=this.config.deviceSettings?.find(x=>x.id===id)?.properties;
    if(!Array.isArray(selected))return details;
    const dependencies=new Set(selected);
    if(selected.includes('e0')){dependencies.add('d3');dependencies.add('e1');}
    return Object.fromEntries(Object.entries(details).filter(([epc])=>dependencies.has(epc)));
  }
  private cacheDetectedProperties(a:PlatformAccessory,id:string){
    const properties=this.discovered.get(id)?.properties;if(!properties)return;
    if(JSON.stringify(a.context.detectedProperties)===JSON.stringify(properties))return;
    a.context.detectedProperties=properties;
    this.api.updatePlatformAccessories([a]);
  }
  private propertyRequests(map:string){
    if(!/^(?:[0-9a-f]{2})+$/i.test(map))return {};
    const bytes=map.match(/../g)?.map(v=>Number.parseInt(v,16))??[];
    if(!bytes.length||bytes.some(Number.isNaN))return {};
    const epcs:string[]=[];
    if(bytes[0]<=15){for(let i=1;i<=bytes[0]&&i<bytes.length;i++)epcs.push(bytes[i].toString(16).padStart(2,'0'));}
    else for(let i=0;i<16;i++)for(let bit=0;bit<8;bit++)if((bytes[i+1]??0)&(1<<bit))epcs.push(((bit+8)*16+i).toString(16));
    return Object.fromEntries([...new Set(epcs.map(epc=>epc.toLowerCase()))].filter(epc=>!['d6','9d','9e','9f'].includes(epc)).map(epc=>[epc,'']));
  }
  private scheduleFacilitySync(){
    if(this.facilitySyncTimer)clearTimeout(this.facilitySyncTimer);
    this.facilitySyncTimer=setTimeout(()=>this.syncFacilities(),5500);
  }
  private syncFacilities(){
    for(const [ip,objects] of Object.entries(EL.facilities??{}))for(const [eoj,details] of Object.entries(objects)){
      if(eoj.toLowerCase()==='0ef001')continue;
      this.recordDevice(ip,eoj,details);
      const id=`${ip}-${eoj}`;if(!this.allowed(id,ip,eoj))continue;
      const a=this.accessory(id,ip,eoj);this.cacheDetectedProperties(a,id);this.apply(a,ip,eoj,this.selectedDetails(id,details));
    }
  }
  private allowed(id:string,ip:string,eoj:string){
    const keys=[id,ip,eoj];
    return this.supportedClass(eoj)&&this.meterAllowed(eoj)&&this.config.deviceSettings?.find(x=>x.id===id)?.enabled===true&&(!this.config.includeDevices?.length||keys.some(k=>this.config.includeDevices!.includes(k)))&&!keys.some(k=>this.config.excludeDevices?.includes(k));
  }
  private supportedClass(eoj:string){return new Set(['0011','0012','0130','0133','0134','0135','0263','026b','026f','0272','0273','0279','027b','027e','0280','0281','0282','0287','0288','0290','0291','02a6','05fd']).has(eoj.slice(0,4).toLowerCase());}
  private meterAllowed(eoj:string){const cls=eoj.slice(0,4).toLowerCase();return (this.config.meterDisplayMode??'appleHome')==='extended'||!['0279','027e','0280','0282','0287','0288'].includes(cls);}
  private accessory(id:string,ip:string,eoj:string){
    const uuid=this.api.hap.uuid.generate(`echonet-lite:${id}`); let a=this.cached.get(uuid);
    const setting=this.config.deviceSettings?.find(x=>x.id===id);
    if(!a){a=new this.api.platformAccessory(setting?.name||this.className(eoj),uuid);a.context={ip,eoj};this.api.registerPlatformAccessories(PLUGIN_NAME,PLATFORM_NAME,[a]);this.cached.set(uuid,a);this.logger.info(`機器を追加しました: ${ip} / ${eoj}`);}
    const displayName=setting?.name?.trim()||this.className(eoj);
    (a as any).displayName=displayName;
    const info=a.getService(this.api.hap.Service.AccessoryInformation)!;
    info.setCharacteristic(this.api.hap.Characteristic.Name,displayName)
      .setCharacteristic(this.api.hap.Characteristic.Manufacturer,'ECHONET Lite')
      .setCharacteristic(this.api.hap.Characteristic.Model,`EOJ ${eoj.slice(0,4).toUpperCase()}`)
      .setCharacteristic(this.api.hap.Characteristic.SerialNumber,id);
    return a;
  }
  private className(eoj:string){const device=this.mra.device(eoj);return device?.className.ja??device?.className.en??`ECHONET Lite ${eoj}`;}
  private service(a:PlatformAccessory,eoj:string):Service{
    const S=this.api.hap.Service;const cls=eoj.slice(0,4).toLowerCase();
    const name=a.displayName||this.className(eoj);
    if(cls==='0290'||cls==='0291')return a.getService(S.Lightbulb)??a.addService(S.Lightbulb,name);
    if(cls==='0011')return a.getService(S.TemperatureSensor)??a.addService(S.TemperatureSensor,name);
    if(cls==='0012')return a.getService(S.HumiditySensor)??a.addService(S.HumiditySensor,name);
    if(cls==='0130')return a.getService(S.HeaterCooler)??a.addService(S.HeaterCooler,name);
    if(cls==='0133'||cls==='0134'||cls==='0135')return a.getService(S.Fanv2)??a.addService(S.Fanv2,name);
    if(cls==='0263')return a.getService(S.WindowCovering)??a.addService(S.WindowCovering,name);
    if(cls==='026b'||cls==='0272')return a.getServiceById(S.Switch,'automatic-bath')??a.addService(S.Switch,`${name} 風呂自動`,'automatic-bath');
    if(cls==='026f')return a.getService(S.LockMechanism)??a.addService(S.LockMechanism,name);
    if(cls==='0273')return a.getService(S.Fanv2)??a.addService(S.Fanv2,name);
    if(cls==='027b')return a.getService(S.Thermostat)??a.addService(S.Thermostat,name);
    if(cls==='0279'||cls==='027e'||cls==='0280'||cls==='0287'||cls==='0288')return this.energyService(a,name);
    if(cls==='0281'&&(this.config.meterDisplayMode??'appleHome')==='appleHome'){
      const extended=a.services.find(service=>service.UUID==='7A8C3201-3D84-4B4E-9A9E-000000002811');
      if(extended)a.removeService(extended);
      return a.getServiceById(S.LeakSensor,'water-meter-alarm')??a.addService(S.LeakSensor,name,'water-meter-alarm');
    }
    if(cls==='0281'){
      const leak=a.getServiceById(S.LeakSensor,'water-meter-alarm');if(leak)a.removeService(leak);
      return this.utilityMeterService(a,name,cls);
    }
    if(cls==='0282')return this.utilityMeterService(a,name,cls);
    if(cls==='02a6')return a.getServiceById(S.Switch,'automatic-water-heating')??a.addService(S.Switch,`${name} 自動沸き上げ`,'automatic-water-heating');
    if(cls==='05fd')return a.getService(S.Switch)??a.addService(S.Switch,name);
    throw new Error(`HomeKitサービス未対応の機器クラスです: ${cls}`);
  }
  private apply(a:PlatformAccessory,ip:string,eoj:string,d:Record<string,string>){
    const s=this.service(a,eoj),C=this.api.hap.Characteristic,cls=eoj.slice(0,4).toLowerCase();
    // SET_RES can contain an EPC with an empty EDT. It acknowledges the write,
    // but does not carry a value and must not overwrite the HomeKit state.
    const decoded=this.decodedDetails(eoj,d);
    const on=decoded.operationStatus===true||decoded.operationStatus==='true';
    if(cls==='0290'||cls==='0291'){
      if('operationStatus'in decoded)this.writable(s,C.On,on,v=>this.setMra(ip,eoj,'operationStatus',String(Boolean(v))));
      const lightLevel=this.finiteNumber(decoded.lightLevel);
      if(lightLevel!==undefined)this.writable(s,C.Brightness,this.clamp(lightLevel,0,100),v=>this.setMra(ip,eoj,'lightLevel',Number(v)));
    }else if(cls==='0130'){
      if('operationStatus'in decoded)this.writable(s,C.Active,on?C.Active.ACTIVE:C.Active.INACTIVE,v=>this.setMra(ip,eoj,'operationStatus',String(v===C.Active.ACTIVE)));
      const roomTemperature=this.finiteNumber(decoded.roomTemperature);
      if(roomTemperature!==undefined)s.getCharacteristic(C.CurrentTemperature).updateValue(roomTemperature);
      const temperature=this.finiteNumber(decoded.targetTemperature);
      if(temperature!==undefined){
        // ECHONET B3 is a shared target temperature. HomeKit gives its heating
        // and cooling thresholds different defaults, so align both with B3.
        s.getCharacteristic(C.CoolingThresholdTemperature).setProps({minValue:0,maxValue:50,minStep:1});
        s.getCharacteristic(C.HeatingThresholdTemperature).setProps({minValue:0,maxValue:50,minStep:1});
        this.writable(s,C.CoolingThresholdTemperature,temperature,v=>this.setMra(ip,eoj,'targetTemperature',Number(v)));
        this.writable(s,C.HeatingThresholdTemperature,temperature,v=>this.setMra(ip,eoj,'targetTemperature',Number(v)));
      }
      const mode=decoded.operationMode;
      if('operationMode'in decoded){const target=mode==='cooling'?C.TargetHeaterCoolerState.COOL:mode==='heating'?C.TargetHeaterCoolerState.HEAT:C.TargetHeaterCoolerState.AUTO;this.writable(s,C.TargetHeaterCoolerState,target,v=>this.setMra(ip,eoj,'operationMode',v===C.TargetHeaterCoolerState.COOL?'cooling':v===C.TargetHeaterCoolerState.HEAT?'heating':'auto'));}
      // INF/GET_RES may contain only one EPC. Preserve the last HomeKit Active
      // and Target state when operation status or mode is absent from this frame.
      const active='operationStatus'in decoded?on:s.getCharacteristic(C.Active).value===C.Active.ACTIVE;
      const retainedMode='operationMode'in decoded?mode:s.getCharacteristic(C.TargetHeaterCoolerState).value===C.TargetHeaterCoolerState.COOL?'cooling':s.getCharacteristic(C.TargetHeaterCoolerState).value===C.TargetHeaterCoolerState.HEAT?'heating':'auto';
      const current=this.currentHeaterCoolerState(active,retainedMode,C);
      s.getCharacteristic(C.CurrentHeaterCoolerState).updateValue(current);
    }else if(cls==='0133'||cls==='0134'||cls==='0135'){
      if('operationStatus'in decoded)this.writable(s,C.Active,on?C.Active.ACTIVE:C.Active.INACTIVE,v=>this.setMra(ip,eoj,'operationStatus',String(v===C.Active.ACTIVE)));
    }else if(cls==='0263'){
      const degree=Number(decoded.degreeOfOpening);
      if(Number.isFinite(degree))s.getCharacteristic(C.CurrentPosition).updateValue(this.clamp(degree,0,100));
      const status=decoded.openCloseStatus;
      if(status==='fullyOpen'){s.getCharacteristic(C.CurrentPosition).updateValue(100);s.getCharacteristic(C.TargetPosition).updateValue(100);}
      else if(status==='fullyClosed'){s.getCharacteristic(C.CurrentPosition).updateValue(0);s.getCharacteristic(C.TargetPosition).updateValue(0);}
      const positionState=status==='opening'?C.PositionState.INCREASING:status==='closing'?C.PositionState.DECREASING:C.PositionState.STOPPED;
      s.getCharacteristic(C.PositionState).updateValue(positionState);
      const target=s.getCharacteristic(C.TargetPosition);target.removeOnSet();target.onSet(value=>{
        const requested=this.clamp(Number(value),0,100);
        if('degreeOfOpening'in decoded)this.setMra(ip,eoj,'degreeOfOpening',requested);
        else this.setMra(ip,eoj,'openCloseOperation',requested>Number(s.getCharacteristic(C.CurrentPosition).value??0)?'open':'close');
      });
      const hold=s.getCharacteristic(C.HoldPosition);hold.removeOnSet();hold.onSet(value=>{if(Boolean(value))this.setMra(ip,eoj,'openCloseOperation','stop');});
    }else if(cls==='026b'||cls==='0272'){
      if('automaticBathOperation'in decoded)this.writable(s,C.On,decoded.automaticBathOperation==='true'||decoded.automaticBathOperation===true,v=>this.setMra(ip,eoj,'automaticBathOperation',String(Boolean(v))));
    }else if(cls==='026f'){
      if('e0'in d){const secured=d['e0'].toLowerCase()==='41';s.getCharacteristic(C.LockCurrentState).updateValue(secured?C.LockCurrentState.SECURED:C.LockCurrentState.UNSECURED);this.writable(s,C.LockTargetState,secured?C.LockTargetState.SECURED:C.LockTargetState.UNSECURED,v=>this.set(ip,eoj,'e0',v===C.LockTargetState.SECURED?'41':'42'));}
    }else if(cls==='0273'){
      this.applyBathroomDryer(a,s,ip,eoj,decoded);
    }else if(cls==='027b'){
      s.getCharacteristic(C.TargetHeatingCoolingState).setProps({validValues:[C.TargetHeatingCoolingState.OFF,C.TargetHeatingCoolingState.HEAT]});
      if('operationStatus'in decoded){
        s.getCharacteristic(C.CurrentHeatingCoolingState).updateValue(on?C.CurrentHeatingCoolingState.HEAT:C.CurrentHeatingCoolingState.OFF);
        this.writable(s,C.TargetHeatingCoolingState,on?C.TargetHeatingCoolingState.HEAT:C.TargetHeatingCoolingState.OFF,v=>this.setMra(ip,eoj,'operationStatus',String(v!==C.TargetHeatingCoolingState.OFF)));
      }
      if(typeof decoded.measuredRoomTemperature==='number')s.getCharacteristic(C.CurrentTemperature).updateValue(decoded.measuredRoomTemperature);
      else if(typeof decoded.measuredFloorTemperature==='number')s.getCharacteristic(C.CurrentTemperature).updateValue(decoded.measuredFloorTemperature);
      if(typeof decoded.targetTemperature1==='number')this.writable(s,C.TargetTemperature,decoded.targetTemperature1,v=>this.setMra(ip,eoj,'targetTemperature1',Number(v)));
      s.getCharacteristic(C.TemperatureDisplayUnits).updateValue(C.TemperatureDisplayUnits.CELSIUS);
    }else if(cls==='0279')this.applySolar(s,decoded);
    else if(cls==='027e')this.applyEvCharger(s,decoded);
    else if(cls==='0280'||cls==='0287'||cls==='0288')this.applyEnergy(a,s,cls,d);
    else if(cls==='0281'||cls==='0282')this.applyUtilityMeter(a,s,cls,d);
    else if(cls==='0011'){
      const value=this.finiteNumber(decoded.value);if(value!==undefined)s.getCharacteristic(C.CurrentTemperature).updateValue(value);
    }else if(cls==='0012'){
      const value=this.finiteNumber(decoded.value);if(value!==undefined)s.getCharacteristic(C.CurrentRelativeHumidity).updateValue(this.clamp(value,0,100));
    }
    else if(cls==='02a6'&&'automaticWaterHeating'in decoded){const enabled=decoded.automaticWaterHeating!=='manualNotHeating';this.writable(s,C.On,enabled,v=>this.setMra(ip,eoj,'automaticWaterHeating',Boolean(v)?'auto':'manualNotHeating'));}
    else if(cls==='05fd'&&'operationStatus'in decoded)this.writable(s,C.On,on,v=>this.setMra(ip,eoj,'operationStatus',String(Boolean(v))));
  }
  private decodedDetails(eoj:string,d:Record<string,string>){
    return Object.fromEntries(Object.entries(d).filter(([,raw])=>typeof raw==='string'&&raw.length>0&&raw.length%2===0&&/^[0-9a-f]+$/i.test(raw)).map(([epc,raw])=>{const p=this.mra.decode(eoj,epc,raw);return [p?.name??epc,p?.value??raw];}));
  }
  private writable(s:Service,type:any,value:CharacteristicValue,setter:(value:CharacteristicValue)=>void){const c=s.getCharacteristic(type);c.updateValue(value);c.removeOnSet();c.onSet(setter);}
  private applyBathroomDryer(a:PlatformAccessory,s:Service,ip:string,eoj:string,decoded:Record<string,unknown>){
    const C=this.api.hap.Characteristic,S=this.api.hap.Service,mode=String(decoded.operationSetting??'stop');
    this.writable(s,C.Active,mode==='stop'?C.Active.INACTIVE:C.Active.ACTIVE,value=>this.setMra(ip,eoj,'operationSetting',value===C.Active.ACTIVE?'ventilation':'stop'));
    const modes=[['ventilation','換気'],['prewarming','予備暖房'],['heating','暖房'],['drying','乾燥'],['circulation','涼風']] as const;
    for(const [value,label] of modes){
      const service=a.getServiceById(S.Switch,`bathroom-${value}`)??a.addService(S.Switch,`${a.displayName} ${label}`,`bathroom-${value}`);
      this.writable(service,C.On,mode===value,on=>{if(Boolean(on))this.setMra(ip,eoj,'operationSetting',value);else if(mode===value)this.setMra(ip,eoj,'operationSetting','stop');});
    }
  }
  private clamp(value:number,min:number,max:number){return Math.min(max,Math.max(min,value));}
  private finiteNumber(value:unknown){const number=typeof value==='number'?value:Number(value);return Number.isFinite(number)?number:undefined;}
  private currentHeaterCoolerState(active:boolean,mode:unknown,C:any){return !active?C.CurrentHeaterCoolerState.INACTIVE:mode==='cooling'?C.CurrentHeaterCoolerState.COOLING:mode==='heating'?C.CurrentHeaterCoolerState.HEATING:C.CurrentHeaterCoolerState.IDLE;}
  private hexNumber(v:string){const n=parseInt(v,16);return Number.isFinite(n)?n:0;}
  private signedShort(v:string){const n=this.hexNumber(v.slice(-4));return n>32767?n-65536:n;}
  private energyService(a:PlatformAccessory,name:string):Service{
    const uuid='E863F117-079E-48FF-8F27-9C2605A29F52';
    const current=a.services.find(s=>s.UUID===uuid);if(current)return current;
    const service=new this.api.hap.Service(name,uuid,'energy');a.addService(service);return service;
  }
  private utilityMeterService(a:PlatformAccessory,name:string,cls:string):Service{
    const uuid=cls==='0281'?'7A8C3201-3D84-4B4E-9A9E-000000002811':'7A8C3201-3D84-4B4E-9A9E-000000002821';
    const current=a.services.find(s=>s.UUID===uuid);if(current)return current;
    const service=new this.api.hap.Service(name,uuid,cls);a.addService(service);return service;
  }
  private meterCharacteristic(s:Service,name:string,uuid:string,unit:string){
    let c=s.characteristics.find(x=>x.UUID===uuid);
    if(!c){c=new this.api.hap.Characteristic(name,uuid,{format:this.api.hap.Formats.FLOAT,perms:[this.api.hap.Perms.PAIRED_READ,this.api.hap.Perms.NOTIFY],unit});s.addCharacteristic(c);}
    return c;
  }
  private applyEnergy(a:PlatformAccessory,s:Service,cls:string,d:Record<string,string>){
    const key=a.UUID,state=this.meterState.get(key)??{coefficient:1,unit:1};
    if('d3'in d)state.coefficient=this.hexNumber(d['d3'])||1;
    if('e1'in d)state.unit=this.energyUnit(d['e1']);
    this.meterState.set(key,state);
    // Smart meter: E7=instantaneous W, E8=R/T current (0.1A), E0=cumulative value.
    if('e7'in d)this.meterCharacteristic(s,'現在の消費電力','E863F10D-079E-48FF-8F27-9C2605A29F52','W').updateValue(this.signedInt(d['e7']));
    if('e8'in d){const r=this.signedShort(d['e8'].slice(0,4))/10,t=this.signedShort(d['e8'].slice(4,8))/10;this.meterCharacteristic(s,'電流','E863F126-079E-48FF-8F27-9C2605A29F52','A').updateValue(t>=0&&t<3276.6?r+t:r);}
    if('e0'in d)this.meterCharacteristic(s,'積算電力量','E863F10C-079E-48FF-8F27-9C2605A29F52','kWh').updateValue(this.hexNumber(d['e0'])*state.coefficient*state.unit);
    // Distribution board: B7 is the channel list of instantaneous power values.
    if(cls==='0287'&&'b7'in d){const values=this.channelValues(d['b7']);const total=values.reduce((sum,v)=>sum+v,0);this.meterCharacteristic(s,'現在の消費電力','E863F10D-079E-48FF-8F27-9C2605A29F52','W').updateValue(total);}
  }
  private applySolar(s:Service,decoded:Record<string,unknown>){
    if(typeof decoded.instantaneousElectricPowerGeneration==='number')this.meterCharacteristic(s,'現在の発電電力','7A8C3279-3D84-4B4E-9A9E-000000000001','W').updateValue(decoded.instantaneousElectricPowerGeneration);
    if(typeof decoded.cumulativeElectricEnergyOfGeneration==='number')this.meterCharacteristic(s,'積算発電電力量','7A8C3279-3D84-4B4E-9A9E-000000000002','kWh').updateValue(decoded.cumulativeElectricEnergyOfGeneration);
    if(typeof decoded.cumulativeElectricEnergySold==='number')this.meterCharacteristic(s,'積算売電電力量','7A8C3279-3D84-4B4E-9A9E-000000000003','kWh').updateValue(decoded.cumulativeElectricEnergySold);
  }
  private applyEvCharger(s:Service,decoded:Record<string,unknown>){
    if(typeof decoded.instantaneousElectricPower==='number')this.meterCharacteristic(s,'充放電電力','7A8C327E-3D84-4B4E-9A9E-000000000001','W').updateValue(decoded.instantaneousElectricPower);
    if(typeof decoded.remainingCapacity1==='number')this.meterCharacteristic(s,'充放電可能残量','7A8C327E-3D84-4B4E-9A9E-000000000002','Wh').updateValue(decoded.remainingCapacity1);
    if(typeof decoded.usedCapacity1==='number')this.meterCharacteristic(s,'使用電力量','7A8C327E-3D84-4B4E-9A9E-000000000003','Wh').updateValue(decoded.usedCapacity1);
  }
  private signedInt(v:string){const n=this.hexNumber(v.slice(-8));return n>0x7fffffff?n-0x100000000:n;}
  private energyUnit(v:string){return ({'00':1,'01':0.1,'02':0.01,'03':0.001,'04':0.0001,'0a':10,'0b':100,'0c':1000,'0d':10000} as Record<string,number>)[v.slice(-2).toLowerCase()]??1;}
  private channelValues(v:string){const range=this.hexNumber(v.slice(2,4));const result:number[]=[];for(let i=0;i<range;i++){const raw=v.slice(4+i*8,12+i*8);if(raw.length===8&&raw.toLowerCase()!=='fffffffe')result.push(this.signedInt(raw));}return result;}
  private applyUtilityMeter(a:PlatformAccessory,s:Service,cls:string,d:Record<string,string>){
    if(cls==='0281'){
      const appleMode=(this.config.meterDisplayMode??'appleHome')==='appleHome';
      const unit='e1'in d?this.waterUnit(d['e1']):1;
      if(!appleMode&&'e0'in d)this.meterCharacteristic(s,'積算水道使用量','7A8C3210-3D84-4B4E-9A9E-000000002811','m³').updateValue(this.hexNumber(d['e0'])*unit);
      if('e3'in d){
        const abnormal=d['e3'].slice(-2).toLowerCase()==='41';
        if(!appleMode)this.meterCharacteristic(s,'検針データ異常','7A8C3211-3D84-4B4E-9A9E-000000002811','').updateValue(abnormal?1:0);
        const leak=appleMode?s:(a.getServiceById(this.api.hap.Service.LeakSensor,'water-meter-alarm')??a.addService(this.api.hap.Service.LeakSensor,'水道メーター異常','water-meter-alarm'));
        leak.getCharacteristic(this.api.hap.Characteristic.LeakDetected).updateValue(abnormal?this.api.hap.Characteristic.LeakDetected.LEAK_DETECTED:this.api.hap.Characteristic.LeakDetected.LEAK_NOT_DETECTED);
      }
    }else if('e0'in d)this.meterCharacteristic(s,'積算ガス使用量','7A8C3220-3D84-4B4E-9A9E-000000002821','m³').updateValue(this.hexNumber(d['e0'])*0.001);
  }
  private waterUnit(v:string){return ({'00':1,'01':0.1,'02':0.01,'03':0.001,'04':0.0001,'05':0.00001,'06':0.000001} as Record<string,number>)[v.slice(-2).toLowerCase()]??1;}
  private set(ip:string,eoj:string,epc:string,edt:CharacteristicValue|string){
    this.logger.info(`操作を送信: ${ip} ${eoj} EPC=${epc}`);
    try{EL.sendOPC1(ip,'05ff01',eoj,EL.SETC,epc,String(edt));}catch(error){this.logger.error(`ECHONET Lite操作の送信に失敗しました: ${String(error)}`);}
  }
  private setMra(ip:string,eoj:string,name:string,value:unknown){const encoded=this.mra.encode(eoj,name,value);if(!encoded){this.logger.warn(`MRAで書込値を変換できません: ${eoj}.${name}`);return;}this.set(ip,eoj,encoded.epc,encoded.edt);}
}
