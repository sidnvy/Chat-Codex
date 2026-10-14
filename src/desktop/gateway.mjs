import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {DesktopCore} from './core.mjs';
import {DesktopError} from './contract.mjs';
import {registerDesktopTools} from '../protocol/desktop-tools.mjs';
import {startLoopbackMcp} from '../protocol/loopback.mjs';

// Programmatic, trusted composition only. No Registry, HostRunner or module loading.
export async function startDesktopGateway({token,port=0,
 grantForTarget=()=>null,
 driverFactory=()=>{throw new DesktopError('driver_unavailable','No Desktop driver configured');},
 clock}={}){
 // Core must outlive individual stateless MCP requests: snapshots stay single-use.
 const desktops=new DesktopCore({grantForTarget,driverFactory,clock});
 const protocol=()=>{
  const mcp=new McpServer({name:'Styx-Desktop',version:'0.3.0'});
  registerDesktopTools(mcp,desktops);
  return mcp;
 };
 const server=await startLoopbackMcp({port,token,protocol});
 return {server,port:server.address().port};
}
