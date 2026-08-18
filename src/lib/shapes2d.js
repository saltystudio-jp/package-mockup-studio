// 2D shape presets + extrusion for pieces (駒): "basic shape = a box; thin+rounded = a
// card; extruded to an arbitrary footprint = a piece" — cards stay on RoundedBoxGeometry
// (see PackageBoxMockup.jsx) since that's a direct, proven fit, but pieces need genuine
// arbitrary footprints, so they're built from a THREE.Shape and extruded. The same
// pipeline is reused for SVG-imported shapes later (SVGLoader also produces THREE.Shape
// objects), so a preset and a custom SVG piece are otherwise identical downstream.
import * as THREE from "three";

// each preset is defined once in a normalized unit square (-0.5..0.5 on both axes) and
// scaled to the piece's actual W/D at build time — so one definition works at any size.
export const PIECE_SHAPE_KINDS = [
  { key: "circle", label: "円" },
  { key: "roundedSquare", label: "角丸四角" },
  { key: "hexagon", label: "六角形" },
  { key: "triangle", label: "三角形" },
];

function unitCircleShape() {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 0.5, 0, Math.PI * 2, false);
  return shape;
}

function unitRoundedSquareShape(cornerFrac = 0.18) {
  const s = 0.5;
  const r = Math.max(0, Math.min(0.5, cornerFrac));
  const shape = new THREE.Shape();
  shape.moveTo(-s + r, -s);
  shape.lineTo(s - r, -s);
  shape.absarc(s - r, -s + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(s, s - r);
  shape.absarc(s - r, s - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-s + r, s);
  shape.absarc(-s + r, s - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-s, -s + r);
  shape.absarc(-s + r, -s + r, r, Math.PI, Math.PI * 1.5, false);
  return shape;
}

function unitPolygonShape(sides, rotation = 0) {
  const shape = new THREE.Shape();
  for (let i = 0; i <= sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    const x = Math.cos(a) * 0.5;
    const y = Math.sin(a) * 0.5;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
}

export function buildPresetShape(kind, cornerFrac) {
  switch (kind) {
    case "circle":
      return unitCircleShape();
    case "hexagon":
      return unitPolygonShape(6, Math.PI / 6);
    case "triangle":
      return unitPolygonShape(3, -Math.PI / 2);
    case "roundedSquare":
    default:
      return unitRoundedSquareShape(cornerFrac);
  }
}

// splits ExtrudeGeometry's default 2-group layout (group 0 = top+bottom caps combined,
// group 1 = side walls) into 3 independent groups classified by face normal direction
// (top/+Z, bottom/-Z, side/~0) rather than by assumed vertex-emission order — so a piece
// can show its symbol on the top face only, a plain body color on the bottom + sides,
// same visual convention as the card's face texturing.
function splitCapGroups(geometry) {
  const nonIndexed = geometry.toNonIndexed();
  const pos = nonIndexed.attributes.position;
  const normal = nonIndexed.attributes.normal;
  const triCount = pos.count / 3;
  const classOf = new Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const i = t * 3;
    const nz = (normal.getZ(i) + normal.getZ(i + 1) + normal.getZ(i + 2)) / 3;
    classOf[t] = nz > 0.5 ? "top" : nz < -0.5 ? "bottom" : "side";
  }
  const order = { bottom: 0, top: 1, side: 2 };
  nonIndexed.clearGroups();
  let runStart = 0;
  let runClass = classOf[0];
  for (let t = 1; t <= triCount; t++) {
    const cls = t < triCount ? classOf[t] : null;
    if (cls !== runClass) {
      nonIndexed.addGroup(runStart * 3, (t - runStart) * 3, order[runClass]);
      runStart = t;
      runClass = cls;
    }
  }
  return nonIndexed;
}

// builds a piece's final world-space geometry: extrude the unit shape by a unit depth,
// scale to the piece's actual W (mm) / D (mm) / thickness (mm) in three.js units, then
// rotate so the thin axis lies along world Y (thickness "up") with the footprint on
// XZ — matching the box/card convention of "lying flat by default, groundSnapY measures
// the actual bounding box afterward regardless of local geometry offset".
export function buildExtrudedPieceGeometry(shape, { widthUnits, depthUnits, thicknessUnits, curveSegments = 32 }) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments });
  const split = splitCapGroups(geo);
  geo.dispose();
  split.scale(widthUnits, depthUnits, thicknessUnits);
  split.rotateX(-Math.PI / 2);
  return split;
}
