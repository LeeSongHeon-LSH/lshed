# Changelog

## Unreleased

- `lshed report --open` on Windows went through `cmd /c start`, which cuts the URL at its first `&` and expands `%…%` sequences, so the issue form would have opened without the summary. It now hands PowerShell an encoded command, which parses nothing. On Linux without `xdg-open` (WSL, most servers) `wslview` is tried next, and `lshed report --url` prints the prefilled link for a machine with no browser at all. The smoke suite, which CI runs on Ubuntu, macOS and Windows, now runs `report` and checks that the home directory does not appear in its output in either separator.

## 0.16.0 — 2026-09-09

- New `lshed report`: prints what a bug report needs and nothing else — lshed version and runtime, OS, the agent and its root, the agent CLI's version, the applied profile as numbers, and the names (not contents) of what the shed holds. Home directories show as `~`; no environment value, setting or shed file is included. `--open` puts the same text into the repository's issue form. After a failed command, in a terminal, lshed asks once whether to open that form; the default is no, `LSHED_REPORT=0` removes the question, and outside a terminal only a one-line hint is printed. lshed sends nothing by itself in any of these paths — it opens the browser on a URL and the user decides whether to submit.
- Issue templates: a bug report that asks for the command, the expectation, the output and `lshed report`, and a verification report for "it worked here, on this version of this tool and this OS" — those feed the README's "What has been verified" section, which so far lists only the author's machines.

## 0.15.5 — 2026-09-09

- Fix: 0.15.4 filled `${HOME}` in Claude Code MCP entries only when it wrote them. A machine that 0.15.2 or 0.15.3 had already given the literal `${HOME}/…` kept it, because `restore` compared the local value with the shed's, found the same characters, reported `=` and did not write. Found by the fourth Windows pass. A local entry that still holds a literal `${HOME}` now counts as stale and is rewritten (`~`, backed up) on the next `restore`, for every agent except Cursor, whose own `${userHome}` notation is meant to stay a placeholder.

## 0.15.4 — 2026-09-09

- `restore` now fills `${HOME}` in Claude Code MCP entries itself instead of leaving it for Claude Code. Claude Code expands `${VAR}` only from variables present in its environment, and Windows has no `HOME`; with it missing, Claude Code 2.1.265 reports "Missing environment variables: HOME" and does not start the server (checked with an isolated `CLAUDE_CONFIG_DIR` and a server command that leaves a marker file: with `HOME` set the marker appears, with `HOME` unset it does not). So a shed entry such as `"args": ["${HOME}/mcp/server.js"]` was placed verbatim and never worked on Windows. Secret placeholders (`${EXA_API_KEY}`) are still written as is and still expanded by Claude Code, so no secret value passes through lshed. The third Windows verification pass flagged the empty `HOME` as an open question.

## 0.15.3 — 2026-09-09

- Fix: on a machine that cannot create file links (Windows without Developer Mode), `restore` in link mode placed a file part as a copy and then, on every later `restore`, replaced that copy again with a `~` line and the "could not link" notice, never settling on `=`. Found by the second Windows verification pass, where the `--link` test kept failing for this reason after 0.15.2 had fixed its first assertion. lshed now checks once per run whether the machine can link files; if it cannot, an identical copy counts as placed and is reported as `= agents/rev.md  (copy; file links on Windows need Developer Mode)`. Directories are unaffected, since junctions always work. Turning Developer Mode on later and running `restore` again still converts the copies to links.

## 0.15.2 — 2026-09-08

