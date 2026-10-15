# Windows desktop integration prerequisites

Styx's full Host Runner, setup and `npm start` path remain Linux-only. The supported `chat-codex/desktop/windows-worker` export lets a trusted integrator use the canonical Windows desktop adapter. It does not install a Windows server, create a transport or enroll a Host. Start with [general onboarding](ONBOARDING.md) for the Linux runtime.

## Prepare the native target

1. Provide Node.js 22+ and Windows PowerShell under the intended ordinary user's execution identity. Verify the executable path seen by the actual transport; an interactive shell and a background worker can have different PATH values. An explicit Node path must come from trusted operator configuration when the consumer supports it.
2. Review and provision the supported public Microsoft WinApp distribution. The current adapter contract is pinned to WinApp v0.7.1, source commit `e3cd0b94f3e7b776ac51ba0564f4908094e979b5`. The standalone distribution does not require a .NET SDK installation. Keep the executable and accompanying HarfBuzz/Skia libraries protected against replacement. The worker factory requires operator-supplied SHA-256 hashes for all three; verify these against the reviewed artifact rather than trusting a model-supplied path or hash.
3. Establish the consumer's authenticated transport under the same user as the desktop. Preserve WinApp's normal desktop coordination directory; do not redirect or delete shared lock state to bypass coordination. The worker opts out of WinApp telemetry for its process.
4. Confirm an existing, unlocked **active physical console** session. A Session 0 service cannot stand in for the logged-in desktop user. RDP-only admission is not supported by this worker's strict console proof. It checks session generation, owner identity, and both caller and target input desktop evidence.
5. Check readiness through the composed Core/worker integration before observing a harmless owned scratch window. Connection status alone is insufficient. Native capture and action acceptance are separate from compilation or mocked contract tests.

The checked-out `scripts/windows-desktop-preflight.ps1` can report basic OS/session and executable availability. It is preliminary inventory, not the canonical worker's full session/identity proof. Run reviewed local scripts under the existing execution policy; do not add a policy bypass to make a check pass.

## Compose the worker

Follow [the canonical worker contract](windows-worker.md) for source generation, trusted hashes, owned staging, stdin requests and cleanup. The generated source is too large for Windows command-line limits: stage it in an owned file, then invoke Node with `--winapp-path` pointing to the reviewed executable. A provider must supply bounded execution, authenticated admission and Core's target-bound single-use snapshots. Do not expose the raw worker as a public service.

Observation uses exact HWND identity and fresh process/session proof. Capture uses `PrintWindow` for that HWND with no screen or foreground fallback; some applications may produce blank frames. Invocation and set-value require freshly observed element identity. An unknown dispatch outcome is never automatically retried.

Recorded controlled native scratch acceptance exercises capture, actions, replay refusal and independent output verification. It does not prove a new user's transport, installed binaries, session or applications. The Windows CI compile check exercises the actual C# declarations without GUI access; it does not replace native acceptance.

Status separates transport connectivity from desktop `locked`, `session_unverified`, `permission_denied`, `driver_unavailable` or `ready`. Missing proof fails closed. No password guessing, forced login, automatic credential installation, execution-policy changes or firewall changes are part of onboarding.

References:

- [Microsoft WinApp CLI](https://learn.microsoft.com/windows/apps/dev-tools/winapp-cli/)
- [WinApp UI automation](https://learn.microsoft.com/windows/apps/dev-tools/winapp-cli/ui-automation)
- [Canonical Windows worker and implementation provenance](windows-worker.md)
