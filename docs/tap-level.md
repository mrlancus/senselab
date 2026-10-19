# Liquid level: calibrated tap

## Physics

Tapping a container excites its wall vibration modes. Liquid touching the wall moves with
it, which adds mass to the vibrating system but hardly any stiffness. So each mode's
frequency **drops** as the container fills. For an ideal wine glass, A. P. French ("In vino
veritas", Am. J. Phys. 51, 1983) gives

    (f₀ / f)² = 1 + α·(h/H)⁴

Buckets are not ideal shells: they have thick rims, ribs, handles, and are partly
supported by the floor. So we don't predict pitch from geometry. Each container is
**calibrated** with known fills, and we fit a curve with the same shape:

    (f₀ / f)² − 1 = α · Vᵏ        (V in litres; f₀ = empty pitch)

- **Empty + two or more fills:** least squares on `log((f₀/f)² − 1) = log α + k·log V`.
  Three points (empty, half, full) determine it exactly. We require k ∈ (0.3, 8).
- **Empty + one fill:** we assume k = 1 (added mass proportional to volume).
- **No empty point, or the pitch rose with fill:** monotone cubic (PCHIP) interpolation
  through the points, so there's no overshoot.

## Algorithm

1. **Record** for up to 8 s, stopping early after 5 taps. Live onset detection counts
   taps for the UI.
2. **Onsets:** 256-sample frames with hop 128.
   - A frame must be ≥ 15 dB above the median frame energy (background) and ≥ 9 dB above
     the frame 3 hops earlier (a sharp rise).
   - Taps must be ≥ 120 ms apart, so a tap's ringing tail is never counted as a new tap.
   - The onset is refined to the first sample above max(20% of the local peak, 4× noise).
3. **Pitch per tap:**
   - Skip 3 ms (the broadband impact click), take 120 ms, apply a Hann window, zero-pad 8×,
     and take the magnitude spectrum in dB.
   - The strongest prominent peak in the search band wins, refined with a parabola through
     the top three dB bins (sub-bin accuracy). On synthetic decaying sinusoids this is
     within 0.5 Hz.
   - The search band is 80–6000 Hz before calibration. Afterwards it is
     `[0.7·f_min, 1.3·f_max]` of the calibration pitches, which stops the estimator
     jumping to a different mode.
4. **Combine taps:** take the median, drop taps more than max(3%, 3·MAD) away (a different
   mode or a mis-hit), and report the robust spread.
5. **Litres:** apply the fitted curve, clamped to [0, capacity]. Capacity comes from the
   frustum dimensions if known, otherwise 1.25× the largest calibrated fill.
6. **Uncertainty:** `±L = |dV/df| · spread + calibration residual`.
7. **Confidence** (0–1, heuristic):
   - `exp(−spread/f / 1%)`
   - × 0.8 for two taps, or 0.55 for one
   - × 0.6 outside the calibrated pitch range
   - × an SNR factor (10 → 30 dB maps to 0.3 → 1)
   - × 0.6 if most taps were rejected

## How to tap (shown in the app as an animation)

- Use a pen or spoon on the **same spot** each time, about a hand's width below the rim.
- Keep the phone about 20 cm away, and leave about a second between taps.
- Keep the bucket on the same surface for calibration and measurement. The floor damps
  the base and changes the modes.

## Verified

- **Unit tests** (`packages/dsp/test/tap.test.ts`):
  - A synthetic bucket (f₀ = 820 Hz, α = 0.012, k = 1.6) with an impact click, a second
    mode at 2.7× and noise.
  - Calibrated from recordings at 0/5/10 L, it measures 7.5 L within 0.3 L.
  - The fit recovers α and k exactly from clean points.
- **Browser E2E** (`scripts/e2e/tap-flow.mjs`): the same synthetic bucket fed through
  Chromium's fake mic gives `≈ 7.5 L ± 0.1 L, high confidence`.

## Not yet verified, and the risks

**Real buckets have not been tested yet.** Things that may go wrong:

- **Heavily damped plastic buckets** may "thud" instead of ring: a low Q, a broad peak, a
  large spread. The UI then reports "no clear ringing pitch" or low confidence. The fix is
  a harder tapper (a metal spoon) or a stiffer spot (near the rim).
- **Mode hopping:** a different tap spot excites a different mode. The narrowed search band
  and the median/outlier rejection help. The debug view lists every peak per tap so we can
  see it happen.
- **Small pitch change:** if a container's pitch changes less than ~2% from empty to full,
  calibration is refused ("same pitch").
- If tap proves unreliable for a container, **echo ranging** (Step 4) is the next-best
  method for open buckets.

## Debug view

`?debug=1` (or five taps on the footer) shows:

- the recording with numbered onsets
- each tap's in-band spectrum with the chosen peak
- a table of time, f, SNR, Q and the other peaks
- "Save recording to cloud". Labels include the container, the purpose (calibrate or
  measure), the known litres and the measured pitch, and the saved key is attached to the
  calibration point or measurement.
