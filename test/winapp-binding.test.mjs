import test from 'node:test';
import assert from 'node:assert/strict';
import {WinappDesktop} from '../src/desktop/winapp.mjs';
function fixture(){
 const state={pid:8,session:'session-1',ready:true,operations:[],onList:null,onInspect:null,onProbe:null};
 const driver=new WinappDesktop(async(_command,args)=>{
  state.operations.push(args[1]);
  if(args[1]==='list-windows'){await state.onList?.();return JSON.stringify([{hwnd:42,pid:state.pid,title:'Scratch'}]);}
  if(args[1]==='inspect'){await state.onInspect?.();return JSON.stringify({windows:[{hwnd:42,elements:[{selector:'field',type:'Edit'}]}]});}
  return '{}';
 },async()=>{await state.onProbe?.();return {ready:state.ready,session_id:state.session};});
 return {driver,state};
}
const observe=d=>d.observe({mode:'window',window_id:'42'});
const invoke=(d,r)=>d.act(r,{type:'invoke',element_id:'field'});
for(const pid of [undefined,null,0,-1,'junk','08',4294967296,Infinity])test('exact window rejects invalid PID '+String(pid),async()=>{
 const {driver,state}=fixture();state.pid=pid;
 await assert.rejects(observe(driver),e=>e.code==='invalid_window');
 assert.equal(state.operations.includes('inspect'),false);
});
test('PID loss at action cannot bypass HWND ownership check',async()=>{
 const {driver,state}=fixture(),receipt=(await observe(driver)).receipt;state.pid=undefined;
 await assert.rejects(invoke(driver,receipt),e=>e.code==='invalid_window');
 assert.equal(state.operations.includes('invoke'),false);
});
test('PID switch during inspection rejects the observation',async()=>{
 const {driver,state}=fixture();state.onInspect=()=>{state.pid=9;};
 await assert.rejects(observe(driver),e=>e.code==='stale_target');
});
test('session switch during inspection rejects the observation',async()=>{
 const {driver,state}=fixture();state.onInspect=()=>{state.session='session-2';};
 await assert.rejects(observe(driver),e=>e.code==='stale_session');
});
test('session and readiness are rechecked after action window lookup',async()=>{
 for(const change of ['switch','lock']){
  const {driver,state}=fixture(),receipt=(await observe(driver)).receipt;
  state.onList=()=>{if(change==='switch')state.session='session-2';else state.ready=false;};
  await assert.rejects(invoke(driver,receipt),e=>['stale_session','no_interactive_desktop'].includes(e.code));
  assert.equal(state.operations.includes('invoke'),false);
 }
});
test('unobserved selectors and malformed receipt PID are refused',async()=>{
 const {driver,state}=fixture(),receipt=(await observe(driver)).receipt;
 await assert.rejects(driver.act(receipt,{type:'invoke',element_id:'another-window'}),e=>e.code==='stale_target');
 await assert.rejects(invoke(driver,{...receipt,pid:null}),e=>e.code==='stale_target');
 assert.equal(state.operations.includes('invoke'),false);
});
test('truthy booleans and malformed session proofs do not establish readiness',async()=>{
 for(const proof of [true,'ready',{ready:true},{ready:'true',session_id:'s'},{ready:true,session_id:''}]){
  let io=0;const driver=new WinappDesktop(async()=>{io++;return '[]';},async()=>proof);
  assert.equal((await driver.status()).ready,false);assert.equal(io,0);
 }
});
test('exact expiry boundary and expiry during readiness prevent dispatch',async()=>{
 const {driver,state}=fixture(),receipt=(await observe(driver)).receipt;
 const original=Date.now;let now=receipt.observed_at;
 try{
  Date.now=()=>now;
  now+=30000;await assert.rejects(invoke(driver,receipt),e=>e.code==='stale_target');
  now=receipt.observed_at;let probes=0;
  state.onProbe=()=>{if(++probes===2)now+=30000;};
  await assert.rejects(invoke(driver,receipt),e=>e.code==='stale_target');
  assert.equal(state.operations.includes('invoke'),false);
 }finally{Date.now=original;}
});

test('inspect never overrides supplied malformed HWND or mismatched process evidence',async()=>{
 for(const payload of [{windows:[{hwnd:'invalid',elements:[]}]},{windows:[{hwnd:42,pid:9,elements:[]}]},{hwnd:43,elements:[]},{hwnd:42,processId:9,elements:[]}]){
  const d=new WinappDesktop(async(_c,args)=>JSON.stringify(args[1]==='list-windows'?[{hwnd:42,pid:8}]:payload),async()=>({ready:true,session_id:'session'}));
  await assert.rejects(observe(d),e=>e.code==='stale_target');
 }
});
