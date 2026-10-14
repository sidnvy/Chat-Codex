import {z} from 'zod';
export const desktopConfigSchema=z.object({enabled:z.literal(true),driver:z.string().regex(/^[a-z][a-z0-9-]{0,62}$/)}).strict();
export const desktopActionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('type'),text:z.string().min(1).max(1000)}).strict(),
 z.object({type:z.literal('key'),key:z.string().regex(/^[A-Za-z0-9+_-]{1,40}$/)}).strict(),
 z.object({type:z.literal('click'),x:z.number().int().min(0).max(10000),y:z.number().int().min(0).max(10000)}).strict(),
 z.object({type:z.literal('invoke'),element_id:z.string().min(1).max(128)}).strict(),
 z.object({type:z.literal('set_value'),element_id:z.string().min(1).max(128),value:z.string().max(1000)}).strict()
]);
export const desktopObserveSchema=z.object({
 target:z.object({kind:z.enum(['host','environment']),id:z.string().regex(/^[a-z][a-z0-9-]{0,62}$/)}).strict(),
 mode:z.enum(['windows','window']),window_id:z.string().min(1).max(128).optional()
}).strict().superRefine((v,ctx)=>{
 if(v.mode==='window'&&!v.window_id)ctx.addIssue({code:'custom',message:'window_id required for exact-window screenshot'});
 if(v.mode==='windows'&&v.window_id)ctx.addIssue({code:'custom',message:'window_id only allowed with window mode'});
});
export const desktopActSchema=z.object({
 target:z.object({kind:z.enum(['host','environment']),id:z.string().regex(/^[a-z][a-z0-9-]{0,62}$/)}).strict(),
 snapshot_id:z.string().uuid(),action:desktopActionSchema
}).strict();
export const desktopWaitSchema=z.object({
 target:z.object({kind:z.enum(['host','environment']),id:z.string().regex(/^[a-z][a-z0-9-]{0,62}$/)}).strict(),
 condition:z.object({type:z.literal('window_present'),title:z.string().min(1).max(128)}).strict(),
 timeout_ms:z.number().int().min(100).max(10000).default(3000)
}).strict();
import {DesktopError} from './primitives.mjs';
export {DesktopError,DESKTOP_SNAPSHOT_TTL_MS,DESKTOP_IMAGE_LIMIT_BYTES} from './primitives.mjs';
export function verifyDesktopDriver(driver){
 for(const key of ['status','observe','act'])if(typeof driver?.[key]!=='function')throw new DesktopError('invalid_driver','Desktop driver missing '+key);
 return driver;
}
