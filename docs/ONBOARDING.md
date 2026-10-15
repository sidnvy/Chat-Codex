# Styx onboarding: agent entry and operator reference

For a guided experience, give your local Codex agent the prompt in [INSTALL.md](../INSTALL.md). It starts with device selection and access authorization; the commands below are the underlying operator interface, not steps a novice must type. The agent procedure is [Styx Onboarding](../skills/styx-onboarding/SKILL.md).

The supported automatic local path is a **non-root Linux or macOS user with Node.js 22+**. Styx runs a local authenticated MCP server with explicitly authorized Host execution. Docker supplies optional disposable execution environments on Linux; macOS Docker Desktop is not yet verified. Desktop preparation is selected by default in agent onboarding; access remains disabled until separately authorized. Users can explicitly defer it. See [default Desktop policy](DESKTOP-DEFAULTS.md).

The package still identifies itself as `chat-codex@0.3.0` and is marked `private: true`. Install from this public repository, not an assumed `npm install -g styx` release. For repeatable deployments, check out a reviewed commit before `npm ci`. `npm pack` produces an artifact for trusted consumers; it does not publish a release. The `desktop/*` package exports support integrations, while `npm start` launches the Linux/macOS Host runtime.

## Agent-driven state and recovery

`npm run onboard -- probe` reports local support. The agent uses a private per-device state directory to record selection and authorization, create configuration, start/stop its owned server and verify connectivity. It follows structured next actions instead of interpreting raw logs. See the [command procedure](../skills/styx-onboarding/references/procedure.md).

For local Codex, `connect-codex --state-dir PATH --device SLUG --client-access` records the user’s client-access authorization and registers a named stdio connection; the bridge reads credentials privately. Existing unrelated client entries are preserved. ChatGPT connection remains a separate account-side handoff.

A client task remains a separate gate: the agent asks the intended client to execute a generated scratch command through `target_exec`, read its file result back and check the artifact. This is reported client execution plus artifact verification, not cryptographic proof of client origin. Remote devices can be recorded as pending, but the current runtime does not aggregate or automatically enroll them. Continue the local procedure on each supported device independently.

## 1. Check prerequisites

Run these as the ordinary user who will run Styx:

```sh
node --version                 # 22 or newer
npm --version
```

Install missing prerequisites through your normal operator-approved process. Host-only setup requires no Docker.

**Optional on Linux: only if containers were selected**, check the authorized Docker daemon and obtain the reviewed image before setup:

```sh
docker info
docker pull node:22-bookworm-slim
```

The trusted Styx process needs Docker access for containers; disposable environments do not receive the Docker socket. Setup records the downloaded official image's immutable digest. It does not silently install software or enable Docker access.

```sh
git clone https://github.com/sidnvy/Styx.git
cd Styx
npm ci --ignore-scripts --no-audit --no-fund
npm run doctor
```

Before configuration exists, Doctor's `action_required` result is expected. A blocked platform, Node version or user privilege must be resolved first. Doctor is read-only and never prints token contents.

## 2. Create a private configuration

For guided prompts:

```sh
npm run setup
```

Host is the default: it enables unsandboxed commands using the local account’s privileges and requires explicit authorization. A Project directory is a working location, not a shell sandbox. On Linux, add Docker only when the user selects containers; container-only mode is also available. Supply **two new, separate absolute directories**: one for Project data, one for private configuration. Their parent directories must already exist. Do not put the private directory inside the Project or checkout. Setup refuses to overwrite an existing installation.

For a reproducible noninteractive setup:

```sh
mkdir -p "$HOME/chat-codex-data"
npm run setup -- "$HOME/chat-codex-data/project" "$HOME/chat-codex-data/private" --backend host
```

The resulting private directory contains `config.json`, `token` and `tunnel-authorization`. Directories use mode 0700 and files 0600. Keep credentials out of source control, command transcripts and chat messages. Setup registers Project `default`. Host mode registers Host `local`; Docker modes additionally register Environment `dev` without starting a container.

`--backend host` requires no Docker but grants same-user, unsandboxed Host execution. `--backend both` grants both backends on Linux. These low-level setup modes do not themselves enable desktop control; the agent onboarding Desktop stage separately records consent and configures the driver. Without `--port`, setup prefers 8791 and chooses an available loopback port when it is occupied. The selected port is saved in private configuration. An explicit `--port` is pinned and fails if occupied; choose another port instead of terminating its owner.

## 3. Start and verify

The commands below use the noninteractive example paths. If you chose different paths in guided setup, use the exact config path printed by setup.

In the first terminal:

```sh
export CHAT_CODEX_CONFIG="$HOME/chat-codex-data/private/config.json"
npm start
```

Keep this process running. In a second terminal, from the checkout:

```sh
npm run doctor -- --config "$HOME/chat-codex-data/private/config.json"
npm run verify -- --config "$HOME/chat-codex-data/private/config.json"
```

