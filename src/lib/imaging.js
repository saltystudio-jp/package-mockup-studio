// shared canvas/image utilities used by the box net-slicing pipeline AND the
// card/piece symbol library (crop, tint, clipboard paste, etc.) — extracted so
// new object types don't have to duplicate this logic.

// works with either an <img> (naturalWidth/Height) or a <canvas> (width/height)
export function imgW(img) {
  return img.naturalWidth ?? img.width;
}
export function imgH(img) {
  return img.naturalHeight ?? img.height;
}

// rotates a whole uploaded image by 0/90/180/270deg into a fresh canvas, for source
// files that were exported sideways/upside-down relative to our net template.
export function rotatedImageCanvas(img, degrees) {
  const w = imgW(img);
  const h = imgH(img);
  const swapped = degrees === 90 || degrees === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swapped ? h : w;
  canvas.height = swapped ? w : h;
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2);
  return canvas;
}

export function mirroredImageCanvas(img) {
  const w = imgW(img);
  const h = imgH(img);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, 0);
  return canvas;
}

// `transform` places the target frame over the uploaded image: each value is how far
// that edge of the frame sits INSIDE the image's own edge, in % of the image's
// width/height. Negative means the frame reaches past the image (the image was scaled
// below the frame, or pushed off to one side) — the uncovered area comes out
// transparent, since canvas drawImage clips a source rect that extends beyond the
// image and shrinks the destination to match. Only the kept span is guarded: it can't
// collapse to nothing or flip inside out.
export function cropFractions(transform) {
  const v = (x) => (Number.isFinite(x) ? x : 0) / 100;
  let cropLeft = v(transform?.cropLeft);
  let cropRight = v(transform?.cropRight);
  let cropTop = v(transform?.cropTop);
  let cropBottom = v(transform?.cropBottom);
  const MIN_SPAN = 0.01;
  if (1 - cropLeft - cropRight < MIN_SPAN) cropRight = 1 - cropLeft - MIN_SPAN;
  if (1 - cropTop - cropBottom < MIN_SPAN) cropBottom = 1 - cropTop - MIN_SPAN;
  return { cropLeft, cropRight, cropTop, cropBottom };
}

// crops an image down to a single rectangle (unlike extractFaceCanvas, which slices a
// whole net layout into many regions) — used for card/piece symbol textures, which are
// just one rectangle each rather than a folded net.
export function cropToCanvas(img, transform) {
  const { cropLeft, cropRight, cropTop, cropBottom } = cropFractions(transform);
  const sx = imgW(img) * cropLeft;
  const sy = imgH(img) * cropTop;
  const sw = imgW(img) * (1 - cropLeft - cropRight);
  const sh = imgH(img) * (1 - cropTop - cropBottom);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  canvas
    .getContext("2d")
    .drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// counteracts printed artwork looking pale/washed-out once lit in the 3D scene —
// baked directly into each face's pixels (via canvas filter) rather than relying on
// scene lighting alone, so the correction is predictable regardless of exposure/ambient.
export function applyColorCorrection(canvas, cc) {
  const saturation = cc?.saturation ?? 100;
  const contrast = cc?.contrast ?? 100;
  const brightness = cc?.brightness ?? 100;
  if (saturation === 100 && contrast === 100 && brightness === 100) return canvas;
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d");
  ctx.filter = `saturate(${saturation}%) contrast(${contrast}%) brightness(${brightness}%)`;
  ctx.drawImage(canvas, 0, 0);
  return out;
}

// crops a canvas down to the bounding box of its non-transparent pixels (plus a small
// padding) — used for transparent-background exports so the downloaded PNG frames just
// the subject instead of the full render viewport.
export function trimTransparentCanvas(canvas, paddingFrac = 0.015) {
  const { width, height } = canvas;
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return canvas; // nothing opaque — leave untouched
  const padding = Math.round(Math.max(width, height) * paddingFrac);
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);
  const outW = maxX - minX + 1;
  const outH = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  out.getContext("2d").drawImage(canvas, minX, minY, outW, outH, 0, 0, outW, outH);
  return out;
}

// CSS background-size:cover style fit, in texture repeat/offset terms: given a
// texture's own aspect ratio and the aspect ratio of the face it's being mapped onto,
// returns the {repeat, offset} that crops the texture (never stretches it) to fill the
// face — same math as the scene-background fit, generalized to work on any per-face UV
// (which for RoundedBoxGeometry and ExtrudeGeometry-based shapes already spans 0..1
// per face) instead of only the renderer's background plane.
export function coverFitRepeatOffset(contentAspect, targetAspect) {
  if (!contentAspect || !targetAspect) return { repeat: [1, 1], offset: [0, 0] };
  if (contentAspect > targetAspect) {
    const scale = targetAspect / contentAspect;
    return { repeat: [scale, 1], offset: [(1 - scale) / 2, 0] };
  }
  const scale = contentAspect / targetAspect;
  return { repeat: [1, scale], offset: [0, (1 - scale) / 2] };
}

