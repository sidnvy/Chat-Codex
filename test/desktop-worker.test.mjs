import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHyprlandWorkerSource} from '../src/desktop/hyprland-worker.mjs';
const exec=promisify(execFile);

test('canonical one-shot worker runs from an empty directory without dependencies',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'styx-worker-test-'));
 try{
  const bin=path.join(root,'bin'),tmp=path.join(root,'tmp'),cwd=path.join(root,'empty');
  await Promise.all([bin,tmp,cwd].map(p=>fs.mkdir(p)));
  for(const name of ['hyprctl','grim','wtype'])await fs.writeFile(path.join(bin,name),`#!${process.execPath}
const fs=require('node:fs');const name=require('node:path').basename(process.argv[1]);
const active={address:'0x123',pid:77,title:'Scratch',at:[0,0],size:[100,80],mapped:true};
if(name==='hyprctl'){const q=process.argv[3];console.log(JSON.stringify(q==='monitors'?[{name:'fixture',width:100,height:80}]:q==='locked'?{locked:false}:q==='clients'?[active]:active));}
if(name==='grim'){const image=Buffer.alloc(100);Buffer.from([137,80,78,71,13,10,26,10]).copy(image);fs.writeFileSync(process.argv.at(-1),image);}
if(name==='wtype')fs.writeFileSync(${JSON.stringify(path.join(root,'action.json'))},JSON.stringify(process.argv.slice(2)));
`,{mode:0o755});
  const source=createHyprlandWorkerSource();assert.ok(Buffer.byteLength(source)<100000);
  const call=async request=>JSON.parse((await exec(process.execPath,['-e',source,'--',Buffer.from(JSON.stringify(request)).toString('base64')],{
   cwd,env:{PATH:bin,TMPDIR:tmp,HYPRLAND_INSTANCE_SIGNATURE:'fixture-session'},maxBuffer:2097152
  })).stdout);
  const status=await call({operation:'status'});assert.equal(status.result.ready,true);assert.ok(status.result.session_id);assert.equal(status.result.error,undefined);
  const inventory=await call({operation:'windows'});assert.equal(inventory.result.windows[0].workspace,undefined);
  const observed=await call({operation:'window',window_id:'0x123'});
  assert.equal(observed.ok,true);assert.equal(observed.result.receipt.window_id,'0x123');
  assert.ok(Number.isSafeInteger(observed.result.receipt.observed_at));
  assert.deepEqual(await fs.readdir(tmp),[]);
  const result=await call({operation:'act',window:observed.result.window,receipt:observed.result.receipt,action:{type:'type',text:'literal $() ; value'}});
  assert.equal(result.result.outcome,'dispatched_unverified');assert.equal(result.result.verified,false);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'action.json'),'utf8')),['--','literal $() ; value']);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('worker factory rejects unbounded trusted limits',()=>{
 for(const options of [{timeoutMs:0},{timeoutMs:10001},{maxImageBytes:99},{maxImageBytes:2097153}])assert.throws(()=>createHyprlandWorkerSource(options),TypeError);
});
