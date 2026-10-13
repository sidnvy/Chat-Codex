import {DesktopError,verifyDesktopDriver} from './contract.mjs';
import {HyprlandDesktop} from './hyprland.mjs';
import {PeekabooDesktop} from './peekaboo.mjs';
import {WinappDesktop} from './winapp.mjs';

const NAME=/^[a-z][a-z0-9-]{0,62}$/;
export class DesktopDriverCatalog {
 constructor(){this.factories=new Map();}
 register(name,factory){
  if(!NAME.test(name)||typeof factory!=='function')throw new DesktopError('invalid_driver','Invalid driver registration');
  if(this.factories.has(name))throw new DesktopError('duplicate_driver','Driver already registered: '+name);
  this.factories.set(name,factory);
  return this;
 }
 create(name){
  const factory=this.factories.get(name);
  if(!factory)throw new DesktopError('driver_unavailable','No trusted Desktop Driver registered: '+name);
  return verifyDesktopDriver(factory());
 }
 list(){return [...this.factories.keys()];}
}
// These are optional local adapters. The Core never executes user-supplied module
// paths or commands; an installer registers audited factories in application code.
export function createBuiltInDesktopCatalog(platform=process.platform){
 const catalog=new DesktopDriverCatalog();
 if(platform==='linux')catalog.register('hyprland',()=>new HyprlandDesktop());
 if(platform==='darwin')catalog.register('peekaboo',()=>new PeekabooDesktop());
 if(platform==='win32')catalog.register('winapp',()=>new WinappDesktop());
 return catalog;
}
