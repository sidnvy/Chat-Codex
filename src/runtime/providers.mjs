import {assertEnvironmentProvider} from '../provider-contract.mjs';
import {DockerEnvironmentProvider} from '../docker-provider.mjs';

// Factories are supplied only by trusted server composition, never through
// MCP arguments or a model-controlled config path.
const NAME=/^[a-z][a-z0-9-]{0,62}$/;
export class EnvironmentProviderCatalog{
 #factories=new Map();
 #sealed=false;
 seal(){this.#sealed=true;return this;}
 register(name,factory){
  if(this.#sealed)throw Error('Environment Provider catalog is sealed');
  if(typeof name!=='string'||!NAME.test(name)||typeof factory!=='function')
   throw Error('Invalid Environment Provider registration');
  if(this.#factories.has(name))throw Error('Duplicate Environment Provider: '+name);
  this.#factories.set(name,factory);
  return this;
 }
 has(name){return this.#factories.has(name);}
 list(){return [...this.#factories.keys()];}
 create(name,registry){
  if(!this.has(name))throw Error('Unregistered Environment Provider: '+String(name));
  const provider=this.#factories.get(name)(registry);
  assertEnvironmentProvider(provider);
  return provider;
 }
}

export function createBuiltInEnvironmentCatalog(){
 return new EnvironmentProviderCatalog().register('docker',registry=>new DockerEnvironmentProvider(registry));
}