# Migration: v0.1 to v0.2

**Breaking changes.** Existing v0.1 `backend`-based private configuration is not accepted by the v2 registry. This is deliberate to avoid silently extending execution permissions.

| v0.1 tool | v0.2 tool |
|---|---|
| `list_files({path})` | `target_list_directory({target,path})` |
| `read_file({path})` | `target_read_file({target,path})` |
| `write_file({path,content})` | `target_write_file({target,path,content})` |
| `edit_file({path,old_text,new_text})` | `target_apply_patch({target,path,patch})` using a single-file unified diff |
| `run_command({command,...})` | `target_exec({target,command,...})` |

v0.1 Docker Runner executed each operation in a newly created and removed ephemeral container. v0.2 uses a real provisioned, long-lived Environment: invoke environment_create and environment_start before commands. Existing ephemeral Docker jobs are **not adopted** as Environments. `backend:"host"` is now an explicitly registered unsandboxed Host, never an Environment. Project registration remains independent.

**Safe migration:** back up current project and private config; checkout v0.2; install dependencies; use new independent directories with `npm run setup -- NEW_PROJECT NEW_PRIVATE --backend docker` (or `--backend host` / `both` deliberately); copy only trusted project files into the new Project. If reusing a pre-existing Project, create v2 config with setup first, then stop the server and carefully edit `projects[0].path` to an audited absolute path outside the source/private directories. Do not copy tokens into the repository.

The generated owner UUID, Docker digest and non-root user are security-critical config fields. Do not hand-edit them to adopt other resources. The server will refuse mismatched container ownership.

Update MCP client tools and Skills. Reconfigure your private tunnel/plugin registration separately; local tests do not certify account-level ChatGPT installation. The canonical Desktop route is Work -> @ -> MCP servers -> Chat-Codex -> Search Resource -> Select.
