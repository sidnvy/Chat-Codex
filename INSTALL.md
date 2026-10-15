# Connect your devices to Chat

Styx lets a compatible Chat client work with files and run development tasks on devices you control. Start with your local Codex agent: it can guide you through setup and run the installation tools for you.

Copy this into your local Codex agent. You do not need to clone the repository first:

> Help me set up Styx from the official repository https://github.com/sidnvy/Styx. Fetch its INSTALL.md, resolve the chosen source revision once to an exact commit, then acquire a checkout and use INSTALL.md, skills/styx-onboarding/SKILL.md, scripts and dependency lockfile from that same commit. First help me choose which devices to connect and explain what access I am granting. Use the supplied onboarding scripts for installation and checks. Host execution and Desktop setup are the default path; containers are optional. Prepare the platform default Desktop driver, explain and request Desktop access separately, and verify a real desktop task. If I explicitly defer Desktop, keep it visible as deferred. Complete the steps already authorized, and guide me only through decisions and actions that need me. Keep credentials out of chat. Resume existing progress instead of starting over, and verify a task from my intended Chat client before calling the connection complete.

Your agent acquires [the official source](https://github.com/sidnvy/Styx) and records its exact commit before installation. If you already selected a version or have an installation, it should reuse that choice and inspect existing progress. This is a source-based preview, not a published one-click installer.

## What you will decide

1. **Which devices?** This computer, other computers, or both. Each device needs its own authorization.
2. **What access?** File and command execution on the selected computer is the default. It runs with the local account's privileges. A default project folder does not restrict commands to that folder. Desktop viewing and control are included in the default setup journey, with separate explicit access authorization and OS permissions. You can defer Desktop and continue with file and command access. An isolated container workspace is optional.
3. **Which Chat connection?** Authorize the client that will use your selected devices. Your agent explains where the connection transfers access and guides you through any required login or confirmation.

The agent handles checks and configuration. After installation, one private runtime config supplies the effective port, Host access, Desktop selection/grant and optional environments. The agent can inspect a sanitized effective view; credentials and progress remain separate. It should explain any software installation, administrator access, remote access or persistent background service before making that change. Ordinary progress is summarized; detailed command output is available when needed.

## What works today

Automatic local configuration supports a non-root **Linux or macOS** account with Node.js 22+ for Host execution. Optional Docker setup is Linux-only; Docker Desktop on macOS is not yet verified. Missing system dependencies still require the appropriate installation path and authorization. The onboarding ledger can track other devices, but does not enroll remote machines or combine them behind one gateway.

For local Codex, the agent can register a named connection using the supplied script, without copying the server token into the client configuration. ChatGPT still needs a compatible authenticated endpoint and its account-side authorization flow. Styx does not automatically create an OpenAI tunnel or generate platform API keys. The agent selects the platform default driver: Peekaboo on macOS, Hyprland on supported Linux sessions, and WinApp for Windows integrations. On macOS, Peekaboo requires its separately distributed signed CLI and signed GUI app. The supplied helper checks an existing pair and can request a separately authorized launch; missing reviewed artifacts and the app’s native Launch at Login setting remain explicit handoffs. Driver software prerequisites and OS permissions must be satisfied before desktop use; Windows native Host installation remains unsupported. Default selection never grants access automatically. Your agent should identify these boundaries before starting an unsupported installation.

You can resume later by telling your agent to continue Styx onboarding and giving it the saved state location. Local checks, Host client execution, and actual desktop task acceptance are reported separately, so a pending connection is not mistaken for a completed installation.

[Agent procedure](skills/styx-onboarding/SKILL.md) · [Operator guide](docs/ONBOARDING.md)
