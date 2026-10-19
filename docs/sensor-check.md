# Sensor check

**Why:** phone speakers and mics are designed for voice. Above about 16–18 kHz their
response varies a lot between models, and sometimes between the two microphones on one
phone. Echo ranging wants near-ultrasonic chirps (17–22 kHz), so they're mostly inaudible.
Before using them we measure what this device can actually emit and hear.

## What it checks

1. **Feature detection**, with no permission prompts: HTTPS, getUserMedia, AudioWorklet,
   DeviceMotion (and whether iOS needs a permission tap), Magnetometer (Generic Sensor
   API), WebXR `immersive-ar`, and Web Workers.
2. **Microphone.** We open the mic with `echoCancellation`, `noiseSuppression` and
   `autoGainControl` all set to false, then read back `track.getSettings()` and
   `AudioContext.sampleRate`. Some browsers ignore the constraints; the screen says so,
   because AGC or noise suppression distorts tap and echo measurements.
3. **Speaker → mic sweep:**
   - Record 0.6 s of room noise.
   - Play a 2.5 s logarithmic sweep from 150 Hz to `min(23 kHz, 0.48·fs)` and record it.
   - Matched filter (FFT cross-correlation + Hilbert envelope) finds where the sweep
     starts in the recording, giving the round-trip latency and a match score.
   - For each band (1/3-octave-ish up to 10 kHz, then 1 kHz bands up to 23 kHz), we use
     only the part of the recording where the sweep was inside that band. For a log
     sweep, `t(f) = T·ln(f/f0)/ln(f1/f0)`.
   - Per band we compute Welch PSD power for the recorded segment, the emitted segment
     and the noise. **SNR** is recorded/noise, and **response** is recorded/emitted
     (normalised to the best band). Time-gating each band rejects noise and reverb at
     other frequencies.
4. **Chirp band choice:** the widest contiguous run of bands with SNR ≥ 15 dB.
   - Prefer runs at or above 16 kHz that are at least 2 kHz wide (**ultrasonic**).
   - Otherwise use an audible 2–8 kHz chirp (**audible**: you'll hear clicks).
   - The result is saved in localStorage as the device's audio profile.
5. **Motion sensors** (event rate, accel incl. gravity, rotation rate) and the
   **magnetometer** (Android Chrome only).

## Known caveats

- **iOS** routes audio through a "play-and-record" session while the mic is open. We set
  `navigator.audioSession.type = 'play-and-record'` where supported (Safari 17+). If
  playback is very quiet, iOS may be using the earpiece, and the sweep will report low
  SNR. The ring/silent switch can mute web audio.
- The latency number includes JS timer jitter (`setTimeout` schedules the pad), so treat
  it as approximate. Echo ranging doesn't depend on it: it uses the direct
  speaker→mic path in each recording as its time zero.
- Headless Chromium's fake microphone plays a beep, so the sweep correctly reports "not
  heard". Real verification needs a real phone.

## Debug view

Enable with `?debug=1` or five quick taps on the footer. It shows:

- the raw recording with the detected sweep start
- a spectrogram
- the matched-filter envelope
- the per-band SNR and response table
- "Save recording to cloud", which uploads a WAV plus labels to R2 for replay as a test
  fixture
