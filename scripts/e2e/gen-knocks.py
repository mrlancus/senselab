# Writes synthetic knock recordings (knock-<kind>.wav) into the directory given as argv[1]:
# a knock every 0.9 s on glass (bright long ring), wood (dull short knock), cardboard (thud),
# and a melon flick (≈ 160 Hz ring) for the firmness index. Chromium loops the file.
import sys, wave, struct, math, random
sr = 48000
def knock(kind, rnd):
    n = int(0.3 * sr); j = 1 + 0.03 * rnd.gauss(0, 1); lp = 0.0; out = []
    for i in range(n):
        t = i / sr
        if kind == 'glass':
            v = math.exp(-t / 0.12) * math.sin(2 * math.pi * 2200 * j * t) + 0.4 * math.exp(-t / 0.05) * math.sin(2 * math.pi * 5900 * j * t)
        elif kind == 'wood':
            v = math.exp(-t / 0.015) * math.sin(2 * math.pi * 330 * j * t) + 0.5 * math.exp(-t / 0.008) * math.sin(2 * math.pi * 900 * j * t)
            if i < 30: v += 0.6 * rnd.gauss(0, 1)
        elif kind == 'melon':
            v = math.exp(-t / 0.04) * math.sin(2 * math.pi * 160 * t) + 0.2 * math.exp(-t / 0.02) * math.sin(2 * math.pi * 410 * t)
        else:
            lp = 0.9 * lp + 0.1 * rnd.gauss(0, 1); v = 4 * math.exp(-t / 0.006) * lp
        out.append(0.4 * v)
    return out
for kind in ['glass', 'wood', 'cardboard', 'melon']:
    rnd = random.Random(kind)
    total = int(sr * 0.9 * 10)
    x = [rnd.gauss(0, 0.002) for _ in range(total)]
    for k in range(10):
        start = int((0.2 + 0.9 * k) * sr)
        for i, v in enumerate(knock(kind, rnd)):
            if start + i < total: x[start + i] += v
    path = f"{sys.argv[1]}/knock-{kind}.wav"
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(b''.join(struct.pack('<h', max(-32767, min(32767, int(v * 32767)))) for v in x))
    print(path)
