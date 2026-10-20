#!/usr/bin/env bash
# Codex PostToolUse: format files named by direct edits and read-only check other dirty files.
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v mise >/dev/null 2>&1; then
  echo "mise が見つかりません。mise をインストールしてから再実行してください。" >&2
  exit 2
fi
exec mise exec -- node "$repo_root/.codex/hooks/biome-check.mjs"
