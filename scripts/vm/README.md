# VM probe: do the other agents really read what lshed places?

`--agent codex|gemini|copilot|cursor|agents` (0.11.0, 0.12.0) was written from each tool's documentation.
This directory checks it against the tools themselves, on a throwaway VM, without touching any real setup.

| file | role |
|---|---|
| `install-tools.sh` | bake the image once: Node 22, Codex, Gemini CLI, Copilot CLI, Cursor CLI, lshed, this repo under `/opt/lshed` |
| `cloud-init.yaml` | boot-time user data: API keys into `/etc/lshed-probe.env`, then run the probe and leave results in `/var/lib/lshed-probe/` |
| `probe.sh` | the probe: `probe.sh <codex|gemini|copilot|cursor|agy|agents|claude-code|all>` |

## What one probe run does

1. Builds a throwaway shed: a skill whose `SKILL.md` holds a random passphrase, an instructions fragment holding a random codeword, and two MCP servers whose secrets are `${LSHED_PROBE_TOKEN}` / `${LSHED_PROBE_KEY}` placeholders.
2. `lshed --agent <tool> restore default` into the tool's real root (`~/.codex`, `~/.gemini`, `~/.copilot`, `~/.cursor`, `~/.gemini/config` for agy, `~/.agents`), then checks the files: skill copied, instructions file written, MCP entries in the tool's own format (variable *name* for Codex/Cursor, filled value for Gemini/Copilot). Where the tool has a parser of its own (`codex mcp list`, `gemini mcp list`, `agy mcp list`, `codex debug prompt-input`) that is used too, since a file that lshed can write is not the same as a file the tool can read.
3. Asks the tool non-interactively (`codex exec`, `gemini -p`, `copilot -p`, `agent -p`, `agy -p`) for the skill passphrase and the instructions codeword. The `agents` target asks every installed tool, because `~/.agents/skills` is the shared location they all claim to read.
4. `restore --link`, edits the passphrase in the shed, asks again: does the tool follow the symlink?
5. `restore none --no-link`: an empty profile removes everything the probe placed. Backups stay under `<root>/lshed/backups/`.

Passphrases are random per run, so a stale copy from an earlier run cannot produce a false pass.
Results: `<probe dir>/results/<tool>-<timestamp>.md` plus the tools' stderr next to it.

## Running it

On the VM (image baked with `install-tools.sh`):

```
export OPENAI_API_KEY=... GEMINI_API_KEY=... COPILOT_GITHUB_TOKEN=... CURSOR_API_KEY=...
printenv OPENAI_API_KEY | codex login --with-api-key      # Codex wants its own login, not just the variable
/opt/lshed/scripts/vm/probe.sh all
```

Or let cloud-init do exactly that: fill the keys in `cloud-init.yaml` and boot with it as user data.

Without any key, `LSHED_PROBE_ASK=0 probe.sh all` still checks everything that does not need a model
(files, formats, `mcp list`, `debug prompt-input`, links, cleanup). That part runs on any machine against a scratch `HOME`:

```
HOME=/tmp/h LSHED_PROBE_ASK=0 LSHED_BIN="node $PWD/dist/cli.js" scripts/vm/probe.sh all
```

## What is known before the VM (2026-09-05, this Linux machine)

- Codex 0.153.2 lists skills from **both** `$CODEX_HOME/skills` and `$HOME/.agents/skills` (`codex debug prompt-input` shows both as skill roots). Its source calls `$CODEX_HOME/skills` a *deprecated* location kept for compatibility, and the current docs mention only `.agents/skills`. lshed's `codex` target still uses `~/.codex/skills`; moving it to `~/.agents/skills` is a pending decision.
- The full Codex probe passes here: `$CODEX_HOME/AGENTS.md` is read, `config.toml` written by lshed parses in `codex mcp list`, the skill and the linked skill are read.
- Codex's read-only sandbox (bubblewrap) cannot create user namespaces on some hosts; then the model cannot open the skill file and answers from whatever is in context. The probe therefore runs `codex exec --sandbox danger-full-access` — acceptable on a disposable VM, not elsewhere.
- The `agents` target passes with Codex too: a skill lshed puts in `~/.agents/skills` is listed, read, and read again through the `--link` symlink after an edit in the shed.
- A low-effort model that already has the instructions codeword in context sometimes answers with it instead of opening the skill. The probe therefore asks the skill question under a skill-only profile, before and after the instructions fragment is placed, and gives every question two attempts.
- `codex exec` occasionally stalls before printing its session banner, holding an open connection to chatgpt.com (ChatGPT login) — independent of lshed. Every question therefore gets up to three attempts of 120 s.
- Antigravity CLI (`agy` 1.1.26) is installed and signed in here, so the `agy` target ran for real from an isolated `HOME` with a copied OAuth token: skill in `~/.gemini/config/skills`, rules in `~/.gemini/AGENTS.md`, `agy mcp list` parsing lshed's `mcp_config.json`, and the linked skill all passed on the first attempt. agy's `/skills` lists `~/.gemini/config/skills`, `~/.gemini/skills` and `~/.gemini/antigravity-cli/skills`, not `~/.agents/skills`. Headless on a VM, agy needs `modelProvider: "gemini"` in `~/.gemini/antigravity-cli/settings.json` plus `GEMINI_API_KEY` (1.1.13+); `cloud-init.yaml` writes that when the key is given.
- `claude-code` also passes for file placement under an isolated `CLAUDE_CONFIG_DIR`, which is how the 0.12.1 `.claude.json` bug was found.
- Gemini, Copilot and Cursor are not installed here; only their file placement is verified locally. They are what the VM run is for.

