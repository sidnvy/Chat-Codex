# Windows Desktop target binding

The public `WinappDesktop` adapter requires a canonical positive Windows PID for every exact HWND observation and action. Inventories may expose a handle without a PID, but that entry cannot produce a mutation receipt. The adapter compares HWND ownership before and after UIA inspection and again before mutation. Missing PID, changed owner, duplicate handle, expired receipt, and unobserved element selectors fail closed. Selectors longer than the contract limit are omitted instead of truncated into a different selector.

## Trusted session composition

`new WinappDesktop(run, sessionProbe)` requires the trusted probe to return `{ready:true, session_id:'opaque-generation'}`. Boolean true, missing identity, and truthy strings do not establish readiness. The adapter pins this identity into the receipt and rechecks it after asynchronous inventory/inspection and immediately before dispatch. The built-in catalog still injects no proof and therefore remains `session_unverified`.

A native provider must independently prove that its execution account owns the active unlocked input desktop and supply a generation that changes when that logon/session is replaced. A Coder/SSH connection, Explorer process, UIA inventory, numeric SessionId alone, or `winapp ui` availability is insufficient. The optional acceptance harness supplies a separately reviewed native console probe; the built-in catalog still receives no implicit grant or probe. No private Charon code is incorporated.

HWND/PID continuity does not identify a process creation time: identical PID and HWND reuse within one observation lifetime remains a platform limitation. A future audited native binding needs process-generation proof and atomic target validation at dispatch. Separate CLI calls necessarily retain a final check-to-dispatch race; this PR does not claim to remove it.

## Upstream CLI and screenshots

Inspected Microsoft WinApp CLI source at `d399e3151db3a6e549ca4ac9d9cbeefa21260ed8`:

- [UI automation contract](https://github.com/microsoft/winappCli/blob/d399e3151db3a6e549ca4ac9d9cbeefa21260ed8/docs/ui-automation.md): exact numeric `-w` HWND targeting, `inspect`, `invoke`, and `set-value`.
- [Screenshot implementation](https://github.com/microsoft/winappCli/blob/d399e3151db3a6e549ca4ac9d9cbeefa21260ed8/src/winapp-CLI/WinApp.Cli/Commands/UiScreenshotCommand.cs): `-w` capture can include owned windows, and unavailable frame capture can fall back to foregrounding the target.

Consequently this adapter does not advertise screenshots or silently add a capture that may change focus. Exact, nonmutating capture and native-session evidence require separate acceptance. No executable is installed or redistributed here, and fixtures are not evidence for a specific installed WinApp release.

## Public WinApp v0.7.1 action contract

The acceptance baseline is now [official v0.7.1 at e3cd0b94f3e7b776ac51ba0564f4908094e979b5](https://github.com/microsoft/winappCli/tree/e3cd0b94f3e7b776ac51ba0564f4908094e979b5). `invoke` explicitly passes `--action invoke`, preventing automatic toggle/select/expand or ancestor fallback. Successful dispatch requires the returned `elementId` and `hwnd` to match the receipt; invoke additionally requires `InvokePattern`, requested `invoke` and performed `invoke`. Missing/contradictory results and all mutation-command failures report `outcome_unknown`, never verified success or safe retry.

Exact-window inspection traverses nested `children` within that selected window only, exposes at most 100 selectors and rejects duplicate selectors anywhere in the inspected tree. Traversal is bounded to 1,000 nodes and depth 32; exceeding these limits fails observation rather than silently authorizing an incompletely checked selector. No coordinate input or screenshot support was added.

Inspection can promote a globally unique AutomationId into `selector`, but mutation replies use the native runtime-ID slug. Only for these observed promoted selectors, Styx stores the exact raw AutomationId, type and full name internally in the receipt (at most 100 entries; name at most 4096 characters). Before dispatch it issues `search <observed-id> -w <exact-hwnd> --type <observed-type> --max-results 2`. The `--type` constraint is essential: ordinary search re-promotes AutomationIds, while upstream `SearchConstrained` deliberately keeps runtime-ID slugs. Exactly one complete match must preserve the raw AutomationId/type/name and return a valid canonical slug; broad, ambiguous or contradictory matches fail before mutation.

Search JSON intentionally strips the element's window handle. Styx relies on the explicit `-w` scope and rechecks exact HWND/PID ownership after the awaited search, followed by native session and receipt-expiry checks. Any provided conflicting window evidence is rejected. The action uses only this validated canonical selector and requires the returned native `elementId` to equal it exactly; caller-supplied canonical aliases are not admitted. Already canonical observed selectors need no extra query. This does not create an atomic native identity lease or relax existing same-PID/HWND reuse limitations.

Public source: [constrained query](https://github.com/microsoft/winappCli/blob/e3cd0b94f3e7b776ac51ba0564f4908094e979b5/src/winapp-CLI/WinApp.UIAutomation/Services/UiAutomationService.Query.cs), [query options](https://github.com/microsoft/winappCli/blob/e3cd0b94f3e7b776ac51ba0564f4908094e979b5/src/winapp-CLI/WinApp.Cli/Commands/UiQueryOptions.cs), and [JSON scrubbing](https://github.com/microsoft/winappCli/blob/e3cd0b94f3e7b776ac51ba0564f4908094e979b5/src/winapp-CLI/WinApp.Cli/Helpers/UiElementScrubber.cs).

## Optional native scratch check

`scripts/windows-desktop-acceptance.mjs` now includes a public-API native session probe and optional authenticated gateway mode. See [Windows native acceptance](WINDOWS-DESKTOP-ACCEPTANCE.md) for prerequisites, security boundaries and commands. Direct Core mode remains available; only `--gateway` may establish authenticated MCP acceptance. Fixtures and successful read-only preflight do not establish native mutation acceptance.
