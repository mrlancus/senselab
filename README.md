# SenseLab

Turn a normal phone into a sensing toolkit. SenseLab is a mobile-first PWA that uses the
phone's own speaker, microphone, motion sensors, magnetometer and camera to measure things.
It starts with the liquid level of a bucket, in litres.

**Live:** https://senselab.lancus.workers.dev

## Architecture

```
apps/web         Vite + React + TypeScript PWA (manifest + Workbox service worker)
apps/api         Cloudflare Worker (Hono). Serves /api/* and hosts apps/web/dist as static assets
packages/dsp     Pure TypeScript signal processing + geometry. No browser APIs, fully unit-tested
packages/shared  Zod schemas, types and constants shared by web and api
docs/            One short note per sensing mode: the physics and the algorithm
```

- **One Worker, static assets.** `apps/api/wrangler.jsonc` points `assets.directory` at
  `apps/web/dist`. `run_worker_first: ["/api/*"]` sends only API calls to the Worker. Every
  other path is served from the asset store, with single-page-app fallback. That means one
  deploy, one origin, no CORS and no version skew between the UI and the API.
- **D1** (`senselab`) stores metadata: containers, calibration points, measurements and the
  recordings index. The schema lives in `apps/api/migrations/`.
- **R2** (`senselab-recordings`, private) stores opt-in debug recordings. Uploads stream
  through `POST /api/recordings`, so no presigned URLs and no R2 S3 credentials are needed.
  Downloads also go through the Worker, which checks ownership.
- **Identity.** No accounts yet. Each install creates a random UUID (in localStorage) and
  sends it as the `X-Device-Id` header. `apps/api/src/identity.ts` is the single seam for
  adding real auth later.
- **On-device by default.** All audio and video processing happens in the browser.
  Uploading happens only when you press "save recording" in a debug view.

## Develop

Requires Node 22+ and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm --filter @senselab/api migrate:local   # once: create the local D1 schema
pnpm --filter @senselab/api dev             # Worker + local D1/R2 on :8787
pnpm dev                                    # Vite on :5173, proxies /api to :8787
```

Microphone, camera and motion sensors need HTTPS on a phone. To test on a real device, use a
PR preview URL or production, or tunnel your dev server (for example
`cloudflared tunnel --url http://localhost:5173`).

Browser end-to-end checks with synthetic audio live in `scripts/e2e/` (see its README).

Checks (CI runs the same ones):

```sh
pnpm lint        # eslint + prettier --check
pnpm typecheck
pnpm test        # vitest in every package
pnpm coverage    # with coverage; packages/dsp enforces thresholds
pnpm build
```

## Deploy

- **Production:** every push to `main` runs `.github/workflows/deploy.yml`. It applies D1
  migrations, then runs `wrangler deploy`.
- **PR previews:** `.github/workflows/ci.yml` uploads a non-production version with
  `wrangler versions upload --preview-alias pr-<N>` and comments the URL on the PR.
  ⚠️ Previews share the production D1 database and R2 bucket. Migrations only run on `main`,
  so a PR that needs a schema change won't work fully until it merges.
- **Required repo secrets:** `CLOUDFLARE_API_TOKEN` (Workers Scripts edit, D1 edit, R2 edit)
  and `CLOUDFLARE_ACCOUNT_ID`.
- **Manual:** `pnpm deploy` (needs those two variables in your shell).

## Modes

| Mode                         | Status                                           | Notes                                            |
| ---------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| Sensor check                 | ready                                            | [docs/sensor-check.md](docs/sensor-check.md)     |
| Liquid level: calibrated tap | ready (synthetic-verified; awaits a real bucket) | [docs/tap-level.md](docs/tap-level.md)           |
| Liquid level: echo ranging   | ready (synthetic-verified; awaits a real bucket) | [docs/echo-level.md](docs/echo-level.md)         |
| Sonar ruler                  | ready (synthetic-verified)                       | [docs/ruler.md](docs/ruler.md)                   |
| Liquid level: camera         | ready (synthetic-verified; AR experimental)      | [docs/camera-level.md](docs/camera-level.md)     |
| Room acoustics (RT60)        | ready (synthetic-verified)                       | [docs/room-acoustics.md](docs/room-acoustics.md) |
| Knock ID + fruit firmness    | ready (synthetic-verified)                       | [docs/knock-id.md](docs/knock-id.md)             |
| Metal finder                 | ready (synthetic-verified)                       | [docs/metal-finder.md](docs/metal-finder.md)     |
| Sound alerts                 | ready (synthetic-verified)                       | [docs/sound-alerts.md](docs/sound-alerts.md)     |
| Presence                     | later                                            |                                                  |
