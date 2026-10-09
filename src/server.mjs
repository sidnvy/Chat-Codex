import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
import {Runner} from './runner.mjs';
export async function start(configFile) {
  const config=JSON.parse(await fs.readFile(configFile,'utf8'));
  config.project=await fs.realpath(config.project);
  const privateDir=await fs.realpath(path.dirname(configFile));
  const source=await fs.realpath(fileURLToPath(new URL('..',import.meta.url)));
  const contains=(a,b)=>b===a||b.startsWith(a+path.sep);
  if(config.project==='/'||contains(config.project,privateDir)||contains(config.project,source))throw Error('Project must not contain config, source or host root');
  if(config.project.includes(','))throw Error('Comma in project path is unsupported');
  if(!/^\d+:\d+$/.test(config.user)||config.user.split(':')[0]==='0')throw Error('Runner must have a non-root UID:GID');
  if(typeof config.image!=='string'||!/^node:[a-zA-Z0-9_.-]+(?:@sha256:[a-f0-9]{64})?$/.test(config.image))throw Error('Use a reviewed official node image');
  const port=config.port??8791;if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');
  const tokenFile=path.join(privateDir,'token');
  if((await fs.stat(tokenFile)).mode&0o077)throw Error('Token file permissions must be 0600');
  const token=(await fs.readFile(tokenFile,'utf8')).trim();if(!/^[a-zA-Z0-9_-]{43,}$/.test(token))throw Error('Invalid token');
  const digest=crypto.createHash('sha256').update('Bearer '+token).digest();
  config.audit=path.join(privateDir,'audit.jsonl');
  const runner=new Runner(config);
  function protocol(){
    const mcp=new McpServer({name:'Chat-Codex',version:'0.1.0'});
    const filePath=z.string().min(1).max(1024);
    const register=(name,description,inputSchema,op,read=false)=>mcp.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:read,destructiveHint:!read,idempotentHint:read,openWorldHint:false}},async args=>{
      try{const result=await runner.run({op,...args});return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:result.exit_code!==0||Boolean(result.termination)};}
      catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}
    });
    register('list_files','List project files. Paths are relative to /workspace.',{path:filePath.default('.')},'list',true);
    register('read_file','Read a UTF-8 project file up to 32 KiB.',{path:filePath},'read',true);
    register('write_file','Create or overwrite a UTF-8 project file; parent directory must exist.',{path:filePath,content:z.string().max(32768)},'write');
    register('edit_file','Replace exactly one occurrence of old_text; fails if missing or ambiguous.',{path:filePath,old_text:z.string().min(1).max(32768),new_text:z.string().max(32768)},'edit');
    register('run_command','Run a noninteractive shell command in a fresh offline container; returns stdout, stderr, exit_code and termination. Project files persist; other container changes do not.',{command:z.string().min(1).max(8192),cwd:filePath.default('.'),timeout_ms:z.number().int().min(1000).max(60000).default(15000)},'exec');
    return mcp;
  }
  const server=http.createServer(async(req,res)=>{
    const reply=(code,message)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:message}));};
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)||req.headers.origin)return reply(403,'Host or Origin refused');
    if(req.url==='/healthz'&&req.method==='GET'){res.writeHead(200,{'content-type':'application/json'});return res.end('{"ok":true,"scope":"process only"}');}
    if(req.url!=='/mcp'||!['POST','GET','DELETE'].includes(req.method))return reply(404,'Not found');
    const duplicate=req.rawHeaders.filter((_,i)=>i%2===0).filter(x=>x.toLowerCase()==='authorization').length!==1;
    if(duplicate||!crypto.timingSafeEqual(digest,crypto.createHash('sha256').update(req.headers.authorization??'').digest()))return reply(401,'Unauthorized');
    let mcp,transport;
    try{
      let body;if(req.method==='POST'){
        let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>262144){reply(413,'Request too large');return;}chunks.push(chunk);}
        try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return reply(400,'Invalid JSON');}
        if(Array.isArray(body))return reply(400,'Batch requests unsupported');
      }
      mcp=protocol();transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
      res.on('close',()=>{transport.close();mcp.close();});
      await mcp.connect(transport);await transport.handleRequest(req,res,body);
    }catch{if(!res.headersSent)reply(500,'Request failed');}
  });
  server.headersTimeout=10000;server.requestTimeout=80000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,runner};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(!process.env.CHAT_CODEX_CONFIG)throw Error('Set CHAT_CODEX_CONFIG to your config.json');
  const {server}=await start(process.env.CHAT_CODEX_CONFIG);
  console.log('Chat-Codex listening on loopback; use your private Secure MCP Tunnel.');
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{server.close();setTimeout(()=>process.exit(0),70000).unref();});
}
