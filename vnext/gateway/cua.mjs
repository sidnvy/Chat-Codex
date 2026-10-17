import fs from 'node:fs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const CONTRACT=JSON.parse(fs.readFileSync(new URL('./cua-portable-0.36.0.json',import.meta.url),'utf8'));
const COMMON_CUA_TOOLS = Object.freeze([
  'list_apps', 'list_windows', 'get_window_state', 'get_desktop_state',
  'click', 'set_value', 'type_text', 'press_key', 'scroll', 'verify_state'
]);
const READ_TOOLS = new Set([
  'list_apps', 'list_windows', 'get_window_state', 'get_desktop_state', 'verify_state'
]);
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const failure = code => ({
  isError: true, structuredContent: {error: code},
  content: [{type:'text', text: JSON.stringify({error: code})}]
});
const sessionKey = (owner, id) => JSON.stringify([owner, id]);

function requireToken(path) {
  const info = fs.statSync(path);
  if (!info.isFile() || (info.mode & 0o077)) throw Error('computer_token_permissions');
  const token = fs.readFileSync(path, 'utf8').trim();
  if (token.length < 32 || /\s/.test(token)) throw Error('computer_token_invalid');
  return token;
}

export async function connectCuaMcp(target) {
  const cfg = target.computer;
  if (!cfg || cfg.enabled !== true) throw Error('computer_disabled');
  const client = new Client({name:'styx-cua-provider', version:'0.1.0'}, {capabilities:{}});
  let transport;
  if (cfg.transport === 'stdio') {
    transport = new StdioClientTransport({
      command: cfg.binary,
      args: ['mcp', ...(cfg.socket ? ['--socket',cfg.socket] : [])],
      env: {...process.env, ...(cfg.env ?? {})},
      cwd: target.cwd
    });
  } else if (cfg.transport === 'mcp-http') {
    const url = new URL(cfg.url);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
      ['localhost','127.0.0.1','::1'].includes(url.hostname))) {
      throw Error('computer_http_requires_tls');
    }
    transport = new StreamableHTTPClientTransport(url, {
      requestInit: {headers:{Authorization:'Bearer ' + requireToken(cfg.token_file)}, redirect:'error'}
    });
  } else {
    throw Error('unsupported_computer_transport');
  }
  try {
    await client.connect(transport);
    return client;
  } catch (e) {
    await transport?.close().catch(() => {});
    throw e;
  }
}

function wrapTool(tool) {
  const schema = structuredClone(tool.inputSchema);
  if (!plain(schema) || schema.type !== 'object' || !plain(schema.properties) ||
      Object.hasOwn(schema.properties, 'environment_id')) throw Error('invalid_cua_schema');
  schema.properties.environment_id = {type:'string', description:
    'Styx execution environment; defaults to the configured default when omitted.'};
  return {
    name:tool.name, title:tool.title || tool.name,
    description:tool.description,
    inputSchema:schema,
    ...(tool.annotations ? {annotations:tool.annotations} : {})
  };
}

// The native Cua MCP server is the schema authority. Each MCP session has its
// own Cua MCP Client, so Cua's implicit session and element token cache cannot
// be shared across unrelated ChatGPT sessions.
export class CuaProvider {
  constructor({registry, connect=connectCuaMcp, toolNames=COMMON_CUA_TOOLS,
    manifest=CONTRACT} = {}) {
    if (!registry || typeof registry.resolve !== 'function' ||
        typeof connect !== 'function') throw TypeError('Cua registry and connector required');
    this.registry = registry; this.connect = connect;
    this.toolNames = new Set(toolNames);
    this.manifest=manifest;
    this.schema=(manifest.tools??[]).filter(t=>this.toolNames.has(t.name))
      .map(t=>wrapTool(t));
    this.sessions = new Map(); this.pending = new Map();
    this.stopped = false;
  }

  #target(environmentId) {
    const target = this.registry.resolve(environmentId);
    if (target.computer?.enabled !== true) throw Error('computer_not_available');
    return target;
  }

  async #get(owner, target) {
    if (this.stopped) throw Error('computer_provider_closed');
    if (typeof owner !== 'string' || !owner) throw Error('invalid_owner');
    const key=sessionKey(owner, target.id);
    const current = this.sessions.get(key);
    if (current) {
      if (current.generation !== target.generation) {
        this.sessions.delete(key);
        await current.client.close().catch(() => {});
        throw Error('computer_generation_changed');
      }
      return current.client;
    }
    const opening = this.pending.get(key);
    if (opening) return opening;
    const promise = (async () => {
      const client = await this.connect(target,owner);
      if (this.stopped) {await client.close(); throw Error('computer_provider_closed');}
      const identity=client.getServerVersion?.();
      if (!identity || identity.name!==this.manifest.driver ||
        identity.version!==this.manifest.version) {
        await client.close();
        throw Error('computer_version_mismatch');
      }
      // Re-read admission after an asynchronous connection handshake.
      const now = this.#target(target.id);
      if (now.generation !== target.generation) {
        await client.close();throw Error('computer_generation_changed');
      }
      const snapshot = {generation:target.generation,client};
      this.sessions.set(key,snapshot);
      return client;
    })();
    this.pending.set(key,promise);
    try {return await promise;} finally {
      if (this.pending.get(key) === promise) this.pending.delete(key);
    }
  }

  async listTools() {
    return this.schema;
  }

  async callTool(name,args={},owner) {
    if (!this.toolNames.has(name)) return failure('unknown_tool');
    if (!plain(args)) return failure('invalid_arguments');
    const {environment_id,...nativeArgs}=args;
    if (environment_id!==undefined && (typeof environment_id!=='string' ||
      !environment_id)) return failure('invalid_environment');
    const tool=this.schema.find(x=>x.name===name);
    if (!tool) return failure('unknown_tool');
    const permitted=tool.inputSchema.properties;
    if (Object.keys(nativeArgs).some(k=>!Object.hasOwn(permitted,k)) ||
      (tool.inputSchema.required||[]).some(k=>!Object.hasOwn(nativeArgs,k)))
      return failure('invalid_arguments');
    try {
      const target=this.#target(environment_id);
      const client=await this.#get(owner,target);
      // Native Cua tools validate their own official input schema.
      // Never modify tool arguments or substitute another target on failure.
      return await client.callTool({name, arguments:nativeArgs});
    } catch (e) {
      const code = e.message;
      if (['environment_not_found','environment_access_denied','computer_not_available',
        'computer_generation_changed','computer_version_mismatch',
        'invalid_owner','computer_provider_closed'].includes(code))
        return failure(code);
      return failure('computer_transport_unavailable');
    }
  }

  async closeOwner(owner) {
    const prefix=JSON.stringify([owner]).slice(0,-1)+',';
    await Promise.allSettled([...this.sessions.entries()].filter(([k])=>k.startsWith(prefix))
      .map(async ([key,item])=>{this.sessions.delete(key);await item.client.close();}));
  }
  async close() {
    this.stopped=true;
    await Promise.allSettled([...this.pending.values()]);
    await Promise.allSettled([...this.sessions.values()].map(x=>x.client.close()));
    this.sessions.clear();this.pending.clear();
  }
}
