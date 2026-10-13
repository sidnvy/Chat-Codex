# Chat-Codex v0.2 validation  2026-10-13

The following evidence is from actual commands run through the connected Charon 4 Typed API on Linux workstation Workstation. It is not an OpenAI account or ChatGPT Desktop acceptance report.

## Execution provenance

- GitHub upstream: `sidnvy/Chat-Codex`, base `main` commit `67530880134e4956f5d091e4072b5cf38e999747` (2026-10-09). Feature worktree under a separate development worktree, isolated from the clean original Checkout.
- Workstation: Linux non-root user UID/GID 1000; Docker Engine 29.6.2.
- Build/test/dependency installation: trusted Docker dev container `chat-codex-resource-dev`, `node:22-bookworm-slim`, Node.js 22.23.3, npm 10.9.9. It alone has explicit Docker daemon access to exercise a real local Docker backend.
- Test data: separate, temporary host-identical bind-mounted path outside the source tree; integration fixtures, tokens and runtime containers removed after tests. The ordinary Chat-Codex Environment does **not** mount the Docker socket or Host HOME.
- Original base unit suite: 4/4 passing before implementation.

## Actual M1/M2/M4 results

`npm run test:integration` exercised an authenticated, loopback real MCP Streamable HTTP server with the official MCP SDK HTTP Client, and both actual Local Host and Docker Environment backends. The latest execution passed **120 assertions** with output:

~~~
{"passed":true,"assertions":120,"real_docker":true,"real_http":true,"host":true,"mentions":true,"app_resource":true,"chatgpt_desktop_tested":false,"provider":"docker","runtime_identity_stable":true}
~~~

Verified:
- All redesigned tools discovered through `tools/list`, strict JSON Schema, old tools absent.
- Host status connected and Host lifecycle attempts refused.
- Bad kind, unknown id, injected workspace/provider fields refused before backend IO.
- Real Docker absent -> created -> running -> stopped -> restarted -> deleted, with retained Project file contents and same Docker container ID during multiple exec calls.
- Identical `target_exec` on explicitly admitted Local Host and Docker Environment.
- Red test exit 1 -> single-file unified patch -> green test exit 0.
- Relative file reads/writes/list, traversal and symlink escaping refusal.
- Non-root Environment, no Docker socket, no secrets/HOME mount, read-only root, disabled network; Docker ownership labels, image and security settings re-inspected before operations.
- Exit code 7, stderr preservation, timeout and stdout limit; bounded execution forces Environment to stopped state, rather than assuming a container child was killed.
- Start/poll/stop/list task receipts and honest completed/cancelled/unknown classifications.
- No Docker-to-Host fallback after Environment deletion.
- Search resources returns canonical typed `resource_link`, bounded Project file mention search excludes `.env`.
- MCP App Home resource served through authenticated `resources/read`; recent synchronous execution metadata as well as task receipts is present.

The standalone provider-contract suite checks future provider interface and lifecycle semantics without providing a fake PVE backend. Host-only tests run with setup invoked using an empty PATH to prove Docker is not required for Local Host mode; persisted in-flight tasks become `lost` when a gateway is restarted.

## Actual M3 independent container results

An independently created, disposable acceptance container was launched from the trusted Workstation Docker daemon with **no Docker socket**, **no network**, **read-only root**, non-root user and all Linux capabilities dropped. Its source mount was read-only. It ran:

~~~
node --test test/extensions.test.mjs test/plugin.test.mjs
~~~

**3/3 tests passed**, including a real MCP HTTP Client and read-only resource search/Home discovery/metadata contract. Portable Agent Plugin manifest and MCP configuration passed offline validation against bundled snapshots of both **official Agent Plugins 1.0.0 JSON Schemas**. The root manifest does not use a nonstandard `skills` field. The Home resource was read over real MCP HTTP.

This validates wire contracts, metadata and rendered HTML resource delivery; it does **not** prove that a real ChatGPT account recognizes, installs or renders that app.

## Actual vs contract-only vs installer steps

| Component | Status | Evidence / remaining action |
|---|---|---|
| Typed Registry, Target Router, strict schemas | Implemented and unit/HTTP tested | Invalid identity rejected before backend IO |
| Local Linux Host | Implemented and exercised | Explicit opt-in, non-root, **unsandboxed** |
| Docker Environment Provisioner | Implemented and exercised | Real local daemon, true lifecycle, project retention |
| Task receipts | Implemented and tested | Async completed/cancelled; lost on synthetic server recovery |
| Composer Mention tool | Implemented and protocol tested | App-only read-only search, canonical link |
| Portable Agent Plugin and three Skills | Implemented and offline/schema tested | Installer replaces placeholder endpoint and configures token |
| Minimal Home MCP App | Implemented and protocol tested | Real `resources/read` HTML; live Desktop rendering not verified |
| PVE/Firecracker/other Provider | **Contract-only** | No live backend, VM provisioning or model tool |
| Actual ChatGPT Desktop / Tunnel / plugin installation | **Not tested** | Needs a real authorized client and operator registration |
| Hosted GitHub Actions CI | **Not yet independently verified by this document** | Inspect PR check runs after pushing |

