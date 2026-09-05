#!/usr/bin/env bash
# Bake a Linux VM image for the lshed probe: every agent CLI lshed can place into (Codex, Gemini CLI, Copilot CLI, Cursor CLI, Antigravity CLI), plus lshed itself.
# Ubuntu 22.04/24.04 (Debian works too). Run once as a sudo-capable user, then snapshot the image.
# No credentials go in here — inject them at boot with cloud-init.yaml.
#
#   LSHED_FROM=npm       (default) npm install -g lshed@latest — the published package
#   LSHED_FROM=release   standalone binary from the latest GitHub release (a machine without Node)
#   LSHED_FROM=<path>    a local checkout: npm ci && npm run build && npm link
set -euo pipefail
FROM=${LSHED_FROM:-npm}

sudo apt-get update -q
sudo apt-get install -y -q curl git jq ca-certificates

# Node 22: Copilot CLI needs 22+, Gemini CLI 20+, Codex ships its own binary through npm.
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y -q nodejs
fi

sudo npm install -g @openai/codex @google/gemini-cli @github/copilot

# Cursor CLI installs into ~/.local/bin/agent, Antigravity CLI (agy) into ~/.local/bin/agy
curl -fsS https://cursor.com/install | bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
grep -q '.local/bin' ~/.profile 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >>~/.profile

case $FROM in
  npm) sudo npm install -g lshed@latest ;;
  release)
    arch=$(uname -m); case $arch in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; esac
    curl -fsSL -o /tmp/lshed "https://github.com/LeeSongHeon-LSH/lshed/releases/latest/download/lshed-linux-$arch"
    sudo install -m 755 /tmp/lshed /usr/local/bin/lshed ;;
  *) (cd "$FROM" && npm ci && npm run build && sudo npm link) ;;
esac

# the probe itself, from the repo, so the image can run it without a checkout at boot
sudo git clone --depth 1 https://github.com/LeeSongHeon-LSH/lshed /opt/lshed 2>/dev/null || sudo git -C /opt/lshed pull -q
sudo chmod +x /opt/lshed/scripts/vm/probe.sh

echo
echo "installed:"
for b in node codex gemini copilot "$HOME/.local/bin/agent" "$HOME/.local/bin/agy" lshed; do printf '  %-40s %s\n' "$b" "$("$b" --version 2>/dev/null | head -1 || echo missing)"; done
