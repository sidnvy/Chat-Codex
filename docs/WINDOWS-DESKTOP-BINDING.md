# Windows Desktop target binding

The public `WinappDesktop` adapter requires a canonical positive Windows PID for every exact HWND observation and action. Inventories may expose a handle without a PID, but that entry cannot produce a mutation receipt. The adapter compares HWND ownership before and after UIA inspection and again before mutation. Missing PID, changed owner, duplicate handle, expired receipt, and unobserved element selectors fail closed. Selectors longer than the contract limit are omitted instead of truncated into a different selector.

## Trusted session composition

`new WinappDesktop(run, sessionProbe)` requires the trusted probe to return `{ready:true, session_id:'opaque-generation'}`. Boolean true, missing identity, and truthy strings do not establish readiness. The adapter pins this identity into the receipt and rechecks it after asynchronous inventory/inspection and immediately before dispatch. The built-in catalog still injects no proof and therefore remains `session_unverified`.

A native provider must independently prove that its execution account owns the active unlocked input desktop and supply a generation that changes when that logon/session is replaced. A Coder/SSH connection, Explorer process, UIA inventory, numeric SessionId alone, or `winapp ui` availability is insufficient. This change supplies the composition contract, not an untested native Windows session verifier. No private Charon code is incorporated.

HWND/PID continuity does not identify a process creation time: identical PID and HWND reuse within one observation lifetime remains a platform limitation. A future audited native binding needs process-generation proof and atomic target validation at dispatch. Separate CLI calls necessarily retain a final check-to-dispatch race; this PR does not claim to remove it.

## Upstream CLI and screenshots

Inspected Microsoft WinApp CLI source at `d399e3151db3a6e549ca4ac9d9cbeefa21260ed8`:

- [UI automation contract](https://github.com/microsoft/winappCli/blob/d399e3151db3a6e549ca4ac9d9cbeefa21260ed8/docs/ui-automation.md): exact numeric `-w` HWND targeting, `inspect`, `invoke`, and `set-value`.
- [Screenshot implementation](https://github.com/microsoft/winappCli/blob/d399e3151db3a6e549ca4ac9d9cbeefa21260ed8/src/winapp-CLI/WinApp.Cli/Commands/UiScreenshotCommand.cs): `-w` capture can include owned windows, and unavailable frame capture can fall back to foregrounding the target.

Consequently this adapter does not advertise screenshots or silently add a capture that may change focus. Exact, nonmutating capture and native-session evidence require separate acceptance. No executable is installed or redistributed here, and fixtures are not evidence for a specific installed WinApp release.

## Optional native scratch check

`scripts/windows-desktop-acceptance.mjs` creates its own disposable PowerShell WinForms window, locates only that process/title, invokes the adapter through the shared Core, sets a uniquely identified edit field, verifies replay rejection, invokes its own button, and checks exact scratch-process stdout. It never selects a pre-existing application for mutation.

Prerequisites: Windows, Node22 with repository dependencies, public `winapp` on PATH, PowerShell/WinForms, an unlocked authorized session, and a separately audited local module exporting `sessionProbe()` with the proof contract above. Run from that interactive user's terminal:

```powershell
$env:STYX_WINDOWS_PROBE_MODULE = 'C:\audited\native-session-proof.mjs'
node scripts/windows-desktop-acceptance.mjs
```

The script does not change execution policy, privileges, Defender, session locks, or system configuration. If existing policy blocks the scratch script, report that blocker rather than bypassing it. It closes only the window/process it creates and removes its temporary script. The 30-second acceptance deadline bounds the flow; native CLI operations retain their existing per-call timeout.

This harness is unexecuted on a real Windows session in this change. It tests a direct native adapter composition, not authenticated MCP or screenshots. The present generic local Host runner is Linux-only; an independent Windows-compatible runtime/transport and native proof must be established before claiming complete Styx Windows acceptance. The connected private distribution's readiness is not a substitute. Current inspected test Host lacks public Node and WinApp prerequisites, so no runtime installation or live mutation was attempted.
