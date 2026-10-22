#!/usr/bin/env bash
# Builds dist/PocketClipboard.exe: the agent bundled into one script and injected into the official Windows node.exe
# (Node single executable application). The blob must come from the same Node version as the node.exe.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_EXE="${POCKET_WIN_NODE:-$HOME/.cache/pocket-build/node.exe}"
OUT="$HERE/dist"
[[ -f "$NODE_EXE" ]] || { echo "Windows node.exe not found at $NODE_EXE" >&2; exit 1; }

rm -rf "$OUT" && mkdir -p "$OUT"
"$HERE/node_modules/.bin/esbuild" "$HERE/src/main.ts" --bundle --platform=node --format=cjs --target=node22 \
  --external:bufferutil --external:utf-8-validate --outfile="$OUT/agent.cjs" --log-level=warning
cat > "$OUT/sea-config.json" <<JSON
{ "main": "$OUT/agent.cjs", "output": "$OUT/sea-prep.blob", "disableExperimentalSEAWarning": true, "useSnapshot": false, "useCodeCache": false }
JSON
node --experimental-sea-config "$OUT/sea-config.json"
cp "$NODE_EXE" "$OUT/PocketClipboard.exe"
node "$HERE/scripts/strip-signature.mjs" "$OUT/PocketClipboard.exe"
"$HERE/node_modules/.bin/postject" "$OUT/PocketClipboard.exe" NODE_SEA_BLOB "$OUT/sea-prep.blob" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 >/dev/null
rm -f "$OUT/sea-prep.blob" "$OUT/sea-config.json"
ls -la "$OUT/PocketClipboard.exe"
