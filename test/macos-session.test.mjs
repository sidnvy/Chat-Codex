import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {macOSSessionProbe} from '../src/desktop/macos-session.mjs';

test('native macOS probe validates actual plist parsing and exposes only opaque evidence',async()=>{
 const platform=Object.getOwnPropertyDescriptor(process,'platform'),getuid=process.getuid;
 Object.defineProperty(process,'platform',{value:'darwin'});process.getuid=()=>501;
 try{
  const user={kCGSSessionOnConsoleKey:true,kCGSessionLoginDoneKey:true,kCGSSessionUserIDKey:501,CGSSessionUniqueSessionUUID:'private-login-uuid',kCGSSessionIDKey:7};
  const runFor=state=>async(binary,args)=>{
   assert.equal(binary,'python3');assert.equal(args[0],'-c');
   const encoded=Buffer.from(JSON.stringify(state)).toString('base64');
   const prefix=`import subprocess,plistlib,os,json,base64\nsubprocess.check_output=lambda *a,**kw:plistlib.dumps(json.loads(base64.b64decode('${encoded}')))\nos.geteuid=lambda:501\n`;
   return execFileSync('python3',['-c',prefix+args[1]],{encoding:'utf8'});
  };
  const ready=await macOSSessionProbe(runFor({IOConsoleLocked:false,IOConsoleUsers:[user]}));
  assert.equal(ready.ready,true);assert.match(ready.session_id,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(ready).includes('private-login'));
  const rotated=await macOSSessionProbe(runFor({IOConsoleLocked:false,IOConsoleUsers:[{...user,CGSSessionUniqueSessionUUID:'new-login'}]}));
  assert.notEqual(rotated.session_id,ready.session_id);
  assert.deepEqual(await macOSSessionProbe(runFor({IOConsoleLocked:true,IOConsoleUsers:[user]})),{ready:false,state:'locked'});
  for(const state of [{IOConsoleLocked:0,IOConsoleUsers:[user]},{IOConsoleLocked:true,IOConsoleUsers:[]},{IOConsoleLocked:false,IOConsoleUsers:[user,user]},{IOConsoleLocked:false,IOConsoleUsers:[{...user,kCGSSessionUserIDKey:502}]},{IOConsoleLocked:false,IOConsoleUsers:[{...user,kCGSessionLoginDoneKey:false}]}])assert.deepEqual(await macOSSessionProbe(runFor(state)),{ready:false});
  process.getuid=()=>0;let called=false;assert.deepEqual(await macOSSessionProbe(async()=>{called=true;}),{ready:false});assert.equal(called,false);
 }finally{Object.defineProperty(process,'platform',platform);process.getuid=getuid;}
});