export function hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return `rgba(95,211,217,${alpha})`;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// reads the first image found on the system clipboard as a Blob. Requires a user
// gesture (called from a click handler) and, in most browsers, a secure context.
export async function readClipboardImage() {
  if (!navigator.clipboard || !navigator.clipboard.read) {
    throw new Error("このブラウザはクリップボードからの画像貼り付けに対応していません");
  }
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (type) return item.getType(type);
  }
  throw new Error("クリップボードに画像が見つかりませんでした");
}

export function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// wraps a paste-from-clipboard button's click handler: reads the clipboard, decodes
// it to an <img>, and hands it to whichever state setter(s) the caller passes in.
export function makePasteHandler(onImage) {
  return async () => {
    try {
      const blob = await readClipboardImage();
      const img = await blobToImage(blob);
      onImage(img);
    } catch (err) {
      alert(err?.message || "クリップボードからの貼り付けに失敗しました");
    }
  };
}

// detects the corner radius of an already-rounded-rect PNG by sampling its alpha
// channel: walks inward along the diagonal of each corner to find where alpha
// transitions from 0 to opaque, then converts that inset distance into a radius by
// solving the rounded-rect corner circle equation. Returns a radius in source pixels
// (0 if the image looks square-cornered, e.g. a plain rectangle with no rounding).
export function detectAlphaCornerRadiusPx(canvas) {
  const { width, height } = canvas;
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, width, height);
  const alphaAt = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    return data[(y * width + x) * 4 + 3];
  };
  const ALPHA_THRESHOLD = 16;
  const maxProbe = Math.floor(Math.min(width, height) / 2);

  // for one corner, walk outward from a point already known to be inside the opaque
  // body along the diagonal until alpha drops below threshold — that step count is
  // the corner's inset radius candidate, in pixels along the 45° diagonal.
  const probeCorner = (cornerX, cornerY, dx, dy) => {
    let inset = 0;
    while (inset < maxProbe) {
      const x = cornerX + dx * inset;
      const y = cornerY + dy * inset;
      if (alphaAt(x, y) >= ALPHA_THRESHOLD) break;
      inset++;
    }
    return inset;
  };

  // diagonal inset from the true corner to first-opaque-pixel is r*(1 - 1/sqrt(2))
  // for a quarter-circle rounded corner of radius r — invert that to recover r.
  const toRadius = (diagInset) => diagInset / (1 - Math.SQRT1_2);

  const corners = [
    probeCorner(0, 0, 1, 1),
    probeCorner(width - 1, 0, -1, 1),
    probeCorner(0, height - 1, 1, -1),
    probeCorner(width - 1, height - 1, -1, -1),
  ].filter((v) => v > 0 && v < maxProbe * 0.9); // drop corners that never went opaque (or fully opaque = no rounding detectable this way)

  if (corners.length === 0) return 0;
  const avgInset = corners.reduce((a, b) => a + b, 0) / corners.length;
  return Math.round(toRadius(avgInset));
}

// a best-guess classifier among our own preset shapes (circle vs. rounded-rect/square)
// from an uploaded PNG's alpha silhouette — NOT a general shape recognizer (telling a
// hexagon from a triangle from an arbitrary logo would need real contour/corner
// analysis, out of scope here). Works off a single number: how much of the opaque
// silhouette's own bounding box it actually fills. A circle/ellipse fills about
// pi/4 (~0.785) of its bounding box; a sharp-cornered rectangle fills ~1.0; a
// rounded-rect sits in between depending on corner radius — so a low fill ratio reads
// as "circle", anything higher reads as "rounded-rect" (whose corner radius the
// separate detectAlphaCornerRadiusPx call above already estimates precisely).
export function detectAlphaShapeKind(canvas) {
  const { width, height } = canvas;
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, width, height);
  const ALPHA_THRESHOLD = 16;
  let minX = width, minY = height, maxX = -1, maxY = -1, opaqueCount = 0;
  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x * 4 + 3] >= ALPHA_THRESHOLD) {
        opaqueCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const boxArea = (maxX - minX + 1) * (maxY - minY + 1);
  const fillRatio = opaqueCount / boxArea;
  return fillRatio < 0.85 ? "circle" : "roundedSquare";
}

// Short, stable identity for an image, for texture cache keys. Keys used to embed
// `img.src` directly — for an uploaded file that's the entire base64 data URL, so every
// render built (and compared) multi-megabyte strings per box just to decide whether
// anything had changed. Image elements are never mutated after load, so tagging each
// one with a counter is equivalent and O(1).
let imageKeyCounter = 0;
export function imageKey(img) {
  if (!img) return "";
  if (!img.__pmsKey) img.__pmsKey = ++imageKeyCounter;
  return img.__pmsKey;
}
