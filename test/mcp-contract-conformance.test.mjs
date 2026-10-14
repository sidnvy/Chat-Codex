import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {start} from '../src/server.mjs';
import {captureLocalStyxContract} from '../scripts/capture-local-mcp-contract.mjs';
import {normalizeToolSurface,compareToolSurfaces} from '../src/contracts/tool-surface.mjs';

const expected=JSON.parse(await fs.readFile(new URL('../contracts/styx-mcp-24-baseline.json',import.meta.url),'utf8'));
const names=JSON.parse(await fs.readFile(new URL('../contracts/shared-mcp-tool-names.json',import.meta.url),'utf8')).tool_names;
const target={kind:'host',id:'missing'},session_id='a'.repeat(24);
const requests={
 host_list:{},host_status:{host:'missing'},
 environment_list:{},environment_status:{environment:'missing'},
 environment_create:{environment:'missing'},environment_start:{environment:'missing'},
 environment_stop:{environment:'missing'},environment_delete:{environment:'missing'},
 project_list:{},project_status:{project:'missing'},
 target_status:{target},
 target_list_directory:{target,path:'.'},
 target_read_file:{target,path:'sample.txt'},
 target_write_file:{target,path:'sample.txt',content:'sample'},
 target_apply_patch:{target,path:'sample.txt',patch:'--- a/sample.txt\n+++ b/sample.txt\n@@ -1 +1 @@\n-a\n+b\n'},
 target_exec:{target,command:'printf example'},
 target_process_start:{target,command:'printf example'},
 target_process_poll:{target,session_id},
 target_process_stop:{target,session_id},
 target_task_list:{target},
 target_desktop_status:{target},
 target_desktop_observe:{target,mode:'windows'},
 target_desktop_act:{target,snapshot_id:'a99654b6-2632-4ad6-b623-636446c33c5a',action:{type:'invoke',element_id:'elem_0'}},
 target_desktop_wait:{target,condition:{type:'window_present',title:'Demo'}},
};
assert.deepEqual(new Set(Object.keys(requests)),new Set(names));
async function freePort(){
 const socket=net.createServer();
 await new Promise((resolve,reject)=>socket.once('error',reject).listen(0,'127.0.0.1',resolve));
 const value=socket.address().port;
 await new Promise(resolve=>socket.close(resolve));
 return value;
}
async function connectFixture(t,{host=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'styx-mcp-fixture-'));
 const project=path.join(root,'project'),privateDir=path.join(root,'private');
 await fs.mkdir(project,{mode:0o700});await fs.mkdir(privateDir,{mode:0o700});
 const port=await freePort(),token=crypto.randomBytes(32).toString('base64url');
 const cfg={version:2,owner_id:crypto.randomUUID(),port,
  projects:[{id:'default',path:project}],
  hosts:host?[{id:'local',project:'default',enabled:true,connection:'local',unsandboxed:true}]:[],
  environments:[]};
 await fs.writeFile(path.join(privateDir,'config.json'),JSON.stringify(cfg),{mode:0o600});
 await fs.writeFile(path.join(privateDir,'token'),token+'\n',{mode:0o600});
 const {server}=await start(path.join(privateDir,'config.json'));
 const client=new Client({name:'styx-conformance',version:'1'},{capabilities:{}});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+port+'/mcp'),
   {requestInit:{headers:{Authorization:'Bearer '+token}}}));
 }catch(e){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});throw e;}
 t.after(async()=>{await client.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
 return {client,project};
}
test('authenticated MCP tool discovery matches pinned 24-name schema/annotation baseline',async()=>{
 const observed=await captureLocalStyxContract();
 assert.equal(Object.keys(observed.tools).length,24);
 assert.equal(observed.tools.target_desktop_wait.inputSchema.properties.condition.properties.title.type,'string','Title request field must not be treated as ignorable schema metadata');
 assert.deepEqual(observed,expected,'A change to a public tool contract requires explicit review and baseline update');
 assert.deepEqual(Object.keys(observed.tools).sort(),names.slice().sort());
});
test('all shared MCP tools reject unadmitted override fields instead of accessing backend',async t=>{
 const {client,project}=await connectFixture(t);
 const tools=(await client.listTools()).tools;
 assert.equal(tools.length,26,'No extension or provider may silently add a default tool');
 for(const name of names){
  const listed=tools.find(x=>x.name===name);
  assert.ok(listed,'Missing tool: '+name);
  assert.equal(listed.inputSchema.additionalProperties,false,'Tool not strict: '+name);
  const r=await client.callTool({name,arguments:{...requests[name],workspace:'/privileged',transport:'ssh'}});
  assert.equal(r.isError,true,'Unexpected override accepted: '+name);
 }
 const entries=await fs.readdir(project);
 assert.deepEqual(entries,[],'Invalid calls never create project files');
});
test('valid-schema requests for unknown resources fail without Host/Environment fallback',async t=>{
 const {client}=await connectFixture(t);
 for(const name of names.filter(x=>/^(environment_(status|create|start|stop|delete)|host_status|project_status|target_)/.test(x))){
  const r=await client.callTool({name,arguments:requests[name]});
  if(name==='target_desktop_status'){
   assert.equal(r.isError,true,'Unknown Host cannot be treated as ready Desktop');
  }else{
   assert.equal(r.isError,true,'Unknown resource must be denied: '+name);
  }
 }
 const hosts=await client.callTool({name:'host_list',arguments:{}});
 assert.deepEqual(hosts.structuredContent,{items:[]});
 const environs=await client.callTool({name:'environment_list',arguments:{}});
 assert.deepEqual(environs.structuredContent,{items:[]});
});
test('Desktop access is not inherited from an admitted unsandboxed Host',async t=>{
 const {client}=await connectFixture(t,{host:true});
 const actual={kind:'host',id:'local'};
 const status=await client.callTool({name:'target_desktop_status',arguments:{target:actual}});
 assert.equal(status.structuredContent.state,'desktop_not_enabled');
 assert.equal(status.structuredContent.ready,false);
 for(const [name,args] of [
  ['target_desktop_observe',{target:actual,mode:'windows'}],
  ['target_desktop_act',{...requests.target_desktop_act,target:actual}],
  ['target_desktop_wait',{target:actual,condition:{type:'window_present',title:'Never'}}],
 ]){
  const r=await client.callTool({name,arguments:args});
  assert.equal(r.isError,true,'Desktop permission must be separate: '+name);
 }
});
test('comparison classifies material schema/annotation changes without leaking values',()=>{
 const baseline=normalizeToolSurface(
  names.map(name=>({name,...expected.tools[name]})),{names});
 assert.deepEqual(compareToolSurfaces(baseline,expected).summary,
  {left_total:24,right_total:24,shared:24,only_left:0,only_right:0,changed:0});
 const other=structuredClone(expected);
 other.tools.target_exec.inputSchema.properties.command.maxLength=31;
 other.tools.host_list.annotations.readOnlyHint=false;
 delete other.tools.target_desktop_wait;
 const difference=compareToolSurfaces(expected,other);
 assert.equal(difference.compatible_structure,false);
 assert.equal(difference.summary.shared,23);
 assert.equal(difference.summary.only_left,1);
 assert.equal(difference.summary.changed,2);
 assert.ok(difference.differences.some(x=>x.name==='target_exec'&&x.changes.some(y=>y.path==='/inputSchema/properties/command/maxLength')));
 assert.ok(difference.differences.some(x=>x.name==='host_list'&&x.changes.some(y=>y.path==='/annotations/readOnlyHint')));
 assert.deepEqual(difference.only_left,['target_desktop_wait']);
 assert.ok(!JSON.stringify(difference).includes('example'));
});
test('tool contract normalization preserves property names such as title and description',()=>{
 const normalized=normalizeToolSurface([{name:'example',inputSchema:{type:'object',title:'Non-semantic',properties:{title:{type:'string',description:'Metadata'},description:{type:'string'}},required:['title']}}]);
 assert.deepEqual(Object.keys(normalized.tools.example.inputSchema.properties).sort(),['description','title']);
 assert.equal(normalized.tools.example.inputSchema.title,undefined);
});
test('tool contract parser rejects duplicates, unparseable entries and bad annotation types',()=>{
 assert.throws(()=>normalizeToolSurface([{name:'x',inputSchema:{}},{name:'x',inputSchema:{}}]),/Duplicate/);
 assert.throws(()=>normalizeToolSurface([{name:'foo',inputSchema:{},annotations:{readOnlyHint:'true'}}]),/annotation/);
 assert.throws(()=>normalizeToolSurface([{name:'foo',inputSchema:{}}],{names:['bar']}),/missing/);
 assert.throws(()=>compareToolSurfaces({contract_version:500,tools:{}},expected),/Invalid/);
});
test('contract CLI emits bounded structural paths, deterministic exit codes and no input paths',async t=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'styx-contract-cli-'));
 t.after(()=>fs.rm(tmp,{recursive:true,force:true}));
 const left=path.join(tmp,'private-left.json'),right=path.join(tmp,'private-right.json');
 await fs.writeFile(left,JSON.stringify(expected),{mode:0o600});
 await fs.writeFile(right,JSON.stringify(expected),{mode:0o600});
 const file=new URL('../scripts/compare-mcp-contracts.mjs',import.meta.url).pathname;
 const run=(...args)=>spawnSync(process.execPath,[file,'--left',left,'--right',right,...args],{
  encoding:'utf8',timeout:10000
 });
 let output=run('--json');
 assert.equal(output.status,0,output.stderr);
 assert.equal(JSON.parse(output.stdout).summary.shared,24);
 assert.ok(!output.stdout.includes(left));
 const different=structuredClone(expected);
 different.tools.target_exec.inputSchema.properties.command.minLength=8;
 await fs.writeFile(right,JSON.stringify(different),{mode:0o600});
 output=run();
 assert.equal(output.status,1,output.stderr);
 assert.match(output.stdout,/target_exec/);
 assert.ok(!output.stdout.includes(left));
 assert.ok(!output.stdout.includes(right));
 assert.ok(!output.stdout.includes('secret'));
 output=run('--unknown');
 assert.equal(output.status,2);
 await fs.writeFile(right,'not json',{mode:0o600});
 output=run();
 assert.equal(output.status,2);
 assert.ok(!output.stderr.includes(right));
});
test('schema comparison preserves reserved JSON property names rather than dropping them',()=>{
 const source=JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"},"constructor":{"type":"number"}}}');
 const original=normalizeToolSurface([{name:'probe',inputSchema:source}]);
 const properties=original.tools.probe.inputSchema.properties;
 assert.equal(Object.hasOwn(properties,'__proto__'),true);
 assert.equal(properties.__proto__.type,'string');
 assert.equal(Object.hasOwn(properties,'constructor'),true);
 const less=normalizeToolSurface([{name:'probe',inputSchema:{type:'object',properties:{constructor:{type:'number'}}}}]);
 const diff=compareToolSurfaces(original,less);
 assert.equal(diff.compatible_structure,false);
 assert.ok(diff.differences[0].changes.some(x=>x.path==='/inputSchema/properties/__proto__'));
});
test('normalized tool map keys cannot be overridden by nested name fields',()=>{
 const baseline=normalizeToolSurface([{name:'bar',inputSchema:{type:'object'}}]);
 const malformed={contract_version:1,tools:{foo:{name:'bar',inputSchema:{type:'object'},annotations:{}}}};
 assert.throws(()=>compareToolSurfaces(malformed,baseline),/Invalid normalized tool entry/);
});
