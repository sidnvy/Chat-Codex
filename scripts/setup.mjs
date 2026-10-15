#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import {createInterface} from 'node:readline/promises';
import {createSetup} from '../src/setup.mjs';
const usage='Usage: npm run setup -- [/absolute/new-project /absolute/new-private-dir] [--backend docker|host|both] [--port 8791]\nNo arguments starts guided setup in an interactive terminal. Docker is the default.';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
async function main(){
 const args=process.argv.slice(2);
 if(args.includes('--help')||args.includes('-h')){console.log(usage);return;}
 let project,privateDir,backend='docker',port=8791;
 if(!args.length){
  if(!process.stdin.isTTY)throw Error('Guided setup requires a terminal. Supply two absolute new directory paths, or use --help.');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  try{
   console.log('Styx first-run setup (Linux). No existing files are overwritten.');
   console.log('Docker isolates development commands. Host access runs with your full user permissions.');
   backend=(await rl.question('Backend [docker / host / both] (docker): ')).trim()||'docker';
   if(!['docker','host','both'].includes(backend))throw Error('Choose docker, host or both.');
   if(backend!=='docker'&&(await rl.question('Enable unsandboxed same-user Host access? Type yes: ')).trim()!=='yes')throw Error('Host setup cancelled.');
   project=(await rl.question('New Project directory ('+path.join(os.homedir(),'styx-project')+'): ')).trim()||path.join(os.homedir(),'styx-project');
   privateDir=(await rl.question('New private configuration directory ('+path.join(os.homedir(),'.styx-private')+'): ')).trim()||path.join(os.homedir(),'.styx-private');
   const answer=(await rl.question('Loopback port (8791): ')).trim();if(answer)port=Number(answer);
  }finally{rl.close();}
 }else{
  [project,privateDir]=args.splice(0,2);
  const seen=new Set();
  while(args.length){const flag=args.shift(),value=args.shift();if(!['--backend','--port'].includes(flag)||!value||seen.has(flag))throw Error(usage);seen.add(flag);if(flag==='--backend')backend=value;else port=Number(value);}
 }
 const result=await createSetup({project,privateDir,backend,port});
 console.log('Configuration created: '+result.configFile);
 if(backend!=='docker')console.log('Host access enabled explicitly: UNSANDBOXED, same-user filesystem and network.');
 console.log('Desktop is disabled. No Environment has been created or started.');
 console.log('Next, in this terminal:\n  export CHAT_CODEX_CONFIG='+quote(result.configFile)+'\n  npm run doctor\n  npm start');
 console.log('In another terminal in this checkout:\n  npm run verify -- --config '+quote(result.configFile)+(backend==='host'?'':' --sandbox'));
 console.log('Keep token files private. Client authorization and a secure MCP endpoint are separate steps; see docs/ONBOARDING.md.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