## Trust boundaries and limitations

The Docker control server has daemon-level authority and is a trusted component. Ordinary Environments cannot access its socket, but Docker isolation is not a hardened VM security guarantee. Project data is writable and not disk-quota-limited. Host execution is unsandboxed: shell commands can access same-user credentials, filesystem and network regardless of file API path checks. File tools are not an OS sandbox and are subject to host filesystem race conditions; use a dedicated trusted Project, not one containing secrets.

A gateway kill or Docker daemon failure can leave owned containers or unknown task state requiring operator inspection. No automatic fallback to Host is implemented. Concurrent user changes or mixed-version servers sharing one Environment are outside the single-user v0.2 design. Projects cannot overlap. No image or dependency is downloaded by tool execution; setup inspects a reviewed local pinned image.

Neither the private Charon implementation nor its credentials, personal deployment assets, tunnels or production configs were imported. The original Workstation Checkout and existing Charon services were not modified.
## Experimental Desktop Capability acceptance (2026-10-13)

- Real Arch Linux Hyprland 0.56.1 host: discovered a dedicated Zenity scratch window on a separate workspace, scoped grim screenshot 400x253, entered a unique marker via wtype, verified its exact value and restored the original workspace. No other application's data was intentionally modified.
- The portable Linux Driver ran read-only **on the real Host**: desktop ready, 1920x1080 headless monitor and valid window inventory. Keyboard/pointer/stale-target adapters were also tested with mocked CLI invocations. The revalidated live MCP HTTP roundtrip uses a dedicated Zenity window and performs scoped observe/type/Return with exact result verification.
- macOS Peekaboo Bridge has been discovered, but this Chat-Codex branch has not completed a verified remote GUI mutation; local mock contracts alone do not establish macOS acceptance.
- Generic Microsoft winapp CLI adapter and Windows preflight are authored, but the actual Windows Host lacks an authenticated command/session enrollment path at this time. No real Windows CLI/UI test has run.
- No Charon production modifications, private deployment configs, tunnel secrets, personal host names or addresses are included in this repository. All source editing and build/unit testing took place in a trusted Workstation Docker development container; live GUI acceptance necessarily ran on the logged-in Linux Host.

## Portable desktop driver registration and live Linux workstation MCP acceptance

The Desktop Core now uses a bounded driver identifier and an installer-owned
`DesktopDriverCatalog`, rather than hardcoded operating-system names in the
registration schema or target router. Unknown, unregistered or unsupported
drivers fail closed; no arbitrary executable/module import is accepted.

On 2026-10-13 a real loopback MCP Server running under the active Linux workstation
Hyprland user was exercised by a separate Node 22 HTTP Client test container.
The client found only a dedicated Zenity scratch window, observed it, captured
a real PNG, typed a unique test marker against a one-time snapshot, re-observed
and pressed Return using the same `target_desktop_act` contract. The live Zenity
process exited 0 and wrote back exactly the marker, then its window disappeared.
This is **real MCP-to-GUI-to-observed-result** evidence, not a mocked Driver
test. No existing desktop application received deliberate input, and no
Production Charon process, tunnel, host registration or credentials changed.

The optional test script is `scripts/desktop-live-acceptance.mjs`; it requires
an explicitly opened scratch window and authorized test credentials.
All unit, desktop capability and Plugin manifest/version consistency tests passed after the refactor (20/20).
Charon integration and Windows test host Windows UI acceptance remain separate work.
## Capability Registry and v0.3 source / release gates

Host remains the only persistent-machine resource identity. A missing `capabilities.desktop` field means Desktop disabled, while its explicit grant permits the local driver to probe readiness. `host_list` / `host_status` expose declarations, and `target_desktop_status` reports actual session readiness. A 21-case Node test suite passed, including strict registration, default denial, custom driver injection and release version matching. The real MCP HTTP/Docker integration passed all 120 assertions on Linux workstation; the Linux workstation GUI end-to-end test was re-run with the new `capabilities.desktop` config and produced the expected Zenity marker exactly.

Package and portable Plugin version were aligned at `0.3.0`; the MCP Server advertises the same version, checked by `test/release-consistency.test.mjs`. The Charon Plugin Creator release process is a separate operation: no app binding, personal Plugin, tunnel or production deployment was modified, and no account/desktop UI release acceptance is claimed. See `docs/RELEASE-GOVERNANCE.md`.