import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

/** Process inspection is not permission to signal: compare start identity AND command. */
export async function processIdentity(pid,{platform=process.platform,readFile=fs.readFile,command=execFileSync,alive=id=>{try{process.kill(id,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}}}={}){
 if(!Number.isInteger(pid)||pid<=0)throw Error('process_identity_unconfirmed');
 try{
  if(platform==='linux'){
   const stat=await readFile('/proc/'+pid+'/stat','utf8');
   const started=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
   if(!/^\d+$/.test(started))throw Error();
   return {started,args:(await readFile('/proc/'+pid+'/cmdline','utf8')).split('\0')};
  }
  if(platform==='darwin'){
   const ps=field=>command('/bin/ps',['-ww','-p',String(pid),'-o',field+'='],{encoding:'utf8',timeout:2000,maxBuffer:65536,env:{...process.env,LC_ALL:'C'},stdio:['ignore','pipe','pipe']}).trim();
   const started=ps('lstart'),executable=ps('comm'),commandLine=ps('command');
   if(!started||!executable||!commandLine||ps('lstart')!==started)throw Error();
   return {started:'darwin:'+started,executable,commandLine};
  }
  throw Error();
 }catch{
  if(!alive(pid))return null;
  throw Error('process_identity_unconfirmed');
 }
}
export function matchesProcess(identity,expected){
 if(!identity||!Array.isArray(expected)||expected.some(v=>typeof v!=='string'||/[\0\r\n]/.test(v)))return false;
 if(identity.args){const args=[...identity.args];if(args.at(-1)==='')args.pop();return JSON.stringify(args)===JSON.stringify(expected);}
 return identity.executable===expected[0]&&identity.commandLine===expected.join(' ');
}
export const localPlatform=platform=>platform==='darwin'?'macos':platform;
