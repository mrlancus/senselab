# Liquid level: echo ranging

## Physics

The phone is held upright over the open bucket with its bottom edge (speaker and mic)
pointing down. It plays a short chirp; the water surface reflects it. The time between
the sound arriving **directly** (speaker → mic, through air and the phone body) and the
**echo** gives the distance:

    d = Δt · c / 2,     c = 331.3 · √(1 + T/273.15) m/s   (343.2 m/s at 20 °C)

Using the direct path as time zero means the phone's output and input latency (tens to
hundreds of ms, different on every phone) cancel out. A 10 °C temperature error changes c by
1.7%, which is 0.4 cm at 25 cm. The air temperature is a setting on the echo screen.

## Algorithm (`packages/dsp/src/echo.ts`)

1. **Chirp train:** 12 linear chirps, 8 ms each, every 100 ms, in the band the sensor
   check picked (near-ultrasonic, e.g. 17–21 kHz, or audible 2–8 kHz as a fallback).
   Cosine fades of 2 ms at each end stop clicks. Playback is scheduled on the
   AudioContext clock and the recording is stamped with context frames, so the
   repeats line up to the sample.
2. **Matched filter:** cross-correlate with a Hann-weighted copy of the chirp. This
   "mismatched" filter drops the range sidelobes from about −15 dB to below −30 dB, at the
   cost of a 1.6× wider main lobe (resolution ≈ 1.6 · c / 2B: ≈ 7 cm for a 4 kHz band,
   ≈ 4.6 cm for 6 kHz).
3. **Coherent average:** the first repeat's direct path is the earliest envelope peak
   ≥ 50% of the strongest after playback. The 12 windows that follow it are averaged,
   giving 11 dB more SNR. Every repeat is kept, so their spread can be measured.
4. **Free-air reference:** once per phone and band, the same measurement is made with
   the phone held up in open air. That response (direct path, speaker ringing,
   reflections off the phone body) is the pulse shape used next. Without it a model of a
   lone direct path is used, and the first `3 cm + 2 main lobes` (≈ 17 cm ultrasonic,
   ≈ 12 cm audible) are blanked, because the model can't match the unknown ringing.
5. **CLEAN + RELAX:** repeatedly take the strongest envelope peak, fit the pulse shape
   there (complex least squares, so a phase flip on reflection is fine) and subtract it,
   until what's left is within 12 dB of the noise floor. Then re-locate each component
   with all the others removed (3 passes). This separates the direct path from an echo
   whose main lobes overlap. The component nearest the direct-path position is time zero.
6. **Echo choice:** the strongest component in [min, max] distance that is ≥ 12 dB over
   the median floor of the residual. Noise envelope peaks exceed the median by 12 dB in
   about 1 in 10⁵ samples. A runner-up within 3 dB is reported as ambiguous.
7. **Spread:** in each repeat, remove the other components and re-locate the echo. The
   standard error of those positions is `spreadCm`.
8. **Confidence:** `clamp((SNR − 12)/14) · exp(−spread/0.5 cm)`, × 0.5 if the runner-up
   is within 3 dB (× 0.8 within 6 dB), × 0.85 without a reference.

## Distance → litres (`packages/dsp/src/echo-level.ts`)

- **With dimensions:** depth = H − (raw + offset); litres from the frustum.
  - `offset` absorbs how high the phone is held above the rim, plus half the speaker–mic
    spacing (the path is 2·√(d² + (s/2)²) − s ≈ 2d − s).
  - **Calibrated:** each echo calibration point at a known fill (the empty bucket is
    easiest: it measures the bottom) gives `H − level(litres) − raw`; we take the median.
    Its robust spread (≥ 0.2 cm) becomes the offset σ.
  - **Uncalibrated:** offset 1 cm (phone at rim level, ~2 cm speaker–mic spacing) with a σ
    of 1.5 cm, and confidence × 0.6. The UI says so and offers calibration.
- **Without dimensions:** ≥ 2 calibration points; PCHIP of litres against raw distance.
- **±L** = area(h)/1000 · (spread + 0.1 cm + offset σ). For the 28/22/24 cm bucket at
  half full that is ≈ 0.5 L per cm.

## How to hold the phone (animated in the app)

- **Reference (once):** arm's length, bottom edge pointing at open space, nothing within a
  metre.
- **Measure:** upright, centred over the bucket, bottom edge level with the rim, pointing
  straight down. Hold it the same way for calibration and measurement; resting the wrist
  on the rim helps.

## Verified

- **Unit tests** (`packages/dsp/test/echo.test.ts`, `echo-level.test.ts`): a simulated
  phone with speaker ringing, latency (including > one chirp period), noise, and
  reflections at known distances.
  - 8–60 cm within 2 mm (3 mm at 8 cm, close to the resolution limit), with a reference.
  - 30 cm within 3 mm without a reference.
  - With phone-body reflections at 2–5 cm, a weak echo at 9 cm is found only with the
    reference.
  - No echo → nothing reported, with or without a reference.
  - Two similar echoes → flagged ambiguous, and `expectRawCm` picks the right one.
- **Browser E2E** (`scripts/e2e/echo-flow.mjs`): looping synthetic recordings through
  Chromium's fake mic. The free-air reference is recorded, the empty 28/22/24 cm bucket
  calibrates at raw 29.2 cm, and a 33-sample echo then reads **≈ 7.4 L, water 16.3 cm**,
  exactly as computed by hand.

## Not yet verified, and the risks

**Real buckets and real phones have not been tested.** What may go wrong, most likely
first:

- **Hand-held height** varies by ~1 cm between readings, about 0.5 L in a typical
  bucket. Calibrating at the same holding position cancels the average, not the wobble.
- **The bucket is a cavity:** walls and the rim reflect too. A narrow, deep bucket may
  return a wall echo as strong as the water's, which is flagged as ambiguous. The debug
  view lists every candidate.
- **Close range:** with water within ~7 cm of the phone (a full bucket held at the rim),
  the echo merges with the direct path. Hold the phone higher, and calibrate there.
- **Phones whose speaker and mic are on different edges** (some have the earpiece
  speaker on top) hear a weaker direct path and a different geometry. The sensor check's
  SNR shows whether the bottom speaker is used.
- **Near-ultrasonic support** varies. Some phones roll off above 16 kHz, so echo falls
  back to audible clicks (and coarser resolution).
- If echo proves unreliable for a container, tap pitch (Step 3) is the cross-check, and
  the camera (Step 5) is next.

## Debug view

`?debug=1` shows:

- the recording, with play and direct-path markers
- the averaged matched-filter envelope against distance, raw and after removing the
  direct path, with min/max and candidate markers
- the candidate table (raw cm, level, SNR)
- the numbers: c, samples/cm, offset, spread, floor, runner-up, repeats, confidence
- "Save recording to cloud", with the band, `emitIndex` and raw distance as labels
