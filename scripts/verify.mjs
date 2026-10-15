#!/usr/bin/env node
import {verifyInstallation} from '../src/onboarding-verifier.mjs';
const args=process.argv.slice(2),usage='Usage: npm run verify -- [--config /absolute/private/config.json] [--sandbox] [--json]';
if(args.includes('--help')){console.log(usage+'\nConnection mode is read-only. --sandbox creates and removes a separate owned Docker environment, project and server; it never provisions configured targets.');process.exit(0);}
let configFile=process.env.CHAT_CODEX_CONFIG,sandbox=false,json=false;
for(let i=0;i<args.length;i++){if(args[i]==='--config'&&args[i+1]&&!args[i+1].startsWith('--'))configFile=args[++i];else if(args[i]==='--sandbox')sandbox=true;else if(args[i]==='--json')json=true;else{console.error(usage);process.exit(2);}}
const controller=new AbortController();const interrupted=()=>controller.abort();process.on('SIGINT',interrupted);process.on('SIGTERM',interrupted);
try{const r=await verifyInstallation({configFile,sandbox,signal:controller.signal});console.log(json?JSON.stringify(r):'Styx first-run verification: '+(r.passed?'passed':'failed')+'\n'+JSON.stringify(r,null,2));process.exitCode=r.passed?0:1;}catch{console.error('Verification could not complete safely.');process.exitCode=1;}finally{process.removeListener('SIGINT',interrupted);process.removeListener('SIGTERM',interrupted);}
