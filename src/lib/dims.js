// Box dimensions with ratio locks (the chain toggles next to 幅/奥行/高さ).
//
// `linked` is the set of dimension keys whose ratio is locked together. Changing one of
// them scales every linked one by the same factor, so the box keeps its proportions;
// changing an unlinked one changes only itself.

const round1 = (v) => Math.round(v * 10) / 10;

export function changeDims(dims, key, value, linked, min = 1) {
  const v = Math.max(min, value);
  const old = dims[key];
  if (!linked?.has(key) || !(old > 0)) return { ...dims, [key]: round1(v) };
  // the smallest linked dimension can't go below `min`, so the factor is limited by it
  let f = v / old;
  linked.forEach((k) => {
    if (dims[k] > 0) f = Math.max(f, min / dims[k]);
  });
  const next = { ...dims };
  linked.forEach((k) => {
    if (dims[k] > 0) next[k] = round1(dims[k] * f);
  });
  return next;
}
