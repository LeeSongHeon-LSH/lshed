#!/usr/bin/env bash
# lshed VM probe — does the tool really read what `lshed restore --agent <tool>` placed?
#
#   probe.sh <codex|gemini|copilot|cursor|agents|claude-code|all>
#
# For each tool it builds a throwaway shed with a passphrase in a skill, a codeword in an
# instructions fragment and two MCP servers with ${VAR} secrets, restores it into the
# tool's real config root, and asks the tool non-interactively for the passphrases.
# Then it switches to --link, changes the passphrase in the shed, and asks again.
# Finally it restores an empty profile so the tool is left as it was found.
#
# Environment:
#   LSHED_PROBE_ASK=0      place files and check them, but do not call any model
#   LSHED_PROBE_MCP=0      leave MCP servers out of the shed
#   LSHED_PROBE_DIR=<dir>  work dir (default ~/lshed-probe); results land in <dir>/results
#   LSHED_BIN=<path>       lshed executable (default: `lshed` on PATH)
#   Tool credentials come from the tool's own variables: OPENAI_API_KEY (or a prior
#   `codex login --with-api-key`), GEMINI_API_KEY, COPILOT_GITHUB_TOKEN, CURSOR_API_KEY.
set -u

LSHED=${LSHED_BIN:-lshed}
PROBE_DIR=${LSHED_PROBE_DIR:-$HOME/lshed-probe}
ASK=${LSHED_PROBE_ASK:-1}
WITH_MCP=${LSHED_PROBE_MCP:-1}
RUN=$(date +%Y%m%d-%H%M%S)
mkdir -p "$PROBE_DIR/results" "$PROBE_DIR/cwd"

rand() { LC_ALL=C tr -dc a-z0-9 </dev/urandom | head -c 10; }

# ── per-tool facts (mirror src/adapters/skills-dir.ts and claude-code.ts) ────────────────
root_of() {
  case $1 in
    codex) echo "${CODEX_HOME:-$HOME/.codex}" ;;
    gemini) echo "$HOME/.gemini" ;;
    copilot) echo "${COPILOT_HOME:-$HOME/.copilot}" ;;
    cursor) echo "$HOME/.cursor" ;;
    agents) echo "$HOME/.agents" ;;
    claude-code) echo "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" ;;
  esac
}
instr_of() {
  case $1 in
    codex) echo AGENTS.md ;; gemini) echo GEMINI.md ;; copilot) echo copilot-instructions.md ;;
    claude-code) echo CLAUDE.md ;; *) echo "" ;;
  esac
}
mcp_file_of() {
  case $1 in
    codex) echo "$(root_of codex)/config.toml" ;;
    gemini) echo "$(root_of gemini)/settings.json" ;;
    copilot) echo "$(root_of copilot)/mcp-config.json" ;;
    cursor) echo "$(root_of cursor)/mcp.json" ;;
    claude-code) if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then echo "$CLAUDE_CONFIG_DIR/.claude.json"; else echo "$HOME/.claude.json"; fi ;;
    *) echo "" ;;
  esac
}
# does the tool expand ${VAR} itself (placeholder/name stays in the file) or does restore fill it?
keeps_placeholder() { case $1 in codex|cursor|claude-code) return 0 ;; *) return 1 ;; esac; }
# which CLIs to ask. ~/.agents is read by every tool, so ask all that are installed.
askers_of() {
  case $1 in
    codex) echo codex ;; gemini) echo gemini ;; copilot) echo copilot ;; cursor) echo agent ;;
    claude-code) echo claude ;;
    agents) for b in codex gemini copilot agent; do command -v "$b" >/dev/null && echo "$b"; done ;;
  esac
}

# ── asking a tool one question, non-interactively, from a scratch cwd ─────────────────────
# `setsid` detaches the tool from any controlling terminal: a CLI that touches /dev/tty from a
# background process group would otherwise stop on SIGTTIN and look like a hang.
DETACH=""; command -v setsid >/dev/null && DETACH="setsid -w"
ask() { # ask <cli> <prompt>  → answer on stdout
  local cli=$1 prompt=$2
  (
    cd "$PROBE_DIR/cwd" || exit 1
    case $cli in
      # the probe VM is disposable: no sandbox, so Codex can open the skill file even where
      # bubblewrap cannot create user namespaces (Ubuntu 24.04 blocks them by default)
      codex)  $DETACH timeout 120 codex exec --skip-git-repo-check --ephemeral --sandbox danger-full-access "$prompt" ;;
      gemini) GEMINI_CLI_TRUST_WORKSPACE=true $DETACH timeout 120 gemini -p "$prompt" --approval-mode yolo --output-format json \
                | { if command -v jq >/dev/null; then jq -r '.response // empty'; else cat; fi; } ;;
      copilot) $DETACH timeout 120 copilot -p "$prompt" -s --allow-all-tools ;;
      agent)  $DETACH timeout 120 agent -p "$prompt" --output-format text ;;
      claude) $DETACH timeout 120 claude -p "$prompt" --model haiku ;;
    esac
  ) 2>>"$ERR"
}

