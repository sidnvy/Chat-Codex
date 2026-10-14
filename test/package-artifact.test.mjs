import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,symlink,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(import.meta.url);

test('packed artifact exposes portable Core without loading gateway dependencies',async()=>{
 const tmp=await mkdtemp(path.join(tmpdir(),'styx-package-'));
 try{
  const pack=()=>{const result=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',tmp],
   {cwd:root,encoding:'utf8',env:{...process.env,npm_config_cache:path.join(tmp,'cache')}}));
   return Array.isArray(result)?result[0]:result['chat-codex'];};
  const first=pack(),archive=path.join(tmp,first.filename),bytes=await readFile(archive);
  const second=pack();
  assert.equal(second.integrity,first.integrity,'same source produces identical local npm artifact');
  assert.deepEqual(await readFile(archive),bytes);
  const names=first.files.map(x=>x.path);
  for(const needed of ['src/desktop/core.mjs','src/desktop/contract.mjs','src/server.mjs','src/worker.mjs','scripts/setup.mjs','scripts/doctor.mjs','app/home.html','LICENSE','THIRD_PARTY.md','docs/SCHEMA-NOTICE.md'])assert.ok(names.includes(needed),needed);
  for(const name of names)assert.doesNotMatch(name,/(^|\/)(?:node_modules|test|work|outputs|private|secrets|\.git|\.github)(\/|$)|(^|\/)(?:\.env(?:\..*)?|token|config\.json|runtime-key|tunnel-authorization)$|\.(?:tgz|pem|key|log)$/);
  const consumer=path.join(tmp,'consumer'),modules=path.join(consumer,'node_modules');
  await mkdir(modules,{recursive:true});
  execFileSync('tar',['-xzf',archive,'-C',modules]);
  await symlink('package',path.join(modules,'chat-codex'));
  // Deliberately provide only Core's contract dependency, not the MCP SDK or
  // the repository node_modules. Any gateway import makes this consumer fail.
  await symlink(path.dirname(require.resolve('zod/package.json')),path.join(modules,'zod'));
  const manifest=JSON.parse(await readFile(path.join(modules,'package/package.json'),'utf8'));
  assert.deepEqual({name:manifest.name,version:manifest.version,private:manifest.private},{name:'chat-codex',version:'0.3.0',private:true});
  assert.deepEqual(manifest.exports,{'./desktop/core':'./src/desktop/core.mjs','./desktop/contract':'./src/desktop/contract.mjs'});
  await writeFile(path.join(consumer,'smoke.mjs'),`
import assert from 'node:assert/strict';
import {DesktopCore} from 'chat-codex/desktop/core';
import {DesktopError,desktopObserveSchema} from 'chat-codex/desktop/contract';
const target={kind:'host',id:'fixture'};
assert.equal(desktopObserveSchema.parse({target,mode:'windows'}).mode,'windows');
assert.equal(new DesktopError('fixture','test').code,'fixture');
let actions=0;
const core=new DesktopCore({grantForTarget:()=>({enabled:true,driver:'fixture'}),driverFactory:()=>({
 async status(){return {ready:true,session_id:'one'};},
 async observe({window_id}){return {window:{id:window_id},receipt:{window_id}};},
 async act(){actions++;return {outcome:'dispatched_unverified',verified:false};}
})});
const seen=await core.observe({target,mode:'window',window_id:'w1'});
const act={target,snapshot_id:seen.snapshot_id,action:{type:'key',key:'Return'}};
assert.equal((await core.act(act)).outcome,'dispatched_unverified');
await assert.rejects(core.act(act),e=>e.code==='unknown_snapshot');
assert.equal(actions,1);
await assert.rejects(import('chat-codex/src/server.mjs'),e=>e.code==='ERR_PACKAGE_PATH_NOT_EXPORTED');
await assert.rejects(import('@modelcontextprotocol/sdk/server/mcp.js'),e=>e.code==='ERR_MODULE_NOT_FOUND');
console.log('packed Core consumer PASS');
`);
  assert.match(execFileSync(process.execPath,['smoke.mjs'],{cwd:consumer,encoding:'utf8'}),/packed Core consumer PASS/);
  assert.match(execFileSync(process.execPath,['scripts/setup.mjs','--help'],{cwd:path.join(modules,'package'),encoding:'utf8'}),/Usage:/);
  console.log(JSON.stringify({package:first.filename,files:names.length,integrity:first.integrity,sha256:createHash('sha256').update(bytes).digest('hex')}));
 }finally{await rm(tmp,{recursive:true,force:true});}
});

test('third-party declaration inventory matches every locked dependency',async()=>{
 const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
 const notices=await readFile(new URL('../THIRD_PARTY.md',import.meta.url),'utf8');
 const rows=notices.split('\n').filter(x=>x.startsWith('| ')&&!x.startsWith('| Package '));
 const expected=Object.entries(lock.packages).filter(([name])=>name).sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,item])=>`| ${name.replace(/^node_modules\//,'')} | ${item.version} | ${item.license??'NOT DECLARED'} |`);
 assert.deepEqual(rows.sort(),expected.sort());
});
