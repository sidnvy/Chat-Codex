// Opt-in native Windows acceptance. No installs, policy changes, unlock or fallback.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {DesktopCore} from '../src/desktop/core.mjs';
import {WinappDesktop} from '../src/desktop/winapp.mjs';
import {DesktopError} from '../src/desktop/contract.mjs';
import {createWindowsSessionProbe} from './lib/windows-session.mjs';
const exec=promisify(execFile);
let phase='startup';
const started=Date.now();
const mark=value=>{phase=value;console.log(JSON.stringify({phase,elapsed_ms:Date.now()-started}));};
// Diagnostics reveal only fixed field names, value types and comparison booleans.
export function nativeResultMetadata(text,args=[]){
 try{
  const result=JSON.parse(text),code=result?.error?.code??result?.code;
  const metadata=['element_not_found','stale_element','invalid_arguments','internal_error','no_interactive_desktop','no_target','ambiguous_selector','target_moved'].includes(code)?{native_error_code:code}:{};
  if(!['invoke','set-value'].includes(args[1]))return metadata;
  const type=value=>value===null?'null':Array.isArray(value)?'array':typeof value;
  const names=['elementId','element_id','hwnd','HWND','pattern','requestedAction','performedAction','success','data','error'];
  const fields=value=>value&&typeof value==='object'?names.filter(key=>Object.hasOwn(value,key)):[];
  const selected=result?.data??result;
  const hwnd=selected?.hwnd,expected=args[args.indexOf('-w')+1];
  const exactHwnd=typeof hwnd==='string'?hwnd:typeof hwnd==='number'&&Number.isSafeInteger(hwnd)?String(hwnd):null;
  const summary={top_level_fields:fields(result),data_fields:fields(result?.data),
   hwnd_type:type(hwnd),hwnd_matches_requested:exactHwnd!==null&&exactHwnd===expected,
   element_id_type:type(selected?.elementId),element_id_matches_requested:selected?.elementId===args[2]};
  const patterns=['InvokePattern','TogglePattern','SelectionItemPattern','ExpandCollapsePattern','ValuePattern'];
  const actions=['invoke','toggle','select','expand','collapse','auto'];
  if(patterns.includes(selected?.pattern))summary.pattern=selected.pattern;
  if(actions.includes(selected?.requestedAction))summary.requested_action=selected.requestedAction;
  if(actions.includes(selected?.performedAction))summary.performed_action=selected.performedAction;
  return {...metadata,native_result:summary};
 }catch{return {};}
}
const actionMetadata=result=>({outcome:['dispatched_unverified','outcome_unknown'].includes(result?.outcome)?result.outcome:'unrecognized',verified:result?.verified===true?true:result?.verified===false?false:'unrecognized'});
export async function main(){
 assert.equal(process.platform,'win32','Native Windows required');
 assert.equal(process.versions.node.split('.')[0],'22','Node22 required');
 const controller=new AbortController(),inflight=new Set();

 const run=(command,args,options={})=>{
  const category=command==='powershell.exe'?'session_probe':['list-windows','inspect','search','invoke','set-value'].includes(args[1])?args[1]:'other';
  const began=Date.now();console.log(JSON.stringify({category,event:'start'}));
  const task=exec(command,args,{encoding:'utf8',timeout:options.timeout_ms??10000,maxBuffer:4194304,windowsHide:true,signal:controller.signal})
   .then(r=>{console.log(JSON.stringify({category,event:'result',exit_code:0,...nativeResultMetadata(r.stdout,args)}));return r.stdout;})
   .catch(e=>{console.log(JSON.stringify({category,event:'failure',exit_code:Number.isInteger(e.code)?e.code:undefined,...nativeResultMetadata(e.stdout??'',args)}));throw new DesktopError(e.code==='ENOENT'?'driver_unavailable':e.killed?'timeout':'driver_error','Native command failed');})
   .finally(()=>{inflight.delete(task);console.log(JSON.stringify({category,event:'settled',elapsed_ms:Date.now()-began}));});
  inflight.add(task);return task;
 };
 const sessionProbe=createWindowsSessionProbe(run);
 const driver=new WinappDesktop(run,sessionProbe);
 mark('preflight');
 assert.equal((await driver.status()).ready,true,'Native console proof and public WinApp must be ready');
 if(process.argv.includes('--preflight')){console.log(JSON.stringify({ready:true,node22:true,native_console:true,winapp:true,gui_mutated:false}));return;}
 const authenticated=process.argv.includes('--gateway');
 const nonce=crypto.randomBytes(6).toString('hex'),title='Styx Windows Scratch '+nonce,marker='Styx-'+nonce;
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'styx-windows-acceptance-'));
 let scratch,output='',closed,timer,expired=false,client,gateway;
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
$button.Add_Click({ $button.Enabled = $false; $button.Text = 'Committed Styx Scratch'; $inputBox.ReadOnly = $true; [Console]::WriteLine($inputBox.Text) })
$form.Controls.Add($inputBox)
$form.Controls.Add($button)
try { [void]$form.ShowDialog() } finally { $form.Dispose() }
`);
 assert.equal((await sessionProbe()).ready,true,'Native console must remain ready before scratch creation');
 mark('scratch-launch');
 scratch=spawn('powershell.exe',['-NoProfile','-NonInteractive','-STA','-File',filename],{stdio:['ignore','pipe','ignore']});
 let signalOutput;const observedOutput=new Promise(resolve=>{signalOutput=resolve;});
 scratch.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n'))signalOutput();if(output.length>4096)scratch.kill();});
 closed=new Promise((resolve,reject)=>{scratch.once('error',reject);scratch.once('close',resolve);});closed.catch(()=>{});
 const target={kind:'host',id:'windows-scratch'};
 const composition={grantForTarget:t=>{assert.deepEqual(t,target);if(expired)throw Error('Acceptance expired');return {enabled:true,driver:'winapp',binding_revision:nonce};},driverFactory:()=>driver};
 let core=new DesktopCore(composition);
 const flow=async()=>{
  if(authenticated){
   mark('gateway-connect');
   const [{startDesktopGateway},{Client},{StreamableHTTPClientTransport}]=await Promise.all([
    import('../src/desktop/gateway.mjs'),import('@modelcontextprotocol/sdk/client/index.js'),import('@modelcontextprotocol/sdk/client/streamableHttp.js')]);
   const token=crypto.randomBytes(32).toString('base64url');gateway=await startDesktopGateway({token,...composition});
   const url=new URL('http://127.0.0.1:'+gateway.port+'/mcp');
   assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,401);
   assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer wrong'},body:'{}'})).status,401);
   client=new Client({name:'styx-windows-scratch',version:'1'},{capabilities:{}});
   await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'Bearer '+token}}}));
   assert.deepEqual((await client.listTools()).tools.map(t=>t.name).sort(),['target_desktop_act','target_desktop_observe','target_desktop_status','target_desktop_wait']);
   const call=async(name,args)=>{const r=await client.callTool({name,arguments:args},undefined,{timeout:90000});assert.ok(!r.isError,'Desktop MCP call failed');return r.structuredContent;};
   core={observe:args=>call('target_desktop_observe',args),act:args=>call('target_desktop_act',args)};
  }
  let selected;
  for(let i=0;i<40;i++){
   mark('window-discovery');
   const inventory=await core.observe({target,mode:'windows'});
   selected=inventory.windows.find(w=>w.pid===String(scratch.pid)&&w.title===title&&w.title_truncated!==true);
   if(selected)break;await new Promise(resolve=>setTimeout(resolve,150));
  }
  assert.ok(selected,'Only the owned scratch PID/title may be selected');
  const observe=()=>core.observe({target,mode:'window',window_id:selected.id});
  mark('initial-observe');
  const seen=await observe();
  const fields=seen.elements.filter(e=>e.role==='Edit'&&e.label==='Styx Scratch Input');assert.equal(fields.length,1,'Scratch edit field must be unique');
  const action={target,snapshot_id:seen.snapshot_id,action:{type:'set_value',element_id:fields[0].id,value:marker}};
  mark('set-value');
  const typed=await core.act(action);console.log(JSON.stringify({phase,event:'core-result',...actionMetadata(typed)}));assert.equal(typed.outcome,'dispatched_unverified');assert.equal(typed.verified,false);
  mark('replay-rejection');
  if(client){const replay=await client.callTool({name:'target_desktop_act',arguments:action});assert.equal(replay.isError,true);assert.equal(replay.content.find(c=>c.type==='text')?.text,'Snapshot does not belong to this target');}
  else await assert.rejects(core.act(action),e=>e.code==='unknown_snapshot');
  mark('verification-observe');
  const fresh=await observe();
  const buttons=fresh.elements.filter(e=>e.role==='Button'&&e.label==='Commit Styx Scratch');assert.equal(buttons.length,1,'Scratch button must be unique');
  mark('invoke');
  const invoked=await core.act({target,snapshot_id:fresh.snapshot_id,action:{type:'invoke',element_id:buttons[0].id}});
  console.log(JSON.stringify({phase,event:'core-result',...actionMetadata(invoked)}));
  assert.equal(invoked.verified,false);
  mark('stdout-verification');
  let oracleTimer;
  try{await Promise.race([observedOutput,new Promise((_,reject)=>{oracleTimer=setTimeout(()=>reject(Error('Scratch output unavailable')),3000);})]);}
  finally{clearTimeout(oracleTimer);}
  assert.equal(output.trim(),marker);assert.equal(scratch.exitCode,null,'Scratch must stay alive through native verification');
  console.log(JSON.stringify({independently_verified_effect:true,scratch_stdout_verified:true,action_outcome:invoked.outcome}));
  assert.equal(invoked.outcome,'dispatched_unverified');
  console.log(JSON.stringify({passed:true,native_windows_adapter:true,shared_core:true,snapshot_replay_rejected:true,scratch_stdout_verified:true,authenticated_mcp:authenticated,screenshot_tested:false}));
 };
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;controller.abort();reject(Error('Scratch acceptance exceeded 90 seconds'));},90000);});
 await Promise.race([flow(),deadline,closed.then(()=>{throw Error('Scratch exited before verification');})]);
 }finally{
  clearTimeout(timer);expired=true;controller.abort();await Promise.allSettled([...inflight]);
  if(client)await client.close().catch(()=>{});
  if(gateway){gateway.server.closeAllConnections();await new Promise(resolve=>gateway.server.close(resolve));}
  if(scratch?.exitCode===null){scratch.kill();await closed.catch(()=>{});}
  await fs.rm(directory,{recursive:true,force:true});
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(()=>{console.error(JSON.stringify({passed:false,phase,reason:'native_acceptance_failed'}));process.exitCode=1;});
