# Native macOS scratch acceptance

`scripts/macos-desktop-acceptance.mjs` is an opt-in, unexecuted native acceptance
harness. It requires the independently reviewed hardened Peekaboo adapter with
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
No real GUI execution or acceptance has been recorded for this harness yet.
