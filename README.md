# lshed

**English** | [한국어](README.ko.md)

Keep your coding-agent harness — skills, subagents, commands, instructions, MCP servers, settings — in a **shed**, and restore it on any machine with one command.

```
lshed init --shed ~/lshed          # scan ~/.claude into a shed + write lshed.yaml
lshed restore research             # apply a profile anywhere
```

The shed is a plain directory. Put it in a git repo, Dropbox, whatever. `lshed sync` wraps the git part if you want it to. Works with Claude Code, and places the same shed into Codex, Gemini CLI, Copilot CLI, Cursor, Google Antigravity and the shared `~/.agents/skills`.

## Why

Every new laptop, server, container or WSL box means setting up `~/.claude` again. The obvious fix is to put `~/.claude` itself in git, and for many people that is the right answer.

**When a plain git repository is enough.** You are one person, every machine gets the same setup, and everything in `~/.claude` is yours. Then make `~/.claude` itself a git repository and you should not install lshed. Git does the moving; the `.gitignore` only keeps machine state (sessions, caches) out of it:

```
cd ~/.claude && git init
printf 'projects/\ncache/\nsessions/\nshell-snapshots/\nhistory.jsonl\n*.bak*\n' > .gitignore
git add skills agents commands CLAUDE.md settings.json .gitignore && git commit -m init
```

No new concepts, no copy step: the directory you edit is the repository. `git push` here and `git clone <remote> ~/.claude` on the next machine is the whole restore.

**Where that stops working.** The repository above starts to hurt as soon as `~/.claude` is not just yours:

- **Toolkits you installed.** One cloned toolkit here is 1.6 GB and generated 53 alias skills next to the 4 you wrote. Raw git commits all of it, or you maintain the ignore list by hand.
- **Secrets inside one JSON file.** MCP servers and their tokens live in `~/.claude.json` together with unrelated state. File-level ignore cannot split them, so you either commit tokens or leave MCP out.
- **A machine that already has a setup.** `git clone` into a non-empty `~/.claude` is a merge you do by hand, and nothing tracks which files came from the repo and which were already there.
- **Different subsets per machine.** A headless server wants no browser toolkit and no MCP. Branches or templates can fake this, but nothing removes the parts you no longer want when you switch.
- **Choosing on the machine itself.** `git clone` is all or nothing. On a new box you want to look at what the shed has, category by category, and tick what this machine needs.

lshed exists for those five cases. It keeps the shed as a plain directory in git, and adds three ideas on top:

| Idea | What it gives you |
|---|---|
| **Components** | every skill / agent / command / instruction fragment / MCP server / settings key is one named part; toolkits you installed are recorded as a source and version, not copied. |
| **Profiles** | named recipes — `research`, `work`, `minimal` — that pick a subset of parts; write them in `lshed.yaml`, or let `restore --pick` build one from a checklist. |
| **Managed set** | lshed remembers what it placed, so switching profiles or restoring onto an existing machine removes only its own files and never touches yours. |

The trade: you edit in `~/.claude` and run `lshed save` to copy changes into the shed (or use `restore --link` on machines where you edit a lot, and skip the copy step), and lshed has to know each agent's layout, which the plain repository does not. If none of the five cases applies to you, the plain repository wins.

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

On macOS and Linux, `chmod +x` it first. The binaries are unsigned, so macOS warns on first run. Either way you also need `git` on the PATH for packages and `sync`, and `claude` if your shed lists plugins.

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
lshed restore --pick --shed ~/lshed         # or tick what this machine gets, category by category
```

## How to use it

### Day one: put what you have into a shed

```
$ lshed init --shed ~/lshed --exclude _gstack-command connect-chrome
scan: /home/me/.claude  →  shed: /home/me/lshed
  ≡ package gstack  github:garrytan/gstack@main @253d1df  (reference only)
  ≡ package claude-plugins-official  claude-marketplace:anthropics/claude-plugins-official  (reference only)
  ≡ package exa  claude-plugin:exa@claude-plugins-official @3.4.1  (reference only)
  · skills/browse  (generated by gstack → skipped)
  · skills/review  (generated by gstack → skipped)
  - skills/_gstack-command  (--exclude)
  + skills/add-drivers
  + skills/domain-modeling
  + mcp/notion  (secrets → ${NOTION_AUTHORIZATION})
  + instructions/main  (CLAUDE.md)

