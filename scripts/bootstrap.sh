#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Add credentials locally; do not commit it."
fi

npm install
npm run build
printf '\nNext: open Claude Code in this repository and use docs/CLAUDE_HANDOFF_PROMPT.md\n'
