import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {createHash,timingSafeEqual} from 'node:crypto';
import {WebSocket,WebSocketServer} from 'ws';
import {RpcClient} from '../packages/styx-exec-adapter/rpc.mjs';

const MAX_FRAME = 2 * 1024 * 1024;
const HOST_PATH = /^\/styx\/hosts\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\/exec$/;
const TOKEN = /^Bearer ([A-Za-z0-9_-]{32,})$/;
function readToken(filename) {
  if (typeof filename !== 'string') throw Error('outbound_token_not_configured');
  const s=fs.statSync(filename);
  if (!s.isFile() || (s.mode & 0o077)) throw Error('outbound_token_permissions');
  const value=fs.readFileSync(filename,'utf8').trim();
  if (value.length<32 || /\s/.test(value) || !/^[A-Za-z0-9_-]+$/.test(value))
    throw Error('outbound_token_invalid');
  return createHash('sha256').update(value).digest();
}
function bearerCount(req) {
  return (req.rawHeaders??[]).filter((_,i)=>i%2===0)
    .filter(s=>s.toLowerCase()==='authorization').length;
}
function reject(socket,code) {
  if (!socket.destroyed) socket.end('HTTP/1.1 '+code+' Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
}
function disconnected() { return Error('host_disconnected'); }

// The outbound Host supplies a single WebSocket carrying unmodified Codex
// Exec JSON-RPC frames. No second RPC protocol is defined by Styx.
// The Host bearer is distinct from inbound MCP authorization.
export class OutboundHostRelay {
  constructor({registry,heartbeatMs=15000}={}) {
    if (!registry || typeof registry.resolve!=='function') throw TypeError('Registry required');
    this.registry=registry;this.heartbeatMs=heartbeatMs;
    this.sessions=new Map();this.stopped=false;this.attached=false;
    this.wss=new WebSocketServer({noServer:true,maxPayload:MAX_FRAME,perMessageDeflate:false});
  }
  attach(server,{allowedHosts}={}) {
    if (this.attached) throw Error('host_relay_already_attached');
    if (!Array.isArray(allowedHosts)) throw Error('explicit_upgrade_hosts_required');
    this.attached=true;
    server.on('upgrade',(req,socket,head)=>{
      const path=(req.url??'').split('?')[0];
      if (!path.startsWith('/styx/hosts/')) {socket.destroy();return}
      const match=HOST_PATH.exec(req.url??'');
      if (!match || !allowedHosts.includes(req.headers.host)) {reject(socket,403);return}
      const hostId=match[1];
      let target;
      try { target=this.registry.resolve(hostId); }
      catch {reject(socket,403);return}
      if (this.stopped || target.kind!=='host' || target.exec?.transport!=='outbound') {
        reject(socket,403);return;
      }
      if (req.headers.origin!==undefined) {reject(socket,401);return}
      if (target.exec.client_certificate_sha256) {
        // The HTTPS server must request client certificates. A valid pinned
        // public certificate replaces a shared Host bearer; private keys stay
        // on their own hosts. Never accept an unencrypted peer as mTLS.
        const cert=req.socket.getPeerCertificate?.(true);
        const fingerprint=cert?.raw &&
          createHash('sha256').update(cert.raw).digest();
        const expected=Buffer.from(target.exec.client_certificate_sha256,'hex');
        if (!req.socket.encrypted || !fingerprint ||
            fingerprint.length!==expected.length ||
            !timingSafeEqual(fingerprint,expected) ||
            bearerCount(req)!==0) {reject(socket,401);return}
      } else {
        if(bearerCount(req)!==1) {reject(socket,401);return}
        const matchBearer=TOKEN.exec(req.headers.authorization??'');
        if (!matchBearer) {reject(socket,401);return}
        let digest;
        try {digest=readToken(target.exec.token_file);}
        catch {reject(socket,403);return}
        const supplied=createHash('sha256').update(matchBearer[1]).digest();
        if (!timingSafeEqual(digest,supplied)) {reject(socket,401);return}
      }
      if (this.sessions.has(hostId)) {reject(socket,409);return}
      // Reserve identity synchronously before handling the upgrade.
      const entry={id:hostId,generation:target.generation,ws:null,closed:false,
        claimed:false,channel:null,alive:true};
      this.sessions.set(hostId,entry);
      try {
        this.wss.handleUpgrade(req,socket,head,ws=>{
          entry.ws=ws;
          ws.on('pong',()=>{entry.alive=true});
          ws.on('close',()=>this.drop(entry));
          ws.on('error',()=>this.drop(entry));
          ws.on('message',(data,isBinary)=>{
            if (isBinary || !entry.channel || entry.closed || data.length>MAX_FRAME) {
              ws.terminate();return;
            }
            entry.channel.emit('message',data);
          });
        });
      } catch {
        this.drop(entry);socket.destroy();
      }
    });
    this.timer=setInterval(()=>{
      for(const entry of this.sessions.values()) {
        if (!entry.ws) continue;
        let target;
        try {target=this.registry.resolve(entry.id);}
        catch {entry.ws.terminate();continue}
        if (target.generation!==entry.generation || target.exec?.transport!=='outbound' ||
            !entry.alive) {entry.ws.terminate();continue}
        entry.alive=false;
        try {entry.ws.ping()} catch {entry.ws.terminate()}
      }
    },this.heartbeatMs);
    this.timer.unref?.();
  }
  drop(entry) {
    if (entry.closed) return;
    entry.closed=true;
    if (this.sessions.get(entry.id)===entry) this.sessions.delete(entry.id);
    entry.channel?.emit('closed');
  }
  async acquire(target) {
    if (this.stopped) throw disconnected();
    const entry=this.sessions.get(target.id);
    if (!entry || entry.closed || !entry.ws || entry.ws.readyState!==WebSocket.OPEN ||
        entry.generation!==target.generation || entry.claimed) throw disconnected();
    this.registry.resolve(target.id);
    entry.claimed=true;
    const channel=new EventEmitter();
    channel.send=(text)=>{
      if (entry.closed || entry.ws.readyState!==WebSocket.OPEN) throw disconnected();
      if (Buffer.byteLength(text)>MAX_FRAME) {entry.ws.terminate();throw disconnected()}
      entry.ws.send(text,{binary:false});
    };
    channel.close=async ()=>{
      if (entry.ws.readyState===WebSocket.OPEN) entry.ws.close(1000,'styx_session_closed');
      else entry.ws.terminate();
      this.drop(entry);
    };
    entry.channel=channel;
    return new RpcClient(channel,{timeoutMs:target.exec.timeout_ms??35000});
  }
  connected(id) {
    const e=this.sessions.get(id);
    return Boolean(e && !e.closed && e.ws?.readyState===WebSocket.OPEN);
  }
  async close() {
    this.stopped=true;clearInterval(this.timer);
    for(const entry of this.sessions.values()){entry.ws?.terminate();this.drop(entry)}
    this.sessions.clear();this.wss.close();
  }
}
