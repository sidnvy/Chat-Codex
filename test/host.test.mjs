import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRegistry} from '../src/resources.mjs';
import {TargetRouter} from '../src/router.mjs';
import {TaskManager} from '../src/tasks.mjs';

test('host setup is Docker-independent; unsandboxed host execution, cancellation, task receipts',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cc-host-'));
 try{
  const project=path.join(root,'project'),priv=path.join(root,'private');
  execFileSync(process.execPath,[new URL('../scripts/setup.mjs',import.meta.url).pathname,project,priv,'--backend','host'],{env:{PATH:''},stdio:'pipe'});
  const cfg=JSON.parse(await fs.readFile(priv+'/config.json','utf8'));
  assert.equal(cfg.hosts[0].unsandboxed,true);
  assert.deepEqual(cfg.environments,[]);
  assert.equal(cfg.docker,undefined);
  const registry=await createRegistry(cfg,priv+'/config.json');
  const router=new TargetRouter(registry);
  const t={kind:'host',id:'local'};
  assert.equal((await router.status(t)).connection,'connected');
  const receipt=await router.run(t,{op:'exec',command:'printf host-success',timeout_ms:5000});
  assert.equal(receipt.stdout,'host-success');
  const tasks=await new TaskManager(router).init();
  const started=await tasks.start(t,{op:'exec',command:'sleep 30',timeout_ms:30000});
  assert.equal(started.status,'running');
  const stopped=await tasks.stop(t,started.id);
  assert.equal(stopped.status,'cancelled');
  const restart=await new TaskManager(router).init();
  assert.equal(restart.poll(t,started.id).status,'cancelled');
  const lingering={...started,id:'a'.repeat(24),status:'running'};
  await fs.writeFile(priv+'/tasks.json',JSON.stringify([lingering]));
  const recovery=await new TaskManager(router).init();
  assert.equal(recovery.poll(t,lingering.id).status,'lost');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('POSIX Host worker bounds file access, execution time and output',async()=>{
 const {HostRunner}=await import('../src/host-runner.mjs');
 const {validateHost}=await import('../src/backends.mjs');
 validateHost({platform:'darwin',uid:501});assert.throws(()=>validateHost({platform:'darwin',uid:0}));assert.throws(()=>validateHost({platform:'win32',uid:501}));
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'styx-posix-host-'));
 try{
  const project=path.join(root,'project');await fs.mkdir(project);const runner=new HostRunner({project,audit:path.join(root,'audit.jsonl')});
  const content='macOS Linux 中文 🌊\n';await runner.run({op:'write',path:'hello.txt',content});assert.equal((await runner.run({op:'read',path:'hello.txt'})).result.content,content);
  await fs.writeFile(path.join(root,'outside'),'private');await fs.symlink(path.join(root,'outside'),path.join(project,'escape'));
  await assert.rejects(runner.run({op:'read',path:'escape'}),/Path leaves project/);
  const timed=await runner.run({op:'exec',command:'sleep 30',timeout_ms:150});assert.equal(timed.termination,'timeout');assert.ok(timed.duration_ms<5000);
  const huge=await runner.run({op:'exec',command:"node -e 'process.stdout.write(\"x\".repeat(100000))'",timeout_ms:5000});assert.equal(huge.termination,'output_limit');assert.ok(huge.stdout.length<=65536);
  assert.equal((await runner.run({op:'exec',command:'printf recovered',timeout_ms:5000})).stdout,'recovered');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('output-limit cleanup signals each owned process group only once',async()=>{
 const {HostRunner}=await import('../src/host-runner.mjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'styx-host-kill-once-'));
 const kill=process.kill,signals=new Map();
 process.kill=function(pid,signal){if(pid<0&&signal==='SIGKILL')signals.set(pid,(signals.get(pid)??0)+1);return kill.call(process,pid,signal);};
 try{
  const runner=new HostRunner({project:root,audit:path.join(root,'audit')});
  const receipt=await runner.run({op:'exec',command:"node -e 'process.stdout.write(\"x\".repeat(100000))'",timeout_ms:5000});
  assert.equal(receipt.termination,'output_limit');assert.equal(signals.size,1);assert.deepEqual([...signals.values()],[1]);
  assert.equal(runner.blocked,false);
 }finally{process.kill=kill;await fs.rm(root,{recursive:true,force:true});}
});
