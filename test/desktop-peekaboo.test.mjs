import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PeekabooDesktop} from '../src/desktop/peekaboo.mjs';
import {DESKTOP_IMAGE_LIMIT_BYTES} from '../src/desktop/contract.mjs';
import {peekabooFixture} from './fixtures/peekaboo.mjs';
const observe=driver=>driver.observe({mode:'window',window_id:'123'});
const inputCalls=state=>state.calls.filter(a=>['type','press','click'].includes(a[0]));
test('Peekaboo requires explicit strict session evidence and strict permissions',async()=>{
 const {state,run,driver}=peekabooFixture();
 assert.equal((await new PeekabooDesktop(run).status()).ready,false);
 for(const session of [true,{ready:'true',session_id:'s'},{ready:true},{ready:false,session_id:'s'}]){
  state.session=session;assert.equal((await driver.status()).ready,false);
 }
 state.session={ready:true,session_id:'s'};state.granted='true';
 assert.equal((await driver.status()).state,'permission_denied');
});
test('Peekaboo refuses aliases and mismatched capture metadata',async()=>{
 const {state,driver}=peekabooFixture();
 await assert.rejects(driver.observe({mode:'window',window_id:'Scratch'}),e=>e.code==='invalid_argument');
 for(const see of [{snapshot_reusable:false},{mutation_targeting_available:false},{semantic_scope:'application_partial'},{snapshot_id:'latest'},{observation:{target:{window_id:456}}},{window_title:'Other'},{capture_mode:'screen'}]){
  state.see=see;await assert.rejects(observe(driver),e=>e.code==='invalid_driver_response');
 }
});
test('Peekaboo binds PID, process generation, full title and session across capture and action',async()=>{
 for(const field of ['pid','start','title','session']){
  const {state,driver}=peekabooFixture();
  state.title='x'.repeat(130);
  const captured=await observe(driver);
  if(field==='pid')state.pid=43;
  if(field==='start')state.start='999';
  if(field==='title')state.title='x'.repeat(129)+'y';
  if(field==='session')state.session={ready:true,session_id:'different'};
  await assert.rejects(driver.act(captured.receipt,{type:'type',text:'never'}),e=>e.code==='stale_target');
  assert.equal(inputCalls(state).length,0);
 }
 const {state,driver}=peekabooFixture();
 state.mutate=async(args)=>{if(args[0]==='see')state.title='Changed during capture';};
 await assert.rejects(observe(driver),e=>e.code==='stale_target');
});
test('Peekaboo checks session after asynchronous identity lookups',async()=>{
 const {state,driver}=peekabooFixture();const captured=await observe(driver);
 state.mutate=async args=>{if(args[0]==='window')state.session={ready:true,session_id:'switched'};};
 await assert.rejects(driver.act(captured.receipt,{type:'key',key:'Return'}),e=>e.code==='stale_target');
 assert.equal(inputCalls(state).length,0);
});
test('Peekaboo action uses only observed elements and treats driver failures as uncertain',async()=>{
 const {state,driver}=peekabooFixture();const captured=await observe(driver);
 await assert.rejects(driver.act(captured.receipt,{type:'invoke',element_id:'unseen'}),e=>e.code==='invalid_element');
 assert.equal(inputCalls(state).length,0);
 state.mutate=async args=>{if(args[0]==='type')throw Error('timeout after partial dispatch');};
 assert.equal((await driver.act(captured.receipt,{type:'type',text:'--clear'})).outcome,'outcome_unknown');
 assert.ok(inputCalls(state)[0].includes('--text'));
});
test('Peekaboo reads only requested owned PNG file and removes its capture directory',async()=>{
 const {state,driver}=peekabooFixture();let dest;
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 state.mutate=async(args,data)=>{if(args[0]==='see'){dest=args[args.indexOf('--path')+1];await fs.writeFile(dest,png);data.screenshot_raw=dest;}};
 assert.equal((await observe(driver)).image.data,png.toString('base64'));
 await assert.rejects(fs.stat(dest),{code:'ENOENT'});
});
test('Peekaboo rejects unowned paths, symbolic links and oversized files',async()=>{
 for(const kind of ['path','symlink','size']){
  const {state,driver}=peekabooFixture();let dest;
  state.mutate=async(args,data)=>{
   if(args[0]!=='see')return;
   dest=args[args.indexOf('--path')+1];data.screenshot_raw=dest;
   if(kind==='path')data.screenshot_raw='/etc/passwd';
   if(kind==='symlink')await fs.symlink('/etc/passwd',dest);
   if(kind==='size')await fs.writeFile(dest,Buffer.alloc(DESKTOP_IMAGE_LIMIT_BYTES+1));
  };
  await assert.rejects(observe(driver));await assert.rejects(fs.stat(dest),{code:'ENOENT'});
 }
});
test('Peekaboo bounds inventory and reports incomplete provider data honestly',async()=>{
 const {state,driver}=peekabooFixture();
 state.mutate=async(args,data)=>{if(args[0]==='window')data.inventory_completeness='partial';};
 assert.equal((await driver.observe({mode:'windows'})).truncated,true);
 state.mutate=async(args,data)=>{if(args[0]==='app')data.apps=Array.from({length:51},(_,i)=>({pid:i+1,name:'A'}));if(args[0]==='window'){data.target_application_info.pid=Number(args[3]);data.windows=[];}};
 assert.equal((await driver.observe({mode:'windows'})).truncated,true);
 assert.equal(state.calls.filter(a=>a[0]==='window').length,51);
});
test('Peekaboo rejects screenshot identity mismatches and ambiguous element IDs',async()=>{
 const {state,driver}=peekabooFixture();
 for(const see of [{screenshot_raw:'/tmp/not-ours',coordinate_context:{window:{window_id:456,title:'Scratch'}}},{ui_elements:[{id:'same'},{id:'same'}]},{ui_elements:[{id:'x'.repeat(129)}]}]){
  state.see=see;await assert.rejects(observe(driver));
 }
});
test('Peekaboo missing process generation or inventory owner mismatch cannot authorize capture',async()=>{
 const {state,driver}=peekabooFixture();state.start=undefined;
 await assert.rejects(observe(driver),e=>e.code==='stale_target');
 assert.equal(state.calls.some(a=>a[0]==='see'),false);
 state.start='123';state.mutate=async(args,data)=>{if(args[0]==='window')data.target_application_info.pid=999;};
 assert.equal((await driver.observe({mode:'windows'})).truncated,true);
 await assert.rejects(observe(driver),e=>e.code==='target_not_found');
 assert.equal(state.calls.some(a=>a[0]==='see'),false);
});
test('Peekaboo cannot dispatch when its capture expires during an awaited identity lookup',async()=>{
 const {state,driver}=peekabooFixture();const captured=await observe(driver);
 let release;const pending=new Promise(resolve=>{release=resolve;});
 let entered;const started=new Promise(resolve=>{entered=resolve;});
 state.mutate=async args=>{if(args[0]==='window'){entered();await pending;}};
 const action=driver.act(captured.receipt,{type:'type',text:'never'});
 await started;state.now+=30000;release();
 await assert.rejects(action,e=>e.code==='stale_target');
 assert.equal(inputCalls(state).length,0);
});
