# Default Desktop onboarding

Desktop preparation belongs to the default device onboarding journey. Containers remain optional. The agent selects a supported platform driver; novice users do not choose a backend. Driver selection and software preparation do not grant screen or input access.

## Platform policy

| Platform | Default path | Preparation and current limits |
| --- | --- | --- |
| macOS | Peekaboo | Prepare the separately signed reviewed CLI and GUI Bridge, Python and native session tools; guide Screen Recording and Accessibility permissions. Confirm an unlocked same-user console. |
| Linux / Hyprland | Hyprland adapter | Check the active compositor session and required capture/input programs. Check pointer prerequisites separately; Hyprland support is not generic Linux desktop support. |
| Windows | WinApp integration | Preserve reviewed binary hashes and native session checks. Automatic standalone Windows Host installation is not implemented; report this handoff as unsupported rather than complete. |

Keep the existing platform adapters behind Styx Desktop Core. CUA remains a separately evaluated candidate; no migration or automatic fallback is implied. A future replacement must pass the same tasks, preserve authorization/targeting semantics, and demonstrate lower overall installation and maintenance cost. A successful comparison on one OS does not qualify all operating systems.

## Deterministic preparation

Read-only preflight identifies missing dependencies, unsupported sessions and the next required user action. The agent prepares missing software using reviewed platform installation instructions within the user's authorization. This repository does not yet contain a universal driver downloader; it must not report dependency installation from a configuration flag.

For macOS, `node scripts/desktop-setup.mjs check` or `prepare` validates existing signed CLI/GUI artifacts. `start --launch-access` requests an authorized GUI launch. `startup --startup-access` returns the native Launch at Login handoff; it does not create a service or change permissions. Missing artifacts remain a reviewed installation handoff. Artifact-path flags do not configure the service PATH.

After explicit Desktop authorization, use the onboarding command to enable the admitted driver in private configuration while the owned server is stopped. Restart and reverify the server and client. Keep access credentials private. If the user defers Desktop, retain the choice and keep Host operations available. Resume existing installations without overwriting unrelated configuration.

## Acceptance contract

Track these independently: selected driver, software prerequisites, Desktop access authorization, OS permissions, current session readiness, actual client task, and screenshot delivery. Readiness is checked through the authenticated configured MCP server; dependency inventory is explicitly scoped to the installer process. A status response is a point-in-time observation, not proof of future readiness or task execution.

The first real task must run through the intended client: open a harmless application, identify the exact target, perform an operation, independently read the resulting state, and deliver a fresh screenshot showing the result. The calculator regression is 38 × 38 = 1444 in the actual calculator window; arithmetic computed by the agent does not satisfy it. Text input, shortcuts, pointer operations and Unicode need additional cases where supported. Do not retry an action with unknown outcome without observing first.

Record client-side desktop acceptance separately from local readiness. A user's explicit deferral may finish the selected Host-only scope but must remain visible. Missing installers, OS permissions, unsupported platforms or screenshot rendering failures remain pending; they are not test passes.
