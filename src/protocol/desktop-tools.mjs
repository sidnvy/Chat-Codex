import {z} from 'zod';
import {desktopObserveSchema,desktopActSchema,desktopWaitSchema} from '../desktop/contract.mjs';
import {show,failed} from './results.mjs';

export function registerDesktopTools(mcp,desktops){
 const targetArgs=desktopActSchema.shape.target;
 const register=(name,description,inputSchema,fn,read=false)=>mcp.registerTool(name,{
  description,inputSchema,annotations:{readOnlyHint:read,destructiveHint:!read,idempotentHint:read}
 },async args=>{try{return show(await fn(args));}catch(e){return failed(e);}});
  register('target_desktop_status','Read Desktop readiness separately from Host connection.',z.object({target:targetArgs}).strict(),a=>desktops.status(a.target),true);
  mcp.registerTool('target_desktop_observe',{
   description:'Read windows or capture an exact active window and mint a short-lived target-bound screenshot. Images are ephemeral.',
   inputSchema:desktopObserveSchema,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}
  },async a=>{
   try{
    const observed=await desktops.observe(a);
    const {image,...result}=observed;
    return {content:[{type:'text',text:JSON.stringify(result)},...(image?[{type:'image',data:image.data,mimeType:image.mimeType}]:[])],structuredContent:result};
   }catch(e){return failed(e);}
  });
  register('target_desktop_act','Execute a single action against a fresh target-bound Desktop snapshot.',desktopActSchema,a=>desktops.act(a));
  mcp.registerTool('target_desktop_wait',{description:'Wait for an exact window title with a bounded timeout.',inputSchema:desktopWaitSchema,annotations:{readOnlyHint:true,destructiveHint:false}},async a=>{
   try{const result=await desktops.wait(a);return {...show(result),isError:!result.matched};}
   catch(e){return failed(e);}
  });

}