On Linux, for the optional Docker execution check when Docker was selected and is available:

```sh
npm run verify -- --config "$HOME/chat-codex-data/private/config.json" --sandbox
```

Doctor checks configuration and local process health. The verifier checks authenticated MCP connectivity. Its optional `--sandbox` mode creates and exercises an isolated, verifier-owned Docker environment and cleans up that temporary data; it does not run a command in your registered Host or Project. Docker must be available for this optional check even with a Host-only configuration. Read the result and cleanup status; a health response alone is not a successful execution check.

If verification reports `cleanup: unconfirmed`, keep the reported `recovery_directory`. It contains the verifier’s separate private configuration for reconciling its owned resources. Inspect that configuration and confirm the owned Environment is stopped/deleted before removing the directory. Do not apply recovery deletion to your normal configured resources or assume an interrupted creation never completed. Keep the recovery directory and its credentials private.

## 4. Connect your MCP client

The endpoint is `http://127.0.0.1:<configured-port>/mcp`, with Bearer authentication. Setup prefers port 8791 but may select another available port; use the recorded configuration rather than hardcoding 8791. A remote client needs your own secure tunnel or gateway and compatible Host/Origin configuration. Configure its authorization using the client's secret storage and the locally generated token; never paste the token into a conversation. The root `mcp.json` contains an `example.invalid` placeholder, not a service URL.

Install or authorize the connection through your client's supported workflow. Local verification does not prove external reachability, account authorization, Composer Mentions or App Home rendering. Confirm that the client lists Styx's tools before asking it to execute work.

Suggested first prompts:

- “List the registered Hosts, Projects and Environments; do not create anything yet.”
- “On Host `local`, run `node --version` and show the execution receipt.”

If containers were selected:

- “Create and start Environment `dev`, then run `node --version` in that Environment.”
- “Write a small hello-world file in Project `default` through Environment `dev`, run it, and show the execution receipt.”
- “Stop Environment `dev` when finished. Preserve Project data.”

Explicit target selection matters. Docker environments never fall back to Host execution. Deleting an Environment preserves its Project data.

## Desktop prerequisites

Desktop is a default onboarding stage with its own authorization and acceptance, separate from the Docker first-run check. Command connectivity does not prove that a graphical session is usable. Built-in Host command execution supports Linux and macOS; Windows native Host installation is unsupported. macOS Host onboarding does not download Peekaboo or grant capture/accessibility permissions. The Desktop setup helper checks the separately installed signed GUI/CLI pair and supports an explicitly authorized GUI launch; see the macOS preparation commands below. The local macOS catalog uses the native session probe; remote macOS and Windows integrations additionally require a trusted transport and admission. The low-level setup command does not install desktop dependencies. Agent onboarding must prepare them, configure the Desktop grant with explicit consent, and report unsupported integrations as pending.

