# Room acoustics: RT60 from a clap

## Physics

After an impulse, sound energy in a room decays roughly exponentially as it is absorbed at
each reflection. **RT60** is the time for a 60 dB fall. Sabine's formula, RT60 = 0.161·V/A
(V in m³, A = absorption area in m²), is why big hard rooms ring and small soft ones don't.
Typical values: car < 0.2 s, furnished living room 0.4–0.6 s, bathroom or empty room ~1 s,
church 2–6 s.

## Algorithm (`packages/dsp/src/rt60.ts`, after ISO 3382)

1. **Record 4 s**, find the strongest onset (energy ≥ 20 dB over the median), and start
   2 ms before it.
2. **Noise:** mean square of the recording before the clap (≥ 0.2 s of it), else the last
   10% of the decay. Done per band, after the same filtering.
3. **Octave bands** 250 Hz–8 kHz: two cascaded RBJ band-pass biquads with Q = √2. Their own
   ringing (≈ Q/πf, 1.8 ms at 250 Hz) is negligible.
4. **Truncation (after Lundeby 1995, simplified):** fit a line to 10 ms block energies from
   the peak down to noise + 10 dB, and stop integrating where it reaches the noise level.
5. **Schroeder backward integral** of (energy − noise) up to that point, plus the tail the
   fitted slope predicts beyond it (`N·τ`, τ = 10·log₁₀e / |slope|).
6. **Fits** on the decay curve: EDT (0 to −10 dB), T20 (−5 to −25 dB), T30 (−5 to −35 dB).
   RT60 = −60 dB / slope. T20 needs ≥ 35 dB of range above the noise, T30 ≥ 45 dB;
   otherwise it is reported as missing, never extrapolated.
7. **Headline:** the median of the 500 Hz–2 kHz bands' T20 (else T30, else EDT), then the
   median over up to 5 claps.
8. **Scatter:** the decay after one impulse is itself random. The expected relative 1σ is
   ≈ 1/√(B·T), with B = 0.71·fc (one octave): ≈ 10% at 250 Hz and 2–3% at 4 kHz for
   T = 0.6 s. That is shown as "±" per band. Several claps reduce it by √n.

## Verified

- **Unit tests** (`packages/dsp/test/rt60.test.ts`):
  - Synthetic exponential decays at 0.3, 0.8 and 1.6 s: T20 and T30 within 5%, EDT within 10%.
  - With the noise floor only 50 dB down, noise compensation keeps T30 within 8%.
  - With only 30 dB of range, T20 and T30 are refused.
  - Every band is within 2.5× its stated scatter.
  - The band-pass has unity gain at its centre.
- **Browser E2E** (`scripts/e2e/room-flow.mjs`): a synthetic 0.6 s room through the fake
  mic reads **RT60 ≈ 0.60 s** (3 claps: 0.60, 0.58, 0.60). All bands fall within their scatter.

## Not yet verified, and the risks

- **Real rooms and phones have not been tested.**
- A clap has little energy below 500 Hz and phone mics roll off there, so the 250 Hz band
  often lacks the dynamic range for T20. It shows a dash rather than a guess.
- Talking, footsteps, or HVAC during the 3 s after the clap ruin the decay. The noise
  estimate assumes the background is steady.
- Standing next to a wall exaggerates early reflections (EDT ≠ T20). Stand in the open.
- A clap is not an omnidirectional source, and one position is not a room average. The
  ISO method averages several source and mic positions; "clap again" from another spot
  does the same job roughly.

## Debug view

- the recording with the clap marker
- the broadband and per-band Schroeder curves, with the noise truncation point
- the dynamic range and T20 r² per band
- "Save recording to cloud" (mode `room`)
