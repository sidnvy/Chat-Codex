import {createServer} from 'node:net';

// Availability is a point-in-time probe, not a reservation until the server starts.
// Never signal or inspect an unrelated listener to reclaim its port.
export async function selectLoopbackPort({preferred=8791,explicit=false}={}){
 if(!Number.isInteger(preferred)||preferred<1024||preferred>65535)throw Object.assign(Error('invalid_port'),{code:'invalid_port'});
 const probe=port=>new Promise((resolve,reject)=>{
  const server=createServer();
  server.once('error',reject);
  server.listen({host:'127.0.0.1',port,exclusive:true},()=>{const selected=server.address().port;server.close(error=>error?reject(error):resolve(selected));});
 });
 try{return await probe(preferred);}catch(error){
  if(error.code!=='EADDRINUSE')throw error;
  if(explicit)throw Object.assign(Error('Requested port is occupied. Choose another port; do not stop the existing service.'),{code:'port_in_use'});
  return probe(0);
 }
}
