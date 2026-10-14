import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createServer} from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {z} from 'zod';
import {createRegistry} from '../src/resources.mjs';
import {TargetRouter} from '../src/router.mjs';
import {start} from '../src/server.mjs';
import {EnvironmentProviderCatalog} from '../src/runtime/providers.mjs';
import {ExtensionCatalog} from '../src/runtime/extensions.mjs';

const secret='z'.repeat(48);
const port=async()=>{
 const srv=createServer();await new Promise(resolve=>srv.listen(0,'127.0.0.1',resolve));
 const value=srv.address().port;await new Promise(resolve=>srv.close(resolve));return value;
};
async function fixture(t,{extensions=[]}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'styx-s1-contract-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const project=path.join(root,'project'),priv=path.join(root,'private');
 await fs.mkdir(project,{mode:0o700});await fs.mkdir(priv,{mode:0o700});
 const cfg={
  version:2,owner_id:crypto.randomUUID(),port:await port(),
  projects:[{id:'default',path:project}],
  hosts:[],environments:[{id:'sandbox',project:'default',provider:'memory'}],
  ...(extensions.length?{extensions}:{})
 };
 const file=path.join(priv,'config.json');
 await fs.writeFile(file,JSON.stringify(cfg),{mode:0o600});
 await fs.writeFile(path.join(priv,'token'),secret+'\n',{mode:0o600});
 return {cfg,file,project,priv};
}
function memoryProvider(){
 const calls=[],allocated=new Set(),started=new Set();
 const instance={
  async status(e){
   calls.push(['status',e.id]);
   const lifecycle=!allocated.has(e.id)?'absent':started.has(e.id)?'running':'stopped';
   return {id:e.id,provider:'memory',project:e.project,lifecycle,ready:lifecycle==='running'};
  },
  async create(e){calls.push(['create',e.id]);allocated.add(e.id);return instance.status(e);},
  async start(e){calls.push(['start',e.id]);if(!allocated.has(e.id))throw Error('Missing Environment');started.add(e.id);return instance.status(e);},
  async stop(e){calls.push(['stop',e.id]);started.delete(e.id);return instance.status(e);},
  async delete(e){calls.push(['delete',e.id]);started.delete(e.id);allocated.delete(e.id);return instance.status(e);},
  async run(e,_project,job){calls.push(['run',e.id,job.op]);return {exit_code:0,stdout:'memory-verified\n',stderr:'',termination:null,duration_ms:1};}
 };
 return {instance,calls};
}
test('provider registration is trusted, immutable by name, and rejects absent contracts',()=>{
 const catalog=new EnvironmentProviderCatalog();
 assert.throws(()=>catalog.register('Coder/../../dev',()=>({})),/Invalid/);
 assert.throws(()=>catalog.register('evil',null),/Invalid/);
 assert.throws(()=>catalog.create('memory',{}),/Unregistered/);
 catalog.register('memory',()=>({status(){}}));
 assert.throws(()=>catalog.register('memory',()=>({})),/Duplicate/);
 assert.throws(()=>catalog.create('memory',{}),/Provider missing/);
});
test('provider admission occurs before any backend IO and preserves target identity',async t=>{
 const f=await fixture(t);
 await assert.rejects(createRegistry(JSON.parse(await fs.readFile(f.file,'utf8')),f.file),/not registered/);
 const catalog=new EnvironmentProviderCatalog();
 const memory=memoryProvider();catalog.register('memory',()=>memory.instance);
 const registry=await createRegistry(f.cfg,f.file,{allowedProviders:catalog.list()});
 const router=new TargetRouter(registry,{environmentCatalog:catalog});
 assert.equal(router.docker,null,'unregistered Docker cannot become implicit fallback');
 const invalid={kind:'environment',id:'unknown'};
 await assert.rejects(router.run(invalid,{op:'exec',command:'id'}),/Unknown registered/);
 await assert.rejects(router.status({kind:'host',id:'sandbox'}),/Unknown registered/);
 assert.equal(memory.calls.length,0,'rejected targets must not access provider');
 assert.equal((await router.status({kind:'environment',id:'sandbox'})).lifecycle,'absent');
 assert.equal((await router.lifecycle('create','sandbox')).lifecycle,'stopped');
 assert.equal((await router.lifecycle('start','sandbox')).lifecycle,'running');
 assert.match((await router.run({kind:'environment',id:'sandbox'},{op:'exec',command:'echo ok'})).stdout,/verified/);
 assert.deepEqual(memory.calls.filter(x=>x[0]==='run').map(x=>x[1]),['sandbox']);
});
test('extension IDs, duplicate names, unknown grants and required schema are enforced',()=>{
 const reg=new ExtensionCatalog();
 assert.throws(()=>reg.register({id:'bad/name',tools:[]}),/Invalid/);
 assert.throws(()=>reg.register({id:'sample',tools:[{name:'peek',description:'peek',schema:z.object({}).strict(),handler(){}}]}),/Invalid/);
 reg.register({id:'sample',tools:[{name:'peek',description:'Read-only status',schema:z.object({}).strict(),handler:()=>({ok:true}),readOnly:true}]});
 assert.deepEqual(reg.validateGrants([]),[]);
 assert.deepEqual(reg.validateGrants(['sample']),['sample']);
 assert.throws(()=>reg.validateGrants(['missing']),/unavailable/);
 assert.throws(()=>reg.validateGrants(['sample','sample']),/unavailable/);
 assert.throws(()=>reg.register({id:'sample',tools:[{name:'peek',description:'One',schema:z.object({}).strict(),handler:()=>({}),readOnly:true}]}),/Duplicate/);
});
test('real authenticated MCP: opt-in extensions, provider routing and fail-closed unknown targets',async t=>{
 const ext=new ExtensionCatalog();
 let invoked=0,installed=0;
 ext.register({id:'probe',tools:[{
  name:'inspect',description:'Inspect admitted target state',readOnly:true,
  schema:z.object({target:z.object({kind:z.literal('environment'),id:z.string()}).strict()}).strict(),
  async handler({target},api){invoked++;return await api.targetStatus(target);}
 }]});
 const catalog=new EnvironmentProviderCatalog();
 const memory=memoryProvider();
 catalog.register('memory',()=>{installed++;return memory.instance;});
 const f=await fixture(t,{extensions:['probe']});
 const {server}=await start(f.file,{environmentCatalog:catalog,extensionCatalog:ext});
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const url=new URL('http://127.0.0.1:'+f.cfg.port+'/mcp');
 const bad=new Client({name:'bad-auth',version:'1'},{capabilities:{}});
 await assert.rejects(bad.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'Bearer wrong'}}})));
 const client=new Client({name:'composition-http-test',version:'1'},{capabilities:{}});
 t.after(()=>client.close());
 await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'Bearer '+secret}}}));
 const names=(await client.listTools()).tools.map(x=>x.name);
 const shared=JSON.parse(await fs.readFile(new URL('../contracts/shared-mcp-tool-names.json',import.meta.url)));
 assert.equal(shared.version,1);
 assert.equal(shared.tool_names.length,24);
 assert.equal(new Set(shared.tool_names).size,24);
 for(const name of shared.tool_names)assert.ok(names.includes(name),'Shared tool omitted: '+name);
 assert.deepEqual(names.filter(x=>!shared.tool_names.includes(x)).sort(),
  ['chat_codex_home','ext_probe_inspect','resource_search'].sort());
 assert.ok(names.includes('ext_probe_inspect'));
 assert.ok(names.includes('environment_create'));
 assert.equal(names.filter(x=>x==='target_exec').length,1);
 assert.equal(installed,1);
 let result=await client.callTool({name:'ext_probe_inspect',arguments:{target:{kind:'environment',id:'sandbox'}}});
 assert.equal(result.structuredContent.lifecycle,'absent');
 const count=memory.calls.length;
 result=await client.callTool({name:'ext_probe_inspect',arguments:{target:{kind:'environment',id:'unknown'}}});
 assert.equal(result.isError,true);
 assert.equal(memory.calls.length,count,'unknown target must not enter Provider');
 result=await client.callTool({name:'ext_probe_inspect',arguments:{target:{kind:'environment',id:'sandbox',workspace:'/host'}}});
 assert.equal(result.isError,true);
 assert.equal(memory.calls.length,count);
 assert.equal(invoked,2,'schema rejection must happen before extension handler');
 assert.equal((await client.callTool({name:'environment_create',arguments:{environment:'sandbox'}})).structuredContent.lifecycle,'stopped');
 assert.equal((await client.callTool({name:'environment_start',arguments:{environment:'sandbox'}})).structuredContent.lifecycle,'running');
 result=await client.callTool({name:'target_exec',arguments:{target:{kind:'environment',id:'sandbox'},command:'echo testing'}});
 assert.equal(result.structuredContent.exit_code,0);
 assert.equal(result.structuredContent.stdout,'memory-verified\n');
 assert.equal((await client.callTool({name:'environment_delete',arguments:{environment:'sandbox'}})).structuredContent.lifecycle,'absent');
});
test('injected but ungranted extensions are not exposed via MCP discovery or invocation',async t=>{
 const f=await fixture(t);
 const c=new EnvironmentProviderCatalog().register('memory',()=>memoryProvider().instance);
 const ext=new ExtensionCatalog().register({id:'private',tools:[{
  name:'status',description:'Operator-only status',readOnly:true,
  schema:z.object({}).strict(),handler:()=>({secret:'should_not_be_visible'})
 }]});
 const {server}=await start(f.file,{environmentCatalog:c,extensionCatalog:ext});
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const client=new Client({name:'negative-test',version:'1'},{capabilities:{}});
 t.after(()=>client.close());
 await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+f.cfg.port+'/mcp'),{
  requestInit:{headers:{Authorization:'Bearer '+secret}}
 }));
 assert.ok(!(await client.listTools()).tools.some(x=>x.name==='ext_private_status'));
 const call=await client.callTool({name:'ext_private_status',arguments:{}});
 assert.equal(call.isError,true);
 assert.ok(!JSON.stringify(call).includes('should_not_be_visible'));
 const invalid=structuredClone(f.cfg);invalid.extensions=['not-installed'];
 await fs.writeFile(f.file,JSON.stringify(invalid),{mode:0o600});
 await assert.rejects(start(f.file,{environmentCatalog:c,extensionCatalog:ext}),/unavailable extension/);
});
test('providers must not forge target identity or report ready while stopped',async t=>{
 const f=await fixture(t);
 const catalog=new EnvironmentProviderCatalog();
 const fake=memoryProvider();
 catalog.register('memory',()=>fake.instance);
 const registry=await createRegistry(f.cfg,f.file,{allowedProviders:catalog.list()});
 const router=new TargetRouter(registry,{environmentCatalog:catalog});
 fake.instance.status=async()=>({id:'other',provider:'memory',lifecycle:'running',ready:true});
 await assert.rejects(router.status({kind:'environment',id:'sandbox'}),/identity mismatch/);
 fake.instance.status=async()=>({id:'sandbox',provider:'memory',lifecycle:'stopped',ready:true});
 await assert.rejects(router.status({kind:'environment',id:'sandbox'}),/Inconsistent lifecycle readiness/);
 fake.instance.status=async()=>({id:'sandbox',provider:'memory',lifecycle:'running',ready:true,kind:'host'});
 await assert.rejects(router.status({kind:'environment',id:'sandbox'}),/kind mismatch/);
 fake.instance.status=async()=>({id:'sandbox',provider:'memory',lifecycle:'running',ready:true,project:'wrong'});
 await assert.rejects(router.status({kind:'environment',id:'sandbox'}),/Project mismatch/);
 fake.instance.status=async()=>({id:'sandbox',provider:'memory',lifecycle:'running',ready:true,kind:'environment'});
 const observed=await router.status({kind:'environment',id:'sandbox'});
 assert.equal(observed.kind,'environment');
 assert.equal(observed.project,'default');
 fake.instance.status=async()=>({id:'sandbox',provider:'other',lifecycle:'running',ready:true});
 await assert.rejects(router.status({kind:'environment',id:'sandbox'}),/identity mismatch/);
});
test('once a Server is initialized, trusted Provider and extension catalogs cannot be edited',async t=>{
 const f=await fixture(t);
 const c=new EnvironmentProviderCatalog().register('memory',()=>memoryProvider().instance);
 const e=new ExtensionCatalog().register({id:'ready',tools:[{
  name:'check',description:'Limited check',readOnly:true,schema:z.object({}).strict(),
  handler:()=>({ok:true})
 }]});
 const {server}=await start(f.file,{environmentCatalog:c,extensionCatalog:e});
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 assert.throws(()=>c.register('late',()=>({})),/sealed/);
 assert.throws(()=>e.register({id:'late',tools:[]}),/sealed/);
});
test('sealed registries do not expose mutable internal maps',()=>{
 const p=new EnvironmentProviderCatalog().register('memory',()=>memoryProvider().instance).seal();
 const e=new ExtensionCatalog().register({id:'private',tools:[{
  name:'ping',description:'Ping',schema:z.object({}).strict(),readOnly:true,handler:()=>({ok:true})
 }]}).seal();
 assert.equal(p.factories,undefined);
 assert.equal(e.entries,undefined);
 // Public property assignment cannot substitute privately held tables.
 p.factories=new Map([['evil',()=>memoryProvider().instance]]);
 e.entries=new Map([['private',{id:'private',tools:[{name:'evil'}]}]]);
 assert.deepEqual(p.list(),['memory']);
 assert.deepEqual(e.get('private').tools.map(x=>x.fullName),['ext_private_ping']);
 assert.throws(()=>p.register('evil',()=>memoryProvider().instance),/sealed/);
 assert.throws(()=>e.register({id:'evil',tools:[]}),/sealed/);
});

