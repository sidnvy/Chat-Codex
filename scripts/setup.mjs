import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {selectBackend, validateHost} from '../src/backends.mjs';
const args=process.argv.slice(2);
const usage='用法：npm run setup -- /absolute/new-project /absolute/new-private-dir [--backend docker|host]\n默认 docker；省略 backend 的旧配置仍用 Docker，失败不会回退。host 无需 Docker，直接以当前系统用户执行，没有 OS 沙箱，可访问同用户凭据、项目外文件和网络。仅支持非 root Linux。';
if(args.includes('--help')) {console.log(usage);process.exit(0);}
const [projectArg,privateArg,flag,value]=args;
if(args.length!==2 && !(args.length===4 && flag==='--backend' && value))throw Error(usage);
const backend=selectBackend(value===undefined?{}:{backend:value});
if(backend==='host') {validateHost();console.warn('警告：host 模式直接以当前系统用户执行任意命令，不是 OS 沙箱；命令可访问项目外文件、同用户凭据与网络。缩减环境变量和文件工具路径检查不构成隔离。');}
if(!projectArg||!privateArg)throw Error(usage);
if(!path.isAbsolute(projectArg)||!path.isAbsolute(privateArg))throw Error('Use absolute paths');
const project=path.resolve(projectArg),priv=path.resolve(privateArg);
if(priv===project||priv.startsWith(project+path.sep)||project.startsWith(priv+path.sep))throw Error('Project and private config must be separate');
const uid=process.getuid?.();const gid=process.getgid?.();if(!uid||gid===undefined)throw Error('Use a non-root Linux user');
const digest=backend==='docker' ? JSON.parse(execFileSync('docker',['image','inspect','node:22-bookworm-slim','--format','{{json .RepoDigests}}'],{encoding:'utf8'})).find(x=>x.startsWith('node@sha256:')) : null;
if(backend==='docker'&&!digest)throw Error('Pull official node:22-bookworm-slim first');
await fs.mkdir(project,{mode:0o700});
await fs.mkdir(priv,{mode:0o700});
const token=crypto.randomBytes(32).toString('base64url');
await fs.writeFile(path.join(priv,'token'),token+'\n',{mode:0o600,flag:'wx'});
await fs.writeFile(path.join(priv,'tunnel-authorization'),'Bearer '+token+'\n',{mode:0o600,flag:'wx'});
await fs.writeFile(path.join(priv,'config.json'),JSON.stringify({backend,project,...(backend==='docker'?{user:`${uid}:${gid}`,image:'node:22-bookworm-slim@'+digest.split('@')[1]}:{}),port:8791},null,2)+'\n',{mode:0o600,flag:'wx'});
console.log('已创建空项目和独立私有配置；执行后端：'+backend+'。将 CHAT_CODEX_CONFIG 设置为 '+path.join(priv,'config.json'));
