import {resolveTarget} from '../resources.mjs';
import {createBuiltInDesktopCatalog} from './drivers.mjs';
import {DesktopCore} from './core.mjs';

// Compatibility adapter for the existing Styx local Registry. Desktop behavior
// lives only in DesktopCore; Coder/remote Providers can inject an independent
// admitted binding without pulling Registry or MCP into the shared Core.
export class DesktopManager extends DesktopCore {
 constructor(registry,{driverFactory,catalog=createBuiltInDesktopCatalog(),clock}={}){
  super({
   grantForTarget(target){
    return resolveTarget(registry,target).entry.capabilities?.desktop;
   },
   driverFactory:driverFactory??(name=>catalog.create(name)),
   clock
  });
  this.registry=registry;
  this.catalog=catalog;
 }
}
