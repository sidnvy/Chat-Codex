# Deterministic onboarding procedure

Run commands from the reviewed Styx checkout. Check that Node.js 22+ and npm are available before installing locked dependencies (`npm ci --ignore-scripts --no-audit --no-fund`). If missing, use the platform’s appropriate installation path within the user’s authorization, then recheck. Read `node scripts/onboard.mjs --help` from that revision before execution. JSON is the agent interface; summarize it for the user rather than displaying command transcripts.

## Select and prepare

1. Run `node scripts/onboard.mjs probe` to inspect the local platform without creating state.
2. Choose a new private absolute state directory outside source control. Initialize with `init --state-dir PATH --client codex` (or `chatgpt`). On resume, use `status --state-dir PATH` instead.
3. Record each selected device using `add-device --state-dir PATH --id SLUG --label LABEL --location local --platform linux`. Use `--platform macos` for local macOS Host setup. `--location remote` and `--platform windows` record intent, not working enrollment. Add `--containers` only for selected Linux containers; macOS Docker Desktop is not yet verified. Desktop is selected by default. Use --defer-desktop only when the user explicitly defers it; keep that decision visible. Follow the Desktop preparation stage below.
4. After explaining and obtaining the specific Host grant, use `authorize --state-dir PATH --device SLUG --host-access`. Include `--containers` only for the selected, authorized option. Do not treat CLI consent flags as a substitute for the user's decision.
5. Follow returned next actions. `install`, `start`, `verify` and `stop` take `--state-dir PATH --device SLUG`. The local server is task-owned; this is not an OS startup service. Preserve state and project data when stopping.

Host execution is the default; missing Docker must not block Host-only setup. Before adding Docker, explain the daemon access required and obtain any missing installation authorization. Never automatically elevate the Host process to root. Dependencies not installed by the scripts remain explicit prerequisites.

Automatic Host setup supports local Linux and macOS. Windows native Host installation is unsupported. macOS Host support does not install Peekaboo or authorize desktop capture/control. For another device, guide the user to run this procedure there with its own local authorization and private state. Do not copy tokens or private configuration across devices, assume SSH access, or claim that recording several devices aggregates them into one Chat connection. Keep ready devices usable while others remain pending.

## Connect the intended client

For local Codex, run `connect-codex --state-dir PATH --device SLUG --client-access` after local verification and authorization to connect that client. The flag records that specific client-access authorization; do not infer it from Host installation consent alone. It registers `styx-SLUG`, preserves unrelated client entries, and uses a local stdio bridge that reads the private server token directly. Do not substitute a literal token in client configuration or silently replace a conflicting existing entry. A registered configuration is not proof the client loaded it; guide any necessary client refresh and rediscover tools.

For ChatGPT, the supported connection is a separate account-side handoff. Explain: “This connection lets the selected Chat workspace call the capabilities authorized on this device.” Reuse an existing suitable connection only within its authorized scope.

OpenAI's [Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) documents a private connection without inbound public exposure. Its current prerequisites include a tunnel ID, runtime key, organization permissions and the intended ChatGPT workspace association. Creation/editing requires Tunnels Read + Manage; use requires Read + Use. Keep keys out of chat, arguments and logs; use a supported local secret input. Guide the user through Platform authorization and ChatGPT Plugins → Add custom MCP server → Tunnel, including the actual authentication and risk confirmation. Check current UI and `tunnel-client` help before proceeding; this repository does not automate tunnel provisioning. Verify tunnel readiness before client discovery. See also [custom MCP server setup](https://developers.openai.com/api/docs/guides/custom-mcp-server).

If the required account permission, secure credential path or client capability is unavailable, record a pending handoff and explain it. Do not expose the loopback server publicly or mark the client connected to bypass this step.

## First task and evidence

Run `prepare-client-test` with the same state/device arguments when local verification is ready. Use its exact target-bound `target_exec` command in the intended client, then read the generated scratch file back through `target_read_file`. This verifies an actual Host command and its result, rather than tool discovery alone. Only that client should perform the test; the installing agent must not manufacture the expected output through its own shell to satisfy the gate. Read the result from the actual client, then use `confirm-client-test --state-dir PATH --device SLUG --from-client`. The flag records the actual client-task attestation; never set it just because local verification passed.

An artifact check validates the task result, not cryptographic client identity. Preserve the distinction between locally verified service, user/agent-reported client execution and checked artifact. If the intended client is unavailable, leave this step pending. Container verification runs only when selected and exercises a separate verifier-owned sandbox. It does not prove a task ran in the configured Environment through the intended client; report that limitation until a separate client task verifies that Environment. Desktop requires separate admission, real graphical-session verification, an actual client application task and screenshot delivery. Local readiness alone leaves desktop acceptance pending.

On failure, inspect sanitized status. Resume from the reported action after one targeted repair; if the same condition persists, report the concrete blocker and retain state. Do not delete state, repeat uncertain actions, rotate unrelated credentials or modify security policy to make a check pass.

If a prior onboarding process was interrupted and reports `operation_in_progress`, use `recover-lock --state-dir PATH`. It checks the recorded owner PID and process start identity and refuses to remove a live operation’s lock. A missing or invalid owner receipt requires manual reconciliation of the active operation and its resources; never blindly remove the lock directory. The owned server has a separate process receipt so `start`/`stop` can reconcile a surviving child after an interrupted parent. Preserve those receipts and do not kill a process by PID alone.

