# Styx MCP Contract Conformance — S1

This is a **public Styx-only** executable baseline for the 24 generic MCP
tools whose names are also present in the Charon distribution. It does **not**
copy private Charon source, import its runtime, or change its deployment.

## What is actually tested

1. A real, authorized MCP SDK Client connects over loopback to a temporary
   Styx server with an isolated empty Project and private throwaway bearer
   credential. The captured `tools/list` input schemas and annotations for
   the 24 shared names must match
   `contracts/styx-mcp-24-baseline.json`.
2. Every shared tool denies unknown per-tool transport/workspace arguments.
   The comparison includes `additionalProperties: false` at the top level.
3. Unknown typed resources fail without Host/Environment fallback or project
   mutations. A known Host does not implicitly grant Desktop access.
4. Known successful list results are represented in `structuredContent`
   by `{items:[]}` rather than a bare array. This is a Styx-specific
   observable behavior to consider when integrating other distributions.
5. A general snapshot comparator reports **name differences**, structural
   JSON Schema constraint paths and annotation differences. It reports
   changed paths, not private schema values, descriptions or credentials.

These tests do not yet assert full Charon-equivalent output contracts for
successful file, process, environment and Desktop mutations. That work needs
provider-backed execution fixtures, recorded Charon behavioral evidence and
separate high-risk GUI tests.

## Reproduce the Styx baseline

```bash
node scripts/capture-local-mcp-contract.mjs > /tmp/styx-contract.json
node scripts/compare-mcp-contracts.mjs \
  --left contracts/styx-mcp-24-baseline.json \
  --right /tmp/styx-contract.json
npm test
```

The capture script creates and removes its own temporary config, Project,
bearer credential and local loopback MCP server. It does not require Docker,
and does not write a secret into the captured JSON.

The comparator takes **local JSON files only**. It does not connect to remote
endpoints or accept credentials and intentionally suppresses raw schema
values from the output.

When a trusted operator has a second surface's schema-only, sanitized
`tools/list` capture (created and stored outside the Styx repository), use:

```bash
node scripts/compare-mcp-contracts.mjs \
  --left contracts/styx-mcp-24-baseline.json \
  --right /path/to/private-tool-snapshot.json \
  --json
```

The second snapshot must use the same normalized envelope:
`{contract_version:1,tools:{name:{inputSchema,annotations}}}`.
`normalizeToolSurface` can also normalize raw `tools/list` arrays.

Return code: `0` = structurally identical, `1` = differences detected,
`2` = malformed or unavailable input. Exit code 0 **does not prove**
equivalent side effects, permission paths or runtime availability.

## Findings from read-only Charon source review

A local read-only extraction of the current Charon `origin/main` declaration
modules found **24/24 matching names and 24/24 structural differences**
when compared to the authenticated Styx baseline. These differences include:

- Styx's narrower typed Target IDs and Host/Environment kinds versus
  additional kinds/identifier policy in another distribution.
- File size, encoding, range/offset and patch command options.
- Process/command arguments and timeout defaults/bounds.
- Desktop action variants, element constraints and wait semantics.
- Read-only, destructive, idempotent and open-world MCP annotations.

Differences in absent versus explicitly set annotations count as
**structural** deltas, not necessarily user-visible breaking changes. The
source-level comparison does not validate the installed Charon app or prove
runtime output compatibility. Source details, raw second-party snapshots,
installed identities and operator-specific configuration stay outside the
public Styx repository.

## Compatibility gate before Charon can consume Styx

- Decide each difference as **keep existing Styx**, **change Styx in a
  versioned migration**, or **provider/distribution-specific extension**.
  Do not broaden execution permissions to make schemas superficially match.
- Record successful request/result fixtures for Host, Environment, Project,
  file, process and Desktop; include denied, stale, disconnected, locked and
  uncertain mutation cases as distinct outcomes.
- Validate effectful operations on test-owned Docker workspaces and optional
  GUI scratch apps, never arbitrary user windows or a production Host.
- Maintain separate provider-neutral authorization and no-fallback gates.
- Allow Charon to consume a reviewed, pinned Styx runtime **only after**
  conformance tests and real M600/Piermini/NAB canaries pass. Do not alter
  Charon's production runtime, installed Plugin, tunnel or settings here.

`contracts/shared-mcp-tool-names.json` is the sole name inventory; the
canonical Styx baseline is an **implementation compatibility snapshot**, not
the final cross-distribution standard.
