declare module 'echonet-lite' {
  export interface RInfo { address:string }
  export interface ElData { ESV:string; SEOJ:string; DEOJ:string; DETAILs:Record<string,string> }
  export const GET:string; export const SETC:string; export const GET_RES:string; export const INF:string;
  export const facilities:Record<string,Record<string,Record<string,string>>>;
  export function initialize(objects:string[],callback:(r:RInfo,e:ElData)=>void,ipVersion?:number,options?:{v4?:string;v6?:string;ignoreMe?:boolean;autoGetProperties?:boolean;autoGetDelay?:number;debugMode?:boolean}):Promise<unknown>;
  export function release():void;
  export function search():void;
  export function sendOPC1(ip:string,seoj:string,deoj:string,esv:string,epc:string,edt:string):number[];
}
