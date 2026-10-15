import {execFileSync} from 'node:child_process';

/** Read-only prerequisite inventory. It grants no access and proves no GUI readiness. */
export async function inspectDesktopPrerequisites({platform=process.platform,env=process.env,command=execFileSync}={}){
 const result={schema_version:1,platform,driver:null,supported:false,environment:{kind:'unsupported',verified:false},dependencies:[],ready_for_driver_probe:false,version_compatibility:'not_checked',desktop_ready:'not_checked',installer:{automated:false,status:'manual_handoff'},next_actions:[]};
 if(!['linux','darwin'].includes(platform)){
  result.driver=platform==='win32'?'winapp':null;
  result.next_actions.push({code:'native_installer_unavailable',message:platform==='win32'?'Windows desktop requires the canonical worker, reviewed WinApp executable and library hashes, and an admitted interactive-session transport. This installer does not provide those.':'No desktop installer is provided for this platform.'});
  return result;
 }
 const available=name=>{
  try{
   // Fixed shell expression and positional argument: never interpolate PATH or a filename.
   command('/bin/sh',['-c','command -v "$1" >/dev/null 2>&1','styx-desktop-preflight',name],{encoding:'utf8',timeout:3000,maxBuffer:1024,stdio:['ignore','pipe','pipe'],env:{PATH:env.PATH??'',LC_ALL:'C'}});
   return true;
  }catch{return false;}
 };
 result.supported=true;
 const names=platform==='linux'?['hyprctl','grim','wtype','ydotool']:['peekaboo','python3','/usr/sbin/ioreg'];
 result.driver=platform==='linux'?'hyprland':'peekaboo';
 result.dependencies=names.map(name=>({name,required:name!=='ydotool',available:available(name),...(name==='ydotool'?{capability:'pointer',daemon_access:'not_checked'}:{})}));
 if(platform==='linux'){
  const missing=['HYPRLAND_INSTANCE_SIGNATURE','WAYLAND_DISPLAY','XDG_RUNTIME_DIR'].filter(key=>typeof env[key]!=='string'||!env[key].trim());
  result.environment={kind:'hyprland',verified:false,session_environment_present:missing.length===0,missing_variables:missing};
  if(missing.length)result.next_actions.push({code:'hyprland_session_required',message:'Run Styx from the existing user Hyprland session with its inherited Wayland environment. Other Linux desktops are not supported by this adapter.'});
  result.next_actions.push({code:'pointer_access_unverified',message:'Pointer input additionally needs ydotool and authorized daemon/device access. Binary discovery alone does not prove pointer input works.'});
 }else{
  result.environment={kind:'macos_console',verified:false};
  result.next_actions.push({code:'macos_gui_bridge_required',message:'Install a verified compatible Peekaboo CLI and Peekaboo.app pair. Launch the GUI app in this user session; the adapter requires its explicit per-user Bridge socket and verifies its process generation. Local CLI permissions are not the GUI Bridge permissions.'});
  result.next_actions.push({code:'macos_permissions_and_session',message:'Use an unlocked console session owned by this account. Check Screen Recording and Accessibility permissions for the actual Peekaboo execution identity; recheck with the native driver after authorization.'});
 }
 const missing=result.dependencies.filter(d=>d.required&&!d.available).map(d=>d.name);
 if(missing.length)result.next_actions.unshift({code:'install_prerequisites',dependencies:missing,message:'Obtain authorization to prepare these dependencies using a reviewed platform installation method, then rerun preflight. This check installs nothing.'});
 result.next_actions.push({code:'verify_driver_contract',message:platform==='darwin'?'Verify the installed Peekaboo against the documented 4.5.0 adapter contract before use; discovering a binary does not establish compatibility.':'Verify the installed tools support the adapter commands; discovering binaries does not establish compatibility.'});
 result.ready_for_driver_probe=missing.length===0&&(platform!=='linux'||result.environment.session_environment_present);
 if(result.ready_for_driver_probe)result.next_actions.push({code:'probe_and_verify_desktop',message:'Run native desktop status, then separately verify an owned test window and authorized input. Prerequisite discovery is not desktop readiness.'});
 return result;
}
