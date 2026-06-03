import {
  gamutMapOklab,
  isInSrgbGamut,
  oklabToLinearSrgb
} from "./color.mjs";

// Default for how strongly the lightness ladder bends toward the "fatter" parts
// of the OKLab body. 0 keeps even spacing; 1 places levels purely by gamut
// volume. Override per call via the fatnessBias option.
const DEFAULT_FATNESS_BIAS = 0.75;

export function buildConstrainedOklabPalette(
  pixels,
  count,
  {
    iterations = 18,
    lightnessMode = "image",
    fatnessBias = DEFAULT_FATNESS_BIAS
  } = {}
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
    lightnessMode,
    fatnessBias
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

function makeEqualLightnessLevels(pixels, count, lightnessMode, fatnessBias) {
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

  return makeFatnessWeightedLevels(minL, maxL, count, fatnessBias);
}

// Distribute the lightness ladder so that more levels land where the sRGB
// gamut is "fat" in OKLab (the mid-tones, which hold far more colors than the
// near-black and near-white tips of the body). Levels are placed at equal
// cumulative gamut area via inverse-CDF sampling, with the endpoints pinned.
function makeFatnessWeightedLevels(minL, maxL, count, fatnessBias) {
  const denominator = Math.max(1, count - 1);
  const bias = Math.max(0, Math.min(1, fatnessBias));

  if (maxL - minL < 1e-6) {
    return Array.from({ length: count }, () => minL);
  }

  const samples = 96;
  const ls = new Array(samples + 1);
  const density = new Array(samples + 1);

  let maxArea = 0;
  const areas = new Array(samples + 1);

  for (let i = 0; i <= samples; i++) {
    const L = minL + (i / samples) * (maxL - minL);
    ls[i] = L;
    areas[i] = gamutSliceArea(L);
    if (areas[i] > maxArea) {
      maxArea = areas[i];
    }
  }

  // Blend a flat baseline with the normalized gamut area so the dark and light
  // ends still receive levels instead of collapsing toward the middle.
  for (let i = 0; i <= samples; i++) {
    const normalized = maxArea > 0 ? areas[i] / maxArea : 0;
    density[i] = 1 - bias + bias * normalized;
  }

  // Trapezoidal integration of the density into a cumulative mass curve.
  const cumulative = new Array(samples + 1);
  cumulative[0] = 0;
  for (let i = 1; i <= samples; i++) {
    cumulative[i] = cumulative[i - 1] + (density[i] + density[i - 1]) / 2;
  }

  const total = cumulative[samples];
  if (total <= 0) {
    return Array.from({ length: count }, (_, i) =>
      minL + (i / denominator) * (maxL - minL)
    );
  }

  return Array.from({ length: count }, (_, i) => {
    const targetMass = (i / denominator) * total;
    return invertCumulative(cumulative, ls, targetMass);
  });
}

// Relative area of the sRGB gamut slice at this lightness in the OKLab a/b
// plane, summed as pie sectors from the max in-gamut chroma per hue.
function gamutSliceArea(L) {
  const hueSteps = 16;
  let area = 0;

  for (let h = 0; h < hueSteps; h++) {
    const angle = (h / hueSteps) * Math.PI * 2;
    const chroma = maxChromaAt(L, Math.cos(angle), Math.sin(angle));
    area += chroma * chroma; // sector area ∝ r²; constant factors cancel
  }

  return area;
}

// Largest chroma along the (ca, cb) direction whose color stays inside sRGB.
function maxChromaAt(L, ca, cb) {
  if (!isInSrgbGamut(oklabToLinearSrgb(L, 0, 0))) {
    return 0;
  }

  let low = 0;
  let high = 0.5; // sRGB chroma in OKLab never reaches this far

  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;

    if (isInSrgbGamut(oklabToLinearSrgb(L, ca * mid, cb * mid))) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

// Find L where the cumulative curve reaches targetMass (linear interpolation).
function invertCumulative(cumulative, ls, targetMass) {
  const n = cumulative.length - 1;

  if (targetMass <= cumulative[0]) {
    return ls[0];
  }

  for (let i = 1; i <= n; i++) {
    if (cumulative[i] >= targetMass) {
      const span = cumulative[i] - cumulative[i - 1];
      const t = span > 0 ? (targetMass - cumulative[i - 1]) / span : 0;

      return ls[i - 1] + t * (ls[i] - ls[i - 1]);
    }
  }

  return ls[n];
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
