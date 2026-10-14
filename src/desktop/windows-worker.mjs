import {readFileSync} from 'node:fs';
import {createWindowsNativeScript} from './windows-native-source.mjs';
const graph=['primitives.mjs','exec.mjs','windows-native.mjs','winapp.mjs','windows-worker-entry.mjs'];
export function createWindowsWorkerSource({timeoutMs=28000,winappSha256,harfbuzzSha256,skiaSha256}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>28000||
  ![winappSha256,harfbuzzSha256,skiaSha256].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)))throw new TypeError('Reviewed installation hashes required');
 const script=createWindowsNativeScript();
 const urls=new Map();
 for(const file of graph){
  let source=readFileSync(new URL(file,import.meta.url),'utf8').replaceAll('__STYX_WINDOWS_NATIVE_SCRIPT__',JSON.stringify(script)).replaceAll('__STYX_WINDOWS_WORKER_OPTIONS__',JSON.stringify({timeoutMs,winappSha256,harfbuzzSha256,skiaSha256}));
  source=source.replace(/from ['"]\.\/([^'"]+)['"]/g,(_all,name)=>{
   if(!urls.has(name))throw new Error('Unexpected worker dependency');return 'from '+JSON.stringify(urls.get(name));
  });
  urls.set(file,'data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 }
 return `import(${JSON.stringify(urls.get(graph.at(-1)))}).catch(()=>{process.stdout.write(JSON.stringify({ok:false,error:'driver_unavailable'})+String.fromCharCode(10));process.exitCode=1;});`;
}
