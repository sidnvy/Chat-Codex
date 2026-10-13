import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopConfigSchema} from '../src/desktop/contract.mjs';
import {DesktopDriverCatalog,createBuiltInDesktopCatalog} from '../src/desktop/drivers.mjs';
import {DesktopManager} from '../src/desktop/manager.mjs';
test('portable Desktop driver schema allows audited third-party driver names, not arbitrary commands',()=>{
 assert.equal(desktopConfigSchema.parse({enabled:true,driver:'gnome-remote'}).driver,'gnome-remote');
 assert.equal(desktopConfigSchema.parse({enabled:true,driver:'kde-plasma'}).driver,'kde-plasma');
 for(const name of ['../../bin/sh','evil module','/tmp/driver','WINAPP','','x'.repeat(70)])
  assert.equal(desktopConfigSchema.safeParse({enabled:true,driver:name}).success,false);
});
test('installer catalog is opt-in, rejects unknown or duplicate names and never evals config',async()=>{
 const catalog=new DesktopDriverCatalog();
 let created=0,observed=0;
 const factory=()=>{created++;return {
  async status(){return {ready:true,state:'ready',driver:'test-driver',capabilities:['windows']};},
  async observe(){observed++;return {driver:'test-driver',windows:[]};},
  async act(){return {verified:false,outcome:'dispatched_unverified'};}
 };};
 catalog.register('test-driver',factory);
 assert.throws(()=>catalog.register('test-driver',factory),/already registered/);
 assert.throws(()=>catalog.create('unavailable'),/No trusted/);
 const target={kind:'host',id:'local'};
 const registry={projects:new Map([['p',{id:'p',path:'/tmp/p'}]]),
  hosts:new Map([['local',{id:'local',project:'p',capabilities:{desktop:{enabled:true,driver:'test-driver'}}}]]),
  environments:new Map()};
 const manager=new DesktopManager(registry,{catalog});
 assert.equal((await manager.status(target)).ready,true);
 assert.equal((await manager.observe({target,mode:'windows'})).windows.length,0);
 assert.equal(created,1);assert.equal(observed,1);
 const disabled=new DesktopManager({...registry,hosts:new Map([['local',{id:'local',project:'p',capabilities:{desktop:{enabled:true,driver:'not-installed'}}}]])},{catalog});
 assert.equal((await disabled.status(target)).state,'driver_unavailable');
 assert.equal(createBuiltInDesktopCatalog('linux').list().join(','),'hyprland');
});