- A shed no longer carries the separators of the machine that made it. Home paths in settings and MCP entries are stored as `${HOME}/…` with `/` throughout, whether the value was written `C:\Users\me\.claude\hooks\x`, `C:/Users/me/.claude/hooks/x` or `/home/me/.claude/hooks/x`; before, a Windows shed kept `${HOME}\.claude\…`, which restored on Linux or WSL as `/home/me\.claude\…`, and a Windows path written with `/` was not recognized as the home directory at all and went into the shed with the user name in it. On Windows, `restore` now fills `${HOME}` as `C:/Users/me`, so the result has one kind of separator, a form Node, PowerShell, cmd and Git Bash all accept; the same applies to the Codex `config.toml`. Drift comparison ignores separators and case for `${HOME}` strings, so a value you wrote with backslashes does not show as drift against the shed. A shed written by an earlier version is normalized the next time `save` or `add` touches the entry; a value that version already placed on a Windows machine keeps its mixed separators until the entry is next rewritten, since it still counts as the same value.
- `restore --dry-run` now lists the `install:` commands that a real run would leave for you, under the same "install command was not run" heading. Before, the dry run showed the clone but said nothing about the install, so the first sight of the command was the real run. Found on the Windows verification pass below.
- Fix: the `--link` integration test required file parts (`agents/*.md`, the instructions fragments) to be symbolic links, which on Windows needs Developer Mode. CI runners have that privilege; an ordinary Windows PC does not, and there `npm test` failed on a machine where the CLI itself behaved as designed (junction for directories, copy with a notice for files). The test now probes whether the machine can link files and expects the copy fallback otherwise, as the smoke suite already did.
- Verified on a real Windows 11 machine (PowerShell 7.6 and cmd.exe, Node 24, Developer Mode off), with lshed 0.15.1 from npm and shed and root paths containing spaces and Korean: `init`, `restore` into a machine with its own setup, `--link` with junctions and the copy fallback, `add`/`diff`/`save`, a profile switch with backups, the `codex` and `agents` targets, `sync` without a remote, `LSHED_HOME` and the remembered shed, and the repository's own smoke suite. Secrets stayed out of the shed, `--no-link` left the shed's files in place, and code pages 65001 and 949 both carried `skills/논문리뷰` through intact.

## 0.15.1 — 2026-09-08

- `restore --yes` and `update --yes` now run a package's `install:` even when the package is already present or already up to date. Before, a first `restore` printed "rerun with '--yes'" but the rerun skipped the present package, so the command did nothing; only running the install by hand worked. Without `--yes` nothing changes: present packages are left alone and pending installs are only printed after a fresh clone.
- Fix: a skill, agent, command or package whose name has letters outside ASCII (`skills/논문리뷰`) was written into `lshed.yaml` by `init` and `add` and then rejected by the manifest check, so every later command failed with "id may contain only letters, digits, ._- and /". The agents read such directories without complaint, so lshed now accepts letters and digits from any script in ids and profile names. Scanned names are normalized to NFC before they become ids, so a shed made on macOS and one made on Linux agree on the bytes.
- The smoke suite now carries a skill with a Korean name (`논문리뷰`) through `init`, `restore`, `--link` and a profile switch, so the CI runs on macOS and Windows would catch a filename-normalization or code-page problem that Linux never shows.
- Verified on Linux (6.8, Node 24) beyond the CI matrix: git and GitHub packages with `install:` through `restore`, `update --dry-run` and `update`; `sync` against a real origin, including a rebase conflict; `remove`, `prune` and `list --unused`; the `gemini`, `copilot`, `cursor` and `agy` targets; `LSHED_HOME`, `LSHED_AGENT`, `CLAUDE_CONFIG_DIR` and `COPILOT_HOME` defaults; `restore --pick` through a pseudo-terminal; and the compiled `lshed-linux-x64` binary on the smoke suite.

## 0.15.0 — 2026-09-08

Every message lshed prints is now English. Nothing else changed in behaviour.

- `lshed status` keeps one shape: `profile`, `shed`, `applied`, `managed`, `placement`, then a blank line, then `drift`, `packages`, `env`, `outside`. A row with nothing to report says `none` (or `all set`) instead of disappearing, so the eye always lands on the same place. `placement` now shows `copies` too, not only `links`.
- Packages that match the lock are named on one comma-separated line (`9 in sync: gstack, exa, …`) instead of one line each. Only the odd ones get their own line, indented under the row and marked `!`, each ending with the command that fixes it: `! gstack  253d1df ≠ lock 0d1bd56  → lshed update`, `! exa  not installed  → lshed restore`. Missing environment variables use the same shape under `env`.
- All other commands (`init`, `restore`, `add`, `save`, `sync`, `update`, `list`, `remove`, `prune`, `diff`, the `--pick` prompts) and every error message follow suit, with one vocabulary: shed, part, package, placed, removed, backed up, generated, drift, lock. Counts read `4 parts, 3 packages`; single items are singular (`installed 1 package`). Marker prefixes (`+ - = ~ ! · ≡ ? ↑ ↓ ✓`) are unchanged.
- The one comment `init` writes into `lshed.yaml` for a git package (`# install: ./setup …`) is English as well. Code comments stay as they were.
- `scripts/smoke.mjs`, the unit tests and both READMEs' sample output follow the new strings.

