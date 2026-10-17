# Styx VNext architecture — 2026-10-17

## One product, two deployment roles

Styx Gateway accepts model-facing MCP, resolves environment_id and routes tools.
Styx Host Runtime provides native execution; it contains Codex Exec Server for
Shell / Files / PTY and an optional native GUI Driver. These are deployment
roles in one project, not separate Styx Core or Charon products.

~~~text
ChatGPT (sole reasoning layer)
   |
   | MCP
   v
Styx Gateway (MCP tools, target registry, session ownership)
   |
   | Direct WebSocket; outbound planned
   v
Styx Host Runtime
   +---- Codex Exec Server -> process / PTY / filesystem
   +---- Styx.app -> Cua embedded driver -> macOS GUI
   +---- Browser provider (Playwright/CDP planned)
~~~

MCP SDK owns the outer protocol; the Codex Exec Server owns process RPC.
Gateway maps session ownership, checked target selection, output cursors and
bounded results. GUI permission/session generation remains separate from the
Exec session. A Native GUI action receipt is not independent verification.

## Operating rules

- Explicitly registered, allowed targets only; no tool-supplied URL or token.
- An omitted environment_id resolves to the configured default only.
- Authenticated MCP sessions own process IDs and GUI element tokens; cross-chat
  or cross-session reuse is denied.
- No autonomous local agent or additional reasoning loop.
- No automatic retry when a mutation outcome is unknown.
- Codex version rust-v0.163.0 is pinned for contract tests, not assumed to
  have a stable third-party protocol contract forever.
- Model tools are exec_command, write_stdin, list_execution_environments,
  optionally get_window_state, click, set_value.
- Direct WebSocket works for a reachable Host. Outbound connector, GUI packaging
  and Browser provider have separate acceptance gates.
- Root Styx production entrypoint stays unchanged until independent acceptance.
