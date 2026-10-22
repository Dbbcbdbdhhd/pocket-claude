#!/usr/bin/env bash
set -euo pipefail

for LABEL in com.pocketclaude.brain com.pocketclaude.relay com.pocketclaude.awake; do
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
done

cat <<EOF
Removed the Pocket Claude LaunchAgents.

Kept data and identity. To remove them completely:
  security delete-generic-password -s pocket-claude -a brain-identity
  rm -rf ~/.pocket-claude
EOF
