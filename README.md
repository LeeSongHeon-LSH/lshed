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

- `source` accepts `file:<path relative to the shed>`. `github:owner/repo@ref` is parsed and reserved for a future release; using it today is an error, not silent misbehaviour.
- Category names come from the adapter. For Claude Code: `skills`, `agents`, `commands`, `instructions`.
- Instructions are not merged. `restore` writes a `CLAUDE.md` that `@`-imports each fragment in order, so a fragment edit shows up without re-running anything. Your original `CLAUDE.md` is backed up the first time.

## Commands

```
lshed init [--shed <dir>] [--profile <name>]   scan the current environment into a shed
lshed restore [profile] [--dry-run] [--no-backup]
lshed status                                    applied profile, managed paths, drift
lshed diff                                      files that differ between local and shed
lshed save [ids...]                             copy local edits back into the shed
```

Global options: `--shed <dir>` (or `LSHED_HOME`; after the first restore lshed remembers it), `--root <dir>` (agent config root, default `~/.claude`).

### What `restore` does

1. Removes paths that the **previous** profile placed and the new one doesn't need.
2. Copies every part of the new profile into place.
3. Regenerates the instructions file.

Anything it overwrites or removes is backed up first under `~/.claude/lshed/backups/<timestamp>/`, unless you pass `--no-backup`. Files lshed never placed are left alone. `--dry-run` prints the plan and writes nothing.

### Ownership

The shed is the source of truth. `save` copies local edits back for `file:` parts only. Remote parts will be read-only and refreshed with `update` once remote sources land.

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
- Remote sources (`github:`), lock file, `update`, `list --unused`, `prune`.
- Windows and macOS have not been tested. The code avoids platform-specific paths, but treat 0.1 as Linux/WSL.

## Troubleshooting

- **"창고 위치를 모릅니다"** — pass `--shed <dir>` or set `LSHED_HOME`. After one successful `restore`, lshed remembers it.
- **restore replaced my `CLAUDE.md`** — it is in `~/.claude/lshed/backups/<timestamp>/CLAUDE.md`. Move its content into a fragment in the shed and add that fragment to your profile.
- **I edited a skill locally and want to keep it** — `lshed diff` to see, `lshed save <id>` to push it into the shed, then commit the shed.

## License

MIT
