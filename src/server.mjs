import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
import {createRegistry,idSchema,targetSchema,pathSchema,commandSchema,timeoutSchema,listProjects} from './resources.mjs';
import {TargetRouter} from './router.mjs';
import {TaskManager} from './tasks.mjs';
import {searchResources} from './mentions.mjs';
import {DesktopManager} from './desktop/manager.mjs';
import {createBuiltInEnvironmentCatalog} from './runtime/providers.mjs';
import {ExtensionCatalog,registerGrantedExtensions} from './runtime/extensions.mjs';
import {desktopObserveSchema,desktopActSchema,desktopWaitSchema} from './desktop/contract.mjs';

const empty=z.object({}).strict();
const targetArgs=targetSchema;
const execArgs=z.object({target:targetArgs,command:commandSchema,cwd:pathSchema.default('.'),timeout_ms:timeoutSchema}).strict();
const pathArgs=z.object({target:targetArgs,path:pathSchema}).strict();
const readArgs=pathArgs;
const listArgs=z.object({target:targetArgs,path:pathSchema.default('.')}).strict();
const writeArgs=z.object({target:targetArgs,path:pathSchema,content:z.string().max(32768)}).strict();
const patchArgs=z.object({target:targetArgs,path:pathSchema,patch:z.string().min(1).max(32768)}).strict();
const taskArgs=z.object({target:targetArgs,session_id:z.string().regex(/^[a-f0-9]{24}$/)}).strict();
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const show=(data)=>({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:Array.isArray(data)?{items:data}:data});
const failed=e=>({isError:true,content:[{type:'text',text:String(e.message??e).slice(0,500)}]});
async function snapshot(router,tasks){
 const projects=router.projectsList(),hosts=router.hostsList(),environments=await router.environmentsList();
 const recent=[...tasks.records.values()].slice(-10).reverse().map(t=>({id:t.id,status:t.status,target:t.target,exit_code:t.exit_code,termination:t.termination}));
 let executions=[];
 const filename=path.join(router.registry.privateDir,'audit.jsonl');
 try {
  const handle=await fs.open(filename,'r');
  try {
   const stat=await handle.stat(),start=Math.max(0,stat.size-32768),buf=Buffer.alloc(stat.size-start);
   await handle.read(buf,0,buf.length,start);
   const rows=buf.toString('utf8').split('\n');
   if(start>0)rows.shift();
   executions=rows.filter(Boolean).slice(-10).reverse().flatMap(line=>{
    try{const item=JSON.parse(line);return [{kind:item.kind??item.backend??'docker-job',id:item.id??'',op:item.op??'',at:item.at,exit_code:item.exit_code??null,termination:item.termination??null}];}
    catch{return [];}
   });
  } finally {await handle.close();}
 }catch(e){if(e.code!=='ENOENT')throw e;}
 return {projects,hosts,environments,tasks:recent,executions};
}
function renderHtml(template,s){
 const row=(main,secondary)=>'<div class="item"><code>'+esc(main)+'</code><span class="meta">'+esc(secondary)+'</span></div>';
 const items=(a,f)=>a.length?a.map(f).join(''):'<div class="item"><span class="meta">None registered</span></div>';
 return template
 .replace('<!--PROJECTS-->',items(s.projects,p=>row(p.id,p.targets.map(t=>t.kind+':'+t.id).join(', '))))
 .replace('<!--HOSTS-->',items(s.hosts,h=>row(h.id,'connected � unsandboxed � '+h.project)))
 .replace('<!--ENVIRONMENTS-->',items(s.environments,e=>row(e.id,e.lifecycle+' � '+e.provider+' � '+e.project)))
 .replace('<!--TASKS-->',items(s.tasks,t=>row(t.id,t.status+' � '+t.target.kind+':'+t.target.id)))
 .replace('<!--EXECUTIONS-->',items(s.executions,e=>row(e.id,e.kind+' � '+e.op+' � exit '+(e.exit_code??'unknown')+(e.termination?' ('+e.termination+')':''))));
}
export async function start(configFile,{desktopCatalog,environmentCatalog=createBuiltInEnvironmentCatalog(),extensionCatalog=new ExtensionCatalog()}={}){
 const raw=JSON.parse(await fs.readFile(configFile,'utf8'));
 const registry=await createRegistry(raw,configFile,{allowedProviders:environmentCatalog.list()});
 const grants=extensionCatalog.validateGrants(registry.config.extensions??[]);
 const grantedEntries=Object.freeze(grants.map(id=>extensionCatalog.get(id)));
 environmentCatalog.seal();extensionCatalog.seal();
 const router=new TargetRouter(registry,{environmentCatalog});
 const tasks=await new TaskManager(router).init();
 const desktops=new DesktopManager(registry,desktopCatalog?{catalog:desktopCatalog}:{});
 const port=registry.config.port,privateDir=registry.privateDir;
 const tokenFile=path.join(privateDir,'token');
 const st=await fs.lstat(tokenFile);
 if(!st.isFile()||(st.mode&0o077))throw Error('Token file must be regular and 0600');
 const token=(await fs.readFile(tokenFile,'utf8')).trim();
 if(!/^[a-zA-Z0-9_-]{43,}$/.test(token))throw Error('Invalid token');
 const digest=crypto.createHash('sha256').update('Bearer '+token).digest();
 const appTemplate=await fs.readFile(new URL('../app/home.html',import.meta.url),'utf8');
 function protocol(){
  const mcp=new McpServer({name:'Chat-Codex',version:'0.3.0'});
  mcp.server.registerCapabilities({experimental:{'openai/mentions':{searchTool:'resource_search'}}});
  const register=(name,description,schema,fn,read=false,meta)=>mcp.registerTool(name,{
   description,inputSchema:schema,annotations:{readOnlyHint:read,destructiveHint:!read,idempotentHint:read},
   ...(meta?{_meta:meta}:{})
  },async args=>{
   try{const result=await fn(args);return show(result);}
   catch(e){return failed(e);}
  });
  const run=async(a,op,extra={})=>{
   const receipt=await router.run(a.target,{op,...extra});
   return receipt;
  };
  const execResult=async(a,op,extra)=>{
   const receipt=await run(a,op,extra);
   return {content:[{type:'text',text:JSON.stringify(receipt)}],structuredContent:receipt,isError:receipt.exit_code!==0||Boolean(receipt.termination)};
  };
  register('host_list','List admitted persistent Hosts; does not manage machine lifecycle.',empty,()=>router.hostsList(),true);
  register('host_status','Read Host connection readiness (not machine power state).',z.object({host:idSchema}).strict(),a=>router.status({kind:'host',id:a.host}),true);
  register('environment_list','List disposable Environments and real lifecycle.',empty,()=>router.environmentsList(),true);
  register('environment_status','Read provisioned Environment lifecycle.',z.object({environment:idSchema}).strict(),a=>router.status({kind:'environment',id:a.environment}),true);
  for(const action of ['create','start','stop','delete']){
   register('environment_'+action,'Control a configured provisioned Environment; never a Host.',z.object({environment:idSchema}).strict(),a=>router.lifecycle(action,a.environment));
  }
  register('project_list','List Projects independently of execution targets.',empty,()=>router.projectsList(),true);
  register('project_status','Read Project identity and associated targets.',z.object({project:idSchema}).strict(),a=>{
   const p=router.projectsList().find(x=>x.id===a.project);
   if(!p)throw Error('Unknown registered project');
   return p;
  },true);
  register('target_status','Status of an explicitly typed registered Host or Environment.',z.object({target:targetArgs}).strict(),a=>router.status(a.target),true);
  register('target_desktop_status','Read Desktop readiness separately from Host connection.',z.object({target:targetArgs}).strict(),a=>desktops.status(a.target),true);
  mcp.registerTool('target_desktop_observe',{
   description:'Read windows or capture an exact active window and mint a short-lived target-bound screenshot. Images are ephemeral.',
   inputSchema:desktopObserveSchema,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}
  },async a=>{
   try{
    const observed=await desktops.observe(a);
    const {image,...result}=observed;
    return {content:[{type:'text',text:JSON.stringify(result)},...(image?[{type:'image',data:image.data,mimeType:image.mimeType}]:[])],structuredContent:result};
   }catch(e){return failed(e);}
  });
  register('target_desktop_act','Execute a single action against a fresh target-bound Desktop snapshot.',desktopActSchema,a=>desktops.act(a));
  mcp.registerTool('target_desktop_wait',{description:'Wait for an exact window title with a bounded timeout.',inputSchema:desktopWaitSchema,annotations:{readOnlyHint:true,destructiveHint:false}},async a=>{
   try{const result=await desktops.wait(a);return {...show(result),isError:!result.matched};}
   catch(e){return failed(e);}
  });

  const execTool=(name,description,schema,op,transform,read=false)=>{
   mcp.registerTool(name,{description,inputSchema:schema,annotations:{readOnlyHint:read,destructiveHint:!read,idempotentHint:read}},async a=>{
    try{return await execResult(a,op,transform(a));}catch(e){return failed(e);}
   });
  };
  execTool('target_exec','Execute bounded shell command in a registered typed target; Host is unsandboxed; no implicit fallback.',execArgs,'exec',a=>({command:a.command,cwd:a.cwd,timeout_ms:a.timeout_ms}));
  execTool('target_list_directory','Read a project-relative directory.',listArgs,'list',a=>({path:a.path}),true);
  execTool('target_read_file','Read up to 32 KiB of a project-relative UTF-8 file.',readArgs,'read',a=>({path:a.path}),true);
  execTool('target_write_file','Write a project-relative UTF-8 file (32 KiB max).',writeArgs,'write',a=>({path:a.path,content:a.content}));
  execTool('target_apply_patch','Apply a validated single-file unified diff within the project.',patchArgs,'patch',a=>({path:a.path,patch:a.patch}));
  register('target_process_start','Start bounded asynchronous command with durable task receipt.',execArgs,a=>tasks.start(a.target,{op:'exec',command:a.command,cwd:a.cwd,timeout_ms:a.timeout_ms}));
  register('target_process_poll','Poll a process receipt, with no inference of success from unknown state.',z.object({...taskArgs.shape,max_lines:z.number().int().min(1).max(1000).default(200)}).strict(),a=>tasks.poll(a.target,a.session_id,a.max_lines),true);
  register('target_process_stop','Request cancellation and report confirmed/unknown termination.',taskArgs,a=>tasks.stop(a.target,a.session_id));
  register('target_task_list','List recent durable task receipts for a typed target.',z.object({target:targetArgs,limit:z.number().int().min(1).max(20).default(10)}).strict(),a=>tasks.list(a.target,a.limit),true);
  register('resource_search','App-only read-only Composer mention search across registered resources and bounded project files.',z.object({query:z.string().max(80)}).strict(),a=>searchResources(registry,a.query),true,{
   ui:{visibility:['app']},'openai/extensions':{'mentions/search':{}}
  });
  const appUri='ui://chat-codex/home';
  register('chat_codex_home','Display a lightweight read-only workspace overview.',empty,()=>snapshot(router,tasks),true,{
   ui:{resourceUri:appUri},'openai/ui':{entrypoints:[{type:'global'},{type:'thread'}]}
  });
  mcp.registerResource('Chat-Codex Home',appUri,{mimeType:'text/html;profile=mcp-app'},async()=>{
   const html=renderHtml(appTemplate,await snapshot(router,tasks));
   return {contents:[{uri:appUri,mimeType:'text/html;profile=mcp-app',text:html}]};
  });
  const extensionApi=Object.freeze({
   listProjects:()=>router.projectsList(),
   targetStatus:target=>router.status(target),
  });
  registerGrantedExtensions(mcp,grantedEntries,extensionApi);
  for(const [kind,entries] of [['host',registry.hosts],['environment',registry.environments],['project',registry.projects]]){
   for(const e of entries.values()){
    const uri='chat-codex://'+kind+'/'+encodeURIComponent(e.id);
    mcp.registerResource(kind+':'+e.id,uri,{mimeType:'application/json'},async()=>{
     let status;
     if(kind==='project')status=router.projectsList().find(x=>x.id===e.id);
     else status=await router.status({kind,id:e.id});
     return {contents:[{uri,mimeType:'application/json',text:JSON.stringify(status)}]};
    });
   }
  }
  return mcp;
 }
 const server=http.createServer(async(req,res)=>{
  const reply=(code,message)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:message}));};
  if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)||req.headers.origin)return reply(403,'Host or Origin refused');
  if(req.url==='/healthz'&&req.method==='GET'){res.writeHead(200,{'content-type':'application/json'});return res.end('{"ok":true,"scope":"process only"}');}
  if(req.url!=='/mcp'||!['POST','GET','DELETE'].includes(req.method))return reply(404,'Not found');
  const authNames=req.rawHeaders.filter((_,i)=>i%2===0).filter(x=>x.toLowerCase()==='authorization');
  if(authNames.length!==1||!crypto.timingSafeEqual(digest,crypto.createHash('sha256').update(req.headers.authorization??'').digest()))return reply(401,'Unauthorized');
  let mcp,transport;
  try{
   let body;
   if(req.method==='POST'){
    let bytes=0;const chunks=[];
    for await(const chunk of req){bytes+=chunk.length;if(bytes>262144){reply(413,'Request too large');return;}chunks.push(chunk);}
    try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return reply(400,'Invalid JSON');}
    if(Array.isArray(body))return reply(400,'Batch requests unsupported');
   }
   mcp=protocol();
   transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
   res.on('close',()=>{transport.close();mcp.close();});
   await mcp.connect(transport);
   await transport.handleRequest(req,res,body);
  }catch(e){console.error('MCP request failed:',String(e.message).slice(0,200));if(!res.headersSent)reply(500,'Request failed');}
 });
 server.headersTimeout=10000;server.requestTimeout=330000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {server,router,tasks,registry};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(!process.env.CHAT_CODEX_CONFIG)throw Error('Set CHAT_CODEX_CONFIG to private config.json');
 const {server}=await start(process.env.CHAT_CODEX_CONFIG);
 console.log('Chat-Codex v2 listening on loopback (Bearer protected).');
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();setTimeout(()=>process.exit(0),70000).unref();});
}