# Environment Provider Contract v1

The Core Typed Router validates `target:{kind:"environment",id}` against the administrator-owned Registry before any Provider IO. It resolves a trusted Environment entry and independent Project, and dispatches to the Provider.

The required methods are:

| Method | Meaning |
|---|---|
| `status(entry,project)` | Real `lifecycle: absent|created|running|stopped`, `ready` only when running |
| `create(entry,project)` | Create an owned stable resource; do not auto-start |
| `start(entry,project)` | Start a provisioned Environment, not a Host |
| `stop(entry,project)` | Stop compute while retaining the Project |
| `delete(entry,project)` | Remove only provider-owned runtime resources; retain Project |
| `run(entry,project,job,{signal})` | Execute bounded file/command operation with typed receipt |

A Provider must verify resource ownership on every destructive or execution operation and reject a mismatched identity, mount, or configuration. No Provider can infer a machine's lifecycle from mere transport connectivity. The model never supplies a Docker ID, VMID, SSH address or other provider-specific field.

Execution receipts have stdout, stderr, exit_code, termination and duration_ms. File jobs also return structured result. A cancellation, timeout or failed cleanup must not be falsely reported as success. The Docker implementation intentionally stops the whole Environment on timeout/output limit/cancellation rather than assuming killing the Docker CLI stopped its inner process.

Implementation assertions: `src/provider-contract.mjs` and `test/provider-contract.test.mjs`. The real Docker implementation additionally runs in the HTTP lifecycle/integration suite, including stable container identity and Project retention. Other Providers must add real integration/ownership tests before registering their resources. PVE, Firecracker and generic sandbox APIs remain contracts only.
