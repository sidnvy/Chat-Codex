import path from 'node:path';

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function requireValue(ok, message) { if (!ok) throw new TypeError(message); }

export class TargetRegistry {
  constructor(config) {
    requireValue(plain(config) && config.version === 1, 'Unsupported target catalog');
    requireValue(Array.isArray(config.targets) && config.targets.length <= 64, 'Invalid targets');
    this.targets = new Map();
    for (const target of config.targets) {
      requireValue(plain(target) && idPattern.test(target.id ?? ''), 'Invalid target id');
      requireValue(!this.targets.has(target.id), 'Duplicate target id');
      requireValue(['host', 'environment'].includes(target.kind), 'Invalid resource kind');
      requireValue(['linux', 'darwin', 'win32'].includes(target.platform), 'Invalid platform');
      requireValue(typeof target.generation === 'string' && target.generation.length > 0,
        'Target generation required');
      requireValue(typeof target.cwd === 'string' && path.isAbsolute(target.cwd), 'Absolute cwd required');
      requireValue(typeof target.shell === 'string' && path.isAbsolute(target.shell), 'Absolute shell required');
      requireValue(Array.isArray(target.shells) && target.shells.includes(target.shell) &&
        target.shells.every(s => typeof s === 'string' && path.isAbsolute(s)),
      'Explicit shell allowlist required');
      requireValue(typeof target.allowed === 'boolean', 'Host access decision required');
      const transport = target.exec;
      requireValue(plain(transport) && ['websocket', 'stdio'].includes(transport.transport),
        'Invalid executor transport');
      if (transport.transport === 'websocket') {
        requireValue(typeof transport.url === 'string' &&
          (transport.url.startsWith('ws://') || transport.url.startsWith('wss://')),
        'WebSocket URL required');
      } else {
        requireValue(typeof transport.binary === 'string' && path.isAbsolute(transport.binary),
        'Absolute local binary required');
      }
      requireValue(target.env === undefined || (plain(target.env) &&
        Object.values(target.env).every(v => typeof v === 'string')), 'Invalid command environment');
      requireValue(target.gui === undefined || (plain(target.gui) &&
        typeof target.gui.enabled === 'boolean'), 'Invalid GUI capability');
      this.targets.set(target.id, Object.freeze({...target}));
    }
    requireValue(config.default_environment_id === undefined ||
      this.targets.has(config.default_environment_id), 'Unknown default target');
    this.defaultId = config.default_environment_id;
  }
  resolve(id) {
    const actual = id === undefined ? this.defaultId : id;
    if (typeof actual !== 'string') throw new Error('default_environment_required');
    const item = this.targets.get(actual);
    if (!item) throw new Error('environment_not_found');
    if (!item.allowed) throw new Error('environment_access_denied');
    return item;
  }
  list() {
    return [...this.targets.values()].filter(t => t.allowed).map(t => ({
      environment_id: t.id, kind: t.kind, platform: t.platform,
      capabilities: ['exec', ...(t.gui?.enabled ? ['computer'] : [])]
    }));
  }
}