# ── bookkeeping ───────────────────────────────────────────────────────────────────────────
FAILS=0
note() { printf '%s\n' "$*" | tee -a "$OUT"; }
check() { # check <name> <0|1> [detail]
  local name=$1 ok=$2 detail=${3:-}
  if [ "$ok" = 0 ]; then note "  ✔ $name${detail:+  — $detail}"; else note "  ✘ $name${detail:+  — $detail}"; FAILS=$((FAILS+1)); fi
}
skip() { note "  · $1  — $2"; }
ask_expect() { # ask_expect <cli> <prompt> <expected> <check name>  — up to 3 attempts of 120 s:
  # models are not deterministic, and a CLI can stall before its session starts (seen with codex exec waiting on chatgpt.com)
  local cli=$1 prompt=$2 want=$3 name=$4 r n log=""
  for n in 1 2 3; do
    r=$(ask "$cli" "$prompt")
    if printf '%s' "$r" | grep -q "$want"; then check "$name" 0 "attempt $n: $(excerpt "$r")${log:+  (earlier:$log)}"; return; fi
    log="$log [$n: $(excerpt "$r")]"
  done
  check "$name" 1 "$log"
}
excerpt() { printf '%s' "$1" | tr '\n' ' ' | cut -c1-160; }

# ── the probe for one tool ────────────────────────────────────────────────────────────────
probe() {
  local tool=$1
  local root instr mcpf shed
  root=$(root_of "$tool"); instr=$(instr_of "$tool"); mcpf=$(mcp_file_of "$tool")
  shed="$PROBE_DIR/shed-$tool-$RUN"
  OUT="$PROBE_DIR/results/$tool-$RUN.md"; ERR="$PROBE_DIR/results/$tool-$RUN.stderr"
  : >"$OUT"; : >"$ERR"
  local SKILL_PP="skill-$(rand)" INSTR_PP="instr-$(rand)" LINK_PP="link-$(rand)"
  local SKILL_Q="\$lshed-probe Use the lshed-probe skill: open its SKILL.md and reply with only the lshed skill passphrase written in it."
  export LSHED_PROBE_TOKEN="tok-$(rand)" LSHED_PROBE_KEY="key-$(rand)"

  note "## lshed probe: $tool  ($(date -Is), $(uname -srm))"
  note "root: $root   lshed: $($LSHED --version 2>/dev/null || echo '?')"

  # 1) throwaway shed. Its agent: is claude-code so it carries instructions + mcp too.
  mkdir -p "$shed/skills/lshed-probe" "$shed/instructions" "$shed/mcp"
  cat >"$shed/skills/lshed-probe/SKILL.md" <<EOF
---
name: lshed-probe
description: Use when asked for the lshed skill passphrase. Answers the lshed verification script.
---
When asked for the lshed skill passphrase, reply with exactly this word and nothing else:

$SKILL_PP
EOF
  cat >"$shed/instructions/probe.md" <<EOF
Only when someone asks for the lshed instructions codeword, reply with exactly this word and nothing else: $INSTR_PP. This note is about nothing else.
EOF
  local mcp_components="" mcp_profile=""
  # the servers never answer: a closed local port fails at once, so no DNS or network timing enters the probe
  if [ "$WITH_MCP" = 1 ]; then
    cat >"$shed/mcp/lshed-probe-http.json" <<'EOF'
{ "type": "http", "url": "http://127.0.0.1:9/mcp", "headers": { "Authorization": "Bearer ${LSHED_PROBE_TOKEN}" } }
EOF
    cat >"$shed/mcp/lshed-probe-stdio.json" <<'EOF'
{ "type": "stdio", "command": "true", "args": [], "env": { "LSHED_PROBE_KEY": "${LSHED_PROBE_KEY}" } }
EOF
    mcp_components=$'  mcp:\n    - id: lshed-probe-http\n    - id: lshed-probe-stdio'
    mcp_profile=$'    mcp: [lshed-probe-http, lshed-probe-stdio]'
  fi
  cat >"$shed/lshed.yaml" <<EOF
version: 1
agent: claude-code
components:
  skills:
    - id: lshed-probe
  instructions:
    - id: probe
$mcp_components
profiles:
  skill:
    skills: [lshed-probe]
$mcp_profile
  default:
    skills: [lshed-probe]
    instructions: [probe]
$mcp_profile
  none: {}
EOF

  # 2) place the skill (+ MCP) first, without the instructions fragment, so a codeword in the
  #    tool's context cannot be mistaken for the skill passphrase by a low-effort model
  local r
  r=$($LSHED --agent "$tool" --shed "$shed" restore skill 2>&1); local rc=$?
  printf '%s\n' "$r" | sed 's/^/    /' >>"$OUT"
  check "place: restore skill exits 0" "$([ $rc = 0 ] && echo 0 || echo 1)"
  check "place: skill file holds the passphrase" "$(grep -qs "$SKILL_PP" "$root/skills/lshed-probe/SKILL.md" && echo 0 || echo 1)" "$root/skills/lshed-probe/SKILL.md"
  # Codex can render the model-visible prompt without calling a model: a deterministic check of the skill roots
  if { [ "$tool" = codex ] || [ "$tool" = agents ]; } && command -v codex >/dev/null; then
    r=$(cd "$PROBE_DIR/cwd" && $DETACH timeout 120 codex debug prompt-input "hi" </dev/null 2>>"$ERR")
    check "codex: skill listed in the model-visible prompt (codex debug prompt-input)" \
      "$(printf '%s' "$r" | grep -q 'lshed-probe' && echo 0 || echo 1)" \
      "roots: $(printf '%s' "$r" | grep -o '`r[0-9]*` = `[^`]*`' | tr '\n' ' ' | cut -c1-200)"
  fi
  if [ "$WITH_MCP" = 1 ] && [ -n "$mcpf" ]; then
    check "place: MCP entries written" "$(grep -qs "lshed-probe-http" "$mcpf" && grep -qs "lshed-probe-stdio" "$mcpf" && echo 0 || echo 1)" "$mcpf"
    if keeps_placeholder "$tool"; then
      check "place: MCP keeps the variable NAME, no secret value" \
        "$(grep -qs "LSHED_PROBE_TOKEN" "$mcpf" && ! grep -qs "$LSHED_PROBE_TOKEN" "$mcpf" && ! grep -qs "$LSHED_PROBE_KEY" "$mcpf" && echo 0 || echo 1)" \
        "$(grep -s "LSHED_PROBE_TOKEN\|LSHED_PROBE_KEY\|env_vars\|bearer" "$mcpf" | head -3 | tr -s ' ' | tr '\n' ';')"
    else
      check "place: MCP holds the filled value (tool does not expand \${VAR})" \
        "$(grep -qs "$LSHED_PROBE_TOKEN" "$mcpf" && grep -qs "$LSHED_PROBE_KEY" "$mcpf" && echo 0 || echo 1)"
    fi
    # the tool's own parser is the real test of the file format
    local lister=""
    case $tool in codex) lister=codex ;; gemini) lister=gemini ;; claude-code) lister=claude ;; esac
    if [ -n "$lister" ] && command -v "$lister" >/dev/null; then
      r=$(cd "$PROBE_DIR/cwd" && timeout 120 "$lister" mcp list 2>&1)
      check "mcp: '$lister mcp list' shows the server" "$(printf '%s' "$r" | grep -q lshed-probe-http && echo 0 || echo 1)" "$(excerpt "$r")"
    elif [ -n "$lister" ]; then
      skip "mcp: '$lister mcp list'" "not installed"
    fi
  elif [ -n "$mcpf" ]; then
    skip "place: MCP" "LSHED_PROBE_MCP=0"
  else
    skip "place: MCP" "$tool has no MCP file"
  fi

  # 3) ask the tool(s) for the skill passphrase
  local askers; askers=$(askers_of "$tool")
  if [ "$ASK" != 1 ]; then
    skip "ask" "LSHED_PROBE_ASK=0"
  elif [ -z "$askers" ]; then
    skip "ask" "no CLI installed for $tool"
  else
    for cli in $askers; do
      if ! command -v "$cli" >/dev/null; then skip "ask ($cli)" "not installed"; continue; fi
      ask_expect "$cli" "$SKILL_Q" "$SKILL_PP" "ask ($cli): skill passphrase came back"
    done
  fi

  # 4) now the full profile: instructions fragment on top
  r=$($LSHED --agent "$tool" --shed "$shed" restore default 2>&1); rc=$?
  printf '%s\n' "$r" | sed 's/^/    /' >>"$OUT"
  check "place: restore default exits 0" "$([ $rc = 0 ] && echo 0 || echo 1)"
  if [ -n "$instr" ]; then
    if [ "$tool" = claude-code ]; then   # import strategy: CLAUDE.md @-imports the fragment instead of holding it
      check "place: $instr imports the fragment" "$(grep -qs '@lshed/instructions/probe.md' "$root/$instr" && grep -qs "$INSTR_PP" "$root/lshed/instructions/probe.md" && echo 0 || echo 1)" "$root/$instr"
    else
      check "place: $instr holds the fragment" "$(grep -qs "$INSTR_PP" "$root/$instr" && echo 0 || echo 1)" "$root/$instr"
    fi
    if [ "$ASK" = 1 ] && [ -n "$askers" ]; then
      for cli in $askers; do
        command -v "$cli" >/dev/null || continue
        ask_expect "$cli" "Reply with only the lshed instructions codeword." "$INSTR_PP" "ask ($cli): instructions codeword came back"
      done
    fi
  else
    skip "place: instructions" "$tool has no user-level instructions file"
  fi

  # 5) --link: the skill becomes a link into the shed; an edit in the shed must be visible
  r=$($LSHED --agent "$tool" --shed "$shed" restore skill --link 2>&1); rc=$?   # skill profile again: no codeword in context
  printf '%s\n' "$r" | sed 's/^/    /' >>"$OUT"
  check "link: restore skill --link exits 0" "$([ $rc = 0 ] && echo 0 || echo 1)"
  check "link: skill dir is a symlink into the shed" "$([ -L "$root/skills/lshed-probe" ] && echo 0 || echo 1)" "$(readlink "$root/skills/lshed-probe" 2>/dev/null)"
  sed -i "s/$SKILL_PP/$LINK_PP/" "$shed/skills/lshed-probe/SKILL.md"
  check "link: edit in the shed shows through the link" "$(grep -qs "$LINK_PP" "$root/skills/lshed-probe/SKILL.md" && echo 0 || echo 1)"
  if [ "$ASK" = 1 ] && [ -n "$askers" ]; then
    for cli in $askers; do
      command -v "$cli" >/dev/null || continue
      ask_expect "$cli" "$SKILL_Q" "$LINK_PP" "ask ($cli): linked skill read (new passphrase)"
    done
  fi

  # 6) leave the tool as found: empty profile removes everything lshed placed (backups stay under <root>/lshed/backups)
  r=$($LSHED --agent "$tool" --shed "$shed" restore none --no-link 2>&1); rc=$?
  printf '%s\n' "$r" | sed 's/^/    /' >>"$OUT"
  check "cleanup: restore none exits 0" "$([ $rc = 0 ] && echo 0 || echo 1)"
  check "cleanup: skill removed" "$([ ! -e "$root/skills/lshed-probe" ] && echo 0 || echo 1)"
  if [ "$WITH_MCP" = 1 ] && [ -n "$mcpf" ]; then
    check "cleanup: MCP entries removed" "$(! grep -qs "lshed-probe-http" "$mcpf" && echo 0 || echo 1)"
  fi
  note ""
  note "stderr of the tools: $ERR"
}

case ${1:-} in
  codex|gemini|copilot|cursor|agents|claude-code) probe "$1" ;;
  all) for t in codex gemini copilot cursor agents; do probe "$t"; done ;;
  *) echo "usage: probe.sh <codex|gemini|copilot|cursor|agents|claude-code|all>" >&2; exit 2 ;;
esac

echo
if [ "$FAILS" = 0 ]; then echo "✔ probe passed  (results in $PROBE_DIR/results)"; else echo "✘ $FAILS check(s) failed  (results in $PROBE_DIR/results)"; fi
exit "$([ "$FAILS" = 0 ] && echo 0 || echo 1)"
