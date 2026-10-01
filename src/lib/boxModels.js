// Box types — 身蓋 (lidded), キャラメル (one-piece tuck box), スリーブ (sleeve + tray).
//
// Each type answers two questions, and both answers live here so they can't drift
// apart:
//   1. what the NET (展開図) looks like — boxNetSlots(): which print sheets the type
//      needs and where every face sits on each sheet
//   2. what the 3D MODEL looks like — buildBoxModel(): meshes, plus a `faces` table
//      naming the material every net region ends up on
// The texture pipeline in PackageBoxMockup.jsx just joins the two by face key.
//
// ---- How the キャラメル / スリーブ nets map onto the model ----
// These nets are physically correct print sheets: the art on each region is exactly
// what ends up on that face once the sheet is folded. That's why regions aren't all
// upright — a wrap-around strip prints its back panel upside down, and end flaps print
// sideways. Each region's `rotate` (clockwise, applied by extractFaceCanvas) turns the
// sliced region upright in the face's own texture frame; `arrowRotate` makes the guide
// arrow point at the edge that becomes the top of the art.
//
// The texture frames those rotations target come from three.js's box UV layout
// (identical for BoxGeometry and RoundedBoxGeometry), each face viewed from outside:
//   +x: top=+y left=+z   -x: top=+y left=-z   +y: top=-z left=-x
//   -y: top=+z left=-x   +z: top=+y left=-x   -z: top=+y left=+x
// Every region→face mapping is a pure rotation (folding paper never mirrors it). The
// only flips are on the tray's inner faces, which are BackSide materials seen from
// inside the cavity — a texture viewed from behind reads mirrored, so those faces
// pre-flip their canvas to compensate.
//
// The 身蓋 box keeps its original nets and empirically-tuned corrections untouched
// (BODY_ORIENT / LID_ORIENT / DEFAULT_FACE_TRANSFORMS in nets.js).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { netLayout, singleFaceLayout, BODY_ORIENT, LID_ORIENT, DEFAULT_FACE_TRANSFORMS } from "./nets.js";
import { srgb } from "./color.js";

export const BOX_TYPES = [
  { key: "lidded", label: "身蓋" },
  { key: "caramel", label: "キャラメル" },
  { key: "sleeve", label: "スリーブ" },
];
export const BOX_TYPE_LABEL = { lidded: "身蓋箱", caramel: "キャラメル箱", sleeve: "スリーブ箱" };

const ROUND_SEGMENTS = 4;
export const SLEEVE_PAPER = 1; // mm — board thickness of the sleeve walls
const TRAY_GAP = 0.6; // mm — slack between tray and sleeve, so it reads as sliding rather than fused
const TRAY_FLOOR = 2; // mm
const GLUE = 12; // mm — のりしろ
const TUCK = 15; // mm — 差し込み

// fallback for a printable face that has no art yet: a light neutral grey, so a plain
// box still reads against the white product-shot background (the old beige didn't)
const PRINT_BASE = 0xc4c6c9;
const LID_BASE = 0xd2d4d7; // a step lighter, so lid and body are told apart before any art
const LID_BOARD = 1.5; // mm — the lid's board thickness: its top sits this far above the body's
const BOARD_INSIDE = 0xebe5d8; // raw board: surfaces that are never printed

// the tray is derived from the sleeve rather than sized independently — it has to fit
// inside it, and a separate set of tray fields would just be a way to make them disagree
export function trayDims(box) {
  const Wt = Math.max(2, box.w - 2);
  const Ht = Math.max(2, box.h - 2 * SLEEVE_PAPER - TRAY_GAP);
  const Dt = Math.max(2, box.d - 2 * SLEEVE_PAPER - TRAY_GAP);
  const t = Math.max(0.5, Math.min(box.wallThickness ?? 6, Math.min(Wt, Dt) / 2 - 1));
  const Hi = Math.max(0.5, Ht - TRAY_FLOOR);
  return { Wt, Ht, Dt, t, Hi };
}