lshed.yaml written: /home/me/lshed/lshed.yaml  (4 parts, 3 packages, 53 generated skipped, 2 excluded, profile "default")
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
(dry-run) nothing changed. Would place 5, remove 0, back up 3
```

Always run `--dry-run` first. `+` is new, `~` replaces with a backup, `-` removes with a backup. If the plan looks right, drop the flag. Then push that machine's own parts up into the shed and both machines have everything:

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
  + package exa  (claude plugin install exa@claude-plugins-official  (was 3.4.1; cannot be pinned))
  + skills/add-drivers
  + skills/domain-modeling
  + mcp:notion  (${NOTION_AUTHORIZATION})
  + lshed/instructions/main.md
  + CLAUDE.md

Profile "default" applied: placed 5, removed 0, installed 3 packages

1 install command was not run. Check it, then rerun with '--yes' or run it yourself:
  cd /home/me/.claude/skills/gstack && ./setup

Some entries need environment variables that are not set. Secrets never go in the shed, so export them in this machine's shell (e.g. in ~/.zshrc):
  mcp:notion: NOTION_AUTHORIZATION
```

Two things need you afterwards. Package `install:` commands are shell commands from a repository you cloned, so `restore` shows them and stops; run them yourself or rerun with `--yes`. MCP servers reference secrets as `${VAR}`; export the variables in your shell and Claude Code fills them in. From then on `lshed restore` with no arguments reapplies the last profile, and the shed location is remembered.

### Picking instead of naming a profile

You do not have to know the profile names, or edit `lshed.yaml`, to set up a machine. `restore --pick` walks the shed one category at a time and asks what this machine should get:

```
$ lshed restore --pick --shed ~/lshed
shed: /home/me/lshed  (packages (3), skills (4), instructions (1), mcp (1))
◆  packages (3)  — pick what this machine gets (space to toggle, a for all, enter for next)
│  ◼ gstack  github:garrytan/gstack@main
│  ◻ claude-plugins-official  claude-marketplace:anthropics/claude-plugins-official
│  ◻ exa  claude-plugin:exa@claude-plugins-official
◆  skills (4)  — pick what this machine gets
│  ◼ add-drivers
│  ◼ domain-modeling
│  ◻ grilling
│  ◻ paper-review
◆  instructions (1)
│  ◼ main
◆  mcp (1)
│  ◻ notion
◆  Profile name to save this selection as
│  lab-box

Profile "lab-box" saved to lshed.yaml. To use it on other machines, push it with lshed sync.

  + package gstack  (clone https://github.com/garrytan/gstack.git @main → 253d1df)
  + skills/add-drivers
  + skills/domain-modeling
  + lshed/instructions/main.md
  + CLAUDE.md

Profile "lab-box" applied: placed 4, removed 0, installed 1 package
```

Categories the shed has nothing in (here `agents`, `commands`, `settings`) are skipped, not shown empty. The choice is always saved as a profile, named after the machine unless you type another name: that is what makes the next bare `lshed restore` reapply it, and what `lshed sync` carries to your other machines. If the shed already has a profile with that name, lshed asks before overwriting it.

`lshed restore default --pick` starts with `default`'s parts checked, so you can trim a profile for this machine instead of starting from nothing. With no argument the last applied profile is the starting point. `--dry-run` shows the plan and writes neither `lshed.yaml` nor `~/.claude`. Ctrl+C at any screen leaves everything untouched. On a machine with no applied profile, a bare `lshed restore --shed ~/lshed` in a terminal opens the picker by itself. In a script or a pipe it asks for a profile name instead.

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

