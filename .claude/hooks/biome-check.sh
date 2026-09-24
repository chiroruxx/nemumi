#!/usr/bin/env bash
# PostToolUse (Edit|Write): 編集されたファイルを Biome で整形・Lint する。
# 自動修正できないエラーが残った場合は exit 2 で Claude に返す。
set -uo pipefail

file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[ -n "$file" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

# hook は非対話シェルで動くため、mise の場所を PATH に足す
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if command -v mise >/dev/null 2>&1; then
  biome() { mise exec -- pnpm exec biome "$@"; }
else
  biome() { pnpm exec biome "$@"; }
fi

# Biome が扱わないファイルや無視対象のファイルはエラーにせず通す
if ! output=$(biome check --write --files-ignore-unknown=true --no-errors-on-unmatched "$file" 2>&1); then
  echo "Biome のエラーが残っています: $file" >&2
  echo "$output" >&2
  exit 2
fi
exit 0
