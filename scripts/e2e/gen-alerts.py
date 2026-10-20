# Writes synthetic alert recordings into the directory given as argv[1] (Chromium loops them):
# alert-smoke.wav: a T3 smoke alarm at 3.2 kHz (0.5 s on/off ×3, then 1.5 s off) in noise;
# alert-doorbell.wav: a "ding-dong" (660 then 523 Hz, decaying) every 5 s.
import sys, wave, struct, math, random
sr = 48000
def write(name, x):
    with wave.open(f"{sys.argv[1]}/{name}", 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(b''.join(struct.pack('<h', max(-32767, min(32767, int(v * 32767)))) for v in x))
    print(name)
rnd = random.Random(1)
x = [rnd.gauss(0, 0.01) for _ in range(sr * 8)]
for cycle in range(2):
    for k in range(3):
        a = int((cycle * 4 + k) * sr)
        for i in range(sr // 2):
            e = min(1, i / 240, (sr // 2 - i) / 240)
            x[a + i] += 0.3 * e * math.sin(2 * math.pi * 3200 * i / sr)
write('alert-smoke.wav', x)
x = [rnd.gauss(0, 0.004) for _ in range(sr * 5)]
for k, f in enumerate([660, 523]):
    a = int((0.5 + 0.45 * k) * sr)
    for i in range(sr):
        if a + i >= len(x): break
        t = i / sr
        x[a + i] += 0.3 * math.exp(-t / 0.35) * (math.sin(2*math.pi*f*t) + 0.4*math.sin(4*math.pi*f*t) + 0.2*math.sin(6*math.pi*f*t))
write('alert-doorbell.wav', x)
