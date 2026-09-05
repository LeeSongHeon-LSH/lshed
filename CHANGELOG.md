# Changelog

## 0.13.0 — 2026-09-05

`--agent agy` places into Google Antigravity (the `agy` CLI and the IDE).

- Skills go to `~/.gemini/config/skills/`, the one global location both the Antigravity IDE and CLI read. Instructions are concatenated into `~/.gemini/AGENTS.md`, one level above that root: agy reads both `AGENTS.md` and `GEMINI.md` there, and Gemini CLI also owns `GEMINI.md`, so lshed leaves that one alone. MCP servers go to `~/.gemini/config/mcp_config.json` in agy's shape (no `type`, `serverUrl` for http); `${VAR}` is filled by `restore`.
- A part above the root (`../AGENTS.md`) is backed up under `lshed/backups/<stamp>/__/` so backups never escape the backup directory.
- Verified on this machine with agy 1.1.26 through the VM probe (`scripts/vm/probe.sh agy`): skill, rules file, MCP list, and a linked skill all read. agy does not read `~/.agents/skills`, so it is not part of the `agents` target.

## 0.12.1 — 2026-09-05

- Fix: with `CLAUDE_CONFIG_DIR` set on a machine where Claude Code has not run yet, `restore` wrote MCP servers to `<dir>.json` next to the config dir instead of `<dir>/.claude.json` inside it, where Claude Code actually reads them. Found by the VM probe below. Without `CLAUDE_CONFIG_DIR` nothing changes.

VM probe for the other agents (`scripts/vm/`): `install-tools.sh` bakes an image with Codex, Gemini CLI, Copilot CLI, Cursor CLI and lshed; `cloud-init.yaml` injects API keys at boot and runs `probe.sh`, which restores a throwaway shed into each tool's real root and asks the tool, non-interactively, for a passphrase kept in a skill, a codeword kept in the instructions file, and the same skill again after `--link`. Where a tool can parse its own config without a model (`codex mcp list`, `gemini mcp list`, `codex debug prompt-input`) that is checked too. Run on this machine against Codex 0.153.2: Codex reads `$CODEX_HOME/skills` (deprecated in its source; the docs now name only `~/.agents/skills`), `$CODEX_HOME/AGENTS.md`, the `[mcp_servers.*]` table lshed writes, and a linked skill.

## 0.12.0 — 2026-09-04

MCP servers follow the shed into the other agents.

- `restore --agent codex|gemini|copilot|cursor` now writes the profile's MCP servers too: Codex into `config.toml` (`[mcp_servers.*]`), Gemini into `settings.json`, Copilot into `mcp-config.json`, Cursor into `mcp.json`. The shed keeps Claude Code's shape; each target gets its own (`httpUrl`, `type: local` + `tools`, `${env:VAR}`, `env_vars` / `bearer_token_env_var`).
- Secrets stay out of Codex and Cursor config files, which take variable names or `${env:VAR}`. Gemini and Copilot take values, filled from your shell at `restore` like settings keys.
- Codex's `config.toml` is edited one table at a time. Comments, ordering and unrelated tables are left untouched.
- `lshed init --agent gemini` (or any of the others) reads that tool's MCP servers into the shed, masked the same way as Claude Code's. `diff` and `save` work across the translation.

 — 2026-09-04

One shed, several agents.

- `--agent codex|gemini|copilot|cursor|agents` restores the same shed into another tool's config root. They all read `skills/<name>/SKILL.md` the way Claude Code does, and `~/.agents/skills/` is the shared location every one of them also reads. Codex gets `AGENTS.md`, Gemini `GEMINI.md`, Copilot `copilot-instructions.md`, each with the profile's instruction fragments concatenated; Cursor and `~/.agents` have no user-level instructions file and skip that category.
- Parts the target does not understand are announced and skipped instead of failing: MCP servers, settings keys and Claude Code agents/commands stay Claude-only, and Claude plugin packages are not installed elsewhere. Each agent root keeps its own state, profile and `--link` choice.
- `lshed init --agent codex` builds a shed from a Codex machine; a shed made by one agent restores into any other. The shed's `agent:` field is now only the default for `--agent`; `$LSHED_AGENT` also works.
- `lshed status` names the agent next to the root.

 — 2026-09-04

