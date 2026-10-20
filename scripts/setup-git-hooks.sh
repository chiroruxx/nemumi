#!/bin/sh
set -eu

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
hooks_dir=$(git rev-parse --path-format=absolute --git-path hooks)
mkdir -p "$hooks_dir"
hook_path="$hooks_dir/pre-push"
marker='# Installed by nemumi: mise run setup-git-hooks'

if [ -e "$hook_path" ]; then
  if grep -Fq "$marker" "$hook_path"; then
    echo "Repository pre-push hook is already installed."
    exit 0
  fi
  echo "A pre-push hook already exists at $hook_path; it was left unchanged." >&2
  exit 1
fi

temporary_hook=$(mktemp "$hooks_dir/pre-push.XXXXXX")
trap 'rm -f "$temporary_hook"' EXIT HUP INT TERM
cat > "$temporary_hook" <<'HOOK'
#!/bin/sh
# Installed by nemumi: mise run setup-git-hooks
set -eu

repo_root=$(git rev-parse --show-toplevel)
exec "$repo_root/.githooks/pre-push" "$@"
HOOK
chmod +x "$temporary_hook"
mv "$temporary_hook" "$hook_path"
trap - EXIT HUP INT TERM
echo "Installed repository pre-push hook."
