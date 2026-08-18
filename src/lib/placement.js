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
// lowest point sits at world y=0 (plus a manual float offset) — same "measure the
// rendered bounding box, don't precompute from raw dimensions" approach the box uses,
// which stays correct regardless of orientation/tilt.
export function groundSnapY(group, floatHeightMm, SCALE) {
  group.position.y = 0;
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  return -box.min.y + floatHeightMm * SCALE;
}
