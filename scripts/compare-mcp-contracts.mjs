#!/usr/bin/env node
// Compare two local, sanitized MCP tools/list snapshots; never connects to a
// private server, prints credentials or requires a Charon source dependency.
import fs from 'node:fs/promises';
import {compareToolSurfaces} from '../src/contracts/tool-surface.mjs';
const usage='Usage: node scripts/compare-mcp-contracts.mjs --left <snapshot.json> --right <snapshot.json> [--json]';
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){console.log(usage);process.exit(0);}
const input={};
let valid=true;
for(let i=0;i<args.length;i++){
 const arg=args[i];
 if(arg==='--json'){
  if(input.json)valid=false;
  input.json=true;
 }else if(arg==='--left'||arg==='--right'){
  const field=arg.slice(2),value=args[++i];
  if(input[field]||!value||value.startsWith('--'))valid=false;
  else input[field]=value;
 }else valid=false;
}
if(!valid||!input.left||!input.right){
 console.error(usage);process.exit(2);
}
try{
 const read=async file=>{
  const meta=await fs.stat(file);
  if(!meta.isFile()||meta.size>2*1024*1024)throw Error('Invalid or oversized snapshot');
  return JSON.parse(await fs.readFile(file,'utf8'));
 };
 const result=compareToolSurfaces(await read(input.left),await read(input.right));
 if(input.json)process.stdout.write(JSON.stringify(result,null,2)+'\n');
 else{
  console.log(result.compatible_structure?'Tool surfaces structurally identical':'Tool surface differences detected');
  console.log('Shared: '+result.summary.shared+', changed: '+result.summary.changed+
   ', only left: '+result.summary.only_left+', only right: '+result.summary.only_right);
  for(const group of result.differences){
   console.log('  '+group.name+': '+group.changes.length+(group.truncated?'+':'')+' changed paths');
   for(const change of group.changes)console.log('    '+change.path+' ('+change.difference+')');
  }
  for(const name of result.only_left)console.log('  left only: '+name);
  for(const name of result.only_right)console.log('  right only: '+name);
  console.log('Structural equality does not certify identical authorization, results or side effects.');
 }
 process.exitCode=result.compatible_structure?0:1;
}catch{
 console.error('Could not parse a valid sanitized MCP tool contract snapshot.');
 process.exitCode=2;
}
