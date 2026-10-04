// Resolves each object's resting Y by processing layers bottom-to-top: a grounded
// object rests at Y=0 UNLESS its XZ footprint overlaps an object from a strictly lower
// layer, in which case it rests on that object's top surface instead (e.g. a piece
// placed on layer 2 whose footprint overlaps a card on layer 1 gets lifted by the
// card's thickness). Objects within the SAME layer never stack on each other — only a
// lower layer supports a higher one.
//
// Deliberately NOT a physics simulation: a mockup render needs to be deterministic and
// settle instantly (no dependency, no simulation step, no jitter, reproducible output
// pixel-for-pixel), which a rigid-body engine (cannon-es, rapier, ...) doesn't
// guarantee and doesn't need to provide for this "does it visually rest on top" use
// case. If true physical interactions (things sliding, toppling, colliding on their
// sides) are ever wanted, that's the point to reach for a physics engine instead — this
// resolver only handles vertical resting order.
//
// Has no THREE.js/DOM dependency so it's trivially testable: geometry measurement is
// the caller's job via each item's `place(floorY)` callback.
export function resolveStacking(items) {
  const byLayerAsc = [...items].sort((a, b) => a.layer - b.layer);
  const resolved = [];
  const results = new Map();

  const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

  let i = 0;
  while (i < byLayerAsc.length) {
    const layer = byLayerAsc[i].layer;
    const batch = [];
    while (i < byLayerAsc.length && byLayerAsc[i].layer === layer) batch.push(byLayerAsc[i++]);

    // floorY for every item in this batch is computed against `resolved` as it stood
    // BEFORE this batch started (strictly lower layers only) — items in the same
    // batch don't get pushed to `resolved` until AFTER the whole batch's floorYs are
    // computed, so same-layer objects never see each other here regardless of which
    // order they happen to appear in (previously, an earlier same-layer item could
    // already be in `resolved` by the time a later one in the same batch was checked,
    // silently letting same-layer objects stack on each other).
    const supportsOf = batch.map((item) => (item.groundSnap ? resolved.filter((r) => overlaps(item, r)) : []));
    const floorYs = supportsOf.map((sup) => sup.reduce((y, r) => Math.max(y, r.topY), 0));

    // `supports` lets the caller rest the item exactly on what's under it (settle.js)
    // instead of on the top of their bounding boxes; floorY is that coarser answer
    batch.forEach((item, idx) => {
      const { y, topY } = item.place(floorYs[idx], supportsOf[idx].map((r) => r.ref));
      results.set(item.id, y);
      resolved.push({ minX: item.minX, maxX: item.maxX, minZ: item.minZ, maxZ: item.maxZ, topY, ref: item.ref });
    });
  }

  return results;
}
