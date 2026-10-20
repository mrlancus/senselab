# Sound alerts

## What it listens for

1. **Smoke / fire alarms, no setup.** ISO 8201 "temporal-3" (T3) is the standard evacuation
   pattern: three 0.5 s beeps 0.5 s apart, then 1.5 s off, repeating every 4 s.
2. **Carbon-monoxide alarms, no setup.** "Temporal-4" (T4, UL 2034): four 0.1 s beeps
   0.1 s apart, then ~5 s off.
3. **Sounds you teach it:** a doorbell, the washer's end chime, an oven timer.

## Algorithm (`packages/dsp/src/alerts.ts`)

**Alarms:**

- 2048-point frames, hop 256.
- In 400–700 Hz (low-frequency 520 Hz sounders) and 2.5–4.5 kHz (piezo, typically
  3–3.5 kHz), take the strongest bin, and its **tonality** over the band median.
- A frame is "on" when it is ≥ 20 dB tonal, within 25 dB of the loudest frame, and within 6%
  of the dominant alarm frequency. Single-frame blips and dropouts are merged.
- **Match:** three ons of 0.5 s ± 35% separated by 0.5 s offs, with a ≥ 0.9 s pause (or the
  window edge) on both sides, is smoke. Four 0.1 s ± 60% beeps is CO.
- The pause requirement is what rejects a timer or truck beeping evenly.

**Taught sounds:**

- 24 log bands (200 Hz–8 kHz), 32 ms hop, each frame's mean removed, so level doesn't
  matter.
- The fingerprint is the **loudest single sound event** in a 6 s recording: frames within
  25 dB of the peak, gaps under 0.5 s bridged, at most 4 s. It's stored as JSON in D1
  (`examples`, mode `alert`, ~3–12 KB).
- **Live:** slide the template over the last 6 s and take the normalised correlation.
  ≥ 0.75 is a match. Silent stretches can't match.

**Live loop:**

- While armed, a 6 s ring buffer is scanned every 0.5 s in the DSP worker.
- Each alert has a 10 s cooldown.
- An alert shows a flashing banner, vibrates (Android), and sends a notification (if allowed
  and the service worker is ready). It's logged in "Heard".

## Mic use

The mic is held **only while "Listening…" is on**, shown with a "mic on" pill and a Stop
button. A screen wake lock keeps the screen on while armed (where supported). Teaching
holds the mic for 6 s.

## Honest limits

- **Phones stop web audio when the screen locks or the browser is in the background** (iOS
  always; Android usually). This is a "phone on the counter, page open, plugged in" tool, not
  a background service. Not a substitute for a certified alarm system.
- Smoke alarms that don't follow T3 (older units beeping continuously) aren't recognised
  automatically. Teach them as a sound instead.
- Taught sounds need to be fairly repeatable (chimes, beeps). Voices, music or barking vary
  too much for a single fingerprint.
- Loud TV or music over the chime lowers the match score.

## Verified

- **Unit tests** (`alerts.test.ts`):
  - T3 at 3.2 kHz in noise, T3 at 520 Hz, and T4 are detected.
  - A single long beep, a continuous tone, eight evenly spaced beeps and silence are not.
  - A ding-dong fingerprint finds the same bell 4× quieter, in 2× the noise, at another
    time (score > 0.8, position within 0.3 s).
  - A different 3-note chime and babble score < 0.6.
  - Two rings in one recording learn one ring.
- **Browser E2E** (`scripts/e2e/alerts-flow.mjs`):
  - teach "doorbell" (1.5 s learned)
  - smoke-alarm file → **"Smoke / fire alarm"**
  - doorbell file → **"doorbell"**
  - knocks → nothing
  - the mic is closed after each Stop
