import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {start} from '../src/server.mjs';

test('Plugin Extensions protocol, isolated HTTP container, no Docker daemon',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cc-ext-'));
 let server,client;
 try{
  const project=path.join(root,'project'),priv=path.join(root,'private');
  execFileSync(process.execPath,[new URL('../scripts/setup.mjs',import.meta.url).pathname,project,priv,'--backend','host'],{stdio:'pipe'});
  const cfg=JSON.parse(await fs.readFile(priv+'/config.json','utf8'));
  cfg.port=22000+process.pid%1000;
  await fs.writeFile(priv+'/config.json',JSON.stringify(cfg));
  await fs.writeFile(project+'/alpha.mjs','export const a=1;\n');
  await fs.writeFile(project+'/.env','secret-name-not-visible\n');
  await fs.symlink('/etc/passwd',project+'/alpha-outside');
  const session=await start(priv+'/config.json');server=session.server;
  const token=(await fs.readFile(priv+'/token','utf8')).trim();
  const url=new URL('http://127.0.0.1:'+cfg.port+'/mcp');
  client=new Client({name:'extensions-contract',version:'1'},{capabilities:{}});
  await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'Bearer '+token}}}));
  const cap=client.getServerCapabilities();
  assert.equal(cap.experimental['openai/mentions'].searchTool,'resource_search');
  const list=(await client.listTools()).tools;
  const searchTool=list.find(t=>t.name==='resource_search');
  assert.equal(searchTool.annotations.readOnlyHint,true);
  assert.deepEqual(searchTool._meta.ui.visibility,['app']);
  assert.deepEqual(searchTool._meta['openai/extensions']['mentions/search'],{});
  const home=list.find(t=>t.name==='chat_codex_home');
  assert.equal(home._meta.ui.resourceUri,'ui://chat-codex/home');
  assert.deepEqual(home._meta['openai/ui'].entrypoints,[{type:'global'},{type:'thread'}]);
  const resource=await client.readResource({uri:'ui://chat-codex/home'});
  assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');
  assert.ok(resource.contents[0].text.includes('Registered Hosts')===false);
  assert.ok(resource.contents[0].text.includes('Recent Tasks'));
  const mention=async query=>(await client.callTool({name:'resource_search',arguments:{query}})).structuredContent.items;
  assert.ok((await mention('LOCAL')).some(x=>x.type==='resource_link'&&x.uri==='chat-codex://host/local'));
  assert.ok((await mention('ALPHA.MJS')).some(x=>x.uri.endsWith('/file/alpha.mjs')));
  assert.ok(!(await mention('.env')).some(x=>x.name==='.env'));
  assert.ok(!(await mention('outside')).some(x=>x.name==='alpha-outside'));
  assert.ok((await mention('')).every(x=>!x.uri.includes('/file/')));
  assert.ok((await mention('a')).length<=20);
  const registered=(await client.listResources()).resources;
  assert.ok(registered.some(x=>x.uri==='chat-codex://host/local'));
  assert.ok(registered.some(x=>x.uri==='chat-codex://project/default'));
  console.log('PLUGIN_EXTENSIONS_PROTOCOL: PASS (no account/UI assertions)');
 }finally{
  await client?.close();
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  await fs.rm(root,{recursive:true,force:true});
 }
});
