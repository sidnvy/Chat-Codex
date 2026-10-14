import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createPeekabooWorkerSource} from '../src/desktop/peekaboo-worker.mjs';
import {PeekabooDesktop} from '../src/desktop/peekaboo.mjs';
const exec=promisify(execFile);
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'styx-mac-worker-test-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const bin=path.join(root,'bin'),tmp=path.join(root,'tmp');await fs.mkdir(bin);await fs.mkdir(tmp);
 const statePath=path.join(root,'state.json'),log=path.join(root,'dispatch.json');
 const state={session:'a'.repeat(64),title:'Scratch',start:'123456789',size:100};
 const save=()=>fs.writeFile(statePath,JSON.stringify(state));await save();
 await fs.writeFile(path.join(bin,'python3'),`#!${process.execPath}
const state=JSON.parse(require('node:fs').readFileSync(${JSON.stringify(statePath)},'utf8'));
console.log(JSON.stringify(state.locked?{ready:false,state:'locked'}:{ready:true,session_id:state.session}));
`,{mode:0o755});
 await fs.writeFile(path.join(bin,'peekaboo'),`#!${process.execPath}
const fs=require('node:fs'),state=JSON.parse(fs.readFileSync(${JSON.stringify(statePath)},'utf8')),args=process.argv.slice(2);
const outcome={route:'bridge',delivery_mechanism:'accessibility_action',state:'dispatched_unverified',effect:'unverifiable',delivery_mode:'background',dispatch_state:'dispatched',mutation_dispatched:true,evidence:'delivery_accepted',retry_safe:false,retry_safety:'unsafe',escalation:'observe_before_retry',requires_fresh_observation:true};
async function main(){
if(state.delay)await new Promise(r=>setTimeout(r,state.delay));
if(state.fail){process.stderr.write('PRIVATE_NATIVE_ERROR');process.exit(1);}
let data={};
if(args[0]==='permissions')data={permissions:['Screen Recording','Accessibility'].map(name=>({name,isGranted:!state.denied}))};
if(args[0]==='app')data={apps:[{pid:42,name:'Scratch App',bundle_id:'org.example.scratch',process_start_identity_decimal:state.start}],warnings:[]};
if(args[0]==='window')data={target_application_info:{pid:42},inventory_completeness:'complete',windows:[{window_id:123,window_title:state.title}]};
if(args[0]==='see'){
 const dest=args[args.indexOf('--path')+1],png=Buffer.alloc(state.size);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);if(state.badPng)png[7]=0;fs.writeFileSync(dest,png);
 data={snapshot_id:'snapshot-exact',snapshot_reusable:true,mutation_targeting_available:true,semantic_scope:'exact_or_requested',capture_mode:'window',coordinate_context:{window:{window_id:123,title:state.title}},observation:{target:{window_id:123}},window_title:state.title,screenshot_raw:dest,ui_elements:[{id:'elem_1',role:'button',label:'Commit',value:'visible'}]};
}
if(args[0]==='click'){fs.writeFileSync(${JSON.stringify(log)},JSON.stringify(args));if(state.failMutation)process.exit(1);}
console.log(JSON.stringify({success:true,data,...(args[0]==='click'?{outcome}:{})}));
}main();
`,{mode:0o755});
 const call=async(req,options={})=>{
  const source=createPeekabooWorkerSource(options);assert.ok(Buffer.byteLength(source)<100000);
  // Simulated OS only in this fixture process. Production source has no bypass.
  const prelude="Object.defineProperty(process,'platform',{value:'darwin'});process.getuid=()=>1000;";
  try{return JSON.parse((await exec(process.execPath,['-e',prelude+source,'--',Buffer.from(JSON.stringify(req)).toString('base64')],{cwd:root,env:{PATH:bin,TMPDIR:tmp},maxBuffer:2097152})).stdout);}
  catch(e){return JSON.parse(e.stdout);}
 };
 return {state,save,call,tmp,log,observe:()=>call({operation:'window',window_id:'123'})};
}

