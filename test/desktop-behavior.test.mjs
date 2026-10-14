import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DesktopManager} from '../src/desktop/manager.mjs';
import {DESKTOP_SNAPSHOT_TTL_MS,DESKTOP_IMAGE_LIMIT_BYTES} from '../src/desktop/contract.mjs';

const fixtures=JSON.parse(readFileSync(new URL('../contracts/desktop-behavior-v1.json',import.meta.url),'utf8'));
const alpha={kind:'host',id:'alpha'},beta={kind:'host',id:'beta'};
const typeAction={type:'type',text:'test-marker'};
function harness(){
 const state={
  now:1700000000000,io:{status:0,observe:0,act:0},factories:[],
  session:'session-one',ready:true,windows:[{id:'w1',title:'Scratch'}],
  observation:null,action:null,truncated:false
 };
 const entry=id=>({id,project:'project',capabilities:{desktop:{enabled:true,driver:'mock'}}});
 const registry={projects:new Map([['project',{id:'project',path:'/tmp/styx-desktop-fixture'}]]),
  hosts:new Map([['alpha',entry('alpha')],['beta',entry('beta')]]),environments:new Map()};
 const factory=name=>{
  state.factories.push(name);
  return {
   async status(){state.io.status++;return {driver:name,state:state.ready?'ready':'locked',ready:state.ready,session_id:state.session,capabilities:['windows','input']};},
   async observe(input){state.io.observe++;
    if(input.mode==='windows')return {driver:name,windows:state.windows,truncated:state.truncated};
    return state.observation??{driver:name,window:{id:input.window_id,title:'Scratch'},
     receipt:{window_id:input.window_id,session_id:state.session}};
   },
   async act(receipt,action){state.io.act++;
    if(state.action)return state.action(receipt,action);
    return {driver:name,outcome:'dispatched_unverified',verified:false};
   }
  };
 };
 return {state,registry,manager:new DesktopManager(registry,{driverFactory:factory,clock:()=>state.now})};
}
const observe=(manager,target=alpha)=>manager.observe({target,mode:'window',window_id:'w1'});
const act=(manager,snapshot_id,target=alpha)=>manager.act({target,snapshot_id,action:typeAction});
const rejection=(code)=>e=>e?.code===code;

