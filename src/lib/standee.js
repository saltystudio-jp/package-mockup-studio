// Standees (スタンディー): a thick cardboard piece that stands upright, printed on both
// sides, held up by a foot —
//   slot — a half-disc of the same board slotted through it at right angles (the
//          usual die-cut cardboard stand)
//   base — a small plastic-style base the piece is pushed into
//   none — just the piece
//
// Built in an upright frame — piece in X (width) × Y (height), thickness along Z, the
// FRONT facing +Z (toward the default camera), image top at +Y — and then turned +90°
// about X, so the "standing" pose (−90° about X, see placement.js) stands it back up.
// Its fields line up with every other piece that way: W = width, D = height, thickness
// = the board, and the transform box's size handles map onto them unchanged.
//
// Material slots: 0 = back face, 1 = front face, 2 = board edges (+ a slot foot,
// which is the same board), 3 = a plastic base.
import * as THREE from "three";
import { BufferGeometryUtils } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { extrudeRounded, shapesToPolys } from "./roundedExtrude.js";

export const STAND_STYLES = [
  { key: "slot", label: "差し込み" },
  { key: "base", label: "台座" },
  { key: "none", label: "なし" },
];

// u/v across the outline's frame; the back is mirrored so its art reads correctly
// from behind (and a die-cut's outline still matches it there)
function capUVs(geo, frame) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const w = Math.max(1e-9, frame.maxX - frame.minX);
  const h = Math.max(1e-9, frame.maxY - frame.minY);
  for (let i = 0; i < pos.count; i++) {
    const nz = nor.getZ(i);
    if (Math.abs(nz) < 0.5) continue;
    const u = (pos.getX(i) - frame.minX) / w;
    uv.setXY(i, nz > 0 ? u : 1 - u, (pos.getY(i) - frame.minY) / h);
  }
  uv.needsUpdate = true;
}

// front (+Z) → 1, back (−Z) → 0, edges → 2
function groupByNormal(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const nor = g.attributes.normal;
  const n = g.attributes.position.count / 3;
  const cls = [];
  for (let t = 0; t < n; t++) {
    const nz = (nor.getZ(t * 3) + nor.getZ(t * 3 + 1) + nor.getZ(t * 3 + 2)) / 3;
    cls.push(nz > 0.5 ? 1 : nz < -0.5 ? 0 : 2);
  }
  g.clearGroups();
  let start = 0;
  for (let t = 1; t <= n; t++) {
    if (t === n || cls[t] !== cls[start]) {
      g.addGroup(start * 3, (t - start) * 3, cls[start]);
      start = t;
    }
  }
  return g;
}

function oneGroup(geo, materialIndex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.clearGroups();
  g.addGroup(0, g.attributes.position.count, materialIndex);
  return g;
}

// rectangle W×H (bottom at y = 0, centred on x) with only the TOP corners rounded
export function roundTopShape(w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h - rr);
  if (rr > 0) s.absarc(w / 2 - rr, h - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(-w / 2 + rr, h);
  if (rr > 0) s.absarc(-w / 2 + rr, h - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(-w / 2, 0);
  return s;
}

// `shapes`: THREE.Shape(s) of the outline; `post`: { sx, sy, dy } bringing them to
// W×H with the bottom at y = 0; `frame`: the box the art spans, centred (before dy);
// `edgeRadius`/`edgeRound`: rounded board edges, front ("top"), back ("bottom") or both
export function buildStandeeGeometry({ shapes, frame, post = { sx: 1, sy: 1, dy: 0 }, t, stand, standSize, w, h, edgeRadius = 0, edgeRound = "both" }) {
  const parts = [];
  const polys = shapesToPolys(shapes, post);
  const artFrame = { minX: frame.minX, maxX: frame.maxX, minY: frame.minY + post.dy, maxY: frame.maxY + post.dy };
  let pieceG;
  if (edgeRadius > 0) {
    pieceG = extrudeRounded(polys, { depth: t, radius: edgeRadius, sides: edgeRound, frame: artFrame });
  } else {
    const flatShapes = polys.map(({ outer, holes }) => {
      const sh = new THREE.Shape(outer);
      sh.holes = holes.map((hl) => new THREE.Path(hl));
      return sh;
    });
    pieceG = groupByNormal(new THREE.ExtrudeGeometry(flatShapes, { depth: t, bevelEnabled: false }));
  }
  pieceG.translate(0, 0, -t / 2);
  capUVs(pieceG, artFrame);
  let lift = 0;

  if (stand === "slot") {
    // a half-disc, flat edge down, crossing the piece at its bottom centre
    const R = standSize > 0 ? standSize : Math.max(h * 0.18, Math.min(w * 0.55, h * 0.4));
    const disc = new THREE.Shape();
    disc.moveTo(-R, 0);
    disc.lineTo(R, 0);
    disc.absarc(0, 0, R, 0, Math.PI, false);
    const foot = new THREE.ExtrudeGeometry(disc, { depth: t, bevelEnabled: false, curveSegments: 40 });
    foot.translate(0, 0, -t / 2);
    foot.rotateY(Math.PI / 2); // its plane now runs front-to-back (Y–Z), thickness along X
    parts.push(oneGroup(foot, 2));
  } else if (stand === "base") {
    // a stadium-shaped block; the piece sits pushed into its slot
    const L = standSize > 0 ? standSize : Math.max(w * 0.9, t * 8);
    const D = Math.max(t * 5, L * 0.42);
    const H = Math.max(t * 3, Math.min(L * 0.3, h * 0.16));
    const r = D / 2;
    const s = new THREE.Shape();
    s.moveTo(-L / 2 + r, -D / 2);
    s.lineTo(L / 2 - r, -D / 2);
    s.absarc(L / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(-L / 2 + r, D / 2);
    s.absarc(-L / 2 + r, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
    const base = new THREE.ExtrudeGeometry(s, { depth: H, bevelEnabled: true, bevelThickness: H * 0.12, bevelSize: H * 0.12, bevelSegments: 2, curveSegments: 24 });
    base.rotateX(Math.PI / 2); // footprint on X–Z, height along −Y …
    base.translate(0, H, 0); // … so lift it to sit on y = 0
    parts.push(oneGroup(base, 3));
    lift = H * 0.35; // the piece's bottom edge disappears into the slot
  }
  if (lift) pieceG.translate(0, lift, 0);
  parts.unshift(pieceG);

  // merged without groups (with them, three makes ONE group per input and drops each
  // input's own front/back/edge split) — the inputs are non-indexed and concatenated in
  // order, so each one's groups carry over shifted by the vertices before it
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const merged = BufferGeometryUtils.mergeBufferGeometries(flat, false);
  let offset = 0;
  flat.forEach((p) => {
    p.groups.forEach((g) => merged.addGroup(offset + g.start, g.count, g.materialIndex));
    offset += p.attributes.position.count;
  });
  parts.forEach((p) => p.dispose());
  // upright frame → the frame the standing pose expects (see top)
  merged.rotateX(Math.PI / 2);
  return merged;
}
