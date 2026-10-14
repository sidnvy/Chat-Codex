# Canonical Windows worker

`createWindowsWorkerSource` from `chat-codex/desktop/windows-worker` packages the actual `WinappDesktop` implementation with a fixed dependency graph. It requires trusted SHA-256 values for WinApp and its HarfBuzz/Skia libraries. The provider stages the returned source in an owned file and starts Node 22 with `worker.mjs --winapp-path C:\reviewed\winapp.exe`. This startup argument is operator configuration, never model input. Files are hashed before native commands; the operator must keep the installation protected against concurrent replacement.

One JSON request is read from stdin, at most 64 KiB. Operations are `status`, `windows`, `window`, and `act`. Responses are `{ok:true,result}` or `{ok:false,error}` with fixed error codes. The default total deadline is 28 seconds (trusted range 100–28000 ms), output is at most 2 MiB, and captures at most 384 KiB. The generated source exceeds Windows command-line limits: do not pass it through `node -e`. Source staging, a verified Node installation, request delivery and owned-source cleanup belong to the transport. No Node runtime or WinApp installer is bundled.

Window observation exposes `elem_0` through `elem_99`; the private receipt contains their canonical selector mapping, hashed property evidence and native identity. Core owns admission, snapshot sealing and one-use semantics. Receipts and worker requests are internal to trusted transports; this executable is not an independently authenticated service. There is no arbitrary selector fallback. The adapter verifies fresh selector/type/name/automationId/className evidence, enabled state, offscreen state and invoke capability. Set-value requires Edit, at most 500 characters, no NUL, and no leading `-` or `@`. Explicit invoke and exact result identities preserve the existing canonical adapter's stronger dispatch checks. Once dispatch begins, errors are unknown outcomes with no retry or verified-success claim.

Native identity binds HWND, PID, process creation time, session, token SID, target thread Default/input-receiving desktop proof and a full-title digest. The target thread desktop is queried through a borrowed handle without closing or switching it. Read-only console session evidence is checked around each native probe. The PowerShell script uses query-only process/token access and never changes execution policy, desktop, privileges or focus. Admission is restricted to the active console session. An active RDP session admitted by an earlier private adapter may now fail closed; this is not a claim of full session-admission parity. Native availability is required; unsupported systems and missing permissions fail closed. Window ownership checks and TTL are repeated immediately before dispatch; they do not form an atomic lease against external desktop changes.

Capture uses only `PrintWindow` on the selected HWND, a fresh bounded bitmap, and before/after identity checks. There is no desktop DC capture, screen blit, foreground activation or fallback to another HWND. The owning application renders this image; unsupported apps may return a blank frame or fail. A valid PNG is evidence of capture, not a guarantee that every application rendered useful pixels. Images are encoded in memory, with no screenshot file to leave behind. The temporary probe script is removed in `finally`.

The pinned WinApp v0.7.1 `UiScreenshotCommand.cs` expands selectorless captures into owned windows, and its capture service has screen fallback paths. Consequently this worker does not call `winapp ui screenshot`. Private-consumer migration must retain actual screenshot coverage, not remove it based on fixture assumptions.

## Implementation provenance

New native code is based on the public API contracts, not a port of a private worker:

- [GetThreadDesktop](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getthreaddesktop): query the target thread desktop through a borrowed handle.
- [GetUserObjectInformationW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getuserobjectinformationw): bounded desktop name and input-receiving evidence.
- [GetWindowThreadProcessId](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowthreadprocessid): selected HWND owner.
- [GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes): creation FILETIME, queried with limited process access. Exit time is undefined for running processes and is not used.
- [WindowsIdentity(IntPtr)](https://learn.microsoft.com/en-us/dotnet/api/system.security.principal.windowsidentity.-ctor?view=netframework-4.8.1): token SID comparison.
- [PrintWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-printwindow): synchronous HWND rendering, bounded by the outer child-process deadline, using documented default full-window flags.
- Public WinApp source pinned at `e3cd0b94f3e7b776ac51ba0564f4908094e979b5`: `WinApp.UIAutomation/Models/UiElement.cs`, constrained search, explicit invoke and exact response schemas.
- Existing public `scripts/windows-session-probe.ps1`: console/logon generation and desktop evidence, embedded without a policy override.

Native compilation/capture/action acceptance on Windows is a required release gate. Linux fixture tests alone do not establish this gate.

Inventory preserves explicit provider incompleteness and marks duplicate or malformed rows incomplete. Exact-title filtering can exclude unrelated inaccessible rows; an inaccessible matching candidate remains incomplete. Confirmed foreign-scope native refusals are conservatively incomplete too, rather than asserting a complete inventory.

The `windows-native-compilation` CI job compiles the exact embedded session and window C# declarations using Windows PowerShell. A shared source builder supplies both the runtime worker and this compile-only check. The check invokes no session Read, HWND Read, capture or input, and changes no execution policy. Non-Windows runs explicitly skip it; that skip is not a compilation pass. Native acceptance remains a separate gate.
