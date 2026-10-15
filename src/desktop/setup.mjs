import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const SOURCE='a1d48b28a3717b16fa5940151de01858714411f6';
const TEAM='FWJYW4S8P8';
const DOCS='https://peekaboo.sh/install.html';
const fail=code=>{throw Object.assign(Error(code),{code});};
/** Prepare the existing signed CLI/GUI pair. Never installs artifacts or changes TCC. */
export async function setupDesktop({action='check',platform=process.platform,appPath='/Applications/Peekaboo.app',cliPath,home=os.homedir(),launchAccess=false,softwareAccess=false,startupAccess=false,command=exec,filesystem=fs}={}){
 if(!['check','prepare','start','startup'].includes(action))fail('invalid_action');
 const result={schema_version:1,platform,action,driver:'peekaboo',installation:'not_checked',launch:'not_requested',startup:'not_configured',permissions:'not_checked',desktop_ready:false,compatibility:'not_checked',next_actions:[]};
 if(platform!=='darwin')return {...result,driver:null,next_actions:[{code:'platform_setup_unavailable',message:'This helper prepares the macOS Peekaboo CLI/GUI pair only.'}]};
 if(action==='start'&&!launchAccess)fail('desktop_launch_authorization_required');
 if(action==='startup'&&!startupAccess)fail('desktop_startup_authorization_required');
 const run=(file,args)=>command(file,args,{encoding:'utf8',timeout:15000,maxBuffer:1048576,stdio:['ignore','pipe','pipe']});
 const checkedPath=async(p,directory)=>{
  if(typeof p!=='string'||!path.isAbsolute(p)||/[\0\r\n]/.test(p))fail('absolute_artifact_path_required');
  const real=await filesystem.realpath(p),st=await filesystem.stat(real);
  if(!(directory?st.isDirectory():st.isFile()))fail('invalid_artifact');return real;
 };
 let app,cli;
 try{app=await checkedPath(appPath,true);}catch{
  result.installation='missing_gui';result.next_actions.push({code:'reviewed_gui_artifact_required',message:'Install the separately distributed signed Peekaboo.app from a reviewed release into Applications, then rerun. This helper neither downloads an unpinned release nor replaces an existing app.',documentation:DOCS,software_authorized:softwareAccess===true});return result;
 }
 if(cliPath){try{cli=await checkedPath(cliPath,false);}catch{}}
 else for(const candidate of ['/opt/homebrew/bin/peekaboo','/usr/local/bin/peekaboo']){try{cli=await checkedPath(candidate,false);break;}catch{}}
 if(!cli){result.installation='missing_cli';result.next_actions.push({code:'reviewed_cli_artifact_required',message:'Prepare the separate signed Peekaboo CLI matching the reviewed adapter contract. The GUI executable is not the CLI. Use an absolute CLI path for nonstandard installations.',documentation:DOCS,software_authorized:softwareAccess===true});return result;}
 try{
  for(const [artifact,bundle] of [[app,'boo.peekaboo.mac'],[cli,'boo.peekaboo.peekaboo']])await run('/usr/bin/codesign',['--verify','--strict','--deep','-R',`=anchor apple generic and identifier "${bundle}" and certificate leaf[subject.OU] = "${TEAM}"`,artifact]);
  const bundle=(await run('/usr/bin/plutil',['-extract','CFBundleIdentifier','raw',path.join(app,'Contents/Info.plist')])).stdout.trim();
  if(bundle!=='boo.peekaboo.mac')throw Error();
  const version=JSON.parse((await run(cli,['--version','--json'])).stdout);
  if(version.success!==true||version.data?.sourceCommit!==SOURCE){result.installation='cli_contract_unreviewed';result.next_actions.push({code:'review_cli_contract',message:'The signed CLI source revision differs from the reviewed Styx adapter contract. Review compatibility before launch or use; do not silently install the latest version.'});return result;}
 }catch{
  result.installation='identity_unverified';result.next_actions.push({code:'verify_signed_pair',message:'CLI/GUI identity or provenance verification failed. Preserve the installation and inspect its signed release identity; do not disable signature checks or remove quarantine.'});return result;
 }
 result.installation='signed_pair_present';result.artifacts={app_path:app,cli_path:cli,cli_source:SOURCE,team:TEAM,bridge_socket:path.join(home,'Library/Application Support/Peekaboo/bridge.sock')};
 // This helper does not configure the server's executable lookup. Compare only
 // this process's PATH; a persistent server must be checked through its MCP tools.
 result.runtime_path_match='unknown';result.runtime_path_scope='installer_process';
 try{const resolved=(await run('/bin/sh',['-c','command -v peekaboo'])).stdout.trim();if(path.isAbsolute(resolved))result.runtime_path_match=(await filesystem.realpath(resolved))===cli;}catch{}
 if(result.runtime_path_match!==true)result.next_actions.push({code:'runtime_cli_path_unconfirmed',message:'The checked CLI is not confirmed as the executable this environment resolves as peekaboo. --cli-path verifies an artifact; it does not change Styx runtime configuration or PATH. Reconcile the actual service environment, then verify through its MCP tools.'});
 if(action==='start'){
  try{await run('/usr/bin/open',['-g',app]);result.launch='requested';}
  catch{result.launch='unconfirmed';result.next_actions.push({code:'launch_unconfirmed',message:'The app launch could not be confirmed. Inspect the existing session before retrying; no quit or force-relaunch was attempted.'});return result;}
 }
 if(action==='startup'){
  result.startup='awaiting_native_app_setting';result.next_actions.push({code:'enable_native_launch_at_login',message:'Enable Peekaboo’s own Launch at Login setting in its signed app, then verify it in macOS Login Items and after a later normal login. No custom launchd job or private preference key was written.',documentation:'https://peekaboo.sh/bridge-host.html'});
 }
 result.next_actions.push({code:'check_selected_gui_bridge',message:'Check the exact GUI Bridge socket with the signed CLI, then check OS permissions, session ownership and an actual desktop task. A signed installed pair or successful open request does not prove Bridge readiness.'});
 return result;
}
