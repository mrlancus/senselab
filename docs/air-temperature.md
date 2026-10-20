# Air temperature (experimental)

## Physics

The speed of sound in dry air depends on temperature: c = 331.3·√(1 + T/273.15) m/s, about
+0.6 m/s per °C (343.2 m/s at 20 °C). Measure c and you have T.

A single echo can't give c, because the true distance and the phone's own offsets
(speaker–mic geometry, latency) are unknown. Two echoes to the same wall, from two spots
exactly **L** apart along the same line, can: the offsets are identical and cancel in the
difference.

    c = c₂₀ · L / (r_far − r_near)      (r computed by the echo engine at an assumed 20 °C)
    T = (c/331.3)² · 273.15 − 273.15

Because c ∝ √T_K, dT ≈ 2·T_K·dc/c. A 1% error in c is about 6 °C.

## Uncertainty

`temperatureFromBaseline` (`packages/dsp/src/echo.ts`): relative error =
√((σ_L/L)² + 2·σ_r²/(Δr)²), with σ_L = 0.3 cm (placing the phone on a tape mark) and σ_r =
the echo spread, at least 0.1 cm. Over **L = 1 m that's about ±2 °C**; over 50 cm about ±4 °C.
That's why it's labelled experimental.

Also unmodelled:

- **Humidity** raises c slightly: +0.3–0.6 m/s at room temperature, about +0.5–1 °C.
- **Not pointing straight at the wall:** cosine error, in both readings.
- Air currents.

## How to (animated in the app)

1. Lay a tape measure on the floor, straight out from a flat wall.
2. Free-air reference once, if the phone hasn't got one.
3. Phone bottom edge on the near mark, pointing at the wall, then **Ping**.
4. Move it exactly L further back along the tape, then **Ping**.
5. The result can be saved as the air temperature the other echo modes use.

## Verified

- **Unit tests:**
  - Simulated readings with a −0.8 cm phone offset at 30 °C recover 30.0 °C exactly, with a
    stated ±1.5–2.5 °C over 1 m.
  - Through the full echo engine at 5 °C: within 2 °C.
  - No movement or no baseline is refused.
- **Browser E2E** (`scripts/e2e/temperature-flow.mjs`): synthetic echoes at 40 cm and 140 cm
  in 30 °C air read 39.34 cm and 137.68 cm at the assumed 20 °C, giving **30.0 °C**. Both
  echo cards pick up a free-air reference recorded in either one.