Link instead of copy, on the machines where you edit.

- `lshed restore --link` places skills, agents, commands and instruction fragments as links into the shed. Edits in `~/.claude` land in the shed directly; `diff` and `save` have nothing to do and `lshed sync` is the whole loop. MCP entries, settings keys and the generated `CLAUDE.md` are still written as before.
- The choice is per machine and remembered in `state.json`: later bare `lshed restore` calls keep linking, `lshed status` shows `배치 link`, and `restore --no-link` goes back to copies. Other machines keep copying.
- Turning a copy into a link backs the copy up only if it differs from the shed (an unsaved edit); turning a link back into a copy backs up nothing. Switching profiles removes the links and never touches the shed behind them.
- Windows: directories become junctions and need no permission. Single-file parts need Developer Mode for a link; without it the file is copied, the log says so, and it behaves like any other copy.

 — 2026-09-04

Profiles can build on each other.

- `extends: default` (or `extends: [a, b]`) inside a profile pulls in everything the parent lists, then adds the profile's own parts. The parent's parts come first and duplicates appear once, so instructions fragments keep a predictable order in `CLAUDE.md`. Inheritance only adds; for less than the parent, list what you want instead of extending.
- A parent that does not exist, or profiles that extend each other in a cycle, is a `lshed.yaml` error reported before anything is touched.
- Everything that reads a profile sees the resolved one: `restore`, package installs, `lshed list` (a part counts as used by profiles that inherit it), the `add` hint, and `restore <profile> --pick` (inherited parts start checked).

## 0.8.0 — 2026-09-04

Pick what a machine gets instead of writing a profile by hand.

- `lshed restore --pick` walks the shed one category at a time — packages, then skills, agents, commands, instructions, MCP servers, settings keys — and shows a checklist for each. Categories the shed has nothing in are skipped, so a shed with no packages never asks about packages. The choice is saved to `lshed.yaml` as a profile (named after the machine by default, or whatever you type) and then applied like any other `restore`. Saving is not optional: the next bare `lshed restore` reapplies the same choice, and `lshed sync` carries it to your other machines.
- `lshed restore <profile> --pick` starts with that profile's parts checked, so you can trim or extend an existing profile instead of starting from nothing. With no argument, the last applied profile is the starting point.
- On a machine with no applied profile, a bare `lshed restore --shed <dir>` in a terminal opens the picker instead of failing. In a pipe or a script it still asks for a profile name.
- `--dry-run` shows the plan and writes neither `lshed.yaml` nor the agent root. Naming an existing profile asks before overwriting it. Ctrl+C at any screen leaves everything as it was.
- Prompts come from `@clack/prompts`, bundled like the other dependencies.

## 0.7.6 — 2026-09-03

Agents organised in subdirectories were silently left out of the shed.

- Claude Code reads `~/.claude/agents/` recursively (a subagent's name comes from its frontmatter, not its path), but `init` and `add` only looked at top-level `.md` files. A machine with `agents/team/reviewer.md` restored elsewhere without it, and nothing said so. File-kind categories (`agents`, `commands`) are now scanned recursively; the id keeps the path (`team/reviewer`), so your folder layout survives the round trip and two files with the same name in different folders do not collide. Skills stay one level deep, which is what Claude Code reads at the user root.
- Keys accept the path form everywhere: `lshed save team/reviewer`, `lshed add agents/team/newbie`, `lshed remove agents/team/reviewer`.
- Verified against the real binary that the generated `CLAUDE.md` import (`@lshed/instructions/main.md`) resolves relative to the file, so instruction fragments load. That had only ever been checked by reading the generated text.

## 0.7.5 — 2026-09-03

- `init` and `add` now list what they find in a fixed order. `fs.readdir` returns entries in filesystem order, which differs between machines, so two people running `init` on the same harness got manifests whose component lists were ordered differently. `lshed.yaml` is a file you commit, so that showed up as noise in diffs.
- The path-comparison regression test compared a resolved path against an unresolved one and failed on macOS and Windows for the wrong reason. It now compares resolved to resolved, the way the code it guards does.

0.7.4 fixed the three real bugs the first macOS and Windows CI run found; this release fixes the test that came with it.

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
