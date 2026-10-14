import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {startDesktopGateway} from '../src/desktop/gateway.mjs';
import {normalizeToolSurface} from '../src/contracts/tool-surface.mjs';

const target={kind:'host',id:'scratch'};
const names=['target_desktop_act','target_desktop_observe','target_desktop_status','target_desktop_wait'];
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
async function fixture(t,options={}){
 const token=crypto.randomBytes(32).toString('base64url');
 const {server,port}=await startDesktopGateway({token,...options});
 const clients=[];
 t.after(async()=>{for(const client of clients)await client.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const connect=async()=>{
  const client=new Client({name:'gateway-test',version:'1'},{capabilities:{}});clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
  return client;
 };
 return {port,token,connect,client:await connect()};
}
function driverFixture(){
 const state={enabled:true,revision:'1',now:1000,dispatches:0};
 const driver={
  async status(){return {ready:true,state:'ready',session_id:'session',capabilities:['windows']};},
  async observe({mode}){
   const window={id:'123',title:'Scratch'};
   if(mode==='windows')return {windows:[window],truncated:false};
   return {driver:'fixture',window,elements:[{id:'B1',role:'button',label:'Submit'}],receipt:{window_id:'123'},image:{mimeType:'image/png',data:png}};
  },
  async act(){state.dispatches++;return {outcome:'dispatched_unverified',verified:false};}
 };
 return {state,options:{clock:()=>state.now,grantForTarget(t){
  if(t.kind!==target.kind||t.id!==target.id)throw Error('Target not admitted');
  return state.enabled?{enabled:true,driver:'fixture',binding_revision:state.revision}:null;
 },driverFactory:()=>driver}};
}
const call=(client,name,args)=>client.callTool({name:'target_desktop_'+name,arguments:args});
const observe=client=>call(client,'observe',{target,mode:'window',window_id:'123'});
const act=(client,snapshot_id)=>call(client,'act',{target,snapshot_id,action:{type:'invoke',element_id:'B1'}});
function request(port,headers,body='{}',url='/mcp',method='POST'){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path:url,method,headers},res=>{
   let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:data}));
  });req.on('error',reject);req.end(body);
 });
}
test('Desktop gateway exposes exactly canonical four tools with baseline contracts and no execution',async t=>{
 const {options}=driverFixture();const {client}=await fixture(t,options);
 const tools=(await client.listTools()).tools;
 assert.deepEqual(tools.map(x=>x.name).sort(),names);
 const baseline=JSON.parse(await fs.readFile(new URL('../contracts/styx-mcp-24-baseline.json',import.meta.url),'utf8'));
 const normalized=normalizeToolSurface(tools);
 for(const name of names)assert.deepEqual(normalized.tools[name],baseline.tools[name],name);
 assert.equal((await client.callTool({name:'target_exec',arguments:{target,command:'never'}})).isError,true);
 const observation=await observe(client);
 assert.equal(observation.content[1].type,'image');assert.equal(observation.content[1].data,png);
 assert.equal(observation.structuredContent.image,undefined);
 assert.deepEqual(JSON.parse(observation.content[0].text),observation.structuredContent);
 const waited=await call(client,'wait',{target,condition:{type:'window_present',title:'Scratch'},timeout_ms:100});
 assert.equal(waited.structuredContent.matched,true);assert.equal(waited.isError,false);
 assert.equal((await call(client,'observe',{target,mode:'window',window_id:'123',module:'/tmp/untrusted'})).isError,true);
});
test('Desktop gateway denies by default and never inherits Host or unknown target authority',async t=>{
 const {client}=await fixture(t);
 const status=await call(client,'status',{target});
 assert.equal(status.structuredContent.ready,false);assert.equal(status.structuredContent.state,'desktop_not_enabled');
 assert.equal((await observe(client)).isError,true);
 const {options,state}=driverFixture();const active=await fixture(t,options);
 assert.equal((await call(active.client,'observe',{target:{kind:'host',id:'other'},mode:'windows'})).isError,true);
 assert.equal((await call(active.client,'observe',{target:{kind:'environment',id:'scratch'},mode:'windows'})).isError,true);
 assert.equal(state.dispatches,0);
});
test('Desktop gateway retains single-use snapshots across clients, requests and concurrent actions',async t=>{
 const {options,state}=driverFixture();const {client,connect}=await fixture(t,options);const other=await connect();
 const observed=await observe(client),id=observed.structuredContent.snapshot_id;
 const results=await Promise.all([act(client,id),act(other,id)]);
 assert.equal(results.filter(x=>x.isError===true).length,1);
 const success=results.find(x=>!x.isError);
 assert.equal(success.structuredContent.outcome,'dispatched_unverified');assert.equal(success.structuredContent.verified,false);
 assert.equal((await act(other,id)).isError,true);assert.equal(state.dispatches,1);
});
test('Desktop gateway preserves revocation, binding replacement and expiry across HTTP requests',async t=>{
 const {options,state}=driverFixture();const {client}=await fixture(t,options);
 let id=(await observe(client)).structuredContent.snapshot_id;
 state.enabled=false;
 assert.equal((await act(client,id)).isError,true);
 state.enabled=true;
 assert.equal((await act(client,id)).isError,true,'Regrant cannot revive old snapshot');
 id=(await observe(client)).structuredContent.snapshot_id;
 state.revision='2';assert.equal((await act(client,id)).isError,true);
 id=(await observe(client)).structuredContent.snapshot_id;
 state.now+=30000;assert.equal((await act(client,id)).isError,true);
 assert.equal(state.dispatches,0);
});
test('shared loopback boundary validates actual ephemeral port, bearer, Host, Origin and request limits',async t=>{
 const {port,token}=await fixture(t);
 assert.ok(port>0);
 const good=['Host',`127.0.0.1:${port}`,'Authorization','Bearer '+token,'Content-Type','application/json'];
 assert.equal((await request(port,['Host',`127.0.0.1:${port}`])).status,401);
 assert.equal((await request(port,['Host',`127.0.0.1:${port}`,'Authorization','Bearer wrong'])).status,401);
 assert.equal((await request(port,[...good,'Authorization','Bearer '+token])).status,401);
 assert.equal((await request(port,['Host',`localhost:${port}`,'Authorization','Bearer '+token],'[]')).status,400);
 assert.equal((await request(port,['Host','127.0.0.1:0','Authorization','Bearer '+token])).status,403);
 assert.equal((await request(port,['Host','foreign.example','Authorization','Bearer '+token])).status,403);
 assert.equal((await request(port,[...good,'Host',`127.0.0.1:${port}`])).status,403);
 assert.equal((await request(port,[...good,'Origin','https://foreign.example'])).status,403);
 assert.equal((await request(port,[...good,'Origin',''])).status,403);
 assert.equal((await request(port,good,'[]')).status,400);
 assert.equal((await request(port,good,'{')).status,400);
 assert.equal((await request(port,good,'x'.repeat(262145))).status,413);
 assert.equal((await request(port,good,'','/other','GET')).status,404);
 const health=await request(port,['Host',`127.0.0.1:${port}`],'','/healthz','GET');
 assert.equal(health.status,200);assert.deepEqual(JSON.parse(health.body),{ok:true,scope:'process only'});
});
test('gateway rejects invalid trusted startup parameters before listening',async()=>{
 for(const token of [undefined,'short','a'.repeat(42),'a'.repeat(43)+'\n'])await assert.rejects(startDesktopGateway({token}),/Invalid token/);
 for(const port of [-1,65536,1.5,'0'])await assert.rejects(startDesktopGateway({token:'a'.repeat(43),port}),/Invalid loopback port/);
 await assert.rejects(startDesktopGateway({token:'a'.repeat(43),grantForTarget:null}),/requires trusted/);
});
