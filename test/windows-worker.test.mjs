import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {WinappDesktop} from '../src/desktop/winapp.mjs';
import {createWindowsWorkerSource} from '../src/desktop/windows-worker.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(){
 const state={proof:{hwnd:'123',pid:'42',start_time:'123456',session_id:1,session_generation:'a'.repeat(64),user_sid:'S-1-5-21-1',thread_desktop:'Default',thread_receiving:true,same_user:true,title:'Scratch'},element:{selector:'txt-a-1234',type:'Edit',name:'Name',className:'Edit',automationId:'input',isEnabled:true,isOffscreen:false,isInvokable:true},commands:[]};
 const run=async(_exe,args)=>{
  state.commands.push(args);
  if(args[1]==='list-windows')return JSON.stringify([{hwnd:'123',processId:42,title:'Scratch'}]);
  if(args[1]==='inspect')return JSON.stringify({windows:[{hwnd:'123',elements:[state.element]}]});
  if(args[1]==='set-value')return JSON.stringify({hwnd:'123',elementId:'txt-a-1234'});
  if(args[1]==='invoke')return JSON.stringify({hwnd:'123',elementId:'txt-a-1234',pattern:'InvokePattern',requestedAction:'invoke',performedAction:'invoke'});
  throw Error('Unexpected command');
 };
 const driver=new WinappDesktop(run,async()=>({ready:true,session_id:'session1'}),{windowProbe:async()=>({...state.proof})});
 return {state,driver,observe:()=>driver.observe({mode:'window',window_id:'123'})};
}
test('strict Windows native binding rejects process reuse, owner/session/title changes',async()=>{
 for(const [field,value] of [['start_time','789'],['session_id',2],['session_generation','b'.repeat(64)],['user_sid','S-1-5-21-2'],['title','Changed'],['thread_desktop','Other'],['thread_desktop',undefined],['thread_receiving',false],['thread_receiving',undefined]]){
  const f=fixture(),o=await f.observe();f.state.proof[field]=value;
  await assert.rejects(f.driver.act(o.receipt,{type:'set_value',element_id:'txt-a-1234',value:'safe'}),{code:'stale_target'});
  assert.equal(f.state.commands.some(a=>a[1]==='set-value'),false);
 }
});
test('strict Windows fresh element fingerprint and action restrictions fail before dispatch',async()=>{
 for(const patch of [{name:'changed'},{automationId:'new'},{className:'changed'},{isEnabled:false},{isOffscreen:true},{type:'Button'}]){
  const f=fixture(),o=await f.observe();Object.assign(f.state.element,patch);
  await assert.rejects(f.driver.act(o.receipt,{type:'set_value',element_id:'txt-a-1234',value:'safe'}));
  assert.equal(f.state.commands.some(a=>a[1]==='set-value'),false);
 }
 for(const value of ['-option','@file','x\0x','a'.repeat(501)]){
  const f=fixture(),o=await f.observe();await assert.rejects(f.driver.act(o.receipt,{type:'set_value',element_id:'txt-a-1234',value}),{code:'unsupported_action'});
 }
});
test('strict native capture requires exact proof and complete bounded PNG',async()=>{
 const f=fixture();const png=Buffer.alloc(100);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
 const identity={hwnd:'123',pid:'42',start_time:'123456',session_id:1,session_generation:'a'.repeat(64),user_sid:'S-1-5-21-1',thread_desktop:'Default',thread_receiving:true,title_digest:hash('Scratch')};
 f.driver.captureProbe=async()=>({identity,image:{data:png.toString('base64')}});
 assert.equal((await f.observe()).image.data,png.toString('base64'));
 identity.start_time='other';await assert.rejects(f.observe(),{code:'stale_target'});
});
test('strict unchanged evidence dispatches exact UIA action once without verification claim',async()=>{
 const f=fixture(),o=await f.observe();
 assert.equal((await f.driver.act(o.receipt,{type:'set_value',element_id:'txt-a-1234',value:'literal $(x);'})).outcome,'dispatched_unverified');
 assert.equal(f.state.commands.filter(a=>a[1]==='set-value').length,1);
});
test('Windows source requires trusted installation, contains actual canonical graph without Zod',()=>{
 assert.throws(()=>createWindowsWorkerSource(),TypeError);
 const source=createWindowsWorkerSource({winappSha256:'a'.repeat(64),harfbuzzSha256:'b'.repeat(64),skiaSha256:'c'.repeat(64)});
 assert.ok(source.length>32768);assert.ok(source.includes('data:text/javascript;base64,'));
 assert.doesNotThrow(()=>new Function(source));
});

