// Appearance helpers for flat components (cards, tokens, pieces): "a shape, extruded
// to a thickness, with a printed top face and a body color" — see shapes2d.js for the
// geometry side. A placed component owns all of this itself; library templates carry
// the same fields (lib/presets.js).
import { cropToCanvas } from "./imaging.js";

export const DEFAULT_COMPONENT_COLOR = "#c9b896";

export const COMPONENT_SHAPE_KINDS = [
  { key: "roundedSquare", label: "角丸四角" },
  { key: "roundTop", label: "上だけ角丸" },
  { key: "circle", label: "円" },
  { key: "hexagon", label: "六角形" },
  { key: "triangle", label: "三角形" },
];

// bakes a component into a single opaque canvas: the component's tint color fills the
// background, and its (optionally cropped) image is drawn on top at native resolution —
// so PNG transparency shows the tint color through it, and opaque art fully replaces it.
// Deliberately NOT stretched to any particular face's aspect ratio — the caller maps
// this onto a face's UV using coverFitRepeatOffset (imaging.js) so the texture crops to
// fit (like CSS background-size:cover) instead of distorting.
export function buildComponentFaceCanvas(component) {
  if (!component?.img) {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = component?.color || DEFAULT_COMPONENT_COLOR;
    ctx.fillRect(0, 0, 8, 8);
    return canvas;
  }
  const cropped = cropToCanvas(component.img, component.transform);
  const canvas = document.createElement("canvas");
  canvas.width = cropped.width;
  canvas.height = cropped.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = component.color || DEFAULT_COMPONENT_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(cropped, 0, 0);
  return canvas;
}

// preview source for the library/instance thumbnails. Returns the CROPPED image, not
// the raw upload — otherwise trimming an image visibly changes the 3D face while the
// thumbnail keeps showing the untrimmed original, which reads as "trim isn't working".
export function componentThumbSrc(component) {
  if (!component?.img) return null;
  const t = component.transform;
  const uncropped = !t || (!t.cropTop && !t.cropBottom && !t.cropLeft && !t.cropRight);
  if (uncropped) return component.img.src || component.img.toDataURL?.();
  return cropToCanvas(component.img, t).toDataURL();
}
