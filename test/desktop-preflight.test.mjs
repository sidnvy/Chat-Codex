import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectDesktopPrerequisites} from '../src/desktop/preflight.mjs';
const session={PATH:'/reviewed/bin',HYPRLAND_INSTANCE_SIGNATURE:'private-session',WAYLAND_DISPLAY:'wayland-1',XDG_RUNTIME_DIR:'/private/runtime'};
test('Hyprland preflight separates pointer dependency from base tools and never claims readiness',async()=>{
 const calls=[];const result=await inspectDesktopPrerequisites({platform:'linux',env:session,command:(exe,args,options)=>{calls.push({exe,args,options});if(args.at(-1)==='ydotool')throw Error('missing');}});
 assert.equal(result.driver,'hyprland');assert.equal(result.ready_for_driver_probe,true);assert.equal(result.desktop_ready,'not_checked');
 assert.deepEqual(result.dependencies.at(-1),{name:'ydotool',required:false,available:false,capability:'pointer',daemon_access:'not_checked'});
 assert.ok(calls.every(c=>c.exe==='/bin/sh'&&c.args[1]==='command -v "$1" >/dev/null 2>&1'));
 assert.ok(!JSON.stringify(result).includes('private-session'));assert.ok(!JSON.stringify(result).includes('/private/runtime'));
});
test('missing Linux session and tools produce actionable sanitized handoffs',async()=>{
 const result=await inspectDesktopPrerequisites({platform:'linux',env:{},command:()=>{throw Error('secret raw stderr');}});
 assert.equal(result.ready_for_driver_probe,false);assert.equal(result.next_actions[0].code,'install_prerequisites');assert.ok(result.next_actions.some(x=>x.code==='hyprland_session_required'));assert.ok(!JSON.stringify(result).includes('secret'));
});
test('macOS binary discovery leaves permissions, session, and compatibility unverified',async()=>{
 const result=await inspectDesktopPrerequisites({platform:'darwin',env:{PATH:'/bin'},command:()=>{}});
 assert.deepEqual(result.dependencies.map(x=>x.name),['peekaboo','python3','/usr/sbin/ioreg']);assert.equal(result.ready_for_driver_probe,true);assert.equal(result.environment.verified,false);assert.equal(result.version_compatibility,'not_checked');assert.equal(result.installer.automated,false);
});
test('Windows handoff does not run unsupported installers or fabricate preparation',async()=>{
 const result=await inspectDesktopPrerequisites({platform:'win32',command:()=>{throw Error('must not run');}});
 assert.equal(result.driver,'winapp');assert.equal(result.supported,false);assert.equal(result.ready_for_driver_probe,false);assert.equal(result.next_actions[0].code,'native_installer_unavailable');
});
