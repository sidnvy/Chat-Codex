import {ExecAdapter} from '../packages/styx-exec-adapter/adapter.mjs';
import {TargetRegistry} from './registry.mjs';
import {RuntimePool} from './runtime.mjs';
import {createGatewayMcp} from './mcp.mjs';

export function createStyxGateway({catalog, connect, gui = null}) {
  const registry = catalog instanceof TargetRegistry ? catalog : new TargetRegistry(catalog);
  const pool = new RuntimePool(registry, {connect});
  const exec = new ExecAdapter({resolve: async (id, _owner) => pool.binding(id)});
  return {
    registry, pool, exec, gui,
    serverForOwner(owner) { return createGatewayMcp({exec, gui, registry, owner}); },
    async close() { await gui?.close?.(); await exec.cleanup(); await pool.close(); }
  };
}
