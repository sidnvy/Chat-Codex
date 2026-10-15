import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createSetup} from '../src/setup.mjs';
async function fixture(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'styx-setup-'));try{await fn(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
const opts=root=>({project:path.join(root,'project'),privateDir:path.join(root,'private'),backend:'docker',platform:'linux',uid:1000,gid:1000});
test('Docker setup pins inspected digest and keeps credentials outside project',()=>fixture(async root=>{
 const r=await createSetup({...opts(root),command:()=>JSON.stringify(['node@sha256:'+'a'.repeat(64)])});
 const config=JSON.parse(await fs.readFile(r.configFile));assert.equal(config.port,r.port);assert.ok(r.port>=1024&&r.port<=65535);assert.deepEqual(config.hosts,[]);assert.match(config.docker.image,/@sha256:a{64}$/);assert.deepEqual(await fs.readdir(r.project),[]);
 for(const f of ['config.json','token','tunnel-authorization'])assert.equal((await fs.stat(path.join(r.privateDir,f))).mode&0o777,0o600);
 assert.equal((await fs.stat(r.privateDir)).mode&0o777,0o700);
 const token=(await fs.readFile(path.join(r.privateDir,'token'),'utf8')).trim();assert.equal(token.length,43);assert.equal(await fs.readFile(path.join(r.privateDir,'tunnel-authorization'),'utf8'),'Bearer '+token+'\n');
}));
test('existing installation is preserved unchanged',()=>fixture(async root=>{
 await fs.mkdir(path.join(root,'private'));await fs.writeFile(path.join(root,'private','token'),'existing');
 await assert.rejects(createSetup({...opts(root),backend:'host'}),/existing data/);
 assert.equal(await fs.readFile(path.join(root,'private','token'),'utf8'),'existing');await assert.rejects(fs.stat(path.join(root,'project')), {code:'ENOENT'});
}));
test('Docker prerequisite failure creates no installation',()=>fixture(async root=>{
 await assert.rejects(createSetup({...opts(root),command:()=>{throw Error('private raw daemon output');}}),/Docker or its reviewed image is unavailable/);assert.deepEqual(await fs.readdir(root),[]);
}));
test('Host opt-in needs no Docker command',()=>fixture(async root=>{
 const r=await createSetup({...opts(root),backend:'host',command:()=>{throw Error('must not execute')}});const c=JSON.parse(await fs.readFile(r.configFile));assert.equal(c.hosts[0].unsandboxed,true);assert.deepEqual(c.environments,[]);
}));
test('symlink parent aliases cannot overlap setup directories',()=>fixture(async root=>{
 await fs.symlink(root,path.join(root,'alias'));await assert.rejects(createSetup({...opts(root),privateDir:path.join(root,'alias','project'),backend:'host'}),/separate new directories/);assert.deepEqual(await fs.readdir(root),['alias']);
}));
test('macOS Host setup is Docker-independent and rejects unsupported container setup before changes',()=>fixture(async root=>{
 const options={...opts(root),platform:'darwin',uid:501,gid:20,backend:'host',command:()=>{throw Error('Docker must not be invoked');}};
 await assert.rejects(createSetup({...options,backend:'both'}),/macOS setup currently supports Host only/);assert.deepEqual(await fs.readdir(root),[]);
 const result=await createSetup(options);const config=JSON.parse(await fs.readFile(result.configFile));assert.equal(config.hosts[0].unsandboxed,true);assert.deepEqual(config.environments,[]);
}));
