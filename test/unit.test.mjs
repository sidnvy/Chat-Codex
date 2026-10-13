import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRegistry,targetSchema,pathSchema,resolveTarget} from '../src/resources.mjs';
import {TargetRouter} from '../src/router.mjs';
import {environmentContainerArgs} from '../src/docker-provider.mjs';

const config=(project)=>({
 version:2,owner_id:crypto.randomUUID(),projects:[{id:'default',path:project}],
 hosts:[{id:'local',project:'default',enabled:true,connection:'local',unsandboxed:true}],
 environments:[{id:'dev',project:'default',provider:'docker'}],
 docker:{user:'1000:1000',image:'node:22-bookworm-slim@sha256:'+'a'.repeat(64)}
});
test('strict typed target schema rejects provider override and invalid kinds',()=>{
 assert.deepEqual(targetSchema.parse({kind:'host',id:'local'}),{kind:'host',id:'local'});
 for(const t of [{kind:'runner',id:'dev'},{kind:'host',id:'dev',provider:'docker'},{kind:'environment',id:'../local'},{kind:'environment',id:''}])assert.equal(targetSchema.safeParse(t).success,false);
 for(const p of ['../private/token','/etc/passwd','foo/../../bar',''])assert.equal(pathSchema.safeParse(p).success,false);
});
test('resource registry rejects ownership bypass before invoking backend IO',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cc-unit-'));
 try{
  const proj=path.join(root,'project'),priv=path.join(root,'private');
  await fs.mkdir(proj);await fs.mkdir(priv);
  const registry=await createRegistry(config(proj),priv+'/config.json');
  const router=new TargetRouter(registry);
  let backendCalls=0;
  router.docker.run=async()=>{backendCalls++;};
  for(const target of [{kind:'environment',id:'other'},{kind:'host',id:'dev'},{kind:'environment',id:'dev',workspace:'/'},{kind:'runner',id:'dev'}]){
   await assert.rejects(router.run(target,{op:'exec',command:'true'}));
  }
  assert.equal(backendCalls,0,'no backend access for invalid identity');
  assert.throws(()=>resolveTarget(registry,{kind:'host',id:'dev'}));
  const bad=config(proj);bad.project='/';await assert.rejects(createRegistry(bad,priv+'/config.json'));
  const dup=config(proj);dup.environments.push({...dup.environments[0]});
  await assert.rejects(createRegistry(dup,priv+'/config.json'),/Duplicate/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('docker provider args enforce privilege/network/capability/socket exclusions',()=>{
 const project={path:'/tmp/safe-project'};
 const args=environmentContainerArgs(config(project.path),project,'dev','test-dev');
 const value=flag=>args[args.indexOf(flag)+1];
 assert.equal(value('--network'),'none');
 assert.equal(value('--user'),'1000:1000');
 assert.equal(value('--cap-drop'),'ALL');
 assert.equal(value('--pids-limit'),'128');
 assert.equal(value('--memory'),'512m');
 assert.equal(value('--memory-swap'),'512m');
 assert.equal(value('--cpus'),'1');
 assert.equal(value('--log-driver'),'none');
 assert.ok(args.includes('--read-only')&&args.includes('no-new-privileges'));
 assert.equal(args.filter(x=>x==='--mount').length,1);
 assert.equal(value('--mount'),'type=bind,src=/tmp/safe-project,dst=/workspace');
 assert.ok(!args.join(' ').includes('docker.sock'));
});