## 0.14.2 — 2026-09-08

`lshed update --dry-run` now asks upstream instead of guessing.

- It printed `~ package X (… update)` for every installed package without looking anywhere, so on a real shed nine packages all looked stale while `status` said `= lock` for each. Now each installer that can look does: git packages run `git ls-remote` against the source branch (or tag) and compare with the clone's HEAD; marketplaces Claude Code cloned with git (`installLocation` is a repository) compare with their origin. The line reads `= 0d1bd56 (최신)`, `~ 0d1bd56 → 0530392`, or `? …` when it cannot be known (Claude plugins, and the official marketplace, which is not a git clone). A lookup failure is reported on that line and does not stop the others. Nothing is written in either case.
- Installer interface: optional `upstream(ctx, pkg)` returning `{ current, latest }`; `git.ts` gains `lsRemote(url, ref?)`, which names `refs/heads/<ref>`, `refs/tags/<ref>^{}` and `refs/tags/<ref>` explicitly so an annotated tag resolves to its commit and a branch wins over a tag of the same name.

Also in this release (2026-09-08):

- Re-ran everything that runs on the development machine against 0.14.1: unit tests (147), the CLI smoke suite with `dist/cli.js` and with the compiled Linux binary, all five `bun` binaries, `restore --pick` through a real pseudo-terminal, and `status`/`diff`/`restore --dry-run`/`update --dry-run`/`sync --dry-run` against the real shed for `claude-code`, `codex` and `agy`. The VM probe passes in full for Codex 0.153.2 and Antigravity CLI 1.1.27; Gemini, Copilot, Cursor, `agents` and `claude-code` pass the placement-only run. `scripts/vm/README.md` now says how to run the model questions from a scratch `HOME` without touching the real config.
- `test/sync.test.ts` gets a 30 s budget per test and hook, and its cleanup retries on `EBUSY`. Each of those tests spawns git about ten times; on the Windows CI runner that occasionally exceeded vitest's 5 s default (run 33976665907 failed that way on a docs-only commit while the Node 20 Windows job of the same run passed). Test-only change.
- No other code changes; the two items above are the whole diff since 0.14.1.

## 0.14.1 — 2026-09-05

Two things `lshed status` got wrong on a real machine after a one-plugin marketplace was added.

- A marketplace and a plugin with the same name (`llm-guidelines` from `llm-guidelines@llm-guidelines`) were both recorded as `packages/llm-guidelines`. The marketplace keeps the name (its own commands need it); the plugin becomes `llm-guidelines@llm-guidelines`. Installer order is fixed, so every machine derives the same ids.
- `extraKnownMarketplaces` in `settings.json` is state Claude Code writes when a marketplace is added, like `enabledPlugins`; `init` and `add` no longer offer it. The `claude-marketplace:` package brings it back on `restore`.
- An empty JSON entry file (Antigravity creates `mcp_config.json` with no content) reads as `{}` instead of failing `status` and `restore`.

## 0.14.0 — 2026-09-05

`--agent codex` now puts skills in `~/.agents/skills/`, the location Codex documents, instead of `~/.codex/skills/`.

- Codex 0.153 still reads `$CODEX_HOME/skills`, but its source marks that directory deprecated and the docs name only `.agents/skills`. `AGENTS.md` and `config.toml` stay under `~/.codex` (or `$CODEX_HOME`). The managed set records the skills as `../.agents/skills/<id>` relative to the Codex root; switching profiles removes them there, and backups stay inside `~/.codex/lshed/backups/`.
- `--root <dir>` keeps the same shape with the directory's parent as the home, so a scratch root never writes into your real `~/.agents`.
- Since the `agents` target places into the same directory, use one of `--agent codex` and `--agent agents` per machine for skills, not both.
- Shed paths are now derived from the category name, never from where the agent keeps that category locally.

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
