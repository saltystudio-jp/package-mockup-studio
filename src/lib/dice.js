// Six-sided dice (ダイス) for the component library.
//
// Two bodies:
//   rounded — a cube with rounded edges and corners (the everyday plastic die)
//   ballcut — a cube intersected with a sphere: every face becomes a flat CIRCLE and
//             everything between the faces is spherical. That's the classic wooden
//             die with generously chamfered, rounded-off edges.
// Pips are thin discs laid on each face (a separate material, so their color is set
// independently of the body), numbered so opposite faces add up to 7.
//
// The geometry keeps the component pipeline's three material slots:
//   0 = pips, 1 = unused, 2 = body.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { BufferGeometryUtils } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const DIE_STYLES = [
  { key: "rounded", label: "角丸" },
  { key: "ballcut", label: "面が円形" },
];

// sphere radius as a fraction of the side. Must stay between 0.5 (a plain ball) and
// 1/√2 ≈ 0.707 (where the circles would reach the cube's edges) for every face to be a
// complete circle; 0.64 gives the soft, well-rounded look of turned wooden dice.
export const BALLCUT_RATIO = 0.64;

// value on each face (by outward normal) — opposite faces sum to 7
const FACES = [
  { n: [0, 1, 0], value: 1 },
  { n: [0, -1, 0], value: 6 },
  { n: [0, 0, 1], value: 2 },
  { n: [0, 0, -1], value: 5 },
  { n: [1, 0, 0], value: 3 },
  { n: [-1, 0, 0], value: 4 },
];
// pip positions in units of the pip spacing, on a face's own (u, v) axes
const PIP_LAYOUT = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

// Cube ∩ sphere, built so each face's rim is a clean circle: an evenly tessellated
// sphere is CLIPPED against the six face planes (every triangle crossing a plane is cut
// exactly along it), and a true disc closes each face. Flattening sphere vertices onto
// the planes instead (the first version) left the triangles that straddle the rim
// half-flat, which showed as a jagged ring around every face.
function ballcutBody(a, ratio) {
  const R = a * ratio;
  const half = a / 2;
  const faceRadius = Math.sqrt(R * R - half * half);

  const sphere = new THREE.IcosahedronGeometry(R, 5); // ~20k evenly sized triangles
  const src = sphere.attributes.position;
  const pos = [];
  const nor = [];
  const P = (i) => [src.getX(i), src.getY(i), src.getZ(i)];
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const planes = [0, 1, 2].flatMap((k) => [
    [k, 1],
    [k, -1],
  ]);
  for (let i = 0; i < src.count; i += 3) {
    let poly = [P(i), P(i + 1), P(i + 2)];
    // Sutherland–Hodgman against each half-space  sign·coord ≤ half
    for (const [k, sign] of planes) {
      if (poly.length < 3) break;
      const inside = (p) => sign * p[k] <= half;
      const out = [];
      poly.forEach((cur, j) => {
        const prev = poly[(j + poly.length - 1) % poly.length];
        const cIn = inside(cur);
        const pIn = inside(prev);
        if (cIn !== pIn) out.push(lerp(prev, cur, (sign * half - prev[k]) / (cur[k] - prev[k])));
        if (cIn) out.push(cur);
      });
      poly = out;
    }
    for (let j = 1; j + 1 < poly.length; j++) {
      [poly[0], poly[j], poly[j + 1]].forEach((p) => {
        pos.push(...p);
        const l = Math.hypot(...p) || 1;
        nor.push(p[0] / l, p[1] / l, p[2] / l);
      });
    }
  }
  sphere.dispose();
  const zone = new THREE.BufferGeometry();
  zone.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  zone.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  zone.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));

  // the six flat circular faces
  const up = new THREE.Vector3(0, 0, 1);
  const discs = FACES.map(({ n }) => {
    const d = new THREE.CircleGeometry(faceRadius, 160).toNonIndexed();
    const normal = new THREE.Vector3(...n);
    d.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, normal)));
    d.translate(normal.x * half, normal.y * half, normal.z * half);
    return d;
  });
  const geo = BufferGeometryUtils.mergeBufferGeometries([zone, ...discs], false);
  zone.dispose();
  discs.forEach((d) => d.dispose());
  return { geo, faceRadius };
}

// `c`: { w (side, mm), dieStyle, cornerRadius (mm, rounded only) }
export function buildDieGeometry(c, scale) {
  const a = Math.max(0.1, c.w) * scale;
  let body;
  let spacing;
  let pipR;
  if (c.dieStyle === "ballcut") {
    const { geo, faceRadius } = ballcutBody(a, BALLCUT_RATIO);
    body = geo;
    spacing = faceRadius * 0.45;
    pipR = faceRadius * 0.17;
  } else {
    const r = Math.min(a / 2, Math.max(0, (c.cornerRadius || 0) * scale));
    body = new RoundedBoxGeometry(a, a, a, 4, r);
    // keep pips clear of the rounded border
    const flat = a / 2 - r;
    spacing = Math.min(a * 0.26, flat * 0.62);
    pipR = Math.min(a * 0.085, flat * 0.3);
  }

  const lift = 0.05 * scale; // just above the face, so it never z-fights with it
  const up = new THREE.Vector3(0, 0, 1);
  const pips = [];
  FACES.forEach(({ n, value }) => {
    const normal = new THREE.Vector3(...n);
    // in-face axes: any two perpendicular to the normal
    const u = Math.abs(n[1]) ? new THREE.Vector3(1, 0, 0) : Math.abs(n[2]) ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const w = new THREE.Vector3().crossVectors(normal, u);
    const q = new THREE.Quaternion().setFromUnitVectors(up, normal);
    PIP_LAYOUT[value].forEach(([pu, pv]) => {
      // the lone pip on the 1 face is traditionally bigger
      const disc = new THREE.CircleGeometry(value === 1 ? pipR * 1.5 : pipR, 24).toNonIndexed();
      disc.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q)); // (r128 has no applyQuaternion)
      const p = normal.clone().multiplyScalar(a / 2 + lift).addScaledVector(u, pu * spacing).addScaledVector(w, pv * spacing);
      disc.translate(p.x, p.y, p.z);
      pips.push(disc);
    });
  });
  const pipGeo = BufferGeometryUtils.mergeBufferGeometries(pips, false);
  pips.forEach((g) => g.dispose());
  const merged = BufferGeometryUtils.mergeBufferGeometries([pipGeo, body], true);
  pipGeo.dispose();
  body.dispose();
  // mergeBufferGeometries numbers groups by input order: pips → 0, body → 1; the body
  // belongs in slot 2 (the component's "side/body" material)
  merged.groups.forEach((g) => {
    if (g.materialIndex === 1) g.materialIndex = 2;
  });
  return merged;
}
