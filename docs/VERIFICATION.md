# What has been verified, and how

The README keeps a one-table summary. This file is the record behind it: every pass on a real machine, what it covered, what it found. Everything here is one person's machines unless a line says otherwise — a [verification report](https://github.com/LeeSongHeon-LSH/lshed/issues/new?template=verified.yml) from anyone else becomes a line below.

## Continuous checks (every push)

- Unit tests (216), a CLI smoke run and the standalone binaries on **Ubuntu, macOS and Windows**, Node 20 and 22 (`.github/workflows/ci.yml`). Windows uses junctions for `--link` and `claude.cmd` for plugin installs. The smoke run includes a skill with a Korean name, so a filename-normalization difference on macOS or a code-page problem on Windows fails in CI, not on a user's machine. The smoke also walks the quick start on a home folder that has only `~/.codex`, `--fresh-only` on an applied and on a fresh root, and the no-CLI path of `--agent installed`.
- Weekly, and on demand: the **probe** workflow (`.github/workflows/probe.yml`) builds the container below on a GitHub runner and runs the six Linux targets against the real agent CLIs, model-free unless the agent keys are repository secrets.

## The probe: do the agents read what lshed places?

`--agent codex|gemini|copilot|cursor|agy|agents|claude-code` was written from each tool's documentation. `scripts/vm/probe.sh` checks it against the tools themselves: it restores a throwaway shed (a skill holding a random passphrase, an instructions fragment holding a random codeword, two MCP servers with `${VAR}` secrets) into the tool's real root, checks the files and the tool's own parser (`codex mcp list`, `gemini mcp list`, `agy mcp list`, `claude mcp list`, `codex debug prompt-input`), asks the tool non-interactively for the passphrase and the codeword, edits the shed behind a `--link` symlink and asks again, then restores an empty profile and checks nothing is left. Passphrases are random per run, so a stale copy cannot produce a false pass. `scripts/vm/README.md` is the runbook.

It runs in three places: on this Linux machine with a scratch `HOME`, in a container (`scripts/vm/Dockerfile.probe`, `scripts/vm/probe-docker.sh`, 2026-09-18) and, as designed originally, on a throwaway cloud VM (`cloud-init.yaml`).

| Tool | Version | Placement, formats, parser, link, cleanup | Model questions (skill, instructions, linked skill) | Last run |
|---|---|---|---|---|
| Claude Code | 2.1.275 | ✔ | ✔ 3/3, first attempt | 2026-09-18, agent-box container |
| Codex | 0.155.0 | ✔ (`codex mcp list`, `debug prompt-input`) | ✔ 3/3 on 2026-09-09 (0.153.4, via an OpenAI-compatible proxy); 2026-09-18 not run, stored key 401 | 2026-09-18 |
| Antigravity CLI (agy) | 1.2.5 | ✔ (`agy mcp list`) | ✔ 3/3, first attempt | 2026-09-18, agent-box container |
| Gemini CLI | 0.60.0 | ✔ (`gemini mcp list`, run with `GEMINI_CLI_TRUST_WORKSPACE=true`) | ✔ 3/3, first attempt, free-tier key | 2026-09-18, container |
| Cursor (`agent`) | 2026.09.15 | ✔ | ✔ 2/2, first attempt, free-tier key (`agent -p --trust`; without the flag Cursor prints a trust notice and no answer) | 2026-09-18, container |
| Copilot CLI | 1.0.86 | ✔ | not run yet — needs `COPILOT_GITHUB_TOKEN` (Copilot Free is enough) | 2026-09-18, container |
| `agents` (`~/.agents/skills`) | — | ✔ (Codex lists it as a skill root) | asked through Codex on 2026-09-09 ✔ | 2026-09-18 |

Things the probe taught, which are now in the adapters or the probe itself:

- Codex reads skills from `~/.agents/skills` (its `$CODEX_HOME/skills` is deprecated), so the `codex` target places them there (0.14.0).
- Codex's read-only sandbox cannot create user namespaces on Ubuntu 24.04 hosts or inside an unprivileged container; the probe runs `codex exec --sandbox danger-full-access`, acceptable only on a disposable machine.
- Gemini suppresses user-level MCP servers in an untrusted folder; `GEMINI_CLI_TRUST_WORKSPACE=true` for both the listing and the questions.
- Cursor's `agent -p` needs `--trust`, or it answers nothing for a folder it has not seen. `lshed check` passes the same flag.
- Claude Code 2.1 creates `~/.claude/skills/synced` on its first run (skills synced from the claude.ai account); lshed skips that folder in the scan so `status` does not offer to add it.
- A low-effort model that already has the instructions codeword in context sometimes answers the skill question with it; the probe asks the skill question under a skill-only profile first and gives every question up to three attempts.
- Running the probe against an isolated `CLAUDE_CONFIG_DIR` found the 0.12.1 bug where `.claude.json` was written next to the directory instead of inside it.

