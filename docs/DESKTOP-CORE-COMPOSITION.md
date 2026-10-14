# S2: Shared Desktop Core composition

Status: proposed, independently reviewable Styx extraction. No Charon production migration or package release.

## Single implementation

`src/desktop/core.mjs` implements the snapshot, observation, action, wait and outcome semantics once. It imports the shared Desktop input contract and cryptographic UUID generator. It imports **neither** Styx Registry/Provider modules **nor** the MCP SDK, Coder transport, SSH, environment catalogs, or OS-specific drivers.

`src/desktop/manager.mjs` is only a compatibility adapter for Styx's existing Registry grants. It extends `DesktopCore` and injects Registry admission plus the local trusted driver catalog; it contains no Desktop action semantics. The existing MCP Gateway invokes that adapter without a public MCP change.

An alternate trusted Provider composition can construct `DesktopCore` with:

- `grantForTarget(target)`: authoritatively reject unadmitted targets; return `{enabled:true,driver:'audited-name'}` only for an explicit Desktop grant. Return missing/disabled Desktop grants for default-off targets.
- `driverFactory(name,{target,grant})`: create an audited driver already bound to its authorized execution target and session-local transport. Never accept a user-supplied factory/module path or network address.
- `clock()`: optional test clock; production defaults to wall time.

Provider bindings can supply an opaque `binding_revision` string on the grant. Changing it replaces the cached binding for the target and therefore invalidates any outstanding snapshot, even if the factory returns the same driver object. Admission must be synchronous and return literal `enabled:true` with a valid audited driver name. Core checks admission again after asynchronous readiness and observation, and immediately before action dispatch. An observed revocation or admission error discards the binding; subsequent reauthorization cannot revive its snapshots. Providers must rotate the revision on every rebind or revoke/regrant transition, including transitions that occur entirely between Core calls. Core cannot observe an unreported transition. Private workspace, Host connection, authentication and network configuration remain exclusively Provider-owned.

Drivers implement `status()`, `observe()`, and `act(receipt,action)`; must validate an exact window and interactive session themselves; must not mark dispatch alone as `verified:true`. Core refuses replay and returns an explicit uncertain outcome for ambiguous dispatch errors, without silently reissuing an action.

## Boundaries and compatibility

This extraction reuses the already public Styx Desktop implementation from its Chat-Codex history; no Charon private workers or Windows native code were copied. Existing Styx callers retain `new DesktopManager(registry, options)`.

This is a **composition seam**, not a functioning Coder Provider implementation. A future private Charon consumer must use a pinned Styx package artifact and bind its remote driver to the Provider; it must not retain a second implementation of broker action semantics. Production service routing, OS security, installed Plugins and identities remain unchanged.

Live Linux Styx GUI acceptance of the pre-extraction S2 code is recorded on PR #9. The extracted Core still requires its own test and review gates; macOS and Windows independent authenticated Styx GUI acceptance remain separate release blockers.