// `rotate` (how the slicer turns this region to fit its 3D face) is pure geometry.
// `arrow` is which way is UP for the artwork in this region, as drawn on the sheet
// (degrees clockwise from the sheet's up) — a presentation convention. They coincide
// when the face's texture frame happens to be "upright", hence the default.
const region = (key, x, y, w, h, rotate, label, arrow = -rotate) => ({ key, x, y, w, h, rotate, label, arrowRotate: arrow });

// turns a whole net 90° counter-clockwise on the sheet. Content drawn into the rotated
// sheet is turned too, so every region's slicing rotation gains 90° clockwise to land on
// its face exactly as before; arrows turn with the drawing.
function rotateLayoutCCW({ totalW, totalH, regions }) {
  const norm = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
  return {
    totalW: totalH,
    totalH: totalW,
    regions: regions.map((r) => ({
      ...r,
      x: r.y,
      y: totalW - r.x - r.w,
      w: r.h,
      h: r.w,
      rotate: norm(r.rotate + 90),
      arrowRotate: norm((r.arrowRotate || 0) - 90),
    })),
  };
}
const flap = (key, x, y, w, h, label) => ({ key, x, y, w, h, rotate: 0, label, face: false });

// Top panel in the middle, a wrap-around strip below it (front → bottom → back → glue),
// end closures hinged off the top panel's sides with their tuck flaps beyond them.
// Dust flaps are left off: they're never visible, and the guide is about where art goes.
function caramelNet({ w: W, d: D, h: H }) {
  const x0 = TUCK + H;
  return {
    totalW: 2 * TUCK + 2 * H + W,
    totalH: 2 * D + 2 * H + GLUE,
    regions: [
      region("car-top", x0, 0, W, D, 0, "天面"),
      region("car-front", x0, D, W, H, 0, "正面"),
      region("car-bottom", x0, D + H, W, D, 0, "底面"),
      region("car-back", x0, 2 * D + H, W, H, 180, "背面"),
      flap("glue", x0, 2 * D + 2 * H, W, GLUE, "のりしろ"),
      region("car-left", TUCK, 0, H, D, -90, "左側面"),
      region("car-right", x0 + W, 0, H, D, 90, "右側面"),
      flap("tuck-l", 0, 0, TUCK, D, "差込"),
      flap("tuck-r", x0 + W + H, 0, TUCK, D, "差込"),
    ],
  };
}

// ---- スリーブ: a standing box. The model's slide axis is its local X; standing turns
// that axis vertical (see boxBaseRotation), so the tray pulls straight UP and the
// sleeve's big +Y panel faces the viewer. Art on every sleeve/tray face is therefore
// "up = +X" (toward the end the tray comes out of); the two ends of the tray use the
// usual top/bottom convention (up = back for the upper end, front for the lower).
//
// Outside: the tube around X laid out as one horizontal strip of upright panels, the
// order you'd walk round it — left side, front (表), right side, back (裏), glue flap.
function sleeveNet({ w: W, d: D, h: H }) {
  return {
    totalW: 2 * H + 2 * D + GLUE,
    totalH: W,
    regions: [
      region("slv-back", 0, 0, H, W, -90, "左側面", 0),
      region("slv-top", H, 0, D, W, 90, "表", 0),
      region("slv-front", H + D, 0, H, W, 90, "右側面", 0),
      region("slv-bottom", 2 * H + D, 0, D, W, 90, "裏", 0),
      flap("glue", 2 * H + 2 * D, 0, GLUE, W, "のりしろ"),
    ],
  };
}

