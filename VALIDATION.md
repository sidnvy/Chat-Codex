# Validation — 2026-10-09

This repository is independently written. No Charon/Coder source or external example implementation is required or copied.

Verified on Linux using a non-root host user, Node v26.5.0, npm 12.0.1, Docker Engine 29.6.2 and the locally available official node:22-bookworm-slim image. The integration test ran setup.mjs, which resolved the image digest, generated temporary credentials and configured separate temporary project/private directories.

- `npm install --ignore-scripts --no-audit --no-fund`: installed the exact direct dependencies; generated committed npm lockfile (94 transitive/install entries).
- `npm test`: 1 runner configuration test passed.
- `node --check`: server, runner, worker, setup passed.
- `npm run test:integration`: **26 assertions passed**, real HTTP MCP server, official SDK client and actual Docker containers. No mock gateway/backend.
- Read/list/write → deliberately failing Node test (exit 1) → exact edit → passing test (exit 0).
- Authentication missing/wrong token and Origin rejection.
- File traversal and symlink traversal rejection.
- Non-root execution, host credentials/Docker socket absent, read-only container root, external TCP connection unavailable.
- Timeout and 64 KiB output limit terminate containers; stderr and nonzero exit propagation verified.
- Missing edit match and concurrent operation rejected.
- All test containers cleaned up; temporary project and credential directories removed.
- Inspected the existing official tunnel-client v0.0.14 `run --help` in an offline disposable container. Documented run flags are present. No runtime key, tunnel identity, account connection or persistent auth grant was created.

Not verified: a fresh ChatGPT account/workspace and live Secure MCP Tunnel; macOS/Windows/rootless mappings; clean host Node 22 installation; hostile-kernel/container-escape resistance. Container execution uses Node 22, but the host SDK server was tested with Node 26. New account access, plugin installation and tunnel credentials remain user-owned setup steps.

One final integration invocation initially used the parent directory and failed before tests (missing package.json); rerun from this repository passed all 26 assertions. No production checkout/services/authentication/configuration were changed. That implementation validation preceded the separately authorized public-source publication.

Known limits: one operator/project, serialized calls, offline execution, no PTY/background service, maximum 60 seconds per command. Project disk use is not quota-limited; use a disposable/quota-managed filesystem for untrusted large writes. Unexpected gateway SIGKILL/host crash can leave containers; documented manual inspection/cleanup is required. The Docker-capable gateway itself is trusted host code, not sandboxed against a hostile local user.
