// Opt-in native scratch acceptance; never changes TCC, lock state, or installed tools.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {DesktopCore} from '../src/desktop/core.mjs';
import {PeekabooDesktop} from '../src/desktop/peekaboo.mjs';
import {DesktopError} from '../src/desktop/contract.mjs';
const exec=promisify(execFile);

import {macOSSessionProbe} from '../src/desktop/macos-session.mjs';
export {macOSSessionProbe} from '../src/desktop/macos-session.mjs';
export async function main(){
 assert.equal(process.platform,'darwin','Native macOS required');
 assert.equal(process.versions.node.split('.')[0],'22','Node22 required');
 assert.equal((await macOSSessionProbe()).ready,true,'Current UID must own an unlocked, logged-in console session');
 await exec('swiftc',['--version'],{timeout:10000});
 const controller=new AbortController(),inflight=new Set();
 let completedCommands=0;
 const nativeMetadata=text=>{
  const result={};
  try{
   const envelope=JSON.parse(text),code=envelope.error?.code,outcome=envelope.outcome;
   if(typeof envelope.success==='boolean')result.success=envelope.success;
   if(typeof code==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(code))result.native_error_code=code;
   const states=['confirmed_change','confirmed_no_change','partial','dispatched_unverified','suspected_noop','refused','indeterminate'];
   if(states.includes(outcome?.state))result.outcome_state=outcome.state;
   if(states.includes(outcome?.status))result.outcome_status=outcome.status;
   if(['none','dispatched','not_dispatched','possibly_dispatched','unknown'].includes(outcome?.dispatch_state))result.dispatch_state=outcome.dispatch_state;
   for(const key of ['mutation_dispatched','retry_safe','requires_fresh_observation'])if(typeof outcome?.[key]==='boolean')result[key]=outcome[key];
  }catch{}
  return result;
 };
 const tracedExec=(command,args=[],options={})=>{
  const started=Date.now(),category=['app','window','permissions','see','type','press','click'].includes(args[0])?args[0]:'other';
  console.log(JSON.stringify({command:path.basename(command),category,event:'start'}));
  const task=exec(command,args,{encoding:'utf8',timeout:options.timeout_ms??10000,maxBuffer:4194304,signal:controller.signal,killSignal:'SIGKILL'})
   .then(result=>{completedCommands++;console.log(JSON.stringify({command:path.basename(command),category,event:'result',...nativeMetadata(result.stdout)}));return result.stdout;})
   .catch(error=>{
    console.log(JSON.stringify({command:path.basename(command),category,event:'failure',exit_code:Number.isInteger(error.code)?error.code:undefined,...nativeMetadata(error.stdout??'')}));
    throw new DesktopError(error.code==='ENOENT'?'driver_unavailable':error.killed?'timeout':'driver_error','Native command failed');
   })
   .finally(()=>{inflight.delete(task);console.log(JSON.stringify({command:path.basename(command),category,event:'settled',elapsed_ms:Date.now()-started}));});
  inflight.add(task);return task;
 };
 const driver=new PeekabooDesktop(tracedExec,macOSSessionProbe);
 const status=await driver.status();
 assert.equal(status.ready,true,'Audited Peekaboo adapter and OS permissions must be ready');
 assert.equal(typeof status.session_id,'string','Hardened session-bound Peekaboo adapter required');
 if(process.argv.includes('--inventory-preflight')){
  const started=Date.now(),timer=setTimeout(()=>controller.abort(),180000);
  try{const inventory=await driver.observe({mode:'windows'});console.log(JSON.stringify({ready:true,inventory_preflight:true,elapsed_ms:Date.now()-started,completed_commands:completedCommands,window_count:inventory.windows.length,gui_mutated:false}));}
  finally{clearTimeout(timer);controller.abort();await Promise.allSettled([...inflight]);}
  return;
 }
 if(process.argv.includes('--preflight')){console.log(JSON.stringify({ready:true,node22:true,swift:true,native_session:true,gui_mutated:false}));return;}
 const timeout=process.argv.includes('--slow-inventory')?180000:60000;
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'styx-macos-acceptance-'));
 let scratch,closed,output='',deadline,expired=false,gateway,client;
 const authenticated=process.argv.includes('--gateway');
 const started=Date.now();let phase='prepare';
 const mark=name=>{phase=name;console.log(JSON.stringify({phase,elapsed_ms:Date.now()-started}));};
 try{
  const target={kind:'host',id:'macos-scratch'};
  const composition={grantForTarget:t=>{assert.deepEqual(t,target);if(expired)throw Error('Acceptance expired');return {enabled:true,driver:'peekaboo'};},driverFactory:()=>driver};
  let core=new DesktopCore(composition);
  if(authenticated){
   const [{startDesktopGateway},{Client},{StreamableHTTPClientTransport}]=await Promise.all([
    import('../src/desktop/gateway.mjs'),import('@modelcontextprotocol/sdk/client/index.js'),import('@modelcontextprotocol/sdk/client/streamableHttp.js')]);
   const token=crypto.randomBytes(32).toString('base64url');
   gateway=await startDesktopGateway({token,...composition});
   const url=new URL('http://127.0.0.1:'+gateway.port+'/mcp');
   assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,401);
   assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer invalid'},body:'{}'})).status,401);
   client=new Client({name:'styx-macos-scratch',version:'1.0.0'},{capabilities:{}});
   await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'Bearer '+token}}}));
   assert.deepEqual((await client.listTools()).tools.map(t=>t.name).sort(),['target_desktop_act','target_desktop_observe','target_desktop_status','target_desktop_wait']);
   const call=async(name,args)=>{const result=await client.callTool({name,arguments:args},undefined,{timeout:180000});assert.ok(!result.isError,'Desktop MCP call failed');return result;};
   core={
    async observe(args){const result=await call('target_desktop_observe',args);const image=result.content.find(c=>c.type==='image');return {...result.structuredContent,...(image?{image:{mimeType:image.mimeType,data:image.data}}:{})};},
    async act(args){return (await call('target_desktop_act',args)).structuredContent;}
   };
  }
  const nonce=crypto.randomBytes(6).toString('hex'),title='Styx macOS Scratch '+nonce,marker='Styx-'+nonce;
  const source=path.join(temporary,'scratch.swift'),binary=path.join(temporary,'scratch');
  await fs.writeFile(source,`import AppKit
final class Scratch: NSObject, NSApplicationDelegate {
 var window: NSWindow!; var field: NSTextField!; var button: NSButton!
 func applicationDidFinishLaunching(_ notification: Notification) {
  window=NSWindow(contentRect:NSRect(x:120,y:120,width:440,height:160),styleMask:[.titled,.closable],backing:.buffered,defer:false)
  window.title="${title}"
  field=NSTextField(frame:NSRect(x:20,y:90,width:400,height:28));field.setAccessibilityLabel("Styx Scratch Input")
  button=NSButton(title:"Commit Styx Scratch",target:self,action:#selector(commit));button.frame=NSRect(x:20,y:30,width:220,height:32)
  window.contentView!.addSubview(field);window.contentView!.addSubview(button)
  window.makeKeyAndOrderFront(nil);window.makeFirstResponder(field);NSApp.activate(ignoringOtherApps:true)
 }
 @objc func commit() { button.title="Committed Styx Scratch";button.isEnabled=false;field.isEditable=false;FileHandle.standardOutput.write((field.stringValue+"\\n").data(using:.utf8)!) }
}
let app=NSApplication.shared;let delegate=Scratch();app.setActivationPolicy(.regular);app.delegate=delegate;app.run()
`);
  mark('compile');
  await exec('swiftc',[source,'-o',binary],{timeout:60000,maxBuffer:1048576});
  assert.equal((await macOSSessionProbe()).ready,true,'Session must still be ready before scratch creation');
  mark('scratch-launch');
  scratch=spawn(binary,[],{stdio:['ignore','pipe','ignore']});
  let signalOutput;const observedOutput=new Promise(resolve=>{signalOutput=resolve;});
  scratch.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n'))signalOutput();if(output.length>4096)scratch.kill();});
  closed=new Promise((resolve,reject)=>{scratch.once('error',reject);scratch.once('close',resolve);});closed.catch(()=>{});
  const run=async()=>{
   let selected;
   for(let i=0;i<30;i++){
    mark('window-discovery');
    const inventory=await core.observe({target,mode:'windows'});
    selected=inventory.windows.find(w=>String(w.pid)===String(scratch.pid)&&w.title===title&&w.title_truncated!==true);
    if(selected)break;await new Promise(resolve=>setTimeout(resolve,200));
   }
   assert.ok(selected,'Only exact owned scratch PID and title may be selected');
   const observe=()=>core.observe({target,mode:'window',window_id:selected.id});
   mark('initial-capture');
   const seen=await observe();
   assert.equal(seen.image?.mimeType,'image/png','Real PNG capture required');
   const action={target,snapshot_id:seen.snapshot_id,action:{type:'type',text:marker}};
   mark('type-dispatch');
   const typed=await core.act(action);assert.equal(typed.outcome,'dispatched_unverified');assert.equal(typed.verified,false);
   mark('replay-rejection');
   if(client){const replay=await client.callTool({name:'target_desktop_act',arguments:action});assert.equal(replay.isError,true);assert.equal(replay.content.find(c=>c.type==='text')?.text,'Snapshot does not belong to this target');}
   else await assert.rejects(core.act(action),e=>e.code==='unknown_snapshot');
   mark('verification-capture');
   const fresh=await observe();
   const buttons=fresh.elements.filter(e=>e.label==='Commit Styx Scratch');assert.equal(buttons.length,1,'Owned scratch button must be unique');
   mark('button-dispatch');
   const result=await core.act({target,snapshot_id:fresh.snapshot_id,action:{type:'invoke',element_id:buttons[0].id}});
   assert.equal(result.verified,false);
   mark('stdout-verification');
   await observedOutput;assert.equal(output.trim(),marker);assert.equal(scratch.exitCode,null,'Scratch remains alive through native receipt verification');
   console.log(JSON.stringify({independently_verified_effect:true,scratch_stdout_verified:true,scratch_kept_alive:true,action_outcome:result.outcome}));
   assert.equal(result.outcome,'dispatched_unverified');
   console.log(JSON.stringify({passed:true,authenticated_mcp:authenticated,shared_core:true,native_macos:true,screenshot:true,replay_rejected:true,scratch_stdout_verified:true}));
  };
  await Promise.race([run(),new Promise((_,reject)=>{deadline=setTimeout(()=>{expired=true;reject(Error('macOS scratch acceptance deadline exceeded'));},timeout);})]);
 }catch(error){
  console.error(JSON.stringify({passed:false,phase,elapsed_ms:Date.now()-started,authenticated_mcp:authenticated}));
  throw error;
 }finally{
  clearTimeout(deadline);
  expired=true; // Revoke admission, abort native children, and await settlement.
  controller.abort();
  await Promise.allSettled([...inflight]);
  if(client)await client.close().catch(()=>{});
  if(gateway){gateway.server.closeAllConnections();await new Promise(resolve=>gateway.server.close(resolve));}
  if(scratch?.exitCode===null){scratch.kill('SIGKILL');await closed.catch(()=>{});}
  await fs.rm(temporary,{recursive:true,force:true});
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url))await main();