test('extension structuredContent matches JSON wire serialization for custom toJSON values',async t=>{
 const f=await fixture(t,{extensions:['serialized']});
 const providers=new EnvironmentProviderCatalog().register('memory',()=>memoryProvider().instance);
 const schema=z.object({}).strict();
 const extensions=new ExtensionCatalog().register({id:'serialized',tools:[
  {name:'date',description:'Return date',readOnly:true,schema,handler:()=>new Date('2026-10-14T00:00:00.000Z')},
  {name:'array',description:'Return object JSON array',readOnly:true,schema,handler:()=>({toJSON:()=>[1,2]})},
  {name:'scalar',description:'Return object JSON scalar',readOnly:true,schema,handler:()=>({toJSON:()=>42})},
  {name:'null',description:'Return null JSON',readOnly:true,schema,handler:()=>null},
  {name:'invalid',description:'Return undefined JSON',readOnly:true,schema,handler:()=>undefined},
 ]});
 const {server}=await start(f.file,{environmentCatalog:providers,extensionCatalog:extensions});
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const client=new Client({name:'serialization-proof',version:'1'},{capabilities:{}});
 t.after(()=>client.close());
 await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+f.cfg.port+'/mcp'),{
  requestInit:{headers:{Authorization:'Bearer '+secret}}
 }));
 for(const [tool,value] of [['date','2026-10-14T00:00:00.000Z'],['array',[1,2]],['scalar',42],['null',null]]){
  const result=await client.callTool({name:'ext_serialized_'+tool,arguments:{}});
  assert.notEqual(result.isError,true,tool);
  assert.deepEqual(result.structuredContent,{value},tool);
  assert.deepEqual(JSON.parse(result.content[0].text),value,tool);
 }
 const invalid=await client.callTool({name:'ext_serialized_invalid',arguments:{}});
 assert.equal(invalid.isError,true);
 assert.equal(invalid.structuredContent,undefined);
});

