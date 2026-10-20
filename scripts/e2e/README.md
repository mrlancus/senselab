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

Echo ranging and the sonar ruler:

```sh
python3 scripts/e2e/gen-echo.py /tmp/echo
node scripts/e2e/echo-flow.mjs /tmp/echo   # reference, ruler, bucket: calibrate empty, measure
```

Expected: `RULER 60.9 cm`, `0 L → 29.2 cm`, `≈ 7.4 L | … | water ≈ 16.3 cm deep`. The fake
mic loops the file, so each file is a whole number of chirp periods. Chromium's fake device
also replays 10 ms chunks, so the debug plots show a ghost of the direct path at 441
samples (≈ 172 cm) and the repeat spread is larger than on a real phone.

`render-icons.mjs` (one level up) regenerates the PWA icons from `apps/web/public/icon.svg`.

Room acoustics (RT60):

```sh
python3 scripts/e2e/gen-room.py /tmp/room && node scripts/e2e/room-flow.mjs /tmp/room
```

Expected: `RT60 ≈ 0.60 s`, with every band within its "±" scatter.

Camera (dimensions and waterline):

```sh
python3 scripts/e2e/gen-photos.py /tmp/cam && node scripts/e2e/camera-flow.mjs /tmp/cam
```

Expected: no-reference `≈ 27.8 / 21.7 / 24.4 cm` (from the printed 11.8 L), card
`28.0 / 22.0 / 24.0 cm`, waterline `14.0 cm ≈ 6.2 L`. Needs Pillow and numpy.

Knock ID and fruit firmness:

```sh
python3 scripts/e2e/gen-knocks.py /tmp/knock && node scripts/e2e/knock-flow.mjs /tmp/knock
```

Expected: `IDENTIFY wood | 100%…`, `FRUIT S ≈ 4.06 | 160 ± 0 Hz · 2 kg`. Run
`pnpm migrate:local` in apps/api first (it adds the `examples` table).

Metal finder (synthetic orientation and motion events, no fixture needed):

```sh
node scripts/e2e/metal-flow.mjs /tmp/out
```

Expected: `AT 5.5 s Nothing`, `AT 7 s Metal!`, `AT 9.5 s Nothing`.

Sound alerts:

```sh
python3 scripts/e2e/gen-alerts.py /tmp/al && python3 scripts/e2e/gen-knocks.py /tmp/al
node scripts/e2e/alerts-flow.mjs /tmp/al
```

Expected: smoke file → `Smoke / fire alarm`, doorbell file → `doorbell`, knocks → `null`, and
`mic: false` after every Stop.

Presence (needs numpy):

```sh
python3 scripts/e2e/gen-presence.py /tmp/pr && node scripts/e2e/presence-flow.mjs /tmp/pr
```

Expected after ~25 s: `Someone still`, `Breathing: ≈ 15 per minute | at ≈ 60 cm`.

Air temperature (needs numpy):

```sh
python3 scripts/e2e/gen-echo.py /tmp/t && python3 scripts/e2e/gen-temperature.py /tmp/t
node scripts/e2e/temperature-flow.mjs /tmp/t
```

Expected: `cards with Ping: 2`, `TEMP 30.0 °C`.
