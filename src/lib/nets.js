// Net (展開図) image plumbing shared by every box type: slicing an uploaded print sheet
// into per-face canvases, the hidden baseline corrections the 身蓋 box's real print
// files need, and the printable guide overlay. Moved out of PackageBoxMockup.jsx so
// the box-type geometry (boxModels.js) and the component can share it.
import { imgW, imgH, cropFractions, rotatedImageCanvas, mirroredImageCanvas, hexToRgba } from "./imaging.js";


// hidden baseline corrections for uploaded net images — most real print files need the
// same fix, so these are applied unconditionally to the SLICING pipeline only. The crop
// editor/guide preview deliberately shows the raw uploaded file instead (see
// orientedTransform/rawSpaceLayout below), converting crop percentages between the two
// coordinate spaces so what the user sees while trimming matches their own file.
// cyan guide lines; a literal hex because it paints into canvases and <input type=color>
export const DEFAULT_GUIDE_COLOR = "#5fd3d9";

export const BODY_ORIENT = { baselineRotate: 180, mirror: true };
export const LID_ORIENT = { baselineRotate: 180 };

// per-face rotate/flipH/flipV applied directly to each already-sliced face canvas, on
// top of the BODY_ORIENT/LID_ORIENT baseline above. Values found empirically by the
// user while comparing the real artwork against the real rendered box — do not
// "simplify" these against theory, they're ground truth.
export const DEFAULT_FACE_TRANSFORMS = {
  "body-front": { rotate: 0, flipH: false, flipV: true },
  "body-back": { rotate: 0, flipH: true, flipV: false },
  "body-left": { rotate: 0, flipH: false, flipV: true },
  "body-right": { rotate: 0, flipH: false, flipV: true },
  "body-center": { rotate: 0, flipH: false, flipV: true },
  "lid-front": { rotate: 0, flipH: false, flipV: false },
  "lid-back": { rotate: 0, flipH: true, flipV: true },
  "lid-left": { rotate: 0, flipH: false, flipV: false },
  "lid-right": { rotate: 0, flipH: false, flipV: false },
  "lid-center": { rotate: 0, flipH: false, flipV: false },
  "lid-inner": { rotate: 0, flipH: false, flipV: false },
};

export const FACE_LABELS = {
  "body-front": "身・正面",
  "body-back": "身・背面",
  "body-left": "身・左側面",
  "body-right": "身・右側面",
  "body-center": "身・底面",
  "lid-front": "蓋・正面",
  "lid-back": "蓋・背面",
  "lid-left": "蓋・左側面",
  "lid-right": "蓋・右側面",
  "lid-center": "蓋・天面",
  "lid-inner": "蓋・裏面(内側)",
};

export function netLayout(W, D, H, prefix) {
  const totalW = 2 * H + W;
  const totalH = 2 * H + D;
  return {
    totalW,
    totalH,
    regions: [
      { key: `${prefix}-back`, x: H, y: 0, w: W, h: H, rotate: 0 },
      { key: `${prefix}-center`, x: H, y: H, w: W, h: D, rotate: 0 },
      { key: `${prefix}-front`, x: H, y: H + D, w: W, h: H, rotate: 0 },
      { key: `${prefix}-left`, x: 0, y: H, w: H, h: D, rotate: -90 },
      { key: `${prefix}-right`, x: H + W, y: H, w: H, h: D, rotate: 90 },
    ],
  };
}

// a single-face "net": used for the lid's underside, which isn't part of any fold —
// just one flat rectangle sourced from its own image.
export function singleFaceLayout(key, w, h) {
  return { totalW: w, totalH: h, regions: [{ key, x: 0, y: 0, w, h, rotate: 0 }] };
}

