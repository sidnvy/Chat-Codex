import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {selectBackend,createRunner} from '../src/backends.mjs';
import {Runner} from '../src/runner.mjs';
import {HostRunner} from '../src/host-runner.mjs';

test('backend defaults to Docker and rejects all unknown values',()=>{
  assert.equal(selectBackend({}),'docker');
  assert.equal(selectBackend({backend:'docker'}),'docker');
  assert.equal(selectBackend({backend:'host'}),'host');
  assert.ok(createRunner({}) instanceof Runner);
  for(const backend of [null,'','auto','HOST',false,0])assert.throws(()=>createRunner({backend}),/backend must/);
});

test('host setup and execution work without Docker; ordinary descendants are cleaned',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'chat-codex-host-check-'));
  try {
    const project=path.join(tmp,'project'),priv=path.join(tmp,'private');
    // Empty PATH proves setup does not need a Docker executable.
    execFileSync(process.execPath,[new URL('../scripts/setup.mjs',import.meta.url).pathname,project,priv,'--backend','host'],{env:{PATH:''},stdio:'pipe'});
    const config=JSON.parse(await fs.readFile(path.join(priv,'config.json'),'utf8'));
    assert.equal(config.backend,'host');assert.equal(config.image,undefined);
    for(const backend of ['auto','HOST','']) {
      const badProject=path.join(tmp,'invalid-project'),badPrivate=path.join(tmp,'invalid-private');
      assert.throws(()=>execFileSync(process.execPath,[new URL('../scripts/setup.mjs',import.meta.url).pathname,badProject,badPrivate,'--backend',backend],{env:{PATH:''},stdio:'pipe'}));
      await assert.rejects(fs.stat(badProject),{code:'ENOENT'});
    }
    const runner=createRunner({...config,audit:path.join(priv,'audit.jsonl')});
    assert.ok(runner instanceof HostRunner);
    const run=command=>runner.run({op:'exec',command,timeout_ms:1000});
    const home=await run('printf "%s" "$HOME"');
    await assert.rejects(fs.stat(home.stdout),{code:'ENOENT'});
    // The short-lived parent exits; its background child must not outlive it.
    const bg=await run('(sleep 3; printf escaped > marker) & printf done');
    assert.equal(bg.stdout,'done');assert.equal(bg.exit_code,0);
    const timed=await run('(sleep 3; printf escaped > timeout-marker) & sleep 30');
    assert.equal(timed.termination,'timeout');
    const flood=await run('(sleep 3; printf escaped > flood-marker) & node -e "for(;;)process.stdout.write(\'x\'.repeat(8192))"');
    assert.equal(flood.termination,'output_limit');assert.ok(Buffer.byteLength(flood.stdout)<=65536);
    await new Promise(r=>setTimeout(r,2200));
    for(const file of ['marker','timeout-marker','flood-marker'])await assert.rejects(fs.stat(path.join(project,file)),{code:'ENOENT'});
    assert.equal((await run('printf alive')).stdout,'alive');
  } finally {await fs.rm(tmp,{recursive:true,force:true});}
});

test('Docker failure never falls back to host',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'chat-codex-no-fallback-'));
  const previous=process.env.PATH;
  try {
    process.env.PATH='';
    const runner=createRunner({project:tmp,user:'1000:1000',image:'node:22-bookworm-slim',audit:path.join(tmp,'audit.jsonl')});
    await assert.rejects(runner.run({op:'write',path:'must-not-exist',content:'x'}));
    await assert.rejects(fs.stat(path.join(tmp,'must-not-exist')),{code:'ENOENT'});
  } finally {process.env.PATH=previous;await fs.rm(tmp,{recursive:true,force:true});}
});
