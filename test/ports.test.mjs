import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {selectLoopbackPort} from '../src/ports.mjs';
test('automatic port choice preserves unrelated listener; explicit port refuses collision',async()=>{
 const server=createServer(socket=>socket.end('unrelated-service'));
 await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r)});
 const occupied=server.address().port;
 try{
  const selected=await selectLoopbackPort({preferred:occupied});assert.notEqual(selected,occupied);assert.ok(selected>=1024);
  assert.equal(server.listening,true);
  await assert.rejects(selectLoopbackPort({preferred:occupied,explicit:true}),{code:'port_in_use'});
  assert.equal(server.listening,true);
 }finally{await new Promise(r=>server.close(r));}
});
test('available explicit port is retained and invalid ports fail before probing',async()=>{
 for(const preferred of [0,80,65536,NaN,1.5])await assert.rejects(selectLoopbackPort({preferred}),{code:'invalid_port'});
 const port=await selectLoopbackPort();assert.equal(await selectLoopbackPort({preferred:port,explicit:true}),port);
});
