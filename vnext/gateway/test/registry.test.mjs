import test from 'node:test';
import assert from 'node:assert/strict';
import {TargetRegistry} from '../registry.mjs';
import {RuntimePool} from '../runtime.mjs';

function catalog() {
  return {version: 1, default_environment_id: 'dev', targets: [{
    id: 'dev', kind: 'environment', platform: 'linux', generation: 'build-1',
    cwd: '/tmp', shell: '/bin/sh', shells: ['/bin/sh'],
    allowed: true, exec: {transport: 'stdio', binary: '/usr/bin/codex'},
    gui: {enabled: false}
  }]};
}
test('one explicit typed target and default; no implied discovery', () => {
  const r = new TargetRegistry(catalog());
  assert.equal(r.resolve().id, 'dev');
  assert.deepEqual(r.list(), [{environment_id: 'dev', kind: 'environment',
    platform: 'linux', capabilities: ['exec']}]);
  assert.throws(() => r.resolve('missing'), /environment_not_found/);
});
test('target access is checked, never inherited from another target', () => {
  const c = catalog(); c.targets[0].allowed = false;
  const r = new TargetRegistry(c);
  assert.deepEqual(r.list(), []);
  assert.throws(() => r.resolve(), /environment_access_denied/);
});
test('catalog rejects ambiguous or underspecified executor targets', () => {
  const c = catalog(); c.targets.push({...c.targets[0]});
  assert.throws(() => new TargetRegistry(c), /Duplicate target/);
  const missingDefault = catalog(); missingDefault.default_environment_id = 'bad';
  assert.throws(() => new TargetRegistry(missingDefault), /Unknown default/);
  const invalid = catalog(); invalid.targets[0].shells = [];
  assert.throws(() => new TargetRegistry(invalid), /shell allowlist/);
  const noPermission = catalog(); delete noPermission.targets[0].allowed;
  assert.throws(() => new TargetRegistry(noPermission), /Host access/);
});
test('runtime initialized once per target generation, never per tool request', async () => {
  let created = 0, initialized = 0, closed = 0;
  const r = new TargetRegistry(catalog());
  const pool = new RuntimePool(r, {connect: async () => {
    created++;
    return {sessionId: null, async initialize() {initialized++; this.sessionId = 'session-1';},
      async close() {closed++;}, lost: false};
  }});
  const [a, b] = await Promise.all([pool.binding('dev'), pool.binding()]);
  assert.equal(a.runtime, b.runtime);
  assert.deepEqual([created, initialized], [1, 1]);
  await pool.close(); assert.equal(closed, 1);
});
