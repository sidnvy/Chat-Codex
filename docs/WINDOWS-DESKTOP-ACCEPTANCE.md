# Windows native Desktop acceptance

This optional harness uses public Microsoft Windows APIs and WinApp CLI v0.7.1; it incorporates no private Host implementation. It creates and mutates only its own WinForms scratch process, selected by exact PID, full unique title and discovered HWND. The built-in Desktop catalog stays default-off and the full Host runner stays Linux-only.

## Native console proof

`scripts/windows-session-probe.ps1` uses PowerShell 5.1 `Add-Type` and read-only P/Invoke. `scripts/lib/windows-session.mjs` validates the full evidence conjunction from two native reads. Readiness requires:

- Windows 8 or later semantics, excluding the documented Windows 7/Server 2008 R2 reversed lock flags.
- The probe process's nonzero session equals the active physical-console session and WTS extended information reports that same session, `WTSActive` and `WTS_SESSIONSTATE_UNLOCK`.
- The WTS session owner's resolved SID equals the execution token's user SID.
- The process window station is `WinSta0`; both input desktop and calling-thread desktop are `Default` and report receiving input through `UOI_IO`.
- A positive WTS logon time and stable opaque SHA-256 generation across the two reads, derived from owner SID, session number and logon time.

Unknown, missing, malformed, mismatched or failed native evidence denies readiness. A service/session0 shell and an RDP-only session outside the active physical console are intentionally unsupported. `OpenInputDesktop` alone is insufficient: Microsoft documents that it can return a desktop handle for disconnected sessions. No `SwitchDesktop`, `SetThreadDesktop`, unlock, impersonation, privilege elevation or policy changes are performed. Opened desktop handles/WTS buffers are released; borrowed thread/station handles are not closed.

The probe is a repeated point-in-time check, not an atomic input lease. A lock/switch after the final check remains a race. Its generation identifies a console logon, not a process creation time; existing HWND/PID same-process reuse limitations remain documented in [target binding](WINDOWS-DESKTOP-BINDING.md). The probe subprocess inherits its invoking process's session/window-station context; no alternate session is attached automatically.

## Run only on an admitted scratch session

Prerequisites: Node 22 with this repository's dependencies, PowerShell/WinForms with existing policy permitting these scripts and `Add-Type`, an authorized unlocked console owned by the execution account, and the reviewed public `winapp` executable on a task-local PATH. No global installation or .NET SDK is required by the probe; runtime compilation may create normal temporary compiler artifacts. Do not bypass execution policy or application control if they deny it.

```powershell
node scripts/windows-desktop-acceptance.mjs --preflight
node scripts/windows-desktop-acceptance.mjs --gateway
```

Preflight only checks native readiness and public CLI inventory. The full run creates an owned scratch form, sets its unique edit control, checks snapshot replay rejection, re-observes, invokes its unique button, and independently verifies exact scratch stdout. The form remains alive through native receipt verification; cleanup then terminates only that owned process. A verified stdout effect with an uncertain native receipt is reported diagnostically but does not count as a passing acceptance run. Screenshots are not tested or advertised.

`--gateway` starts the shared loopback-only Desktop gateway with a random bearer token held in memory, verifies missing/wrong bearer rejection and exactly four Desktop tools, and performs the flow through an MCP client. Omitting `--gateway` uses direct Core and reports `authenticated_mcp:false`. Neither enables Host execution/filesystem/lifecycle tools. Tokens, raw native errors, typed values, titles, SIDs and session IDs are not logged; diagnostics contain only phase/category/timing and allowlisted error codes.

Native commands have 10-second timeouts. The 90-second scratch deadline revokes admission and aborts in-flight native children; owned process exit fails promptly. The adapter's 30-second receipt lifetime is unchanged. The external caller should also impose a hard process deadline and clean up only the harness-owned scratch if the controller is forcibly terminated. No native success is implied by source review, fixture tests, preflight or connected private distribution status.

## Public source references

- [WTSINFOEX_LEVEL1_W](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/ns-wtsapi32-wtsinfoex_level1_w): layout, lock flags, historical inversion, logon time.
- [WTSQuerySessionInformationW](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsquerysessioninformationw) and [WTSGetActiveConsoleSessionId](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-wtsgetactiveconsolesessionid): local session evidence and physical-console identity.
- [OpenInputDesktop](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-openinputdesktop) and [GetUserObjectInformationW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getuserobjectinformationw): read-only desktop access, `UOI_NAME` and `UOI_IO`.
- [WinApp explicit invoke](https://github.com/microsoft/winappCli/blob/e3cd0b94f3e7b776ac51ba0564f4908094e979b5/src/winapp-CLI/WinApp.Cli/Commands/UiInvokeCommand.cs), [set-value](https://github.com/microsoft/winappCli/blob/e3cd0b94f3e7b776ac51ba0564f4908094e979b5/src/winapp-CLI/WinApp.Cli/Commands/UiSetValueCommand.cs), and [JSON models](https://github.com/microsoft/winappCli/blob/e3cd0b94f3e7b776ac51ba0564f4908094e979b5/src/winapp-CLI/WinApp.Cli/Helpers/UiJsonContext.cs).
