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
function multipleApps(){
 const fixture=peekabooFixture();const {state}=fixture;
 state.mutate=async(args,data)=>{
  if(args[0]==='app')data.apps.push({pid:99,name:'Unrelated',process_start_identity_decimal:'999'});
  if(args[0]==='window'&&args[3]==='99'){
   data.target_application_info.pid=99;data.windows=[{window_id:456,window_title:'Unrelated'}];
  }
 };
 return fixture;
}
test('Peekaboo exact observation reuses a locator but rechecks only its live PID windows',async()=>{
 const {state,driver}=multipleApps();
 await driver.observe({mode:'windows'});state.calls=[];
 const seen=await observe(driver);
 assert.equal(seen.window.title,'Scratch');assert.equal(seen.window.pid,42);
 assert.deepEqual(state.calls.filter(a=>a[0]==='window').map(a=>a[3]),['42','42']);
 assert.equal(state.calls.filter(a=>a[0]==='app').length,2);
 assert.equal(state.calls.filter(a=>a[0]==='see').length,1);
 await driver.act(seen.receipt,{type:'type',text:'fresh'});
 assert.equal(state.calls.filter(a=>a[0]==='app').length,3);
});
test('Peekaboo stale locators cannot authorize capture after PID, generation or title changes',async()=>{
 for(const field of ['pid','start','title']){
  const {state,driver}=multipleApps();await driver.observe({mode:'windows'});state.calls=[];
  if(field==='pid')state.pid=43;if(field==='start')state.start='987';if(field==='title')state.title='Changed';
  await assert.rejects(observe(driver),e=>e.code==='stale_target');
  assert.equal(state.calls.filter(a=>a[0]==='see').length,0);
  await driver.observe({mode:'windows'});
  assert.equal((await observe(driver)).window.title,state.title);
 }
});
test('Peekaboo session change discards locator and requires rediscovery',async()=>{
 const {state,driver}=multipleApps();await driver.observe({mode:'windows'});state.calls=[];
 state.session={ready:true,session_id:'new-session'};state.title='New session title';
 const seen=await observe(driver);
 assert.equal(seen.window.title,state.title);
 assert.ok(state.calls.some(a=>a[0]==='window'&&a[3]==='99'));
});
test('Peekaboo duplicate discovery IDs never become authoritative locators',async()=>{
 const {state,driver}=multipleApps();const original=state.mutate;
 state.mutate=async(args,data)=>{await original(args,data);if(args[0]==='window'&&args[3]==='99')data.windows[0].window_id=123;};
 await driver.observe({mode:'windows'});state.calls=[];
 await assert.rejects(observe(driver),e=>e.code==='target_not_found');
 assert.ok(state.calls.some(a=>a[0]==='window'&&a[3]==='99'));
 assert.equal(state.calls.some(a=>a[0]==='see'),false);
});
test('Peekaboo rejects duplicate live IDs even when prior discovery was unique',async()=>{
 const {state,driver}=multipleApps();await driver.observe({mode:'windows'});const original=state.mutate;
 state.mutate=async(args,data)=>{await original(args,data);if(args[0]==='window'&&args[3]==='42')data.windows.push({...data.windows[0]});};
 await assert.rejects(observe(driver),e=>e.code==='stale_target');
 assert.equal(state.calls.some(a=>a[0]==='see'),false);
});
test('Peekaboo locators are bounded to100 and exclude duplicate IDs beyond the output slice',async()=>{
 for(const duplicate of [false,true]){
  const {state,driver}=peekabooFixture();
  state.mutate=async(args,data)=>{if(args[0]==='window')data.windows=Array.from({length:101},(_,i)=>({window_id:duplicate&&i===100?1:i+1,window_title:'Window'}));};
  const listed=await driver.observe({mode:'windows'});
  assert.equal(listed.windows.length,100);assert.equal(listed.truncated,true);state.calls=[];
  await assert.rejects(driver.observe({mode:'window',window_id:duplicate?'1':'101'}),e=>e.code==='target_not_found');
  assert.equal(state.calls.filter(a=>a[0]==='window').length,1);
  assert.equal(state.calls.some(a=>a[0]==='see'),false);
 }
});
test('Peekaboo explicitly accepts native unverified typing without retry or target broadening',async()=>{
 const {state,driver}=peekabooFixture();const captured=await observe(driver);
 const result=await driver.act(captured.receipt,{type:'type',text:'literal'});
 assert.deepEqual(result,{driver:'peekaboo',outcome:'dispatched_unverified',verified:false});
 assert.deepEqual(inputCalls(state),[['type','--text','literal','--accept-dispatched','--snapshot','pb-snap','--pid','42','--window-id','123','--bridge-socket',driver.bridgeSocket,'--json']]);
});
test('Peekaboo success alone cannot promote refused, partial, indeterminate or contradictory outcomes',async()=>{
 for(const patch of [null,{}, {route:undefined},{delivery_mechanism:undefined},{delivery_mechanism:'global_events'},{dispatched_unit_count:0},{state:'refused'},{state:'partial'},{state:'indeterminate'},{state:'suspected_noop'},{state:'confirmed_no_change'},{dispatch_state:'may_have_dispatched'},{mutation_dispatched:false},{retry_safe:true},{delivery_mode:'foreground'},{refusal_reason:'target_unavailable'},{requires_fresh_observation:false},{evidence:'verified_change'}]){
  const {state,driver}=peekabooFixture();const captured=await observe(driver);
  state.outcome=patch===null?undefined:Object.keys(patch).length?{...state.outcome,...patch}:{};
  assert.equal((await driver.act(captured.receipt,{type:'type',text:'once'})).outcome,'outcome_unknown');
  assert.equal(inputCalls(state).length,1);
 }
});
test('Peekaboo native confirmation remains unverified by Styx and key/click use the same envelope check',async()=>{
 for(const action of [{type:'type',text:'text'},{type:'key',key:'Return'},{type:'invoke',element_id:'B1'}]){
  const {state,driver}=peekabooFixture();const captured=await observe(driver);
  Object.assign(state.outcome,{state:'confirmed_change',effect:'confirmed',evidence:'verified_change',retry_safety:'not_applicable',escalation:'none',requires_fresh_observation:false});
  assert.equal((await driver.act(captured.receipt,action)).outcome,'dispatched_unverified');
  state.outcome.state='partial';
  assert.equal((await driver.act(captured.receipt,action)).outcome,'outcome_unknown');
 }
});
test('Peekaboo failed or malformed command envelopes stay unknown even with accepted outcome data',async()=>{
 for(const malformed of [false,true]){
  const {state,run}=peekabooFixture();
  const driver=new PeekabooDesktop(async(command,args)=>{
   const raw=await run(command,args);
   if(args[0]!=='type')return raw;
   return malformed?'not-json':JSON.stringify({...JSON.parse(raw),success:false,error:{code:'INTERACTION_FAILED'}});
  },async()=>state.session,()=>state.now);
  const captured=await observe(driver);
  assert.equal((await driver.act(captured.receipt,{type:'type',text:'once'})).outcome,'outcome_unknown');
  assert.equal(inputCalls(state).length,1);
 }
});

