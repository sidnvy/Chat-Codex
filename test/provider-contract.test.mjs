import test from 'node:test';
import assert from 'node:assert/strict';
import {REQUIRED_PROVIDER_METHODS,assertEnvironmentProvider,assertLifecycleReceipt,PROVIDER_CONTRACT_VERSION} from '../src/provider-contract.mjs';
import {DockerEnvironmentProvider} from '../src/docker-provider.mjs';
test('future Provisioner implements independent lifecycle contract without provider-specific MCP tools',()=>{
 assert.equal(PROVIDER_CONTRACT_VERSION,1);
 const provider=Object.fromEntries(REQUIRED_PROVIDER_METHODS.map(k=>[k,async()=>{}]));
 assert.ok(assertEnvironmentProvider(provider));
 delete provider.stop;
 assert.throws(()=>assertEnvironmentProvider(provider),/stop/);
 assert.ok(assertEnvironmentProvider(Object.create(DockerEnvironmentProvider.prototype)));
});
test('lifecycle contract rejects connected/stopped conflation or fake readiness',()=>{
 for(const state of ['absent','created','stopped','running'])assert.ok(assertLifecycleReceipt({lifecycle:state,ready:state==='running'}));
 assert.throws(()=>assertLifecycleReceipt({lifecycle:'running',ready:false}));
 assert.throws(()=>assertLifecycleReceipt({lifecycle:'connected',ready:true}));
 assert.throws(()=>assertLifecycleReceipt({lifecycle:'stopped',ready:true}));
});
