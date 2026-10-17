import test from 'node:test';
import assert from 'node:assert/strict';
import {TargetRegistry} from '../registry.mjs';
import {CuaProvider} from '../cua.mjs';
import {createStyxGateway} from '../index.mjs';

const target = (id,platform,enabled=true) => ({
  id,kind:'host', platform,generation:'runtime-v1',allowed:true,
  cwd: platform==='win32' ? 'C:\\Users\\Demo' : '/tmp/styx',
  shell: platform==='win32' ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe':'/bin/sh',
  shells: platform==='win32' ? ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe']:['/bin/sh'],
  exec: platform==='win32' ? {transport:'websocket',url:'wss://test.example/exec'} :
    {transport:'stdio',binary:'/usr/local/bin/codex'},
  computer: {enabled,transport:'mcp-http',url:'https://driver.example/mcp',token_file:'/tmp/cua-test'}
});

function fixture() {
  const calls=[], instances=[], closed=[];
  const registry=new TargetRegistry({version:1,default_environment_id:'mac',
    targets:[target('mac','darwin'),target('linux','linux'),target('windows','win32')]});
  const connect=async (target,owner)=> {
    instances.push({target:target.id,owner});
    return {
      getServerVersion() {return {name:'cua-driver',version:'0.36.0'};},
      async listTools() {
        return {tools:[
          {name:'list_apps',description:'Cua list_apps',
            inputSchema:{type:'object',properties:{},additionalProperties:false}},
          {name:'click',description:'Cua native click',
            inputSchema:{type:'object',properties:{target:{type:'object'},
              element_token:{type:'string'}},required:['target'],additionalProperties:false}},
          {name:'install_extension',inputSchema:{type:'object',properties:{}}}
        ]};
      },
      async callTool(input) {
        calls.push({owner,target:target.id,input});
        return {content:[{type:'text',text:'accepted'}],
          structuredContent:{owner,target:target.id,name:input.name}};
      },
      async close(){closed.push({owner,target:target.id});}
    };
  };
  const provider=new CuaProvider({registry,connect,toolNames:['list_apps','click']});
  return {provider,registry,calls,instances,closed};
}
test('Cua MCP is schema authority; Styx adds only optional environment_id',async()=>{
  const f=fixture();
  const definitions=await f.provider.listTools();
  assert.deepEqual(definitions.map(t=>t.name),['list_apps','click']);
  assert.equal(definitions[0].inputSchema.properties.environment_id.type,'string');
  const fields=Object.keys(definitions[1].inputSchema.properties);
  assert.ok(fields.includes('target'));
  assert.ok(fields.includes('element_token'));
  assert.ok(fields.includes('environment_id'));
  assert.equal(fields.includes('coordinate_frame'),false);
  await f.provider.close();
});
test('macOS Linux and Windows use the same Cua tool surface',async()=>{
  const f=fixture();
  for(const id of ['mac','linux','windows']){
    const r=await f.provider.callTool('click',{environment_id:id,
      target:{kind:'window',pid:123,window_id:456},element_token:'s1:1'},'alice');
    assert.equal(r.structuredContent.target,id);
  }
  assert.deepEqual(f.calls.map(c=>c.target),['mac','linux','windows']);
  for(const c of f.calls) assert.deepEqual(c.input.arguments,
    {target:{kind:'window',pid:123,window_id:456},element_token:'s1:1'});
  assert.equal(f.instances.length,3);
  await f.provider.close();
});
test('Cua native implicit sessions do not cross MCP owners',async()=>{
  const f=fixture();
  await f.provider.callTool('click',{element_token:'x',target:{kind:'window'}},'alice');
  await f.provider.callTool('click',{element_token:'x',target:{kind:'window'}},'bob');
  assert.equal(f.instances.length,2);
  await f.provider.closeOwner('alice');
  assert.deepEqual(f.closed.map(x=>x.owner),['alice']);
  await f.provider.callTool('list_apps',{},'bob');
  assert.equal(f.instances.length,2);
  await f.provider.close();
  assert.deepEqual(f.closed.map(x=>x.owner),['alice','bob']);
});
test('unknown tools and unauthorized targets are rejected before native calls',async()=>{
  const f=fixture();
  assert.equal((await f.provider.callTool('install_extension',{},'alice')).structuredContent.error,'unknown_tool');
  assert.equal((await f.provider.callTool('click',{environment_id:'other'},'alice')).structuredContent.error,'environment_not_found');
  assert.equal((await f.provider.callTool('click',{environment_id:23},'alice')).structuredContent.error,'invalid_environment');
  assert.deepEqual(f.calls,[]);
  await f.provider.close();
});
test('Gateway advertises Codex and dynamically discovered official Cua tool names',async()=>{
  const f=fixture();
  const runtime={sessionId:'fixture-runtime', lost:false, async request(){throw Error('no exec');},async close(){}};
  const gateway=createStyxGateway({catalog:f.registry,connect:async()=>runtime,computer:f.provider});
  const {InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js');
  const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
  const [ct,st]=InMemoryTransport.createLinkedPair();
  const server=gateway.serverForOwner('alice');
  await server.connect(st);
  const client=new Client({name:'styx-cua-test',version:'0.1'});
  await client.connect(ct);
  const list=await client.listTools();
  assert.deepEqual(list.tools.map(x=>x.name),
    ['exec_command','write_stdin','list_apps','click','list_execution_environments']);
  const r=await client.callTool({name:'click',arguments:{
    environment_id:'linux',target:{kind:'window'},element_token:'x'}});
  assert.equal(r.structuredContent.target,'linux');
  await client.close();await server.close();await gateway.close();
});
test('Windows absolute paths use Windows rules regardless of gateway OS',()=>{
  const r=new TargetRegistry({version:1,default_environment_id:'windows',
    targets:[target('windows','win32')]});
  assert.equal(r.resolve().platform,'win32');
  assert.ok(r.list()[0].capabilities.includes('computer'));
});
