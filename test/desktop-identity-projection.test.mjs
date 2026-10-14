import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopManager} from '../src/desktop/manager.mjs';

test('Desktop Core retains authoritative target and snapshot IDs in all driver projections',async()=>{
 const host={kind:'host',id:'host-one'};
 const registry={projects:new Map([['p',{id:'p'}]]),hosts:new Map([['host-one',{
  id:'host-one',project:'p',capabilities:{desktop:{enabled:true,driver:'dummy'}}
 }]]),environments:new Map()};
 const other={kind:'host',id:'other'};
 const driver={
  async status(){return {driver:'dummy',state:'ready',ready:true,session:'fixed',target:other};},
  async observe({mode,window_id}){
   if(mode==='windows')return {driver:'dummy',windows:[],target:other};
   return {driver:'dummy',window:{id:window_id},receipt:{window_id},target:other};
  },
  async act(){return {verified:false,outcome:'dispatched_unverified',target:other,snapshot_id:'incorrect'};}
 };
 const desktop=new DesktopManager(registry,{driverFactory:()=>driver});
 assert.deepEqual((await desktop.status(host)).target,host);
 assert.deepEqual((await desktop.observe({target:host,mode:'windows'})).target,host);
 const snapshot=await desktop.observe({target:host,mode:'window',window_id:'w1'});
 const acted=await desktop.act({target:host,snapshot_id:snapshot.snapshot_id,action:{type:'key',key:'Return'}});
 assert.deepEqual(acted.target,host);
 assert.equal(acted.snapshot_id,snapshot.snapshot_id);
});
