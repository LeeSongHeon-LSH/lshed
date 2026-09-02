# lshed

Keep your coding-agent harness — skills, subagents, commands, instructions — in a **shed**, and restore it on any machine with one command.

```
lshed init --shed ~/lshed          # scan ~/.claude into a shed + write lshed.yaml
lshed restore research             # apply a profile anywhere
```

The shed is a plain directory. Put it in a git repo, Dropbox, whatever. lshed does not sync it for you.

## Why

Every new laptop, server, container or WSL box means setting up `~/.claude` again. dotfiles tools move **files**; they don't know what a skill, an agent or an instruction fragment is, they can't compose a subset per machine, and they can't tell which parts they placed and which were yours.

lshed adds three first-class ideas on top of "a directory in git":

| Idea | What it gives you |
|---|---|
| **Components** | every skill / agent / command / instruction fragment is one named part in the shed |
| **Profiles** | named recipes — `research`, `work`, `minimal` — that pick a subset of parts |
| **Managed set** | lshed remembers what it placed, so switching profiles removes only its own files and never touches yours |

Currently supports **Claude Code** (`~/.claude`). Other agents plug in through an adapter.

## Install

```
npm install -g lshed
```

Node 20 or newer.

## Quick start

```bash
# 1. On the machine that already has your setup
lshed init --shed ~/lshed
cd ~/lshed && git init && git add -A && git commit -m "my harness" && git remote add origin <your private repo> && git push -u origin main

# 2. Edit ~/lshed/lshed.yaml — add profiles, drop parts you don't need everywhere

# 3. On any other machine
git clone <your private repo> ~/lshed
lshed restore research --shed ~/lshed      # --shed only needed the first time
```

## The manifest

`lshed.yaml` lives at the root of the shed. `init` generates it; edit it by hand from then on.

```yaml
version: 1
agent: claude-code

components:
  skills:
    - id: paper-review            # source defaults to file:./skills/paper-review
    - id: grading-helper
  agents:
    - id: reviewer                # file:./agents/reviewer.md
  commands:
    - id: summarize
  instructions:
    - id: base                    # file:./instructions/base.md
    - id: research-style

profiles:
  research:
    skills: [paper-review]
    agents: [reviewer]
    instructions: [base, research-style]    # order matters
  teaching:
    skills: [grading-helper]
    commands: [summarize]
    instructions: [base]
```

- Component `source` accepts `file:<path relative to the shed>`. Package `source` accepts `github:owner/repo@ref` or `git:<url>#ref`.
- Category names come from the adapter. For Claude Code: `skills`, `agents`, `commands`, `instructions`.
- `ignore:` at the top level adds to the built-in list of things never copied: `node_modules`, `.git`, `__pycache__`, `.venv`, cache directories, `*.log`. Build output like `dist/` is not ignored by default, since some skills ship it. Add it yourself if your parts rebuild from source.
- Instructions are not merged. `restore` writes a `CLAUDE.md` that `@`-imports each fragment in order, so a fragment edit shows up without re-running anything. Your original `CLAUDE.md` is backed up the first time.

## Three kinds of things

A real `~/.claude` mixes three kinds of content, and they need different handling:

| Kind | Example | What lshed does |
|---|---|---|
| **Authored** | a skill you wrote, your `CLAUDE.md` | copies it into the shed |
| **Installed** | a toolkit you `git clone`d, a plugin | records source + commit; `restore` clones it back |
| **Generated** | stub skills an installer wrote for you | skips them; they return when the installer runs |

`init` sorts this out for you. A directory with a `.git` and a remote becomes a **package**. A skill whose symlink points inside a package is treated as generated and skipped. Everything else is authored and copied.

```yaml
packages:
  - id: gstack
    source: github:garrytan/gstack@main   # git:<url>#ref for other hosts
    into: skills/gstack                   # where it lives under ~/.claude
    install: ./setup                      # optional; run after clone, only with --yes

profiles:
  default:
    packages: [gstack]
    skills: [add-drivers, domain-modeling]
```

`lshed.lock` pins each package to a commit, so a fresh machine gets the same version you had. `lshed update` moves it forward.

Rules that keep this safe:

- A package that is already present is never touched by `restore`. Your local checkout is yours.
- `install:` is a shell command. `restore` and `update` **print it and stop** unless you pass `--yes`.
- Packages are not part of the managed set. Switching profiles never deletes a clone.
- Installers sometimes create aliases without symlinks, which `init` cannot tell from authored skills. Leave those out with `--exclude`:

```bash
lshed init --shed ~/harness --exclude _gstack-command connect-chrome
```

## Commands

```
lshed init [--shed <dir>] [--profile <name>] [--exclude <id...>]
lshed restore [profile] [--dry-run] [--no-backup] [--yes]
lshed update [ids...] [--dry-run] [--yes]       pull packages forward, refresh lshed.lock
lshed status                                    applied profile, managed paths, drift, packages
lshed diff                                      files that differ between local and shed
lshed save [ids...]                             copy local edits back into the shed
```

Global options: `--shed <dir>` (or `LSHED_HOME`; after the first restore lshed remembers it), `--root <dir>` (agent config root, default `~/.claude`).

### What `restore` does

0. Clones any package in the profile that is missing, at the commit in `lshed.lock`.
1. Removes paths that the **previous** profile placed and the new one doesn't need.
2. Copies every part of the new profile into place.
3. Regenerates the instructions file.

Anything it overwrites or removes is backed up first under `~/.claude/lshed/backups/<timestamp>/`, unless you pass `--no-backup`. Files lshed never placed are left alone. `--dry-run` prints the plan and writes nothing.

### Ownership

The shed is the source of truth for authored parts: `save` copies local edits back for `file:` components. Packages are owned by their upstream: `update` pulls them, `save` ignores them.

## Where things live

```
<shed>/
  lshed.yaml
  skills/<id>/            agents/<id>.md        commands/<id>.md        instructions/<id>.md

~/.claude/
  skills/ agents/ commands/ CLAUDE.md           ← placed by restore
  lshed/state.json                              ← which profile, which paths are managed
  lshed/instructions/<id>.md                    ← fragments imported by CLAUDE.md
  lshed/backups/<timestamp>/                    ← whatever restore replaced
```

`state.json` is per machine and is not part of the shed.

## Not in scope (yet)

- MCP servers and secrets. Planned: the manifest names the keys, values are injected locally, nothing secret enters the shed.
- `settings.json` merging (hooks, permissions).
- `list --unused`, `remove`, `prune`, `sync`.
- Plugins installed through Claude Code's marketplace. They are packages too; recording them is next.
- Windows and macOS have not been tested. The code avoids platform-specific paths, but treat 0.1 as Linux/WSL.

## Troubleshooting

- **"창고 위치를 모릅니다"** — pass `--shed <dir>` or set `LSHED_HOME`. After one successful `restore`, lshed remembers it.
- **restore replaced my `CLAUDE.md`** — it is in `~/.claude/lshed/backups/<timestamp>/CLAUDE.md`. Move its content into a fragment in the shed and add that fragment to your profile.
- **I edited a skill locally and want to keep it** — `lshed diff` to see, `lshed save <id>` to push it into the shed, then commit the shed.

## License

MIT
