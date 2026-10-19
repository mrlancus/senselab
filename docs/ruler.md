# Sonar ruler

The echo-ranging engine from [echo-level.md](echo-level.md) pointed at a wall: distance from
the phone's bottom edge to the strongest echo between 10 and 130 cm, plus the 1 cm
speaker/mic geometry term (`DEFAULT_ECHO_OFFSET_CM`).

- **Accuracy:** sub-millimetre repeatability on synthetic data. On real phones, expect about
  ±0.5 cm at 20 °C. Set the air temperature: c changes by 0.17% per °C.
- **Reference:** the same free-air reference as liquid level (stored per phone and chirp
  band). Without it, anything closer than ~17 cm (ultrasonic) can't be read.
- **Window:** echoes up to 150 cm are kept. The 100 ms chirp period means a surface up to
  ~17 m away can't alias into the window from the previous chirp, but strong room reverb
  can raise the floor.
- **Failure modes:** soft or angled surfaces (weak echo), a nearer object off-axis (the
  wrong echo is stronger; the debug view shows all candidates), and moving the phone during
  the 1.2 s train (spread grows, confidence drops).
- **Verified:** browser E2E with a synthetic 154-sample echo at 44.1 kHz reads **60.9 cm**
  (expected 59.9 + 1.0).
