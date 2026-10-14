import {readFileSync} from 'node:fs';
const graph=['primitives.mjs','exec.mjs','windows-native.mjs','winapp.mjs','windows-worker-entry.mjs'];
export function createWindowsWorkerSource({timeoutMs=28000,winappSha256,harfbuzzSha256,skiaSha256}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>28000||
  ![winappSha256,harfbuzzSha256,skiaSha256].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)))throw new TypeError('Reviewed installation hashes required');
 const session=readFileSync(new URL('../../scripts/windows-session-probe.ps1',import.meta.url),'utf8');
 const native=readFileSync(new URL('./windows-native-probe.ps1',import.meta.url),'utf8');
 const marker='# Read twice to reject a transition observed during the probe; not an atomic lock lease.';
 if(!session.includes(marker))throw new Error('Unexpected session source');
 const script=session.slice(0,session.indexOf(marker))+native+`
$first=[StyxConsoleProbe]::Read()
if (-not ($first.supported -and $first.same_user -and $first.input_receiving -and $first.thread_receiving -and
 $first.process_session -gt 0 -and $first.process_session -eq $first.console_session -and
 $first.process_session -eq $first.reported_session -and $first.state -eq 0 -and $first.flags -eq 1 -and
 $first.station -ceq 'WinSta0' -and $first.input_desktop -ceq 'Default' -and $first.thread_desktop -ceq 'Default')) { throw 'Unavailable session' }
$before=$null; $after=$null; $png=$null
if ($args[0] -ne 'session') { $before=[StyxWindowProbe]::Read($args[1]) }
if ($args[0] -eq 'capture') { $png=[StyxWindowProbe]::Capture($args[1]) }
if ($args[0] -ne 'session') { $after=[StyxWindowProbe]::Read($args[1]) }
$last=[StyxConsoleProbe]::Read()
@{sessions=@($first,$last);before=$before;after=$after;png=$png} | ConvertTo-Json -Depth 5 -Compress
} catch { 'null' }
`;
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
