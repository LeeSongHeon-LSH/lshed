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
- Gemini, Copilot and Cursor are not installed here; only their file placement is verified locally.
