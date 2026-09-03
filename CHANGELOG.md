# Changelog

## 0.7.4 — 2026-09-03

The first CI run on real macOS and Windows machines found three bugs. All of them were path comparisons that only hold on Linux.

- A stub whose symlink points into a package was not recognised as generated on **macOS or Windows**. The target of a broken link cannot be resolved, so it was compared unresolved: on macOS `/var/folders/...` never matches the package's real `/private/var/folders/...`. Paths are now resolved as far as they exist before being compared.
- The warning for a settings value pointing inside a package never fired on **Windows**, because it matched the raw path against JSON text where backslashes are escaped. It now walks the values and compares them as paths.
- Path comparison is one helper that strips the Windows `\\?\` prefix and ignores case there.
- The test that runs a package's `install:` script is skipped on Windows; `./setup` is a shell script and `cmd.exe` cannot run it.

## 0.7.3 — 2026-09-03

You no longer need Node to run lshed.

- **Standalone binaries** for Windows x64, macOS (arm64/x64) and Linux (x64/arm64), attached to every tagged release. They carry their own runtime (~60-85 MB) and need nothing installed. `npm run binaries` builds all five from one machine.
- **The npm package is self-contained.** `commander`, `yaml` and `zod` are bundled into `dist/cli.js` (627 KB) instead of being installed alongside it; `zod` alone was 7.9 MB. `npm install -g lshed` now downloads one file.
- The version is baked in at build time, so the binaries do not look for a `package.json` that is not there.
- The smoke script accepts `LSHED_CLI=<path>` and is run against the compiled binary in CI, so the binaries are tested, not just built.

The design assumed everyone using a coding agent already had Node, because Claude Code installs through npm. Claude Code also has a native installer, and that assumption cost a user their laptop.

## 0.7.2 — 2026-09-03

Joining a machine that already has a harness, found while preparing the Windows check.

- `restore` warns before removing parts that a **different** shed had claimed. Running `init` against a scratch shed to look around marks that machine's own parts as managed, so a later restore from the real shed would remove them. They were always backed up, but nothing said why. `lshed scan` is the read-only way to look.
- No longer crashes with an `EPIPE` stack trace when output is piped into something that exits early (`lshed status | head`).
- The smoke script now models a machine that already runs the agent: a skill whose name collides with the shed, a skill only that machine has, and its own MCP and settings. It checks that a collision is backed up and replaced, that machine-only parts survive, that nothing is removed, and that `add` pushes them into the shed.
- README: how to join a machine that already has a setup, and why not to `init` there.

## 0.7.1 — 2026-09-03

Groundwork for running on Windows and macOS. Not yet verified on a real machine.

- Package `install:` commands run through the platform shell (`sh` or `cmd.exe`) instead of a hard-coded `sh -c`.
- On Windows, `claude` and other wrappers installed as `.cmd` are found by spawning through the shell.
- Home-directory paths with backslashes are also rewritten to `${HOME}`.
- `sync` explains what to do when git has no user identity.
- `npm run smoke` drives the built CLI through init, restore, add, diff, save, profile switch, list and sync in a temporary directory without touching the real `~/.claude`. Use it on a new OS before trusting a real restore.
- GitHub Actions matrix: ubuntu, macOS, Windows × Node 20, 22. Tests use directory junctions on Windows so no elevated privileges are needed.

## 0.7.0 — 2026-09-03

`settings.json` travels, without merging.

- New category `settings` for Claude Code: each top-level key of `~/.claude/settings.json` (`hooks`, `permissions`, `env`, `model`, `theme`, …) is one component, stored as `settings/<key>.json`. `restore` writes only the keys the profile lists; a profile can carry `permissions` and leave `model` to each machine. `enabledPlugins` is skipped because the plugin packages own it.
- Absolute paths under the home directory are stored as `${HOME}/…` (MCP entries too), so hook commands survive a different home. Claude Code does not expand variables in `settings.json`, so `restore` expands `${HOME}` and other `${VAR}` there from the shell; MCP placeholders are still left for Claude Code.
- `env` in settings is a secret map: secret-looking keys are masked.
- The secret heuristic now matches whole words. `CLAUDE_CODE_MAX_OUTPUT_TOKENS` is not a token; `BYPASS_PERMISSIONS` is not a password.
- `init` and `add` flag an entry whose value points inside a package (a hook a toolkit's installer wrote) and suggest `exclude:`.
- The MCP adapter became a generic "one JSON key = one entry" store used by both categories.

## 0.6.0 — 2026-09-03

- `lshed sync [-m <msg>] [--no-push] [--dry-run]`: commits everything in the shed, `git pull --rebase`, `git push` (setting the upstream the first time). Without `origin` it only commits. When commits come in it says to run `lshed restore`. On a conflict it aborts the rebase, leaves your commit in place and hands you the git command. It warns first if `diff` shows edits you have not saved, and never runs `save` for you.
- README rewritten as a usage guide: day one, daily loop, new machine, profiles, adding things, updating packages, housekeeping, output marks, every command with its flags.

## 0.5.0 — 2026-09-03

`init` was a one-shot. Anything you made afterwards had to be copied into the shed and typed into `lshed.yaml` by hand.

- `lshed add [keys...] [--all]` scans the agent root the way `init` does and lists what the shed lacks: authored skills, agents, commands, MCP servers, and git clones or plugins that should be packages. Without keys it only lists. Chosen items are copied (or recorded with a lock entry for packages), appended to `lshed.yaml` with your comments intact, added to the current profile, and added to the managed set.
- `status` reports things outside the shed as `창고 밖 N개 → lshed add`.
- `init --exclude` is now remembered as `exclude:` in the manifest, so `add` and `status` do not keep proposing the aliases you left out.
- `init` and `add` share one classification path (`discover`) and one ingest path, so they cannot drift apart. `init` now edits a YAML document instead of serialising an object; output is unchanged.

## 0.4.0 — 2026-09-03

Hand-configured MCP servers travel with the profile. Secret values do not.

- New category `mcp` for Claude Code: each user-scope server in `~/.claude.json` becomes `mcp/<name>.json` in the shed. `restore` writes only `mcpServers.<name>` and leaves the rest of the file (machine ID, session state, servers you added by hand) untouched. The file is replaced atomically.
- `init` masks values under `env` and `headers` whose key looks like a secret with `${VAR}` (`EXA_API_KEY` → `${EXA_API_KEY}`, `Authorization: Bearer …` → `Bearer ${NOTION_AUTHORIZATION}`). Claude Code expands `${VAR}` from the environment in every scope, so `restore` places the placeholder verbatim and no secret passes through lshed. Verified against the real binary.
- `restore` and `status` list the variables a profile needs that are not set in the current shell.
- `diff` shows entry changes by key path; `save` keeps placeholders that still match and masks newly added secret-looking keys.
- Profile switches remove only the servers lshed placed, backing each up as JSON.
- Adapter interface: `entries()` returns categories that live as JSON entries instead of files, with `secretKeys` and `expandsEnv` policy. The default root honours `CLAUDE_CONFIG_DIR`.
- Managed-set paths for entries are written as `mcp:<name>`; a colon cannot appear in a path segment, so they never collide with files.

## 0.3.0 — 2026-09-02

Claude Code plugins are packages now. On the machine this was built against, the five installed plugins were the only thing a fresh `restore` still left out, and two of them carry MCP servers.

- `init` records each user-scope plugin as `claude-plugin:<name>@<marketplace>` and each GitHub-backed marketplace as `claude-marketplace:<owner/repo>`. Project-scope plugins belong to their project and are skipped.
- `restore` adds missing marketplaces first, then installs missing plugins through `claude plugin install`. Both are the agent's own package manager, so they run without `--yes`; `--yes` is forwarded as `-y` to accept a marketplace-declared install command.
- Plugins cannot be pinned. `lshed.lock` records the version that actually got installed and `status` shows when it differs from what another machine had. `update` runs `claude plugin update`.
- Installers are an interface now. `github:`/`git:` live in core; an adapter contributes its own (`ClaudeCodeAdapter` provides the two above). Install order follows installer priority, then manifest order.
- Lock entries use `rev` instead of `commit`. Old locks still read.

## 0.2.1 — 2026-09-02

- `lshed list [--unused]` shows everything in the shed and which profiles use it.
- `lshed remove <key>` deletes a component or package from the shed. Refused while any profile still references it. Packages leave the manifest and lock only; the local clone stays.
- `lshed prune [--yes]` removes everything no profile uses. Lists without `--yes`.
- Manifest edits preserve your comments. Empty `packages:` is no longer written.

## 0.2.0 — 2026-09-02

A harness holds three kinds of things, and 0.1 treated them all the same. Running against a real `~/.claude` showed that 55 of 62 "skills" were files generated by one toolkit's installer, and the toolkit itself was a git clone.

- **Packages.** A `packages:` list in `lshed.yaml` records things you *installed* by source and version instead of copying them: `source: github:owner/repo@ref` (or `git:<url>#ref`), `into: <path under the agent root>`, optional `install: <command>`. `restore` clones a missing package at the commit pinned in `lshed.lock`; a package already present is never touched.
- **Generated files are skipped.** `init` recognises a directory as a package when it contains a `.git` with a remote, and recognises a stub as generated when one of its symlinks points inside a package. Both are left out of the shed and the managed set. Aliases that an installer creates without symlinks are not detected; use `init --exclude`.
- **`lshed.lock`** pins each package to a commit. Written by `init` from the existing clone, by `restore` on first clone, and by `update`.
- **`lshed update [ids...]`** fast-forwards packages and refreshes the lock.
- **Install commands run only with `--yes`.** Without it, `restore` and `update` print the commands and stop. A shed can be cloned from anywhere; running its shell commands should be a deliberate act.
- `git:` source scheme for non-GitHub remotes.

