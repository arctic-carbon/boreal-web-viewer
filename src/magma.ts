/**
 * Magma colormap (256 entries) from matplotlib.
 * Returns an ImageData suitable for use as a colormap texture.
 */

type RGB = [number, number, number];

const MAGMA_STOPS: [number, RGB][] = [
  [0.0, [0, 0, 3]],
  [0.04, [7, 3, 18]],
  [0.08, [16, 7, 38]],
  [0.12, [28, 11, 61]],
  [0.16, [40, 14, 83]],
  [0.2, [53, 15, 103]],
  [0.24, [65, 16, 119]],
  [0.28, [79, 18, 127]],
  [0.32, [93, 22, 133]],
  [0.36, [107, 27, 137]],
  [0.4, [121, 33, 139]],
  [0.44, [136, 38, 140]],
  [0.48, [150, 44, 138]],
  [0.52, [164, 50, 133]],
  [0.56, [178, 58, 124]],
  [0.6, [191, 68, 113]],
  [0.64, [203, 80, 100]],
  [0.68, [213, 95, 87]],
  [0.72, [222, 113, 76]],
  [0.76, [231, 132, 67]],
  [0.8, [239, 152, 62]],
  [0.84, [246, 174, 63]],
  [0.88, [251, 195, 78]],
  [0.92, [254, 217, 103]],
  [0.96, [254, 238, 140]],
  [1.0, [252, 253, 191]],
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function sampleMagma(t: number): RGB {
  if (t <= 0) {
    return MAGMA_STOPS[0][1];
  }
  if (t >= 1) {
    return MAGMA_STOPS[MAGMA_STOPS.length - 1][1];
  }

  for (let i = 0; i < MAGMA_STOPS.length - 1; i++) {
    const [t0, c0] = MAGMA_STOPS[i];
    const [t1, c1] = MAGMA_STOPS[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return [
        lerp(c0[0], c1[0], f),
        lerp(c0[1], c1[1], f),
        lerp(c0[2], c1[2], f),
      ];
    }
  }

  return MAGMA_STOPS[MAGMA_STOPS.length - 1][1];
}

const data = new Uint8ClampedArray(256 * 4);
for (let i = 0; i < 256; i++) {
  const t = i / 255;
  const [r, g, b] = sampleMagma(t);
  data[i * 4] = r;
  data[i * 4 + 1] = g;
  data[i * 4 + 2] = b;
  data[i * 4 + 3] = 255;
}

export default new ImageData(data, 256, 1);
