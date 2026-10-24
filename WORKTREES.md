# Task ownership and worktrees

## Current staging baseline

See [branch-state.md](docs/branch-state.md) for the verified staging release,
the development branch, undeployed homepage/download changes, and the inventory
of older worktrees. For staging app work, start a task from
`codex/staging-baseline`, or explicitly from `codex/staging-next` when the pending
website changes are needed. `main` is not the current staging source.

`pnpm workspace:status` reports the locally configured staging baseline and
development branch. The commit guard protects `codex/staging-baseline` alongside
`main`; record a new deployed version only after verifying its release evidence.

## General workflow

Use a separate worktree and `codex/<task>` branch for each task. Codex should
reuse a suitable worktree attached to the chat or create a managed worktree from
`main` (or an explicitly selected reviewed commit). A managed worktree may start
detached; create the task branch before editing. Run all task commands in that
worktree's directory. Never share build outputs, `.next`, mutable dependencies,
or an index between task directories. Install dependencies separately with pnpm;
its content store can reuse downloads. Configure local environments as needed;
do not automatically copy credentials.

```bash
pnpm workspace:status
pnpm workspace:guard
```

The status command reports actual registered worktrees and their staged,
unstaged, untracked, and conflicted file counts. Renamed paths count once; staged
and unstaged counts can overlap. Counts refer to files, not collapsed directories.
`shared-unassigned` marks the preserved legacy checkout; it is not an authorship
guess. A task's review should compare its changes with its selected starting
commit and include only that task's explicitly staged files.

The guard is local Git configuration shared by this repository's worktrees.
It blocks commits from `main`, detached HEAD, `codex/shared-wip-*`, and the shared
checkout even if its branch is renamed. It does not overwrite custom hooks or
automatically run tests. `SYNTARA_ALLOW_SHARED_COMMIT=1` is a one-command escape
for explicitly authorized integration/migration work. Do not use it for routine
task commits. Git hooks can be bypassed; the worktree rules still apply.

## Preserved shared work

The original checkout was moved from `main` to
`codex/shared-wip-2026-10-21` without changing its files or index. At that checkpoint,
`main` pointed to `b8f38fa847d74f53182929c1eb9adb5448926bd4`. No legacy changes were committed
or pushed. Existing chats still pointing at the original directory are not
automatically relocated; their next code task must use its own worktree.

A verified local checkpoint is stored under the common Git directory:

```
codex/checkpoints/shared-wip-2026-10-21/
  manifest.json       # base commit, file hashes and mixed/unassigned provenance
  staged.patch        # staged tracked changes
  unstaged.patch      # unstaged tracked changes, including binary changes/deletions
  untracked.tar.gz    # non-ignored new source and assets
  ownership/          # evidence-backed patches attributable to this chat
```

The checkpoint is private local recovery data, not a reviewed commit or a PR
base. Ignored credentials, databases and backups remain in their original
locations and are not in the archive. To recover, create a separate worktree at
the manifest's base commit, apply the nonempty staged patch with `git apply
--index`, apply the unstaged patch with `git apply`, then extract the archive
there. Verify hashes against the manifest. Do not restore over ongoing work.

Historical changes must be reviewed and migrated by explicit feature scope;
filenames and modification times cannot reliably identify their originating chat.
`ownership/provenance.json` identifies the saved before/after evidence for the
known tooling and cleanup patches from this chat. Other legacy changes remain
unassigned; the checkpoint does not infer ownership for them.
Developer-tool bootstrap copies made by this chat are recorded in the local
`codex/workspaces.json` registry so they can be distinguished from that snapshot.