// Double-wall tray: from each edge of the floor, an arm runs outer wall → rim (the wall
// thickness) → inner wall that folds back down inside. Built on a sheet viewed from its
// printed side, the OUTSIDE of the floor (i.e. from underneath), then turned 90° so the
// standing "up" (+X) reads as up on the sheet: the upper end's arm ends up on top.
// Slicing rotations are geometric (which way each region lands on its face); arrows
// follow the standing art convention above.
function trayNet({ Wt, Ht, Dt, t, Hi }) {
  const A = Ht + t + Hi;
  return rotateLayoutCCW({
    totalW: Wt + 2 * A,
    totalH: Dt + 2 * A,
    regions: [
      region("tray-bottom", A, A, Wt, Dt, 0, "底(外側)", 90),
      region("tray-front", A, A - Ht, Wt, Ht, 0, "右側面", 90),
      region("tray-rim-front", A, A - Ht - t, Wt, t, 0, "フチ", 90),
      region("tray-in-front", A + t, 0, Wt - 2 * t, Hi, 180, "右(内側)", 90),
      region("tray-back", A, A + Dt, Wt, Ht, 180, "左側面", 90),
      region("tray-rim-back", A, A + Dt + Ht, Wt, t, 0, "フチ", 90),
      region("tray-in-back", A + t, A + Dt + Ht + t, Wt - 2 * t, Hi, 0, "左(内側)", 90),
      region("tray-left", A - Ht, A, Ht, Dt, 90, "下端", -90),
      region("tray-rim-left", A - Ht - t, A + t, t, Dt - 2 * t, 180, "フチ", -90),
      region("tray-in-left", 0, A + t, Hi, Dt - 2 * t, -90, "下端(内側)", -90),
      region("tray-right", A + Wt, A, Ht, Dt, -90, "上端", -90),
      region("tray-rim-right", A + Wt + Ht, A + t, t, Dt - 2 * t, 180, "フチ", -90),
      region("tray-in-right", A + Wt + Ht + t, A + t, Hi, Dt - 2 * t, 90, "上端(内側)", -90),
    ],
  });
}

// the standing pose of a スリーブ box: local X (slide axis) → up, local Y (the 表
// panel, the tray's open side) → toward the viewer, local Z → right. Other box types
// use the shared standing/lying rotation unchanged.
const SLEEVE_STANDING = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0))
);
export function boxBaseRotation(box) {
  return box.boxType === "sleeve" && box.orientation !== "lying" ? SLEEVE_STANDING : null;
}

// Which print sheets a box of this type needs. `orient` is the hidden baseline fix
// applied before slicing (only the 身蓋 box's real-world files need one).
export function boxNetSlots(box) {
  const type = box.boxType || "lidded";
  if (type === "caramel") {
    return [{ key: "caramel", label: "展開図", layout: caramelNet(box), orient: null }];
  }
  if (type === "sleeve") {
    const td = trayDims(box);
    const iw = td.Wt - 2 * td.t;
    const id = td.Dt - 2 * td.t;
    return [
      { key: "sleeve", label: "スリーブ", layout: sleeveNet(box), orient: null },
      { key: "tray", label: "内箱", layout: trayNet(td), orient: null },
      {
        // an upright picture of the inside floor as seen when the tray is pulled up
        // (length vertical); turned onto the floor's texture frame by `rotate`
        key: "trayInner",
        label: "内箱の底",
        layout: { totalW: id, totalH: iw, regions: [region("tray-floor", 0, 0, id, iw, -90, "内箱・底(内側)", 0)] },
        orient: null,
      },
    ];
  }
  const lidW = box.w + box.clearance * 2;
  const lidD = box.d + box.clearance * 2;
  return [
    { key: "body", label: "身", layout: netLayout(box.w, box.d, box.h, "body"), orient: BODY_ORIENT },
    { key: "lid", label: "蓋 外側", layout: netLayout(lidW, lidD, box.lidH, "lid"), orient: LID_ORIENT },
    { key: "lidInner", label: "蓋 内側", layout: singleFaceLayout("lid-inner", lidW, lidD), orient: null },
  ];
}