// applies each face's own baked-in rotate/flipH/flipV (see DEFAULT_FACE_TRANSFORMS)
// directly to its already-sliced canvas.
export function applyFaceTransform(canvas, dt) {
  const rotate = ((dt?.rotate || 0) % 360 + 360) % 360;
  const flipH = !!dt?.flipH;
  const flipV = !!dt?.flipV;
  if (rotate === 0 && !flipH && !flipV) return canvas;
  const swapped = rotate === 90 || rotate === 270;
  const out = document.createElement("canvas");
  out.width = swapped ? canvas.height : canvas.width;
  out.height = swapped ? canvas.width : canvas.height;
  const ctx = out.getContext("2d");
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

// applies transform.rotate (if any) once, so downstream crop/slice math never has to
// think about source rotation — everything else just treats this as "the image".
// `baselineRotate`/`mirror` are hidden, fixed corrections (not shown in the UI) applied
// on top of the user's own rotate value, for source files that consistently need the
// same fix — the rotate button/label still reads relative to this shifted baseline.
export function orientedImage(img, transform, opts) {
  const baselineRotate = opts?.baselineRotate || 0;
  const deg = ((baselineRotate + (transform?.rotate || 0)) % 360 + 360) % 360;
  let out = deg ? rotatedImageCanvas(img, deg) : img;
  if (opts?.mirror) out = mirroredImageCanvas(out);
  return out;
}

// rotates a set of edge-trim amounts {top,bottom,left,right} the same way a canvas
// rotation (clockwise, ctx.rotate) would move those edges — e.g. after a 90° rotation,
// whatever used to trim the left edge now trims the top.
function rotateEdges(edges, degrees) {
  const deg = ((degrees % 360) + 360) % 360;
  const { top, bottom, left, right } = edges;
  if (deg === 90) return { top: left, right: top, bottom: right, left: bottom };
  if (deg === 180) return { top: bottom, bottom: top, left: right, right: left };
  if (deg === 270) return { top: right, right: bottom, bottom: left, left: top };
  return edges;
}
function mirrorEdgesH(edges) {
  return { ...edges, left: edges.right, right: edges.left };
}

// the crop UI always edits top/bottom/left/right against the RAW uploaded image (so
// what the user sees while trimming matches their own file), but slicing samples from
// the oriented (baselineRotate+mirror) image — this converts one set of edge-trim
// percentages into the other so extractFaceCanvas keeps working exactly as before.
export function orientedTransform(transform, opts) {
  const totalDeg = (((opts?.baselineRotate || 0) + (transform?.rotate || 0)) % 360 + 360) % 360;
  let edges = rotateEdges(
    {
      top: transform?.cropTop || 0,
      bottom: transform?.cropBottom || 0,
      left: transform?.cropLeft || 0,
      right: transform?.cropRight || 0,
    },
    totalDeg
  );
  if (opts?.mirror) edges = mirrorEdgesH(edges);
  return { ...transform, cropTop: edges.top, cropBottom: edges.bottom, cropLeft: edges.left, cropRight: edges.right };
}

// mirrors rawSpaceLayout's job but for the net-layout's region rectangles instead of
// crop percentages, so the grid overlay drawn over the raw (unbaselined) image still
// lines up with it. Only undoes the fixed baselineRotate(+mirror) — a user's own extra
// 90°/270° rotate (rare, explicit) is intentionally left uncorrected here since that
// would also require swapping the whole layout's width/height; the crop math above
// handles that case correctly even though this overlay wouldn't.
export function rawSpaceLayout(layout, opts) {
  const { totalW, totalH, regions } = layout;
  if ((opts?.baselineRotate || 0) !== 180) return layout;
  const rawRegions = regions.map((r) => {
    let x = r.x;
    const y = totalH - r.y - r.h;
    if (!opts?.mirror) x = totalW - r.x - r.w;
    return { ...r, x, y };
  });
  return { totalW, totalH, regions: rawRegions };
}

export function extractFaceCanvas(img, region, netTotalW, netTotalH, transform) {
  const { cropLeft, cropRight, cropTop, cropBottom } = cropFractions(transform);
  const usableW = imgW(img) * Math.max(0.01, 1 - cropLeft - cropRight);
  const usableH = imgH(img) * Math.max(0.01, 1 - cropTop - cropBottom);
  const originX = imgW(img) * cropLeft;
  const originY = imgH(img) * cropTop;
  const pxPerMmX = usableW / netTotalW;
  const pxPerMmY = usableH / netTotalH;

  const sx = originX + region.x * pxPerMmX;
  const sy = originY + region.y * pxPerMmY;
  const sw = region.w * pxPerMmX;
  const sh = region.h * pxPerMmY;

  const totalRot = ((region.rotate % 360) + 360) % 360;
  const swapped = totalRot === 90 || totalRot === 270;
  const outW = Math.max(1, Math.round(swapped ? sh : sw));
  const outH = Math.max(1, Math.round(swapped ? sw : sh));
  // draw into exactly the rounded canvas size (not the fractional sw/sh) so adjacent
  // faces never leave a sub-pixel gap/overlap at their shared edge
  const destW = swapped ? outH : outW;
  const destH = swapped ? outW : outH;

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  // unprinted paper: anything the image doesn't cover (a trim reaching past the
  // image, or a transparent PNG) would otherwise upload as transparent and render black
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((totalRot * Math.PI) / 180);
  ctx.drawImage(img, sx, sy, sw, sh, -destW / 2, -destH / 2, destW, destH);
  ctx.restore();
  return canvas;
}

// `opts.maxPx` caps the canvas size (for on-screen thumbnails; the default is the
// 300ppi print resolution)
export function drawNetGuide(canvas, layoutLocal, img, transform, lineColor, opts) {
  // a literal color, never var(--token): this is a canvas (and a downloadable print
  // guide), and canvas 2D rejects CSS custom properties without any error
  const guideStroke = /^#/.test(lineColor || "") ? lineColor : DEFAULT_GUIDE_COLOR;
  // real-world print resolution: 300ppi = 300px / 25.4mm
  const TARGET_PX_PER_MM = 300 / 25.4;
  const MAX_DIM = 16000; // safety cap so only extreme box sizes fall back from true 300ppi (browser canvas limits)
  const naturalW = layoutLocal.totalW * TARGET_PX_PER_MM;
  const naturalH = layoutLocal.totalH * TARGET_PX_PER_MM;
  const clamp = Math.min(1, (opts?.maxPx || MAX_DIM) / Math.max(naturalW, naturalH));
  const pxPerMm = TARGET_PX_PER_MM * clamp;
  const s = pxPerMm / 2.4; // scale visual guide elements (line widths, fonts) relative to original tuning

  canvas.width = Math.round(layoutLocal.totalW * pxPerMm);
  canvas.height = Math.round(layoutLocal.totalH * pxPerMm);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#12203a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (img) {
    // draw the source artwork underneath the grid, honoring the same crop transform
    // used when slicing textures, so numeric trim adjustments are previewable here
    const { cropLeft, cropRight, cropTop, cropBottom } = cropFractions(transform);
    const usableW = imgW(img) * Math.max(0.01, 1 - cropLeft - cropRight);
    const usableH = imgH(img) * Math.max(0.01, 1 - cropTop - cropBottom);
    const originX = imgW(img) * cropLeft;
    const originY = imgH(img) * cropTop;
    const drawScaleX = pxPerMm / (usableW / layoutLocal.totalW);
    const drawScaleY = pxPerMm / (usableH / layoutLocal.totalH);
    ctx.drawImage(
      img,
      -originX * drawScaleX,
      -originY * drawScaleY,
      imgW(img) * drawScaleX,
      imgH(img) * drawScaleY
    );
  }

  layoutLocal.regions.forEach((r) => {
    const x = r.x * pxPerMm;
    const y = r.y * pxPerMm;
    const w = r.w * pxPerMm;
    const h = r.h * pxPerMm;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const label = r.label || FACE_LABELS[r.key] || r.key;

    // non-face regions (のりしろ / 差し込み) are part of a real print sheet but never
    // visible on the finished box — drawn so the guide is usable as an actual
    // template, but greyed and without an orientation arrow so nobody puts art there
    if (r.face === false) {
      ctx.fillStyle = "rgba(160,170,180,0.18)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#8a96a3";
      ctx.setLineDash([3 * s, 3 * s]);
      ctx.lineWidth = 1 * s;
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      ctx.fillStyle = "#b8c2cc";
      ctx.font = `${9 * s}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, cx, cy);
      ctx.textBaseline = "alphabetic";
      return;
    }

    ctx.strokeStyle = guideStroke;
    ctx.setLineDash([6 * s, 4 * s]);
    ctx.lineWidth = 1.5 * s;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = hexToRgba(guideStroke, 0.06);
    ctx.fillRect(x, y, w, h);

    // orientation arrow: points at the edge of this region that becomes the TOP of the
    // artwork once the sheet is folded. Regions of a physically-correct net aren't all
    // upright — a back panel in a wrap-around strip prints upside down, an end flap
    // prints sideways — so `arrowRotate` (degrees, clockwise) turns the arrow to match.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((r.arrowRotate || 0) * Math.PI) / 180);
    ctx.strokeStyle = "#ffb454";
    ctx.lineWidth = 1 * s;
    ctx.beginPath();
    ctx.moveTo(0, 10 * s);
    ctx.lineTo(0, -10 * s);
    ctx.lineTo(-5 * s, -4 * s);
    ctx.moveTo(0, -10 * s);
    ctx.lineTo(5 * s, -4 * s);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#eef6f6";
    ctx.font = `${11 * s}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(label, cx, y + 14 * s);
    ctx.font = `${9 * s}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = "#9fb3c8";
    ctx.fillText(`${Math.round(r.w)}×${Math.round(r.h)}mm`, cx, y + h - 6 * s);
  });

  ctx.strokeStyle = "#3a5a78";
  ctx.lineWidth = 1 * s;
  ctx.strokeRect(0.5 * s, 0.5 * s, canvas.width - 1 * s, canvas.height - 1 * s);
}
