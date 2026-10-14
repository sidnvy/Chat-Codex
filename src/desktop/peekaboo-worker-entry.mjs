// Fixed-graph, one-shot protocol for the canonical native macOS adapter.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {PeekabooDesktop} from './peekaboo.mjs';
import {macOSSessionProbe} from './macos-session.mjs';
import {DesktopError} from './primitives.mjs';
const options=__STYX_WORKER_OPTIONS__;
const exec=promisify(execFile),controller=new AbortController(),inflight=new Set();
const end=Date.now()+options.timeoutMs;
let expired=false,dispatched=false,receiptExpiry;
const allowed=new Set(['locked','no_session','session_unverified','permission_denied','driver_unavailable','stale_target','target_not_found','unsupported_action','invalid_window','invalid_capture','invalid_payload','invalid_snapshot','invalid_operation','timeout']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function keys(v,allowed){if(!plain(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw new DesktopError('invalid_payload','Invalid input');}
async function run(binary,args,config={}){
 if(expired||Date.now()>=end)throw new DesktopError('timeout','Deadline elapsed');
 if(!['peekaboo','python3'].includes(binary))throw new DesktopError('unsupported_action','Unsupported command');
 if(binary==='peekaboo'&&args[0]==='click'){
  if(!Number.isSafeInteger(receiptExpiry)||Date.now()>=receiptExpiry)throw new DesktopError('invalid_snapshot','Expired receipt');
  dispatched=true;
 }
 const task=exec(binary,args,{encoding:'utf8',timeout:Math.max(1,Math.min(config.timeout_ms??10000,end-Date.now())),killSignal:'SIGKILL',maxBuffer:4194304,signal:controller.signal});
 inflight.add(task);
 try{return (await task).stdout;}
 catch(e){throw new DesktopError(expired||e.killed?'timeout':e.code==='ENOENT'?'driver_unavailable':'driver_error','Native command failed');}
 finally{inflight.delete(task);}
}
async function main(){
 const raw=process.argv.at(-1);
 if(typeof raw!=='string'||raw.length>8192||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))throw new DesktopError('invalid_payload','Invalid input');
 const bytes=Buffer.from(raw,'base64');if(bytes.toString('base64')!==raw)throw new DesktopError('invalid_payload','Invalid encoding');
 let req;try{req=JSON.parse(bytes.toString('utf8'));}catch{throw new DesktopError('invalid_payload','Invalid JSON');}
 keys(req,['operation','window_id','window','receipt','action','title']);
 if(!['status','windows','window','act'].includes(req.operation))throw new DesktopError('invalid_operation','Unsupported operation');
 if(req.operation==='act'){
  if(!plain(req.receipt)||!plain(req.window)||req.receipt.window_id!==req.window.id||
   !Number.isSafeInteger(req.receipt.pid)||req.receipt.pid<=0||req.window.pid!==req.receipt.pid||
   typeof req.receipt.title!=='string'||req.window.title!==req.receipt.title.slice(0,128))throw new DesktopError('stale_target','Receipt mismatch');
  if(!Number.isSafeInteger(req.receipt.observed_at)||req.receipt.observed_at>Date.now()||Date.now()-req.receipt.observed_at>=30000)throw new DesktopError('invalid_snapshot','Expired receipt');
  receiptExpiry=req.receipt.observed_at+30000;
  keys(req.action,['type','element_id']);
  if(req.action.type!=='invoke')throw new DesktopError('unsupported_action','Only observed element invocation is exposed');
  if(!/^elem_[0-9]{1,16}$/.test(req.action.element_id??'')||!req.receipt.element_ids?.includes(req.action.element_id))throw new DesktopError('stale_target','Unobserved element');
 }
 const driver=new PeekabooDesktop(run,()=>macOSSessionProbe(run));
 if(req.operation==='status'){
  const s=await driver.status();
  return {driver:'peekaboo',ready:s.ready===true,state:allowed.has(s.state)||s.state==='ready'?s.state:'session_unverified',
   ...(s.session_id?{session_id:s.session_id}:{}),capabilities:s.ready?['windows','window_screenshot','accessibility','element_invoke']:[]};
 }
 if(req.operation==='windows')return await driver.observe({mode:'windows'});
 if(req.operation==='window'){
  if(typeof req.window_id!=='string'||! /^[1-9][0-9]{0,15}$/.test(req.window_id))throw new DesktopError('invalid_window','Invalid window');
  const observed=await driver.observe({mode:'window',window_id:req.window_id});
  const image=Buffer.from(observed.image?.data??'','base64');
  if(image.length<100||image.length>options.maxImageBytes||!image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new DesktopError('invalid_capture','Invalid capture');
  return observed;
 }
 return await driver.act(req.receipt,req.action);
}
const timer=setTimeout(()=>{expired=true;controller.abort();},options.timeoutMs);
try{
 const result=await main();if(expired)throw new DesktopError('timeout','Deadline elapsed');
 const output=JSON.stringify({ok:true,result});if(Buffer.byteLength(output)>2097152)throw new DesktopError('invalid_capture','Output too large');
 process.stdout.write(output+'\n');
}catch(e){
 if(dispatched)process.stdout.write(JSON.stringify({ok:true,result:{driver:'peekaboo',outcome:'outcome_unknown',verified:false}})+'\n');
 else{process.stdout.write(JSON.stringify({ok:false,error:allowed.has(e.code)?e.code:'driver_unavailable'})+'\n');process.exitCode=1;}
}finally{clearTimeout(timer);controller.abort();await Promise.allSettled([...inflight]);}
