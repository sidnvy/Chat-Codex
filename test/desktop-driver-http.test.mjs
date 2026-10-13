import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {start} from '../src/server.mjs';
import {DesktopDriverCatalog} from '../src/desktop/drivers.mjs';
test('an audited third-party desktop driver is injectable into real MCP without OS-specific changes',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cc-driver-http-'));
 let server,client;
 try{
  const project=path.join(root,'project'),priv=path.join(root,'private');
  execFileSync(process.execPath,[new URL('../scripts/setup.mjs',import.meta.url).pathname,project,priv,'--backend','host'],{stdio:'pipe'});
  const file=priv+'/config.json',cfg=JSON.parse(await fs.readFile(file,'utf8'));
  cfg.port=27000+process.pid%1000;cfg.hosts[0].capabilities={desktop:{enabled:true,driver:'custom-portal'}};
  await fs.writeFile(file,JSON.stringify(cfg));
  let observed=0;
  const catalog=new DesktopDriverCatalog();
  catalog.register('custom-portal',()=>({
   async status(){return {ready:true,state:'ready',driver:'custom-portal',capabilities:['windows']};},
   async observe({mode}){observed++;if(mode==='windows')return {driver:'custom-portal',windows:[{id:'scr',title:'Scratch'}]};return {driver:'custom-portal',window:{id:'scr',title:'Scratch'},receipt:{window_id:'scr'}};},
   async act(){return {driver:'custom-portal',outcome:'dispatched_unverified',verified:false};}
  }));
  ({server}=await start(file,{desktopCatalog:catalog}));
  const token=(await fs.readFile(priv+'/token','utf8')).trim();
  client=new Client({name:'cc-custom-driver',version:'1'},{capabilities:{}});
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+cfg.port+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
  const target={kind:'host',id:'local'};
  const status=await client.callTool({name:'target_desktop_status',arguments:{target}});
  assert.equal(status.structuredContent.driver,'custom-portal');
  const response=await client.callTool({name:'target_desktop_observe',arguments:{target,mode:'windows'}});
  assert.equal(response.structuredContent.windows[0].title,'Scratch');
  assert.equal(observed,1);
  const rejected=await client.callTool({name:'target_desktop_observe',arguments:{target:{...target,provider:'ssh'},mode:'windows'}});
  assert.equal(rejected.isError,true);
 }finally{
  await client?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  await fs.rm(root,{recursive:true,force:true});
 }
});
