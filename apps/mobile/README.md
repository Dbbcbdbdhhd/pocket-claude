# Pocket Claude (Android)

Expo SDK 58 / React Native 0.88 (Hermes, New Architecture), expo-router. State and protocol come from `@pocket/client-core`.

## Run

```sh
pnpm install                       # from the repo root
cd apps/mobile
npx expo start                     # dev server; scan with a dev build
npx expo run:android               # local dev build on a connected device/emulator (needs Android SDK)
```

`expo-camera`, `expo-secure-store` and `expo-local-authentication` need native code, so use a dev build; Expo Go is not supported for this app.

EAS alternative:

```sh
npx eas-cli build --profile development --platform android
```

## Pairing

On the Mac run `pocket-claude pair`, then scan the QR code in the app, or paste the `pocketclaude://pair?code=…&relay=…` link. Tapping that link on the phone opens the app directly. Confirm the safety number shown by the app against the one on the Mac.

## Checks

```sh
npx tsc --noEmit -p .
npx expo export --platform android
```
