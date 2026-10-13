# ADR-0001: Resource identity and lifecycle ownership

Status: Accepted (2026-10-13) - Chat-Codex v0.2.

## Problem

v0.1 offered five implicit coding tools and a Docker job runner that created and removed one container per invocation. That was not a durable Environment. A separately selected Host Runner was unsandboxed. Backend choice and resource identity were conflated.

## Decision

**Lifecycle ownership, not virtualization technology, defines identity.**

- **Host:** externally owned persistent machine, registration controls connectivity but not machine power or lifecycle. Local Linux Host is explicitly opted into and unsandboxed. It can be connected or disconnected; disconnected never means stopped. No Host creation/deletion or environment lifecycle for Hosts.
- **Environment:** owned by a Provisioner and has a real create/start/stop/delete lifecycle. An independently maintained VM/container can still be a Host. Docker is the first implemented Environment backend.
- **Project:** independent repository/directory data; associated with resources but never implicitly deleted on Runtime deletion.
- **Connection/Provider:** internal backend contracts. Their private Docker IDs, SSH transport details or PVE VMIDs never become model-facing target fields.

The public shared execution tools accept only `target:{kind:"host"|"environment",id:string}`. Registry resolution occurs before backend access, with strict JSON Schema and unknown-field rejection. Admin-only private configuration enrolls Hosts/Projects/Environments. Docker failure never switches to Host.

The initial Docker provider verifies ownership labels and expected project mount before every operation. It uses a stable container identity, digest-pinned reviewed image, non-root user, default network isolation, read-only filesystem, no-new-privileges, CPU/memory/PID limits, and only a scoped Project mount. Timeout/output-limit stops the owned Environment rather than leaving a potentially detached child running.

`src/provider-contract.mjs` defines the small future Provider interface. Actual PVE/Firecracker connections are out of scope; there are no fake backend tools.

Task receipts persist to a private file. In-flight tasks surviving only as receipts after server restart are `lost`, not completed. Unknown process termination is never success.

## Consequences

Pro: uniform execution API, explicit authority, persistent Docker runtime, isolated Project lifetime, bounded tool surface and reusable future contracts.

Con: deliberately breaking old MCP tools/config; v0.2 local-only backends; Docker needs trusted daemon access in control server; Local Host is inherently unsandboxed; task receipts are not a distributed queue. `target_apply_patch` supports single-file unified diff on existing text files, not arbitrary binary patches.

## Non-goals

No arbitrary model-controlled Host enrollment, production Charon integration, HomeLab resource names or deployment, PVE commands without a provider, remote VM bootstrap, hosted login, or full file viewer.
