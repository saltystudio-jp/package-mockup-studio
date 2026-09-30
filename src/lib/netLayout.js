// Free net layout: where each face of a box sits on its uploaded print sheet.
//
// The template nets (boxModels.js) say which faces exist, their sizes in mm and how
// each lands on the 3D model. The LAYOUT says where each face's rectangle is on the
// user's own artwork, so a sheet doesn't have to match the template's arrangement:
// faces can be moved independently to wherever the art actually put them.
//
// Stored per net slot as `net.faceLayout = { k, centers }`, in the coordinates of the
// displayed image (the upload with the user's own 90° rotations applied):
//   k       — the sheet's print scale: image pixels per mm, divided by the image width.
//             ONE scale for every face, as on a real print sheet — a face can't be
//             stretched on its own, so its art is never distorted.
//   centers — { faceKey: [cx, cy] }, each face's centre as a fraction of width/height.
// Every rectangle's size follows from its face's mm size × k, so changing the box's
// dimensions resizes the rectangles by itself, around the centres the user placed.
import { rawSpaceLayout } from "./nets.js";
import { imgW, imgH, cropFractions, rotatedImageCanvas, mirroredImageCanvas } from "./imaging.js";

export function faceRegions(slot) {
  // raw space: positions as they appear in the user's file (the 身蓋 box's slicing
  // baseline — rotate 180°/mirror — is undone here and re-applied per face on slicing)
  return rawSpaceLayout(slot.layout, slot.orient).regions.filter((r) => r.face !== false);
}

// The layout to start from when a sheet has none yet. A sheet trimmed with the old
// whole-net trim editor keeps exactly the placement that trim implied; an untrimmed one
// gets the template fitted inside the image, centred.
export function defaultFaceLayout(slot, net, dispW, dispH) {
  const raw = rawSpaceLayout(slot.layout, slot.orient);
  const t = net?.transform || {};
  const trimmed = t.cropLeft || t.cropRight || t.cropTop || t.cropBottom;
  let pxPerMm;
  let ox;
  let oy;
  if (trimmed) {
    const { cropLeft, cropRight, cropTop } = cropFractions(t);
    pxPerMm = (dispW * (1 - cropLeft - cropRight)) / raw.totalW;
    ox = cropLeft * dispW;
    oy = cropTop * dispH;
  } else {
    pxPerMm = Math.min(dispW / raw.totalW, dispH / raw.totalH);
    ox = (dispW - raw.totalW * pxPerMm) / 2;
    oy = (dispH - raw.totalH * pxPerMm) / 2;
  }
  const centers = {};
  raw.regions
    .filter((r) => r.face !== false)
    .forEach((r) => {
      centers[r.key] = [(ox + (r.x + r.w / 2) * pxPerMm) / dispW, (oy + (r.y + r.h / 2) * pxPerMm) / dispH];
    });
  return { k: pxPerMm / dispW, centers };
}

// Face rectangles in display-image pixels: { key: { x, y, w, h } }. A face missing
// from a stored layout (e.g. after switching box type) is placed from the default.
export function faceRects(slot, net, dispW, dispH) {
  const layout = net?.faceLayout || defaultFaceLayout(slot, net, dispW, dispH);
  const fallback = net?.faceLayout ? defaultFaceLayout(slot, { ...net, faceLayout: null }, dispW, dispH) : layout;
  const pxPerMm = layout.k * dispW;
  const rects = {};
  faceRegions(slot).forEach((r) => {
    const [cx, cy] = layout.centers[r.key] || fallback.centers[r.key] || [0.5, 0.5];
    const w = r.w * pxPerMm;
    const h = r.h * pxPerMm;
    rects[r.key] = { x: cx * dispW - w / 2, y: cy * dispH - h / 2, w, h };
  });
  return rects;
}

// The display image the layout is measured against: the upload with the user's own
// 90° rotation, and nothing else.
export function displayImage(net) {
  const deg = (((net?.transform?.rotate || 0) % 360) + 360) % 360;
  return deg ? rotatedImageCanvas(net.img, deg) : net.img;
}

// Cuts one face out of the display image and turns it onto the face's texture frame:
// the slot's hidden baseline (the 身蓋 box's rotate/mirror) first, as if the whole sheet
// had been corrected before slicing, then the region's own rotation. Areas outside the
// image come out as white paper.
export function sliceFace(display, rect, orient, regionRotate) {
  const w = Math.max(1, Math.round(rect.w));
  const h = Math.max(1, Math.round(rect.h));
  let c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(display, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  const base = (((orient?.baselineRotate || 0) % 360) + 360) % 360;
  if (base) c = rotatedImageCanvas(c, base);
  if (orient?.mirror) c = mirroredImageCanvas(c);
  const rot = (((regionRotate || 0) % 360) + 360) % 360;
  if (rot) c = rotatedImageCanvas(c, rot);
  return c;
}

// the rotation a CW quarter turn of the display image applies to a stored layout
export function rotateLayoutCW(layout, dispW, dispH) {
  if (!layout) return layout;
  const centers = {};
  Object.entries(layout.centers).forEach(([k, [cx, cy]]) => {
    centers[k] = [1 - cy, cx];
  });
  // k is per image WIDTH, and the new width is the old height
  return { k: (layout.k * dispW) / dispH, centers };
}

// Which rectangles are joined to `startKey`: two touch when they share any length of
// edge or just a corner (within `eps` px); joined = reachable through touches.
export function connectedFaces(rects, startKey, eps) {
  const keys = Object.keys(rects);
  const touch = (a, b) => {
    const xTouch = Math.abs(a.x + a.w - b.x) <= eps || Math.abs(b.x + b.w - a.x) <= eps;
    const yTouch = Math.abs(a.y + a.h - b.y) <= eps || Math.abs(b.y + b.h - a.y) <= eps;
    const xOverlap = a.x <= b.x + b.w + eps && b.x <= a.x + a.w + eps;
    const yOverlap = a.y <= b.y + b.h + eps && b.y <= a.y + a.h + eps;
    return (xTouch && yOverlap) || (yTouch && xOverlap);
  };
  const seen = new Set([startKey]);
  const queue = [startKey];
  while (queue.length) {
    const k = queue.shift();
    keys.forEach((o) => {
      if (!seen.has(o) && touch(rects[k], rects[o])) {
        seen.add(o);
        queue.push(o);
      }
    });
  }
  return seen;
}

export { imgW, imgH };

// Inspector thumbnail: the uploaded sheet with each face's rectangle over it. Kept
// small — it's a preview, not a print file.
export function drawLayoutPreview(canvas, display, rects, color, maxPx = 480) {
  const dw = imgW(display);
  const dh = imgH(display);
  const s = Math.min(1, maxPx / Math.max(dw, dh));
  canvas.width = Math.max(1, Math.round(dw * s));
  canvas.height = Math.max(1, Math.round(dh * s));
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(display, 0, 0, canvas.width, canvas.height);
  ctx.lineWidth = Math.max(1, canvas.width / 240);
  ctx.strokeStyle = color;
  ctx.setLineDash([ctx.lineWidth * 4, ctx.lineWidth * 3]);
  Object.values(rects).forEach((r) => ctx.strokeRect(r.x * s, r.y * s, r.w * s, r.h * s));
  ctx.setLineDash([]);
}
