import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

export function codexClientHandoff({configFile,name='styx',node=process.execPath}={}){
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(name))throw Error('Invalid client entry name.');
 if(typeof configFile!=='string'||!path.isAbsolute(configFile)||configFile.includes('\0'))throw Error('An absolute configuration path is required.');
 if(!path.isAbsolute(node))throw Error('An absolute Node executable is required.');
 const bridge=fileURLToPath(new URL('../scripts/mcp-stdio.mjs',import.meta.url));
 const args=[bridge,'--config',configFile];
 return {schema_version:1,client:'codex',name,transport:{type:'stdio',command:node,args},
  registration:{command:'codex',args:['mcp','add',name,'--',node,...args]},
  client_loaded:false,next_action:'reload_client_then_verify_tools',
  trust_boundary:'The local client bridge reads the private Styx credential and accesses the configured Host permissions. No credential is stored in Codex configuration.'};
}
/** Only call after authorization to connect this client. Never replaces existing entries. */
export function configureCodexClient({codexHome,command=execFileSync,...options}={}){
 const handoff=codexClientHandoff(options);
 if(codexHome!==undefined&&!path.isAbsolute(codexHome))throw Error('An absolute Codex home is required.');
 const run=args=>{
  try{return command('codex',args,{encoding:'utf8',timeout:15000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],env:{...process.env,...(codexHome?{CODEX_HOME:codexHome}:{})}});}
  catch{throw Error('Codex client configuration failed; inspect the local client without sharing credentials.');}
 };
 const inspect=()=>{try{const entries=JSON.parse(run(['mcp','list','--json']));if(!Array.isArray(entries))throw Error();return entries;}catch{throw Error('Cannot inspect Codex MCP entries safely.');}};
 const matches=e=>e.enabled!==false&&e.transport?.type==='stdio'&&e.transport.command===handoff.transport.command&&JSON.stringify(e.transport.args)===JSON.stringify(handoff.transport.args)&&!Object.keys(e.transport.env??{}).length&&!(e.transport.env_vars??[]).length&&!e.transport.cwd;
 const existing=inspect().find(e=>e.name===handoff.name);
 if(existing&&!matches(existing))return {...handoff,status:'conflict',next_action:'resolve_existing_client_entry'};
 if(existing)return {...handoff,status:'already_configured'};
 run(handoff.registration.args);
 if(!matches(inspect().find(e=>e.name===handoff.name)??{}))throw Error('Codex configuration could not be confirmed.');
 return {...handoff,status:'configured'};
}
