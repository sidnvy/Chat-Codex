#!/usr/bin/env node
// Stdout is exclusively MCP. Never log credentials or upstream errors.
import fs from 'node:fs/promises';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema,ListResourcesRequestSchema,ListResourceTemplatesRequestSchema,ReadResourceRequestSchema,ListPromptsRequestSchema,GetPromptRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {createRegistry} from '../src/resources.mjs';
let upstream,server;
let closing=false;
async function close(code=0){if(closing)return;closing=true;await Promise.allSettled([server?.close(),upstream?.close()]);process.exit(code);}
try{
 const args=process.argv.slice(2),file=args[1];
 if(args.length!==2||args[0]!=='--config'||!path.isAbsolute(file))throw Error();
 const dir=path.dirname(file);
 for(const [p,directory] of [[dir,true],[file,false],[path.join(dir,'token'),false]]){
  const st=await fs.lstat(p);
  if(!(directory?st.isDirectory():st.isFile())||(st.mode&0o077)!==0||st.uid!==process.getuid?.())throw Error();
 }
 const config=JSON.parse(await fs.readFile(file,'utf8'));
 await createRegistry(config,file,{warnHostAccess:false});
 const token=(await fs.readFile(path.join(dir,'token'),'utf8')).trim();
 if(!/^[a-zA-Z0-9_-]{43,}$/.test(token))throw Error();
 upstream=new Client({name:'styx-local-client-bridge',version:'1'},{capabilities:{}});
 await upstream.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${config.port}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${token}`},redirect:'error'}}),{timeout:10000});
 const caps=upstream.getServerCapabilities()??{},capabilities={};
 for(const key of ['tools','resources','prompts'])if(caps[key])capabilities[key]={};
 server=new Server({name:'styx-local-client-bridge',version:'1'},{capabilities});
 const forward=(schema,fn)=>server.setRequestHandler(schema,async(request,extra)=>{
  try{return await fn(request.params,{signal:extra.signal,timeout:120000});}
  catch{throw Error('Styx request failed. Check service readiness; do not repeat a mutation without checking its result.');}
 });
 if(caps.tools){forward(ListToolsRequestSchema,(p,o)=>upstream.listTools(p,o));forward(CallToolRequestSchema,(p,o)=>upstream.callTool(p,undefined,o));}
 if(caps.resources){forward(ListResourcesRequestSchema,(p,o)=>upstream.listResources(p,o));forward(ListResourceTemplatesRequestSchema,(p,o)=>upstream.listResourceTemplates(p,o));forward(ReadResourceRequestSchema,(p,o)=>upstream.readResource(p,o));}
 if(caps.prompts){forward(ListPromptsRequestSchema,(p,o)=>upstream.listPrompts(p,o));forward(GetPromptRequestSchema,(p,o)=>upstream.getPrompt(p,o));}
 server.onclose=()=>close();
 process.once('SIGINT',()=>close());process.once('SIGTERM',()=>close());
 await server.connect(new StdioServerTransport());
}catch{process.stderr.write('Styx local connection failed. Check private configuration permissions and service readiness.\n');await close(1);}
