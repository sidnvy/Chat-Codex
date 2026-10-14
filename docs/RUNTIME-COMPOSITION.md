# Styx S1 — Runtime composition boundary

This is an incremental public implementation of the foundation described in
RFC-0002. It is **not** yet a published npm SDK, a private Charon dependency
or proof of wire-level Charon compatibility.

## Trusted composition API

The built-in Styx Server continues to work without any injected options.
A distributor or third-party integrator may supply trusted catalog objects
when invoking `start(privateConfigFile, options)` from JavaScript:

```js
import {z} from 'zod';
import {start} from '../src/server.mjs';
import {createBuiltInEnvironmentCatalog} from '../src/runtime/providers.mjs';
import {ExtensionCatalog} from '../src/runtime/extensions.mjs';

const providers=createBuiltInEnvironmentCatalog();
providers.register('external',registry=>createReviewedProvider(registry));

const extensions=new ExtensionCatalog();
extensions.register({
  id:'diagnostics',
  tools:[{
    name:'inspect',description:'Inspect an admitted execution target',
    readOnly:true,
    schema:z.object({target:z.object({
      kind:z.enum(['host','environment']),
      id:z.string()
    }).strict()}).strict(),
    handler:({target},api)=>api.targetStatus(target),
  }],
});

await start('/private/config.json',{
  environmentCatalog:providers,
  extensionCatalog:extensions
});
```

The example `createReviewedProvider` is a placeholder supplied by the
integrator. It must implement the existing `PROVIDER_CONTRACT_VERSION=1`:
`status/create/start/stop/delete/run`. Core validates lifecycle receipts,
ready-state consistency, provider ID and registered target identity. Each
Environment's private config declares its provider ID; **unknown providers
are rejected before runtime I/O**, with no fallback to Docker or Host.

The `external` Provider is not loaded by name from a config path or MCP request.
The Server owner must explicitly register a reviewed factory.

## Extension gates

Extension code is trusted in-process JavaScript, **not an isolation boundary**.
Install only reviewed code that you would trust with the Server process's OS
permissions. Config grants control whether extension tools are published, not
what an in-process module could theoretically access.

Two independent conditions are required:

1. The Server entrypoint supplies the trusted extension factory/object.
2. Its ID appears in the operator-owned private `config.json` `extensions`
   array, e.g. `["diagnostics"]`.

If either is absent, the tool is not registered. An unrecognized grant fails
startup rather than falling back to another extension. Once the Server starts,
registries are sealed against changing factories.

Tool names are automatically namespaced `ext_<id>_<action>`. Extensions
cannot overwrite built-in `target_*`, `host_*`, `environment_*`,
`project_*` or Desktop tools. Their arguments must have a Zod schema.
Errors do not leak raw exception messages, and result JSON is capped to 64 KiB.
Registered tools have explicit read-only or mutating annotations; annotations
alone are not a security authorization mechanism.

The handler receives only a narrow frozen object:

- `api.listProjects()`
- `api.targetStatus(typedTarget)`, which uses Core's registered Target Router

No raw token, mutable Registry, private file paths or underlying backend is
provided as API context. Additional capabilities such as file mutation or
service deployment require a separately reviewed contract and grant.

## Identity and compatibility

- Project remains independent of Environment and Host.
- A provider cannot create/delete a Host through Environment lifecycle tools.
- Docker retains its existing default, security settings and lifecycle API.
- MCP tool names and v0.3.0 package/Plugin/MCP versions remain unchanged.
- `contracts/shared-mcp-tool-names.json` records **24 overlapping tool names**
  for later Charon conformance checks. It does **not** assert input/output
  wire compatibility.
- Coder Provider, Windows Desktop session-local transport, production Charon
  composition and release changes remain future separately reviewed slices.

## Verification

```sh
npm test
npm run test:integration
```

The isolated runtime composition test uses a real authenticated MCP SDK client
against a temporary HTTP Styx Server, exercises an injected fake Environment
Provider, denies unknown targets before backend I/O, validates opt-in extension
visibility and rejects ungranted tools. Existing Docker integration must also
remain green.

There is no automatic Plugin update, install identity change, public endpoint,
Charon deployment or physical host modification in this slice.
