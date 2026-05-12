/**
 * Viridis colormap (256 entries) from matplotlib.
 * Returns an ImageData suitable for use as a colormap texture.
 */

type RGB = [number, number, number];

const VIRIDIS_STOPS: [number, RGB][] = [
  [0.0, [68, 1, 84]],
  [0.04, [72, 15, 104]],
  [0.08, [72, 29, 119]],
  [0.12, [69, 43, 130]],
  [0.16, [63, 56, 136]],
  [0.2, [56, 68, 139]],
  [0.24, [49, 80, 140]],
  [0.28, [42, 91, 139]],
  [0.32, [37, 102, 137]],
  [0.36, [32, 112, 134]],
  [0.4, [28, 122, 130]],
  [0.44, [25, 132, 125]],
  [0.48, [24, 142, 119]],
  [0.52, [29, 151, 112]],
  [0.56, [40, 161, 103]],
  [0.6, [57, 169, 92]],
  [0.64, [78, 177, 80]],
  [0.68, [102, 184, 66]],
  [0.72, [127, 190, 51]],
  [0.76, [155, 195, 37]],
  [0.8, [183, 198, 26]],
  [0.84, [210, 199, 22]],
  [0.88, [234, 199, 30]],
  [0.92, [252, 197, 48]],
  [0.96, [253, 210, 72]],
  [1.0, [253, 231, 37]],
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function sampleViridis(t: number): RGB {
  if (t <= 0) {
    return VIRIDIS_STOPS[0][1];
  }
  if (t >= 1) {
    return VIRIDIS_STOPS[VIRIDIS_STOPS.length - 1][1];
  }

  for (let i = 0; i < VIRIDIS_STOPS.length - 1; i++) {
    const [t0, c0] = VIRIDIS_STOPS[i];
    const [t1, c1] = VIRIDIS_STOPS[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return [
        lerp(c0[0], c1[0], f),
        lerp(c0[1], c1[1], f),
        lerp(c0[2], c1[2], f),
      ];
    }
  }

  return VIRIDIS_STOPS[VIRIDIS_STOPS.length - 1][1];
}

const data = new Uint8ClampedArray(256 * 4);
for (let i = 0; i < 256; i++) {
  const t = i / 255;
  const [r, g, b] = sampleViridis(t);
  data[i * 4] = r;
  data[i * 4 + 1] = g;
  data[i * 4 + 2] = b;
  data[i * 4 + 3] = 255;
}

export default new ImageData(data, 256, 1);