test('Peekaboo refuses local permission evidence and missing GUI identity without fallback',async()=>{
 for(const change of [(_args,data)=>{delete data.candidates[0].result.success._0.hostIdentity;},(_args,data)=>{data.candidates[0].result.success._0.hostKind='daemon';}]){
  const {driver,state}=peekabooFixture();state.mutate=(args,data)=>{if(args[0]==='bridge')change(args,data);};
  assert.equal((await driver.status()).ready,false);assert.equal(state.calls.some(args=>args.includes('--no-remote')),false);
 }
 const {driver,state}=peekabooFixture();state.mutate=(args,data)=>{if(args[0]==='permissions')data.source='local';};assert.equal((await driver.status()).state,'permission_denied');
});
test('Peekaboo GUI generation change invalidates captured authority and local outcomes stay unknown',async()=>{
 const {driver,state}=peekabooFixture();const seen=await driver.observe({mode:'window',window_id:'123'});
 state.mutate=(args,data)=>{if(args[0]==='bridge')data.candidates[0].result.success._0.hostIdentity.processStartIdentityDecimal='124';};
 await assert.rejects(driver.act(seen.receipt,{type:'type',text:'x'}),e=>e.code==='stale_target');assert.equal(state.calls.some(a=>a[0]==='type'),false);
 state.mutate=null;state.outcome.route='local';assert.equal((await driver.act(seen.receipt,{type:'type',text:'x'})).outcome,'outcome_unknown');
});

test('Peekaboo structured capture refusals remain distinct from permissions and session state',async()=>{
 for(const nonzero of [true,false]){
  const {driver,run}=peekabooFixture();driver.run=async(b,a)=>{if(a[0]==='see'){if(nonzero){const e=new Error('private');e.native_code='CAPTURE_FAILED';throw e;}return JSON.stringify({success:false,error:{code:'CAPTURE_FAILED',message:'private'}});}return run(b,a);};
  await assert.rejects(driver.observe({mode:'window',window_id:'123'}),e=>e.code==='capture_unavailable'&&!e.message.includes('private'));
 }
});
