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
import {localDesktopExec} from '../src/desktop/exec.mjs';
const exec=promisify(execFile);

// Native OS evidence only. The probe emits an opaque generation, never account
// names or the raw console-session UUID. Missing/malformed evidence fails closed.
export async function macOSSessionProbe(){
 if(process.platform!=='darwin'||!process.getuid?.())return {ready:false};
 try{
  const result=await localDesktopExec('python3',['-c',`
import hashlib,json,os,plistlib,subprocess
raw=subprocess.check_output(['/usr/sbin/ioreg','-n','Root','-d1','-a'],timeout=5)
if len(raw)>4194304: raise ValueError('oversized native session evidence')
d=plistlib.loads(raw)
rows=d.get('IOConsoleUsers',[]) if isinstance(d,dict) else []
active=[r for r in rows if isinstance(r,dict) and r.get('kCGSSessionOnConsoleKey') is True and r.get('kCGSessionLoginDoneKey') is True]
ready=isinstance(d,dict) and d.get('IOConsoleLocked') is False and len(active)==1
if ready:
 r=active[0]
 uid=r.get('kCGSSessionUserIDKey'); generation=r.get('CGSSessionUniqueSessionUUID'); session=r.get('kCGSSessionIDKey')
 ready=type(uid) is int and uid==os.geteuid() and isinstance(generation,str) and bool(generation) and type(session) is int
if ready:
 identity=json.dumps([uid,generation,session],separators=(',',':')).encode()
 print(json.dumps({'ready':True,'session_id':hashlib.sha256(identity).hexdigest()}))
else: print(json.dumps({'ready':False}))
`],{timeout_ms:7000});
  const proof=JSON.parse(result);
  return proof.ready===true&&/^[a-f0-9]{64}$/.test(proof.session_id)?proof:{ready:false};
 }catch{return {ready:false};}
}
export async function main(){
 assert.equal(process.platform,'darwin','Native macOS required');
 assert.equal(process.versions.node.split('.')[0],'22','Node22 required');
 assert.equal((await macOSSessionProbe()).ready,true,'Current UID must own an unlocked, logged-in console session');
 await exec('swiftc',['--version'],{timeout:10000});
 const driver=new PeekabooDesktop(localDesktopExec,macOSSessionProbe);
 const status=await driver.status();
 assert.equal(status.ready,true,'Audited Peekaboo adapter and OS permissions must be ready');
 assert.equal(typeof status.session_id,'string','Hardened session-bound Peekaboo adapter required');
 if(process.argv.includes('--preflight')){console.log(JSON.stringify({ready:true,node22:true,swift:true,native_session:true,gui_mutated:false}));return;}
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'styx-macos-acceptance-'));
 let scratch,closed,output='',deadline,expired=false;
 try{
  const target={kind:'host',id:'macos-scratch'};
  const core=new DesktopCore({grantForTarget:t=>{assert.deepEqual(t,target);if(expired)throw Error('Acceptance expired');return {enabled:true,driver:'peekaboo'};},driverFactory:()=>driver});
  const nonce=crypto.randomBytes(6).toString('hex'),title='Styx macOS Scratch '+nonce,marker='Styx-'+nonce;
  const source=path.join(temporary,'scratch.swift'),binary=path.join(temporary,'scratch');
  await fs.writeFile(source,`import AppKit
final class Scratch: NSObject, NSApplicationDelegate {
 var window: NSWindow!; var field: NSTextField!
 func applicationDidFinishLaunching(_ notification: Notification) {
  window=NSWindow(contentRect:NSRect(x:120,y:120,width:440,height:160),styleMask:[.titled,.closable],backing:.buffered,defer:false)
  window.title="${title}"
  field=NSTextField(frame:NSRect(x:20,y:90,width:400,height:28));field.setAccessibilityLabel("Styx Scratch Input")
  let button=NSButton(title:"Commit Styx Scratch",target:self,action:#selector(commit));button.frame=NSRect(x:20,y:30,width:220,height:32)
  window.contentView!.addSubview(field);window.contentView!.addSubview(button)
  window.makeKeyAndOrderFront(nil);window.makeFirstResponder(field);NSApp.activate(ignoringOtherApps:true)
 }
 @objc func commit() { FileHandle.standardOutput.write((field.stringValue+"\\n").data(using:.utf8)!);NSApp.terminate(nil) }
}
let app=NSApplication.shared;let delegate=Scratch();app.setActivationPolicy(.regular);app.delegate=delegate;app.run()
`);
  await exec('swiftc',[source,'-o',binary],{timeout:60000,maxBuffer:1048576});
  assert.equal((await macOSSessionProbe()).ready,true,'Session must still be ready before scratch creation');
  scratch=spawn(binary,[],{stdio:['ignore','pipe','ignore']});
  scratch.stdout.on('data',chunk=>{output+=chunk;if(output.length>4096)scratch.kill();});
  closed=new Promise((resolve,reject)=>{scratch.once('error',reject);scratch.once('close',resolve);});closed.catch(()=>{});
  const run=async()=>{
   let selected;
   for(let i=0;i<30;i++){
    const inventory=await core.observe({target,mode:'windows'});
    selected=inventory.windows.find(w=>String(w.pid)===String(scratch.pid)&&w.title===title&&w.title_truncated!==true);
    if(selected)break;await new Promise(resolve=>setTimeout(resolve,200));
   }
   assert.ok(selected,'Only exact owned scratch PID and title may be selected');
   const observe=()=>core.observe({target,mode:'window',window_id:selected.id});
   const seen=await observe();
   assert.equal(seen.image?.mimeType,'image/png','Real PNG capture required');
   const action={target,snapshot_id:seen.snapshot_id,action:{type:'type',text:marker}};
   assert.equal((await core.act(action)).outcome,'dispatched_unverified');
   await assert.rejects(core.act(action),e=>e.code==='unknown_snapshot');
   const fresh=await observe();
   const buttons=fresh.elements.filter(e=>e.label==='Commit Styx Scratch');assert.equal(buttons.length,1,'Owned scratch button must be unique');
   const result=await core.act({target,snapshot_id:fresh.snapshot_id,action:{type:'invoke',element_id:buttons[0].id}});
   assert.equal(result.outcome,'dispatched_unverified');
   assert.equal(await closed,0);assert.equal(output.trim(),marker);
   console.log(JSON.stringify({passed:true,authenticated_mcp:false,shared_core:true,native_macos:true,screenshot:true,replay_rejected:true,scratch_stdout_verified:true}));
  };
  await Promise.race([run(),new Promise((_,reject)=>{deadline=setTimeout(()=>{expired=true;reject(Error('macOS scratch acceptance deadline exceeded'));},60000);})]);
 }finally{
  clearTimeout(deadline);
  expired=true; // Revoke this harness admission before cleanup; no late retries.
  if(scratch?.exitCode===null){scratch.kill('SIGKILL');await closed.catch(()=>{});}
  await fs.rm(temporary,{recursive:true,force:true});
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url))await main();
