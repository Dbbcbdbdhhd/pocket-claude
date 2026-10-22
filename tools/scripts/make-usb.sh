#!/usr/bin/env bash
# Lays out a folder to copy onto a USB stick:
#   dist/usb/PocketClipboard.exe          double-click on Windows: installs, pairs, starts with Windows
#   dist/usb/vscode/                      optional VS Code extension for letting Claude work on that PC
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXT="$ROOT/apps/executor-extension"
OUT="$ROOT/dist/usb"

bash "$ROOT/apps/clipboard-agent/scripts/build-exe.sh" >/dev/null
(cd "$EXT" && pnpm -s build && pnpm -s package --out "$EXT/pocket-claude-executor.vsix" >/dev/null)
rm -rf "$OUT"
mkdir -p "$OUT/vscode"
cp "$ROOT/apps/clipboard-agent/dist/PocketClipboard.exe" "$OUT/"
cp "$EXT/pocket-claude-executor.vsix" "$ROOT/tools/usb/install.cmd" "$OUT/vscode/"
echo "USB folder ready: $OUT"
ls -laR "$OUT"
