import {
  buildConstrainedOklabPalette,
  findNearestPaletteColor
} from "./quantizer.mjs";
import { oklabToRgb8, rgb8ToOklab } from "./color.mjs";

const WIDTH = 320;
const HEIGHT = 200;
const COLOR_COUNT = 16;
const KMEANS_ITERATIONS = 18;

// "image" gives better image-specific results.
// "full" forces L values to be exactly 0/15, 1/15, ... 15/15.
const LIGHTNESS_MODE = "image";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const sourceCanvas = document.getElementById("sourceCanvas");
const croppedSourceCanvas = document.getElementById("croppedSourceCanvas");
const outputCanvas = document.getElementById("outputCanvas");
const croppedOutputCanvas = document.getElementById("croppedOutputCanvas");
const paletteEl = document.getElementById("palette");
const croppedPaletteEl = document.getElementById("croppedPalette");
const fatnessBiasInput = document.getElementById("fatnessBias");
const fatnessBiasValue = document.getElementById("fatnessBiasValue");
const colorDecayInput = document.getElementById("colorDecay");
const colorDecayValue = document.getElementById("colorDecayValue");

const sourceCtx = sourceCanvas.getContext("2d");
const croppedSourceCtx = croppedSourceCanvas.getContext("2d");
const outputCtx = outputCanvas.getContext("2d");
const croppedOutputCtx = croppedOutputCanvas.getContext("2d");

let processToken = 0;

// Pixels of the most recent image, kept so the bias slider can re-quantize
// without re-decoding the file.
let lastPixels = null;

dropzone.addEventListener("click", () => fileInput.click());

fatnessBiasInput.addEventListener("input", () => {
  fatnessBiasValue.textContent = Number(fatnessBiasInput.value).toFixed(2);
  renderQuantization();
});

colorDecayInput.addEventListener("input", () => {
  colorDecayValue.textContent = Number(colorDecayInput.value).toFixed(2);
  renderQuantization();
});

fileInput.addEventListener("change", event => {
  const file = event.target.files[0];
  if (file) {
    processFile(file);
  }
});

dropzone.addEventListener("dragover", event => {
  event.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragover");
});

dropzone.addEventListener("drop", event => {
  event.preventDefault();
  dropzone.classList.remove("dragover");

  const file = event.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) {
    processFile(file);
  }
});

async function processFile(file) {
  const token = ++processToken;
  const bitmap = await createImageBitmap(file);

  try {
    if (token !== processToken) {
      return;
    }

    drawSourceImage(sourceCtx, bitmap, WIDTH, HEIGHT, false);
    drawSourceImage(croppedSourceCtx, bitmap, WIDTH, HEIGHT, true);

    const resizedPixels = extractLabs(sourceCtx.getImageData(0, 0, WIDTH, HEIGHT).data);
    const croppedPixels = extractLabs(
      croppedSourceCtx.getImageData(0, 0, WIDTH, HEIGHT).data
    );

    lastPixels = { resizedPixels, croppedPixels };
    renderQuantization();
  } finally {
    if (typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

function renderQuantization() {
  if (!lastPixels) {
    return;
  }

  const { resizedPixels, croppedPixels } = lastPixels;
  const fatnessBias = Number(fatnessBiasInput.value);
  const colorDecay = Number(colorDecayInput.value);

  const options = {
    iterations: KMEANS_ITERATIONS,
    lightnessMode: LIGHTNESS_MODE,
    fatnessBias,
    colorDecay
  };

  const resizedPalette = buildConstrainedOklabPalette(
    resizedPixels.filter(p => p.alpha > 0),
    COLOR_COUNT,
    options
  );
  const croppedPalette = buildConstrainedOklabPalette(
    croppedPixels.filter(p => p.alpha > 0),
    COLOR_COUNT,
    options
  );

  renderQuantizedImage(outputCtx, resizedPixels, resizedPalette);
  renderQuantizedImage(croppedOutputCtx, croppedPixels, croppedPalette);
  renderPalette(paletteEl, resizedPalette);
  renderPalette(croppedPaletteEl, croppedPalette);
}

function drawSourceImage(ctx, image, targetWidth, targetHeight, cropOnly) {
  ctx.clearRect(0, 0, targetWidth, targetHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  if (cropOnly) {
    const cropWidth = Math.min(targetWidth, image.width);
    const cropHeight = Math.min(targetHeight, image.height);
    const sx = Math.floor((image.width - cropWidth) / 2);
    const sy = Math.floor((image.height - cropHeight) / 2);
    const dx = Math.floor((targetWidth - cropWidth) / 2);
    const dy = Math.floor((targetHeight - cropHeight) / 2);

    ctx.drawImage(
      image,
      sx,
      sy,
      cropWidth,
      cropHeight,
      dx,
      dy,
      cropWidth,
      cropHeight
    );

    return;
  }

  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const targetAspect = targetWidth / targetHeight;
  const sourceAspect = sourceWidth / sourceHeight;

  let sx = 0;
  let sy = 0;
  let sWidth = sourceWidth;
  let sHeight = sourceHeight;

  if (sourceAspect > targetAspect) {
    sWidth = sourceHeight * targetAspect;
    sx = (sourceWidth - sWidth) / 2;
  } else if (sourceAspect < targetAspect) {
    sHeight = sourceWidth / targetAspect;
    sy = (sourceHeight - sHeight) / 2;
  }

  ctx.clearRect(0, 0, targetWidth, targetHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    image,
    sx,
    sy,
    sWidth,
    sHeight,
    0,
    0,
    targetWidth,
    targetHeight
  );
}

function extractLabs(data) {
  const labs = [];

  for (let i = 0; i < data.length; i += 4) {
    const lab = rgb8ToOklab(data[i], data[i + 1], data[i + 2]);

    labs.push({
      L: lab.L,
      a: lab.a,
      b: lab.b,
      alpha: data[i + 3],
      // Packed RGB identity; identical source pixels share a key so the decay
      // function can down-weight repeats within a cluster.
      key: (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
    });
  }

  return labs;
}

function renderQuantizedImage(ctx, labs, palette) {
  const out = ctx.createImageData(WIDTH, HEIGHT);

  for (let p = 0; p < labs.length; p++) {
    const lab = labs[p];

    if (lab.alpha === 0) {
      out.data[p * 4 + 3] = 0;
      continue;
    }

    const nearest = findNearestPaletteColor(lab, palette);
    const rgb = oklabToRgb8(nearest.L, nearest.a, nearest.b);

    out.data[p * 4] = rgb.r;
    out.data[p * 4 + 1] = rgb.g;
    out.data[p * 4 + 2] = rgb.b;
    out.data[p * 4 + 3] = lab.alpha;
  }

  ctx.putImageData(out, 0, 0);
}

function renderPalette(targetEl, palette) {
  targetEl.innerHTML = "";

  for (let i = 0; i < palette.length; i++) {
    const color = palette[i];
    const rgb = oklabToRgb8(color.L, color.a, color.b);

    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.style.backgroundColor = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    swatch.title =
      `Color ${i + 1}: ` +
      `L=${color.L.toFixed(4)}, ` +
      `A=${color.a.toFixed(4)}, ` +
      `B=${color.b.toFixed(4)}`;

    targetEl.appendChild(swatch);
  }
}
