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

test('declared JSON Schema dialect is structural, not ignorable metadata',()=>{
 const a=normalizeToolSurface([{name:'test',inputSchema:{$schema:'http://json-schema.org/draft-07/schema#',type:'object'}}]);
 const b=normalizeToolSurface([{name:'test',inputSchema:{type:'object'}}]);
 const delta=compareToolSurfaces(a,b);
 assert.equal(delta.compatible_structure,false);
 assert.ok(delta.differences[0].changes.some(x=>x.path==='/inputSchema/$schema'));
});
test('JSON Schema dependency maps retain reserved property keys',()=>{
 for(const key of ['dependentRequired','dependentSchemas','dependencies']){
  const obj=(key==='dependentRequired'?{title:['foo']}: {title:{type:'string'}});
  const a=normalizeToolSurface([{name:'test',inputSchema:{type:'object',[key]:obj}}]);
  const b=normalizeToolSurface([{name:'test',inputSchema:{type:'object',[key]:{}}}]);
  assert.equal(Object.hasOwn(a.tools.test.inputSchema[key],'title'),true,key);
  assert.equal(compareToolSurfaces(a,b).compatible_structure,false,key);
 }
});
test('subset capture ignores unrelated vendor tool names without treating them as invalid',()=>{
 const baseline=normalizeToolSurface([{name:'target_status',inputSchema:{type:'object'}},{name:'vendor.search',inputSchema:{type:'object'}},{name:'foo-bar',inputSchema:{type:'object'}}],{names:['target_status']});
 assert.deepEqual(Object.keys(baseline.tools),['target_status']);
});
test('diff truncated is only true when at least one changed path was omitted',()=>{
 const a=normalizeToolSurface([{name:'test',inputSchema:{type:'object',properties:{first:{type:'number'}}}}]);
 const b=normalizeToolSurface([{name:'test',inputSchema:{type:'object',properties:{first:{type:'string'}}}}]);
 const exactly=compareToolSurfaces(a,b,{maxChangesPerTool:1});
 assert.equal(exactly.differences[0].changes.length,1);
 assert.equal(exactly.differences[0].truncated,false);
 const c=normalizeToolSurface([{name:'test',inputSchema:{type:'object',properties:{first:{type:'string'},second:{type:'boolean'}}}}]);
 const overflow=compareToolSurfaces(a,c,{maxChangesPerTool:1});
 assert.equal(overflow.differences[0].changes.length,1);
 assert.equal(overflow.differences[0].truncated,true);
});

test('const and enum literal object keys are never mistaken for schema metadata',()=>{
 for(const value of ['red','blue']){
  const snapshot=normalizeToolSurface([{name:'x',inputSchema:{type:'object',const:{title:value,description:'literal'},enum:[{title:value,description:'literal'}]}}]);
  const v=snapshot.tools.x.inputSchema;
  assert.equal(v.const.title,value);
  assert.equal(v.const.description,'literal');
  assert.equal(v.enum[0].title,value);
  assert.equal(v.enum[0].description,'literal');
 }
 const a=normalizeToolSurface([{name:'x',inputSchema:{const:{title:'red'},enum:[{description:'red'}]}}]);
 const b=normalizeToolSurface([{name:'x',inputSchema:{const:{title:'blue'},enum:[{description:'blue'}]}}]);
 const compared=compareToolSurfaces(a,b);
 assert.equal(compared.compatible_structure,false);
 assert.ok(compared.differences[0].changes.some(x=>x.path.includes('/const/title')));
 assert.ok(compared.differences[0].changes.some(x=>x.path.includes('/enum')));
 const left=normalizeToolSurface([{name:'x',inputSchema:{const:{enum:[2,1]}}}]);
 const right=normalizeToolSurface([{name:'x',inputSchema:{const:{enum:[1,2]}}}]);
 assert.equal(compareToolSurfaces(left,right).compatible_structure,false,'Literal arrays must not be sorted');
});
test('protocol-valid selected tool names include dots, hyphens and uppercase',()=>{
 const names=['vendor.search','foo-bar','UI.Tool_1'];
 const raw=names.map(name=>({name,inputSchema:{type:'object'}}));
 const full=normalizeToolSurface(raw);
 assert.deepEqual(Object.keys(full.tools).sort(),names.slice().sort());
 const subset=normalizeToolSurface(raw,{names:['vendor.search']});
 assert.deepEqual(Object.keys(subset.tools),['vendor.search']);
 assert.throws(()=>normalizeToolSurface([{name:'a'.repeat(129),inputSchema:{type:'object'}}]),/Invalid/);
});

test('a protocol-valid __proto__ tool name remains an own normalized key',()=>{
 const raw=JSON.parse('[{"name":"__proto__","inputSchema":{"type":"object"}}]');
 const result=normalizeToolSurface(raw);
 assert.equal(Object.hasOwn(result.tools,'__proto__'),true);
 assert.equal(Object.keys(result.tools).length,1);
 assert.equal(compareToolSurfaces(result,normalizeToolSurface([])).compatible_structure,false);
});
test('schema property names resembling keywords do not change schema traversal context',()=>{
 const make=title=>normalizeToolSurface([{name:'test',inputSchema:{
  type:'object',properties:{properties:{type:'object',title,properties:{nested:{type:'string'}}}}
 }}]);
 assert.equal(compareToolSurfaces(make('metadata A'),make('metadata B')).compatible_structure,true,
  'A nested schema title is still ignorable metadata');
 const a=make('same');const b=structuredClone(a);
 b.tools.test.inputSchema.properties.properties.properties.nested.type='number';
 assert.equal(compareToolSurfaces(a,b).compatible_structure,false);
});
test('dependentRequired, draft-07 dependencies and multivalued type compare as unordered sets',()=>{
 const make=(types,dependencies,dependentRequired)=>normalizeToolSurface([{name:'test',inputSchema:{
  type:types,dependencies:{title:dependencies},dependentRequired:{title:dependentRequired}
 }}]);
 const a=make(['string','number'],['a','b'],['a','b']);
 const b=make(['number','string'],['b','a'],['b','a']);
 assert.equal(compareToolSurfaces(a,b).compatible_structure,true);
 const c=make(['number','string'],['b','different'],['b','a']);
 assert.equal(compareToolSurfaces(a,c).compatible_structure,false);
});

test('unordered schema keywords use a total code-unit ordering for canonically equivalent Unicode members',()=>{
 const composed='é',decomposed='e\u0301';
 const make=required=>normalizeToolSurface([{name:'test',inputSchema:{type:'object',required}}]);
 const first=make([composed,decomposed]);
 const second=make([decomposed,composed]);
 assert.equal(compareToolSurfaces(first,second).compatible_structure,true);
});
test('malformed non-object annotation containers fail rather than becoming absent annotations',()=>{
 const correct=normalizeToolSurface([{name:'test',inputSchema:{type:'object'}}]);
 for(const value of [[],null,'readOnlyHint',1,true]){
  const invalid=structuredClone(correct);invalid.tools.test.annotations=value;
  assert.throws(()=>compareToolSurfaces(invalid,correct),/annotation container/i);
 }
});
