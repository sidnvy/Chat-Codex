// Optional live GUI acceptance. Run only against a dedicated, authorized scratch
// window on a trusted Host and a loopback-only Chat-Codex test service.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const token=(await fs.readFile(process.env.CHAT_CODEX_TEST_TOKEN_FILE||'/run/cc-token','utf8')).trim();
const port=Number(process.env.CHAT_CODEX_TEST_PORT||29173);
const title=process.env.CHAT_CODEX_TEST_TITLE||'Chat-Codex Desktop E2E Scratch';
const target={kind:'host',id:'local'};
const marker=process.env.CHAT_CODEX_TEST_MARKER||'Chat-Codex-Desktop-E2E-Test';
const client=new Client({name:'cc-desktop-live-acceptance',version:'1.0.0'},{capabilities:{}});
const call=async(name,args,expectedError=false)=>{
 const r=await client.callTool({name,arguments:args},undefined,{timeout:12000});
 assert.equal(Boolean(r.isError),expectedError,name+': '+JSON.stringify(r.content?.filter(x=>x.type==='text')).slice(0,700));
 return r;
};
try{
 await client.connect(new StreamableHTTPClientTransport(
  new URL('http://127.0.0.1:'+port+'/mcp'),
  {requestInit:{headers:{Authorization:'Bearer '+token}}}
 ));
 const status=(await call('target_desktop_status',{target})).structuredContent;
 assert.equal(status.state,'ready');
 assert.equal(status.driver,'hyprland');
 const list=(await call('target_desktop_observe',{target,mode:'windows'})).structuredContent;
 const expectedApp=process.env.CHAT_CODEX_TEST_APP||'zenity';
 const scratch=list.windows.find(w=>w.title===title&&w.app===expectedApp);
 assert.ok(scratch,'dedicated scratch window must be visible');
 const wait=(await call('target_desktop_wait',{target,condition:{type:'window_present',title},timeout_ms:2000})).structuredContent;
 assert.equal(wait.matched,true);
 const observed=await call('target_desktop_observe',{target,mode:'window',window_id:scratch.id});
 assert.ok(observed.structuredContent.snapshot_id);
 assert.ok(observed.content.some(x=>x.type==='image'&&x.mimeType==='image/png'&&x.data.length>100));
 const snapshot=observed.structuredContent.snapshot_id;
 const typed=(await call('target_desktop_act',{target,snapshot_id:snapshot,action:{type:'type',text:marker}})).structuredContent;
 assert.equal(typed.outcome,'dispatched_unverified');
 assert.equal(typed.verified,false);
 await call('target_desktop_act',{target,snapshot_id:snapshot,action:{type:'type',text:'REPLAY'}},true);
 const reobserved=await call('target_desktop_observe',{target,mode:'window',window_id:scratch.id});
 const result=(await call('target_desktop_act',{target,snapshot_id:reobserved.structuredContent.snapshot_id,action:{type:'key',key:'Return'}})).structuredContent;
 assert.equal(result.outcome,'dispatched_unverified');
 console.log(JSON.stringify({passed:true,real_mcp_http:true,driver:status.driver,monitor:status.monitors?.[0]?.name,
  scratch_window:scratch.title,captured_png:true,snapshot_one_shot:true,
  text_dispatched:true,return_dispatched:true,result_verification:'see_host_zenity_result'}));
}finally{await client.close();}
