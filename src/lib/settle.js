// Contact with the floor and with other objects, from each object's CONVEX HULL.
//
//  settleQuaternion — the pose an object comes to rest in if you let go of it on a flat
//    floor: it tips onto whichever flat side of its hull it is leaning towards, and if
//    its centre of mass isn't over that side, keeps tipping over the edge it hangs past
//    until it is (quasi-static: no bouncing, no sliding, same result every time). A
//    die tilted 20° settles back flat, one tilted 50° rolls onto the next face, a
//    standee pushed past its foot falls over.
//  restLift — how far an object has to rise to rest exactly ON the objects under it,
//    instead of on their bounding boxes: rays straight down from its hull's corners onto
//    theirs, and straight up from their corners onto its hull.
//
// A hull is exact for convex pieces (cards, chips, dice, a standee and its foot as a
// whole) and a fair stand-in for the rest; it's built from at most a few thousand of the
// object's vertices and cached until its geometry changes.
import * as THREE from "three";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";

const MAX_POINTS = 3000;
const MAX_RAYS = 240;

function meshesOf(group) {
  const out = [];
  group.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes?.position) out.push(o);
  });
  return out;
}

// the object's hull, in the GROUP's local frame
export function hullFor(group) {
  const meshes = meshesOf(group);
  // geometry and each part's own placement (a lid lifted, a tray pulled out)
  const key = meshes.map((m) => `${m.geometry.uuid}@${m.matrix.elements.map((x) => Math.round(x * 1e4)).join(" ")}`).join(",");
  if (group.userData.hull?.key === key) return group.userData.hull;
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const total = meshes.reduce((n, m) => n + m.geometry.attributes.position.count, 0);
  const stride = Math.max(1, Math.ceil(total / MAX_POINTS));
  const pts = [];
  const v = new THREE.Vector3();
  meshes.forEach((m) => {
    const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += stride) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(rel).clone());
  });
  const hull = new ConvexHull().setFromPoints(pts);
  // flat sides: faces that share a plane (a die's face, a chip's cap is many triangles)
  const size = new THREE.Box3().setFromPoints(pts).getSize(new THREE.Vector3()).length();
  const facets = [];
  const facetOf = new Map();
  hull.faces.forEach((f) => {
    const d = f.normal.dot(f.midpoint);
    let facet = facets.find((F) => F.normal.dot(f.normal) > 0.9995 && Math.abs(F.d - d) < size * 1e-3);
    if (!facet) {
      facet = { normal: f.normal.clone(), d, verts: new Set(), neighbours: new Set() };
      facets.push(facet);
    }
    facetOf.set(f, facet);
    let e = f.edge;
    do {
      facet.verts.add(e.head().point);
      e = e.next;
    } while (e !== f.edge);
  });
  hull.faces.forEach((f) => {
    const F = facetOf.get(f);
    let e = f.edge;
    do {
      const G = facetOf.get(e.twin?.face);
      if (G && G !== F) F.neighbours.add(G);
      e = e.next;
    } while (e !== f.edge);
  });
  // a triangle mesh of the hull, for ray tests
  const tri = [];
  hull.faces.forEach((f) => {
    // ConvexHull's faces are always triangles
    const a = f.edge.tail().point;
    const b = f.edge.head().point;
    const c = f.edge.next.head().point;
    tri.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(tri, 3));
  const verts = [];
  hull.vertices.forEach((vn) => verts.push(vn.point));
  const centre = new THREE.Box3().setFromPoints(verts).getCenter(new THREE.Vector3());
  const info = { key, facets, geo, verts, centre };
  group.userData.hull = info;
  return info;
}

