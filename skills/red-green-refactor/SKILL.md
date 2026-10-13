---
name: red-green-refactor
description: Test-driven coding workflow using Chat-Codex typed execution tools.
---

Select a registered Project with project_list and its explicit Host or Environment target.
Write a failing test with target_write_file, then run target_exec to confirm RED (nonzero exit code).
Implement the smallest change with target_apply_patch; re-run the same test to confirm GREEN.
Refactor with small patches and re-run the suite after each change. Preserve stdout, stderr,
exit_code and termination as evidence; timeout or unknown is not a green test.
Prefer a disposable Environment for untrusted source and potentially dangerous commands.
Do not invent or silently create new Hosts; use the environment lifecycle tools only for
registered disposable Environments and verify the resulting state.