// Faces built by gluing several net regions together — the tray's rim is one flat ring
// in 3D but four separate strips on the sheet. Rects are in mm on the +y face frame
// (top = back). Returns any composites whose parts were sliced.
export function composeFaceCanvases(box, canvasByKey) {
  if ((box.boxType || "lidded") !== "sleeve") return {};
  const parts = ["tray-rim-front", "tray-rim-back", "tray-rim-left", "tray-rim-right"];
  if (!parts.some((k) => canvasByKey[k])) return {};
  const { Wt, Dt, t } = trayDims(box);
  const ref = canvasByKey["tray-rim-front"] || canvasByKey["tray-rim-back"];
  const pxPerMm = ref ? ref.width / Wt : canvasByKey["tray-rim-left"].height / (Dt - 2 * t);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(Wt * pxPerMm));
  canvas.height = Math.max(1, Math.round(Dt * pxPerMm));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `#${PRINT_BASE.toString(16)}`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const place = { "tray-rim-back": [0, 0, Wt, t], "tray-rim-front": [0, Dt - t, Wt, t], "tray-rim-left": [0, t, t, Dt - 2 * t], "tray-rim-right": [Wt - t, t, t, Dt - 2 * t] };
  parts.forEach((k) => {
    const c = canvasByKey[k];
    if (!c) return;
    const [x, y, w, h] = place[k];
    ctx.drawImage(c, x * pxPerMm, y * pxPerMm, w * pxPerMm, h * pxPerMm);
  });
  return { "tray-rim": canvas };
}

// flat rectangular ring (outer w×h, border `b`) in the XY plane, with UVs normalized to
// the OUTER rect so a single w×h texture maps across the whole ring
function ringGeometry(w, h, b) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -h / 2);
  shape.lineTo(w / 2, -h / 2);
  shape.lineTo(w / 2, h / 2);
  shape.lineTo(-w / 2, h / 2);
  shape.lineTo(-w / 2, -h / 2);
  const hole = new THREE.Path();
  const iw = Math.max(0.0001, w / 2 - b);
  const ih = Math.max(0.0001, h / 2 - b);
  hole.moveTo(-iw, -ih);
  hole.lineTo(-iw, ih);
  hole.lineTo(iw, ih);
  hole.lineTo(iw, -ih);
  hole.lineTo(-iw, -ih);
  shape.holes.push(hole);
  const geo = new THREE.ShapeGeometry(shape);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
  uv.needsUpdate = true;
  return geo;
}

