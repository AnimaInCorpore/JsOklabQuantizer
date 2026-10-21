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
const resizedImagesEl = document.getElementById("resizedImages");
const croppedImagesEl = document.getElementById("croppedImages");
const paletteEl = document.getElementById("palette");
const croppedPaletteEl = document.getElementById("croppedPalette");
const originalPaletteEl = document.getElementById("originalPalette");
const fatnessBiasInput = document.getElementById("fatnessBias");
const fatnessBiasValue = document.getElementById("fatnessBiasValue");
const colorDecayInput = document.getElementById("colorDecay");
const colorDecayValue = document.getElementById("colorDecayValue");

let processToken = 0;

// Per-image pixel data and output contexts for the most recent batch, kept so
// the sliders can re-quantize without re-decoding the files.
let images = [];

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
  processFiles(event.target.files);
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
  processFiles(event.dataTransfer.files);
});

async function processFiles(fileList) {
  const files = Array.from(fileList).filter(file =>
    file.type.startsWith("image/")
  );

  if (files.length === 0) {
    return;
  }

  const token = ++processToken;
  const bitmaps = await Promise.all(files.map(file => createImageBitmap(file)));

  try {
    if (token !== processToken) {
      return;
    }

    resizedImagesEl.innerHTML = "";
    croppedImagesEl.innerHTML = "";
    images = [];

    for (let i = 0; i < bitmaps.length; i++) {
      const bitmap = bitmaps[i];
      const label = files[i].name;

      const resized = createImageRow(resizedImagesEl, label);
      const cropped = createImageRow(croppedImagesEl, label);

      drawSourceImage(resized.sourceCtx, bitmap, WIDTH, HEIGHT, false);
      drawSourceImage(cropped.sourceCtx, bitmap, WIDTH, HEIGHT, true);

      const originalCanvas = document.createElement("canvas");
      originalCanvas.width = bitmap.width;
      originalCanvas.height = bitmap.height;
      const originalCtx = originalCanvas.getContext("2d");
      originalCtx.drawImage(bitmap, 0, 0);

      images.push({
        originalPixels: extractLabs(
          originalCtx.getImageData(0, 0, bitmap.width, bitmap.height).data
        ).filter(pixel => pixel.alpha > 0),
        resizedPixels: extractLabs(
          resized.sourceCtx.getImageData(0, 0, WIDTH, HEIGHT).data
        ),
        croppedPixels: extractLabs(
          cropped.sourceCtx.getImageData(0, 0, WIDTH, HEIGHT).data
        ),
        resizedOutputCtx: resized.outputCtx,
        croppedOutputCtx: cropped.outputCtx
      });
    }

    renderQuantization();
  } finally {
    for (const bitmap of bitmaps) {
      if (typeof bitmap.close === "function") {
        bitmap.close();
      }
    }
  }
}

function renderQuantization() {
  if (images.length === 0) {
    return;
  }

  const fatnessBias = Number(fatnessBiasInput.value);
  const colorDecay = Number(colorDecayInput.value);

  const options = {
    iterations: KMEANS_ITERATIONS,
    lightnessMode: LIGHTNESS_MODE,
    fatnessBias,
    colorDecay
  };

  // Sum every image's pixels into a single pool so one shared palette covers
  // the whole set.
  const allResized = [];
  const allCropped = [];
  const allOriginal = [];

  for (const image of images) {
    for (const pixel of image.originalPixels) {
      allOriginal.push(pixel);
    }
    for (const pixel of image.resizedPixels) {
      if (pixel.alpha > 0) {
        allResized.push(pixel);
      }
    }
    for (const pixel of image.croppedPixels) {
      if (pixel.alpha > 0) {
        allCropped.push(pixel);
      }
    }
  }

  const resizedPalette = buildConstrainedOklabPalette(
    allResized,
    COLOR_COUNT,
    options
  );
  const croppedPalette = buildConstrainedOklabPalette(
    allCropped,
    COLOR_COUNT,
    options
  );
  const originalPalette = buildConstrainedOklabPalette(
    allOriginal,
    COLOR_COUNT,
    options
  );

  for (const image of images) {
    renderQuantizedImage(image.resizedOutputCtx, image.resizedPixels, resizedPalette);
    renderQuantizedImage(image.croppedOutputCtx, image.croppedPixels, croppedPalette);
  }

  renderPalette(paletteEl, resizedPalette);
  renderPalette(croppedPaletteEl, croppedPalette);
  renderPalette(originalPaletteEl, originalPalette);
}

// Build a "<source> | <quantized>" row of canvases for one image and return
// their drawing contexts.
function createImageRow(container, label) {
  const row = document.createElement("div");
  row.className = "row";

  const sourceCtx = appendCanvasPanel(row, `Source (2x) — ${label}`);
  const outputCtx = appendCanvasPanel(row, `Quantized (2x) — ${label}`);

  container.appendChild(row);

  return { sourceCtx, outputCtx };
}

function appendCanvasPanel(row, title) {
  const panel = document.createElement("section");
  panel.className = "panel";

  const heading = document.createElement("h2");
  heading.textContent = title;

  const canvas = document.createElement("canvas");
  canvas.className = "preview-canvas";
  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  panel.appendChild(heading);
  panel.appendChild(canvas);
  row.appendChild(panel);

  return canvas.getContext("2d");
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
