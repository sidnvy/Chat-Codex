import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {validateHost} from './backends.mjs';
import {desktopConfigSchema} from './desktop/contract.mjs';

export const idSchema=z.string().regex(/^[a-z][a-z0-9-]{0,62}$/);
export const targetSchema=z.object({kind:z.enum(['host','environment']),id:idSchema}).strict();
export const pathSchema=z.string().min(1).max(1024).refine(s=>!s.includes('\0')&&!path.isAbsolute(s)&&!s.split('/').includes('..'),'Relative project path required');
export const commandSchema=z.string().min(1).max(8192);
export const timeoutSchema=z.number().int().min(1000).max(300000).default(15000);
const projectSchema=z.object({id:idSchema,path:z.string().min(1)}).strict();
const hostSchema=z.object({id:idSchema,project:idSchema,enabled:z.literal(true),connection:z.literal('local'),unsandboxed:z.literal(true),capabilities:z.object({desktop:desktopConfigSchema.optional()}).strict().optional()}).strict();
const environmentSchema=z.object({id:idSchema,project:idSchema,provider:idSchema}).strict();
const dockerSchema=z.object({user:z.string().regex(/^[1-9][0-9]*:[0-9]+$/),image:z.string().regex(/^node:[a-zA-Z0-9_.-]+@sha256:[a-f0-9]{64}$/)}).strict();
const configSchema=z.object({
 version:z.literal(2),port:z.number().int().min(1024).max(65535).default(8791),
 owner_id:z.string().uuid(),projects:z.array(projectSchema).min(1).max(32),
 hosts:z.array(hostSchema).max(16),environments:z.array(environmentSchema).max(32),
 extensions:z.array(idSchema).max(16).optional(),
 docker:dockerSchema.optional()
}).strict();
const contains=(a,b)=>a===b||b.startsWith(a+path.sep);
function unique(rows,kind){if(new Set(rows.map(x=>x.id)).size!==rows.length)throw Error('Duplicate '+kind+' id');}
export async function createRegistry(raw,configFile,{allowedProviders=['docker']}={}) {
 const cfg=configSchema.parse(raw);
 unique(cfg.projects,'project');unique(cfg.hosts,'host');unique(cfg.environments,'environment');
 if(cfg.hosts.length){validateHost();console.warn('UNSANDBOXED Local Host enabled: shell commands have same-user filesystem and network privileges.');}
 if(cfg.environments.some(e=>e.provider==='docker')&&!cfg.docker)throw Error('Docker settings required for environment provider');
 if(cfg.environments.some(e=>!allowedProviders.includes(e.provider)))throw Error('Environment Provider is not registered by the trusted server');
 const privateDir=await fs.realpath(path.dirname(configFile));
 const source=await fs.realpath(fileURLToPath(new URL('..',import.meta.url)));
 const projects=new Map();
 for(const project of cfg.projects){
  if(!path.isAbsolute(project.path))throw Error('Project paths must be absolute');
  const real=await fs.realpath(project.path);
  if(real==='/'||contains(real,privateDir)||contains(real,source)||contains(privateDir,real)||contains(source,real))throw Error('Project cannot contain config, source or host root');
  if((await fs.stat(real)).isDirectory()!==true)throw Error('Project must be a directory');
  if(real.includes(','))throw Error('Comma in project path is unsupported');
  projects.set(project.id,{id:project.id,path:real});
 }
 const all=[...projects.values()];for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++)if(contains(all[i].path,all[j].path)||contains(all[j].path,all[i].path))throw Error('Overlapping Project directories not permitted');
 for(const entry of [...cfg.hosts,...cfg.environments])if(!projects.has(entry.project))throw Error('Unknown project for resource '+entry.id);
 return {config:cfg,privateDir,projects,hosts:new Map(cfg.hosts.map(h=>[h.id,h])),environments:new Map(cfg.environments.map(e=>[e.id,e]))};
}
export function resolveTarget(registry,input){
 const target=targetSchema.parse(input);
 const entry=target.kind==='host'?registry.hosts.get(target.id):registry.environments.get(target.id);
 if(!entry)throw Error('Unknown registered '+target.kind+' target: '+target.id);
 return {target,entry,project:registry.projects.get(entry.project)};
}
export function listProjects(registry){
 return [...registry.projects.values()].map(p=>({id:p.id,targets:[
 ...[...registry.hosts.values()].filter(x=>x.project===p.id).map(x=>({kind:'host',id:x.id})),
 ...[...registry.environments.values()].filter(x=>x.project===p.id).map(x=>({kind:'environment',id:x.id}))
 ]}));
}
