import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:net';
import {start} from '../src/server.mjs';
import {createSetup} from '../src/setup.mjs';
import {verifyInstallation,trackLifecycle} from '../src/onboarding-verifier.mjs';
const supported=['linux','darwin'].includes(process.platform)&&process.getuid?.()>0;
async function fixture(fn){
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'styx-verifier-test-'));let instance;
 try{
  const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const {configFile}=await createSetup({project:path.join(tmp,'project'),privateDir:path.join(tmp,'private'),backend:'host',port});
  await fs.writeFile(path.join(tmp,'project','untouched'),'user data');
  instance=await start(configFile);await fn({tmp,configFile,instance});
 }finally{if(instance){instance.server.closeAllConnections();await new Promise(r=>instance.server.close(r));}await fs.rm(tmp,{recursive:true,force:true});}
}
test('verifier authenticates actual MCP read-only and preserves configured data',{skip:!supported},async()=>fixture(async({tmp,configFile})=>{
 const result=await verifyInstallation({configFile});assert.equal(result.passed,true);assert.equal(result.connection,'verified');assert.equal(result.sandbox,'not_checked');assert.equal(result.chatgpt_account,'not_checked');assert.equal(result.desktop,'not_checked');assert.equal(await fs.readFile(path.join(tmp,'project','untouched'),'utf8'),'user data');assert.deepEqual(await fs.readdir(path.join(tmp,'project')),['untouched']);
}));
test('wrong configured token cannot be mistaken for verified connection and is not leaked',{skip:!supported},async()=>fixture(async({configFile})=>{
 const token='a'.repeat(43);await fs.writeFile(path.join(path.dirname(configFile),'token'),token);const result=await verifyInstallation({configFile});assert.equal(result.passed,false);assert.equal(result.connection,'not_checked');assert.equal(result.failure.phase,'configured_connection');assert.ok(!JSON.stringify(result).includes(token));assert.ok(!JSON.stringify(result).includes(configFile));
}));
test('symbolic credential files fail before connection',{skip:!supported},async()=>fixture(async({tmp,configFile})=>{
 const file=path.join(path.dirname(configFile),'token');await fs.rename(file,path.join(tmp,'real-token'));await fs.symlink(path.join(tmp,'real-token'),file);const result=await verifyInstallation({configFile});assert.equal(result.passed,false);assert.equal(result.connection,'not_checked');
}));
test('missing configuration and no explicit sandbox is a sanitized failure',async()=>{
 const result=await verifyInstallation();assert.equal(result.passed,false);assert.equal(result.failure.phase,'arguments');assert.equal(result.cleanup,'not_needed');
});
test('real Docker first-run sandbox owns its server and cleans lifecycle and data',{skip:process.env.STYX_VERIFY_DOCKER!=='1'||process.platform!=='linux'||!supported,timeout:180000},async()=>{
 const root=await fs.mkdtemp(path.join(process.env.TEST_TMP_ROOT??os.tmpdir(),'styx-verifier-docker-test-'));try{const result=await verifyInstallation({sandbox:true,scratchRoot:root});assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.connection,'not_checked');assert.equal(result.sandbox,'verified');assert.equal(result.cleanup,'verified');assert.equal(result.sandbox_evidence.project_retained,true);assert.deepEqual(await fs.readdir(root),[]);}finally{if((await fs.readdir(root)).length===0)await fs.rmdir(root);}
});
test('interruption before provisioning performs no sandbox work',async()=>{
 const controller=new AbortController();controller.abort();const result=await verifyInstallation({sandbox:true,signal:controller.signal});assert.equal(result.passed,false);assert.equal(result.failure.code,'interrupted');assert.equal(result.cleanup,'not_needed');
});

test('final read-only response after deadline cannot report verified',{skip:!supported},async()=>fixture(async({configFile,instance})=>{
 const original=instance.router.projectsList.bind(instance.router);
 instance.router.projectsList=async()=>{await new Promise(r=>setTimeout(r,200));return original();};
 const result=await verifyInstallation({configFile,deadlineMs:100});assert.equal(result.passed,false);assert.equal(result.connection,'not_checked');assert.equal(result.failure.code,'deadline_exceeded');
}));
test('owned lifecycle barrier waits for late create even after caller stops waiting',async()=>{
 let release,created=false;const router={lifecycle:()=>new Promise(r=>{release=()=>{created=true;r();};})};
 const settle=trackLifecycle(router);const work=router.lifecycle('create','dev');await Promise.resolve();
 assert.equal(await settle(10),false);assert.equal(created,false);
 release();assert.equal(await settle(100),true);await work;assert.equal(created,true);
});
test('owned lifecycle barrier also settles rejected provider work',async()=>{
 const router={lifecycle:async()=>{throw Error('provider failed');}};const settle=trackLifecycle(router);
 await assert.rejects(router.lifecycle('create','dev'));assert.equal(await settle(100),true);
});
