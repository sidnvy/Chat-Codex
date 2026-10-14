# Desktop Core package preparation

This is a local packaging contract, not a release. Package identity remains
`chat-codex@0.3.0`, with `private:true`; no registry publication, installed MCP
identity change, or Charon integration is authorized by this preparation.

The explicit supported ESM entry points are:

```js
import {DesktopCore} from 'chat-codex/desktop/core';
import {DesktopError, desktopObserveSchema} from 'chat-codex/desktop/contract';
```

The Core API and trusted-provider obligations are specified in
[Desktop Core composition](DESKTOP-CORE-COMPOSITION.md). Internal source paths
are not package exports. Existing repository entry commands still use relative
paths, and the archive preserves the server, worker, application HTML, setup,
doctor, runtime scripts, plugin metadata, schemas, contracts, public docs and
examples. Tests, Git metadata, CI and local runtime configuration are excluded.
The package remains the full runtime distribution; it is not a second broker or
a renamed Core-only package.

`npm run test:package` creates actual archives twice with `npm pack
--ignore-scripts`, compares their bytes/integrity, checks content boundaries and
unpacks one into a temporary consumer. That consumer has only Zod available:
it imports the exported Core/contract, observes and dispatches once, rejects
snapshot replay and private module-path imports, and confirms the MCP SDK is
unavailable. Setup's help entry is also executed from the unpacked archive.
This proves import isolation, not platform GUI acceptance or a production
consumer migration. Identical local archive bytes are checked with the executing
npm version; reproducibility across arbitrary npm versions is not claimed.

The full package retains its existing MCP SDK dependency; installing it normally
still installs that dependency. The portable Core import graph uses only the
contract's Zod dependency and Node built-ins. A future standalone package or
dependency split requires a separate identity/release decision. No dependency
versions or lockfile entries are changed here. THIRD_PARTY.md is reconciled to
the committed lockfile, including AJV's runtime transitive role. Known advisory
remediation belongs in the separate dependency update workstream; this artifact
is not a clean vulnerability-audit attestation.

Before an approved immutable artifact is consumed privately: complete the
cross-platform acceptance and dependency/license gates; select the release
identity/version; generate and record tarball SHA-256 and npm integrity against
the reviewed commit with pinned Node/npm; inspect the artifact's source and
notices; then test an isolated pinned Charon consumer. Do not use a floating
branch, publish this private package, copy private driver source, or migrate
production as part of this preparation.
