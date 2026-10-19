# Architecture

```
phone browser ──HTTPS──▶ Worker "senselab"
                           ├─ /api/*  → Hono app (apps/api) ─┬─ D1 "senselab"  (metadata)
                           │                                 └─ R2 "senselab-recordings" (opt-in blobs)
                           └─ /*      → static assets (apps/web/dist, SPA fallback)
```

## Data flow for a measurement

1. The browser captures sensor data (mic via `getUserMedia`, motion via `DeviceMotionEvent`,
   camera via `getUserMedia` or WebXR).
2. `packages/dsp` turns the raw samples into a feature, such as a resonant frequency in Hz
   or a distance in cm. This runs on the device, in a Web Worker for heavy work.
3. The feature plus the container's calibration (or geometry) gives an estimate in litres,
   with a confidence value.
4. The app saves the result to D1 through the API. The raw recording is uploaded only if
   the user chooses to.

## Tables

`containers`, `calibration_points`, `measurements` and `recordings`. Each row is owned by a
device ID: directly on `containers` and `recordings`, and through `containers` on the other
two. See `apps/api/migrations/`.
