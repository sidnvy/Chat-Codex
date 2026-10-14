# RFC 0002 — Styx Foundation: one runtime, composable distributions

- **Status:** proposed, implementation RFC (not yet released)
- **Scope:** public `sidnvy/Styx` (renamed from `sidnvy/Chat-Codex`) and private Charon distribution
- **Reference baseline:** public Chat-Codex `f0cba3c` (v0.3.0); private consumer implementation inventory is tracked separately
- **Related:** [v0.4 Golden Path issue](https://github.com/sidnvy/Chat-Codex/issues/3), `docs/ADR-0001-resource-ownership.md`, `docs/PROVIDER-CONTRACT.md`

## Decision

The private distribution's module-level source inventory, implementation SHAs, acceptance receipts and infrastructure evidence are maintained only in its private repository; no private source, host catalog, secrets or internal paths are imported into this public RFC.

**Styx is a standalone, client-neutral open-source runtime**, not a proxy to a private Charon service.
**Charon is a distribution assembled from Styx plus optional providers, operator policy,
private extensions, branding, catalog, secret configuration and deployment.**

Styx owns exactly one implementation of the general-purpose MCP protocol gateway,
resource and execution model, project/workspace lifecycle, task and result receipts,
Desktop Broker, generic viewers, safe settings foundations, and agent-facing Skills.
Docker, Coder and locally admitted Host execution are selectable **providers**.
Service deployment and HomeLab-specific integrations are optional **extensions**,
not components of the default public runtime. Charon must eventually **import
pinned Styx packages**, not copy implementation files or privately fork its Core.

GitHub repository rename is a naming/identity action. The new runtime is **not**
declared implemented by that rename. The versioned package names, MCP server
advertisement, Plugin identities and installed Charon distribution remain
unchanged until separately reviewed release gates pass.

## Why this is a consolidation instead of another fork

Both current servers expose overlapping typed `host_*`, `environment_*`,
`project_*`, `target_*` and Desktop MCP surfaces, but they implement different
provider bindings, response contracts and UI capabilities. Name equality does
not imply wire compatibility. Do not replace a running Charon component merely
because Styx's similarly named module passes unit tests.

The target metric is **one owner per generic capability**, not one repository or
one deployment. During migration, the legacy Charon runtime is maintained only
for security and production correctness; new general functionality lands first
in Styx and Charon upgrades a pinned version after conformance acceptance.

## Stable semantic boundaries

| Layer | Styx contract | Examples | Not permitted |
| --- | --- | --- | --- |
| Core | Registry, typed identity, lifecycle admission, task/desktop state machine, shared authorization and error semantics | `createRuntime()`, `TargetRef`, `OutcomeReceipt` | Coder wire formats, Docker CLI calls, private Host IDs |
| Provider | Inspect/provision/execute/read/write/process via capability methods | Docker, Coder, local Host | Overriding Core admission, implicit Host fallback |
| Desktop Driver | Session readiness, exact-window observation, capability-specific mutation | Hyprland, Peekaboo, native WinApp | Arbitrary shell/UIA expression supplied by model |
| Gateway | MCP serialization, tool/resource/schema enforcement, isolated client adapters | Streamable HTTP, Composer Mentions, MCP App | Provider-specific security decisions |
| Extension | Namespaced service operations, verified extra UI and settings | Charon service deploy/recovery | Mutating Core's capability grants, unbounded tools |
| Distribution | Package/brand/install/deploy identity | Styx Community, Charon | Credentials or live installation IDs in public source |

A **Host** is persistent, externally operated and connection-oriented; a
provisioned **Environment** has an independently enforced lifecycle. Coder
can provide *either* kind through reviewed, explicit bindings; it is not a new
resource kind. A **Project** remains independent of the execution target.
The same physical machine being referenced through two providers must never
silently grant authority or merge identities.

## Illustrative composition API (proposal; not current source)

```ts
const app = createStyxRuntime({
  providers: [dockerProvider(), localHostProvider(), coderProvider()],
  drivers: [hyprland(), peekaboo(), winappNative()],
  extensions: [charonServices(), charonUI()],
  policy: charonPolicy,
  distribution: { id: "charon", branding: "Charon" }
});
await app.serve(mcpTransport);
```

Providers and extensions are installed through a trusted, reviewable factory
registry. Model input cannot create arbitrary executable paths, providers,
plugin URLs, grants or authority. The composition API is internal until its
schema/version support policy and capability conformance tests pass.

### Provider contract

All providers implement **inspect()** first. Optional capabilities are
declared and validated independently:

- `exec` / `filesystem` / `process`: bounded execution and durable receipts.
- `lifecycle`: create/start/stop/delete only when provisioner-owned and admitted.
- `preview`: provider-specific verified URL reachability, never inferred public accessibility.
- `desktopTransport`: only an authenticated and approved session-local transport,
  independent of generic shell execution.

No arbitrary fallback from Docker/Coder Environment to Local Host is allowed.
A connected Coder Agent does not prove an interactive desktop is unlocked.

### Driver and state contract

The **four typed Desktop tools** remain the shared API:
`target_desktop_status`, `target_desktop_observe`, `target_desktop_act`, `target_desktop_wait`.

- Explicit Desktop capability is default-off and separate from generic Host access.
- Window identity is exact and revalidated before mutation, using the available
  PID/process-generation/session/user/window fingerprint.
- Snapshots are Host/driver/session/window-bound, consumed exactly once,
  expire after 30 seconds, and hold native receipts privately.
- Status distinguishes `ready`, `locked`, `no_session`,
  `permission_denied`, `driver_unavailable`, `session_unverified`.
- Mutations report `dispatched_unverified`, independently `verified`, or
  `outcome_unknown`; an unknown outcome must never be automatically replayed.
- A screenshot or application content is untrusted data, not an authorization grant.
- Portable Windows adapter uses a reviewed, signed, version-pinned native
  session-local worker and structured bounded IPC. No Defender exclusions,
  encoded PowerShell payload workarounds or privilege escalation.

### Extension boundary

An extension can register **namespaced** tools and UI resources under an
independent grant. It cannot replace an existing Core tool definition, access
another extension's credentials, bypass Host/desktop admission, or silently
alter lifecycle ownership. A distribution may choose which extension tools
are exposed to the model vs. the MCP App.

Generic Settings provides operator-approved Host/Desktop toggles with an
unambiguous scope. Charon-specific service approval and release gates stay
in its add-on/distribution until an independently useful generic contract
exists.

## What stays in each repository

**Public Styx** owns Runtime, Registry, generic MCP Gateway, Desktop Broker,
Hyprland/Peekaboo/WinApp Drivers after license/provenance review, Docker and
optional Coder Providers, Local Host, generic artifacts/viewers, Home,
Settings foundations, Doctor, Guided Setup, first-run verification and generic Skills.

**Private Charon** owns: HomeLab inventory/catalog and credentials; service
release/recovery policy and operations adapters; deployment configuration;
private branded UI/Skills; Charon Plugin/App immutable IDs, tunnel binding,
CAS release receipts, canaries and rollback. Charon's install and release
lifecycle is independent from Styx source.

Public Coder Provider code must have no stored endpoint, user, token, internal
hostname, HomeLab identity, deployment receipt or private default. Its use
requires the user's own existing Coder service and credentials.

## User-facing distribution model

- **Styx Community:** recommended Docker sandbox Golden Path; optional
  existing Coder workspace and explicitly trusted unsandboxed Host; Desktop
  optional/permission-gated. Doctor + Setup + first-run MCP evidence.
- **Charon Edition:** Styx runtime with private catalog, restricted Coder
  transport settings, special service operations, branded Home/Plugin and
  independent guarded release system.
- No separate implementation of Core tool dispatch, resource admission,
  Snapshot manager or task outcome classifier in Charon once migration is accepted.

## Identity and naming migration

1. Rename the existing GitHub **repository only** from `sidnvy/Chat-Codex`
   to `sidnvy/Styx` after collision/permissions checks; preserve Git history,
   Issues, PRs and redirects. GitHub repository name `sidnvy/Styx` was
   unoccupied at the start of the migration. Update checked-out remote URLs. Avoid reusing
   the old repository name; GitHub redirects could otherwise break.
2. Keep current `chat-codex` package, `Chat-Codex` advertised MCP name,
   root manifests and Plugin identity at **v0.3.0** until a separately
   reviewed compatibility/release decision. Do not unilaterally change
   users' configured endpoint, token, plugin install or Charon binding.
3. Name the future public software `Styx Core` and its optional binary
   `styx-server`. **`Styx Host`** refers to the pre-existing physical
   HomeLab infrastructure host; do not rename/reconfigure that machine.
4. The unscoped npm name `styx` is **already in use**. Prefer a
   scoped publisher-controlled package (for example
   `@sidnvy/styx-core`) after ownership and publishing permissions
   are independently checked; no new package is published by this RFC.
5. Before a product release, update documentation, links, repo badges,
   package and MCP metadata, Skill names, onboarding screenshots and
   plugin manifest coherently. Provide a deprecation/alias window only
   when a concrete installation compatibility requirement justifies it.
6. Public source never contains installer-specific App IDs, secret paths,
   endpoint credentials, private Host catalogs or release receipts.

## Incremental delivery and test gates

| Stage | Work | Gate |
| --- | --- | --- |
| S0 | Rename repo + publish RFC and ownership/compatibility inventory | Existing v0.3 CI unchanged; all Issues and PRs retained |
| S1 | Minimal core/provider/extension interface, common conformance fixtures | No duplicate tool grants; old Docker and Charon contracts recorded |
| S2 | Move mature reusable Desktop/Task/Gateway/Artifact slices into Styx | Real Styx MCP/GUI E2E; provider-neutral API; provenance/license audit |
| S3 | Public Coder provider + Golden Path onboarding | Independent Docker, Coder optional; first-run real authenticated SDK evidence |
| S4 | Charon imports **pinned Styx artifact** and removes equivalent legacy code one slice at a time | M600, Piermini, NAB, service and artifact canaries; rollback preserved |

S0/S1 must not delete Charon implementation or change its deployed server.
Charon production migration is separate and requires explicit deployment
authorization, exact reviewed Git SHA, immutable image, normal/outage canaries,
independent Plugin/App identity read-back and a known working rollback.

## Immediate PR handling

- Preserve open v0.4 Doctor PR (no forced rewrite); Doctor is a generic
  Styx Foundation utility.
- Keep separate review branches for Provider API/Contract, Desktop Core
  conformance and UX Golden Path; do not combine all migration work
  into a single unreviewable PR.
- No new third 'mirror' or public proxy repository.
- After repository rename, open a separate product-name/manifest PR only
  when the package and Plugin compatibility plan is validated.

## Explicitly deferred questions

- Whether published JavaScript packages will be a single package or a
  monorepo workspace; decide after proving cross-repo dependency consumption.
- Whether Coder Provider is bundled or an optional public package; it must
  remain a selectable provider either way.
- Whether services are generally useful enough to move from Charon add-on
  into the community edition.
- Branding, external domain and trademark clearance. GitHub availability
  does not establish exclusive rights to the name Styx.

## Definition of success

A real Styx Community user can install, authorize an MCP endpoint and
complete an isolated Docker coding task; optionally select an authorized
Coder/Host/desktop path. Charon can run its existing infrastructure against
the *same* tested Core packages without a second private Core implementation,
while production release and private settings remain independent.