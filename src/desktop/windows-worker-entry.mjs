import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {win32} from 'node:path';
import {WinappDesktop} from './winapp.mjs';
import {createWindowsNativeProbe} from './windows-native.mjs';
import {DesktopError} from './primitives.mjs';
const options=__STYX_WINDOWS_WORKER_OPTIONS__;
const exec=promisify(execFile),end=Date.now()+options.timeoutMs,controller=new AbortController();
let dispatched=false,expired=false,winappPath;
const fail=code=>{throw new DesktopError(code,'Windows worker refused request');};
const allowed=new Set(['driver_unavailable','no_interactive_desktop','session_unverified','stale_session','stale_target','target_not_found','invalid_window','invalid_capture','invalid_snapshot','invalid_payload','unsupported_action','timeout']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function keys(v,names){if(!plain(v)||Object.keys(v).some(k=>!names.includes(k)))fail('invalid_payload');}
async function request(){
 const chunks=[];let size=0;
 for await(const chunk of process.stdin){size+=chunk.length;if(size>65536)fail('invalid_payload');chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('invalid_payload');}
}
async function installation(){
 const dir=win32.dirname(winappPath);
 for(const [file,expected] of [[winappPath,options.winappSha256],[win32.join(dir,'libHarfBuzzSharp.dll'),options.harfbuzzSha256],[win32.join(dir,'libSkiaSharp.dll'),options.skiaSha256]]){
  const s=await stat(file);if(!s.isFile()||s.size<1||s.size>268435456)fail('driver_unavailable');
  const hash=createHash('sha256');for await(const bytes of createReadStream(file)){if(Date.now()>=end)fail('timeout');hash.update(bytes);}
  if(hash.digest('hex')!==expected)fail('driver_unavailable');
 }
}
async function run(binary,args){
 if(expired||Date.now()>=end)fail('timeout');
 if(binary!=='winapp'&&binary!=='powershell.exe')fail('unsupported_action');
 if(binary==='winapp'&&['invoke','set-value'].includes(args[1]))dispatched=true;
 try{return (await exec(binary==='winapp'?winappPath:binary,args,{encoding:'utf8',windowsHide:true,...(binary==='winapp'?{env:{...process.env,WINAPP_CLI_TELEMETRY_OPTOUT:'1'}}:{}),timeout:Math.max(1,end-Date.now()),maxBuffer:2097152,signal:controller.signal})).stdout;}
 catch(e){fail(expired||e.killed?'timeout':'driver_unavailable');}
}
async function main(){
 const req=await request();keys(req,['operation','window_id','window','receipt','action','title']);
 if(!['status','windows','window','act'].includes(req.operation))fail('invalid_payload');
 if(req.title!==undefined&&(typeof req.title!=='string'||!req.title||req.title.length>128))fail('invalid_payload');
 if(req.operation==='act'){
  keys(req.action,['type','element_id','value']);
  if(!['invoke','set_value'].includes(req.action.type)||!/^elem_[0-9]{1,2}$/.test(req.action.element_id))fail('unsupported_action');
  if(!plain(req.receipt)||!plain(req.window)||req.receipt.hwnd!==req.window.id||!Array.isArray(req.receipt.selector_map)||req.receipt.selector_map.length>100)fail('invalid_snapshot');
  if(req.action.type==='set_value'&&(typeof req.action.value!=='string'||req.action.value.length>500||/^[-@]/.test(req.action.value)||req.action.value.includes('\0')))fail('unsupported_action');
 }
 if(process.platform!=='win32'||Number(process.versions.node.split('.')[0])<22)fail('driver_unavailable');
 const args=process.argv.slice(2);
 if(args.length!==2||args[0]!=='--winapp-path'||!/^[A-Za-z]:[\\/]/.test(args[1])||args[1].length>240||/[\0\r\n]/.test(args[1]))fail('driver_unavailable');
 winappPath=args[1];
 await installation();
 const native=createWindowsNativeProbe(run);
 const driver=new WinappDesktop(run,native.session,{windowProbe:native.window,captureProbe:native.capture});
 if(req.operation==='status'){
  const s=await driver.status();return {driver:'winapp',ready:s.ready===true,state:s.ready?'ready':allowed.has(s.state)?s.state:'session_unverified',...(s.session_id?{session_id:s.session_id}:{}),capabilities:s.ready?['windows','window_screenshot','accessibility','element_invoke','element_set_value']:[]};
 }
 await driver.session();
 if(req.operation==='windows'){
  const inventory=await driver.observe({mode:'windows'}),output=[];let incomplete=inventory.truncated;
  for(const w of inventory.windows){
   if(req.title!==undefined&&w.title!==req.title)continue;
   try{const proof=await native.window(w.hwnd);if(proof.pid!==w.pid)fail('stale_target');if(req.title!==undefined&&proof.title!==req.title)continue;output.push({...w,title:proof.title.slice(0,128),title_truncated:proof.title.length>128});}
   catch{incomplete=true;}
  }
  return {...inventory,windows:output,truncated:incomplete};
 }
 if(req.operation==='window'){
  const observed=await driver.observe({mode:'window',window_id:req.window_id});
  const selectors=observed.elements.map(e=>e.id);
  if(Buffer.byteLength(JSON.stringify({...observed.receipt,selector_map:selectors}))>60000)fail('invalid_capture');
  return {...observed,elements:observed.elements.map((e,i)=>({...e,id:'elem_'+i})),receipt:{...observed.receipt,selector_map:selectors}};
 }
 const index=Number(req.action.element_id.slice(5)),selector=req.receipt.selector_map[index];
 if(typeof selector!=='string'||!req.receipt.element_ids?.includes(selector))fail('invalid_snapshot');
 return driver.act(req.receipt,{...req.action,element_id:selector});
}
const timer=setTimeout(()=>{expired=true;controller.abort();process.stdin.destroy(new Error('timeout'));},options.timeoutMs);
try{
 const result=await main();if(expired)fail('timeout');
 const output=JSON.stringify({ok:true,result});if(Buffer.byteLength(output)>2097152)fail('invalid_capture');process.stdout.write(output+'\n');
}catch(e){
 if(dispatched)process.stdout.write(JSON.stringify({ok:true,result:{driver:'winapp',outcome:'outcome_unknown',verified:false}})+'\n');
 else{process.stdout.write(JSON.stringify({ok:false,error:allowed.has(e.code)?e.code:'driver_unavailable'})+'\n');process.exitCode=1;}
}finally{clearTimeout(timer);controller.abort();}
