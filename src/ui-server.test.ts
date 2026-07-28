import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fork,ChildProcess} from 'node:child_process';

const waitFor=(child:ChildProcess,predicate:(message:any)=>boolean)=>new Promise<any>((resolve,reject)=>{
  const timeout=setTimeout(()=>{cleanup();reject(new Error('UI server IPC timed out'));},5000);
  const message=(value:any)=>{if(predicate(value)){cleanup();resolve(value);}};
  const exit=(code:number|null)=>{cleanup();reject(new Error(`UI server exited (${code})`));};
  const cleanup=()=>{clearTimeout(timeout);child.off('message',message);child.off('exit',exit);};
  child.on('message',message);child.on('exit',exit);
});

describe('custom UI server',()=>{
  test('returns the complete detected-device cache over IPC',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'echonet-ui-'));
    const devices=Array.from({length:7},(_,index)=>({id:`device-${index}`,ip:'192.168.100.2',eoj:`${index}`.padStart(6,'0'),name:`Device ${index}`,properties:{}}));
    fs.writeFileSync(path.join(directory,'echonet-lite-plus-devices.json'),JSON.stringify({updatedAt:1,devices}));
    const child=fork(path.resolve(__dirname,'../homebridge-ui/server.js'),[],{env:{...process.env,HOMEBRIDGE_STORAGE_PATH:directory},silent:true});
    try{
      await waitFor(child,message=>message?.action==='ready');
      const responsePromise=waitFor(child,message=>message?.action==='response'&&message?.payload?.requestId==='devices-test');
      const streamPromise=waitFor(child,message=>message?.action==='stream'&&message?.payload?.event==='echonet-devices');
      child.send({action:'request',path:'/devices',requestId:'devices-test',body:{}});
      const response=await responsePromise;
      expect(response.payload.success).toBe(true);
      expect(response.payload.data.devices).toHaveLength(7);
      const stream=await streamPromise;
      expect(stream.payload.data.devices).toHaveLength(7);
    }finally{child.kill('SIGTERM');fs.rmSync(directory,{recursive:true,force:true});}
  });

  test('requires a child-bridge restart after settings change before rediscovery',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'echonet-ui-restart-'));
    const child=fork(path.resolve(__dirname,'../homebridge-ui/server.js'),[],{env:{...process.env,HOMEBRIDGE_STORAGE_PATH:directory},silent:true});
    const request=async(pathname:string,id:string)=>{
      const response=waitFor(child,message=>message?.action==='response'&&message?.payload?.requestId===id);
      child.send({action:'request',path:pathname,requestId:id,body:{}});
      return (await response).payload.data;
    };
    try{
      await waitFor(child,message=>message?.action==='ready');
      expect(await request('/settings-changed','changed')).toEqual({restartRequired:true});
      expect(await request('/settings-status','status')).toEqual({restartRequired:true});
      expect(await request('/rediscover','rediscover')).toEqual({accepted:false,restartRequired:true});
      expect(fs.existsSync(path.join(directory,'echonet-lite-plus-rediscover.json'))).toBe(false);
    }finally{child.kill('SIGTERM');fs.rmSync(directory,{recursive:true,force:true});}
  });

  test('clears persisted detected-device history',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'echonet-ui-clear-'));
    fs.writeFileSync(path.join(directory,'echonet-lite-plus-devices.json'),JSON.stringify({devices:[{id:'old'}]}));
    const child=fork(path.resolve(__dirname,'../homebridge-ui/server.js'),[],{env:{...process.env,HOMEBRIDGE_STORAGE_PATH:directory},silent:true});
    try{
      await waitFor(child,message=>message?.action==='ready');
      const response=waitFor(child,message=>message?.action==='response'&&message?.payload?.requestId==='clear');
      child.send({action:'request',path:'/clear-devices',requestId:'clear',body:{}});
      const result=(await response).payload.data;
      expect(result).toMatchObject({devices:[],cleared:true});
      expect(fs.existsSync(path.join(directory,'echonet-lite-plus-devices.json'))).toBe(false);
      expect(fs.existsSync(path.join(directory,'echonet-lite-plus-device-history-cleared'))).toBe(true);
    }finally{child.kill('SIGTERM');fs.rmSync(directory,{recursive:true,force:true});}
  });

  test('removes one detected device while retaining the others',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'echonet-ui-remove-'));
    fs.writeFileSync(path.join(directory,'echonet-lite-plus-devices.json'),JSON.stringify({devices:[{id:'keep'},{id:'remove'}]}));
    const child=fork(path.resolve(__dirname,'../homebridge-ui/server.js'),[],{env:{...process.env,HOMEBRIDGE_STORAGE_PATH:directory},silent:true});
    try{
      await waitFor(child,message=>message?.action==='ready');
      const response=waitFor(child,message=>message?.action==='response'&&message?.payload?.requestId==='remove-one');
      child.send({action:'request',path:'/remove-device',requestId:'remove-one',body:{id:'remove'}});
      const result=(await response).payload.data;
      expect(result.devices).toEqual([{id:'keep'}]);
      expect(result.removedIds).toContain('remove');
      const saved=JSON.parse(fs.readFileSync(path.join(directory,'echonet-lite-plus-devices.json'),'utf8'));
      expect(saved.devices).toEqual([{id:'keep'}]);
    }finally{child.kill('SIGTERM');fs.rmSync(directory,{recursive:true,force:true});}
  });

  test('returns an empty list without logging an error before the first discovery',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'echonet-ui-empty-'));
    const child=fork(path.resolve(__dirname,'../homebridge-ui/server.js'),[],{env:{...process.env,HOMEBRIDGE_STORAGE_PATH:directory},silent:true});
    let stderr='';child.stderr?.on('data',chunk=>stderr+=String(chunk));
    try{
      await waitFor(child,message=>message?.action==='ready');
      const response=waitFor(child,message=>message?.action==='response'&&message?.payload?.requestId==='empty');
      child.send({action:'request',path:'/devices',requestId:'empty',body:{}});
      expect((await response).payload.data.devices).toEqual([]);
      await new Promise(resolve=>setTimeout(resolve,20));
      expect(stderr).toBe('');
    }finally{child.kill('SIGTERM');fs.rmSync(directory,{recursive:true,force:true});}
  });
});