Switching removes only what the previous profile placed (`-`), keeps what both use (`=`), and rewrites what changed (`~`). Everything removed or overwritten goes to `~/.claude/lshed/backups/<timestamp>/` first. Packages are additive: a profile that does not list `gstack` leaves the clone alone. `--dry-run` prints this plan without touching anything. Instructions fragments are ordered. `restore` writes a `CLAUDE.md` that `@`-imports each fragment, so editing a fragment in the shed shows up on the next `restore` and there is nothing to merge.

A profile can build on another one with `extends`, so a machine-specific profile lists only what is different:

```yaml
profiles:
  default:
    skills: [add-drivers, domain-modeling]
    instructions: [main]
  laptop:
    extends: default            # everything in default, plus:
    packages: [gstack]
    mcp: [notion]
  lab:
    extends: [default]          # a list works too, applied in order
    instructions: [lab-rules]   # comes after default's `main`
```

Inheritance only adds. The parent's parts come first, then the profile's own, and instructions keep that order in the generated `CLAUDE.md`. To get *less* than the parent, do not extend it; list what you want. A missing parent or a cycle is reported as a `lshed.yaml` error before anything is touched, and `lshed list` counts a part as used by every profile that inherits it.

### Other agents, same shed

Codex, Gemini CLI, Copilot CLI, Cursor and Google Antigravity (`agy`) all read skills from `<their config dir>/skills/<name>/SKILL.md`, the same layout Claude Code uses, and all but Antigravity also read the shared `~/.agents/skills/`. So one shed can serve them all. Pick the target with `--agent`. For Codex, skills go to `~/.agents/skills` because that is the location Codex documents, so use either `--agent codex` or `--agent agents` for skills on one machine, not both:

```
lshed restore --agent agents            # ~/.agents/skills: every tool that follows the convention reads it
lshed restore --agent codex             # ~/.agents/skills + ~/.codex/AGENTS.md + config.toml
lshed restore --agent gemini --link     # ~/.gemini/skills + ~/.gemini/GEMINI.md, as links
lshed restore --agent agy               # ~/.gemini/config/skills + ~/.gemini/AGENTS.md (Antigravity IDE and CLI)
```

