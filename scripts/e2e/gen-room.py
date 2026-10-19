# Writes a synthetic clap in a room (room.wav) into the directory given as argv[1]: every
# 3 s, an impulse followed by noise decaying 60 dB in RT = 0.6 s, over a -70 dB floor.
import sys, wave, struct, math, random
sr, rt, period = 44100, 0.6, 3.0
rnd = random.Random(3)
x = []
for i in range(int(sr * period * 3)):
    t = (i % int(sr * period)) / sr - 1.0
    v = rnd.gauss(0, 10 ** (-70 / 20))
    if t >= 0: v += 0.3 * 10 ** (-3 * t / rt) * rnd.gauss(0, 1)
    x.append(v)
with wave.open(f"{sys.argv[1]}/room.wav", 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes(b''.join(struct.pack('<h', max(-32767, min(32767, int(v * 32767)))) for v in x))
print(f"{sys.argv[1]}/room.wav RT {rt}")