## Default Desktop preparation

Read [the platform policy](../../../docs/DESKTOP-DEFAULTS.md). Select the official platform driver automatically. Explain screen/input access and obtain explicit Desktop authorization. Prepare missing reviewed driver dependencies using the platform-supported installation process within existing authorization; do not invent a generic installer or claim missing software is installed.

With the owned server stopped, use `enable-desktop --state-dir PATH --device SLUG --desktop-access` to admit the platform driver. Then start and verify the server, run `check-desktop` with the same state/device arguments, and follow prerequisite/permission/session diagnostics. Confirm client tool discovery after configuration changes. Only invoke actual desktop actions through the intended client with fresh target-bound snapshots.

If the user defers Desktop, use `defer-desktop`; stop the owned server first if Desktop was already enabled. This removes the Styx grant, preserves Host and project data, and is not an OS-level permission revocation or software uninstall. Restart/verify the remaining Host service. Never interpret an explicit deferral as a passed Desktop acceptance test.

After the actual client completes the application task and returns a screenshot showing the result, use `confirm-desktop-test --state-dir PATH --device SLUG --from-client --snapshot-id UUID --desktop-task TEXT --desktop-result TEXT --screenshot-delivered`. Supply the real returned Styx snapshot ID and a short nonsecret description of the task and observed result. This records a client-reported attestation, not independent or cryptographic proof; never manufacture a snapshot ID or claim screenshot delivery when the client is still loading. The command rechecks the configured server's desktop readiness.

## Port conflicts and configuration

Omit `--port` for normal onboarding. The default is a preference, not a requirement: choose an available loopback port and persist it in the runtime config. Never ask the user to terminate an unrelated process simply to free port 8791. Explicitly pinned ports retain their intent and require an explicit change if unavailable. On endpoint changes, refresh active local client connections and reconcile any external Tunnel upstream; a local verifier pass is not evidence that an external tunnel was updated. Keep runtime config, progress/digest and credentials consistent through supplied operations instead of manually editing one file.

For a recorded installation that needs a new port, call `reconfigure-port --state-dir PATH --device SLUG` (automatic), or add `--port NUMBER` only for an explicitly selected fixed port. Stop only the verified Styx-owned process first if necessary. If a listener reports Styx-compatible health without an owned receipt, reconcile that server instead of starting a second one. Follow the returned endpoint-change handoff, then start/verify and repeat client acceptance.

## Configuration authority and inspection

For an installed device, run `node scripts/onboard.mjs effective-config --state-dir PATH --device SLUG` before diagnosing a suspected configuration mismatch. The sanitized result reads the admitted runtime config: port and allocation policy, Host grant, requested/enabled Desktop driver, and configured environments. It does not expose the token or private filesystem paths. It is configuration evidence, not proof the client loaded the connection or that a desktop task succeeded.

The runtime `config.json` is the sole desired configuration for installed devices, including `onboarding.desktop_requested` and `onboarding.port_mode`. `onboarding.json` stores authorization, progress, process receipts, result attestations and integrity/recovery metadata. Before installation, it also holds the user's requested configuration; after installation, duplicate desired settings are removed. Version 1 ledgers migrate through the supplied commands without resetting consent or credentials. Do not manually synchronize the two files: unauthorized config edits fail the digest check, while stopping a verified owned process remains possible during drift.

Use `enable-desktop`, `defer-desktop` and `reconfigure-port` for managed changes. External tunnel profiles, persistent OS services and active client sessions are not automatically reconciled. Follow their explicit handoffs and repeat actual-client verification after relevant changes.

## macOS CLI and GUI preparation

Read `node scripts/desktop-setup.mjs --help` from the selected source revision. This helper is separate from the onboarding ledger and handles existing reviewed artifacts; it does not download software, grant OS permissions or install an OS service.

- `node scripts/desktop-setup.mjs check` inspects the existing signed Peekaboo GUI and separate CLI. The default GUI location is `/Applications/Peekaboo.app`; default CLI candidates are `/opt/homebrew/bin/peekaboo` and `/usr/local/bin/peekaboo`.
- `node scripts/desktop-setup.mjs prepare` checks the same pair and returns missing-artifact or compatibility handoffs. `--software-access` records existing software authorization in those handoffs; it does not perform an installation.
- `node scripts/desktop-setup.mjs start --launch-access` requests a background launch of the checked GUI after specific launch authorization. It does not force-quit an app or prove that its Bridge is ready.
- `node scripts/desktop-setup.mjs startup --startup-access` returns instructions for the signed app's own Launch at Login setting. Guide that native action, inspect macOS Login Items and verify after a later normal login. The helper does not write a custom launchd job or claim startup is configured.

Optional `--app-path ABS --cli-path ABS` select artifacts to inspect. The GUI's executable is not the CLI. These flags do not configure runtime executable lookup, and installer PATH checks do not prove the running service uses the same CLI. Follow any `runtime_cli_path_unconfirmed` handoff and verify the actual service through `check-desktop`. Do not copy these artifact paths into a nonexistent runtime setting.

After launch, inspect the exact returned GUI Bridge socket, complete any required Screen Recording/Accessibility grants through the normal OS flow, and recheck the configured server and actual client task. Missing signed artifacts, an unreviewed CLI contract, unavailable Bridge, native startup confirmation or permission grants remain pending. Never manufacture readiness from `signed_pair_present` or `launch: requested`.
