// Provider-facing contract. A provider owns Environment lifecycle; transport is internal.
export const PROVIDER_CONTRACT_VERSION=1;
export const REQUIRED_PROVIDER_METHODS=Object.freeze(['status','create','start','stop','delete','run']);
export function assertEnvironmentProvider(provider){
 if(!provider||typeof provider!=='object')throw Error('Environment provider is required');
 for(const method of REQUIRED_PROVIDER_METHODS)if(typeof provider[method]!=='function')throw Error('Provider missing '+method);
 return true;
}
export function assertLifecycleReceipt(receipt){
 if(!receipt||!['absent','created','running','stopped'].includes(receipt.lifecycle)||typeof receipt.ready!=='boolean')throw Error('Invalid lifecycle receipt');
 if(receipt.ready!==(receipt.lifecycle==='running'))throw Error('Inconsistent lifecycle readiness');
 return true;
}