## Runbook: the day the VM is ready

Everything below assumes the repository at the tag you want to test is on GitHub and `lshed@latest` on npm is that version (`install-tools.sh` installs from npm; use `LSHED_FROM=release` for the binary, or `LSHED_FROM=/path/to/checkout` for an unpublished commit).

### 1. Bake the Linux image once

Boot a stock **Ubuntu 24.04** cloud image (22.04 works too), then:

```
git clone https://github.com/LeeSongHeon-LSH/lshed /tmp/lshed
bash /tmp/lshed/scripts/vm/install-tools.sh        # ~10 min: Node 22, codex, gemini, copilot, agent (Cursor), agy, lshed, /opt/lshed
```

The last lines print every tool's version. Snapshot the instance as an image (say `lshed-probe`). No key is on it.

### 2. Collect the keys

| tool | variable | where it comes from | note |
|---|---|---|---|
| Gemini CLI, and agy | `GEMINI_API_KEY` | Google AI Studio | agy uses it through `modelProvider: "gemini"`, which cloud-init writes |
| Copilot CLI | `COPILOT_GITHUB_TOKEN` | GitHub → Settings → Developer settings → fine-grained PAT on the **personal** account with the **Copilot Requests** permission | needs an active Copilot subscription |
| Cursor | `CURSOR_API_KEY` | cursor.com dashboard → API keys | |
| Codex | `OPENAI_API_KEY` | platform.openai.com | optional: Codex already passed on this machine; leave empty to skip its questions |

An empty variable skips that tool's model questions; file placement is still checked.

### 3. Boot with the keys and run

Fill the four values in `cloud-init.yaml` (`write_files` → `/etc/lshed-probe.env`), then:

```
openstack server create --image lshed-probe --flavor <2 vCPU / 4 GB is plenty> --key-name <key> \
  --user-data scripts/vm/cloud-init.yaml probe-1
openstack console log show probe-1 | grep -A200 'lshed probe on'      # results also scroll past on the console
ssh ubuntu@<ip> cat /var/lib/lshed-probe/summary.txt
scp -r ubuntu@<ip>:/var/lib/lshed-probe ./probe-results-$(date +%F)
```

Without cloud-init the same thing by hand, after `ssh`:

```
export GEMINI_API_KEY=... COPILOT_GITHUB_TOKEN=... CURSOR_API_KEY=...
mkdir -p ~/.gemini/antigravity-cli && echo '{ "modelProvider": "gemini" }' > ~/.gemini/antigravity-cli/settings.json
/opt/lshed/scripts/vm/probe.sh gemini; /opt/lshed/scripts/vm/probe.sh copilot; /opt/lshed/scripts/vm/probe.sh cursor
/opt/lshed/scripts/vm/probe.sh agy; /opt/lshed/scripts/vm/probe.sh agents
```

One target takes one to three minutes; the whole `all` run about ten. The VM is disposable: the probe restores an empty profile at the end, but nothing on it is worth keeping anyway.

### 4. Reading the result

Every target prints the same list. What each failure means:

| failing line | meaning | what changes |
|---|---|---|
| `place: …` | lshed wrote the wrong file, path or format | adapter spec (`src/adapters/skills-dir.ts`) or the MCP form (`mcp-forms.ts`); an lshed bug |
| `mcp: '<tool> mcp list' …` | the file is there but the tool's own parser rejects it | MCP form for that tool |
| `ask (…): skill passphrase` with `place` green | the tool reads skills from somewhere else, or needs a flag to load them | the spec's root/skills dir, or the `ask()` command line in `probe.sh` |
| `ask (…): instructions codeword` | the tool does not read that user-level rules file | the spec's `instructions.file`, or drop instructions for that tool |
| `ask (…): linked skill read` with the copy passing | the tool does not follow symlinks | document `--link` as unsupported for that tool |
| every `ask` empty, `.stderr` shows a login or trust prompt | auth or folder trust, not lshed | fix the key, or the trust file cloud-init writes |

Bring back `summary.txt`, `results/*.md` and the `*.stderr` files. The stderr is what tells a trust prompt from a wrong path.

### 5. The Windows check (not automated)

The probe is a bash script for Linux. The Windows layer (§10.1 in `overview.md`) is a short manual run on a Windows 11 or Server 2022 image:

1. Download `lshed-windows-x64.exe` from the release, rename to `lshed.exe`, put it on `PATH`.
2. Get a shed onto the machine. `~/harness` on the Linux box has no remote today, so either push it to a private repository first (`git remote add origin … && lshed sync`) or copy it with `git bundle`.
3. `lshed restore tools --shed C:\path\to\harness --agent agents --dry-run`, then without `--dry-run`. Then `lshed restore --link`: `dir %USERPROFILE%\.agents\skills` must show `<JUNCTION>` entries, and editing a `SKILL.md` through the junction must change the file in the shed. `lshed status` → `배치 link`, `드리프트 없음`. `lshed restore --no-link` goes back to copies.
4. If Claude Code is installed and signed in there, repeat with the default target (`lshed restore default --shed …`) and check `claude mcp list` and a skill through `claude -p`.

What to look for: `.cmd` wrappers being found (`claude.cmd`, `codex.cmd`), backslash paths in `state.json` and backups, and the file-part copy fallback message when Developer Mode is off.

