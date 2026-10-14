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
| Observation | The selected window ID and all receipt window identifiers (window_id/HWND) must agree; inventory and title truncation must be explicit |
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
2. Shared Core extraction: `DesktopCore` owns behavioral semantics with injected admission and trusted driver bindings; `DesktopManager` is the Registry compatibility adapter. See `DESKTOP-CORE-COMPOSITION.md`. The Gateway remains unchanged.
3. Adapter PRs: complete exact-window/session hardening and platform-compatible driver bindings. No duplicate broker in the Charon distribution.
4. Independent Styx authenticated MCP E2E: actual harmless Observe → Act → Verify on Linux, macOS, and Windows, separately. Synthetic fixtures and previous Charon tests do **not** count as Styx acceptance.
5. After platform acceptance and license/provenance checks: publish an approved pinned Styx package and test an isolated Charon consumer integration, before any production migration.

Current incompatibilities: Charon still owns independent remote-dispatch and broker semantics; its remote workers are not reusable via a public pinned Styx package yet. The Core composition seam alone does not establish consumer compatibility. macOS and Windows Styx authenticated real-GUI E2E have not been established. Charon production and installed Plugin/App identities remain unchanged.

## Hyprland session and process receipt hardening

The local Hyprland adapter requires explicit boolean unlocked evidence and a
trusted compositor instance signature (`HYPRLAND_INSTANCE_SIGNATURE`). It exposes
only a SHA-256 session fingerprint, binds exact-window receipts to the compositor
generation and positive process ID, and rechecks foreground identity, geometry,
and readiness after capture and before dispatch. Coordinate clicks recheck after
pointer movement before emitting the click. A missing signature fails closed.

Trusted compositions may inject a session identity callback as the optional second
constructor argument, alongside their target-bound execution adapter. This is a
trusted composition seam, never a model-supplied session identity. The callback
and execution adapter must identify the same compositor. Process IDs reduce
window-address reuse risk but do not establish process start time; this is not an
atomic desktop transaction. No private implementation was copied.
