# Styx VNext — developer preview (0.1.0)

A single Styx repository with a model-facing MCP gateway, a target registry,
Codex-compatible execution tools, and an optional native computer-use lane.
ChatGPT is the only reasoning/planning layer. This subtree is an isolated
implementation. Existing Styx/Charon/Coder production entrypoints are unchanged.

## Implemented

- Authenticated stateful MCP Streamable HTTP endpoint at /mcp.
- Model tools: exec_command, write_stdin, list_execution_environments.
- Codex-shaped process sessions and optional environment_id routing.
- Explicit allow/deny target catalog, default environment, runtime generation,
  OS platform and local/remote executor transport.
- One Codex Exec Server connection per admitted environment generation, shared
  across MCP tool calls and scoped by MCP session for process ownership.
- Optional GUI Broker integration with Cua-derived get_window_state, click,
  set_value semantics. The CLI does not activate GUI until a trusted host
  connection is configured.
- Retained macOS scratch Styx.app Embedded Cua prototype source and regression
  fixtures (not the final signed release).

## Not yet implemented

- Host outbound reverse WebSocket connector (direct WebSocket only).
- Signed production native app, Windows/Linux native GUI acceptance.
- Playwright/CDP browser provider, durable gateway restart recovery.
- ChatGPT product registration and production cutover.
- Compatibility aliases for old Charon interfaces.

## Developer quick start

Requires Node.js 22+, Python 3 and Linux x86_64 for pinned live tests:

~~~sh
cd vnext
npm ci --ignore-scripts --no-audit --no-fund
python3 packages/styx-exec-adapter/prepare-runtime.py
npm run test:all
STYX_LIVE_EXEC_TEST=1 npm test
~~~

The preparation script verifies the SHA-256 digest of official Codex
rust-v0.163.0. No vendor binaries, secrets or installed node_modules are committed.

To start an opt-in local gateway, copy config/targets.example.json to a private
local location, customize target URLs/identities and create a mode-0600 inbound
bearer token file. Then run:

~~~sh
STYX_MCP_TOKEN_FILE=/path/to/token node gateway/cli.mjs /path/to/targets.json
~~~

Default listener is 127.0.0.1:8795/mcp. Styx does not start or provision a
Codex Exec Server or Cua daemon. Both transport hops must be authenticated.
Tool callers cannot supply endpoints, credentials, native sockets or grants.

## Source tree

- gateway/ — MCP HTTP, target registry and executor session pool.
- packages/styx-exec-adapter/ — pinned Codex Executor protocol adapter.
- packages/styx-gui-broker/ — Cua GUI broker and macOS scratch app fixture.
- config/ — non-secret example.
- docs/ — design and acceptance gates.

This is NOT a full Codex agent, sandbox, multi-user authorization engine or
production-ready deployment. Lost/unknown mutation outcomes must never be
automatically replayed. See docs/architecture.md and docs/acceptance.md.
