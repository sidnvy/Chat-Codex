# Styx VNext acceptance gates

| Gate | Status | Evidence |
| --- | --- | --- |
| Catalog allow/deny and explicit defaults | PASS | gateway/test/registry.test.mjs |
| Authenticated HTTP MCP + session isolation | PASS | gateway/test/http.test.mjs |
| Real Codex process/stdin/PTY | PASS | packages/styx-exec-adapter/test |
| Styx MCP HTTP to real Codex WS | PASS, isolated Linux | gateway/test/live.test.mjs (STYX_LIVE_EXEC_TEST=1) |
| GUI Broker scope and socket policies | PASS with fixtures | packages/styx-gui-broker/test |
| macOS embedded Cua scratch | PASS in prior pilot | User-supplied 2026-10-17 prototype ZIP |
| Real ChatGPT registration to new Gateway | NOT RUN | separate integration |
| Host Outbound WS | NOT IMPLEMENTED | next milestone |
| Signed/notarized macOS Styx.app | NOT RUN | release gate |
| Linux Hyprland / Windows UIA native | NOT RUN | release gate |
| Browser Playwright/CDP | NOT RUN | separate milestone |
| Durable cross-restart task recovery | NOT IMPLEMENTED | fail closed |
| Production Coder/Charon replacement | NO-GO | intentionally unchanged |

Native macOS evidence is limited to an owned scratch window. It does not prove
arbitrary-app support, macOS signing/upgrades or Windows/Linux behavior.

GO for isolated development, NO-GO for production migration.
