#!/usr/bin/env node
import {setupDesktop} from '../src/desktop/setup.mjs';
const [action='check',...args]=process.argv.slice(2),options={action};
try{
 if(action==='--help')console.log('Desktop setup: check | prepare | start --launch-access | startup --startup-access. Optional: --app-path ABS --cli-path ABS --software-access. JSON output; existing signed macOS CLI/GUI only. Missing reviewed artifacts and native login-item authorization remain explicit handoffs.');
 else{
  const values={'--app-path':'appPath','--cli-path':'cliPath'},flags={'--launch-access':'launchAccess','--software-access':'softwareAccess','--startup-access':'startupAccess'};
  for(let i=0;i<args.length;i++){const flag=args[i],key=values[flag]??flags[flag];if(!key||Object.hasOwn(options,key))throw Error();if(flags[flag])options[key]=true;else{const value=args[++i];if(!value||value.startsWith('--'))throw Error();options[key]=value;}}
  console.log(JSON.stringify(await setupDesktop(options)));
 }
}catch(e){console.log(JSON.stringify({ok:false,error:['invalid_action','desktop_launch_authorization_required','desktop_startup_authorization_required'].includes(e.code)?e.code:'desktop_setup_failed'}));process.exitCode=1;}
