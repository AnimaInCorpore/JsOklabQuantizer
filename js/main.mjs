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
const outputCanvas = document.getElementById("outputCanvas");
const paletteEl = document.getElementById("palette");
const downloadBtn = document.getElementById("downloadBtn");

const sourceCtx = sourceCanvas.getContext("2d");
const outputCtx = outputCanvas.getContext("2d");

dropzone.addEventListener("click", () => fileInput.click());

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

downloadBtn.addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "oklab-16-color-quantized.png";
  link.href = outputCanvas.toDataURL("image/png");
  link.click();
});

async function processFile(file) {
  const bitmap = await createImageBitmap(file);

  sourceCtx.clearRect(0, 0, WIDTH, HEIGHT);
  sourceCtx.drawImage(bitmap, 0, 0, WIDTH, HEIGHT);

  const imageData = sourceCtx.getImageData(0, 0, WIDTH, HEIGHT);
  const data = imageData.data;

  const labs = [];

  for (let i = 0; i < data.length; i += 4) {
    const lab = rgb8ToOklab(data[i], data[i + 1], data[i + 2]);

    labs.push({
      L: lab.L,
      a: lab.a,
      b: lab.b,
      alpha: data[i + 3]
    });
  }

  const opaqueLabs = labs.filter(p => p.alpha > 0);
  const palette = buildConstrainedOklabPalette(
    opaqueLabs,
    COLOR_COUNT,
    {
      iterations: KMEANS_ITERATIONS,
      lightnessMode: LIGHTNESS_MODE
    }
  );

  const out = outputCtx.createImageData(WIDTH, HEIGHT);

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

  outputCtx.putImageData(out, 0, 0);
  renderPalette(palette);
  downloadBtn.disabled = false;
}

function renderPalette(palette) {
  paletteEl.innerHTML = "";

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

    paletteEl.appendChild(swatch);
  }
}