const cases={
 async default_off(){
  const {manager,registry,state}=harness();
  registry.hosts.get('alpha').capabilities={};
  assert.deepEqual((await manager.status(alpha)).ready,false);
  await assert.rejects(manager.observe({target:alpha,mode:'windows'}),rejection('desktop_not_enabled'));
  assert.equal(state.io.status,0);
 },
 async unregistered_target(){
  const {manager,state}=harness();
  await assert.rejects(manager.observe({target:{kind:'host',id:'unknown'},mode:'windows'}),/Unknown registered/);
  assert.deepEqual(state.io,{status:0,observe:0,act:0});
 },
 async exact_window(){
  const {manager,state}=harness();
  state.observation={window:{id:'wrong',title:'Scratch'},receipt:{window_id:'wrong'}};
  await assert.rejects(observe(manager),rejection('invalid_driver_response'));
  assert.equal(manager.snapshots.size,0);
 },
 async single_use_target_bound(){
  const {manager,state}=harness();
  const seen=await observe(manager);
  await assert.rejects(act(manager,seen.snapshot_id,beta),rejection('unknown_snapshot'));
  assert.equal((await act(manager,seen.snapshot_id)).outcome,'dispatched_unverified');
  await assert.rejects(act(manager,seen.snapshot_id),rejection('unknown_snapshot'));
  assert.equal(state.io.act,1);
 },
 async expiry_boundary(){
  const {manager,state}=harness();
  assert.equal(DESKTOP_SNAPSHOT_TTL_MS,30000);
  const seen=await observe(manager);
  state.now+=DESKTOP_SNAPSHOT_TTL_MS;
  await assert.rejects(act(manager,seen.snapshot_id),rejection('stale_snapshot'));
  await assert.rejects(act(manager,seen.snapshot_id),rejection('unknown_snapshot'));
  assert.equal(state.io.act,0);
 },
 async session_changed(){
  const {manager,state}=harness();
  const seen=await observe(manager);
  state.session='session-two';
  await assert.rejects(act(manager,seen.snapshot_id),rejection('stale_session'));
  assert.equal(state.io.act,0);
 },
 async grant_rotated(){
  const {manager,registry,state}=harness();
  const seen=await observe(manager);
  registry.hosts.get('alpha').capabilities.desktop.driver='mock-next';
  await assert.rejects(act(manager,seen.snapshot_id),rejection('unknown_snapshot'));
  assert.deepEqual(state.factories,['mock','mock-next']);
  assert.equal(state.io.act,0);
 },
 async grant_revoked(){
  const {manager,registry,state}=harness();
  const seen=await observe(manager);
  registry.hosts.get('alpha').capabilities={};
  await assert.rejects(act(manager,seen.snapshot_id),rejection('desktop_not_enabled'));
  assert.equal(state.io.act,0);
 },
 async concurrent_consumption(){
  const {manager,state}=harness();
  const seen=await observe(manager);
  const results=await Promise.allSettled([act(manager,seen.snapshot_id),act(manager,seen.snapshot_id)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.code==='unknown_snapshot').length,1);
  assert.equal(state.io.act,1);
 },
 async uncertain_dispatch(){
  const {manager,state}=harness();
  state.action=async()=>{throw Error('remote transport disconnected after dispatch');};
  const seen=await observe(manager);
  const result=await act(manager,seen.snapshot_id);
  assert.equal(result.outcome,'outcome_unknown');
  assert.equal(result.verified,false);
  assert.equal(state.io.act,1);
  await assert.rejects(act(manager,seen.snapshot_id),rejection('unknown_snapshot'));
 },
 async unverified_outcome(){
  const {manager,state}=harness();
  state.action=async()=>({outcome:'completed',verified:true});
  const seen=await observe(manager);
  const result=await act(manager,seen.snapshot_id);
  assert.deepEqual({outcome:result.outcome,verified:result.verified},{outcome:'outcome_unknown',verified:false});
 },
 async capture_limit(){
  const {manager,state}=harness();
  assert.equal(DESKTOP_IMAGE_LIMIT_BYTES,2097152);
  state.observation={window:{id:'w1',title:'Scratch'},receipt:{window_id:'w1'},
   image:{mimeType:'image/png',data:Buffer.alloc(DESKTOP_IMAGE_LIMIT_BYTES+1).toString('base64')}};
  await assert.rejects(observe(manager),rejection('invalid_capture'));
  assert.equal(manager.snapshots.size,0);
 },
 async truncated_inventory(){
  const {manager,state}=harness();
  state.truncated=true;
  await assert.rejects(manager.wait({target:alpha,condition:{type:'window_present',title:'Scratch'},timeout_ms:100}),rejection('incomplete_observation'));
 },
 async wait_timeout(){
  const {manager,state}=harness();
  state.windows=[];
  state.observation=null;
  const originalNow=state.now;
  // Avoid a real clock wait: the mock moves beyond the deadline on observe.
  const oldManagerObserve=manager.select(alpha).observe;
  manager.select(alpha).observe=async(input)=>{state.now=originalNow+101;return {windows:[]};};
  const result=await manager.wait({target:alpha,condition:{type:'window_present',title:'Scratch'},timeout_ms:100});
  assert.equal(result.matched,false);
  assert.equal(result.termination,'timeout');
  manager.select(alpha).observe=oldManagerObserve;
 },
 async snapshot_capacity(){
  const {manager}=harness();
  const first=await observe(manager);
  for(let i=0;i<64;i++)await observe(manager);
  assert.equal(manager.snapshots.size,64);
  await assert.rejects(act(manager,first.snapshot_id),rejection('unknown_snapshot'));
 }
};
test('fixture set is complete and transport-neutral',()=>{
 assert.equal(fixtures.version,1);
 assert.match(fixtures.scope,/transport-neutral/);
 assert.equal(fixtures.snapshots.ttl_ms,DESKTOP_SNAPSHOT_TTL_MS);
 assert.equal(fixtures.snapshots.max_live,64);
 assert.deepEqual(fixtures.cases.map(x=>x.id).sort(),Object.keys(cases).sort());
});
for(const item of fixtures.cases)test('S2 desktop contract: '+item.id,async()=>cases[item.id]());


test('observed grant revocation permanently invalidates snapshots even when a factory reuses a driver',async()=>{
 const {manager,registry}=harness();
 const driver=manager.select(alpha);
 manager.driverFactory=()=>driver;
 const seen=await observe(manager);
 registry.hosts.get('alpha').capabilities.desktop.enabled=false;
 assert.equal((await manager.status(alpha)).ready,false);
 registry.hosts.get('alpha').capabilities.desktop.enabled=true;
 await assert.rejects(act(manager,seen.snapshot_id),rejection('unknown_snapshot'));
 assert.ok((await observe(manager)).snapshot_id);
});


for(const replacementFails of [false,true])test('observed driver rotation cannot revive snapshots with reused singleton; factory failure='+replacementFails,async()=>{
 const {manager,registry}=harness();
 const original=manager.select(alpha);
 const seen=await observe(manager);
 manager.driverFactory=name=>{if(name==='other'&&replacementFails)throw Error('replacement failed');return original;};
 registry.hosts.get('alpha').capabilities.desktop.driver='other';
 if(replacementFails)await assert.rejects(manager.status(alpha),/replacement failed/);
 else await manager.status(alpha);
 registry.hosts.get('alpha').capabilities.desktop.driver='mock';
 await assert.rejects(act(manager,seen.snapshot_id),rejection('unknown_snapshot'));
});
