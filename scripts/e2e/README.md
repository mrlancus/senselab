# Browser end-to-end checks

These drive the real app in headless Chromium. They're not in CI yet, because CI has no
Chromium-with-audio setup. Chromium's `--use-file-for-fake-audio-capture` feeds a WAV file
as the microphone, so the whole browser path runs: getUserMedia → AudioWorklet → onset
detection → DSP worker → API → D1.

```sh
pnpm build && (cd apps/api && pnpm migrate:local && pnpm dev) &   # serves on :8787
python3 scripts/e2e/gen-taps.py /tmp/taps
node scripts/e2e/tap-flow.mjs /tmp/taps   # creates a bucket, calibrates 0/5/10 L, measures 7.5 L
```

Expected output: `≈ 7.5 L | ± 0.1 L | … | high confidence`.

`render-icons.mjs` (one level up) regenerates the PWA icons from `apps/web/public/icon.svg`.
