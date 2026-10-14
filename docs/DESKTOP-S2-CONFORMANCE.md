# S2: Portable Desktop behavioral contract

Status: **Styx test contract only**. Not a Charon consumer integration, a release approval, or evidence of platform-wide GUI acceptance.

## Scope and ownership

Styx owns one transport-neutral Desktop implementation. Registry admission and explicitly configured Desktop grants precede any driver IO. A transport Provider establishes how an admitted Host is reached; the Desktop Core does **not** accept SSH commands, transport credentials, workspace addresses, or MCP envelopes from tool callers. The MCP Gateway adapts requests and responses at the boundary.

An attached Host does not imply a ready GUI. An Environment does not gain Host Desktop permissions through provider routing. Drivers must be registered by trusted application code, and unknown drivers fail closed.

The canonical behavioral fixture is `contracts/desktop-behavior-v1.json`; the executable Styx conformance runner is `test/desktop-behavior.test.mjs`. Both use invented resources and harmless in-process drivers, not Charon infrastructure or credentials.

## Required behaviors

| Area | Contract |
| --- | --- |
| Authorization | Default off; unknown targets and revoked grants cannot reach Desktop driver IO |
| Readiness | Host transport availability is distinct from an unlocked, permission-granted interactive session |
| Observation | The selected window ID must match the observation receipt; window inventory truncation must be explicit |
| Snapshot | At most 64 in memory; UUID bound to target and selected driver; 30,000 ms expiry, including the exact boundary |
| Session | If a driver exposes a session identity, it is pinned between observation and action; driver must revalidate exact window identity |
| Action | Exactly one bounded action; consume the snapshot before dispatch, including on errors and racing calls |
| Outcome | Dispatch alone is not verification; return `dispatched_unverified` or `outcome_unknown` with `verified:false`; ambiguous transport outcomes never cause implicit retries |
| Wait | Exact, complete title observation; bounded timeout is reported as a timeout, never as a match |
| Capture | PNG image at most 2 MiB; no persistent image storage in Desktop Core |
| Data boundary | Core responses contain no MCP `content` or `isError` envelope and cannot replace authoritative target identifiers |

The caller may independently observe again to verify a requested effect. Re-observation must mint a new snapshot; the previous snapshot remains consumed.

## Adapter and transport responsibilities

* **Hyprland:** local active-window and geometry checks, scoped screenshots and bounded keyboard/pointer actions. No claim of AT-SPI semantic element access.
* **Peekaboo:** require Screen Recording and Accessibility permissions and bind actions to a trusted exact-window receipt. Selecting an application alias is **not** by itself proof of exact-window identity; this remains an adapter-hardening item.
* **Windows native UIA:** require a proved interactive, unlocked user session; an SSH/Coder connection or UIA inspection alone is insufficient. Identity must include window handle and process/session checks.
* **Coder Provider:** owns SSH/remote execution. Any Charon-style remote worker integration belongs in the Provider/driver binding layer, never in transport-neutral Desktop Core.

## Source provenance and external dependencies

The pre-existing Styx `src/desktop` modules originated in the public Chat-Codex history (commit `4e98cbe`) before this S2 branch, under the repository's MIT license. This PR modifies that public implementation and adds newly authored generic fixtures. It **does not copy** private Charon broker/worker files, native Windows binaries, test screenshots, session identities, or private service settings.

External operating-system tools such as Hyprland CLI utilities, Peekaboo, and WinApp are optional runtime integrations, not vendored into Styx. Their individual upstream licenses, distribution terms, and Windows native dependencies must be documented and checked before incorporating any additional code or packaging binary distributions. Charon-derived native sources remain unpublished until a separate explicit provenance/license review.

## Acceptance gates and remaining gaps

1. This PR: portable behavioral fixtures and Styx local unit/contract tests; live MCP HTTP smoke tests may establish protocol behavior but **do not** establish GUI mutation on other OSes.
2. Next PR: extract one reusable Desktop Core contract from the Styx manager, with a Provider-supplied binding and no dependence on MCP/SSH envelopes. Keep the existing Gateway thin.
3. Adapter PRs: complete exact-window/session hardening and platform-compatible driver bindings. No duplicate broker in the Charon distribution.
4. Independent Styx authenticated MCP E2E: actual harmless Observe → Act → Verify on Linux, macOS, and Windows, separately. Synthetic fixtures and previous Charon tests do **not** count as Styx acceptance.
5. After platform acceptance and license/provenance checks: publish an approved pinned Styx package and test an isolated Charon consumer integration, before any production migration.

Current incompatibilities: Styx's DesktopManager still imports Registry admission directly, while Charon has remote-dispatch ownership; the underlying remote workers are not reusable via a public pinned package yet. macOS and Windows Styx authenticated real-GUI E2E have not been established. Charon production and installed Plugin/App identities remain unchanged.
