---
name: styx-onboarding
description: Guide a user through selecting devices, authorizing access, configuring Styx with deterministic scripts, and verifying the intended Chat connection; resume an existing setup without overwriting it.
---

# Styx onboarding

Help the user reach a Codex-like development experience from Chat on their selected devices. Explain decisions in ordinary language; run supplied scripts for deterministic work. Installation does not require an existing Styx connection.

## Establish the outcome

Start by explaining the outcome and asking which devices to connect: this computer, this computer plus others, or other devices only. Detect local platform details rather than asking the user to supply them. Reuse choices and authorizations already provided in the conversation.

For each device, explain that default Host execution uses the running account's file, command and network privileges. A project directory does not sandbox Host commands. Offer containers as optional isolation. Desktop preparation is included by default, using the platform driver without asking novices to choose a backend. Desktop access still needs separate explicit authorization and OS permissions. Only defer this stage when the user chooses to; preserve the deferred status. Obtain authorization for the concrete device and selected capabilities; selecting one device grants no authority over another.

If no checkout exists, fetch INSTALL.md from https://github.com/sidnvy/Styx, resolve the chosen revision to an exact commit once, and acquire that checkout. Use INSTALL.md, this skill, scripts and dependency lockfile from the same commit. Prefer the user’s existing version selection; inspect existing progress before acquiring another installation. Record the chosen commit. Keep instructions, lockfile and scripts at that revision. Do not execute an unreviewed moving remote install script or invent a registry package release. Read [the procedure](references/procedure.md) for commands, supported boundaries and handoffs.

## Execute and resume

Use onboarding JSON state and next actions. Keep the private state path available for a later session, without exposing credentials or private configuration contents. Inspect existing state before performing changes; never erase a configuration to make an installation appear fresh.

Run authorized deterministic steps without asking the user to copy commands. Ask for decisions when authority changes: software installation, administrator privileges, remote access, persistent startup or desktop permissions. Do not request confirmation again when the specific action was already authorized. Do not silently substitute Host access for a failed container setup.

If a script reports a known prerequisite or waiting action, explain its purpose and the minimum user action. Recheck after completion; a user saying “done” is not technical evidence. An unresolved failure must preserve resumable progress. Do not repeatedly retry the same failure or broaden system changes to force success.

## Establish trust and finish

Explain who will access which device through the connection. Credentials stay in local private files or the client's supported secret store, never in chat, command arguments or diagnostic output. Follow the actual client's current supported authorization flow; do not invent settings pages, API keys or private tunnel products.

Distinguish local configuration, authenticated MCP connectivity and a task completed through the intended Chat client. Local verifier results do not prove that the current Chat client loaded the tools. Require fresh client-side tool discovery and an explicitly targeted harmless first task, with independent result verification, before describing that client connection as complete. For the default Desktop journey, additionally perform a real application task and verify both its resulting state and screenshot delivery in the intended client; a ready status or Host command is insufficient. Keep any unsupported or pending device visible without blocking ready devices.

Finish with the available devices/capabilities, pending steps, one suggested task and the actual supported way to stop access. Do not claim a revoke/uninstall command or background-service behavior that is not implemented.
