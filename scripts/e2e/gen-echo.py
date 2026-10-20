# Writes synthetic echo recordings (echo-<name>.wav) into the directory given as argv[1].
# Chromium loops a fake-mic file, so each file is a whole number of 0.1 s chirp periods:
# whatever moment the app starts recording, it hears a seamless chirp train. Each period
# holds the 2-8 kHz chirp the app plays without a sensor-check profile (8 ms, linear,
# Tukey fades of 2 ms, amplitude 0.8), heard directly and, optionally, echoed `delay`
# samples later.
import sys, wave, struct, math, random
sr = 44100
period = sr // 10
f0, f1, T = 2000.0, 8000.0, 0.008
n = round(T * sr)
fade = round(T / 4 * sr)
ramp = max(1, math.floor((min(1, 2 * fade / n) * (n - 1)) / 2))
def env(i):
    j = min(i, n - 1 - i)
    return 0.5 * (1 - math.cos(math.pi * j / ramp)) if j < ramp else 1.0
chirp = [0.8 * env(i) * math.sin(2 * math.pi * (f0 * (i / sr) + (f1 - f0) * (i / sr) ** 2 / (2 * T)))
         for i in range(n)]
# Echo delays in samples at 44.1 kHz (2.570 samples per cm of one-way distance at 20 °C).
cases = {'free': None, 'empty': 75, 'measure': 33, 'wall': 154}
for name, delay in cases.items():
    one = [0.0] * period
    for i, v in enumerate(chirp):
        one[(1000 + i) % period] += 0.5 * v
        if delay: one[(1000 + delay + i) % period] += 0.06 * v
    rnd = random.Random(len(name))
    x = [one[i % period] + rnd.gauss(0, 0.001) for i in range(period * 100)]
    path = f"{sys.argv[1]}/echo-{name}.wav"
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(b''.join(struct.pack('<h', max(-32767, min(32767, int(v * 32767)))) for v in x))
    print(path, delay)
