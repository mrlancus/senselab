# Liquid level: camera

The camera measures the bucket's **inside dimensions**, which tap and echo then use, and for
translucent buckets the **water level through the wall**. It works on every phone: a
photo plus taps. Android phones with ARCore also get an experimental AR tape measure.

## No reference object (the default)

A level side photo from 1.5–2 m shows the plane through the bucket's axis almost as a true
similarity. The silhouette ends of the rim and base sit r²/D in front of the axis, about
1.3 cm at 1.5 m, so the **proportions** are right to ~1% without any ruler: top width,
bottom width, and height along the axis (`proportionsFromSilhouette`). Height measured
along the axis also makes a small roll harmless; a 5° pitch costs under 3% (tested).

The **size** then comes from one number the user already has (`scaleProportions`):

| Source                                                      | How                                                                                           | Scale error (1σ)                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Printed capacity ("10 L" moulded on the bucket)             | solve for the scale at which the inside frustum (outside − 2·wall, − base) holds exactly that | ±2.3% in length (±7% in volume: brim-full vs fill line) |
| One length (outside height or top width, any tape or ruler) | direct                                                                                        | ±0.3 cm                                                 |
| Depth by sound (echo of the empty bucket, phone at the rim) | inside height = raw + 1 cm                                                                    | ±1.5 cm (hand height)                                   |

**Waterline** (translucent) needs no scale at all once the shape is known: depth =
(waterline height / outside height) · (H + base) − base (`waterDepthFromProportions`), ±0.4 cm
in the E2E.

## With a card or sheet (most accurate)

A flat reference of known size fixes a **homography** from the photo to its own plane, in
millimetres (4-point DLT, normalised). Points in that plane are then measured exactly from
any camera angle. Points out of it are not, so we only rely on in-plane points:

- **Top view:** the reference lies flat **on the rim**, so the rim is in its plane. Taps on the
  inside rim edge are mapped to mm and fitted with a least-squares (Kåsa) circle → inside top
  diameter. References: bank card (ISO/IEC 7810 ID-1, 85.60 × 53.98 mm), A4 (297 × 210 mm), US
  Letter (279.4 × 215.9 mm). The card's corner order doesn't matter: corners are sorted
  around their centroid, and the longer pair of sides is taken as the long edge.
- **Side view:** the card is taped upright (long edge vertical) on the outside wall. The
  wall's front line (a straight generator of the cone) lies in the card's plane, so rim →
  base along it is the **slant height**, exactly. The **taper** (bottom/top) comes from the
  silhouette widths. Those points are off the plane, but in a ratio the perspective error
  (≈ r/D) cancels to first order: within 2% at 1.5 m.
- **Combining:** bottom ⌀ = top ⌀ × taper; vertical height = √(s² − ((D_top − D_bot)/2)²);
  inside height = outside height − base thickness (default 1 cm, editable).
- (With a card in the side photo, `waterDepthWithShape` also converts a wall slant to a
  depth; the app now uses the reference-free waterline above.)

## Precision, honestly

- **Tapping is the limit.** A phone shows several photo pixels per screen pixel. The tapper
  drops a point under the finger, then **drags it at 1/3 speed** under a **4× magnifier**,
  and the fixed-height prompt keeps the photo from moving between steps. We take the tap
  precision as ⅓ of a screen pixel, in photo pixels (≥ 1 px).
- **Corner errors are amplified** by extrapolating from an 86 mm card to a 300 mm rim. The
  relative scale σ ≈ 6 · tap / (card length in px). The factor 6 was **calibrated by Monte
  Carlo** (simulated oblique photos, Gaussian tap noise: 68% of errors within 1σ, enforced by
  a test).
- In practice, with a card filling ~15% of the frame width, expect **±0.9 cm on a 28 cm
  rim** (3%, about ±6% in volume). An **A4 sheet** on the rim is about 3× tighter. The UI
  warns when the stated ± exceeds 3%.

## AR tape measure (experimental, Android)

`immersive-ar` with `hit-test` and `dom-overlay`: a ray from the screen centre hits the
detected surface, a tap drops a point, and pairs give distances. It is hidden where WebXR AR
isn't supported (all of iOS). **It has not been run on a real device yet.** Check it against
a tape measure before trusting it.

## Verified

- **Unit tests** (`camera.test.ts`, a pinhole model with world mm):
  - The homography is exact.
  - Corner ordering is invariant to tap order.
  - The circle fit is exact.
  - Top view from an oblique camera: exact. With 2 px noise: within 2σ, and the σ is calibrated.
  - A4: σ < 0.4 cm.
  - Side view: slant exact, taper within 2%, inside height within 0.5 mm, water depth within 0.5 mm.
- **Browser E2E** (`scripts/e2e/camera-flow.mjs` + `gen-photos.py`): rendered photos of a
  28/22/24 cm bucket, tapped through the real UI (touch-down plus fine drag):
  - **28.0 / 22.0 / 24.0 cm**, capacity 11.8 L, saved to the container
  - waterline **14.0 cm ≈ 6.2 L**, from one photo with no card
  - no reference, one side photo + the printed 11.8 L: **27.8 / 21.7 / 24.4 cm** (truth
    28 / 22 / 24, stated ±0.7 cm)

## Not yet verified, and the risks

- **No real photos have been measured yet.** Phone lens distortion (wide cameras) bends
  straight lines near the frame edges, which a homography can't model. Keep the bucket
  centred and use the 1× or 2× lens rather than the ultra-wide.
- A thick, rolled rim makes "inside edge" ambiguous by a few mm. Tap where the wall meets
  the opening.
- A card on a small curved bucket doesn't lie flat (sagitta ≈ 3 mm for a 54 mm wide card on
  a 125 mm radius). Long-edge-vertical keeps it along the straight generator.
- Waterline photos need the water visibly through the wall. Opaque buckets can't use it.

## Debug view

`?debug=1` shows every tapped point in photo pixels, the reference length in px, the
results, and **"Save photo to cloud"** (mode `camera`, with the taps as a compact label).
That's a regression fixture.