test('serialized Peekaboo worker preserves exact capture and invoke receipts without Host dependencies',async t=>{
 const f=await fixture(t);const status=await f.call({operation:'status'});
 assert.equal(status.result.ready,true);assert.deepEqual(status.result.capabilities,['windows','window_screenshot','accessibility','element_invoke']);
 const seen=(await f.observe()).result;assert.equal(seen.window.app,'org.example.scratch');assert.equal(seen.elements[0].value,'visible');
 assert.equal(seen.window.process_start,undefined);assert.equal(seen.window.full_title,undefined);
 assert.deepEqual(await fs.readdir(f.tmp),[]);
 const result=await f.call({operation:'act',window:seen.window,receipt:seen.receipt,action:{type:'invoke',element_id:'elem_1'}});
 assert.equal(result.result.outcome,'dispatched_unverified');assert.equal(result.result.verified,false);
 const args=JSON.parse(await fs.readFile(f.log,'utf8'));assert.ok(args.includes('snapshot-exact'));assert.ok(args.includes('--pid'));assert.ok(args.includes('--window-id'));
});

test('Peekaboo worker denies stale sessions, expiry and expanded actions before input',async t=>{
 const f=await fixture(t),seen=(await f.observe()).result;
 for(const mutation of [()=>{f.state.session='b'.repeat(64);},()=>{f.state.session='a'.repeat(64);f.state.start='987654321';},()=>{f.state.start='123456789';f.state.locked=true;}]){
  mutation();await f.save();const r=await f.call({operation:'act',window:seen.window,receipt:seen.receipt,action:{type:'invoke',element_id:'elem_1'}});assert.equal(r.ok,false);
 }
 f.state.locked=false;await f.save();
 for(const action of [{type:'type',text:'not exposed'},{type:'invoke',element_id:'elem_2'}]){
  const r=await f.call({operation:'act',window:seen.window,receipt:seen.receipt,action});assert.equal(r.ok,false);
 }
 const r=await f.call({operation:'act',window:seen.window,receipt:{...seen.receipt,observed_at:Date.now()-30000},action:{type:'invoke',element_id:'elem_1'}});assert.equal(r.error,'invalid_snapshot');
 await assert.rejects(fs.access(f.log));
});

test('Peekaboo worker bounds capture, cleans files and keeps uncertain mutations conservative',async t=>{
 const f=await fixture(t);
 for(const state of [{size:393217},{size:100,badPng:true}]){
  Object.assign(f.state,state);await f.save();assert.equal((await f.observe()).error,'invalid_capture');assert.deepEqual(await fs.readdir(f.tmp),[]);
 }
 f.state.badPng=false;await f.save();const seen=(await f.observe()).result;
 f.state.failMutation=true;await f.save();const r=await f.call({operation:'act',window:seen.window,receipt:seen.receipt,action:{type:'invoke',element_id:'elem_1'}});
 assert.equal(r.result.outcome,'outcome_unknown');assert.equal(r.result.verified,false);
 f.state.fail=true;await f.save();const failed=await f.call({operation:'status'});assert.ok(!JSON.stringify(failed).includes('PRIVATE_NATIVE_ERROR'));
 f.state.fail=false;f.state.delay=500;await f.save();const started=Date.now();await f.call({operation:'windows'},{timeoutMs:100});assert.ok(Date.now()-started<3000);assert.deepEqual(await fs.readdir(f.tmp),[]);
});

test('Peekaboo inventory is bounded parallel, ordered, and retains completeness evidence',async()=>{
 let active=0,peak=0;
 const driver=new PeekabooDesktop(async(_cmd,args)=>{
  if(args[0]==='app')return JSON.stringify({success:true,data:{apps:Array.from({length:8},(_,i)=>({pid:i+1,name:'app',process_start_identity_decimal:'1'}))}});
  const pid=Number(args[args.indexOf('--pid')+1]);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,15*(9-pid)));active--;
  return JSON.stringify({success:true,data:{target_application_info:{pid},inventory_completeness:pid===8?'partial':'complete',windows:[{window_id:pid===8?1:pid,window_title:'window'}]}});
 });
 const result=await driver.inventory();assert.equal(peak,4);assert.deepEqual(result.windows.map(w=>w.pid),[1,2,3,4,5,6,7,8]);assert.equal(result.truncated,true);assert.ok(result.duplicate_ids.has('1'));
});
