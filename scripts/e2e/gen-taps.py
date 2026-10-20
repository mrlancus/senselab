# Writes synthetic tap recordings (tap-<litres>.wav) into the directory given as argv[1].
# Synthetic tap recordings for the browser E2E: a bucket whose pitch follows
# (f0/f)^2 = 1 + a*V^k, tapped every 0.7 s, with an impact click, a second mode and noise.
import sys, wave, struct, math, random
f0, a, k = 820.0, 0.012, 1.6
def pitch(v): return f0 / math.sqrt(1 + a * v ** k)
sr = 48000
for litres in [0, 5, 10, 7.5]:
    f = pitch(litres)
    n = sr * 7
    x = [0.0] * n
    rnd = random.Random(int(litres * 10) + 1)
    for i in range(10):
        start = int((0.4 + i * 0.7) * sr)
        fj = f * (1 + 0.001 * rnd.uniform(-1, 1))
        for j in range(int(0.3 * sr)):
            if start + j >= n: break
            t = j / sr
            v = 0.3 * math.exp(-t / 0.035) * math.sin(2 * math.pi * fj * t)
            v += 0.08 * math.exp(-t / 0.015) * math.sin(2 * math.pi * fj * 2.7 * t)
            if j < 24: v += 0.4 * (1 - j / 24) * (1 if j % 2 else -1)
            x[start + j] += v
    x = [v + rnd.gauss(0, 0.004) for v in x]
    name = f"{sys.argv[1]}/tap-{litres}.wav"
    with wave.open(name, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(b''.join(struct.pack('<h', max(-32767, min(32767, int(v * 32767)))) for v in x))
    print(name, round(f, 2))
