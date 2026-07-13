import path from 'node:path';
import AdmZip from 'adm-zip';

type AccessRule='required'|'optional'|'notApplicable';
type Schema={
  $ref?:string; type?:string; format?:string; size?:number; multiple?:number;
  minimum?:number;maximum?:number;enum?:Array<{edt:string;name?:string}>; oneOf?:Schema[];
};
type MraProperty={epc:string;shortName:string;propertyName:{ja:string;en:string};accessRule:{get:AccessRule;set:AccessRule;inf:AccessRule};data:Schema};
type MraDevice={eoj:string;shortName:string;className:{ja:string;en:string};elProperties:MraProperty[]};
export type DecodedProperty={epc:string;name:string;value:unknown;raw:string;readable:boolean;writable:boolean;observable:boolean};

export class MraRepository{
  private readonly devices=new Map<string,MraDevice>();
  private readonly definitions:Record<string,Schema>;
  constructor(zipPath=path.resolve(__dirname,'../work/MRA_v1.4.0.zip')){
    const zip=new AdmZip(zipPath);
    const json=(name:string)=>JSON.parse(zip.readAsText(name));
    this.definitions=json('MRA_v1.4.0/definitions/definitions.json').definitions;
    for(const entry of zip.getEntries().filter(e=>/^MRA_v1\.4\.0\/devices\/0x[0-9A-Fa-f]{4}\.json$/.test(e.entryName))){
      const device=JSON.parse(entry.getData().toString('utf8')) as MraDevice;
      this.devices.set(device.eoj.toLowerCase().replace(/^0x/,''),device);
    }
  }
  device(eoj:string){return this.devices.get(eoj.slice(0,4).toLowerCase());}
  private candidates(eoj:string,epc:string){return this.device(eoj)?.elProperties.filter(p=>p.epc.toLowerCase()===`0x${epc.toLowerCase()}`)??[];}
  describe(eoj:string,epc:string){
    const property=this.candidates(eoj,epc)[0];
    return property?{name:property.shortName,ja:property.propertyName.ja,en:property.propertyName.en}:undefined;
  }
  isReadable(eoj:string,epc:string){return this.candidates(eoj,epc).some(p=>p.accessRule.get!=='notApplicable');}
  isWritable(eoj:string,epc:string){return this.candidates(eoj,epc).some(p=>p.accessRule.set!=='notApplicable');}
  decode(eoj:string,epc:string,raw:string):DecodedProperty|undefined{
    const candidates=this.candidates(eoj,epc);if(!candidates.length)return undefined;
    const matched=candidates.map(property=>({property,decoded:this.tryDecodeSchema(property.data,raw)})).find(x=>x.decoded.matched);
    const property=matched?.property??candidates[0];
    return {epc,name:property.shortName,value:matched?.decoded.value??raw,raw,readable:candidates.some(p=>p.accessRule.get!=='notApplicable'),writable:candidates.some(p=>p.accessRule.set!=='notApplicable'),observable:candidates.some(p=>p.accessRule.inf!=='notApplicable')};
  }
  encode(eoj:string,propertyName:string,value:unknown):{epc:string;edt:string}|undefined{
    for(const property of this.device(eoj)?.elProperties.filter(p=>p.shortName===propertyName&&p.accessRule.set!=='notApplicable')??[]){
      const schema=this.resolve(property.data);
      for(const state of this.schemasOfType(schema,'state')){const match=state.enum?.find(e=>e.name===String(value));if(match)return {epc:property.epc.slice(2),edt:match.edt.slice(2)};}
      if(typeof value==='number'&&Number.isFinite(value)){
        for(const number of this.schemasOfType(schema,'number')){
          const multiple=number.multiple??1,size=this.sizeOf(number.format),signed=number.format?.startsWith('int')??false;
          const n=Math.round(value/multiple);
          if((number.minimum!==undefined&&n<number.minimum)||(number.maximum!==undefined&&n>number.maximum))continue;
          const min=signed?-(2**(size*8-1)):0,max=signed?2**(size*8-1)-1:2**(size*8)-1;
          if(n<min||n>max)continue;
          const encoded=n<0?2**(size*8)+n:n;
          return {epc:property.epc.slice(2),edt:encoded.toString(16).padStart(size*2,'0')};
        }
      }
    }
    return undefined;
  }
  private resolve(schema:Schema):Schema{if(schema.$ref)return this.resolve(this.definitions[schema.$ref.split('/').pop()!]??schema);return schema;}
  private schemasOfType(schema:Schema,type:string):Schema[]{schema=this.resolve(schema);return [...(schema.type===type?[schema]:[]),...(schema.oneOf??[]).flatMap(item=>this.schemasOfType(item,type))];}
  private tryDecodeSchema(schema:Schema,raw:string):{matched:boolean;value?:unknown}{
    schema=this.resolve(schema);
    if(schema.oneOf){for(const item of schema.oneOf){const decoded=this.tryDecodeSchema(item,raw);if(decoded.matched)return decoded;}return {matched:false};}
    if(schema.type==='state'){const found=schema.enum?.find(e=>e.edt.slice(2).toLowerCase()===raw.toLowerCase());return found?{matched:true,value:found.name}:{matched:false};}
    if(schema.type==='number'){
      const size=this.sizeOf(schema.format);
      if(!new RegExp(`^[0-9a-f]{${size*2}}$`,'i').test(raw))return {matched:false};
      const unsigned=parseInt(raw,16),signed=schema.format?.startsWith('int')&&unsigned>=2**(size*8-1)?unsigned-2**(size*8):unsigned;
      if((schema.minimum!==undefined&&signed<schema.minimum)||(schema.maximum!==undefined&&signed>schema.maximum))return {matched:false};
      return {matched:true,value:signed*(schema.multiple??1)};
    }
    return {matched:true,value:raw};
  }
  private sizeOf(format?:string){const bits=Number(format?.match(/\d+/)?.[0]??8);return Math.max(1,bits/8);}
}
