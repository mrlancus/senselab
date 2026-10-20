# Presence: motion and breathing by sonar

## Physics

The phone pings continuously: a 5 ms chirp every 50 ms (20 pings/s) in the sensor check's
band (near-ultrasonic, e.g. 17–21 kHz, so it's inaudible). The matched filter turns each
ping into a complex **range profile**: one value per 0.36 cm of range out to 2 m.

- **Static things** (walls, furniture) give the same profile every ping.
- **Motion** changes it. The motion index is ‖profile − mean of the last 4 s‖² over
  ‖mean‖², from 20 to 200 cm. About 1e-4 in a still room.
- **Breathing** moves the chest a few mm, which changes that echo's **phase** by
  Δφ = 4π·Δd/λ: about 0.7 rad per mm at 19 kHz (0.2 rad/mm with audible 2–8 kHz chirps).

## Algorithm (`packages/dsp/src/presence.ts`, `screens/Presence.tsx`)

1. **Playback:** one 50 ms period (chirp + silence) loops seamlessly from a scheduled
   AudioContext time, and the recording is frame-stamped (as in echo ranging).
2. **Alignment:** the strongest matched-filter peak after start is a ping's direct path
   (every whole ping is equally strong; a chirp cut by the window edge is weaker). Profiles
   are taken every period from there.
3. **Glitch guard:** every profile's direct path must sit at its expected bin (±2 samples).
   A dropped or repeated audio block shifts everything after it, so the app re-aligns and
   restarts the history, counting `resyncs`.
4. **Breathing** (every 2 s, once 20 s exist, over the last 30 s):
   - For each range bin, remove the mean, project the complex series onto its principal
     axis (PCA, so it works for any echo phase), apply a Hann window and FFT.
   - The bin with the strongest peak in 0.1–0.7 Hz (6–42 /min) is the chest. Its peak over
     the band median is the confidence; ≥ 10 dB counts as a rhythm.
5. **Status:** a clear rhythm reads as **"Someone still"**, because breathing itself
   registers as a little motion. Otherwise "Movement" when the 1 s median motion index is
   above 0.003, else "Still".

## Mic and speaker

Both are on **only while the sonar runs**, with a visible "mic + speaker on" pill and Stop.

## Honest limits

- **Not a medical device.** No apnoea alarms, no heart rate.
- Needs the person _and_ the phone still. Fans, curtains, pets and a moving phone mask or
  mimic the rhythm.
- Range is good to about ±10 cm. With a large (3 mm at 19 kHz, ±2 rad) swing, the cleanest
  fundamental sits slightly off the echo peak.
- With audible fallback chirps (no near-ultrasonic support), you hear 20 clicks per second,
  and sensitivity is about 3.5× lower.
- Thick bedding absorbs the echo. Point the bottom edge at the chest, 0.5–1.5 m away.
- No displacement in mm is shown. The estimate mixed the chest with static clutter and was
  off by 3× in tests, so it was removed rather than shown wrong.

## Verified

- **Unit tests** (`presence.test.ts`, synthetic sonar with fractional-delay pings):
  - Every ping is framed.
  - Breathing of 3 mm at 15 /min, 60 cm away, behind a wall echo at 120 cm: rate within
    1 /min, > 15 dB, range within 10 cm.
  - A still room has no rhythm (< 12 dB).
  - Motion: about 1e-4 still, ≫ 20× higher with someone walking.
- **Browser E2E** (`scripts/e2e/presence-flow.mjs`, 40 s looping recording, 3 runs in a
  row): **"Someone still", ≈ 15 per minute at ≈ 60 cm, 46–50 dB**. No resyncs. Mic closed
  after Stop.
- Earlier runs exposed the edge-chirp alignment bug and the glitch shift, both fixed above.
