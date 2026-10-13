# ADR-0002: Optional Host Desktop Capability

Status: Experimental / explicit opt-in. Distinct from Host connection and lifecycle.

## Identity, Transport, Session

A connected Coder/SSH/WinRM Host is not automatically a ready Desktop. Transport runs commands; a session-local Desktop Driver observes and operates the logged-in graphical user session. Host ownership and lifecycle do not change.

Desktop is an optional capability of an already admitted Host. Current Chat-Codex only enables Linux Local Host desktops explicitly. Docker Environments cannot turn on Host GUI capabilities: desktop support for Environments would require a genuinely Environment-local session Broker. This release does not provide one.

## Four MCP tools

- `target_desktop_status` — readiness, driver and supported capabilities, separate from Host connection status
- `target_desktop_observe` — bounded inventory or exact active-window screenshot and temporary snapshot
- `target_desktop_act` — one action against the same target and unexpired snapshot; no automatic retry
- `target_desktop_wait` — bounded exact-window wait; timeout is not success

Snapshot TTL: 30 seconds; snapshots are memory-only and consumed once. Image capture: exact active window only, maximum 2 MiB; never stored inside the Project. Windows and IDs are validated again before Linux pointer/keyboard input. Return `outcome:"dispatched_unverified",verified:false` for an action that has not yet been independently verified.

## Linux opt-in

An administrator may add the following field to an existing private v2 Host entry, after verifying a trusted logged-in Hyprland user session:

    "capabilities": {"desktop": {"enabled": true, "driver": "hyprland"}}

Missing capabilities.desktop means **disabled**. A grant does not mean the GUI session is currently ready. The option is not allowed in Docker Environment entries. Both the Host Runner and GUI commands have full same-user authority and are **unsandboxed**.

This adapter uses Hyprland JSON IPC, scoped grim capture, wtype and ydotool. On Hyprland v0.56 with Lua config, the old `hyprctl dispatch workspace 98` syntax fails; the documented Lua dispatcher-object syntax must be used. The adapter intentionally does not claim Linux accessibility/AT-SPI element actions. Window screenshots are limited to a currently active exact-window identity.

## Cross-platform drivers and evidence

| Backend | Implementation | Actual verification |
|---|---|---|
| Linux / Hyprland | Operational driver with observe/status/type/key/bounded coordinate click | Real Linux workstation MCP HTTP Observe → Act → Verify against a dedicated Zenity scratch window, verified input and screenshot |
| macOS / Peekaboo | Optional adapter, unit and protocol contracts | Bridge previously observed on macOS test host; this branch has not executed a verified macOS GUI mutation |
| Windows / winapp UIA | Optional provisional adapter and contract | Windows GUI session and real UIA act not verified in this branch |

Peekaboo requires a permission-granted Bridge and a trusted exact-window receipt. Native Windows UIA can inspect in some locked sessions, but synthetic input needs an unlocked interactive Desktop. This adapter conservatively refuses mutations without an independently verified session-local Broker. The current Chat-Codex Host Runner is Linux-only; a Windows Coder Agent alone is not sufficient to establish GUI readiness.

See [Windows onboarding preparation](WINDOWS-ONBOARDING.md) for a read-only Windows preflight.

## Safety/limitations

Screenshots and accessibility trees may reveal private content. Never treat a desktop screenshot as secret-free or grant UI rights through resource mentions. Use temporary harmless test applications for actual acceptance. No passwords or private deployment settings are embedded. Host Desktop is opt-in and uses execution privileges already granted to the Host process. Do not claim real Windows/macOS GUI acceptance based on mock tests.

## Driver extensibility (portable/open-source)

The core is driver-agnostic. The optional administrator-owned `capabilities.desktop.driver`
configuration is a bounded, validated name, not a fixed enum of operating systems
or automation tools.

`src/desktop/drivers.mjs` provides a trusted `DesktopDriverCatalog`. Installers
may explicitly register an audited factory (such as `catalog.register('kde-plasma',
factory)`) in application code, with no change to core MCP tool schemas. The core
uses only the shared `status`, `observe`, and `act` driver contract; `wait` is
composed by the DesktopManager.

Built-in optional adapters are Hyprland, Peekaboo, and Windows UI Automation.
Unknown/uninstalled drivers fail closed with `driver_unavailable`. No caller can
inject commands, arbitrary module paths, transport addresses, or imports into
the Host via the MCP request or the private config.

This desktop driver contract can also be implemented behind Charon's existing
Host transport, without making Chat-Codex depend on Charon. The current
Chat-Codex Host Runner remains Linux-only: generic drivers are not evidence
of actual remote Windows enrollment or GUI acceptance.

## Linux workstation real MCP Desktop acceptance - 2026-10-13

A temporary, loopback-only Chat-Codex MCP server ran under the active logged-in
Linux user, with Hyprland desktop capability enabled only in an isolated test
configuration outside the checkout. A dedicated Zenity entry dialog was opened
on the real Hyprland HEADLESS-1 session.

A separate trusted Node 22 test container, with read-only source and temporary
token mounts but no Docker socket, used the real MCP Streamable HTTP Client to:
check readiness, list windows, wait for the exact scratch title, capture a PNG
of the active target window, mint a one-time snapshot, type a unique marker,
verify snapshot replay was refused, re-observe, and dispatch the Return key.

The real Zenity process exited successfully and returned exactly the test
marker; the scratch window closed. This proves Observe-Act-Verify on Linux workstation,
not just an isolated CLI or mocked driver call. Screenshot bytes and temporary
token were never committed. Other application windows were not targeted.