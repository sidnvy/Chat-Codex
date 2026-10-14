import test from 'node:test';
import assert from 'node:assert/strict';
import {WinappDesktop} from '../src/desktop/winapp.mjs';
function fixture(){
 const state={calls:[],elements:[{selector:'parent',type:'Group',children:[{selector:'field',type:'Edit',name:'Input'},{selector:'commit',type:'Button',name:'Commit'}]}],result:undefined,throws:false};
 const driver=new WinappDesktop(async(_bin,args)=>{
  state.calls.push(args);
  if(args[1]==='list-windows')return JSON.stringify([{hwnd:42,pid:8,title:'Scratch'}]);
  if(args[1]==='inspect')return JSON.stringify({windows:[{hwnd:42,elements:state.elements}]});
  if(state.throws)throw Object.assign(Error('possibly dispatched'),{code:'no_interactive_desktop'});
  return JSON.stringify(state.result??{elementId:args[2],hwnd:42,...(args[1]==='invoke'?{pattern:'InvokePattern',requestedAction:'invoke',performedAction:'invoke'}:{})});
 },async()=>({ready:true,session_id:'s'}));
 return {state,driver};
}
const observe=d=>d.observe({mode:'window',window_id:'42'});
test('WinApp nested scoped elements remain addressable and explicit invoke forbids automatic fallback',async()=>{
 const {state,driver}=fixture();const seen=await observe(driver);
 assert.deepEqual(seen.elements.map(e=>e.id),['parent','field','commit']);
 const value=await driver.act(seen.receipt,{type:'set_value',element_id:'field',value:'test'});
 assert.equal(value.outcome,'dispatched_unverified');
 const clicked=await driver.act(seen.receipt,{type:'invoke',element_id:'commit'});
 assert.equal(clicked.outcome,'dispatched_unverified');assert.equal(clicked.verified,false);
 assert.deepEqual(state.calls.at(-1),['ui','invoke','commit','--action','invoke','-w','42','--json']);
});
test('WinApp mutation receipts require exact selected identity and explicit action projection',async()=>{
 for(const result of [{},{elementId:'other',hwnd:42},{elementId:'commit',hwnd:43},{elementId:'commit',hwnd:42,pattern:'TogglePattern',requestedAction:'auto',performedAction:'toggle'},{elementId:'commit',hwnd:42,pattern:'InvokePattern',requestedAction:'invoke',performedAction:'toggle'}]){
  const {state,driver}=fixture();const seen=await observe(driver);state.result=result;
  assert.equal((await driver.act(seen.receipt,{type:'invoke',element_id:'commit'})).outcome,'outcome_unknown');
 }
 const {state,driver}=fixture();const seen=await observe(driver);state.result={elementId:'field',hwnd:43};
 assert.equal((await driver.act(seen.receipt,{type:'set_value',element_id:'field',value:'x'})).outcome,'outcome_unknown');
 state.throws=true;assert.equal((await driver.act(seen.receipt,{type:'invoke',element_id:'commit'})).outcome,'outcome_unknown');
});
test('WinApp nested selector ambiguity and tree budgets fail closed before action authority',async()=>{
 const {state,driver}=fixture();
 state.elements[0].children.push({selector:'field'});await assert.rejects(observe(driver),/Duplicate/);
 state.elements=[{selector:'a',children:'bad'}];await assert.rejects(observe(driver),/Malformed/);
 let node={selector:'leaf'};for(let i=0;i<34;i++)node={children:[node]};state.elements=[node];await assert.rejects(observe(driver),/bounds/);
 state.elements=Array.from({length:1001},(_,i)=>({selector:'e'+i}));await assert.rejects(observe(driver),/bounds/);
 state.elements=Array.from({length:101},(_,i)=>({selector:'e'+i}));state.elements[100].selector='e0';await assert.rejects(observe(driver),/Duplicate/);
 assert.equal(state.calls.some(a=>a[1]==='invoke'),false);
});
