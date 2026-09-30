// Die-cut (トムソン) outlines: the shape of a transparent PNG, traced from its alpha
// channel so a card can be cut to the artwork's own silhouette.
//
// 1. Threshold alpha at 50% on a copy scaled to at most TRACE_RES px — enough to
//    follow a printed die line, small enough to trace in a few milliseconds.
// 2. Walk the pixel boundaries: every inside pixel side that faces outside becomes a
//    unit edge, oriented so the inside is always on the same side; edges are chained
//    into closed loops. Where two pixels touch only at a corner the walk turns the same
//    way every time, so diagonal neighbours stay separate pieces rather than merging.
// 3. Drop collinear points and simplify (Ramer–Douglas–Peucker) so the staircase of
//    pixel edges becomes a clean polygon.
// 4. Nesting decides outer vs hole: a loop inside an odd number of others is a hole
//    (a window punched through the card) and belongs to the smallest outer around it.
//
// Coordinates come back normalized to the WHOLE image (x, y in -0.5..0.5, y up), not to
// the traced shape's own bounds — so the cut stays registered to the artwork even when
// the image has transparent margins, and the texture can be mapped to the same frame.
import { cropToCanvas, imageKey } from "./imaging.js";

const TRACE_RES = 512;
const SIMPLIFY_EPS = 0.9; // px at trace resolution
const MIN_AREA_FRAC = 0.0005; // specks smaller than this share of the image are ignored

const cache = new Map();

export function traceAlphaOutline(img, transform) {
  if (!img) return null;
  const key = `${imageKey(img)}|${JSON.stringify(transform || {})}`;
  if (cache.has(key)) return cache.get(key);
  const result = trace(cropToCanvas(img, transform));
  if (cache.size > 32) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

function trace(source) {
  const scale = Math.min(1, TRACE_RES / Math.max(source.width, source.height));
  const W = Math.max(1, Math.round(source.width * scale));
  const H = Math.max(1, Math.round(source.height * scale));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && data[(y * W + x) * 4 + 3] >= 128;

  // directed boundary edges, inside on the right (image coords, y down → clockwise)
  const out = new Map(); // "x,y" → [[x2,y2], ...]
  let edgeCount = 0;
  const add = (x1, y1, x2, y2) => {
    const k = `${x1},${y1}`;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push([x2, y2]);
    edgeCount++;
  };
  let anyInside = false;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      anyInside = true;
      if (!inside(x, y - 1)) add(x, y, x + 1, y);
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  // nothing transparent to cut along: the image is fully opaque (or fully clear)
  if (!anyInside || edgeCount === 4 * W * H) return null;

  const loops = [];
  while (out.size) {
    const [startKey, startList] = out.entries().next().value;
    const [sx, sy] = startKey.split(",").map(Number);
    let [nx, ny] = startList.pop();
    if (!startList.length) out.delete(startKey);
    const pts = [[sx, sy]];
    let px = sx;
    let py = sy;
    let guard = edgeCount + 2;
    while (!(nx === sx && ny === sy) && guard-- > 0) {
      pts.push([nx, ny]);
      const k = `${nx},${ny}`;
      const list = out.get(k);
      if (!list) break;
      // at a corner-touch there are two ways on: always take the sharper right turn
      const dx = nx - px;
      const dy = ny - py;
      let best = 0;
      if (list.length > 1) {
        let bestCross = -Infinity;
        list.forEach(([ex, ey], i) => {
          const cross = dx * (ey - ny) - dy * (ex - nx);
          if (cross > bestCross) {
            bestCross = cross;
            best = i;
          }
        });
      }
      const [ex, ey] = list.splice(best, 1)[0];
      if (!list.length) out.delete(k);
      px = nx;
      py = ny;
      nx = ex;
      ny = ey;
    }
    if (pts.length >= 4) loops.push(pts);
  }

  const minArea = MIN_AREA_FRAC * W * H;
  const polys = loops
    .map((p) => simplify(dropCollinear(p), SIMPLIFY_EPS))
    .filter((p) => p.length >= 3 && Math.abs(area(p)) >= minArea);
  if (!polys.length) return null;

  // nesting: depth = how many other loops contain this one
  const depth = polys.map((p, i) => polys.reduce((n, q, j) => (i !== j && contains(q, midpoint(p)) ? n + 1 : n), 0));
  const outers = polys.map((p, i) => ({ p, i })).filter(({ i }) => depth[i] % 2 === 0);
  const shapes = outers.map(({ p }) => ({ outer: p, holes: [] }));
  polys.forEach((p, i) => {
    if (depth[i] % 2 === 0) return;
    let owner = null;
    let ownerArea = Infinity;
    outers.forEach(({ p: o }, k) => {
      const a = Math.abs(area(o));
      if (a < ownerArea && contains(o, midpoint(p))) {
        owner = k;
        ownerArea = a;
      }
    });
    if (owner != null) shapes[owner].holes.push(p);
  });

  const norm = ([x, y]) => [x / W - 0.5, 0.5 - y / H];
  return {
    shapes: shapes.map((s) => ({ outer: s.outer.map(norm), holes: s.holes.map((h) => h.map(norm)) })),
  };
}

function dropCollinear(pts) {
  const n = pts.length;
  return pts.filter((p, i) => {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
  });
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (!len) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}
// closed-loop RDP: split at the point farthest from the start so neither half is degenerate
function simplify(pts, eps) {
  if (pts.length < 4) return pts;
  let far = 0;
  let farD = -1;
  pts.forEach((p, i) => {
    const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  });
  const a = rdp(pts.slice(0, far + 1), eps);
  const b = rdp([...pts.slice(far), pts[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function area(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}
// a point just off the first edge's midpoint on its inside, so it's strictly within
// the loop (a vertex could sit exactly on a neighbouring loop's corner)
function midpoint(p) {
  const [x1, y1] = p[0];
  const [x2, y2] = p[1];
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const s = area(p) > 0 ? 1 : -1;
  return [mx - (s * (y2 - y1) * 0.01) / len, my + (s * (x2 - x1) * 0.01) / len];
}
function contains(poly, [x, y]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
