# Writes presence-breathing.wav into the directory given as argv[1]: what the phone would hear
# while pinging every 50 ms with the app's fallback chirp (2–8 kHz, 5 ms; no sensor-check
# profile in a fresh browser): the direct path, a wall at 120 cm, and a chest at 60 cm moving
# ±3 mm at 0.25 Hz (15 breaths/min). 40 s, so Chromium's loop is seamless. Needs numpy.
import sys, wave
import numpy as np
sr, period, T = 48000, 2400, 40.0
c = 331.3 * np.sqrt(1 + 20 / 273.15)
n = int(0.005 * sr)
t = np.arange(n) / sr
env = np.ones(n); ramp = int(0.001 * sr)
env[:ramp] = 0.5 * (1 - np.cos(np.pi * np.arange(ramp) / ramp)); env[-ramp:] = env[:ramp][::-1]
ping = 0.8 * env * np.sin(2 * np.pi * (2000 * t + (8000 - 2000) * t * t / (2 * 0.005)))
L = 1024
P = np.fft.rfft(ping, L)
f = np.fft.rfftfreq(L)
def delayed(d):  # ping delayed by d samples (fractional), length L
    return np.fft.irfft(P * np.exp(-2j * np.pi * f * d), L)
N = int(T * sr)
x = np.zeros(N + L)
rng = np.random.default_rng(1)
for k in range(int(T / 0.05)):
    base = 300 + k * period
    tt = k * 0.05
    for cm, g in [(0, 1.0), (120, 0.2), (60 + 0.3 * np.sin(2 * np.pi * 0.25 * tt), 0.05)]:
        d = 2 * (cm / 100) * sr / c
        i0 = int(np.floor(d)); x[base + i0: base + i0 + L] += g * delayed(d - i0)
x = x[:N] + 0.002 * rng.standard_normal(N)
# Fold the tail back so the loop is seamless.
with wave.open(f"{sys.argv[1]}/presence-breathing.wav", 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())
print('presence-breathing.wav')
