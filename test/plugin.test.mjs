import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
const root=path.resolve(import.meta.dirname,'..');
const read=async name=>JSON.parse(await fs.readFile(path.join(root,name),'utf8'));
test('official Agent Plugins 1.0.0 manifest and MCP schemas validate OFFLINE',async()=>{
 const ajv=new Ajv2020({strict:false,allErrors:true});
 const manifestSchema=await read('schemas/plugin.schema.json');
 const mcpSchema=await read('schemas/mcp.schema.json');
 const manifest=await read('plugin.json'),mcp=await read('mcp.json');
 const validManifest=ajv.compile(manifestSchema),validMcp=ajv.compile(mcpSchema);
 assert.equal(validManifest(manifest),true,JSON.stringify(validManifest.errors));
 assert.equal(validMcp(mcp),true,JSON.stringify(validMcp.errors));
 assert.equal(manifest.$schema,'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
 assert.equal(mcp.$schema,'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
 assert.equal(Object.hasOwn(manifest,'skills'),false,'portable skills discovered by directory');
 assert.equal(Object.hasOwn(manifest,'mcpServers'),false,'portable MCP discovered by root mcp.json');
 assert.equal(mcp.mcpServers['chat-codex'].type,'streamable-http');
 assert.ok(!JSON.stringify({manifest,mcp}).includes('eyJ'),'no token-like data included');
 assert.equal(validManifest({...manifest,skills:'./skills/'}),false,'unknown portable field rejected');
 assert.equal(validMcp({...mcp,mcpServers:{bad:{type:'docker',url:'foo'}}}),false);
});
test('all three skills have valid frontmatter and no private installation configuration',async()=>{
 for(const name of ['red-green-refactor','host-vs-environment','safe-project-operations']){
  const file=await fs.readFile(path.join(root,'skills',name,'SKILL.md'),'utf8');
  assert.match(file,new RegExp('^---\\nname: '+name+'\\ndescription: [^\\n]+\\n---\\n'));
  assert.ok(file.length>250);
 }
 const ui=await fs.readFile(path.join(root,'app/home.html'),'utf8');
 assert.ok(ui.includes('Disposable Environments')&&ui.includes('Recent Tasks'));
});