| `--agent` | root | skills | instructions file | MCP servers |
|---|---|---|---|---|
| `claude-code` (default) | `~/.claude` or `$CLAUDE_CONFIG_DIR` | yes, plus agents, commands, settings | `CLAUDE.md`, `@`-imports fragments | `~/.claude.json` |
| `codex` | `~/.codex` or `$CODEX_HOME` | yes, in `~/.agents/skills` (Codex's documented location; `~/.codex/skills` is deprecated) | `AGENTS.md`, fragments concatenated | `config.toml` `[mcp_servers.*]` |
| `gemini` | `~/.gemini` | yes | `GEMINI.md`, concatenated | `settings.json` |
| `copilot` | `~/.copilot` or `$COPILOT_HOME` | yes | `copilot-instructions.md`, concatenated | `mcp-config.json` |
| `cursor` | `~/.cursor` | yes | none (Cursor's user rules live in its settings UI) | `mcp.json` |
| `agy` | `~/.gemini/config` | yes | `../AGENTS.md`, concatenated (agy reads `GEMINI.md` too, but Gemini CLI owns that one) | `mcp_config.json` |
| `agents` | `~/.agents` | yes | none | none |

MCP entries are stored in the shed in Claude Code's shape and translated on the way out: Gemini gets `httpUrl` and no `type`, Antigravity gets `serverUrl`, Copilot gets `type: local` and `tools: ["*"]`, Cursor gets `${env:VAR}` placeholders and Codex gets `env_vars` / `bearer_token_env_var` / `env_http_headers` with the variable *names*, so for those two the secret values never touch the config file. Gemini, Antigravity and Copilot do not expand placeholders, so lshed fills them from your shell at `restore`. Codex's `config.toml` is edited table by table; your comments and other settings stay as they are. `lshed init --agent gemini` reads the same files back into the shed shape, secrets masked.

Each agent root keeps its own `lshed/state.json`, so restoring into `~/.codex` never touches what lshed placed in `~/.claude`, and each can use a different profile or `--link` choice. Parts the target does not understand are announced and skipped: a profile with settings keys restores into Codex without them, with a line saying `codex 은 settings 를 다루지 않아 건너뜁니다`. Claude plugin packages are skipped the same way; `github:`/`git:` packages are cloned into every agent root that restores the profile, so give the other agents a profile without them if that is not what you want. `lshed init --agent codex` works too, and a shed made from Codex restores into Claude Code with `CLAUDE.md` generated from the same fragments. The shed's `agent:` is only a default for `--agent` (`$LSHED_AGENT` also works).

### Links instead of copies

On the machine where you do most of your editing, `restore --link` places skills, agents, commands and instruction fragments as links into the shed instead of copies. Edits in `~/.claude` land in the shed directly, `diff` has nothing to report, and `save` has nothing to do; `lshed sync` is the whole loop.

```
$ lshed restore --link
  ~ skills/add-drivers  (link)
  ~ agents/reviewer.md  (link)
  ~ lshed/instructions/main.md  (link)
  = CLAUDE.md

Profile "default" applied (link): placed 4, removed 0
```

The choice is per machine and remembered: later `lshed restore` calls on that machine keep linking, `lshed status` shows `placement  links`, and `restore --no-link` goes back to copies. Other machines are not affected. MCP entries and settings keys are JSON values, not files, so they are always written. Switching profiles removes the links, never the shed behind them. On Windows, directories become junctions with no special permission; single-file parts (agents, commands, fragments) need Developer Mode for a link, and without it lshed copies the file, says so, and treats it like any other copy (`save` still works for it).

### Adding things later

Write a new skill, add an MCP server with `claude mcp add`, clone a toolkit into `~/.claude/skills/`. Then:

```
$ lshed add
3 outside the shed (to add: lshed add <key...> or --all):
    skills/paper-review
    mcp/linear
  ≡ packages/superpowers  github:obra/superpowers@main
  · 53 generated by package gstack are left out

$ lshed add paper-review mcp/linear
  + skills/paper-review
  + mcp/linear  (secrets → ${LINEAR_API_KEY})

2 added to the shed and to profile "default". Commit the shed: /home/me/lshed
```

`add` classifies exactly like `init`, appends to `lshed.yaml` without disturbing your comments, adds the parts to the current profile and to the managed set. Without keys it only lists. `status` shows the count on its `outside` row. To put a part that is already in the shed into another profile, edit `profiles:` by hand; `add` tells you when that is the case.

### Keeping packages current

```
lshed status                # shows "! gstack  253d1df ≠ lock 0d1bd56  → lshed update" when a clone moved
lshed update --dry-run      # asks upstream what would move, touches nothing
lshed update                # fast-forward every package in the profile, refresh lshed.lock
lshed update gstack --yes   # one package, and run its install: afterwards
```

Git packages are pinned by commit in `lshed.lock`; a new machine gets exactly that commit. Plugins cannot be pinned, so the lock records what got installed and `status` says when it differs from the machine you came from.

`update --dry-run` reads upstream without changing anything: `= (최신)` (up to date) when the clone already sits on the remote tip, `~ 0d1bd56 → 0530392` when a pull would move it, `?` when that cannot be known in advance. Git packages and marketplaces Claude Code cloned with git can be checked; Claude plugins and the official marketplace (not a git clone) cannot, so they show `?` and only a real `update` tells.

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
- Category names come from the adapter. For Claude Code: `skills`, `agents`, `commands`, `instructions`, `mcp`, `settings`. Other agents have `skills`, and `instructions` / `mcp` where the table above says so.
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

- A package that is already present is never touched by `restore`. Your local checkout is yours. The one exception is `--yes`, which runs the package's `install:` again, so "rerun with `--yes`" after a first restore does what it says.
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

`restore` writes the placeholder as is. Claude Code expands `${VAR}` from the environment when it starts the server, so the value only ever lives in your shell. The one exception is `${HOME}`, which lshed fills itself: Claude Code only expands variables that exist in its environment, Windows has no `HOME`, and with it missing Claude Code reports "Missing environment variables: HOME" and does not start the server (checked against 2.1.265) (`export EXA_API_KEY=...` in `~/.zshrc`, or however you manage secrets). `restore` and `status` list the variables the profile needs that are not set. The heuristic is a suggestion: edit the JSON in the shed to add or remove placeholders, and `init` warns when something in `args` or `url` looks like a token. `save` keeps existing placeholders and masks new secret-looking keys, so a rotated key never leaks into the shed by accident. `diff` compares with placeholders as wildcards, so a machine holding real values is not drift.

## Settings

`~/.claude/settings.json` holds hooks, permissions, `env`, the model, the theme, and some state Claude Code writes for itself. lshed does not merge it. Each **top-level key is one component** of category `settings`: the shed holds `settings/permissions.json`, `settings/hooks.json`, and so on, and `restore` writes exactly those keys, leaving the rest of the file alone. A profile can carry `permissions` and `hooks` and leave `model` to each machine.

```
$ lshed add
3 outside the shed:
    settings/hooks  ! points into package gstack. If that install created it, exclude it: settings/hooks
    settings/model
    settings/theme
```

- `enabledPlugins` and `extraKnownMarketplaces` are never taken: the plugin and marketplace packages own them, and `restore` rebuilds them by installing those.
- Absolute paths under your home directory become `${HOME}/…` in the shed, so a hook command written on one machine works on another. The shed always uses `/` after `${HOME}`, whether the path was written as `C:\Users\me\.claude\hooks\x` or `/home/me/.claude/hooks/x`, so one shed serves Windows, WSL, macOS and Linux; on Windows `restore` writes it back as `C:/Users/me/.claude/hooks/x`, which Node, PowerShell, cmd and Git Bash all accept. Claude Code does not expand variables in `settings.json`, so `restore` fills `${HOME}` and any `${VAR}` itself from your shell; unset variables are reported and left as placeholders.
- `env` is treated as a secret map: keys that look secret are masked, the rest (`CLAUDE_CODE_MAX_OUTPUT_TOKENS`, …) travel as they are.
- A value pointing inside a package (a hook a toolkit's installer wrote) is flagged. If the installer recreates it, put it in `exclude:` and let `restore --yes` bring it back.
- Since the shed owns the whole key, extra permissions you grant locally show up in `diff` and go into the shed with `save`, like any other edit.

## Commands

```
lshed init [--shed <dir>] [--profile <name>] [--exclude <id...>]
lshed add [keys...] [--all]                     put things that appeared since init into the shed
lshed restore [profile] [--pick] [--link | --no-link] [--dry-run] [--no-backup] [--yes]   (--agent <name> to target another tool)
lshed status                                    applied profile, drift, packages, missing env, new things
lshed diff                                      files (or JSON keys) that differ between local and shed
lshed save [ids...]                             copy local edits back into the shed
lshed sync [-m <msg>] [--no-push] [--dry-run]   commit the shed, pull --rebase, push
lshed update [ids...] [--dry-run] [--yes]       pull packages forward, refresh lshed.lock; --dry-run asks upstream only
lshed list [--unused]                           what is in the shed, and which profiles use it
lshed remove <key>                              drop a component or package from the shed
lshed prune [--yes]                             drop everything no profile uses
lshed scan                                      list what the agent root holds, without writing anything
lshed report [--open]                           summary of this setup to paste into an issue; --open prefills one on GitHub
```

Keys are `category/id`, or just `id` when unambiguous: `skills/paper-review`, `mcp/exa`, `packages/gstack`. An id is the file or directory name the agent reads, in any script (`skills/논문리뷰` is fine); letters, digits, `.`, `_` and `-` are allowed, and `/` between segments for nested agents and commands.

Global options: `--shed <dir>` (or `LSHED_HOME`; after the first restore lshed remembers it), `--agent <name>` (or `LSHED_AGENT`; default is the shed's `agent:`, then `claude-code`), `--root <dir>` (agent config root, default is the agent's own, e.g. `~/.claude` or `~/.codex`).

### What `restore` does

0. Installs any package in the profile that is missing, at the version in `lshed.lock`.
1. Removes paths that the **previous** profile placed and the new one doesn't need.
2. Copies every part of the new profile into place (or links it into the shed, with `--link` or on a machine that used it before); writes MCP entries into `~/.claude.json` and settings keys into `settings.json`.
3. Regenerates the instructions file.

Anything it overwrites or removes is backed up first under `~/.claude/lshed/backups/<timestamp>/`, unless you pass `--no-backup`. Files lshed never placed are left alone. `--dry-run` prints the plan and writes nothing. With `--pick`, a checklist per non-empty category comes first (packages, skills, agents, commands, instructions, MCP servers, settings keys). `[profile]` pre-checks that profile's parts. The result is written to `lshed.yaml` as a profile, and then steps 0–3 run for it.

### What `sync` does

1. Warns if `diff` shows local edits you have not saved.
2. Commits everything in the shed (message names the changed parts, or `-m`).
3. If `origin` exists: `git pull --rebase`, then `git push` (sets the upstream the first time).
4. If commits came in, tells you to run `lshed restore`.

On a conflict it aborts the rebase, leaves the shed clean with your commit intact, and tells you to resolve with git. Without a remote it only commits. It never runs `save` for you.

### Ownership

The shed is the source of truth for authored parts: `save` copies local edits back for `file:` components, and a linked part is the shed. Packages are owned by their upstream: `update` pulls them, `save` ignores them.

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

~/.codex/  ~/.gemini/  ~/.copilot/  ~/.cursor/  ~/.gemini/config/  ~/.agents/
  skills/  <instructions file>  <mcp file>      ← the same, per --agent (see the table above; codex skills live in ~/.agents/skills)
  lshed/state.json  lshed/backups/              ← each root keeps its own
```

`state.json` is per machine and is not part of the shed. If `CLAUDE_CONFIG_DIR` is set, lshed uses it as the root and writes `.claude.json` inside it, as Claude Code does.

## What has been verified

- Tests, a CLI smoke run and the standalone binaries run on every push on **Ubuntu, macOS and Windows** (Node 20 and 22). Windows uses junctions for `--link` and `claude.cmd` for plugin installs. The smoke run includes a skill with a Korean name, so a filename-normalization difference on macOS or a code-page problem on Windows would fail there, not on a user's machine.
- On a real Windows 11 PC without Developer Mode (PowerShell 7 and cmd.exe, Node 24, paths with spaces and Korean) the same walk passed with lshed 0.15.1 from npm: `init`, `restore` next to an existing setup, `--link` (junctions for skills, copies with a notice for single files), `add`/`diff`/`save`, a profile switch, the `codex` and `agents` targets, `sync` without a remote, and the smoke suite. Two follow-up passes on the same PC confirmed 0.15.2 (a shed made there restores with `/home/…/` paths inside WSL, an older shed is normalized by one `save`) and 0.15.3 (link mode settles on `=` for the file parts it had to copy, and re-copies them only when the shed changes).
- On the Linux development machine the whole command set is exercised beyond CI: git and GitHub packages with `install:` through `restore` and `update`, `sync` against a real remote including a conflict, `remove`/`prune`, every `--agent` target, the environment-variable defaults, `restore --pick` through a real terminal, and the compiled Linux binary.
- The other agents are checked against the tools themselves, not just their docs. `scripts/vm/probe.sh` restores a throwaway shed into a tool's real root and asks the tool, non-interactively, for a passphrase kept in a skill, a codeword kept in the instructions file, and the same skill again through a `--link` symlink. Codex 0.153.2 and Antigravity CLI 1.1.27 pass every check (last run 2026-09-08 with lshed 0.14.1); Gemini CLI, Copilot CLI and Cursor are verified for file placement and format so far. `scripts/vm/README.md` has the details and a cloud-init file for running the whole thing on a fresh VM.
- One real shed is in daily use on the machine this is developed on: Claude Code, Codex and Antigravity all read it through `--link`, and `status` reports no drift for any of the three.
- Everything above is one person's machines. If lshed works for you on a tool version or an OS not listed here, a [verification report](https://github.com/LeeSongHeon-LSH/lshed/issues/new?template=verified.yml) takes two minutes and becomes a line in this section. If it does not work, `lshed report` prints what a [bug report](https://github.com/LeeSongHeon-LSH/lshed/issues/new?template=bug.yml) needs: versions, the agent and its root, the applied profile and the names of what the shed holds. No values, no secrets, and your home directory shows as `~`. After a failed command lshed asks whether to open that form with the summary filled in; it never sends anything by itself, and `LSHED_REPORT=0` turns the question off.

## Not in scope (yet)

- Secrets beyond "name the variable". Encrypted values, `op://` references and OS keychains are possible later; today lshed is deliberately no better than dotfiles here.
- Project-scope MCP servers (`.mcp.json`, `~/.claude.json` `projects.*`) and project-scope plugins. They belong to the project.
- For the other agents, only skills, the instructions file and MCP servers travel. Their own settings files, rules folders and plugins stay where they are.

## Troubleshooting

- **Something else went wrong** — `lshed report` prints the summary a bug report needs (nothing secret; check it yourself), `lshed report --open` puts it into a new issue form. The same question is asked right after a failed command; answer no, or set `LSHED_REPORT=0`, and nothing happens.
- **"Shed location unknown. Pass --shed <dir> or set LSHED_HOME."** — do one of those. After one successful `restore`, lshed remembers it.
- **restore replaced my `CLAUDE.md`** — it is in `~/.claude/lshed/backups/<timestamp>/CLAUDE.md`. Move its content into a fragment in the shed and add that fragment to your profile.
- **I edited a skill locally and want to keep it** — `lshed diff` to see, `lshed save <id>` to push it into the shed, then `lshed sync`.
- **`status` says a package differs from the lock** — something updated the clone or plugin behind lshed's back (Claude Code auto-updates plugins). `lshed update` records the new version.
- **`status` keeps listing the same new things** — they are installer aliases or scratch. Add them to `exclude:` in `lshed.yaml`.
- **restore says an MCP variable is missing** — export it in your shell profile and restart Claude Code. The placeholder in `~/.claude.json` is correct; Claude Code fills it at startup.
- **restore wrote a hook with the wrong path** — the shed stores home paths as `${HOME}/…`. If a command points elsewhere on this machine, edit the JSON in the shed to use `${HOME}` or another variable and `restore` again. Paths outside your home directory (`D:\tools\x.exe`, `/opt/x`) are copied as written and are your job to keep portable.
- **`--link` copied a file on Windows** — single-file links need Developer Mode. Turn it on and `restore` again, or keep the copy: later restores report it as `= … (copy; …)` and leave it alone, and `save` brings edits back from it.
- **sync stopped on a conflict** — `cd <shed> && git pull --rebase`, resolve, `git rebase --continue`, then `lshed sync` again.

## License

MIT
