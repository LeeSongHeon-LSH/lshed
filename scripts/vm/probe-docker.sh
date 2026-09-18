#!/usr/bin/env bash
# Run the VM probe in a local container instead of a cloud VM.
#
#   scripts/vm/probe-docker.sh build                 # bake the image from this checkout (~5-10 min)
#   scripts/vm/probe-docker.sh gemini                # one target; results in ./probe-results/<date>/
#   scripts/vm/probe-docker.sh all
#   PROBE_OUT=/tmp/x scripts/vm/probe-docker.sh copilot cursor
#
# Keys are passed through from the environment when set: GEMINI_API_KEY, COPILOT_GITHUB_TOKEN,
# CURSOR_API_KEY, OPENAI_API_KEY. With none of them set the run is model-free (LSHED_PROBE_ASK=0):
# file placement, formats and each tool's own `mcp list` / `debug prompt-input` parser are still checked.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/../.."
IMAGE=${PROBE_IMAGE:-lshed-probe}

if [ "${1:-}" = build ]; then
  shift
  exec docker build -f scripts/vm/Dockerfile.probe -t "$IMAGE" "$@" .
fi
[ $# -gt 0 ] || { echo "usage: $0 build | <codex|gemini|copilot|cursor|agy|agents|claude-code|all>..." >&2; exit 2; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "no image '$IMAGE' — run: $0 build" >&2; exit 1; }

OUT=${PROBE_OUT:-$PWD/probe-results/$(date +%F-%H%M)}
mkdir -p "$OUT"
keys=(); for k in GEMINI_API_KEY COPILOT_GITHUB_TOKEN CURSOR_API_KEY OPENAI_API_KEY; do [ -n "${!k:-}" ] && keys+=(-e "$k"); done
if [ ${#keys[@]} = 0 ] && [ -z "${LSHED_PROBE_ASK:-}" ]; then
  echo "no agent key in the environment → LSHED_PROBE_ASK=0 (no model questions)" >&2
  export LSHED_PROBE_ASK=0
fi
rc=0
for t in "$@"; do
  docker run --rm -e LSHED_PROBE_ASK -e LSHED_PROBE_MCP -e LSHED_PROBE_CODEX_MODEL -e LSHED_PROBE_CODEX_EFFORT "${keys[@]}" \
    -v "$OUT:/home/probe/lshed-probe" "$IMAGE" "$t" || rc=1
done
echo; echo "results: $OUT/results/"
exit $rc
