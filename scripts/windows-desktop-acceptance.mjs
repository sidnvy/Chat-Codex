// Optional Windows-only adapter acceptance. Requires an independently audited
// local session-probe module; never replaces it with a fixture or boolean true.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {DesktopCore} from '../src/desktop/core.mjs';
import {WinappDesktop} from '../src/desktop/winapp.mjs';
import {localDesktopExec} from '../src/desktop/exec.mjs';
if(process.platform!=='win32'||process.versions.node.split('.')[0]!=='22')throw Error('Run on Windows with Node22');
const modulePath=process.env.STYX_WINDOWS_PROBE_MODULE;
if(!modulePath||!path.isAbsolute(modulePath))throw Error('STYX_WINDOWS_PROBE_MODULE must name an audited local native-session proof module');
const {sessionProbe}=await import(pathToFileURL(modulePath).href);
if(typeof sessionProbe!=='function')throw Error('Audited module must export sessionProbe()');
const driver=new WinappDesktop(localDesktopExec,sessionProbe);
assert.equal((await driver.status()).ready,true,'Native interactive session proof and WinApp must be ready');
const nonce=crypto.randomBytes(6).toString('hex'),title='Styx Windows Scratch '+nonce,marker='Styx-'+nonce;
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'styx-windows-acceptance-'));
let scratch,output='',closed,timer;
try{
 const filename=path.join(directory,'scratch.ps1');
 await fs.writeFile(filename,`Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = '${title}'
$form.Width = 420
$form.Height = 160
$inputBox = New-Object System.Windows.Forms.TextBox
$inputBox.AccessibleName = 'Styx Scratch Input'
$inputBox.Width = 360
$inputBox.Left = 15
$inputBox.Top = 15
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Commit Styx Scratch'
$button.AccessibleName = 'Commit Styx Scratch'
$button.Width = 180
$button.Left = 15
$button.Top = 50
$button.Add_Click({ [Console]::WriteLine($inputBox.Text); $form.Close() })
$form.Controls.Add($inputBox)
$form.Controls.Add($button)
try { [void]$form.ShowDialog() } finally { $form.Dispose() }
`);
 scratch=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',filename],{stdio:['ignore','pipe','ignore']});
 scratch.stdout.on('data',chunk=>{output+=chunk;if(output.length>4096)scratch.kill();});
 closed=new Promise((resolve,reject)=>{scratch.once('error',reject);scratch.once('close',resolve);});closed.catch(()=>{});
 const target={kind:'host',id:'windows-scratch'};
 const core=new DesktopCore({grantForTarget:t=>{assert.deepEqual(t,target);return {enabled:true,driver:'winapp',binding_revision:nonce};},driverFactory:()=>driver});
 const run=async()=>{
  let selected;
  for(let i=0;i<40;i++){
   const inventory=await core.observe({target,mode:'windows'});
   selected=inventory.windows.find(w=>w.pid===String(scratch.pid)&&w.title===title);
   if(selected)break;
   await new Promise(resolve=>setTimeout(resolve,150));
  }
  assert.ok(selected,'Only the newly created scratch PID/title may be selected');
  const seen=await core.observe({target,mode:'window',window_id:selected.id});
  const field=seen.elements.filter(e=>e.role==='Edit'&&e.label==='Styx Scratch Input');
  assert.equal(field.length,1,'Scratch edit field must be unique');
  const typed=await core.act({target,snapshot_id:seen.snapshot_id,action:{type:'set_value',element_id:field[0].id,value:marker}});
  assert.equal(typed.verified,false);
  await assert.rejects(core.act({target,snapshot_id:seen.snapshot_id,action:{type:'set_value',element_id:field[0].id,value:'replay'}}),e=>e.code==='unknown_snapshot');
  const fresh=await core.observe({target,mode:'window',window_id:selected.id});
  const buttons=fresh.elements.filter(e=>e.role==='Button'&&e.label==='Commit Styx Scratch');assert.equal(buttons.length,1);
  const invoked=await core.act({target,snapshot_id:fresh.snapshot_id,action:{type:'invoke',element_id:buttons[0].id}});assert.equal(invoked.verified,false);
  assert.equal(await closed,0);assert.equal(output.trim(),marker);
  console.log(JSON.stringify({passed:true,native_windows_adapter:true,shared_core:true,snapshot_replay_rejected:true,scratch_stdout_verified:true,authenticated_mcp:false,screenshot_tested:false}));
 };
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Scratch acceptance exceeded 30 seconds')),30000);});
 await Promise.race([run(),deadline]);
}finally{
 clearTimeout(timer);
 if(scratch?.exitCode===null){scratch.kill();await closed.catch(()=>{});}
 await fs.rm(directory,{recursive:true,force:true});
}
