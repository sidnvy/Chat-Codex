import test from 'node:test';
import assert from 'node:assert/strict';
import {WinappDesktop} from '../src/desktop/winapp.mjs';
function fixture(){
 const state={pid:8,session:'s',calls:[],name:'Full '+ 'n'.repeat(170),onSearch:null};
 state.search=()=>({matchCount:1,hasMore:false,matches:[{selector:'txt-field-a123',automationId:'FieldAutomationId',type:'Edit',name:state.name}]});
 const driver=new WinappDesktop(async(_bin,args)=>{
  state.calls.push(args);
  if(args[1]==='list-windows')return JSON.stringify([{hwnd:42,pid:state.pid,title:'Scratch'}]);
  if(args[1]==='inspect')return JSON.stringify({windows:[{hwnd:42,elements:[{selector:'FieldAutomationId',automationId:'FieldAutomationId',type:'Edit',name:state.name}]}]});
  if(args[1]==='search'){await state.onSearch?.();return JSON.stringify(state.search());}
  return JSON.stringify({elementId:args[2],hwnd:42,...(args[1]==='invoke'?{pattern:'InvokePattern',requestedAction:'invoke',performedAction:'invoke'}:{})});
 },async()=>({ready:true,session_id:state.session}));
 return {driver,state};
}
const observe=d=>d.observe({mode:'window',window_id:'42'});
const act=(d,r)=>d.act(r,{type:'set_value',element_id:'FieldAutomationId',value:'test'});
const mutations=s=>s.calls.filter(a=>['invoke','set-value'].includes(a[1]));
test('WinApp resolves only observed promoted AutomationId through constrained exact-window search',async()=>{
 const {driver,state}=fixture();const seen=await observe(driver);
 assert.equal(seen.elements[0].label.length,160);assert.equal(seen.receipt.promoted_elements[0].name,state.name);
 const result=await act(driver,seen.receipt);assert.equal(result.outcome,'dispatched_unverified');
 assert.deepEqual(state.calls.find(a=>a[1]==='search'),['ui','search','FieldAutomationId','-w','42','--type','Edit','--max','2','--json']);
 assert.deepEqual(mutations(state)[0],['ui','set-value','txt-field-a123','test','-w','42','--json']);
 await assert.rejects(driver.act(seen.receipt,{type:'set_value',element_id:'txt-field-a123',value:'unobserved'}),e=>e.code==='stale_target');
});
test('WinApp rejects ambiguous, truncated, broad, mismatched or noncanonical search results',async()=>{
 const changes=[
  r=>r.matchCount=2,r=>r.hasMore=true,r=>delete r.hasMore,r=>r.matches.push({...r.matches[0]}),
  r=>r.matches[0].automationId='different',r=>r.matches[0].type='Button',r=>r.matches[0].name+='changed',
  r=>r.matches[0].selector='broad text',r=>r.matches[0].selector='FieldAutomationId',
  r=>r.matches[0].hwnd=43,r=>r.matches[0].windowHandle=43,r=>delete r.matches[0].automationId,
 ];
 for(const change of changes){
  const {driver,state}=fixture();const seen=await observe(driver),original=state.search;
  state.search=()=>{const r=original();change(r);return r;};
  await assert.rejects(act(driver,seen.receipt),e=>e.code==='stale_target');assert.equal(mutations(state).length,0);
 }
});
test('WinApp rechecks HWND owner, session and receipt expiry after awaited canonical search',async()=>{
 for(const change of ['pid','session','expiry']){
  const {driver,state}=fixture();const seen=await observe(driver);const original=Date.now;
  let now=seen.receipt.observed_at;
  try{
   Date.now=()=>now;
   state.onSearch=async()=>{await Promise.resolve();if(change==='pid')state.pid=9;if(change==='session')state.session='other';if(change==='expiry')now+=30000;};
   await assert.rejects(act(driver,seen.receipt),e=>['stale_target','stale_session'].includes(e.code));assert.equal(mutations(state).length,0);
  }finally{Date.now=original;}
 }
});
test('already canonical observed selectors need no normalization query',async()=>{
 const {driver,state}=fixture(),original=driver.run;
 driver.run=async(bin,args)=>args[1]==='inspect'?JSON.stringify({windows:[{hwnd:42,elements:[{selector:'txt-field-a123',automationId:'FieldAutomationId',type:'Edit',name:'Input'}]}]}):original(bin,args);
 const seen=await observe(driver);assert.deepEqual(seen.receipt.promoted_elements,[]);
 assert.equal((await driver.act(seen.receipt,{type:'set_value',element_id:'txt-field-a123',value:'x'})).outcome,'dispatched_unverified');
 assert.equal(state.calls.some(a=>a[1]==='search'),false);
});
