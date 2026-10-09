import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {start} from '../src/server.mjs';
const backend=process.env.TEST_BACKEND||'docker';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'chat-codex-test-'));
const project=path.join(tmp,'project'),priv=path.join(tmp,'private');
execFileSync(process.execPath,[new URL('../scripts/setup.mjs',import.meta.url).pathname,project,priv,...(backend==='host'?['--backend','host']:[])],{stdio:'pipe'});
const token=(await fs.readFile(priv+'/token','utf8')).trim();
const port=Number(process.env.TEST_PORT||18793);
const config=JSON.parse(await fs.readFile(priv+'/config.json','utf8'));config.port=port;
if(backend==='docker')assert.match(config.image,/@sha256:[a-f0-9]{64}$/);
assert.equal(config.backend,backend);
// Exercise an existing configuration with no backend field against real Docker.
if(backend==='docker')delete config.backend;
await fs.writeFile(priv+'/config.json',JSON.stringify(config));
const {server}=await start(priv+'/config.json');
const client=new Client({name:'chat-codex-test',version:'1'},{capabilities:{}});
let assertions=0;
const ok=(v,msg)=>{assert.ok(v,msg);assertions++;};
const call=async(name,args,fail=false)=>{const r=await client.callTool({name,arguments:args},undefined,{timeout:90000});if(!fail)ok(!r.isError,JSON.stringify(r));return r;};
try {
 const url=new URL(`http://127.0.0.1:${port}/mcp`);
 ok((await fetch(url,{method:'POST',body:'{}'})).status===401,'auth enforced');
 ok((await fetch(url,{method:'POST',headers:{Authorization:'Bearer wrong'},body:'{}'})).status===401,'wrong auth');
 ok((await fetch(url,{headers:{Origin:'https://attacker.invalid'}})).status===403,'origin blocked');
 await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'Bearer '+token}}}));
 ok((await client.listTools()).tools.length===5,'five tools');
 await call('write_file',{path:'add.mjs',content:'export const add=(a,b)=>a-b;\n'});
 await call('write_file',{path:'add.test.mjs',content:"import test from 'node:test';import assert from 'node:assert/strict';import {add} from './add.mjs';test('adds',()=>assert.equal(add(2,3),5));\n"});
 ok((await call('read_file',{path:'add.mjs'})).structuredContent.result.content.includes('a-b'),'read');
 ok((await call('list_files',{})).structuredContent.result.entries.length===2,'list');
 const red=await call('run_command',{command:'node --test add.test.mjs'},true);ok(red.isError&&red.structuredContent.exit_code===1,'red test');
 await call('edit_file',{path:'add.mjs',old_text:'a-b',new_text:'a+b'});
 const green=await call('run_command',{command:'node --test add.test.mjs'});ok(green.structuredContent.exit_code===0,'green test');
 ok((await call('read_file',{path:'../private/token'},true)).isError,'path escape rejected');
 await call('run_command',{command:'ln -s /etc outside'});
 ok((await call('read_file',{path:'outside/passwd'},true)).isError,'symlink escape rejected');
 if(backend==='docker') {
 const isolation=await call('run_command',{command:"test ! -e /var/run/docker.sock && test ! -e /run/secrets && test $(id -u) -ne 0 && test ! -e '"+priv+"/token' && ! touch /readonly-check && node -e \"require('net').connect({host:'1.1.1.1',port:443}).on('error',()=>process.exit(0)).on('connect',()=>process.exit(1));setTimeout(()=>process.exit(0),1500)\""});
 ok(isolation.structuredContent.exit_code===0,'no socket/token/root writes/egress');
 } else {
 process.env.CHAT_CODEX_TEST_SECRET='should-not-inherit';
 const minimal=await call('run_command',{command:"node -e \"if(process.env.CHAT_CODEX_TEST_SECRET||process.env.CHAT_CODEX_CONFIG||process.env.SSH_AUTH_SOCK)process.exit(1)\""});
 ok(minimal.structuredContent.exit_code===0,'ambient secrets omitted');
 delete process.env.CHAT_CODEX_TEST_SECRET;
 }
 const timeout=await call('run_command',{command:'sleep 30',timeout_ms:1000},true);ok(timeout.isError&&timeout.structuredContent.termination==='timeout','timeout');
 const flood=await call('run_command',{command:"node -e \"for(;;)process.stdout.write('x'.repeat(8192))\""},true);ok(flood.isError&&flood.structuredContent.termination==='output_limit','output bound');
 const error=await call('run_command',{command:'printf expected-stderr >&2; exit 7'},true);ok(error.isError&&error.structuredContent.exit_code===7&&error.structuredContent.stderr==='expected-stderr','stderr and exit status');
 ok((await call('edit_file',{path:'add.mjs',old_text:'not-present',new_text:'x'},true)).isError,'missing edit rejected');
 const pending=call('run_command',{command:'sleep 2; printf done'});
 await new Promise(r=>setTimeout(r,150));
 ok((await call('list_files',{},true)).isError,'concurrent operation rejected');
 await pending;
 if(backend==='docker') {
 const names=execFileSync('docker',['ps','-a','--filter','label=chat-codex=ephemeral','--format','{{.Names}}'],{encoding:'utf8'});ok(!names.trim(),'containers cleaned');
 }
 console.log(JSON.stringify({ok:true,assertions,red_exit:red.structuredContent.exit_code,green_exit:green.structuredContent.exit_code,backend,real_docker:backend==='docker',chatgpt_account_tested:false}));
}finally{await client.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(tmp,{recursive:true,force:true});}
