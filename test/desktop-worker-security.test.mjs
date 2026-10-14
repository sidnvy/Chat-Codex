import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHyprlandWorkerSource} from '../src/desktop/hyprland-worker.mjs';
const exec=promisify(execFile);
const native=`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const state=JSON.parse(process.env.STYX_TEST_STATE),command=path.basename(process.argv[1]),args=process.argv.slice(2);
fs.appendFileSync(process.env.STYX_TEST_CALLS,JSON.stringify({command,args})+'\\n');
const window={address:'0x123',title:'Scratch',pid:44,class:'scratch',mapped:true,at:[0,0],size:[120,80]};
const finish=()=>{
 if(state.fail===command){process.stderr.write('SYNTHETIC_PRIVATE_NATIVE_DETAIL');process.exit(1);}
 if(command==='hyprctl'){
  const data=args[1]==='monitors'?[{name:'test',width:120,height:80}]:args[1]==='locked'?{locked:state.locked??false}:args[1]==='clients'?[window]:{...window,pid:state.pid??44};
  process.stdout.write(JSON.stringify(data));
 }else if(command==='grim'){
  const bytes=Buffer.alloc(state.imageSize??100);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  if(state.invalidPng)bytes[0]=0;
  fs.writeFileSync(args.at(-1),bytes);
 }
};
if(state.delay&&command==='hyprctl')setTimeout(finish,state.delay);else finish();
`;
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'styx-worker-security-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const bin=path.join(dir,'bin'),tmp=path.join(dir,'tmp'),callsFile=path.join(dir,'calls');
 await fs.mkdir(bin);await fs.mkdir(tmp);await fs.writeFile(callsFile,'');
 for(const cmd of ['hyprctl','grim','wtype'])await fs.writeFile(path.join(bin,cmd),native,{mode:0o700});
 const calls=async()=>(await fs.readFile(callsFile,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
 const run=async(request,{state={},session='test-session',limits={},raw}={})=>{
  const source=createHyprlandWorkerSource(limits),payload=raw??Buffer.from(JSON.stringify(request)).toString('base64');
  const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,TMPDIR:tmp,STYX_TEST_STATE:JSON.stringify(state),STYX_TEST_CALLS:callsFile};
  if(session===null)delete env.HYPRLAND_INSTANCE_SIGNATURE;else env.HYPRLAND_INSTANCE_SIGNATURE=session;
  let output;try{output=await exec(process.execPath,['-e',source,'--',payload],{env,timeout:4000,maxBuffer:4194304});}
  catch(e){if(e.killed||!e.stdout)throw Error(JSON.stringify({code:e.code,killed:e.killed,stderr:e.stderr,stdout:e.stdout}));output=e;}
  assert.ok(!output.stdout.includes('SYNTHETIC_PRIVATE_NATIVE_DETAIL'));assert.equal(output.stderr,'');
  return JSON.parse(output.stdout);
 };
 return {run,calls,tmp};
}
const mutation=seen=>({operation:'act',window:seen.result.window,receipt:seen.result.receipt,action:{type:'key',key:'Return'}});

test('serialized worker rejects malformed operations and payloads before native execution',async t=>{
 const f=await fixture(t);
 for(const request of [{operation:'shell',command:'touch unsafe'},{operation:'status',executable:'fake'},{operation:'act',window:{id:'x'},receipt:{window_id:'x',observed_at:Date.now()},action:{type:'click',x:0,y:0}}]){
  assert.equal((await f.run(request)).ok,false);
 }
 assert.equal((await f.run(null,{raw:'not-base64!'})).ok,false);assert.equal((await f.calls()).length,0);
});

test('serialized worker passes input literally and does not expose pointer capability',async t=>{
 const f=await fixture(t),status=await f.run({operation:'status'});
 assert.equal(status.result.ready,true);assert.ok(!status.result.capabilities.includes('pointer'));
 const seen=await f.run({operation:'window',window_id:'0x123'});assert.equal(seen.ok,true);
 const request=mutation(seen),text="$(touch /tmp/never-run) ; 'quoted' --help @file";request.action={type:'type',text};
 const acted=await f.run(request);assert.equal(acted.result.outcome,'dispatched_unverified');
 assert.deepEqual((await f.calls()).filter(c=>c.command==='wtype').map(c=>c.args),[['--',text]]);
 assert.deepEqual(await fs.readdir(f.tmp),[]);
});

test('serialized worker rejects replacement sessions and stale receipts without dispatch',async t=>{
 const f=await fixture(t),seen=await f.run({operation:'window',window_id:'0x123'});
 assert.equal((await f.run({operation:'status'},{session:null})).result.ready,false);
 assert.equal((await f.run(mutation(seen),{session:'replacement-session'})).ok,false);
 const expired=mutation(seen);expired.receipt={...expired.receipt,observed_at:Date.now()-30000};
 assert.equal((await f.run(expired)).ok,false);assert.equal((await f.calls()).filter(c=>c.command==='wtype').length,0);
});

test('serialized worker sanitizes failed mutations and never retries them',async t=>{
 const f=await fixture(t),seen=await f.run({operation:'window',window_id:'0x123'});
 const failed=await f.run(mutation(seen),{state:{fail:'wtype'}});
 assert.deepEqual(failed,{ok:true,result:{driver:'hyprland',outcome:'outcome_unknown',verified:false}});
 assert.equal((await f.calls()).filter(c=>c.command==='wtype').length,1);
});

test('serialized worker removes captures after invalid or oversized PNG results',async t=>{
 const f=await fixture(t);
 for(const state of [{invalidPng:true},{imageSize:200}]){
  const result=await f.run({operation:'window',window_id:'0x123'},{state,limits:{maxImageBytes:100}});
  assert.equal(result.ok,false);assert.equal(result.error,'invalid_capture');assert.deepEqual(await fs.readdir(f.tmp),[]);
 }
});

test('serialized worker bounds native readiness calls and rejects expiry during validation',async t=>{
 const f=await fixture(t),started=Date.now();
 const result=await f.run({operation:'status'},{state:{delay:1000},limits:{timeoutMs:100}});
 assert.equal(result.ok,false);assert.equal(result.error,'timeout');assert.ok(Date.now()-started<1500);
 const seen=await f.run({operation:'window',window_id:'0x123'}),request=mutation(seen);
 request.receipt={...request.receipt,observed_at:Date.now()-29800};
 const stale=await f.run(request,{state:{delay:150}});
 assert.equal(stale.ok,false);assert.equal((await f.calls()).filter(c=>c.command==='wtype').length,0);
});
