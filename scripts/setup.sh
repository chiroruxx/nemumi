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
