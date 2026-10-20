# Knock ID and fruit firmness

## Knock ID

**Idea:** what a knock sounds like depends on the object's material, thickness, hollowness
and how it's supported. There's no physical model to invert, so the app learns from
examples: you knock on a few known things, label them, and it recognises them again by
**k-nearest neighbours**.

### Features (`packages/dsp/src/knock.ts`, version 1)

From each onset (the energy detector from tap mode, with 250 ms minimum spacing), the first
120 ms (Hann, zero-padded 2×):

- **Band shape:** 16 overlapping triangular bands, log-spaced from 100 Hz to 8 kHz, in dB,
  with the noise floor clamped at 25 dB under the loudest band and the mean removed. Shape,
  not level, so knocking harder doesn't change it (tested: soft vs hard within 1.5 dB per
  band). Triangular bands mean a tone near a band edge splits between two bands instead of
  jumping from one to the other.
- **Spectral centroid** and **dominant peak** (log₂ Hz): brightness and pitch.
- **Ring-down** (log₂ s): time for the 5 ms RMS envelope to fall 20 dB. Glass rings,
  cardboard thuds.
- **Tonality** (dB): dominant peak over the median band level.
- **IMU (optional):** with "feel the knock" on and the phone resting on the object, the peak
  |acceleration| deviation within ±150 ms of the knock (log₂). Used only when **every**
  example has it.

### Classifier

- Each dimension is standardised by the examples' own spread (floor 0.05 ≈ 0.5 dB or
  1/20 octave). The 16 bands share weight (each ¼ of a scalar) so they don't drown out
  pitch and decay.
- Distance-weighted vote of the 3 nearest examples. The result combines all knocks in a
  recording.
- **"Unknown":** if the nearest example is more than 3× that label's typical
  nearest-neighbour spacing, the app says it doesn't sound like anything taught, rather
  than forcing a label.
- **Self-test:** leave-one-out accuracy over your examples, shown under "Taught so far".
  Below 80%, it says the kinds sound alike.

Examples are stored in D1 (`examples` table, mode `knock`, migration `0002`) per device.
Audio stays on the phone unless saved from the debug view.

## Fruit firmness

**Acoustic firmness** (Abbott et al.; Yamamoto et al. 1980): tap a fruit and its first
resonance f depends on stiffness and mass. The index **S = f²·m^(2/3)** (Hz²·kg^⅔) removes
the size effect, and falls as fruit softens while ripening.

- The app takes the median resonance (60–1500 Hz) of 3–4 flicks and the weight you enter, and
  logs S per fruit with the change versus that fruit's first reading.
- **Honest limits:** S ranges differ by variety and even by how the fruit is held. There's
  no universal "ripe" threshold, so compare the same fruit over days, or against one you know
  is ripe. Watermelons, melons, apples and avocados are the classic cases in the literature.

## Verified

- **Unit tests** (`packages/dsp/test/knock.test.ts`): synthetic glass / wood / cardboard
  knocks with object-to-object variation.
  - Features separate them, and loudness doesn't change the shape.
  - Leave-one-out 100%; new knocks identified with > 60% confidence.
  - An untaught material is reported as unknown.
  - The IMU feature is used only when all examples have it.
  - Detected onsets from a recording classify correctly. The firmness formula is exact.
- **API tests:** examples CRUD, per-device isolation, delete by label, validation (mode,
  label, 64 KB payload limit).
- **Browser E2E** (`scripts/e2e/knock-flow.mjs`): teach glass, wood and cardboard (5 knocks
  each) through the fake mic, then identify the wood file as **wood (100%)**. A melon flick
  reads **160 Hz, S = 4.06×10⁴** for 2 kg, as computed by hand. Mic closed afterwards.

## Not yet verified, and the risks

- **Real objects haven't been tried.** Real knocks vary more: knuckle vs fingertip, spot,
  room echo. 5+ knocks per label from the same spot work best.
- Very similar objects (two plastic boxes) may be indistinguishable; the self-test shows it.
- The IMU sample rate (60–100 Hz on phones) only catches the gross thump, not the timbre.
  It helps tell "solid" from "hollow" when the phone rests on the object, and does little
  otherwise.

## Debug view

- the recording with numbered onsets
- each knock's band shape
- a table of peak, centroid, decay, tonality, IMU, guess and novelty
- "Save recording to cloud" (mode `knock`)
