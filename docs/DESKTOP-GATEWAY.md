# Desktop-only loopback gateway

`src/desktop/gateway.mjs` provides an opt-in programmatic `startDesktopGateway` composition for independent Desktop MCP acceptance on a native machine. It shares the full server's canonical Desktop tool registration and authenticated HTTP boundary. It does not construct a Registry, HostRunner, task manager or Environment Provider, and does not change the full server's non-root Linux Host requirement.

Only `target_desktop_status`, `target_desktop_observe`, `target_desktop_act` and `target_desktop_wait` are registered. Typed target identities identify an admitted Desktop binding; they do not promise Host execution, filesystem access or lifecycle support. No grants or drivers are enabled by default. The gateway loads no caller-selected module paths and has no standalone CLI or persistent credential configuration.

## Trusted embedding

From an in-repository acceptance harness:

```js
import crypto from 'node:crypto';
import {startDesktopGateway} from '../src/desktop/gateway.mjs';

// nativeDriver must be composed by trusted code with a real native session probe.
// Admission must fail closed for every other target and update binding_revision
// whenever the admitted native binding is replaced.
const token = crypto.randomBytes(32).toString('base64url');
let enabled = true;
const {server, port} = await startDesktopGateway({
  token,
  port: 0,
  grantForTarget(target) {
    if (target.kind !== 'host' || target.id !== 'scratch') {
      throw Error('Target not admitted');
    }
    return enabled ? {enabled: true, driver: 'native', binding_revision: '1'} : null;
  },
  driverFactory(name) {
    if (name !== 'native') throw Error('Driver not admitted');
    return nativeDriver;
  },
});
// Connect an MCP client to http://127.0.0.1:${port}/mcp with
// Authorization: Bearer <token>, passed in memory, never logged or in argv.
// When the harness finishes, close its client and owned scratch application:
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
```

The caller owns cleanup and a hard outer timeout. The example assumes an already constructed `nativeDriver`; it is not a readiness bypass. Grant callbacks are synchronous, trusted Core admission functions. Keep admission state outside caller-controlled MCP arguments. A single Core instance lives across all requests, preserving snapshot expiry, target binding and single-use consumption. A successful action still reports unverified dispatch; verify the scratch application's result separately.

The transport listens only on IPv4 loopback. Port `0` chooses an ephemeral port and Host validation uses the actual bound port; explicitly selected integer ports 1–65535 are also accepted. It rejects foreign/duplicate Host, any Origin, missing/wrong/duplicate bearer headers, oversized request bodies and JSON batches. `/healthz` is unauthenticated process liveness only. The token must be a base64url string of at least 43 characters; generate it using cryptographic randomness. There is no token file, ACL policy, public listener or automatic tunnel. Full server token-file validation is unchanged.

## Evidence boundary

Fixture tests cover canonical contract parity, image/result envelopes, exact tool exposure, authentication, admission, revocation, rebinding, expiry and concurrent replay. These tests do not establish macOS or Windows native acceptance. Each real platform still requires Node 22, its public native CLI, an independently established unlocked interactive session, and an owned disposable application. Run that native flow through an authenticated client and verify application output before claiming end-to-end success. Do not replace session probes with `ready:true`, infer readiness from SSH/permissions, or operate a production desktop to fill this gap.

This entry point is available by repository-relative import for trusted harnesses. It is not a new public package subpath export or a replacement for the complete Styx server.
