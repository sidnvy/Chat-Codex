import crypto from 'node:crypto';
import http from 'node:http';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';

// Shared HTTP boundary. The caller supplies trusted composition, never a module path.
export async function startLoopbackMcp({port,token,protocol}){
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid loopback port');
 if(typeof token!=='string'||!/^[a-zA-Z0-9_-]{43,}$/.test(token))throw Error('Invalid token');
 if(typeof protocol!=='function')throw Error('Protocol factory required');
 const digest=crypto.createHash('sha256').update('Bearer '+token).digest();
 const server=http.createServer(async(req,res)=>{
  const reply=(code,message)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:message}));};
  const boundPort=server.address()?.port;
  const hostCount=req.rawHeaders.filter((_,i)=>i%2===0).filter(x=>x.toLowerCase()==='host').length;
  if(hostCount!==1||!['127.0.0.1:'+boundPort,'localhost:'+boundPort].includes(req.headers.host)||req.headers.origin!==undefined)return reply(403,'Host or Origin refused');
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
 return server;
}
