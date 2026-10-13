import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {start} from '../src/server.mjs';
test('real MCP HTTP Desktop surface is strict and disabled by default',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cc-desktop-http-'));
 let server,client;
 try{
  const proj=path.join(root,'project'),priv=path.join(root,'private');
  execFileSync(process.execPath,[new URL('../scripts/setup.mjs',import.meta.url).pathname,proj,priv,'--backend','host'],{stdio:'pipe'});
  const cfg=JSON.parse(await fs.readFile(priv+'/config.json','utf8'));
  cfg.port=25000+(process.pid%1000);
  await fs.writeFile(priv+'/config.json',JSON.stringify(cfg));
  const session=await start(priv+'/config.json');server=session.server;
  const token=(await fs.readFile(priv+'/token','utf8')).trim();
  client=new Client({name:'desktop-http-test',version:'1'},{capabilities:{}});
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+cfg.port+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
  const list=(await client.listTools()).tools;
  for(const name of ['target_desktop_status','target_desktop_observe','target_desktop_act','target_desktop_wait']){
   const t=list.find(x=>x.name===name);
   assert.ok(t,'missing '+name);
   assert.equal(t.inputSchema.additionalProperties,false);
  }
  const call=async(name,arguments_)=>client.callTool({name,arguments:arguments_});
  const target={kind:'host',id:'local'};
  const disabled=await call('target_desktop_status',{target});
  assert.equal(disabled.structuredContent.ready,false);
  assert.equal(disabled.structuredContent.state,'desktop_not_enabled');
  const refused=await call('target_desktop_observe',{target,mode:'windows'});
  assert.equal(refused.isError,true);
  const hostile=await call('target_desktop_status',{target:{...target,transport:'ssh'}});
  assert.equal(hostile.isError,true);
  const outside=await call('target_desktop_status',{target:{kind:'environment',id:'local'}});
  assert.equal(outside.isError,true);
  console.log('DESKTOP_MCP_HTTP_CONTRACT: PASS (default denied)');
 }finally{
  await client?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  await fs.rm(root,{recursive:true,force:true});
 }
});