test('post-start catalog lookup override cannot replace a granted tool for a new MCP client',async t=>{
 const f=await fixture(t,{extensions:['stable']});
 const catalog=new EnvironmentProviderCatalog().register('memory',()=>memoryProvider().instance);
 const extensions=new ExtensionCatalog().register({id:'stable',tools:[{
  name:'value',description:'Read stable value',readOnly:true,
  schema:z.object({}).strict(),handler:()=>({value:'original'})
 }]});
 const {server}=await start(f.file,{environmentCatalog:catalog,extensionCatalog:extensions});
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 extensions.get=()=>({id:'stable',tools:[{name:'malicious',fullName:'ext_stable_malicious',description:'Bypass',schema:z.object({}).strict(),readOnly:false,handler:()=>({value:'replacement'})}]});
 const client=new Client({name:'post-start-mutation-test',version:'1'},{capabilities:{}});
 t.after(()=>client.close());
 await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+f.cfg.port+'/mcp'),{
  requestInit:{headers:{Authorization:'Bearer '+secret}}
 }));
 const names=(await client.listTools()).tools.map(x=>x.name);
 assert.ok(names.includes('ext_stable_value'));
 assert.ok(!names.includes('ext_stable_malicious'));
 const result=await client.callTool({name:'ext_stable_value',arguments:{}});
 assert.deepEqual(result.structuredContent,{value:'original'});
});
