# Writes temp-near.wav and temp-far.wav into argv[1]: the app's fallback echo chirp train
# (2–8 kHz, 8 ms, every 0.1 s, 44.1 kHz) reflected by a wall 40 cm and 140 cm away in air at
# 30 °C (fractional delays). The app computes distances at 20 °C, so it should infer ≈ 30 °C.
# Use with echo-free.wav from gen-echo.py for the free-air reference. Needs numpy.
import sys, wave
import numpy as np
sr, period = 44100, 4410
c30 = 331.3 * np.sqrt(1 + 30 / 273.15)
T = 0.008; n = round(T * sr); fade = round(T / 4 * sr)
ramp = max(1, int(np.floor((min(1, 2 * fade / n) * (n - 1)) / 2)))
i = np.arange(n); j = np.minimum(i, n - 1 - i)
env = np.where(j < ramp, 0.5 * (1 - np.cos(np.pi * j / ramp)), 1.0)
tt = i / sr
chirp = 0.8 * env * np.sin(2 * np.pi * (2000 * tt + 6000 * tt * tt / (2 * T)))
L = 1024; P = np.fft.rfft(chirp, L); f = np.fft.rfftfreq(L)
def delayed(d): return np.fft.irfft(P * np.exp(-2j * np.pi * f * d), L)
for name, cm in [('near', 40), ('far', 140)]:
    one = np.zeros(period + L)
    for d, g in [(1000.0, 0.5), (1000.0 + 2 * (cm / 100) * sr / c30, 0.06)]:
        k = int(np.floor(d)); one[k:k + L] += g * delayed(d - k)
    one = one[:period] + np.pad(one[period:], (0, 0))[:period] if False else one[:period] + np.concatenate([one[period:], np.zeros(period - L)])
    x = np.tile(one, 100) + 0.001 * np.random.default_rng(len(name)).standard_normal(period * 100)
    with wave.open(f"{sys.argv[1]}/temp-{name}.wav", 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())
    print(f"temp-{name}.wav")