Packages are additive: switching to a profile that does not list one leaves it on disk. Removing a clone with a backup would mean copying a repository, which is the wrong tool for that job.

## 0.1.1 — 2026-09-02

Both fixes came from running 0.1.0 against a real 62-skill `~/.claude`.

- Skip regenerable directories when copying: `node_modules`, `.git`, `__pycache__`, `.venv`, cache dirs, `*.log`. A real harness went from 1.6 GB to 6.2 MB. Build output such as `dist/` is **not** ignored by default, because for some skills it is the deliverable.
- Extend the list with `ignore:` in `lshed.yaml`; the same list applies to `diff`, `save` and backups, so ignored files never show up as drift.
- Follow symlinks. A skill symlinked into `~/.claude/skills` used to be skipped silently; it is now captured and copied by content. Broken links are skipped.
- `init --exclude <id...>` leaves out components that do not belong in a shed, such as a toolkit with its own installer.

## 0.1.0 — 2026-09-02

First working release. Claude Code only.

- `init` scans `~/.claude` (skills, agents, commands, CLAUDE.md) into a shed and writes `lshed.yaml`
- `restore <profile>` with managed-set semantics, backups on by default, `--dry-run`
- `status`, `diff`, `save`
- Instructions are assembled as an `@`-import list, not merged
- `file:` sources only; `github:` is parsed but rejected until 0.2
