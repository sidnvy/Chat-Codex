import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DesktopError} from './primitives.mjs';
const exec=promisify(execFile);
export async function localDesktopExec(executable,args=[],options={}){
 if(!Array.isArray(args)||args.some(x=>typeof x!=='string'))throw new DesktopError('invalid_argument','Executable arguments must be strings');
 try{
  const r=await exec(executable,args,{encoding:'utf8',timeout:options.timeout_ms??10000,maxBuffer:4194304,windowsHide:true});
  return r.stdout;
 }catch(e){
  const detail=String(e.stderr||e.message).slice(0,350);
  throw new DesktopError(e.code==='ENOENT'?'driver_unavailable':e.killed?'timeout':'driver_error',executable+': '+detail);
 }
}
export function parseCommandJson(data,backend){
 try{return JSON.parse(data);}catch{throw new DesktopError('invalid_driver_response',backend+' returned invalid JSON');}
}
