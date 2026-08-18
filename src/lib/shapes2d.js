// 2D shape presets + extrusion for pieces (駒) AND cards: both are "a flat shape,
// extruded to a thickness, with sharp (not beveled) edges around the perimeter" — cards
// use roundedRectShape below (a true-scale rounded rectangle, so a card's corner radius
// stays circular even though width and depth differ a lot), pieces use one of the
// PIECE_SHAPE_KINDS presets or an imported SVG outline. Deliberately NOT
// RoundedBoxGeometry for either: that geometry rounds every edge of the box uniformly
// (it's built for corners like a real cardboard box's bevel), so applying it to a thin
// card conflates "round the four corners" with "round the paper-thin edge profile too"
// — a real card's corners are rounded but its edge stays a sharp flat rectangle in
// cross-section. The same extrude pipeline is reused for SVG-imported piece shapes
// (SVGLoader also produces THREE.Shape objects), so a preset and a custom SVG piece are
// otherwise identical downstream.
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

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

// a rounded rectangle built at TRUE scale (real width/depth/radius, not a normalized
// unit square scaled non-uniformly afterward) — for a card, whose width and depth
// usually differ a lot (63x88mm), scaling a unit-square corner arc non-uniformly would
// stretch it into an ellipse instead of keeping the actual mm radius the user asked
// for. Used with buildExtrudedPieceGeometry passing widthUnits/depthUnits = 1 (the
// shape is already at final size) so only the thickness axis still needs scaling.
export function roundedRectShape(width, depth, radius) {
  const w = width / 2;
  const d = depth / 2;
  const r = Math.max(0, Math.min(radius, Math.min(width, depth) / 2));
  const shape = new THREE.Shape();
  shape.moveTo(-w + r, -d);
  shape.lineTo(w - r, -d);
  if (r > 0) shape.absarc(w - r, -d + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(w, d - r);
  if (r > 0) shape.absarc(w - r, d - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-w + r, d);
  if (r > 0) shape.absarc(-w + r, d - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-w, -d + r);
  if (r > 0) shape.absarc(-w + r, -d + r, r, Math.PI, Math.PI * 1.5, false);
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

// unit-space presets — everything EXCEPT roundedSquare, which needs true-scale
// construction (see roundedRectShape above) instead of a unit shape + later
// non-uniform scale, so its corner radius stays a real circular arc regardless of the
// component's own width:depth ratio.
export function buildPresetShape(kind) {
  switch (kind) {
    case "hexagon":
      return unitPolygonShape(6, Math.PI / 6);
    case "triangle":
      return unitPolygonShape(3, -Math.PI / 2);
    case "circle":
    default:
      return unitCircleShape();
  }
}

// parses an uploaded SVG's outline(s) into the same normalized unit-square space the
// presets above live in, so a custom SVG piece plugs into buildExtrudedPieceGeometry
// exactly like a preset does. Curves are flattened to polygons (via Shape.getPoints)
// rather than kept as exact bezier/arc curves — losing that precision is invisible at a
// reasonable sample count and makes normalizing (recenter + uniform scale + SVG's
// Y-down → shape-space Y-up flip) straightforward on plain point arrays instead of
// having to transform each curve type individually. Multiple subpaths (e.g. a logo with
// separate letters, or a shape with holes) all come through as separate Shape entries —
// ExtrudeGeometry accepts a shapes ARRAY natively and extrudes/caps each one, so no
// special-casing is needed downstream.
export function parseSvgToUnitShapes(svgText) {
  const data = new SVGLoader().parse(svgText);
  const rawShapes = [];
  data.paths.forEach((path) => {
    SVGLoader.createShapes(path).forEach((s) => rawShapes.push(s));
  });
  if (rawShapes.length === 0) return null;

  const SAMPLES = 48;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = (p) => {
    bounds.minX = Math.min(bounds.minX, p.x);
    bounds.maxX = Math.max(bounds.maxX, p.x);
    bounds.minY = Math.min(bounds.minY, p.y);
    bounds.maxY = Math.max(bounds.maxY, p.y);
  };
  rawShapes.forEach((s) => {
    s.getPoints(SAMPLES).forEach(grow);
    (s.holes || []).forEach((h) => h.getPoints(SAMPLES).forEach(grow));
  });

  const w = Math.max(1e-6, bounds.maxX - bounds.minX);
  const h = Math.max(1e-6, bounds.maxY - bounds.minY);
  const scale = 1 / Math.max(w, h);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const norm = (p) => new THREE.Vector2((p.x - cx) * scale, -(p.y - cy) * scale);

  const shapes = rawShapes.map((s) => {
    const outer = new THREE.Shape(s.getPoints(SAMPLES).map(norm));
    outer.holes = (s.holes || []).map((hole) => new THREE.Path(hole.getPoints(SAMPLES).map(norm)));
    return outer;
  });

  return { shapes, aspect: w / h };
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

// single entry point for building a component's geometry regardless of kind — picks
// true-scale construction for roundedSquare (see roundedRectShape) vs. unit-shape +
// scale for everything else (circle/hexagon/triangle/svg), so callers don't need to
// know which shapes need which path. `component` is {kind, w, d, thickness,
// cornerRadius, svgText} with w/d/thickness/cornerRadius in mm; `scale` converts mm to
// three.js world units (matches the app-wide SCALE constant).
export function buildComponentGeometry(component, scale) {
  const w = component.w * scale;
  const d = component.d * scale;
  const thickness = Math.max(0.0001, component.thickness * scale);
  if (component.kind === "roundedSquare") {
    const shape = roundedRectShape(w, d, (component.cornerRadius || 0) * scale);
    return buildExtrudedPieceGeometry(shape, { widthUnits: 1, depthUnits: 1, thicknessUnits: thickness });
  }
  if (component.kind === "svg" && component.svgText) {
    const parsed = parseSvgToUnitShapes(component.svgText);
    const shape = parsed ? parsed.shapes : buildPresetShape("circle");
    return buildExtrudedPieceGeometry(shape, { widthUnits: w, depthUnits: d, thicknessUnits: thickness });
  }
  const shape = buildPresetShape(component.kind);
  return buildExtrudedPieceGeometry(shape, { widthUnits: w, depthUnits: d, thicknessUnits: thickness });
}
