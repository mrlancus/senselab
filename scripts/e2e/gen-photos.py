# Renders synthetic photos of a 28/22/24 cm bucket (inside; 1 cm base) with a bank card, and
# writes the pixel positions a user would tap (photos.json), into the directory argv[1].
# Same pinhole model as packages/dsp/test/camera.test.ts (world mm, z up).
import sys, json, math
import numpy as np
from PIL import Image, ImageDraw

W, H = 2000, 1500
R, r, HOUT = 140.0, 110.0, 250.0
CW, CH = 85.6, 53.98

def camera(eye, at, F):
    eye, at = np.array(eye, float), np.array(at, float)
    fwd = (at - eye) / np.linalg.norm(at - eye)
    right = np.cross(fwd, [0, 0, 1.0]); right /= np.linalg.norm(right)
    down = np.cross(fwd, right)
    def p(v):
        d = np.array(v, float) - eye
        z = d @ fwd
        return (W / 2 + F * (d @ right) / z, H / 2 + F * (d @ down) / z)
    return p

def circle(radius, z, n=360):
    return [(radius * math.cos(2 * math.pi * k / n), radius * math.sin(2 * math.pi * k / n), z) for k in range(n)]

out = sys.argv[1]
taps = {}

# Top view: camera above, a little off-axis; card across the rim, in the rim plane.
P = camera([40, -60, HOUT + 520], [0, 0, HOUT], 2400)  # rim fills ~70% of the frame
img = Image.new('RGB', (W, H), (205, 200, 190)); d = ImageDraw.Draw(img)
d.polygon([P(v) for v in circle(R + 8, HOUT)], fill=(40, 90, 170))          # rim lip
d.polygon([P(v) for v in circle(R, HOUT)], fill=(25, 45, 80))               # opening
card = [(80, -27, HOUT), (80 + CW, -27, HOUT), (80 + CW, -27 + CH, HOUT), (80, -27 + CH, HOUT)]
d.polygon([P(v) for v in card], fill=(230, 180, 40), outline=(0, 0, 0))
img.save(f'{out}/top.png')
taps['top'] = {'size': [W, H], 'card': [P(v) for v in card],
               'rim': [P((R * math.cos(a), R * math.sin(a), HOUT)) for a in [0.3, 1.2, 2.0, 2.9, 3.8, 4.7, 5.6]]}

# Side view: camera 1.5 m in front, level with mid height; card upright on the front wall.
P = camera([0, -1500, HOUT / 2], [0, 0, HOUT / 2], 5500)  # zoomed in: bucket fills the frame
img = Image.new('RGB', (W, H), (220, 222, 225)); d = ImageDraw.Draw(img)
def sil(radius, z):
    pts = [P(v) for v in circle(radius, z, 3600)]
    return min(pts), max(pts)
tl, tr = sil(R, HOUT); bl, br = sil(r, 0)
d.polygon([tl, tr, br, bl], fill=(170, 200, 230))                            # translucent body
WATER = 150.0
rw = r + (R - r) * WATER / HOUT
wl, wr = sil(rw, WATER)
d.polygon([wl, wr, br, bl], fill=(90, 150, 210))                             # water behind wall
g = np.array([0, -(R - r), HOUT]); g /= np.linalg.norm(g)
mid = np.array([0, -(r + R) / 2, HOUT / 2]); x = np.array([1.0, 0, 0])
card = [mid - x * CH / 2 + g * CW / 2, mid + x * CH / 2 + g * CW / 2,
        mid + x * CH / 2 - g * CW / 2, mid - x * CH / 2 - g * CW / 2]
d.polygon([P(v) for v in card], fill=(230, 180, 40), outline=(0, 0, 0))
img.save(f'{out}/side.png')
taps['side'] = {'size': [W, H], 'card': [P(v) for v in card],
                'rimFront': [P((0, -R, HOUT))], 'baseFront': [P((0, -r, 0))],
                'waterFront': [P((0, -rw, WATER))], 'top': [tl, tr], 'bottom': [bl, br],
                'water': [wl, wr]}
json.dump(taps, open(f'{out}/photos.json', 'w'), indent=1)
print('wrote top.png, side.png, photos.json: expect 28.0 / ~22 / 24.0 cm, water 14.0 cm (11.8 L capacity)')
