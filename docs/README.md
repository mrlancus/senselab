# Mode notes

One short note per sensing mode, covering the physics, the algorithm, and what goes wrong on
real phones.

- [architecture.md](architecture.md): how the pieces fit together
- [sensor-check.md](sensor-check.md): per-device speaker/mic response, chirp band choice
- [tap-level.md](tap-level.md): liquid level from the pitch of a tap, per-container calibration
- [echo-level.md](echo-level.md): liquid level by echo ranging (chirps, matched filter, CLEAN)
- [ruler.md](ruler.md): sonar ruler, the echo engine pointed at a wall
- [room-acoustics.md](room-acoustics.md): RT60 from a clap (Schroeder integration, octave bands)
- [camera-level.md](camera-level.md): dimensions and waterline from photos with a card or A4 for scale; AR tape (experimental)
- [knock-id.md](knock-id.md): Knock ID (features + kNN on your labels) and fruit firmness (S = f²·m^⅔)
