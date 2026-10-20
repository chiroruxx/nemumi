#!/usr/bin/env bash

set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

if ! command -v mise >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install mise
  else
    printf '%s\n' 'mise is required. Install it first: https://mise.jdx.dev/getting-started.html' >&2
    exit 1
  fi
fi

mise trust -y
mise install

if [ ! -e .env ]; then
  umask 077
  cp .env.example .env
  printf '%s\n' 'Created .env from .env.example.'
fi

mise run install
if pnpm exec lefthook check-install; then
  printf '%s\n' 'Git hooks are already installed.'
else
  hook_path="$(git rev-parse --path-format=absolute --git-path hooks/pre-push)"
  if [ -e "$hook_path" ]; then
    legacy_hook=$(mktemp)
    trap 'rm -f "$legacy_hook"' EXIT
    cat > "$legacy_hook" <<'HOOK'
#!/bin/sh
# Installed by nemumi: mise run setup-git-hooks
set -eu

repo_root=$(git rev-parse --show-toplevel)
exec "$repo_root/.githooks/pre-push" "$@"
HOOK
    if cmp -s "$legacy_hook" "$hook_path"; then
      rm "$hook_path"
    else
      printf 'A pre-push hook already exists at %s; it was left unchanged.\n' "$hook_path" >&2
      exit 1
    fi
    rm "$legacy_hook"
    trap - EXIT
  fi
  pnpm exec lefthook install
fi
