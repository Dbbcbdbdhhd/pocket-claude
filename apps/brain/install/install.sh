#!/usr/bin/env bash
# Installs Pocket Claude on this Mac as LaunchAgents that start at login and restart on crash:
#   com.pocketclaude.relay  local relay on 127.0.0.1:<port> (skip with --no-relay to use a remote relay)
#   com.pocketclaude.brain  the daemon running Claude Code
#   com.pocketclaude.awake  keeps the Mac from sleeping while on power (skip with --no-awake)
#
#   install.sh [--public-url https://host:10000] [--relay-port 8797] [--relay-url URL] [--no-relay] [--no-awake]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_DIR="$(cd "$HERE/.." && pwd)"
REPO_DIR="$(cd "$BRAIN_DIR/../.." && pwd)"
BIN="$BRAIN_DIR/bin/pocket-claude.mjs"
RELAY_BIN="$REPO_DIR/apps/relay/bin/relay.mjs"
AGENTS="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/pocket-claude"

RELAY_PORT=8797
PUBLIC_URL=""
REMOTE_RELAY=""
WITH_RELAY=1
WITH_AWAKE=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --public-url) PUBLIC_URL="$2"; shift 2 ;;
    --relay-port) RELAY_PORT="$2"; shift 2 ;;
    --relay-url) REMOTE_RELAY="$2"; WITH_RELAY=0; shift 2 ;;
    --no-relay) WITH_RELAY=0; shift ;;
    --no-awake) WITH_AWAKE=0; shift ;;
    *) echo "Unknown option $1" >&2; exit 1 ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "install.sh supports macOS only." >&2
  exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code CLI not found on PATH. Install it and run 'claude' once to log in, then re-run this script." >&2
  exit 1
fi
NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  echo "Node.js not found on PATH." >&2
  exit 1
fi

esc() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/[|\\]/\\&/g'
}

render() {
  sed \
    -e "s|__NODE__|$(esc "$NODE")|g" \
    -e "s|__BIN__|$(esc "$BIN")|g" \
    -e "s|__RELAYBIN__|$(esc "$RELAY_BIN")|g" \
    -e "s|__RELAYPORT__|$(esc "$RELAY_PORT")|g" \
    -e "s|__PATH__|$(esc "$PATH")|g" \
    -e "s|__HOME__|$(esc "$HOME")|g" \
    -e "s|__LOGDIR__|$(esc "$LOG_DIR")|g" \
    -e "s|__RELAYENV__|$RELAY_ENV|g" \
    "$HERE/$1.plist.template" > "$AGENTS/$1.plist"
}

load() {
  launchctl bootout "gui/$(id -u)/$1" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$1.plist"
}

mkdir -p "$LOG_DIR" "$AGENTS"

RELAY_ENV=""
if [[ "$WITH_RELAY" -eq 1 ]]; then
  RELAY_ENV="<key>POCKET_RELAY_URL</key><string>http://127.0.0.1:$RELAY_PORT</string>"
  render com.pocketclaude.relay
  load com.pocketclaude.relay
  for _ in $(seq 1 20); do
    if curl -s -o /dev/null "http://127.0.0.1:$RELAY_PORT/"; then break; fi
    sleep 0.5
  done
elif [[ -n "$REMOTE_RELAY" ]]; then
  RELAY_ENV="<key>POCKET_RELAY_URL</key><string>$(esc "$REMOTE_RELAY")</string>"
fi

render com.pocketclaude.brain
load com.pocketclaude.brain

if [[ "$WITH_AWAKE" -eq 1 ]]; then
  render com.pocketclaude.awake
  load com.pocketclaude.awake
fi

ready=0
for _ in $(seq 1 30); do
  if node "$BIN" status >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.5
done
if [[ "$ready" -ne 1 ]]; then
  echo "Daemon did not respond within 15s. Check $LOG_DIR/daemon.err.log" >&2
  exit 1
fi

if [[ -n "$PUBLIC_URL" ]]; then
  node "$BIN" relay "$PUBLIC_URL"
fi

node "$BIN" status
cat <<EOF

Installed LaunchAgents (start at login, restart on crash): $( [[ "$WITH_RELAY" -eq 1 ]] && echo "relay, " )brain$( [[ "$WITH_AWAKE" -eq 1 ]] && echo ", awake" ).
Logs: $LOG_DIR

Next steps:
  Pair a phone:     node "$BIN" pair
  Add a computer:   phone → chat → ☎ → Add a computer (or the code from 'pair')
EOF
