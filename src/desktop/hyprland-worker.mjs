import {readFileSync} from 'node:fs';

// A closed module graph sourced from this installed artifact, never caller paths.
const graph=['primitives.mjs','exec.mjs','hyprland.mjs','hyprland-worker-entry.mjs'];
export function createHyprlandWorkerSource({timeoutMs=10000,maxImageBytes=1048576}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000||
  !Number.isInteger(maxImageBytes)||maxImageBytes<100||maxImageBytes>2097152)
  throw new TypeError('Invalid trusted worker limits');
 const urls=new Map();
 for(const file of graph){
  let source=readFileSync(new URL(file,import.meta.url),'utf8');
  source=source.replaceAll('__STYX_WORKER_OPTIONS__',JSON.stringify({timeoutMs,maxImageBytes}));
  source=source.replace(/from ['"]\.\/([^'"]+)['"]/g,(_all,name)=>{
   if(!urls.has(name))throw new Error('Unexpected worker module dependency');
   return 'from '+JSON.stringify(urls.get(name));
  });
  urls.set(file,'data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 }
 return `import(${JSON.stringify(urls.get(graph.at(-1)))}).catch(()=>{process.stdout.write(JSON.stringify({ok:false,error:'driver_unavailable'})+'\\n');process.exitCode=1;});`;
}