// Builds one box's meshes. Returns:
//   group      — add under the instance's placement group; local y=0 is the box's base
//   measureObj — what ground-snapping measures (the body/shell, never a lifted lid or
//                a pulled-out tray, so opening the box doesn't change where it rests)
//   faces      — { faceKey: { mat, transform } } every material net art can land on
//   animate(b) — per-frame lid lift / tray slide from the instance's own state
//   dispose()
export function buildBoxModel(box, SCALE) {
  const type = box.boxType || "lidded";
  const geometries = [];
  const materials = [];
  const faces = {};
  const S = SCALE;
  const group = new THREE.Group();

  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  materials.push(hidden);
  const plain = (color, extra) => {
    const m = new THREE.MeshStandardMaterial({ color: srgb(color), roughness: 0.82, metalness: 0, ...extra });
    m.userData.baseColor = color;
    materials.push(m);
    return m;
  };
  const face = (key, color, transform, extra) => {
    const m = plain(color, extra);
    faces[key] = { mat: m, transform: transform || null };
    return m;
  };
  const mesh = (geo, mats) => {
    if (!geometries.includes(geo)) geometries.push(geo);
    const m = new THREE.Mesh(geo, mats);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  const bw = box.w * S;
  const bh = box.h * S;
  const bd = box.d * S;
  const radius = (box.bevelRadius || 0) * S;
  let measureObj;
  let animate = () => {};

  if (type === "caramel") {
    const body = mesh(new RoundedBoxGeometry(bw, bh, bd, ROUND_SEGMENTS, radius), [
      face("car-right", PRINT_BASE),
      face("car-left", PRINT_BASE),
      face("car-top", PRINT_BASE),
      face("car-bottom", PRINT_BASE),
      face("car-front", PRINT_BASE),
      face("car-back", PRINT_BASE),
    ]);
    body.position.y = bh / 2;
    group.add(body);
    measureObj = body;
  } else if (type === "sleeve") {
    const s = SLEEVE_PAPER * S;
    const inside = plain(BOARD_INSIDE, { side: THREE.BackSide });
    const shell = mesh(new THREE.BoxGeometry(bw, bh, bd), [
      hidden,
      hidden,
      face("slv-top", PRINT_BASE),
      face("slv-bottom", PRINT_BASE),
      face("slv-front", PRINT_BASE),
      face("slv-back", PRINT_BASE),
    ]);
    shell.position.y = bh / 2;
    const sleeveInside = mesh(
      new THREE.BoxGeometry(bw, Math.max(0.0001, bh - 2 * s), Math.max(0.0001, bd - 2 * s)),
      [hidden, hidden, inside, inside, inside, inside]
    );
    sleeveInside.position.y = bh / 2;
    // the board's cut edge at each open end — without it the 1mm gap between the
    // sleeve's outer and inner surfaces reads as a see-through slit
    const edgeGeo = ringGeometry(bd, bh, s);
    const edgeMat = plain(BOARD_INSIDE, { side: THREE.DoubleSide });
    [1, -1].forEach((sign) => {
      const edge = mesh(edgeGeo, edgeMat);
      edge.rotation.y = Math.PI / 2;
      edge.position.set((sign * bw) / 2, bh / 2, 0);
      group.add(edge);
    });
    group.add(shell, sleeveInside);
    measureObj = shell;

    const td = trayDims(box);
    const Wt = td.Wt * S;
    const Ht = td.Ht * S;
    const Dt = td.Dt * S;
    const t = td.t * S;
    const Hi = td.Hi * S;
    const tray = new THREE.Group();
    tray.position.y = s + (TRAY_GAP / 2) * S;
    const trayShell = mesh(new THREE.BoxGeometry(Wt, Ht, Dt), [
      face("tray-right", PRINT_BASE),
      face("tray-left", PRINT_BASE),
      hidden,
      face("tray-bottom", PRINT_BASE),
      face("tray-front", PRINT_BASE),
      face("tray-back", PRINT_BASE),
    ]);
    trayShell.position.y = Ht / 2;
    const back = { side: THREE.BackSide };
    const cavity = mesh(new THREE.BoxGeometry(Wt - 2 * t, Hi, Dt - 2 * t), [
      face("tray-in-right", BOARD_INSIDE, { flipH: true }, back),
      face("tray-in-left", BOARD_INSIDE, { flipH: true }, back),
      hidden,
      face("tray-floor", BOARD_INSIDE, { flipH: true }, back),
      face("tray-in-front", BOARD_INSIDE, { flipH: true }, back),
      face("tray-in-back", BOARD_INSIDE, { flipH: true }, back),
    ]);
    cavity.position.y = Ht - Hi / 2;
    const rimGeo = ringGeometry(Wt, Dt, t);
    rimGeo.rotateX(-Math.PI / 2);
    const rim = mesh(rimGeo, face("tray-rim", PRINT_BASE));
    rim.position.y = Ht;
    tray.add(trayShell, cavity, rim);
    group.add(tray);
    // slides out along +X; capped short of fully out so it still visibly sits in the sleeve
    animate = (b) => {
      tray.position.x = ((b.trayOut ?? 0) / 100) * Wt * 0.85;
    };
  } else {
    const lw = (box.w + box.clearance * 2) * S;
    const ld = (box.d + box.clearance * 2) * S;
    const lh = box.lidH * S;
    const body = mesh(new RoundedBoxGeometry(bw, bh, bd, ROUND_SEGMENTS, radius), [
      face("body-right", PRINT_BASE, DEFAULT_FACE_TRANSFORMS["body-right"]),
      face("body-left", PRINT_BASE, DEFAULT_FACE_TRANSFORMS["body-left"]),
      plain(0xb6b8bb, { roughness: 0.92 }), // open top of the body: covered by the lid, never printed
      face("body-center", PRINT_BASE, DEFAULT_FACE_TRANSFORMS["body-center"]),
      face("body-front", PRINT_BASE, DEFAULT_FACE_TRANSFORMS["body-front"]),
      face("body-back", PRINT_BASE, DEFAULT_FACE_TRANSFORMS["body-back"]),
    ]);
    body.position.y = bh / 2;
    const lidBase = LID_BASE;
    const lid = mesh(new RoundedBoxGeometry(lw, lh, ld, ROUND_SEGMENTS, radius), [
      face("lid-right", lidBase, DEFAULT_FACE_TRANSFORMS["lid-right"]),
      face("lid-left", lidBase, DEFAULT_FACE_TRANSFORMS["lid-left"]),
      face("lid-center", lidBase, DEFAULT_FACE_TRANSFORMS["lid-center"]),
      face("lid-inner", 0xe1e2e4, DEFAULT_FACE_TRANSFORMS["lid-inner"]),
      face("lid-front", lidBase, DEFAULT_FACE_TRANSFORMS["lid-front"]),
      face("lid-back", lidBase, DEFAULT_FACE_TRANSFORMS["lid-back"]),
    ]);
    // closed, the lid rests ON the body: its top is one board thickness above the
    // body's top. With the two tops in the same plane (as before) the lid and body
    // surfaces fought over the same pixels and the top shimmered.
    const lidTop = bh + LID_BOARD * S;
    const lidClosedY = lidTop - lh / 2;
    const lidLift = bh * 1.4 + lh;
    lid.position.y = lidClosedY;
    group.add(body, lid);
    // What the box rests on: the outline of the CLOSED box, body and lid together.
    // Measuring the body alone (as before) ignored that the lid is wider by the
    // clearance on every side, so a box stood on its side rested on the body and the
    // lid's rim sank that far into the floor. A fixed proxy rather than the live lid
    // also keeps opening the lid from changing where the box sits. Invisible, casts
    // nothing, and carries no instanceId, so picking and drops never hit it.
    // (a lid deeper than the body — a full-telescope box — hangs below the body's base,
    // so the proxy reaches down to the lid's lower edge in that case)
    const restH = Math.max(lidTop, lh);
    const restGeo = new THREE.BoxGeometry(Math.max(bw, lw), restH, Math.max(bd, ld));
    geometries.push(restGeo);
    const rest = new THREE.Mesh(restGeo, hidden);
    rest.position.y = lidTop - restH / 2;
    rest.userData.restProxy = true;
    group.add(rest);
    measureObj = rest;
    animate = (b) => {
      lid.position.y = lidClosedY + ((b.lidOpen ?? 0) / 100) * lidLift;
    };
  }

  // each printable face's size in mm along its texture's u and v — what a surface
  // finish needs to keep its pattern at a true physical scale (see finish.js). For box
  // geometry the material index says which pair of axes the face spans.
  const faceMats = new Set(Object.values(faces).map((f) => f.mat));
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    o.geometry.boundingBox.getSize(size);
    const [sx, sy, sz] = [size.x / S, size.y / S, size.z / S];
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m, i) => {
      if (!faceMats.has(m)) return;
      if (!Array.isArray(o.material)) m.userData.sizeMm = [sx, sz]; // the tray's rim ring, lying flat
      else m.userData.sizeMm = i < 2 ? [sz, sy] : i < 4 ? [sx, sz] : [sx, sy];
    });
  });

  return {
    group,
    measureObj,
    faces,
    animate,
    dispose() {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    },
  };
}

// everything that changes the model's GEOMETRY — anything else (position, lid open,
// images) is applied without rebuilding meshes
export function boxGeometryKey(box) {
  return [box.boxType || "lidded", box.w, box.d, box.h, box.lidH, box.clearance, box.bevelRadius, box.wallThickness].join("|");
}
