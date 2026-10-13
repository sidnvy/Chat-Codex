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
