// "symbol" library: an Illustrator-symbol-style reusable asset — register an image
// (with its own crop) plus a tint color ONCE, then card/piece instances just pick which
// symbol to display. Shared between cards and pieces since both are "a shape with one
// printed face + a body color" underneath.
import { cropToCanvas, imgW, imgH } from "./imaging.js";

export const DEFAULT_SYMBOL_COLOR = "#c9b896";

export function createSymbol({ id, name, img = null, fileName = "", transform = { cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 }, color = DEFAULT_SYMBOL_COLOR }) {
  return { id, name, img, fileName, transform, color };
}

// bakes a symbol into a single opaque canvas: the symbol's tint color fills the
// background, and its (optionally cropped) image is drawn on top at native resolution —
// so PNG transparency shows the tint color through it, and opaque art fully replaces it.
// Deliberately NOT stretched to any particular face's aspect ratio here — the caller
// maps this onto a face's UV using coverFitRepeatOffset (imaging.js) so the texture
// crops to fit (like CSS background-size:cover) instead of distorting.
export function buildSymbolFaceCanvas(symbol) {
  if (!symbol?.img) {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = symbol?.color || DEFAULT_SYMBOL_COLOR;
    ctx.fillRect(0, 0, 8, 8);
    return canvas;
  }
  const cropped = cropToCanvas(symbol.img, symbol.transform);
  const canvas = document.createElement("canvas");
  canvas.width = cropped.width;
  canvas.height = cropped.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = symbol.color || DEFAULT_SYMBOL_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(cropped, 0, 0);
  return canvas;
}

export function symbolThumbSrc(symbol) {
  if (symbol?.img) return symbol.img.src || symbol.img.toDataURL?.();
  return null;
}

export function symbolAspect(symbol) {
  if (!symbol?.img) return 1;
  return imgW(symbol.img) / imgH(symbol.img);
}
