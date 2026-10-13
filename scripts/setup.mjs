import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {validateHost} from '../src/backends.mjs';

const args=process.argv.slice(2);
const usage='Usage: npm run setup -- /absolute/new-project /absolute/new-private-dir [--backend docker|host|both]. Docker is the safe default; host is explicit, UNSANDBOXED.';
if(args.includes('--help')){console.log(usage);process.exit(0);}
const [projectArg,privateArg,flag,backendArg]=args;
if(args.length!==2&&!(args.length===4&&flag==='--backend'))throw Error(usage);
const backend=backendArg??'docker';
if(!['docker','host','both'].includes(backend))throw Error(usage);
if(!projectArg||!privateArg||!path.isAbsolute(projectArg)||!path.isAbsolute(privateArg))throw Error('Use absolute paths');
const project=path.resolve(projectArg),priv=path.resolve(privateArg);
if(priv===project||priv.startsWith(project+path.sep)||project.startsWith(priv+path.sep)||project==='/')throw Error('Project and private config must be separate');
const uid=process.getuid?.(),gid=process.getgid?.();
if(process.platform!=='linux'||!uid||gid===undefined)throw Error('Only non-root Linux users supported');
if(backend!=='docker'){
 validateHost();
 console.warn('UNSANDBOXED HOST: commands can access the same-user filesystem, credentials and network.');
}
const dockerEnabled=backend!=='host';
let image;
if(dockerEnabled){
 const digest=JSON.parse(execFileSync('docker',['image','inspect','node:22-bookworm-slim','--format','{{json .RepoDigests}}'],{encoding:'utf8'})).find(x=>x.startsWith('node@sha256:'));
 if(!digest)throw Error('Pull reviewed official node:22-bookworm-slim image first');
 image='node:22-bookworm-slim@'+digest.split('@')[1];
}
await fs.mkdir(project,{mode:0o700});
await fs.mkdir(priv,{mode:0o700});
const token=crypto.randomBytes(32).toString('base64url');
await fs.writeFile(path.join(priv,'token'),token+'\n',{mode:0o600,flag:'wx'});
await fs.writeFile(path.join(priv,'tunnel-authorization'),'Bearer '+token+'\n',{mode:0o600,flag:'wx'});
const config={
 version:2,owner_id:crypto.randomUUID(),port:8791,
 projects:[{id:'default',path:project}],
 hosts:backend==='docker'?[]:[{id:'local',project:'default',enabled:true,connection:'local',unsandboxed:true}],
 environments:dockerEnabled?[{id:'dev',project:'default',provider:'docker'}]:[],
 ...(dockerEnabled?{docker:{user:uid+':'+gid,image}}:{})
};
await fs.writeFile(path.join(priv,'config.json'),JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log('Chat-Codex v2 configuration created: '+path.join(priv,'config.json'));
console.log('Host is never automatically enabled when backend=docker; environment dev must be created and started explicitly.');
