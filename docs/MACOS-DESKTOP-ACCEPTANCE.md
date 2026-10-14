# Native macOS scratch acceptance

`scripts/macos-desktop-acceptance.mjs` is an opt-in native acceptance harness. It requires the independently reviewed hardened Peekaboo adapter with
`new PeekabooDesktop(run, sessionProbe)` and process/session-bound exact-window
receipts. It does not establish macOS acceptance merely by compiling or passing
portable fixtures.

The probe reads native `/usr/sbin/ioreg -n Root -d1 -a` through Python plistlib.
It requires `IOConsoleLocked` to be boolean false and exactly one active,
logged-in console row matching the effective UID. An opaque SHA-256 generation
binds that UID, the console session UUID and session ID. Missing, ambiguous or
malformed evidence denies readiness; shell access and permission grants alone
are insufficient. No raw session UUID or account name is emitted.

Prerequisites: non-root macOS user in an unlocked authorized session, Node22,
Swift compiler/AppKit, Python3, pinned audited Peekaboo CLI/bridge, existing
Screen Recording and Accessibility permission, and repository dependencies.
The script neither installs prerequisites nor changes TCC, screen locks or
security configuration. A read-only preflight is available:

```sh
/absolute/path/to/node22 scripts/macos-desktop-acceptance.mjs --preflight
```

After independent review and explicit coordinator scheduling, run the same
command without `--preflight`. It creates a direct shared `DesktopCore` composition
with an explicit scratch-only grant, then compiles and launches its own AppKit
scratch application. It selects only the scratch process's exact PID and unique
title, captures a PNG, types a nonce, rejects snapshot replay, reobserves, invokes
the unique scratch button, and compares the scratch process stdout with that
nonce. The app foregrounds only its own new scratch window. Cleanup revokes the
harness grant and removes only its own process and temporary files. Ambiguous
mutation failures are never retried. Output explicitly states
`authenticated_mcp:false`: this is native Core/adapter acceptance, not full MCP.

Current server revisions that restrict local Host admission to Linux cannot run this native Desktop flow through the MCP gateway. Do not bypass that restriction by spoofing platform
or replacing admission with a fixture. A separately reviewed macOS Host
admission/runner portability change is required before a separate authenticated
`start(config, {desktopCatalog})` acceptance flow can run. The harness does not use private
Charon code or claim the private distribution consumes Styx.

Read-only workstation preflight on 2026-10-14 found Node22 and Swift available.
Desktop readiness changed between observations; a later native OS sample was
unlocked with one matching active user and a session UUID. Those historical
samples do not authorize a later GUI run: the harness must obtain fresh proof.
Native attempts on 2026-10-14 did not pass acceptance. The original 60-second
attempt expired without phase evidence. A subsequent fresh scratch with measured
slow inventory reached real PNG capture, then returned `outcome_unknown` at the
type dispatch; it was not retried. Cleanup was independently checked: zero owned
scratch, acceptance Node or Peekaboo CLI processes remained. Neither attempt is
an acceptance success.

Sanitized phase and native-command category/elapsed logs contain no command
arguments, target IDs, input values, session identities or screenshots. An abort
controller kills in-flight native command children and awaits settlement before
removing scratch files; the Core grant is revoked before cleanup. The default
scratch deadline remains 60 seconds. `--inventory-preflight` is read-only and
measures native inventory cost; only after demonstrated progress may an operator
choose `--slow-inventory` for a 180-second scratch deadline. One measured inventory
took 31,261 ms with 54 total completed commands, motivating the explicit slow
mode. Never repeat an uncertain mutation against an old scratch target; any new
independent test requires a newly created scratch and renewed readiness gates.


## Optional authenticated desktop-only gateway

With the separately reviewed `src/desktop/gateway.mjs` and its pinned SDK
dependencies present, `--gateway` routes the identical scratch sequence through
that loopback Desktop-only MCP gateway. A fresh bearer token exists only in
memory. The harness verifies missing/invalid bearer rejection, exactly four
Desktop tools, PNG MCP content, explicitly unverified action receipts, and the
specific replay rejection before validating the native stdout oracle. It does
not enable Host execution/filesystem or alter `validateHost`. Successful output
marks `authenticated_mcp:true` only when this mode actually completes. The
shared gateway and final adapter revisions must be independently reviewed before
a native run. No authenticated success is claimed by preparation alone.

The scratch commit button deliberately keeps its application and window alive:
it changes only its own button label/editability and emits the marker once.
The harness verifies exact stdout and that the scratch still exists after the
native receipt returns, then its own cleanup terminates the process. Destroying
the target inside its click callback races native post-dispatch target checks
and can legitimately yield an indeterminate receipt even when stdout proves the
effect. Keeping it alive removes that artificial harness race; it does not relax
the required `dispatched_unverified` / `verified:false` receipt or any native
identity/session check. A prior closing-window run remains documented separately
as verified effect with unknown receipt, never retroactively marked passing.