test('strict native recheck that crosses TTL never enters mutation',async()=>{
 const f=fixture(),o=await f.observe(),clock=Date.now;
 f.driver.windowProbe=async()=>{Date.now=()=>o.receipt.observed_at+30000;return {...f.state.proof};};
 try{await assert.rejects(f.driver.act(o.receipt,{type:'invoke',element_id:'txt-a-1234'}),{code:'stale_target'});}
 finally{Date.now=clock;}
 assert.equal(f.state.commands.some(a=>a[1]==='invoke'),false);
});
test('unsafe observed selectors and non-invokable elements cannot dispatch',async()=>{
 for(const selector of ['-flag','@file']){
  const f=fixture();f.state.element.selector=selector;const o=await f.observe();
  await assert.rejects(f.driver.act(o.receipt,{type:'invoke',element_id:selector}),{code:'stale_target'});
 }
 const f=fixture(),o=await f.observe();f.state.element.isInvokable=false;
 await assert.rejects(f.driver.act(o.receipt,{type:'invoke',element_id:'txt-a-1234'}),{code:'unsupported_action'});
});
test('serialized worker reads stdin and rejects malformed/oversized requests without native execution',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
 const {join}=await import('node:path');const {tmpdir}=await import('node:os');const {spawn}=await import('node:child_process');
 const dir=await mkdtemp(join(tmpdir(),'styx-windows-worker-test-'));
 try{
  const file=join(dir,'worker.mjs');await writeFile(file,createWindowsWorkerSource({winappSha256:'a'.repeat(64),harfbuzzSha256:'b'.repeat(64),skiaSha256:'c'.repeat(64)}));
  for(const input of ['not-json',JSON.stringify({operation:'shell'}),' '.repeat(65537)]){
   const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[file],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill();reject(Error('Worker deadline exceeded'));},4000);
    child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);
    child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});child.stdin.on('error',()=>{});child.stdin.end(input);
   });
   assert.equal(result.code,1);assert.equal(result.stderr,'');assert.deepEqual(JSON.parse(result.stdout),{ok:false,error:'invalid_payload'});
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('Windows UIA optional value remains bounded in public observation',async()=>{
 const f=fixture();f.state.element.value='x'.repeat(250);
 assert.equal((await f.observe()).elements[0].value,'x'.repeat(200));
});

test('native inventory preserves incomplete evidence and exact-title scope',async()=>{
 for(const code of ['permission_denied','target_not_found']){
  const f=fixture();let probes=0;f.driver.windowProbe=async()=>{probes++;throw Object.assign(Error('unavailable'),{code});};
  const denied=await f.driver.verifiedWindows();assert.equal(denied.truncated,true);assert.deepEqual(denied.windows,[]);
  const unrelated=await f.driver.verifiedWindows({title:'Other'});assert.equal(unrelated.truncated,false);assert.deepEqual(unrelated.windows,[]);assert.equal(probes,1);
  const matching=await f.driver.verifiedWindows({title:'Scratch'});assert.equal(matching.truncated,true);assert.deepEqual(matching.windows,[]);
 }
 const f=fixture();assert.equal((await f.driver.verifiedWindows({title:'Scratch'})).windows.length,1);
 f.state.proof.title='Scratch changed';assert.deepEqual((await f.driver.verifiedWindows({title:'Scratch'})).windows,[]);
});
test('Windows inventory never drops explicit incompleteness or duplicate/malformed rows',async()=>{
 const row={hwnd:123,processId:42,title:'Scratch'};
 for(const data of [{windows:[row],truncated:true},{results:[row],complete:false},{windows:[row],hasMore:true},[row,row],[row,{}]]){
  const d=new WinappDesktop(async()=>JSON.stringify(data));assert.equal((await d.listWindows()).truncated,true);
 }
 const d=new WinappDesktop(async()=>JSON.stringify([row]));assert.equal((await d.listWindows()).truncated,false);
 const rows=[row,...Array.from({length:100},(_,i)=>({hwnd:200+i,processId:42})),row];
 const duplicate=new WinappDesktop(async()=>JSON.stringify(rows));await assert.rejects(duplicate.exactWindow('123'),{code:'invalid_driver_response'});
});
test('capture rejects malformed PNG and identity change after image acquisition',async()=>{
 const f=fixture(),o=await f.observe();
 for(const data of [Buffer.alloc(100),Buffer.alloc(393217)]){
  f.driver.captureProbe=async()=>({identity:o.receipt.identity,image:{data:data.toString('base64')}});
  await assert.rejects(f.observe(),{code:'invalid_capture'});
 }
 const png=Buffer.alloc(100);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
 f.driver.captureProbe=async()=>{f.state.proof.start_time='999';return {identity:o.receipt.identity,image:{data:png.toString('base64')}};};
 await assert.rejects(f.observe(),{code:'stale_target'});
});
