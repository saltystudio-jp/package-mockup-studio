// Extruding a flat piece with ROUNDED edges where its faces meet its side — the soft
// edge of a punched cardboard chip — on both faces, or only the top or only the bottom.
//
// three's ExtrudeGeometry bevel rounds both faces or neither, and grows the outline by
// the bevel size, so this sweeps the outline through a vertical profile instead:
// the outline is inset by however far the rounding has come in at each height, and
// consecutive rings are stitched together. Normals come from the profile (smooth over
// the rounding) and from each outline edge (so a hexagon's corners stay crisp).
//
// Works in the piece's final size: outline points in world units, z from 0 (bottom) to
// `depth` (top). Material groups: 0 bottom face, 1 top face, 2 side — with the rounded
// rim counted as part of the face it curves into, so the print wraps over it the way
// it does on a real chip.
import * as THREE from "three";

// THREE.Shape(s) → [{ outer: Vector2[], holes: Vector2[][] }], scaled/offset into place
export function shapesToPolys(shapes, { sx = 1, sy = 1, dy = 0, curveSegments = 32 } = {}) {
  const list = Array.isArray(shapes) ? shapes : [shapes];
  const map = (pts) => pts.map((p) => new THREE.Vector2(p.x * sx, p.y * sy + dy));
  return list.map((sh) => {
    const { shape, holes } = sh.extractPoints(curveSegments);
    return { outer: map(shape), holes: holes.map(map) };
  });
}

function dedupe(pts) {
  const out = [];
  pts.forEach((p) => {
    const last = out[out.length - 1];
    if (!last || last.distanceTo(p) > 1e-7) out.push(p);
  });
  if (out.length > 2 && out[0].distanceTo(out[out.length - 1]) < 1e-7) out.pop();
  return out;
}

// outward normal of each edge i → i+1 for a ring whose material is on its LEFT
function edgeNormals(ring) {
  return ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const e = new THREE.Vector2(q.x - p.x, q.y - p.y).normalize();
    return new THREE.Vector2(e.y, -e.x);
  });
}

// the ring moved into the material by d (mitred corners, capped so spikes can't fly off)
function inset(ring, normals, d) {
  if (!d) return ring.map((p) => p.clone());
  const n = ring.length;
  return ring.map((p, i) => {
    const a = normals[(i - 1 + n) % n];
    const b = normals[i];
    const m = new THREE.Vector2(a.x + b.x, a.y + b.y);
    const denom = 1 + a.dot(b);
    if (denom < 0.2) m.copy(b).add(a).normalize().multiplyScalar(2); // near-reversal: cap the mitre
    else m.divideScalar(denom);
    return new THREE.Vector2(p.x - m.x * d, p.y - m.y * d);
  });
}

// profile, bottom → top: { inset, z, phi } with phi the angle of the surface normal
// above the horizontal (−90° = facing down, 0 = side, 90° = facing up)
function profile(depth, rb, rt, seg) {
  const pts = [];
  if (rb > 0) {
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * (Math.PI / 2);
      pts.push({ inset: rb - rb * Math.sin(a), z: rb - rb * Math.cos(a), phi: a - Math.PI / 2 });
    }
  } else pts.push({ inset: 0, z: 0, phi: 0 });
  if (rt > 0) {
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * (Math.PI / 2);
      pts.push({ inset: rt - rt * Math.cos(a), z: depth - rt + rt * Math.sin(a), phi: a });
    }
  } else pts.push({ inset: 0, z: depth, phi: 0 });
  return pts;
}

// polys: from shapesToPolys; depth: thickness; radius: rounding; sides: "both" | "top" |
// "bottom"; frame: { minX, maxX, minY, maxY } the art spans (for the face UVs)
export function extrudeRounded(polys, { depth, radius, sides = "both", frame, segments = 5 }) {
  const both = sides === "both";
  const maxR = both ? depth / 2 : depth;
  const r = Math.max(0, Math.min(radius, maxR * 0.999));
  const rb = sides === "top" ? 0 : r;
  const rt = sides === "bottom" ? 0 : r;
  const prof = profile(depth, rb, rt, segments);

  // triangles bucketed by material, so each material is one draw call
  const buckets = [0, 1, 2].map(() => ({ pos: [], nor: [], uv: [] }));
  const fw = Math.max(1e-9, frame.maxX - frame.minX);
  const fh = Math.max(1e-9, frame.maxY - frame.minY);
  const tri = (g, verts) =>
    verts.forEach(([p, z, n]) => {
      const b = buckets[g];
      b.pos.push(p.x, p.y, z);
      b.nor.push(n.x, n.y, n.z);
      b.uv.push((p.x - frame.minX) / fw, (p.y - frame.minY) / fh);
    });
  const faceFor = (phi) => (phi > Math.PI / 6 ? 1 : phi < -Math.PI / 6 ? 0 : 2);

  polys.forEach(({ outer, holes }) => {
    let o = dedupe(outer);
    if (o.length < 3) return;
    if (THREE.ShapeUtils.isClockWise(o)) o = o.reverse(); // material on the left: CCW
    const hs = holes.map(dedupe).filter((h) => h.length >= 3).map((h) => (THREE.ShapeUtils.isClockWise(h) ? h : h.reverse()));
    const rings = [o, ...hs];
    const ringNormals = rings.map(edgeNormals);
    // each ring at each profile height
    const levels = prof.map((pp) => rings.map((ring, ri) => inset(ring, ringNormals[ri], pp.inset)));

    // side: one strip per outline edge, so corners stay sharp
    rings.forEach((ring, ri) => {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const en = ringNormals[ri][i];
        for (let k = 0; k + 1 < prof.length; k++) {
          const p0 = prof[k];
          const p1 = prof[k + 1];
          const A = levels[k][ri][i];
          const B = levels[k][ri][j];
          const C = levels[k + 1][ri][j];
          const D = levels[k + 1][ri][i];
          const n0 = new THREE.Vector3(en.x * Math.cos(p0.phi), en.y * Math.cos(p0.phi), Math.sin(p0.phi));
          const n1 = new THREE.Vector3(en.x * Math.cos(p1.phi), en.y * Math.cos(p1.phi), Math.sin(p1.phi));
          const g = faceFor((p0.phi + p1.phi) / 2);
          tri(g, [[A, p0.z, n0], [B, p0.z, n0], [C, p1.z, n1]]);
          tri(g, [[A, p0.z, n0], [C, p1.z, n1], [D, p1.z, n1]]);
        }
      }
    });

    // flat faces at the innermost rings
    const cap = (lvl, z, up) => {
      const [contour, ...holeRings] = levels[lvl];
      const tris = THREE.ShapeUtils.triangulateShape(contour, holeRings);
      const all = [contour, ...holeRings].flat();
      const nz = new THREE.Vector3(0, 0, up ? 1 : -1);
      tris.forEach(([a, b, c]) => {
        let [A, B, C] = [all[a], all[b], all[c]];
        const cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
        if (up ? cross < 0 : cross > 0) [B, C] = [C, B];
        tri(up ? 1 : 0, [[A, z, nz], [B, z, nz], [C, z, nz]]);
      });
    };
    cap(0, 0, false);
    cap(prof.length - 1, depth, true);
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(buckets.flatMap((b) => b.pos), 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(buckets.flatMap((b) => b.nor), 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(buckets.flatMap((b) => b.uv), 2));
  let start = 0;
  buckets.forEach((b, g) => {
    const count = b.pos.length / 3;
    if (count) geo.addGroup(start, count, g);
    start += count;
  });
  return geo;
}
