// unified "component" registry: replaces the old separate symbol library (image+color)
// and piece shape library (kind+dims) — a component now bundles EVERYTHING about one
// reusable design (shape, size, color, image) in a single entry, and a placed instance
// just picks which component to show. "Card" and "piece" are no longer distinct data
// types; they're only quick-start PRESETS (default values) offered when registering a
// new component — a "card-preset" component is just a thin rounded-rect that's free to
// be edited into any other shape afterward, same as a "piece-preset" component could be
// thinned out into something card-like. This matches the physical intuition that both
// are "a shape, extruded to a thickness, with a printed face and a body color" — see
// shapes2d.js for the geometry side of that unification.
import { cropToCanvas, imgW, imgH } from "./imaging.js";

export const DEFAULT_COMPONENT_COLOR = "#c9b896";

export const COMPONENT_SHAPE_KINDS = [
  { key: "roundedSquare", label: "角丸四角" },
  { key: "circle", label: "円" },
  { key: "hexagon", label: "六角形" },
  { key: "triangle", label: "三角形" },
];

export const COMPONENT_PRESETS = {
  card: { label: "カード用(薄い角丸)", kind: "roundedSquare", w: 63, d: 88, thickness: 1.5, cornerRadius: 3 },
  piece: { label: "駒用(厚い円形)", kind: "circle", w: 24, d: 24, thickness: 8, cornerRadius: 0 },
};

export function createComponent({ id, name, presetKey = "card", color, img = null, fileName = "", transform }) {
  const preset = COMPONENT_PRESETS[presetKey] || COMPONENT_PRESETS.card;
  return {
    id,
    name,
    kind: preset.kind,
    w: preset.w,
    d: preset.d,
    thickness: preset.thickness,
    cornerRadius: preset.cornerRadius,
    svgText: null, // only set when kind === "svg" (re-parsed at geometry-build time)
    img,
    fileName,
    transform: transform || { cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
    color: color || DEFAULT_COMPONENT_COLOR,
  };
}

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

export function componentThumbSrc(component) {
  if (component?.img) return component.img.src || component.img.toDataURL?.();
  return null;
}

export function componentAspect(component) {
  if (!component?.img) return 1;
  return imgW(component.img) / imgH(component.img);
}
