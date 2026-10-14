#!/usr/bin/env node
// Captures the 24 shared MCP tool signatures through a REAL authenticated
// loopback MCP Client using an isolated, empty, disposable project.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {start} from '../src/server.mjs';
import {normalizeToolSurface} from '../src/contracts/tool-surface.mjs';

const sharedPath=new URL('../contracts/shared-mcp-tool-names.json',import.meta.url);
async function freePort(){
 const s=net.createServer();
 await new Promise((yes,no)=>s.once('error',no).listen(0,'127.0.0.1',yes));
 const port=s.address().port;
 await new Promise(resolve=>s.close(resolve));
 return port;
}
export async function captureLocalStyxContract(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'styx-mcp-surface-'));
 const project=path.join(dir,'project'),privateDir=path.join(dir,'private');
 let server,client;
 try{
  await fs.mkdir(project,{mode:0o700});
  await fs.mkdir(privateDir,{mode:0o700});
  const configFile=path.join(privateDir,'config.json');
  const port=await freePort(),token=crypto.randomBytes(32).toString('base64url');
  const config={version:2,owner_id:crypto.randomUUID(),port,
   projects:[{id:'sample',path:project}],hosts:[],environments:[]};
  await fs.writeFile(configFile,JSON.stringify(config),{mode:0o600});
  await fs.writeFile(path.join(privateDir,'token'),token+'\n',{mode:0o600});
  ({server}=await start(configFile));
  client=new Client({name:'styx-surface-capture',version:'1'},{capabilities:{}});
  await client.connect(new StreamableHTTPClientTransport(
   new URL('http://127.0.0.1:'+port+'/mcp'),
   {requestInit:{headers:{Authorization:'Bearer '+token}}}
  ));
  const names=JSON.parse(await fs.readFile(sharedPath,'utf8')).tool_names;
  return normalizeToolSurface(await client.listTools(),{names});
 }finally{
  await client?.close();
  if(server){
   server.closeAllConnections();
   await new Promise(resolve=>server.close(resolve));
  }
  await fs.rm(dir,{recursive:true,force:true});
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.slice(2).length)throw Error('Usage: node scripts/capture-local-mcp-contract.mjs');
 process.stdout.write(JSON.stringify(await captureLocalStyxContract(),null,2)+'\n');
}
