# One-shot Hyprland worker

Trusted remote providers can consume the canonical adapter without maintaining a second implementation:

```js
import {createHyprlandWorkerSource} from 'chat-codex/desktop/hyprland-worker';
const source=createHyprlandWorkerSource({timeoutMs:10000,maxImageBytes:1048576});
// Execute using an admitted Host transport under its existing desktop identity:
// node -e SOURCE -- BASE64_JSON_REQUEST
```

The synchronous factory reads a closed set of modules from the installed artifact: dependency-free desktop primitives, command execution helpers, the actual Hyprland adapter, and the worker protocol. It rewrites their fixed relative imports into data URLs. It accepts no caller paths or source code. No adapter class is copied, no Zod or MCP dependency is loaded on the Host, and no package installation, persistent listener, credential, privileged helper, or session switching occurs. The generated source fits below 100 KiB and is tested with actual subprocess execution from an empty directory.

Requests are canonical base64 JSON, at most 8192 encoded characters. Supported operations are `status`, `windows`, `window` with `window_id`, and `act` with the previously returned `window`, opaque `receipt`, and action. Actions are deliberately restricted to `type` (1–500 characters) and the adapter's audited `key` allowlist. Coordinate clicks are not exposed. Receipts expire after 30 seconds, checked again immediately before native dispatch. Providers must still use Core's target-bound, single-use snapshots and authoritative admission checks; the worker itself is stateless and is not a replay store.

Responses are `{ok:true,result}` or `{ok:false,error}` with bounded error codes and no native stderr. A failure after entering native input returns `outcome_unknown`, `verified:false`; providers must not retry it. Successful dispatch remains `dispatched_unverified`, `verified:false`. Status strips raw error text and pointer capability; window projection omits workspace metadata. Native receipt details remain private to the trusted provider, never model-facing output.

The deadline is 100–10000 ms, with native child cancellation and capture cleanup. The image limit is 100–2097152 bytes, default 1 MiB; the entire serialized response is limited to 2 MiB, so a configured image limit near 2 MiB can still be rejected after base64 expansion. Captures require the complete PNG signature. A transport must independently enforce its execution/output limits and safely quote or structurally transmit the source and base64 request. No arbitrary caller environment variables or executable paths are accepted by this factory.

The Host must already provide Node 22+, `hyprctl`, `grim`, `wtype`, and the correct inherited Hyprland session environment. The canonical adapter's `HYPRLAND_INSTANCE_SIGNATURE` check is retained; it is not a separate OS logon-generation attestation. Long titles beyond the adapter's 128-character inventory projection currently fail closed during exact observation. This worker does not broaden those guarantees or promise parity with unrelated platform workers.

Validation uses native-command fixtures rather than a real desktop: generated-source execution, exact receipt checks, capture cleanup, literal arguments, bounded failures, and packed-artifact imports. Real Host acceptance remains a separate provider-owned gate.
