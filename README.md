# JsOklabQuantizer

A small browser-based image quantizer that reduces an image to a 16-color palette in Oklab space.

## What it does

- Accepts an image by drag-and-drop or file picker
- Crops and resizes the source image to `320x200` when the aspect ratio does not match
- Also shows a cropped-only source preview and matching quantized result for comparison
- Builds a constrained 16-color palette with Oklab k-means clustering
- Preserves transparency
- Shows the generated palette

## How to use

1. Serve the project from a local web server.
2. Open `index.html` in your browser.
3. Drop an image onto the page or click the drop area to choose a file.
4. Review the resized source preview, cropped source preview, and both quantized results.
5. Review the rendered output and palette.

### Local server example

If you have Python installed:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Implementation notes

- The palette is generated in Oklab rather than RGB for more perceptually balanced color grouping.
- Lightness is distributed across the palette while chroma is clustered from the source image.
- Out-of-gamut colors are mapped back into sRGB by reducing chroma while preserving lightness.

## Project structure

- `index.html` - Minimal UI and page shell
- `js/main.mjs` - File handling, image processing, and rendering
- `js/quantizer.mjs` - Palette construction and nearest-color lookup
- `js/color.mjs` - Oklab and sRGB conversion helpers

## License

No license has been specified yet.
