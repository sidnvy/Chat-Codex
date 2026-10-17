import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {doctor} from '../../host/doctor.mjs';
import {normalizeConnector} from '../../host/connect.mjs';
import {TargetRegistry} from '../registry.mjs';

test('catalog admits only an explicit trusted outbound Host',()=>{
  const base={id:'mac',kind:'host',platform:'darwin',generation:'a1',
    cwd:'/Users/test',shell:'/bin/sh',shells:['/bin/sh'],allowed:true,
    exec:{transport:'outbound',token_file:'/tmp/styx-host-token'}};
  const r=new TargetRegistry({version:1,default_environment_id:'mac',targets:[base]});
  assert.equal(r.resolve().exec.transport,'outbound');
  assert.throws(()=>new TargetRegistry({version:1,targets:[{...base,kind:'environment'}]}),
    /outbound Host authentication/);
  assert.throws(()=>new TargetRegistry({version:1,targets:[{
    ...base,exec:{transport:'outbound',token_file:'relative'}
  }]}),/outbound Host authentication/);
});
test('Host bootstrap doctor validates token and Codex binary without deployment',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'styx-host-doctor-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const token=path.join(root,'host-token');
  await fs.writeFile(token,randomBytes(30).toString('hex'),{mode:0o600});
  const config={host_id:'fixture',gateway_ws_url:'wss://private.example',
    token_file:token,exec:{binary:process.execPath,cwd:root}};
  const out=await doctor(config);
  assert.equal(out.checks.configuration,'ok');
  assert.equal(out.checks.host_credential,'ok');
  assert.equal(out.status,'blocked');
  assert.ok(out.blockers.includes('codex_executor_unavailable'));
  assert.equal(out.checks.gateway_transport,'wss');
  assert.equal(normalizeConnector(config).endpoint,'wss://private.example/styx/hosts/fixture/exec');
  await fs.chmod(token,0o644);
  const broken=await doctor(config);
  assert.ok(broken.blockers.includes('host_credential_unavailable'));
});

test('mTLS certificate pin is an alternate Host identity, never bearer fallback',()=>{
  const pin='ab'.repeat(32);
  const base={id:'pinned',kind:'host',platform:'darwin',generation:'mtls-1',
    cwd:'/tmp',shell:'/bin/sh',shells:['/bin/sh'],allowed:true,
    exec:{transport:'outbound',client_certificate_sha256:pin}};
  const c={version:1,default_environment_id:'pinned',targets:[base]};
  assert.equal(new TargetRegistry(c).resolve().exec.client_certificate_sha256,pin);
  assert.throws(()=>new TargetRegistry({...c,targets:[{
    ...base,exec:{...base.exec,token_file:'/tmp/old-token'}
  }]}),/outbound Host authentication/);
  assert.throws(()=>new TargetRegistry({...c,targets:[{
    ...base,exec:{transport:'outbound',client_certificate_sha256:'not-sha256'}
  }]}),/outbound Host authentication/);
  const {client_certificate_sha256,...authRemoved}=base.exec;
  assert.throws(()=>new TargetRegistry({...c,targets:[{
    ...base,exec:authRemoved
  }]}),/outbound Host authentication/);
});