## A new machine, end to end (container)

The [agent-box](https://github.com/LeeSongHeon-LSH/agent-box) devcontainer (Claude Code, Codex, agy, lshed, Node 24) plays a brand-new machine: an empty state directory holding only the logins, a shed mounted at `/shed`, and an entrypoint that runs `lshed restore default --shed /shed --agent installed --fresh-only` on every start. Its `test-fresh` starts the box twice and asserts inside: `state.json` and profile per agent, `lshed status` with `drift none` / `packages … in sync` / `env all set`, every shed skill in each agent's skills folder, `claude|codex|agy mcp list` parsing what lshed wrote, `lshed check` for each agent, the Claude plugins installed, `lshed report`; and on the restart, that the restore was skipped and `appliedAt` did not move.

2026-09-18, lshed 0.17.5 with the unreleased `--fresh-only` / `--agent installed`: FAIL 0 on both starts for claude-code, codex and agy (codex's `lshed check` tolerated, stored key 401). This run is what found the `skills/synced` false positive and motivated the two flags.

## Windows, on a real PC

All on the same Windows 11 PC without Developer Mode, paths with spaces and Korean, Node 24, the user checking each screen against the expected one.

1. **0.15.1 from npm** (PowerShell 7 and cmd.exe): `init`, `restore` next to an existing setup, `--link` (junctions for skills, copies with a notice for single files), `add`/`diff`/`save`, a profile switch, the `codex` and `agents` targets, `sync` without a remote, the smoke suite. Found: `restore --dry-run` did not show `install:` commands, the `--link` test assumed file-symlink permission, and a shed made on Windows restored broken paths into WSL — 0.15.2 stores home paths as `${HOME}/…` with `/`.
2. **0.15.2**: confirmed; a shed made there restores with `/home/…/` paths inside WSL, and an older shed is normalized by one `save`. Found: link mode re-copied the file parts it had to copy on every restore — 0.15.3.
3. **0.15.3**: link mode settles on `=` for copied file parts and re-copies only when the shed changes.
4. **0.15.4 → 0.15.5**: Claude Code fills `${VAR}` in MCP entries only from its environment and Windows has no `HOME`, so lshed fills `${HOME}` itself (0.15.4); a machine where an older version had left `${HOME}` in place is rewritten (0.15.5).
5. **0.17.1 from npm** (Windows PowerShell 5.1, git 2.55), from nothing: a private shed cloned over HTTPS, `restore default` fetched every package at the revision in the lock (a gstack update made on Linux arrived at the same commit), `status` reported nine packages in sync, `lshed check` got the passphrase back from Claude Code on the first attempt, `report` showed the home directory as `~`. Found: `restore --yes` stopped at the first failing `install:` (gstack's `./setup` cannot start under cmd.exe) before placing anything — 0.17.2 places everything, lists the failure at the end and exits 1; the same PC confirmed it.
6. **0.17.3 built from source**: nine arguments holding `&`, `|`, `(`, `^`, a quote and a trailing backslash came back through `cmd.exe` unchanged, no `DEP0190` warning under `--throw-deprecation`, `check` returned in 2.2 s against a CLI that leaves a child holding the pipes. Found: the cleanup after such a run hit `EBUSY` inside a `finally` and replaced the result — fixed in 0.17.4.

Known and documented rather than fixed: `install:` runs in cmd.exe on Windows, so a `./setup` written for sh cannot start there (run it from Git Bash), and gstack needs bun.

## Linux, the development machine

The whole command set beyond CI: git and GitHub packages with `install:` through `restore` and `update`, `sync` against a real remote including a conflict, `remove`/`prune`, every `--agent` target, the environment-variable defaults, `restore --pick` through a real terminal, and the compiled Linux binary. One real shed is in daily use: Claude Code, Codex and Antigravity read it through `--link`, and `status` reports no drift for any of the three. Full re-runs of everything on 2026-09-08 (0.14.1) and 2026-09-09 (0.15.1).

## Reporting

If lshed works for you on a tool version or an OS not listed here, a [verification report](https://github.com/LeeSongHeon-LSH/lshed/issues/new?template=verified.yml) takes two minutes. If it does not, `lshed report` prints what a [bug report](https://github.com/LeeSongHeon-LSH/lshed/issues/new?template=bug.yml) needs: versions, the agent and its root, the applied profile and the names of what the shed holds — no values, no secrets, home shown as `~`. After a failed command lshed asks whether to open that form prefilled; it never sends anything by itself, and `LSHED_REPORT=0` turns the question off. For the failure that makes no noise — an agent that does not read what was placed — `lshed check` asks the agent itself.
