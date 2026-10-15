import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuiltInDesktopCatalog} from '../src/desktop/drivers.mjs';
import {macOSSessionProbe} from '../src/desktop/macos-session.mjs';
import {localDesktopExec} from '../src/desktop/exec.mjs';
test('built-in macOS catalog wires the trusted native console-session probe',async()=>{
 const driver=createBuiltInDesktopCatalog('darwin').create('peekaboo');
 assert.equal(driver.sessionProbe,macOSSessionProbe);assert.equal(driver.run,localDesktopExec);
 // Permission success alone never makes a non-macOS session ready.
 if(process.platform!=='darwin'){
  driver.run=async()=>JSON.stringify({success:true,data:{permissions:[{name:'Screen Recording',isGranted:true},{name:'Accessibility',isGranted:true}]}});
  const status=await driver.status();assert.equal(status.ready,false);assert.equal(status.state,'session_unverified');
 }
});