| Native desktop | Required on the target | Supported integration guide |
|---|---|---|
| Linux / Hyprland | Node 22+, `hyprctl`, `grim`, `wtype`, correct inherited Hyprland session; standalone pointer actions additionally need their configured input backend | [Hyprland worker](hyprland-worker.md), [local opt-in](DESKTOP-CAPABILITY.md#linux-opt-in) |
| macOS / Peekaboo | Node 22+, `python3`, native `ioreg`, compatible separately signed Peekaboo CLI and GUI Bridge, operator-granted capture/accessibility permissions, existing unlocked console user | [Peekaboo worker](peekaboo-worker.md), [pinned adapter contract](PEEKABOO-ADAPTER.md) |
| Windows / WinApp | Node 22+, Windows PowerShell, reviewed WinApp executable and native libraries with trusted hashes, same-user unlocked active physical console | [Windows onboarding](WINDOWS-ONBOARDING.md), [canonical worker](windows-worker.md) |

Swift or other scratch-app compilers used by native acceptance harnesses are test prerequisites, not runtime dependencies of every worker. Workers retain narrower action profiles and image limits than the generic Core schema. Review the platform guide before composing one. No worker installs dependencies, unlocks a session, changes execution policy or bypasses OS permission controls.

After admission, check `target_desktop_status`, then observe only an owned harmless test window. Use fresh target-bound snapshots and independently verify effects. Native acceptance records establish specific tested configurations; repeat an appropriate acceptance test for your actual installation.

## Troubleshooting

| Symptom | Next step |
|---|---|
| Doctor says configuration missing | Complete setup, then use its exact absolute config path via `--config` or `CHAT_CODEX_CONFIG`. |
| Setup refuses existing paths | Use new separate directories, or start the existing installation with its existing config. Do not delete data merely to rerun setup. |
| Docker image or daemon unavailable | Check Docker access under the same user and pull the reviewed image. Host-only is an explicit authority choice, not a fallback. |
| Server cannot bind | Preserve the existing listener. Agent onboarding can relocate an automatically selected port; an explicitly pinned port needs an explicit change. Reconcile any external tunnel upstream after an endpoint change. |
| Verifier reports `cleanup: unconfirmed` | Preserve the reported `recovery_directory`. Stop and inspect its owned Docker resources before cleanup; do not blindly rerun or delete the directory while an operation may still be running. |
| Authenticated verifier fails | Confirm the intended server uses the same config/token, and inspect the sanitized error. Do not print or send credentials. |
| Local verification passes, client connection fails | Check external endpoint routing, allowed Host/Origin and client authorization separately. |
| Desktop is unavailable despite connected transport | Check native Node/CLI resolution, same-user session and OS permission status. A shell's PATH may differ from the transport's PATH; use an explicit trusted executable path only where the consumer supports one. |
| Desktop reports locked or unverified | Restore the intended session through normal user interaction, then recheck readiness. Do not change security controls to force a pass. |
| Action reports an unknown outcome | Do not repeat the input. Obtain fresh observation and independently determine whether it took effect. |

For development checks, see [README tests](../README.md#tests). For packaging and publication boundaries, see [release governance](RELEASE-GOVERNANCE.md).

## Configuration ownership

There is one runtime configuration per installation, not a hosted/global configuration center. The private `config.json` is authoritative for the local port, Projects, Hosts, Desktop grants and Environments. Its `onboarding` preferences store `desktop_requested` and the `auto`/`explicit` port allocation policy. The request records desired setup; it does not itself enable the Desktop grant. `onboarding.json` in the private state directory records progress, authorization, process ownership and the expected configuration digest; it is not an independent runtime configuration to edit manually. Installed-device ledgers omit duplicate port, port policy, Desktop selection/grant and container settings; pre-install intent remains in the ledger until config exists. Version 1 ledgers migrate atomically on normal onboarding commands, preserving authorization and credentials. Credentials live in separate private files, never in chat.

The local Codex registration points to the stdio bridge with the absolute config path. New bridge connections read that configuration rather than duplicating its port in Codex settings. Existing active connections may need to reconnect after endpoint changes. External Tunnel profiles and OS service definitions are currently separate configuration surfaces; this installer does not automatically rewrite them or certify their boot persistence. Any endpoint change requires rechecking the selected client and externally configured upstreams.

Use the supplied onboarding operations for managed changes; editing config alone intentionally triggers configuration-drift protection. Stopping a verified owned process remains supported during drift. Managed local changes coordinate runtime config and ledger integrity; external tunnels and OS services remain explicit handoffs rather than automatically reconciled surfaces.

For an existing installation blocked by an occupied port, use `node scripts/onboard.mjs reconfigure-port --state-dir PATH --device SLUG` to select an available automatic port, or add `--port NUMBER` to pin a specific free port. Stop a verified Styx-owned server first when it is running. Do not terminate the unrelated occupant of a conflicting port. The operation preserves project data and credentials, updates runtime config and progress together, invalidates connection acceptance, and reports the external endpoint handoff. Then run start/verify and reconnect the intended client.

### Inspect effective settings

```sh
node scripts/onboard.mjs effective-config --state-dir /absolute/private/state --device laptop
```

The JSON projection identifies `runtime_config` as its source and includes the configured port/policy, local Host authority, Desktop request/grant/driver and environment identities. It omits credential values, owner IDs and private file paths. A valid effective configuration is not an operational health or client acceptance test. Unexpected manual changes still fail closed under digest protection; use the supplied mutation commands rather than editing progress to bypass it.

### Prepare the macOS Desktop pair

```sh
node scripts/desktop-setup.mjs check
node scripts/desktop-setup.mjs prepare
# Only after the corresponding launch/startup authorization:
node scripts/desktop-setup.mjs start --launch-access
node scripts/desktop-setup.mjs startup --startup-access
```

Peekaboo.app and the Peekaboo CLI are separate signed artifacts. The helper verifies their expected identities and the reviewed CLI contract. It uses `/Applications/Peekaboo.app` and standard Homebrew CLI locations by default; `--app-path ABS` and `--cli-path ABS` inspect alternate locations. These options do not alter Styx's runtime PATH or persist executable paths in its config. A CLI installed at a custom path must also be resolvable by the actual service before desktop verification can pass.

`prepare` returns explicit missing-artifact handoffs; it does not fetch or install software. `--software-access` only records that software preparation has been authorized in the handoff. `start` requests a background GUI launch; a successful request does not establish Bridge readiness. `startup` guides the app's native Launch at Login setting and later normal-login verification; no custom launchd job, hidden preference or OS permission change is performed. The helper reports startup as pending until the native step is handled separately.

Follow the returned exact Bridge-socket and permission checks, then use authenticated `check-desktop` and the actual-client desktop acceptance procedure. Keep installer artifact checks, service readiness, native login persistence and client task/screenshot evidence separate.
