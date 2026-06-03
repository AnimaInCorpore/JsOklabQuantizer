export function rgb8ToOklab(r8, g8, b8) {
  const r = srgbToLinear(r8 / 255);
  const g = srgbToLinear(g8 / 255);
  const b = srgbToLinear(b8 / 255);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  };
}

export function oklabToRgb8(L, a, b) {
  const rgb = oklabToLinearSrgb(L, a, b);

  return {
    r: Math.round(clamp01(linearToSrgb(rgb.r)) * 255),
    g: Math.round(clamp01(linearToSrgb(rgb.g)) * 255),
    b: Math.round(clamp01(linearToSrgb(rgb.b)) * 255)
  };
}

export function gamutMapOklab(color) {
  const { L, a, b } = color;

  if (isInSrgbGamut(oklabToLinearSrgb(L, a, b))) {
    return { L, a, b };
  }

  let low = 0;
  let high = 1;

  // Reduce chroma toward gray while preserving L.
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;

    if (isInSrgbGamut(oklabToLinearSrgb(L, a * mid, b * mid))) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return {
    L,
    a: a * low,
    b: b * low
  };
}

export function isInSrgbGamut(rgb) {
  return (
    rgb.r >= 0 && rgb.r <= 1 &&
    rgb.g >= 0 && rgb.g <= 1 &&
    rgb.b >= 0 && rgb.b <= 1
  );
}

export function oklabToLinearSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  };
}

function srgbToLinear(value) {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value) {
  return value <= 0.0031308
    ? 12.92 * value
    : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
