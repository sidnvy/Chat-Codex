import fs from 'node:fs/promises';
import path from 'node:path';
import {constants as fsConstants} from 'node:fs';
import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
import {configSchema,createRegistry} from './resources.mjs';

const execFile=promisify(execFileCallback);
const STATUS=['ready','action_required','blocked','warning','not_checked'];
const check=(id,status,message,next)=>({id,status,message,...(next?{next}: {})});
const secure=(mode)=>((mode&0o077)===0);
const timeout=2500;

/**
 * Read-only installation diagnostics. Never prints credential values, private
 * paths, process environment, raw provider exceptions or command output.
 * Values are projected onto a stable, bounded, secret-free report.
 */
export async function runDoctor({
  configFile=process.env.CHAT_CODEX_CONFIG,
  platform=process.platform,
  nodeVersion=process.versions.node,
  uid=process.getuid?.(),
  files=fs,
  command=execFile,
  http=globalThis.fetch
}={}){
  const checks=[];
  const add=(id,status,message,next)=>{
    if(!STATUS.includes(status))throw new Error('Invalid doctor status');
    checks.push(check(id,status,message,next));
  };
  const supported=['linux','darwin'].includes(platform);
  add('platform',supported?'ready':'blocked',
    supported?(platform==='darwin'?'macOS Host runtime supported; container setup requires Linux.':'Linux runtime supported.'):'Host and setup runtimes require Linux or macOS.',
    supported?undefined:'Use a supported Linux or macOS host.');
  const major=Number.parseInt(String(nodeVersion).split('.')[0],10);
  add('node',Number.isInteger(major)&&major>=22?'ready':'blocked',
    major>=22?'Node.js requirement satisfied.':'Node.js 22 or newer is required.',
    major>=22?undefined:'Install Node.js 22+ and rerun doctor.');
  add('privileges',uid!==0&&Number.isInteger(uid)?'ready':'blocked',
    uid===0?'Do not run Chat-Codex as root.':Number.isInteger(uid)?'Non-root user confirmed.':'Unable to verify current user privileges.',
    uid!==0&&Number.isInteger(uid)?undefined:'Run as an ordinary non-root Linux or macOS user.');

  let config=null,privateDir=null;
  if(!configFile){
    add('configuration','action_required','Private configuration not found in CHAT_CODEX_CONFIG.',
      'Run npm run setup in a terminal, then set CHAT_CODEX_CONFIG to the generated configuration.');
  }else if(!path.isAbsolute(configFile)){
    add('configuration','blocked','Configuration location must be an absolute path.',
      'Use the absolute path to the private config.json file.');
  }else{
    privateDir=path.dirname(configFile);
    try{
      const meta=await files.lstat(configFile);
      if(!meta.isFile()||!secure(meta.mode))throw new Error('unsafe_config_file');
      const raw=JSON.parse(await files.readFile(configFile,'utf8'));
      const parsed=configSchema.safeParse(raw);
      if(!parsed.success)throw new Error('invalid_config_schema');
      // Shared runtime validation also checks missing providers, project
      // references, unsafe paths, overlapping roots and OS Host policy.
      // Do not emit the normal Host warning into machine-readable diagnostics.
      config=parsed.data; // Keep parsed Project identities for actionable diagnostics.
      await createRegistry(raw,configFile,{warnHostAccess:false});
      // The standalone npm launcher registers no optional extensions.
      if(config.extensions?.length)throw new Error('unverified_extension_grants');
      add('configuration','ready','Configuration schema, runtime admission and file permissions are valid.');
    }catch(error){
      if(error?.message==='unverified_extension_grants')
        add('configuration','blocked','Extension grants are not installed in the standalone server.',
          'Remove unsupported extension grants or use a trusted distribution-specific configuration checker.');
      else add('configuration','blocked','Configuration cannot be read safely or does not match runtime requirements.',
        'Check the private config.json file, file mode 0600, Project admission and v2 configuration schema.');
    }
  }

  if(privateDir){
    try{
      const meta=await files.lstat(privateDir);
      if(!meta.isDirectory()||!secure(meta.mode))throw new Error('unsafe_private_dir');
      add('private_directory','ready','Private configuration directory permissions are restricted.');
    }catch{
      add('private_directory','blocked','Private configuration directory is missing or too permissive.',
        'Use a separate private directory with mode 0700.');
    }
    try{
      const meta=await files.lstat(path.join(privateDir,'token'));
      if(!meta.isFile()||!secure(meta.mode)||!(meta.mode&0o400)||meta.uid!==uid)
        throw new Error('unsafe_token');
      await files.access(path.join(privateDir,'token'),fsConstants.R_OK);
      add('credential_file','ready','Credential file is same-user readable and has restricted permissions (content not read).');
    }catch{
      add('credential_file','blocked','Credential file is missing, symbolic, or too permissive.',
        'Generate a private token through setup; keep it outside source control with mode 0600.');
    }
  }else{
    add('private_directory','not_checked','Private directory not checked until a config path is provided.');
    add('credential_file','not_checked','Credential file not checked until a config path is provided.');
  }

  if(config){
    for(const project of config.projects){
      try{
        const meta=await files.stat(project.path);
        if(!meta.isDirectory())throw new Error('not_dir');
        add('project:'+project.id,'ready','Registered Project directory is present.');
      }catch{
        add('project:'+project.id,'blocked','Registered Project directory is missing or not a directory.',
          'Restore the configured Project directory or choose a new Project through setup.');
      }
    }
    if(config.hosts.length){
      add('host_authority','warning','Unsandboxed Host access is configured; commands have same-user privileges.',
        'Use an isolated Docker Environment for untrusted code.');
    }
    const desktop=config.hosts.filter(h=>h.capabilities?.desktop?.enabled);
    add('desktop',desktop.length?'warning':'not_checked',
      desktop.length?'Desktop capability configured; real session readiness is not proven by doctor MVP.':'Desktop is disabled or not configured.',
      desktop.length?'Verify OS permissions and an active session through target_desktop_status.':undefined);
  }else add('desktop','not_checked','Desktop capability status unavailable until configuration is valid.');

  const dockerRequired=Boolean(config?.environments?.length);
  if(!dockerRequired){
    add('docker','not_checked','Docker is optional and not required by this configuration.');
    add('docker_image','not_checked','No configured Docker Environment image to check.');
  }else try{
    await command('docker',['info','--format','{{.ServerVersion}}'],{timeout,maxBuffer:8192});
    add('docker','ready','Docker daemon is reachable.');
    if(config?.docker?.image&&dockerRequired){
      try{
        await command('docker',['image','inspect',config.docker.image,'--format','{{.Id}}'],{timeout,maxBuffer:8192});
        add('docker_image','ready','Configured pinned Docker image is available locally.');
      }catch{
        add('docker_image','action_required','Configured pinned Docker image is not available locally.',
          'Retrieve the reviewed Docker image digest before provisioning an Environment.');
      }
    }else add('docker_image','not_checked','No configured Docker Environment image to check.');
  }catch{
    add('docker',dockerRequired?'blocked':config?'warning':'action_required','Docker Engine is unavailable.',
      'Install/start Docker and grant the trusted control process access, or choose Host-only mode explicitly.');
    add('docker_image','not_checked','Docker image not checked without a reachable daemon.');
  }

  if(config){
    try{
      const response=await http('http://127.0.0.1:'+config.port+'/healthz',{
        method:'GET',redirect:'error',signal:AbortSignal.timeout(1500)
      });
      const body=response.ok?await response.json():null;
      if(!response.ok||body?.ok!==true||body?.scope!=='process only')throw new Error('not_healthy');
      add('local_server','ready','Loopback Chat-Codex process is responding (not an MCP authentication test).');
    }catch{
      add('local_server','action_required','Chat-Codex local HTTP health check is not ready.',
        'Start the configured server, then run the authenticated MCP first-run verifier.');
    }
  }else add('local_server','not_checked','Local server health requires a valid configuration.');

  add('chatgpt_connection','not_checked','External MCP connectivity and ChatGPT app authorization require separate user verification.',
    'Configure a secure MCP endpoint and authorize Chat-Codex in your ChatGPT client.');
  const allRequired=checks.filter(x=>!['desktop','host_authority','docker_image','chatgpt_connection'].includes(x.id));
  const overall=allRequired.some(x=>x.status==='blocked')?'blocked':
    checks.some(x=>x.status==='action_required')?'action_required':'ready';
  return {schema_version:1,overall,checks};
}