// 2D convex hull (monotone chain) of [x, z] points, counter-clockwise
function hull2(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  p.forEach((pt) => {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  });
  const upper = [];
  [...p].reverse().forEach((pt) => {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  });
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const DOWN = new THREE.Vector3(0, -1, 0);

// the group's world rotation once it has settled on a flat floor
export function settleQuaternion(group) {
  const { facets, centre } = hullFor(group);
  if (!facets.length) return group.quaternion.clone();
  let R = group.quaternion.clone();
  const n = new THREE.Vector3();
  // start on the side it leans towards most
  let facet = facets.reduce((best, F) => (n.copy(F.normal).applyQuaternion(R).dot(DOWN) > n.copy(best.normal).applyQuaternion(R).dot(DOWN) ? F : best), facets[0]);
  const seen = new Set();
  for (let step = 0; step < 40; step++) {
    // lay that side flat (the smallest turn that does it)
    n.copy(facet.normal).applyQuaternion(R);
    R = new THREE.Quaternion().setFromUnitVectors(n, DOWN).multiply(R);
    // is the centre of mass over it?
    const poly = hull2([...facet.verts].map((p) => {
      const w = p.clone().applyQuaternion(R);
      return [w.x, w.z];
    }));
    const c = centre.clone().applyQuaternion(R);
    let worst = null;
    const k = poly.length;
    const scale = Math.max(1e-6, ...poly.map((q) => Math.hypot(q[0] - c.x, q[1] - c.z)));
    for (let i = 0; i < k; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % k];
      const ex = b[0] - a[0];
      const ez = b[1] - a[1];
      const len = Math.hypot(ex, ez) || 1;
      // outward normal of a CCW edge, and how far the centre is past it
      const ox = ez / len;
      const oz = -ex / len;
      const past = (c.x - a[0]) * ox + (c.z - a[1]) * oz;
      if (past > scale * 1e-4 && (!worst || past > worst.past)) worst = { past, ox, oz, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
    }
    if (!worst || k < 3) return R; // stable
    // tip over that edge: onto the neighbouring side whose shared edge lies out that way
    seen.add(facet);
    let next = null;
    let bestScore = -Infinity;
    facet.neighbours.forEach((G) => {
      const shared = [...G.verts].filter((p) => facet.verts.has(p));
      if (!shared.length) return;
      const m = shared.reduce((acc, p) => acc.add(p.clone().applyQuaternion(R)), new THREE.Vector3()).divideScalar(shared.length);
      const score = (m.x - c.x) * worst.ox + (m.z - c.z) * worst.oz;
      if (score > bestScore) {
        bestScore = score;
        next = G;
      }
    });
    if (!next || seen.has(next)) return R;
    facet = next;
  }
  return R;
}

// how far `group` must rise (world units; may be ≤ 0) to rest on `others`, all at
// their current placement
export function restLift(group, others) {
  if (!others.length) return -Infinity;
  group.updateMatrixWorld(true);
  const me = hullFor(group);
  const meMesh = new THREE.Mesh(me.geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  meMesh.matrixAutoUpdate = false;
  meMesh.matrixWorld.copy(group.matrixWorld);
  const ray = new THREE.Raycaster();
  const v = new THREE.Vector3();
  const BIG = 1000;
  let lift = -Infinity;
  const sample = (verts) => verts.filter((_, i) => i % Math.max(1, Math.ceil(verts.length / MAX_RAYS)) === 0);

  others.forEach((o) => {
    o.updateMatrixWorld(true);
    const them = hullFor(o);
    const themMesh = new THREE.Mesh(them.geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    themMesh.matrixAutoUpdate = false;
    themMesh.matrixWorld.copy(o.matrixWorld);
    // my corners down onto them
    sample(me.verts).forEach((p) => {
      v.copy(p).applyMatrix4(group.matrixWorld);
      ray.set(new THREE.Vector3(v.x, BIG, v.z), DOWN);
      const hit = ray.intersectObject(themMesh, false)[0];
      if (hit) lift = Math.max(lift, hit.point.y - v.y);
    });
    // their corners up onto me
    sample(them.verts).forEach((p) => {
      v.copy(p).applyMatrix4(o.matrixWorld);
      ray.set(new THREE.Vector3(v.x, -BIG, v.z), new THREE.Vector3(0, 1, 0));
      const hit = ray.intersectObject(meMesh, false)[0];
      if (hit) lift = Math.max(lift, v.y - hit.point.y);
    });
    themMesh.material.dispose();
  });
  meMesh.material.dispose();
  return lift;
}
