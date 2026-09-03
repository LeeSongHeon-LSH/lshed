# lshed

Keep your coding-agent harness — skills, subagents, commands, instructions, MCP servers, settings — in a **shed**, and restore it on any machine with one command.

```
lshed init --shed ~/lshed          # scan ~/.claude into a shed + write lshed.yaml
lshed restore research             # apply a profile anywhere
```

The shed is a plain directory. Put it in a git repo, Dropbox, whatever. `lshed sync` wraps the git part if you want it to.

## Why

Every new laptop, server, container or WSL box means setting up `~/.claude` again. dotfiles tools move **files**; they don't know what a skill, an agent or an instruction fragment is, they can't compose a subset per machine, and they can't tell which parts they placed and which were yours.

lshed adds three first-class ideas on top of "a directory in git":

| Idea | What it gives you |
|---|---|
| **Components** | every skill / agent / command / instruction fragment / MCP server / settings key is one named part in the shed |
| **Profiles** | named recipes — `research`, `work`, `minimal` — that pick a subset of parts |
| **Managed set** | lshed remembers what it placed, so switching profiles removes only its own files and never touches yours |

Currently supports **Claude Code** (`~/.claude`). Other agents plug in through an adapter.

## Install

With Node 20 or newer:

```
npm install -g lshed          # or run it once: npx lshed status
```

