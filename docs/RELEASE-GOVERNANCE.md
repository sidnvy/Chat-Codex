# Release and publication governance

This independent MIT project keeps source development, MCP server rollout and
ChatGPT Plugin installation as separate operations. The Git repository is the
canonical source. A local checkout, developer's ChatGPT account or installed
Plugin is never an alternative canonical source.

## Source/CI gate

1. Propose changes on a feature branch; require review and successful unit,
   real MCP HTTP, Docker lifecycle and plugin protocol checks before merging.
2. Treat MCP Tool schema changes as server changes. Inspect migration notes,
   input validation, runtime permissions and capability grants.
3. Enforce source version agreement among package.json, portable plugin.json
   and the advertised MCP Server version using release-consistency.test.mjs.
   This is a SOURCE consistency test, not proof that a Plugin has been updated.
4. Keep the portable Agent Plugins manifest compliant with the official
   published schema; do not add nonstandard top-level skills fields.
5. Never package installer-specific App IDs, tunnel identifiers, credentials,
   local Host registrations or private paths.

## Installed Plugin release gate

A publisher must inspect the relevant installation platform and use its
documented update operation. Before publication, identify the installed
plugin's immutable ID, current release/version, and any app bindings. Use
reviewed Git main and a deterministic, verified archive. When the platform
supports optimistic concurrency, supply its expected release identifier.
Do not recreate an existing Plugin just to resolve version mismatch.

Immediately read back the newly installed manifest, all Skill files and
associated App bindings. Compare them with the approved source and explicit
installer-owned overlays; unknown normalization or identity changes fail
acceptance. Record source commit, version, archive hash, previous/current
release identities and acceptance results without committing private IDs.

A GitHub Actions pass does not by itself enforce writes performed directly
inside an external Plugin editor. Out-of-band changes require a drift audit.
When the canonical installed App identity is unresolved, do not publish an
overlay that claims successful binding reconciliation.

## Desktop changes in v0.3

A Desktop Capability implementation adds typed MCP APIs but does not grant
desktop access merely by registering a Host. A GUI driver is opt-in, and
runtime session readiness is independently checked. Real Linux E2E validation
does not claim Windows/macOS or account-level ChatGPT acceptance.

This branch neither builds an installed Plugin release artifact nor calls any
Plugin Creator update. Deployment and plugin installation are separate,
explicit steps after review.
