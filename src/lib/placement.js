import * as THREE from "three";

// composes a placement rotation the same way for every object kind (box/card/piece):
// yaw around true world-vertical, then roll/lean tilts, with "standing" vs "lying" as a
// base pose swap — as fixed WORLD-axis quaternions (not a raw Euler triple) so rotY
// always spins around world-up regardless of the standing/lying base pose or tilt lean.
// See the original box placement effect in PackageBoxMockup.jsx for why Euler("XYZ")
// doesn't work here.
export function composePlacementQuaternion({ orientation, tiltX = 0, tiltZ = 0, rotY = 0 }) {
  const baseX = orientation === "standing" ? -Math.PI / 2 : 0;
  const qLean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), baseX + (tiltX * Math.PI) / 180);
  const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (tiltZ * Math.PI) / 180);
  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rotY * Math.PI) / 180);
  return qYaw.multiply(qRoll).multiply(qLean);
}

// after a group's quaternion + x/z position are set (with y still 0), lifts it so its
// lowest point sits at `floorY` (plus a manual float offset) — same "measure the
// rendered bounding box, don't precompute from raw dimensions" approach the box uses,
// which stays correct regardless of orientation/tilt. `floorY` defaults to the ground
// (0) but the stacking resolver (stacking.js) passes the resolved top of whatever this
// object rests on instead. `measureObj` lets the caller measure a specific child (the
// box passes its body mesh, not the whole boxGroup, so an opened lid doesn't affect how
// low the box itself sits) while still positioning the full group.
export function groundSnapY(group, floatHeightMm, SCALE, { floorY = 0, measureObj } = {}) {
  group.position.y = 0;
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(measureObj || group);
  return floorY - box.min.y + floatHeightMm * SCALE;
}

// measures a group's world-space XZ footprint (with y assumed already at the group's
// own baseline — call after position.y is set to whatever "0-ish" reference the caller
// is using, e.g. within the stacking resolver's pass 1 measurement step).
export function measureXZFootprint(group) {
  const box = new THREE.Box3().setFromObject(group);
  return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
}
