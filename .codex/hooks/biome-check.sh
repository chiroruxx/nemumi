#!/usr/bin/env bash
# Codex PostToolUse (Edit|Write|apply_patch): 編集されたファイルを Biome で整形・Lint する。
# 自動修正できないエラーが残った場合は exit 2 で Codex に返す。
set -uo pipefail

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo_root" || exit 0

# apply_patch の tool_input.command から追加・更新されたファイルを取り出す。
files=()
while IFS= read -r file; do
  files+=("$file")
done < <(
  jq -r '.tool_input.command // empty' |
    sed -nE 's/^\*\*\* (Add|Update|Delete) File: (.+)$/\2/p' |
    sort -u
)
[ "${#files[@]}" -gt 0 ] || exit 0

# Codex hooks は非対話シェルで動くため、mise の場所を PATH に足す。
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if command -v mise >/dev/null 2>&1; then
  biome() { mise exec -- pnpm exec biome "$@"; }
else
  biome() { pnpm exec biome "$@"; }
fi

existing_files=()
for file in "${files[@]}"; do
  # 削除されたファイルや Biome が扱わないファイルは対象外。
  [ -f "$file" ] && existing_files+=("$file")
done
[ "${#existing_files[@]}" -gt 0 ] || exit 0

if ! output=$(biome check --write --files-ignore-unknown=true --no-errors-on-unmatched "${existing_files[@]}" 2>&1); then
  echo "Biome のエラーが残っています: ${existing_files[*]}" >&2
  echo "$output" >&2
  exit 2
fi
exit 0