Without Node, download a standalone binary from the [latest release](https://github.com/LeeSongHeon-LSH/lshed/releases/latest) and put it on your PATH. It carries its own runtime, so it is ~80 MB.

| Platform | File |
|---|---|
| Windows x64 | `lshed-windows-x64.exe` → rename to `lshed.exe` |
| macOS Apple Silicon / Intel | `lshed-darwin-arm64` / `lshed-darwin-x64` |
| Linux x64 / arm64 | `lshed-linux-x64` / `lshed-linux-arm64` |

On macOS and Linux, `chmod +x` it first. The binaries are unsigned, so macOS warns on first run.

Either way you also need `git` on the PATH for packages and `sync`, and `claude` if your shed lists plugins.

## Quick start

```bash
# 1. On the machine that already has your setup
lshed init --shed ~/lshed
cd ~/lshed && git init && git remote add origin <your private repo>
lshed sync                                  # commit + push

# 2. Edit ~/lshed/lshed.yaml — add profiles, drop parts you don't need everywhere

# 3. On any other machine
git clone <your private repo> ~/lshed
lshed restore research --shed ~/lshed       # --shed only needed the first time
```

## How to use it

### Day one: put what you have into a shed

```
$ lshed init --shed ~/lshed --exclude _gstack-command connect-chrome
스캔: /home/me/.claude  →  창고: /home/me/lshed
  ≡ package gstack  github:garrytan/gstack@main @253d1df  (참조만 기록)
  ≡ package claude-plugins-official  claude-marketplace:anthropics/claude-plugins-official  (참조만 기록)
  ≡ package exa  claude-plugin:exa@claude-plugins-official @3.4.1  (참조만 기록)
  · skills/browse  (gstack 가 생성한 것 → 건너뜀)
  · skills/review  (gstack 가 생성한 것 → 건너뜀)
  - skills/_gstack-command  (--exclude)
  + skills/add-drivers
  + skills/domain-modeling
  + mcp/notion  (시크릿 → ${NOTION_AUTHORIZATION})
  + instructions/main  (CLAUDE.md)

lshed.yaml 생성: /home/me/lshed/lshed.yaml  (부품 4개, 패키지 3개, 생성물 53개 건너뜀, 제외 2개, 프로필 "default")
```

`init` reads your agent root and writes only to the shed and `~/.claude/lshed/`. It sorts everything into [three kinds](#three-kinds-of-things): authored parts are copied (`+`), things you installed become packages recorded by source and version (`≡`), and files an installer generated are skipped (`·`). Aliases an installer created without symlinks look authored; leave them out with `--exclude`, and lshed remembers that under `exclude:` in the manifest.

Then open `lshed.yaml`. It has one profile, `default`, listing everything. Fill in `install:` for git packages that need a post-clone step, and make it a git repo:

```
cd ~/lshed && git init && git remote add origin git@github.com:me/harness.git
lshed sync
```

### Every day: edit, save, sync

You edit skills where the agent reads them, in `~/.claude`. The shed does not change by itself.

```
lshed status          # what profile is applied, what drifted, what is new
lshed diff            # file-level differences between ~/.claude and the shed
lshed save            # copy local edits into the shed (or: lshed save skills/add-drivers)
lshed sync            # commit the shed, pull, push
```

`save` is the only path from `~/.claude` to the shed, and it only works for parts the shed owns (`file:` sources). `sync` warns if you have unsaved edits so you do not push a shed that is behind your machine.

### A machine that already has a setup

The common case is not an empty machine: it already runs the agent and has skills, settings and MCP servers of its own. `restore` is built for that. With no prior lshed state it **removes nothing** — it places what the profile lists, and anything it overwrites goes to `~/.claude/lshed/backups/<timestamp>/` first. Parts that exist only on that machine are untouched.

```
$ lshed restore default --shed ~/lshed --dry-run
  + skills/mine
  ~ skills/shared            # same name, different content → backed up, then replaced
  + mcp:exa  (${EXA_API_KEY})
  ~ settings:model
(dry-run) 변경 없음. 배치 5, 제거 0, 백업 예정 3
```

Always run `--dry-run` first. `+` is new, `~` replaces with a backup, `-` removes with a backup. If the plan looks right, drop the flag.

Then push that machine's own parts up into the shed and both machines have everything:

```
lshed add                    # lists what this machine has that the shed does not
lshed add windows-only mcp/my-local-server
lshed sync
```

Do not run `init` on such a machine just to look around. `init` claims what it finds as lshed-managed, so a later `restore` from your real shed would treat those parts as removable (backed up, but removed). Use `lshed scan`, which only prints. If you do it anyway, `restore` warns you before removing anything and `lshed add` is the way out.

### A new machine

```
git clone git@github.com:me/harness.git ~/lshed
lshed restore default --shed ~/lshed
```

```
  + package gstack  (clone https://github.com/garrytan/gstack.git @main → 253d1df)
  + package claude-plugins-official  (claude plugin marketplace add anthropics/claude-plugins-official)
  + package exa  (claude plugin install exa@claude-plugins-official  (전에 3.4.1; 고정은 안 됨))
  + skills/add-drivers
  + skills/domain-modeling
  + mcp:notion  (${NOTION_AUTHORIZATION})
  + lshed/instructions/main.md
  + CLAUDE.md

프로필 "default" 적용: 배치 5, 제거 0, 패키지 설치 3

설치 명령 1개를 실행하지 않았습니다. 확인 후 '--yes' 로 다시 실행하거나 직접 돌리세요:
  cd /home/me/.claude/skills/gstack && ./setup

환경변수가 없는 항목이 있습니다. 시크릿 값은 창고에 담지 않으므로 이 기기의 셸 환경에 넣으세요 (예: ~/.zshrc 의 export):
  mcp:notion: NOTION_AUTHORIZATION
```

Two things need you afterwards. Package `install:` commands are shell commands from a repository you cloned, so `restore` shows them and stops; run them yourself or rerun with `--yes`. MCP servers reference secrets as `${VAR}`; export the variables in your shell and Claude Code fills them in. From then on `lshed restore` with no arguments reapplies the last profile, and the shed location is remembered.

### Profiles

A profile is a list of ids per category. Add as many as you like to `lshed.yaml`:

```yaml
profiles:
  default:
    packages: [gstack, claude-plugins-official, exa]
    skills: [add-drivers, domain-modeling, grilling]
    instructions: [main]
    mcp: [notion]
  server:                       # headless box: no browser toolkit, no MCP
    skills: [add-drivers]
    instructions: [main, server-rules]
```

```
lshed restore server
  - skills/domain-modeling
  - skills/grilling
  - mcp:notion
  = skills/add-drivers
  ~ CLAUDE.md
  + lshed/instructions/server-rules.md
```

Switching removes only what the previous profile placed (`-`), keeps what both use (`=`), and rewrites what changed (`~`). Everything removed or overwritten goes to `~/.claude/lshed/backups/<timestamp>/` first. Packages are additive: a profile that does not list `gstack` leaves the clone alone. `--dry-run` prints this plan without touching anything.

Instructions fragments are ordered. `restore` writes a `CLAUDE.md` that `@`-imports each fragment, so editing a fragment in the shed shows up on the next `restore` and there is nothing to merge.

### Adding things later

Write a new skill, add an MCP server with `claude mcp add`, clone a toolkit into `~/.claude/skills/`. Then:

```
$ lshed add
창고에 없는 항목 3개 (넣으려면 lshed add <key...> 또는 --all):
    skills/paper-review
    mcp/linear
  ≡ packages/superpowers  github:obra/superpowers@main
  · 패키지 gstack 가 생성한 것 53개는 담지 않습니다

$ lshed add paper-review mcp/linear
  + skills/paper-review
  + mcp/linear  (시크릿 → ${LINEAR_API_KEY})

2개를 창고에 넣고 프로필 "default" 에 추가했습니다. 창고를 커밋하세요: /home/me/lshed
```

`add` classifies exactly like `init`, appends to `lshed.yaml` without disturbing your comments, adds the parts to the current profile and to the managed set. Without keys it only lists. `status` shows the count as `창고 밖`. To put a part that is already in the shed into another profile, edit `profiles:` by hand; `add` tells you when that is the case.

### Keeping packages current

```
lshed status                # shows "253d1df ≠ lock 0d1bd56 → lshed update" when a clone moved
lshed update                # fast-forward every package in the profile, refresh lshed.lock
lshed update gstack --yes   # one package, and run its install: afterwards
```

Git packages are pinned by commit in `lshed.lock`; a new machine gets exactly that commit. Plugins cannot be pinned, so the lock records what got installed and `status` says when it differs from the machine you came from.

### Housekeeping

```
lshed list                  # everything in the shed and which profiles use it
lshed list --unused         # parts no profile lists
lshed remove skills/old     # delete from the shed (refused while a profile uses it)
lshed prune --yes           # delete everything unused
```

`remove` and `prune` delete from the shed without a backup; the shed lives in git, so commit before you prune.

### Reading the output

| Mark | Meaning |
|---|---|
| `+` | placed / added |
| `=` | already identical, nothing done |
| `~` | existed with different content, replaced (backed up) |
| `-` | removed (backed up) or excluded |
| `≡` | package: recorded by source, not copied |
| `·` | generated by an installer, skipped |
| `!` | needs your attention |
| `↑` `↓` | pushed / pulled (sync), updated (update) |

Errors go to stderr with exit code 1. Everything else is on stdout.

## The manifest

`lshed.yaml` lives at the root of the shed. `init` generates it; edit it by hand from then on. `add` and `remove` edit it for you and keep your comments.

```yaml
version: 1
agent: claude-code
exclude: [skills/_gstack-command]   # things init/add must not pick up
ignore: [dist]                      # extra names never copied (adds to the built-in list)

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
  mcp:
    - id: exa                     # file:./mcp/exa.json — secrets replaced by ${VAR}
  settings:
    - id: permissions             # file:./settings/permissions.json — one top-level key of settings.json
    - id: hooks

packages:
  - id: gstack
    source: github:garrytan/gstack@main
    into: skills/gstack
    install: ./setup

profiles:
  research:
    packages: [gstack]
    skills: [paper-review]
    agents: [reviewer]
    instructions: [base, research-style]    # order matters
    mcp: [exa]
    settings: [permissions, hooks]
  teaching:
    skills: [grading-helper]
    commands: [summarize]
    instructions: [base]
```

- Component `source` accepts `file:<path relative to the shed>`. Package `source` accepts `github:owner/repo@ref`, `git:<url>#ref`, `claude-marketplace:<owner/repo>`, `claude-plugin:<name>@<marketplace>`.
- Category names come from the adapter. For Claude Code: `skills`, `agents`, `commands`, `instructions`, `mcp`, `settings`.
- `ignore:` adds to the built-in list of things never copied: `node_modules`, `.git`, `__pycache__`, `.venv`, cache directories, `*.log`. Build output like `dist/` is not ignored by default, since some skills ship it.
- `exclude:` lists parts that exist locally but must not enter the shed. `init --exclude` writes it.

## Three kinds of things

A real `~/.claude` mixes three kinds of content, and they need different handling:

| Kind | Example | What lshed does |
|---|---|---|
| **Authored** | a skill you wrote, your `CLAUDE.md`, an MCP server you added | copies it into the shed |
| **Installed** | a toolkit you `git clone`d, a plugin | records source + commit; `restore` clones or installs it back |
| **Generated** | stub skills an installer wrote for you | skips them; they return when the installer runs |

A directory with a `.git` and a remote becomes a **package**. A skill whose symlink points inside a package is treated as generated and skipped. Everything else is authored and copied. The rules that keep this safe:

- A package that is already present is never touched by `restore`. Your local checkout is yours.
- `install:` is a shell command. `restore` and `update` **print it and stop** unless you pass `--yes`. Plugin installs go through Claude Code's own package manager and run without it; `--yes` is forwarded as `-y` for plugins that declare an install command.
- Packages are not part of the managed set. Switching profiles never deletes a clone.

Claude Code plugins are packages with their own scheme. `init` finds user-scope ones in `~/.claude/plugins`; `restore` adds the marketplace first, then runs `claude plugin install`. Project-scope plugins belong to their project and are not recorded.

## MCP servers and secrets

User-scope MCP servers live in `~/.claude.json`, next to machine IDs and session state. lshed treats each server as a component of category `mcp`: the shed holds `mcp/<name>.json`, and `restore` edits only the `mcpServers.<name>` key of `~/.claude.json`, leaving everything else in that file alone.

**No secret value enters the shed.** `init` and `add` replace values under `env` and `headers` whose key contains a secret-looking word (`key`, `token`, `secret`, `password`, `auth`, `authorization`, `credential`, `cookie`, `session` — whole words, so `MAX_OUTPUT_TOKENS` is left alone) with a `${VAR}` placeholder:

```json
{ "type": "stdio", "command": "npx", "args": ["-y", "exa-mcp-server"],
  "env": { "EXA_API_KEY": "${EXA_API_KEY}" } }
{ "type": "http", "url": "https://mcp.notion.com/mcp",
  "headers": { "Authorization": "Bearer ${NOTION_AUTHORIZATION}" } }
```

`restore` writes the placeholder as is. Claude Code expands `${VAR}` from the environment when it starts the server, so the value only ever lives in your shell (`export EXA_API_KEY=...` in `~/.zshrc`, or however you manage secrets). `restore` and `status` list the variables the profile needs that are not set. The heuristic is a suggestion: edit the JSON in the shed to add or remove placeholders, and `init` warns when something in `args` or `url` looks like a token. `save` keeps existing placeholders and masks new secret-looking keys, so a rotated key never leaks into the shed by accident. `diff` compares with placeholders as wildcards, so a machine holding real values is not drift.

## Settings

`~/.claude/settings.json` holds hooks, permissions, `env`, the model, the theme, and some state Claude Code writes for itself. lshed does not merge it. Each **top-level key is one component** of category `settings`: the shed holds `settings/permissions.json`, `settings/hooks.json`, and so on, and `restore` writes exactly those keys, leaving the rest of the file alone. A profile can carry `permissions` and `hooks` and leave `model` to each machine.

```
$ lshed add
창고에 없는 항목 3개:
    settings/hooks  ! 패키지 gstack 안을 가리킵니다. 그 설치가 만든 것이면 exclude 하세요: settings/hooks
    settings/model
    settings/theme
```

- `enabledPlugins` is never taken: the plugin packages own it, and `restore` rebuilds it by installing them.
- Absolute paths under your home directory become `${HOME}/…` in the shed, so a hook command written on one machine works on another. Claude Code does not expand variables in `settings.json`, so `restore` fills `${HOME}` and any `${VAR}` itself from your shell; unset variables are reported and left as placeholders.
- `env` is treated as a secret map: keys that look secret are masked, the rest (`CLAUDE_CODE_MAX_OUTPUT_TOKENS`, …) travel as they are.
- A value pointing inside a package (a hook a toolkit's installer wrote) is flagged. If the installer recreates it, put it in `exclude:` and let `restore --yes` bring it back.
- Since the shed owns the whole key, extra permissions you grant locally show up in `diff` and go into the shed with `save`, like any other edit.

## Commands

```
lshed init [--shed <dir>] [--profile <name>] [--exclude <id...>]
lshed add [keys...] [--all]                     put things that appeared since init into the shed
lshed restore [profile] [--dry-run] [--no-backup] [--yes]
lshed status                                    applied profile, drift, packages, missing env, new things
lshed diff                                      files (or JSON keys) that differ between local and shed
lshed save [ids...]                             copy local edits back into the shed
lshed sync [-m <msg>] [--no-push] [--dry-run]   commit the shed, pull --rebase, push
lshed update [ids...] [--dry-run] [--yes]       pull packages forward, refresh lshed.lock
lshed list [--unused]                           what is in the shed, and which profiles use it
lshed remove <key>                              drop a component or package from the shed
lshed prune [--yes]                             drop everything no profile uses
```

Keys are `category/id`, or just `id` when unambiguous: `skills/paper-review`, `mcp/exa`, `packages/gstack`.

Global options: `--shed <dir>` (or `LSHED_HOME`; after the first restore lshed remembers it), `--root <dir>` (agent config root, default `~/.claude` or `CLAUDE_CONFIG_DIR`).

### What `restore` does

0. Installs any package in the profile that is missing, at the version in `lshed.lock`.
1. Removes paths that the **previous** profile placed and the new one doesn't need.
2. Copies every part of the new profile into place; writes MCP entries into `~/.claude.json` and settings keys into `settings.json`.
3. Regenerates the instructions file.

Anything it overwrites or removes is backed up first under `~/.claude/lshed/backups/<timestamp>/`, unless you pass `--no-backup`. Files lshed never placed are left alone. `--dry-run` prints the plan and writes nothing.

### What `sync` does

1. Warns if `diff` shows local edits you have not saved.
2. Commits everything in the shed (message names the changed parts, or `-m`).
3. If `origin` exists: `git pull --rebase`, then `git push` (sets the upstream the first time).
4. If commits came in, tells you to run `lshed restore`.

On a conflict it aborts the rebase, leaves the shed clean with your commit intact, and tells you to resolve with git. Without a remote it only commits. It never runs `save` for you.

### Ownership

The shed is the source of truth for authored parts: `save` copies local edits back for `file:` components. Packages are owned by their upstream: `update` pulls them, `save` ignores them.

## Where things live

```
<shed>/
  lshed.yaml                                    manifest
  lshed.lock                                    package versions (generated)
  skills/<id>/    agents/<id>.md    commands/<id>.md    instructions/<id>.md
  mcp/<id>.json                                 secrets as ${VAR}
  settings/<id>.json                            one top-level key each; home paths as ${HOME}

~/.claude/
  skills/ agents/ commands/ CLAUDE.md           ← placed by restore
  settings.json  <id>                           ← one key per settings component; the rest is untouched
  lshed/state.json                              ← which profile, which paths are managed
  lshed/instructions/<id>.md                    ← fragments imported by CLAUDE.md
  lshed/backups/<timestamp>/                    ← whatever restore replaced
~/.claude.json  mcpServers.<id>                 ← one key per mcp component; the rest of the file is untouched
```

`state.json` is per machine and is not part of the shed. If `CLAUDE_CONFIG_DIR` is set, lshed uses it as the root and expects `.claude.json` inside it, as Claude Code does.

## Not in scope (yet)

- Secrets beyond "name the variable". Encrypted values, `op://` references and OS keychains are possible later; today lshed is deliberately no better than dotfiles here.
- Project-scope MCP servers (`.mcp.json`, `~/.claude.json` `projects.*`) and project-scope plugins. They belong to the project.
- Windows and macOS have not been tested. The code avoids platform-specific paths, but treat this as Linux/WSL for now.

## Troubleshooting

- **"창고 위치를 모릅니다"** — pass `--shed <dir>` or set `LSHED_HOME`. After one successful `restore`, lshed remembers it.
- **restore replaced my `CLAUDE.md`** — it is in `~/.claude/lshed/backups/<timestamp>/CLAUDE.md`. Move its content into a fragment in the shed and add that fragment to your profile.
- **I edited a skill locally and want to keep it** — `lshed diff` to see, `lshed save <id>` to push it into the shed, then `lshed sync`.
- **`status` says a package differs from the lock** — something updated the clone or plugin behind lshed's back (Claude Code auto-updates plugins). `lshed update` records the new version.
- **`status` keeps listing the same new things** — they are installer aliases or scratch. Add them to `exclude:` in `lshed.yaml`.
- **restore says an MCP variable is missing** — export it in your shell profile and restart Claude Code. The placeholder in `~/.claude.json` is correct; Claude Code fills it at startup.
- **restore wrote a hook with the wrong path** — the shed stores home paths as `${HOME}/…`. If a command points elsewhere on this machine, edit the JSON in the shed to use `${HOME}` or another variable and `restore` again.
- **sync stopped on a conflict** — `cd <shed> && git pull --rebase`, resolve, `git rebase --continue`, then `lshed sync` again.

## License

MIT
