import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRegistry} from '../src/resources.mjs';
import {TargetRouter} from '../src/router.mjs';
import {DesktopManager} from '../src/desktop/manager.mjs';

test('Host identity stays stable while desktop grant and readiness remain independent',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cc-capabilities-'));
 const project=path.join(root,'project'),privateDir=path.join(root,'private');
 await fs.mkdir(project);await fs.mkdir(privateDir);
 const configFile=path.join(privateDir,'config.json');
 const config={version:2,owner_id:crypto.randomUUID(),
  projects:[{id:'default',path:project}],environments:[],hosts:[
   {id:'headless',project:'default',enabled:true,connection:'local',unsandboxed:true},
   {id:'graphical',project:'default',enabled:true,connection:'local',unsandboxed:true,
    capabilities:{desktop:{enabled:true,driver:'third-party-desktop'}}}
  ]};
 try{
  const registry=await createRegistry(config,configFile);
  const router=new TargetRouter(registry);
  const hosts=router.hostsList();
  assert.equal(hosts.length,2);
  assert.equal(hosts[0].connection,'connected');
  assert.equal(hosts[0].capabilities.exec.enabled,true);
  assert.equal(hosts[0].capabilities.desktop.enabled,false);
  assert.equal(hosts[1].capabilities.desktop.enabled,true);
  assert.equal(hosts[1].capabilities.desktop.driver,'third-party-desktop');
  assert.equal((await router.status({kind:'host',id:'headless'})).kind,'host');
  assert.equal((await router.status({kind:'host',id:'graphical'})).kind,'host');
  const desktopManager=new DesktopManager(registry);
  const unavailable=await desktopManager.status({kind:'host',id:'graphical'});
  assert.equal(unavailable.state,'driver_unavailable');
  assert.equal(unavailable.ready,false,'grant does not mean a usable session');
  const disabled=await desktopManager.status({kind:'host',id:'headless'});
  assert.equal(disabled.state,'desktop_not_enabled');
  assert.equal(disabled.ready,false);
  const legacy=structuredClone(config);
  legacy.hosts[0].desktop={enabled:true,driver:'hyprland'};
  await assert.rejects(createRegistry(legacy,configFile),'top-level host desktop must be rejected');
  const bad=structuredClone(config);
  bad.hosts[0].capabilities={desktop:{enabled:true,driver:'hyprland'},provider:'ssh'};
  await assert.rejects(createRegistry(bad,configFile),'backend field in capabilities must be rejected');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
