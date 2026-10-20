# Metal finder

## Physics

Ferromagnetic materials (iron, steel: screws, nails, pipes, rebar, steel studs) concentrate
the Earth's field (25–65 µT) and bend it near them. A phone's 3-axis magnetometer sees a
change of a few µT to hundreds of µT within a few cm. **Non-ferrous metals (aluminium,
copper, brass, gold) are invisible** to a static magnetometer, and the app says so up front.

## Two methods (`packages/dsp/src/metal.ts`)

1. **Field magnitude** (when the browser exposes `Magnetometer`): |B| − |B₀| in µT. The
   magnitude doesn't change when the phone rotates, so it's the clean signal. B₀ and its
   noise come from 4 s of readings away from metal.
   - **Availability:** Chrome on Android only behind
     `chrome://flags/#enable-generic-sensor-extra-classes` (Chrome's Generic Sensor docs
     still list the Magnetometer behind that flag). iOS never exposes it.
2. **Compass − gyro** (the default everywhere else, **including iPhone**): the absolute
   compass heading changes when the phone turns _and_ when steel bends the field, but the
   gyroscope only sees real turns. Anomaly = Δheading − k·∫yaw rate.
   - **Calibration (4 s, away from metal, turning gently):** least-squares fit of
     heading = k·∫rate + c, for each of the three `rotationRate` fields. Browsers disagree
     on which is the screen normal, and on its sign, so the best-fitting axis wins. If the
     phone barely turned (< 20°), k = 1 is assumed.
   - **Heading:** `webkitCompassHeading` on iOS, else `deviceorientationabsolute` (360 − α).
   - **Live:** a sliding 12 s window since the last **Re-zero**. Gyro drift (≲ 1°/min) is
     negligible over a sweep.
   - **Detection:** ≥ 4σ of the calibration residual. The meter runs from 1σ to 10σ.

## Honest limits

- The compass method is **weaker and slower** than the raw field. Phones fuse the compass
  with the gyro (rotation-vector sensor), so a magnetic disturbance appears only partly, and
  with some lag. Sweep slowly.
- Hold the phone **flat** for the compass method; a near-vertical phone makes the heading
  ill-defined. For walls, the raw-field method (Android flag) works in any orientation.
- The sensor sits somewhere near the top of most phones. Find the hot spot with a known
  screw first.
- Speakers, magnets in cases and laptops are magnetic too.

## Verified

- **Unit tests** (`metal.test.ts`):
  - unwrap and integrate
  - gain and sign fitted for both sign conventions
  - k = 1 fallback when the phone barely turned
  - a 15° steel deflection found within 3° while the phone is also turning ±30° (the raw
    heading alone can't tell)
  - field baseline and µT detection
- **Browser E2E** (`scripts/e2e/metal-flow.mjs`): synthetic orientation and motion events at
  60 Hz. "Nothing" while turning, **"Metal!" (+14.6°)** over the simulated steel, "Nothing"
  after.
- **Not tested on a real phone yet.**

## Debug view

Calibration (axis, k, noise, turned°), the live reading in σ, the trace, and "Save trace
to cloud" (JSON).
