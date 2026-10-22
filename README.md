# Pocket Claude

Claude Code running on a Mac, driven from an Android phone through a chat that lives inside an app styled like a social network. Paired Windows computers lend their workspace (VS Code extension) or just their clipboard (PocketClipboard) to the same chat.

Everything between devices is end-to-end encrypted; the relay only sees ciphertext.

## Parts

| Path | What it is |
|---|---|
| `apps/brain` | Mac daemon: runs Claude Code (Agent SDK), owns sessions, permissions and paired devices. CLI `pocket-claude pair \| relay \| status`. |
| `apps/relay` | Relay: Cloudflare Worker (`worker.ts`) or Node server (`node-server.ts`) on the same core. Routing, offline queues, pairing. |
| `apps/mobile` | Expo / React Native app (Android). The chat is in Direct. |
| `apps/executor-extension` | VS Code extension: executes tool calls in the open workspace, has a chat panel. |
| `apps/clipboard-agent` | `PocketClipboard.exe` for Windows: shares the clipboard with the phone and shows AI replies in an overlay window (double-tap Alt). |
| `packages/protocol` | Crypto, envelopes, message schemas, pairing. |
| `packages/transport` | `DeviceLink` (authenticated, encrypted WebSocket link) and `joinAccount` (pairing). |
| `packages/client-core` | Chat state and formatting shared by the phone, the VS Code panel and the overlay. |

## Development

```sh
pnpm install
pnpm test          # vitest, all packages
pnpm typecheck     # tsc, all packages
pnpm tsx tools/scripts/dev-stack.ts   # local relay + brain + fake executor, prints a pairing link
```

The phone app: see `apps/mobile/README.md`.

## Install

- Mac: `apps/brain/install/install.sh` sets up LaunchAgents for the relay, the brain and a sleep blocker.
- Windows: `tools/scripts/make-usb.sh` builds a folder with `PocketClipboard.exe` and the VS Code extension.

## Roadmap

See `PLAN.md` (in Russian): Windows overlay, multiple users, Telegram bot, Mini App, iPhone.
