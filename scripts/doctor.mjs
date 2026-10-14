#!/usr/bin/env node
import {runDoctor} from '../src/doctor.mjs';

const args=process.argv.slice(2);
const json=args.includes('--json');
const help=args.includes('--help')||args.includes('-h');
const value=args.indexOf('--config');
if(help){
 console.log('Usage: npm run doctor -- [--json] [--config /absolute/private/config.json]');
 console.log('Read-only diagnostics. Does not print credentials or install/modify dependencies.');
 process.exit(0);
}
if(args.some((arg,i)=>!['--json','--config'].includes(arg)&&!(value>=0&&i===value+1))||
 (value!==-1&&(!args[value+1]||args[value+1].startsWith('--')))||
 args.filter(arg=>arg==='--config').length>1){
 console.error('Usage: npm run doctor -- [--json] [--config /absolute/private/config.json]');
 process.exit(2);
}
try{
 const report=await runDoctor({...(value<0?{}:{configFile:args[value+1]})});
 if(json)console.log(JSON.stringify(report,null,2));
 else{
  console.log('Chat-Codex doctor (read-only)');
  for(const c of report.checks){
   console.log('['+c.status.toUpperCase()+'] '+c.id+': '+c.message);
   if(c.next)console.log('  Next: '+c.next);
  }
  console.log('Overall: '+report.overall.toUpperCase());
  console.log('This does not verify external ChatGPT installation or authorization.');
 }
 process.exitCode=report.overall==='ready'?0:report.overall==='action_required'?2:3;
}catch{
 console.error('Doctor could not complete. Re-run with a supported configuration and check project installation.');
 process.exitCode=3;
}