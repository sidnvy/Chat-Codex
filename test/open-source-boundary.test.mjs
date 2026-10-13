import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const forbidden=[
 {label:'private LAN address',pattern:/\b10\.0\.\d{1,3}\.\d{1,3}\b/},
 {label:'developer checkout path',pattern:/\/home\/[a-z0-9_-]+\/Developer\//i},
 {label:'personal macOS home path',pattern:/\/Users\/[a-z0-9_-]+\/(?:Library|Documents|Desktop)\//i},
 {label:'installed Plugin release ID',pattern:/\bpluginrel_[a-z0-9]{12,}\b/},
 {label:'installed private Plugin ID',pattern:/\bplugins_[a-z0-9]{12,}\b/}
];
async function collect(dir){
 const out=[];
 for(const entry of await fs.readdir(new URL(dir,root),{withFileTypes:true})){
  const p=dir+entry.name;
  if(entry.isDirectory())out.push(...await collect(p+'/'));
  else if(entry.isFile()&&/\.(?:mjs|js|md|json|ps1|html)$/.test(entry.name))out.push(p);
 }
 return out;
}
test('portable source excludes local machine paths, private network addresses and installed plugin IDs',async()=>{
 const files=[...await collect('src/'),...await collect('docs/'),...await collect('scripts/'),'README.md','VALIDATION.md','plugin.json','mcp.json'];
 for(const file of files){
  const text=await fs.readFile(new URL(file,root),'utf8');
  for(const rule of forbidden)assert.equal(rule.pattern.test(text),false,file+': '+rule.label);
 }
});
