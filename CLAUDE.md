# SenseLab: conventions for future sessions

SenseLab is a mobile-first PWA that measures things with a phone's built-in sensors. Read
`README.md` for architecture and deploy, and `docs/` for per-mode physics and algorithms.

## Layout

- `apps/web`: Vite + React 19 + TS PWA. A tiny custom router lives in `src/lib/router.tsx`,
  with no router library. Screens go in `src/screens/`, shared UI in `src/components/`, and
  browser and sensor glue in `src/lib/`. The mode registry is `src/modes.ts`.
- `apps/api`: a Hono Worker. It also serves `apps/web/dist` as static assets
  (`wrangler.jsonc`). Routes go in `src/routes/`. All SQL lives in `src/db.ts` (`Repo`), and
  every query is scoped by owner.
- `packages/dsp`: pure TS with **no DOM or Web Audio types** (`tsconfig` has `types: []`).
  It takes `Float32Array`/`Float64Array` plus a sample rate and returns plain objects.
  Anything that touches `AudioContext`, `getUserMedia` or the DOM belongs in `apps/web`.
- `packages/shared`: Zod schemas and types for API payloads. The web app imports types and
  constants. Keep it `sideEffects: false` so Zod isn't bundled into the client.

## Commands

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm build`. Run all of them
before pushing; CI runs the same. Use `pnpm format` to fix prettier issues.

## Conventions

- TypeScript strict (`noUncheckedIndexedAccess` is off: DSP is index-heavy and every consumer
  compiles the DSP sources, so the setting must match repo-wide). Packages are consumed as source
  (`exports` → `src/index.ts`), so there's no build step for packages.
- Use TS ~6.0 (typescript-eslint doesn't support TS 7 yet), Vitest 5 and Vite 8.
- DSP tests use synthetic signals with known answers (chirps at known delays, decaying
  sinusoids at known frequencies, added seeded noise). Never use `Math.random` in tests;
  use the seeded RNG in `packages/dsp`.
- API tests run against a fake D1 (in-memory `node:sqlite` with the real migrations
  applied) and a Map-backed R2 (`apps/api/test/fakes.ts`).
- Schema changes go in a new file `apps/api/migrations/NNNN_name.sql`. Never edit an
  applied migration.
- Every sensing mode gets:
  1. a doc in `docs/<mode>.md` (physics, algorithm, known failure modes)
  2. a debug view (raw waveform, spectrogram, correlation or peaks, plus the numbers behind
     the estimate) with "save recording + labels to R2"
  3. a short animated how-to (inline SVG/CSS in `src/components/howto/`) for each step that
     asks the user to do something physical. Animations must respect
     `prefers-reduced-motion`.
- Feature-detect every sensor and show a clear "not supported on this device" state.
  iOS Safari has no WebXR and no magnetometer, and needs `DeviceMotionEvent.requestPermission()`
  (and `DeviceOrientationEvent.requestPermission()`) from a tap. Android Chrome only exposes
  `Magnetometer` behind a flag, so the metal finder falls back to compass − gyro.
- Request the mic with echoCancellation, noiseSuppression and autoGainControl all set to
  false, and always read back the real `AudioContext.sampleRate`.
- When a method proves unreliable on real devices, say so in its doc and in the UI.
  Don't hide it.

## Workflow

- One PR per step, with small commits. The default branch is `main`, and merging to `main`
  deploys to production.
- Ask the owner before anything that costs money, deletes data, or changes Cloudflare or
  GitHub settings.
- Cloudflare resources:
  - Worker `senselab` (https://senselab.lancus.workers.dev)
  - D1 `senselab` (`ea3ff26b-35f3-42cf-9305-dffa1e6a48ee`)
  - R2 `senselab-recordings`
    The account has other unrelated D1 databases and R2 buckets. Never touch them.

## Browser audio plumbing

- `apps/web/src/audio/engine.ts`: a singleton `audio` that owns the AudioContext, the raw
  mic stream and an AudioWorklet recorder. **The mic is only open while leased:** wrap a
  measurement in `await audio.withMic(async (info) => …)` (from a tap), or hold
  `audio.acquire()` for open-ended use (a live meter, an armed alert) and `release()` it on
  stop and on unmount. When the last lease goes, the tracks stop (no "mic in use"
  indicator) and the context suspends. Inside a lease use `audio.record(s)`,
  `audio.playAndRecord(samples)` and `audio.onChunk(cb)`. E2E scripts check
  `__senselabAudio.running === false` after each flow.
- `apps/web/src/workers/`: the DSP Web Worker. Add a function to `dsp-handlers.ts`, then
  call it with `await runDsp('name', ...args)`.
- Debug views: wrap them in `useDebug()` (`lib/debug.ts`), and offer `<SaveRecording>`
  for fixtures.
- Headless check: `wrangler dev` in apps/api serves the built web app. Playwright with
  `--use-fake-device-for-media-stream` exercises the flows (the fake mic only beeps).
  Add `--use-file-for-fake-audio-capture=x.wav` to feed synthetic recordings; see
  `scripts/e2e/`.
- Echo: `components/EchoCapture.tsx` owns the free-air reference flow, the ping and the
  debug view; `lib/echo.ts` keeps the per-device band, reference and air temperature.
  Keep `ECHO_WINDOW_CM` fixed, because stored references must match the window length.
- Camera: `components/PhotoTapper.tsx` collects taps in photo pixels (fine-adjust drag plus
  magnifier); the geometry is in `packages/dsp/src/camera.ts`.
- Learned modes store labelled examples via `/api/examples?mode=…` (`knock`, `alert`,
  `fruit`; JSON payload ≤ 64 KB). `components/ImpactRecorder.tsx` records a few knocks/taps
  with a live counter (and optional motion).
- Data loading: `useAsync(fn, key)` (`lib/useAsync.ts`). Routes go in the `screens` list in
  `App.tsx`; the first match wins. Screens are lazy-loaded (`named(() => import(...), 'Name')`)
  so each mode is its own chunk; add new screens the same way.

## Status

- [x] Step 1: scaffold, CI, Worker + D1 + R2, hello deploy
- [x] Step 2: sensor check screen + `packages/dsp` core
- [x] Step 3: calibrated tap liquid level (synthetic-verified; awaiting a real-bucket test)
- [x] Step 4: echo ranging + sonar ruler (synthetic-verified; awaiting a real-bucket test)
- [x] Step 5: camera dimensions + waterline (synthetic-verified; WebXR AR untested on devices)
- [x] Room acoustics RT60 (synthetic-verified)
- [x] Knock ID + fruit firmness (synthetic-verified); examples in D1 `examples` (0002)
- [x] Metal finder: Magnetometer |B| or compass − gyro (synthetic-verified)
- [x] Sound alerts: smoke T3 / CO T4 + taught fingerprints (synthetic-verified)
- [x] Presence: sonar motion + breathing rate (synthetic-verified)
- [x] Air temperature (experimental): echo baseline → speed of sound → °C
