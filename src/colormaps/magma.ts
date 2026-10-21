type RGB = [number, number, number];

const MAGMA_STOPS: [number, RGB][] = [
  [0.0, [0, 0, 4]],
  [0.04, [7, 5, 21]],
  [0.08, [20, 10, 43]],
  [0.12, [37, 12, 69]],
  [0.16, [56, 14, 89]],
  [0.2, [74, 15, 101]],
  [0.24, [92, 17, 109]],
  [0.28, [108, 20, 113]],
  [0.32, [124, 24, 114]],
  [0.36, [139, 28, 113]],
  [0.4, [153, 34, 108]],
  [0.44, [167, 40, 101]],
  [0.48, [180, 47, 91]],
  [0.52, [192, 57, 78]],
  [0.56, [201, 68, 65]],
  [0.6, [211, 81, 53]],
  [0.64, [220, 96, 43]],
  [0.68, [229, 111, 34]],
  [0.72, [236, 128, 28]],
  [0.76, [242, 145, 24]],
  [0.8, [247, 163, 24]],
  [0.84, [250, 181, 33]],
  [0.88, [252, 200, 50]],
  [0.92, [253, 218, 73]],
  [0.96, [253, 236, 107]],
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
