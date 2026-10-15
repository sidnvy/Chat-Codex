#!/usr/bin/env node
// Private child process receipt permits recovery if the installing agent exits.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {start} from '../src/server.mjs';
import {processIdentity} from '../src/onboarding-process.mjs';
try{
 const config=process.argv[2],dir=path.dirname(config);
 const identity=await processIdentity(process.pid);if(!identity)throw Error();
 const nonce=process.argv[3];if(nonce&&!/^[a-f0-9-]{36}$/.test(nonce))throw Error();
 const receipt={pid:process.pid,started:identity.started,...(nonce?{nonce}:{})};
 const temp=path.join(dir,'.process-'+crypto.randomUUID());
 await fs.writeFile(temp,JSON.stringify(receipt),{flag:'wx',mode:0o600});await fs.rename(temp,path.join(dir,'server-process.json'));
 const {server}=await start(config);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.closeAllConnections();server.close();setTimeout(()=>process.exit(0),70000).unref();});
}catch{process.stderr.write('Styx server could not start. Check private configuration and port availability.\n');process.exitCode=1;}
