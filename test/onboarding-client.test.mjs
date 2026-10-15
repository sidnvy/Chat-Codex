import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {codexClientHandoff,configureCodexClient} from '../src/onboarding-client.mjs';
import {createSetup} from '../src/setup.mjs';
import {start} from '../src/server.mjs';
const options={configFile:'/tmp/private/config.json',name:'styx-test'};
test('registration idempotency and conflicts preserve unrelated entries',()=>{
 const handoff=codexClientHandoff(options),entries=[{name:'unrelated',transport:{type:'stdio',command:'other'}}],calls=[];
 const command=(cmd,args)=>{calls.push(args);if(args[1]==='add')entries.push({name:'styx-test',enabled:true,transport:handoff.transport});return JSON.stringify(entries);};
 const first=configureCodexClient({...options,command});assert.equal(first.status,'configured');assert.equal(first.client_loaded,false);
 assert.equal(configureCodexClient({...options,command}).status,'already_configured');assert.equal(calls.filter(a=>a[1]==='add').length,1);
 entries[1].transport={type:'stdio',command:'different'};assert.equal(configureCodexClient({...options,command}).status,'conflict');assert.equal(entries[0].transport.command,'other');
 assert.throws(()=>configureCodexClient({...options,command:()=>{throw Error('SECRET')}}),e=>!e.message.includes('SECRET'));
 assert.throws(()=>codexClientHandoff({...options,name:'bad.name'}));
});
test('official Codex CLI preserves unrelated config in isolated home',{skip:!process.env.STYX_TEST_CODEX_CLI},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'styx-client-config-'));
 try{
  await fs.writeFile(path.join(root,'config.toml'),'model = "test-model"\n[mcp_servers.unrelated]\ncommand = "unrelated-command"\n');
  assert.equal(configureCodexClient({...options,codexHome:root}).status,'configured');assert.equal(configureCodexClient({...options,codexHome:root}).status,'already_configured');
  const text=await fs.readFile(path.join(root,'config.toml'),'utf8');assert.match(text,/test-model/);assert.match(text,/unrelated-command/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('actual stdio bridge authenticates and forwards tools and resources',{skip:!['linux','darwin'].includes(process.platform)||process.getuid?.()===0},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'styx-client-bridge-'));let instance,client;
 try{
  const socket=createServer();await new Promise((r,j)=>{socket.once('error',j);socket.listen(0,'127.0.0.1',r)});const port=socket.address().port;await new Promise(r=>socket.close(r));
  const setup=await createSetup({project:path.join(root,'project'),privateDir:path.join(root,'private'),backend:'host',port});instance=await start(setup.configFile);
  const handoff=codexClientHandoff({configFile:setup.configFile}),transport=new StdioClientTransport({...handoff.transport,stderr:'pipe'});let stderr='';transport.stderr?.on('data',v=>stderr+=v);
  client=new Client({name:'bridge-test',version:'1'},{capabilities:{}});await client.connect(transport,{timeout:15000});
  assert.ok((await client.listTools()).tools.some(t=>t.name==='host_list'));assert.notEqual((await client.callTool({name:'host_list',arguments:{}})).isError,true);
  const resources=await client.listResources();assert.ok(resources.resources.length);assert.ok((await client.readResource({uri:resources.resources[0].uri})).contents.length);
  const token=(await fs.readFile(path.join(setup.privateDir,'token'),'utf8')).trim();assert.ok(!stderr.includes(token));
 }finally{await client?.close();if(instance){instance.server.closeAllConnections();await new Promise(r=>instance.server.close(r));}await fs.rm(root,{recursive:true,force:true});}
});
test('bridge rejects insecure credentials without exposing token or raw errors',async()=>{
 const {spawn}=await import('node:child_process');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'styx-client-reject-'));
 try{
  const file=path.join(root,'config.json'),secret='s'.repeat(43);await fs.writeFile(file,'{}',{mode:0o600});await fs.writeFile(path.join(root,'token'),secret,{mode:0o644});
  const handoff=codexClientHandoff({configFile:file});const child=spawn(handoff.transport.command,handoff.transport.args,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});assert.equal(code,1);assert.equal(stdout,'');assert.match(stderr,/Check private configuration permissions/);assert.ok(!stderr.includes(secret));assert.ok(!stderr.includes(file));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('agent procedure reaches pending actual-client gate with isolated Codex config',{skip:!process.env.STYX_TEST_CODEX_CLI},async()=>{
 const {execFileSync}=await import('node:child_process');const {fileURLToPath}=await import('node:url');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'styx-agent-procedure-')),stateDir=path.join(root,'state'),codexHome=path.join(root,'codex'),home=path.join(root,'home');let client,installed=false;
 const cli=fileURLToPath(new URL('../scripts/onboard.mjs',import.meta.url));
 await fs.mkdir(codexHome,{mode:0o700});await fs.mkdir(home,{mode:0o700});
 const env={...process.env,HOME:home,CODEX_HOME:codexHome};
 const run=(command,args=[])=>JSON.parse(execFileSync(process.execPath,[cli,command,...(command==='probe'?[]:['--state-dir',stateDir]),...args],{env,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}));
 const device=['--device','laptop'];
 try{
  assert.equal(run('probe').supported,true);run('init',['--client','codex']);run('add-device',['--id','laptop','--label','My laptop','--location','local','--platform',process.platform==='darwin'?'macos':'linux']);run('authorize',[...device,'--host-access']);
  const socket=createServer();await new Promise((r,j)=>{socket.once('error',j);socket.listen(0,'127.0.0.1',r)});const port=socket.address().port;await new Promise(r=>socket.close(r));
  run('install',[...device,'--port',String(port)]);installed=true;run('start',device);
  // Start must return only after its process is ready for immediate verification.
  assert.equal(run('verify',device).verification.passed,true);
  assert.throws(()=>run('connect-codex',device),e=>JSON.parse(e.stdout).error==='client_authorization_required');
  const registration=run('connect-codex',[...device,'--client-access']).client_connection;assert.equal(registration.status,'configured');assert.equal(registration.client_loaded,false);
  assert.equal(run('connect-codex',device).client_connection.status,'already_configured');
  const challenge=run('prepare-client-test',device).client_test;
  client=new Client({name:'procedure-sdk-harness',version:'1'},{capabilities:{}});await client.connect(new StdioClientTransport({...registration.transport,stderr:'pipe'}),{timeout:15000});
  assert.ok((await client.listTools()).tools.some(t=>t.name==='target_exec'));
  assert.notEqual((await client.callTool({name:'target_exec',arguments:{target:challenge.target,command:challenge.command}})).isError,true);
  const result=await client.callTool({name:'target_read_file',arguments:{target:challenge.target,path:challenge.path}});assert.equal(result.structuredContent.result.content,challenge.content);
  // SDK harness is not the intended Chat client: never attest or mark onboarding complete.
  const status=run('status');assert.equal(status.devices[0].client,'not_checked');assert.equal(status.overall,'in_progress');
  assert.equal(run('stop',device).devices[0].connection,'not_checked');
 }finally{await client?.close();if(installed)run('stop',device);await fs.rm(root,{recursive:true,force:true});}
});
