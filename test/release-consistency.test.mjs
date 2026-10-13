import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('portable Plugin, Node package and live MCP server advertise the same release version',async()=>{
 const read=async f=>JSON.parse(await fs.readFile(new URL('../'+f,import.meta.url),'utf8'));
 const pkg=await read('package.json'),plugin=await read('plugin.json');
 const source=await fs.readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(pkg.version,/^\d+\.\d+\.\d+$/);
 assert.equal(plugin.version,pkg.version,'prevent manifest/package version drift');
 assert.ok(source.includes("new McpServer({name:'Chat-Codex',version:'"+pkg.version+"'})"),'MCP server version must match package');
 assert.equal(plugin.name,'chat-codex');
 assert.ok(!Object.hasOwn(plugin,'skills'),'portable manifest does not embed client-specific skills paths');
});
