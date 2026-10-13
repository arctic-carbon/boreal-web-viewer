/**
 * Plasma colormap (256 entries) from matplotlib.
 * Returns an ImageData suitable for use as a colormap texture.
 */

type RGB = [number, number, number];

const PLASMA_STOPS: [number, RGB][] = [
  [0.0, [12, 7, 134]],
  [0.04, [37, 5, 145]],
  [0.08, [56, 4, 153]],
  [0.12, [73, 2, 159]],
  [0.16, [89, 1, 164]],
  [0.2, [106, 0, 167]],
  [0.24, [121, 1, 168]],
  [0.28, [136, 7, 165]],
  [0.32, [150, 18, 160]],
  [0.36, [164, 30, 152]],
  [0.4, [176, 42, 143]],
  [0.44, [187, 53, 134]],
  [0.48, [197, 64, 125]],
  [0.52, [208, 77, 115]],
  [0.56, [216, 88, 106]],
  [0.6, [224, 100, 97]],
  [0.64, [232, 112, 89]],
  [0.68, [239, 125, 79]],
  [0.72, [244, 138, 71]],
  [0.76, [248, 152, 62]],
  [0.8, [252, 166, 53]],
  [0.84, [253, 182, 45]],
  [0.88, [253, 198, 38]],
  [0.92, [250, 214, 36]],
  [0.96, [245, 231, 38]],
  [1.0, [239, 248, 33]],
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function samplePlasma(t: number): RGB {
  if (t <= 0) {
    return PLASMA_STOPS[0][1];
  }
  if (t >= 1) {
    return PLASMA_STOPS[PLASMA_STOPS.length - 1][1];
  }

  for (let i = 0; i < PLASMA_STOPS.length - 1; i++) {
    const [t0, c0] = PLASMA_STOPS[i];
    const [t1, c1] = PLASMA_STOPS[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return [
        lerp(c0[0], c1[0], f),
        lerp(c0[1], c1[1], f),
        lerp(c0[2], c1[2], f),
      ];
    }
  }

  return PLASMA_STOPS[PLASMA_STOPS.length - 1][1];
}

const data = new Uint8ClampedArray(256 * 4);
for (let i = 0; i < 256; i++) {
  const t = i / 255;
  const [r, g, b] = samplePlasma(t);
  data[i * 4] = r;
  data[i * 4 + 1] = g;
  data[i * 4 + 2] = b;
  data[i * 4 + 3] = 255;
}

export default new ImageData(data, 256, 1);
