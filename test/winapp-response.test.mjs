import test from 'node:test';
import assert from 'node:assert/strict';
import {WinappDesktop} from '../src/desktop/winapp.mjs';

test('WinApp top-level list-windows arrays preserve HWND and report real count',async()=>{
 const calls=[];
 const run=async(command,args)=>{
  calls.push(args);
  if(args[1]==='list-windows')return JSON.stringify([
   {hwnd:112233,title:'Alpha',processName:'notepad',pid:5},
   {hwnd:'223344',title:'Alpha',processName:'notepad',pid:6},
   {title:'unscoped system window',processName:'system'}
  ]);
  if(args[1]==='inspect')return JSON.stringify({windows:[{hwnd:'223344',elements:[{selector:'btn-save-1234',type:'Button',name:'Save'}]}]});
  return '{}';
 };
 const driver=new WinappDesktop(run,async()=>true);
 const status=await driver.status();
 assert.equal(status.window_count,2);
 const listed=await driver.observe({mode:'windows'});
 assert.deepEqual(listed.windows.map(x=>x.id),['112233','223344']);
 assert.equal(listed.windows[1].title,'Alpha','same title does not conflate identities');
 assert.equal(listed.windows[1].pid,'6');
 const observed=await driver.observe({mode:'window',window_id:'223344'});
 assert.deepEqual(observed.elements,[{id:'btn-save-1234',role:'Button',label:'Save'}]);
 assert.deepEqual(observed.receipt.hwnd,'223344');
 await driver.act(observed.receipt,{type:'invoke',element_id:'btn-save-1234'});
 assert.deepEqual(calls.find(args=>args[1]==='inspect').slice(2,4),['-w','223344']);
 assert.deepEqual(calls.find(args=>args[1]==='invoke').slice(2),['btn-save-1234','-w','223344','--json']);
 assert.equal(calls.some(args=>args.includes('-a')),false);
});
test('WinApp exact target rejects titles, vanished HWNDs, and changed process ownership',async()=>{
 let found=true,pid=11;
 const operations=[];
 const run=async(bin,args)=>{
  operations.push(args[1]);
  if(args[1]==='list-windows')return JSON.stringify({windows:found?[{hwnd:'970001',title:'Editor',processId:pid}]:[]});
  if(args[1]==='inspect')return JSON.stringify({windows:[{hwnd:'970001',elements:[{id:'textbox',controlType:'Edit'}]}]});
  return '{}';
 };
 const driver=new WinappDesktop(run,async()=>true);
 await assert.rejects(driver.observe({mode:'window',window_id:'Editor'}),/numeric HWND/);
 const receipt=(await driver.observe({mode:'window',window_id:'970001'})).receipt;
 assert.equal(receipt.pid,'11');
 found=false;
 await assert.rejects(driver.act(receipt,{type:'invoke',element_id:'textbox'}),/no longer present/);
 found=true;pid=12;
 await assert.rejects(driver.act(receipt,{type:'set_value',element_id:'textbox',value:'x'}),/reused/);
 assert.equal(operations.includes('invoke'),false);
 assert.equal(operations.includes('set-value'),false);
});
test('WinApp inspect refuses mismatched nested windows and bounds nested element output',async()=>{
 const elements=Array.from({length:115},(_,i)=>({selector:'element-'+i,type:'Text',name:'item'}));
 const run=async(bin,args)=>{
  if(args[1]==='list-windows')return JSON.stringify([{hwnd:33,title:'Scratch'}]);
  if(args[1]==='inspect')return JSON.stringify({windows:[{hwnd:'33',elements}]});
  return '{}';
 };
 const d=new WinappDesktop(run,async()=>true);
 assert.equal((await d.observe({mode:'window',window_id:'33'})).elements.length,100);
 const mismatch=new WinappDesktop(async(bin,args)=>{
  if(args[1]==='list-windows')return JSON.stringify([{hwnd:33,title:'Scratch'}]);
  return JSON.stringify({windows:[{hwnd:99,elements:[{id:'unsafe'}]}]});
 },async()=>true);
 await assert.rejects(mismatch.observe({mode:'window',window_id:'33'}),/no longer matches/);
});
test('WinApp keeps session readiness independent of UIA list availability',async()=>{
 const run=async(bin,args)=>JSON.stringify(args[1]==='list-windows'?[{hwnd:'9001',title:'Locked app'}]:{});
 const d=new WinappDesktop(run,async()=>false);
 const state=await d.status();
 assert.equal(state.ready,false);
 assert.equal(state.window_count,1);
 await assert.rejects(d.act({hwnd:'9001',observed_at:Date.now()},{type:'invoke',element_id:'x'}),/Interactive desktop/);
});
