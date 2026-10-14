// Embedded by the fixed-graph factory. Never imported as a package entry point.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {HyprlandDesktop} from './hyprland.mjs';
import {DesktopError} from './primitives.mjs';
const options=__STYX_WORKER_OPTIONS__;
const exec=promisify(execFile),controller=new AbortController();
const end=Date.now()+options.timeoutMs;
let dispatched=false,expired=false,receiptExpiry;
const allowed=new Set(['locked','no_session','session_unverified','permission_denied','driver_unavailable','stale_target','target_not_found','unsupported_action','invalid_window','invalid_capture','invalid_payload','invalid_text','invalid_key','invalid_snapshot','invalid_operation','timeout']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function keys(value,expected){if(!plain(value)||Object.keys(value).some(k=>!expected.includes(k)))throw new DesktopError('invalid_payload','Invalid input');}
const publicWindow=w=>{const {workspace,...rest}=w;return rest;};
async function run(binary,args){
 if(expired||Date.now()>=end)throw new DesktopError('timeout','Deadline elapsed');
 if(!['hyprctl','grim','wtype'].includes(binary))throw new DesktopError('unsupported_action','Unsupported command');
 if(binary==='wtype'){
  if(!Number.isSafeInteger(receiptExpiry)||Date.now()>=receiptExpiry)throw new DesktopError('invalid_snapshot','Expired receipt');
  dispatched=true;
 }
 try{return (await exec(binary,args,{encoding:'utf8',timeout:Math.max(1,end-Date.now()),killSignal:'SIGKILL',maxBuffer:4194304,signal:controller.signal})).stdout;}
 catch(e){throw new DesktopError(expired||e.killed?'timeout':e.code==='ENOENT'?'driver_unavailable':'driver_error','Native command failed');}
}
async function main(){
 const raw=process.argv.at(-1);
 if(typeof raw!=='string'||raw.length>8192||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))throw new DesktopError('invalid_payload','Invalid input');
 const bytes=Buffer.from(raw,'base64');
 if(bytes.toString('base64')!==raw)throw new DesktopError('invalid_payload','Invalid encoding');
 let req;try{req=JSON.parse(bytes.toString('utf8'));}catch{throw new DesktopError('invalid_payload','Invalid JSON');}
 keys(req,['operation','window_id','window','receipt','action','title']);
 if(!['status','windows','window','act'].includes(req.operation))throw new DesktopError('invalid_operation','Unsupported operation');
 if(req.operation==='act'){
  if(!plain(req.receipt)||!plain(req.window)||req.receipt.window_id!==req.window.id)throw new DesktopError('stale_target','Receipt mismatch');
  if(!Number.isSafeInteger(req.receipt.observed_at)||req.receipt.observed_at>Date.now()||Date.now()-req.receipt.observed_at>=30000)throw new DesktopError('invalid_snapshot','Expired receipt');
  receiptExpiry=req.receipt.observed_at+30000;
  const a=req.action;
  if(a?.type==='type'){
   keys(a,['type','text']);if(typeof a.text!=='string'||a.text.length<1||a.text.length>500||a.text.includes('\0'))throw new DesktopError('invalid_text','Invalid text');
  }else if(a?.type==='key'){
   keys(a,['type','key']);if(typeof a.key!=='string'||!/^(Return|Escape|Tab|BackSpace|space|[A-Za-z0-9])$/.test(a.key))throw new DesktopError('invalid_key','Invalid key');
  }else throw new DesktopError('unsupported_action','Unsupported action');
 }
 const driver=new HyprlandDesktop(run);
 if(req.operation==='status'){
  const s=await driver.status();
  return {driver:'hyprland',ready:s.ready===true,state:allowed.has(s.state)||s.state==='ready'?s.state:'session_unverified',
   ...(s.session_id?{session_id:s.session_id}:{}),capabilities:s.ready?['windows','window_screenshot','keyboard']:[],...(s.monitors?{monitors:s.monitors}:{})};
 }
 const status=await driver.status();
 if(!status.ready)throw new DesktopError(status.state,'Desktop not ready');
 if(req.operation==='windows'){
  const observed=await driver.observe({mode:'windows'});
  return {...observed,windows:observed.windows.map(publicWindow)};
 }
 if(req.operation==='window'){
  if(typeof req.window_id!=='string'||req.window_id.length<1||req.window_id.length>128)throw new DesktopError('invalid_window','Invalid window');
  const observed=await driver.observe({mode:'window',window_id:req.window_id});
  const image=Buffer.from(observed.image?.data??'','base64');
  if(image.length>options.maxImageBytes||!image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new DesktopError('invalid_capture','Invalid capture');
  return {...observed,receipt:{...observed.receipt,observed_at:Date.now()},window:publicWindow(observed.window)};
 }
 if(req.operation==='act'){
  if(!plain(req.receipt)||!plain(req.window)||req.receipt.window_id!==req.window.id)throw new DesktopError('stale_target','Receipt mismatch');
  return await driver.act(req.receipt,req.action);
 }
 throw new DesktopError('invalid_operation','Unsupported operation');
}
const timer=setTimeout(()=>{expired=true;controller.abort();},options.timeoutMs);
try{
 const result=await main();
 if(expired)throw new DesktopError('timeout','Deadline elapsed');
 const encoded=JSON.stringify({ok:true,result});
 if(Buffer.byteLength(encoded)>2097152)throw new DesktopError('invalid_capture','Output limit exceeded');
 process.stdout.write(encoded+'\n');
}catch(e){
 if(dispatched)process.stdout.write(JSON.stringify({ok:true,result:{driver:'hyprland',outcome:'outcome_unknown',verified:false}})+'\n');
 else{process.stdout.write(JSON.stringify({ok:false,error:allowed.has(e.code)?e.code:'driver_unavailable'})+'\n');process.exitCode=1;}
}finally{clearTimeout(timer);controller.abort();}
