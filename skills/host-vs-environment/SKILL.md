---
name: host-vs-environment
description: Choose safe execution resources and understand lifecycle ownership in Chat-Codex.
---

A Host is externally maintained and persists independently of Chat-Codex. It can be connected
or disconnected, not created or stopped with environment tools. Local Hosts are **unsandboxed**
and access the same-user filesystem and network; use only with trusted code and explicit intent.

An Environment is created and managed by its Provisioner. The Docker Environment is isolated
by default, with no network, root access, socket or secret mounts, and a reviewed pinned image.
Use environment_status, create, start, stop, delete; do not infer started from connected.
Use the same target_exec, target_read_file and other shared tools with
target={kind:"environment",id:"..."} or {kind:"host",id:"..."}.
Do not pass Docker IDs, SSH addresses, PVE VMIDs or provider-specific fields as target identity.
Stopping or deleting an Environment does not delete its independently registered Project data.
