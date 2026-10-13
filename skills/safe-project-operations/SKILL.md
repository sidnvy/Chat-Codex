---
name: safe-project-operations
description: Scope project file edits and validate command and background task outcomes.
---

Begin with project_list and project_status; choose an explicit admitted target.
Use relative paths for target_list_directory, target_read_file, target_write_file,
and target_apply_patch. Never request traversal, absolute paths, or symlinks leaving the project.
Review patch context and git status before making destructive edits.
Treat target_exec as potentially destructive, even in an isolated Environment; keep Git backups.
For host targets, assume shell commands can touch anything accessible to the OS user.
For background work, record the session_id, poll target_process_poll until a terminal state,
and classify completed, failed, cancelled, lost, and unknown separately.
Use target_process_stop only when needed; never interpret unknown termination as success.
Composer mentions identify resources but do not grant extra permissions.
