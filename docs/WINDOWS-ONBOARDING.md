# Generic Windows Host onboarding and Desktop preflight

This guide deliberately contains **no personal IP, username, token, tunnel identity or deployment configuration**.

1. Establish an authenticated command Transport: managed Coder Agent, OpenSSH or WinRM, according to the operator's own existing infrastructure. Port reachability is not authentication.
2. Separately ensure an authorized logged-in Windows user session (console or RDP). A Session 0 Windows Service can run commands but cannot safely inject input into a different user's desktop.
3. In an authenticated Windows PowerShell session, run the checked-out read-only preflight script:

       powershell -NoProfile -File .\scripts\windows-desktop-preflight.ps1

   It reports OS/build, process SessionId, whether Explorer runs in that session, services and the presence of Node and winapp. It does not install anything, change registry or firewall settings, or print passwords.
4. Optionally, after reviewing Microsoft's public-preview release and with operator approval, install and test winapp:

       winget install Microsoft.winappcli --source winget
       winapp --help
       winapp ui list-windows --json

   Use a harmless test app, inspect UIA, invoke a known element or set a test field and independently verify using `winapp ui get-value`. The operator must run these in the correct user session.
5. Register the Host through the real control-plane administrator enrollment procedure; verify Host connectivity and Desktop readiness independently. Do not create it as a disposable Environment merely because it is a VM.

Status taxonomy: `connected`/`disconnected` describes Transport only; Desktop can be `no_session`, `session_unverified`, `permission_denied`, `locked`, `driver_unavailable` or `ready`. Never infer one from the other.

No password guessing, forced Windows login, exposed secrets, firewall disabling or automatic credential installation is included. When an authenticated remote console is unavailable, enrollment **remains blocked** until the owner grants the required access.

References:
- https://learn.microsoft.com/windows/apps/dev-tools/winapp-cli/
- https://learn.microsoft.com/windows/apps/dev-tools/winapp-cli/ui-automation

Chat-Codex v0.2 Host Runner remains Linux-only; the Windows UIA adapter is not a proven native Windows Host implementation and requires a session-local Broker and real acceptance.
## WinApp JSON and exact HWND targeting

The WinApp CLI can return a top-level array for `ui list-windows --json`.
The adapter preserves each valid numeric `hwnd`, rather than converting the
window title or process ID into its identity. An exact HWND from the immediately
preceding discovery is required before window observation. `ui inspect`,
`ui invoke`, and `ui set-value` use the WinApp `-w <HWND>` selector rather
than `-a` (the latter may select a different process or similarly titled
window). For `inspect --json`, element selectors are read from the matching
`windows[].elements` envelope, with bounded output and a single-window
fallback for older scoped payloads.

Before an action the driver verifies that the HWND still exists, and rejects
changes to an observed process identity when the PID is reported. Stale
snapshots and unavailable interactive sessions are refused. This is contract
coverage with synthetic WinApp responses, **not** actual Windows/NAB5
GUI acceptance.
