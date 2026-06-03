import { gamutMapOklab } from "./color.mjs";

export function buildConstrainedOklabPalette(
  pixels,
  count,
  { iterations = 18, lightnessMode = "image" } = {}
) {
  if (pixels.length === 0) {
    return Array.from({ length: count }, (_, i) => ({
      L: count > 1 ? i / (count - 1) : 0,
      a: 0,
      b: 0
    }));
  }

  const lightnessLevels = makeEqualLightnessLevels(
    pixels,
    count,
    lightnessMode
  );

  let palette = initializePaletteFromLightnessBuckets(
    pixels,
    lightnessLevels
  );

  for (let iteration = 0; iteration < iterations; iteration++) {
    const sums = Array.from({ length: count }, () => ({
      a: 0,
      b: 0,
      count: 0
    }));

    for (const pixel of pixels) {
      const index = findNearestPaletteIndex(pixel, palette);

      sums[index].a += pixel.a;
      sums[index].b += pixel.b;
      sums[index].count++;
    }

    for (let i = 0; i < count; i++) {
      if (sums[i].count > 0) {
        palette[i] = gamutMapOklab({
          L: lightnessLevels[i],
          a: sums[i].a / sums[i].count,
          b: sums[i].b / sums[i].count
        });
      } else {
        const fallback = nearestNonEmptyCluster(i, sums, palette);

        palette[i] = gamutMapOklab({
          L: lightnessLevels[i],
          a: fallback.a,
          b: fallback.b
        });
      }
    }
  }

  return palette;
}

export function findNearestPaletteColor(pixel, palette) {
  return palette[findNearestPaletteIndex(pixel, palette)];
}

export function findNearestPaletteIndex(pixel, palette) {
  let bestIndex = 0;
  let bestDistance = Infinity;

  for (let i = 0; i < palette.length; i++) {
    const color = palette[i];

    const dL = pixel.L - color.L;
    const da = pixel.a - color.a;
    const db = pixel.b - color.b;

    const distance = dL * dL + da * da + db * db;

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function makeEqualLightnessLevels(pixels, count, lightnessMode) {
  let minL;
  let maxL;

  if (lightnessMode === "full") {
    minL = 0;
    maxL = 1;
  } else {
    const sorted = pixels.map(p => p.L).sort((a, b) => a - b);

    // Ignore extreme outliers for a better-looking palette.
    minL = percentileFromSorted(sorted, 0.01);
    maxL = percentileFromSorted(sorted, 0.99);

    // Avoid near-zero lightness spread.
    if (maxL - minL < 0.08) {
      const center = (minL + maxL) / 2;
      minL = Math.max(0, center - 0.04);
      maxL = Math.min(1, center + 0.04);
    }
  }

  const denominator = Math.max(1, count - 1);

  return Array.from({ length: count }, (_, i) => {
    return minL + (i / denominator) * (maxL - minL);
  });
}

function initializePaletteFromLightnessBuckets(pixels, lightnessLevels) {
  const count = lightnessLevels.length;

  const buckets = Array.from({ length: count }, () => ({
    a: 0,
    b: 0,
    count: 0
  }));

  for (const pixel of pixels) {
    let bestIndex = 0;
    let bestDistance = Infinity;

    for (let i = 0; i < count; i++) {
      const dL = pixel.L - lightnessLevels[i];
      const distance = dL * dL;

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    buckets[bestIndex].a += pixel.a;
    buckets[bestIndex].b += pixel.b;
    buckets[bestIndex].count++;
  }

  return lightnessLevels.map((L, i) => {
    if (buckets[i].count > 0) {
      return gamutMapOklab({
        L,
        a: buckets[i].a / buckets[i].count,
        b: buckets[i].b / buckets[i].count
      });
    }

    const fallback = nearestNonEmptyCluster(i, buckets, null);

    return gamutMapOklab({
      L,
      a: fallback.a,
      b: fallback.b
    });
  });
}

function nearestNonEmptyCluster(index, sums, currentPalette) {
  for (let distance = 1; distance < sums.length; distance++) {
    const left = index - distance;
    const right = index + distance;

    if (left >= 0 && sums[left].count > 0) {
      return {
        a: sums[left].a / sums[left].count,
        b: sums[left].b / sums[left].count
      };
    }

    if (right < sums.length && sums[right].count > 0) {
      return {
        a: sums[right].a / sums[right].count,
        b: sums[right].b / sums[right].count
      };
    }
  }

  if (currentPalette && currentPalette[index]) {
    return currentPalette[index];
  }

  return { a: 0, b: 0 };
}

function percentileFromSorted(sorted, t) {
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.round(t * (sorted.length - 1)))
  );

  return sorted[index];
}
