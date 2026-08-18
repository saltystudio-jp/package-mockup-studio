import React, { useState, useRef, useEffect, useCallback } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import CropEditorModal from "./components/CropEditorModal.jsx";
import ScrubField from "./components/ScrubField.jsx";
import CardPanel from "./components/CardPanel.jsx";
import PiecePanel from "./components/PiecePanel.jsx";
import SymbolLibraryPanel from "./components/SymbolLibraryPanel.jsx";
import PieceShapeLibraryPanel from "./components/PieceShapeLibraryPanel.jsx";
import { PIECE_SHAPE_KINDS, buildPresetShape, buildExtrudedPieceGeometry, parseSvgToUnitShapes } from "./lib/shapes2d.js";
import {
  imgW,
  imgH,
  rotatedImageCanvas,
  mirroredImageCanvas,
  cropFractions,
  applyColorCorrection,
  trimTransparentCanvas,
  hexToRgba,
  makePasteHandler,
  coverFitRepeatOffset,
  detectAlphaCornerRadiusPx,
  cropToCanvas,
} from "./lib/imaging.js";
import { createSymbol, buildSymbolFaceCanvas, symbolAspect, DEFAULT_SYMBOL_COLOR } from "./lib/symbols.js";
import { composePlacementQuaternion, groundSnapY, measureXZFootprint } from "./lib/placement.js";
import { resolveStacking } from "./lib/stacking.js";

const ROUND_SEGMENTS = 4; // corner smoothness for RoundedBoxGeometry

// hidden baseline corrections for uploaded net images — most real print files need the
// same fix, so these are applied unconditionally to the SLICING pipeline only. The crop
// editor/guide preview deliberately shows the raw uploaded file instead (see
// orientedTransform/rawSpaceLayout below), converting crop percentages between the two
// coordinate spaces so what the user sees while trimming matches their own file.
const BODY_ORIENT = { baselineRotate: 180, mirror: true };
const LID_ORIENT = { baselineRotate: 180 };

// per-face rotate/flipH/flipV applied directly to each already-sliced face canvas, on
// top of the BODY_ORIENT/LID_ORIENT baseline above. Values found empirically by the
// user while comparing the real artwork against the real rendered box — do not
// "simplify" these against theory, they're ground truth.
const DEFAULT_FACE_TRANSFORMS = {
  "body-front": { rotate: 0, flipH: false, flipV: true },
  "body-back": { rotate: 0, flipH: true, flipV: false },
  "body-left": { rotate: 0, flipH: false, flipV: true },
  "body-right": { rotate: 0, flipH: false, flipV: true },
  "body-center": { rotate: 0, flipH: false, flipV: true },
  "lid-front": { rotate: 0, flipH: false, flipV: false },
  "lid-back": { rotate: 0, flipH: true, flipV: true },
  "lid-left": { rotate: 0, flipH: false, flipV: false },
  "lid-right": { rotate: 0, flipH: false, flipV: false },
  "lid-center": { rotate: 0, flipH: false, flipV: false },
  "lid-inner": { rotate: 0, flipH: false, flipV: false },
};

/* ---------------------------------------------------------
   化粧箱(身+蓋)3Dモックアップスタジオ
   ---------------------------------------------------------
   1枚の展開図(ネット)画像から、身/蓋それぞれの5面を
   自動で切り出してBoxGeometryに貼り付ける。
--------------------------------------------------------- */

const SCALE = 0.01; // 1 three.js unit = 100mm

const FACE_LABELS = {
  "body-front": "身・正面",
  "body-back": "身・背面",
  "body-left": "身・左側面",
  "body-right": "身・右側面",
  "body-center": "身・底面",
  "lid-front": "蓋・正面",
  "lid-back": "蓋・背面",
  "lid-left": "蓋・左側面",
  "lid-right": "蓋・右側面",
  "lid-center": "蓋・天面",
  "lid-inner": "蓋・裏面(内側)",
};

function netLayout(W, D, H, prefix) {
  const totalW = 2 * H + W;
  const totalH = 2 * H + D;
  return {
    totalW,
    totalH,
    regions: [
      { key: `${prefix}-back`, x: H, y: 0, w: W, h: H, rotate: 0 },
      { key: `${prefix}-center`, x: H, y: H, w: W, h: D, rotate: 0 },
      { key: `${prefix}-front`, x: H, y: H + D, w: W, h: H, rotate: 0 },
      { key: `${prefix}-left`, x: 0, y: H, w: H, h: D, rotate: -90 },
      { key: `${prefix}-right`, x: H + W, y: H, w: H, h: D, rotate: 90 },
    ],
  };
}

// a single-face "net": used for the lid's underside, which isn't part of any fold —
// just one flat rectangle sourced from its own image.
function singleFaceLayout(key, w, h) {
  return { totalW: w, totalH: h, regions: [{ key, x: 0, y: 0, w, h, rotate: 0 }] };
}

// applies each face's own baked-in rotate/flipH/flipV (see DEFAULT_FACE_TRANSFORMS)
// directly to its already-sliced canvas.
function applyFaceTransform(canvas, dt) {
  const rotate = ((dt?.rotate || 0) % 360 + 360) % 360;
  const flipH = !!dt?.flipH;
  const flipV = !!dt?.flipV;
  if (rotate === 0 && !flipH && !flipV) return canvas;
  const swapped = rotate === 90 || rotate === 270;
  const out = document.createElement("canvas");
  out.width = swapped ? canvas.height : canvas.width;
  out.height = swapped ? canvas.width : canvas.height;
  const ctx = out.getContext("2d");
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

// applies transform.rotate (if any) once, so downstream crop/slice math never has to
// think about source rotation — everything else just treats this as "the image".
// `baselineRotate`/`mirror` are hidden, fixed corrections (not shown in the UI) applied
// on top of the user's own rotate value, for source files that consistently need the
// same fix — the rotate button/label still reads relative to this shifted baseline.
function orientedImage(img, transform, opts) {
  const baselineRotate = opts?.baselineRotate || 0;
  const deg = ((baselineRotate + (transform?.rotate || 0)) % 360 + 360) % 360;
  let out = deg ? rotatedImageCanvas(img, deg) : img;
  if (opts?.mirror) out = mirroredImageCanvas(out);
  return out;
}

// rotates a set of edge-trim amounts {top,bottom,left,right} the same way a canvas
// rotation (clockwise, ctx.rotate) would move those edges — e.g. after a 90° rotation,
// whatever used to trim the left edge now trims the top.
function rotateEdges(edges, degrees) {
  const deg = ((degrees % 360) + 360) % 360;
  const { top, bottom, left, right } = edges;
  if (deg === 90) return { top: left, right: top, bottom: right, left: bottom };
  if (deg === 180) return { top: bottom, bottom: top, left: right, right: left };
  if (deg === 270) return { top: right, right: bottom, bottom: left, left: top };
  return edges;
}
function mirrorEdgesH(edges) {
  return { ...edges, left: edges.right, right: edges.left };
}

// the crop UI always edits top/bottom/left/right against the RAW uploaded image (so
// what the user sees while trimming matches their own file), but slicing samples from
// the oriented (baselineRotate+mirror) image — this converts one set of edge-trim
// percentages into the other so extractFaceCanvas keeps working exactly as before.
function orientedTransform(transform, opts) {
  const totalDeg = (((opts?.baselineRotate || 0) + (transform?.rotate || 0)) % 360 + 360) % 360;
  let edges = rotateEdges(
    {
      top: transform?.cropTop || 0,
      bottom: transform?.cropBottom || 0,
      left: transform?.cropLeft || 0,
      right: transform?.cropRight || 0,
    },
    totalDeg
  );
  if (opts?.mirror) edges = mirrorEdgesH(edges);
  return { ...transform, cropTop: edges.top, cropBottom: edges.bottom, cropLeft: edges.left, cropRight: edges.right };
}

// mirrors rawSpaceLayout's job but for the net-layout's region rectangles instead of
// crop percentages, so the grid overlay drawn over the raw (unbaselined) image still
// lines up with it. Only undoes the fixed baselineRotate(+mirror) — a user's own extra
// 90°/270° rotate (rare, explicit) is intentionally left uncorrected here since that
// would also require swapping the whole layout's width/height; the crop math above
// handles that case correctly even though this overlay wouldn't.
function rawSpaceLayout(layout, opts) {
  const { totalW, totalH, regions } = layout;
  if ((opts?.baselineRotate || 0) !== 180) return layout;
  const rawRegions = regions.map((r) => {
    let x = r.x;
    const y = totalH - r.y - r.h;
    if (!opts?.mirror) x = totalW - r.x - r.w;
    return { ...r, x, y };
  });
  return { totalW, totalH, regions: rawRegions };
}

function extractFaceCanvas(img, region, netTotalW, netTotalH, transform) {
  const { cropLeft, cropRight, cropTop, cropBottom } = cropFractions(transform);
  const usableW = imgW(img) * Math.max(0.01, 1 - cropLeft - cropRight);
  const usableH = imgH(img) * Math.max(0.01, 1 - cropTop - cropBottom);
  const originX = imgW(img) * cropLeft;
  const originY = imgH(img) * cropTop;
  const pxPerMmX = usableW / netTotalW;
  const pxPerMmY = usableH / netTotalH;

  const sx = originX + region.x * pxPerMmX;
  const sy = originY + region.y * pxPerMmY;
  const sw = region.w * pxPerMmX;
  const sh = region.h * pxPerMmY;

  const totalRot = ((region.rotate % 360) + 360) % 360;
  const swapped = totalRot === 90 || totalRot === 270;
  const outW = Math.max(1, Math.round(swapped ? sh : sw));
  const outH = Math.max(1, Math.round(swapped ? sw : sh));
  // draw into exactly the rounded canvas size (not the fractional sw/sh) so adjacent
  // faces never leave a sub-pixel gap/overlap at their shared edge
  const destW = swapped ? outH : outW;
  const destH = swapped ? outW : outH;

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((totalRot * Math.PI) / 180);
  ctx.drawImage(img, sx, sy, sw, sh, -destW / 2, -destH / 2, destW, destH);
  ctx.restore();
  return canvas;
}

// crops (via texture repeat/offset, not resampling) a background image texture to
// "cover" the current viewport aspect ratio, the same way CSS background-size:cover
// would — otherwise Three.js just stretches scene.background textures to the raw
// viewport shape, distorting anything that isn't already the right aspect ratio.
function fitBackgroundTexture(t, container) {
  const tex = t.bgImageTexture;
  if (!tex || !container) return;
  const imgAspect = t.bgImageAspect;
  const vw = container.clientWidth;
  const vh = container.clientHeight;
  if (!imgAspect || !vw || !vh) return;
  const viewAspect = vw / vh;
  if (imgAspect > viewAspect) {
    const scale = viewAspect / imgAspect;
    tex.repeat.set(scale, 1);
    tex.offset.set((1 - scale) / 2, 0);
  } else {
    const scale = imgAspect / viewAspect;
    tex.repeat.set(1, scale);
    tex.offset.set(0, (1 - scale) / 2);
  }
}

// resolves a box instance's actual rendered param values: any field the instance has
// marked `linked` reads from the reference (box1) instead of its own copy, so a link
// can never go stale — used both by the Three.js sync effect and the sidebar UI, kept
// as a pure module-level function so both can call it regardless of declaration order.
function getEffectiveInstance(inst, reference) {
  if (!inst.linked || inst.id === reference.id) return inst;
  const eff = { ...inst };
  Object.keys(inst.linked).forEach((key) => {
    if (inst.linked[key]) eff[key] = reference[key];
  });
  return eff;
}

function fitShadowToBox(t) {
  if (!t.key || !t.allBoxesGroup) return;
  const box = t.fullBox || new THREE.Box3().setFromObject(t.allBoxesGroup);
  const size = new THREE.Vector3();
  box.getSize(size);
  const radius = Math.max(0.3, Math.max(size.x, size.y, size.z) * 0.5 * Math.SQRT2 + 0.15);
  t.shadowRadius = radius;

  t.key.target.position.copy(t.center);
  t.key.target.updateMatrixWorld();

  const dist = Math.max(0.5, t.key.position.distanceTo(t.center));
  const cam = t.key.shadow.camera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.near = Math.max(0.05, dist - radius * 2);
  cam.far = dist + radius * 2;
  cam.updateProjectionMatrix();
}

function drawNetGuide(canvas, layoutLocal, img, transform, lineColor) {
  const guideStroke = lineColor || "#5fd3d9";
  // real-world print resolution: 300ppi = 300px / 25.4mm
  const TARGET_PX_PER_MM = 300 / 25.4;
  const MAX_DIM = 16000; // safety cap so only extreme box sizes fall back from true 300ppi (browser canvas limits)
  const naturalW = layoutLocal.totalW * TARGET_PX_PER_MM;
  const naturalH = layoutLocal.totalH * TARGET_PX_PER_MM;
  const clamp = Math.min(1, MAX_DIM / Math.max(naturalW, naturalH));
  const pxPerMm = TARGET_PX_PER_MM * clamp;
  const s = pxPerMm / 2.4; // scale visual guide elements (line widths, fonts) relative to original tuning

  canvas.width = Math.round(layoutLocal.totalW * pxPerMm);
  canvas.height = Math.round(layoutLocal.totalH * pxPerMm);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#12203a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (img) {
    // draw the source artwork underneath the grid, honoring the same crop transform
    // used when slicing textures, so numeric trim adjustments are previewable here
    const { cropLeft, cropRight, cropTop, cropBottom } = cropFractions(transform);
    const usableW = imgW(img) * Math.max(0.01, 1 - cropLeft - cropRight);
    const usableH = imgH(img) * Math.max(0.01, 1 - cropTop - cropBottom);
    const originX = imgW(img) * cropLeft;
    const originY = imgH(img) * cropTop;
    const drawScaleX = pxPerMm / (usableW / layoutLocal.totalW);
    const drawScaleY = pxPerMm / (usableH / layoutLocal.totalH);
    ctx.drawImage(
      img,
      -originX * drawScaleX,
      -originY * drawScaleY,
      imgW(img) * drawScaleX,
      imgH(img) * drawScaleY
    );
  }

  layoutLocal.regions.forEach((r) => {
    const x = r.x * pxPerMm;
    const y = r.y * pxPerMm;
    const w = r.w * pxPerMm;
    const h = r.h * pxPerMm;
    ctx.strokeStyle = guideStroke;
    ctx.setLineDash([6 * s, 4 * s]);
    ctx.lineWidth = 1.5 * s;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = hexToRgba(guideStroke, 0.06);
    ctx.fillRect(x, y, w, h);

    // orientation arrow (points to "up" of artwork)
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.strokeStyle = "#ffb454";
    ctx.fillStyle = "#ffb454";
    ctx.lineWidth = 1 * s;
    ctx.beginPath();
    ctx.moveTo(cx, cy + 10 * s);
    ctx.lineTo(cx, cy - 10 * s);
    ctx.lineTo(cx - 5 * s, cy - 4 * s);
    ctx.moveTo(cx, cy - 10 * s);
    ctx.lineTo(cx + 5 * s, cy - 4 * s);
    ctx.stroke();

    ctx.fillStyle = "#eef6f6";
    ctx.font = `${11 * s}px Inter, sans-serif`;
    ctx.textAlign = "center";
    const label = FACE_LABELS[r.key] || r.key;
    ctx.fillText(label, cx, y + 14 * s);
    ctx.font = `${9 * s}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = "#9fb3c8";
    ctx.fillText(`${Math.round(r.w)}×${Math.round(r.h)}mm`, cx, y + h - 6 * s);
  });

  ctx.strokeStyle = "#3a5a78";
  ctx.lineWidth = 1 * s;
  ctx.strokeRect(0.5 * s, 0.5 * s, canvas.width - 1 * s, canvas.height - 1 * s);
}

export default function PackageBoxMockup() {
  const [bodyW, setBodyW] = useState(150);
  const [bodyD, setBodyD] = useState(150);
  const [bodyH, setBodyH] = useState(45);
  const [lidH, setLidH] = useState(20);
  const [clearance, setClearance] = useState(2);

  const DEFAULT_CROP = { cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0, rotate: 0 };
  const [bodyImg, setBodyImg] = useState(null);
  const [bodyFileName, setBodyFileName] = useState("");
  const [bodyTransform, setBodyTransform] = useState(DEFAULT_CROP);
  const [lidImg, setLidImg] = useState(null);
  const [lidFileName, setLidFileName] = useState("");
  const [lidTransform, setLidTransform] = useState(DEFAULT_CROP);
  const [lidInnerImg, setLidInnerImg] = useState(null);
  const [lidInnerFileName, setLidInnerFileName] = useState("");
  const [lidInnerTransform, setLidInnerTransform] = useState(DEFAULT_CROP);
  const [cropEditor, setCropEditor] = useState(null);
  const [guideColor, setGuideColor] = useState("#5fd3d9");
  const [colorCorrection, setColorCorrection] = useState({ saturation: 100, contrast: 100, brightness: 100 });
  const [autoRotate, setAutoRotate] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bgMode, setBgMode] = useState("white");
  const [bgImage, setBgImage] = useState(null);
  const [bevelRadius, setBevelRadius] = useState(2);
  const [fov, setFov] = useState(35);
  const [transparentExport, setTransparentExport] = useState(false);
  const [exportLongEdge, setExportLongEdge] = useState(3000);
  const [lightAzimuth, setLightAzimuth] = useState(49);
  const [lightElevation, setLightElevation] = useState(46);
  const [groundVisible, setGroundVisible] = useState(true);
  const [exposure, setExposure] = useState(0.95);
  const [ambientBoost, setAmbientBoost] = useState(1);
  const [toneMappingMode, setToneMappingMode] = useState("flat");
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [bottomBarHeight, setBottomBarHeight] = useState(300);

  // the 3D render is a fixed-size "artboard" floating inside the viewport (pasteboard),
  // After Effects-preview-style: its own size, zoom, and pan position, independent of
  // however big the surrounding panel happens to be.
  const [artboardW, setArtboardW] = useState(1200);
  const [artboardH, setArtboardH] = useState(800);
  const [artboardZoom, setArtboardZoom] = useState(1);
  const [artboardPos, setArtboardPos] = useState({ x: 0, y: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);

  // arrangement of box copies in the scene — box design (dims/artwork) is shared and
  // global above; only placement is per-instance.
  // `linked` marks which of this instance's own fields should instead follow box1
  // (the first box, treated as the reference) — resolved at read-time via
  // getEffectiveInstance, never copied, so toggling a link can't go stale.
  const DEFAULT_INSTANCE = {
    x: 0,
    z: 0,
    rotY: 0,
    tiltX: 0,
    tiltZ: 0,
    orientation: "standing",
    lidOpen: 0,
    floatHeight: 0,
    layer: 0,
    groundSnap: true,
    linked: {},
  };
  const [boxInstances, setBoxInstances] = useState([{ id: 1, ...DEFAULT_INSTANCE }]);
  const [selectedBoxId, setSelectedBoxId] = useState(1);
  const nextBoxIdRef = useRef(2);

  // ---- symbol library: shared image+crop+color assets, referenced by card (and
  // later piece) instances instead of uploading a separate image per instance ----
  const [symbols, setSymbols] = useState([]);
  const nextSymbolIdRef = useRef(1);
  const nextSymbolNumRef = useRef(1);

  // ---- cards: design is global (shared shape/size), placement is per-instance —
  // same split as the box above. Cards start empty (opt-in feature, unlike the box
  // which always has one instance since it's the app's core object). ----
  const [cardW, setCardW] = useState(63);
  const [cardD, setCardD] = useState(88);
  const [cardThickness, setCardThickness] = useState(1.5);
  const [cardCornerRadius, setCardCornerRadius] = useState(3);
  const DEFAULT_CARD_INSTANCE = {
    x: 0,
    z: 0,
    rotY: 0,
    tiltX: 0,
    tiltZ: 0,
    orientation: "lying",
    symbolId: null,
    floatHeight: 0,
    layer: 0,
    groundSnap: true,
  };
  const [cardInstances, setCardInstances] = useState([]);
  const [selectedCardId, setSelectedCardId] = useState(null);
  const nextCardIdRef = useRef(1);

  // ---- pieces (駒): unlike the box/card (one shared design for every copy), a scene
  // typically has several DIFFERENT piece types (pawn vs king, say) — so shape is its
  // own small reusable library (mirroring the symbol library's "define once, reference
  // from instances" pattern) instead of one global piece design. Each piece instance
  // then picks both a shape def (geometry) and a symbol (top-face image + body color). ----
  const DEFAULT_PIECE_SHAPE_DEF = { kind: "circle", w: 25, d: 25, thickness: 8, cornerFrac: 0.18 };
  const [pieceShapeDefs, setPieceShapeDefs] = useState([]);
  const nextPieceShapeIdRef = useRef(1);
  const nextPieceShapeNumRef = useRef(1);
  const DEFAULT_PIECE_INSTANCE = {
    x: 0,
    z: 0,
    rotY: 0,
    tiltX: 0,
    tiltZ: 0,
    shapeDefId: null,
    symbolId: null,
    floatHeight: 0,
    layer: 1,
    groundSnap: true,
  };
  const [pieceInstances, setPieceInstances] = useState([]);
  const [selectedPieceId, setSelectedPieceId] = useState(null);
  const nextPieceIdRef = useRef(1);

  // unifies the three independent per-kind selections above into one "what is the
  // viewport ring / click-to-pick currently pointing at" concept — kept ADDITIVE
  // (each panel still tracks its own selectedXId, e.g. so the box panel remembers
  // which box you were last editing even while a card is the active viewport
  // selection) rather than replacing them, to avoid a much larger refactor of the
  // box's existing linked-field system.
  const [activeSelection, setActiveSelection] = useState({ kind: "box", id: 1 });
  const selectObject = (kind, id) => {
    setActiveSelection({ kind, id });
    if (kind === "box") setSelectedBoxId(id);
    else if (kind === "card") setSelectedCardId(id);
    else if (kind === "piece") setSelectedPieceId(id);
  };

  const mountRef = useRef(null);
  const viewportRef = useRef(null);
  const artboardRef = useRef(null);
  const bodyGuideCanvasRef = useRef(null);
  const lidGuideCanvasRef = useRef(null);
  const lidInnerGuideCanvasRef = useRef(null);
  const boxInstancesRef = useRef(boxInstances);
  const cardInstancesRef = useRef(cardInstances);
  const pieceInstancesRef = useRef(pieceInstances);
  const autoRotateRef = useRef(false);
  const sidebarDragRef = useRef(null);
  const bottomBarDragRef = useRef(null);
  const spacePressedRef = useRef(false);
  const artboardPanRef = useRef(null);
  const artboardFittedRef = useRef(false);

  const three = useRef({
    scene: null,
    camera: null,
    renderer: null,
    ground: null,
    raf: null,
    azimuth: Math.PI * 0.28,
    elevation: 0.42,
    radius: 4.6,
    dragging: false,
    panning: false,
    lastX: 0,
    lastY: 0,
    center: new THREE.Vector3(0, 0.3, 0),
    pan: new THREE.Vector3(0, 0, 0),
    lidClosedY: 0,
    lidLift: 1,
  });

  useEffect(() => {
    boxInstancesRef.current = boxInstances;
  }, [boxInstances]);
  useEffect(() => {
    cardInstancesRef.current = cardInstances;
  }, [cardInstances]);
  useEffect(() => {
    pieceInstancesRef.current = pieceInstances;
  }, [pieceInstances]);
  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  // load fonts
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,650&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  const plainMat = useCallback(
    (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.92, metalness: 0 }),
    []
  );

  const makeFaceMaterial = useCallback(() => {
    return new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.82, metalness: 0 });
  }, []);

  // ---- init three.js once ----
  useEffect(() => {
    const container = mountRef.current;
    const t = three.current;

    const scene = new THREE.Scene();
    const bg = document.createElement("canvas");
    bg.width = 8;
    bg.height = 8;
    const bgCtx = bg.getContext("2d");
    const grad = bgCtx.createLinearGradient(0, 0, 0, 8);
    grad.addColorStop(0, "#1c1a17");
    grad.addColorStop(1, "#0c0b0a");
    bgCtx.fillStyle = grad;
    bgCtx.fillRect(0, 0, 8, 8);
    scene.background = new THREE.CanvasTexture(bg);
    t.darkBgTexture = scene.background;

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);
    t.ambient = ambient;

    const key = new THREE.DirectionalLight(0xfff3e0, 1.35);
    key.position.set(3, 4.2, 2.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    scene.add(key.target);
    t.key = key;

    const fill = new THREE.DirectionalLight(0xdce8ff, 0.45);
    fill.position.set(-3, 1.6, -2);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.5);
    rim.position.set(-1.5, 2.5, -3.5);
    scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: 0x1a1917, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // ring on the floor under whichever box is selected in the sidebar — with several
    // boxes in a scene there's otherwise no way to tell which one the controls apply to
    const selectionMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0x5fd3d9, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    selectionMarker.rotation.x = -Math.PI / 2;
    selectionMarker.renderOrder = 1;
    selectionMarker.visible = false;
    scene.add(selectionMarker);
    t.selectionMarker = selectionMarker;

    const bodyGeo = new RoundedBoxGeometry(1.5, 0.45, 1.5, ROUND_SEGMENTS, 0.02);
    const lidGeo = new RoundedBoxGeometry(1.54, 0.2, 1.54, ROUND_SEGMENTS, 0.02);
    const bodyMats = [makeFaceMaterial(), makeFaceMaterial(), plainMat(0xcbb98f), makeFaceMaterial(), makeFaceMaterial(), makeFaceMaterial()];
    const lidMats = [makeFaceMaterial(), makeFaceMaterial(), makeFaceMaterial(), plainMat(0xe8ddc4), makeFaceMaterial(), makeFaceMaterial()];

    // every box instance (copy placed in the scene) shares this SAME geometry/material
    // set — resizing or re-texturing updates every copy at once; only each instance's
    // own Group transform (position/rotation) is independent. instances is keyed by
    // the numeric id from the boxInstances React state array.
    const allBoxesGroup = new THREE.Group();
    scene.add(allBoxesGroup);
    const instances = {};
    const syncInstances = (ids) => {
      const idSet = new Set(ids);
      Object.keys(instances).forEach((key) => {
        if (idSet.has(Number(key))) return;
        allBoxesGroup.remove(instances[key].boxGroup);
        delete instances[key];
      });
      ids.forEach((id) => {
        if (instances[id]) return;
        const body = new THREE.Mesh(t.bodyGeo, t.bodyMats);
        body.castShadow = true;
        body.receiveShadow = true;
        body.userData = { kind: "box", instanceId: id };
        const lid = new THREE.Mesh(t.lidGeo, t.lidMats);
        lid.castShadow = true;
        lid.receiveShadow = true;
        lid.userData = { kind: "box", instanceId: id };
        const boxGroup = new THREE.Group();
        boxGroup.add(body, lid);
        allBoxesGroup.add(boxGroup);
        instances[id] = { boxGroup, body, lid };
      });
    };
    t.syncInstances = syncInstances;

    // cards: unlike the box (one shared material set for every copy, since the box
    // design is uniform), each card instance can show a DIFFERENT symbol — so geometry
    // is shared but every card instance gets its OWN material set, rebuilt whenever its
    // symbol assignment changes (see the card texture effect below).
    const allCardsGroup = new THREE.Group();
    scene.add(allCardsGroup);
    const cardGeo = new RoundedBoxGeometry(0.63, 0.015, 0.88, ROUND_SEGMENTS, 0.03);
    const cardInstancesTHREE = {};
    const syncCardInstances = (ids) => {
      const idSet = new Set(ids);
      Object.keys(cardInstancesTHREE).forEach((key) => {
        if (idSet.has(Number(key))) return;
        const rec = cardInstancesTHREE[key];
        rec.mats.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
        allCardsGroup.remove(rec.group);
        delete cardInstancesTHREE[key];
      });
      ids.forEach((id) => {
        if (cardInstancesTHREE[id]) return;
        const mats = Array.from({ length: 6 }, () => makeFaceMaterial());
        const mesh = new THREE.Mesh(t.cardGeo, mats);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { kind: "card", instanceId: id };
        const group = new THREE.Group();
        group.add(mesh);
        allCardsGroup.add(group);
        cardInstancesTHREE[id] = { group, mesh, mats };
      });
    };
    t.syncCardInstances = syncCardInstances;

    // pieces: geometry is shared PER SHAPE DEF (not one single shared geometry like the
    // box, since different piece instances can reference different shape defs), and
    // materials are per-instance like cards (3 slots: bottom/top/side — see
    // splitCapGroups in shapes2d.js for why extruded geometry needs a custom 3-way
    // split instead of BoxGeometry's built-in 6 face groups).
    const allPiecesGroup = new THREE.Group();
    scene.add(allPiecesGroup);
    const pieceShapeGeos = {};
    const pieceInstancesTHREE = {};
    const syncPieceInstances = (pieces) => {
      const idSet = new Set(pieces.map((p) => p.id));
      Object.keys(pieceInstancesTHREE).forEach((key) => {
        if (idSet.has(Number(key))) return;
        const rec = pieceInstancesTHREE[key];
        rec.mats.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
        allPiecesGroup.remove(rec.group);
        delete pieceInstancesTHREE[key];
      });
      pieces.forEach(({ id, shapeDefId }) => {
        if (pieceInstancesTHREE[id]) {
          pieceInstancesTHREE[id].mesh.geometry = pieceShapeGeos[shapeDefId] || pieceInstancesTHREE[id].mesh.geometry;
          return;
        }
        const mats = Array.from({ length: 3 }, () => makeFaceMaterial());
        const geo = pieceShapeGeos[shapeDefId];
        const mesh = new THREE.Mesh(geo, mats);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { kind: "piece", instanceId: id };
        const group = new THREE.Group();
        group.add(mesh);
        allPiecesGroup.add(group);
        pieceInstancesTHREE[id] = { group, mesh, mats };
      });
    };
    t.syncPieceInstances = syncPieceInstances;

    t.scene = scene;
    t.camera = camera;
    t.renderer = renderer;
    t.bodyGeo = bodyGeo;
    t.lidGeo = lidGeo;
    t.bodyMats = bodyMats;
    t.lidMats = lidMats;
    t.allBoxesGroup = allBoxesGroup;
    t.instances = instances;
    t.ground = ground;
    t.allCardsGroup = allCardsGroup;
    t.cardGeo = cardGeo;
    t.cardInstancesTHREE = cardInstancesTHREE;
    t.allPiecesGroup = allPiecesGroup;
    t.pieceShapeGeos = pieceShapeGeos;
    t.pieceInstancesTHREE = pieceInstancesTHREE;

    // recomputes the orbit center, shadow frustum, and (if needed) nudges the orbit
    // radius out so everything still fits — single source of truth called both from
    // the placement effect (on normal state changes) and directly from onPointerUp
    // right when an object-drag ends (see t.objectDrag below). Deliberately NEVER
    // called WHILE a drag is in progress: recentering the camera mid-drag would move
    // the same camera the drag's own ground-plane raycast reads from, so the object
    // would appear to leap by more than the mouse actually moved — worse, since the
    // leap itself grows the bounding box, that's a runaway feedback loop, not just a
    // one-time jump.
    t.recomputeFraming = () => {
      const fullBox = new THREE.Box3().setFromObject(allBoxesGroup);
      if (allCardsGroup.children.length) fullBox.union(new THREE.Box3().setFromObject(allCardsGroup));
      if (allPiecesGroup.children.length) fullBox.union(new THREE.Box3().setFromObject(allPiecesGroup));
      t.center.set((fullBox.min.x + fullBox.max.x) / 2, (fullBox.min.y + fullBox.max.y) / 2, (fullBox.min.z + fullBox.max.z) / 2);
      t.fullBox = fullBox;
      fitShadowToBox(t);
      if (t.shadowRadius && t.camera) {
        const halfV = (t.camera.fov * Math.PI) / 360;
        const halfH = Math.atan(Math.tan(halfV) * t.camera.aspect);
        const neededDist = (t.shadowRadius / Math.min(Math.sin(halfV), Math.sin(halfH))) * 1.05;
        if (neededDist > (t.neededCameraDist || 0)) t.radius = Math.max(t.radius, neededDist);
        t.neededCameraDist = neededDist;
      }
    };

    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    // picks across ALL object kinds (box/card/piece) — each kind's mesh already carries
    // userData.kind + userData.instanceId (set where each mesh is created above), so
    // this only needs one combined raycast instead of one per kind.
    const pickInstanceAt = (clientX, clientY) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const targets = [...allBoxesGroup.children, ...allCardsGroup.children, ...allPiecesGroup.children];
      const hits = raycaster.intersectObjects(targets, true);
      const hit = hits.find((h) => h.object.userData.instanceId != null);
      return hit ? { kind: hit.object.userData.kind, id: hit.object.userData.instanceId } : null;
    };

    // ground-plane (world Y=0) intersection under the cursor — used to translate a
    // dragged object's X/Z regardless of the object's own current height, since
    // footprint position doesn't depend on Y (same reasoning as the stacking resolver).
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const dragPoint = new THREE.Vector3();
    const groundPointAt = (clientX, clientY) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      return raycaster.ray.intersectPlane(dragPlane, dragPoint);
    };

    const instancesRefByKind = { box: boxInstancesRef, card: cardInstancesRef, piece: pieceInstancesRef };
    const setInstancesByKind = { box: setBoxInstances, card: setCardInstances, piece: setPieceInstances };

    const onPointerDown = (e) => {
      if (spacePressedRef.current) return; // space+drag pans the artboard instead — see the viewport-level handler
      t.canvasPointerActive = true;
      t.downX = e.clientX;
      t.downY = e.clientY;
      if (e.button === 1) {
        t.panning = true;
        e.preventDefault();
      } else if (e.button === 0) {
        const hit = pickInstanceAt(e.clientX, e.clientY);
        if (hit) {
          // select immediately on mousedown (standard editor behavior: mousedown
          // selects, a subsequent drag moves the now-selected object) — this is what
          // lets a single press-drag gesture both pick AND move an unselected object.
          selectObject(hit.kind, hit.id);
          const current = instancesRefByKind[hit.kind].current.find((o) => o.id === hit.id);
          const startGround = groundPointAt(e.clientX, e.clientY);
          if (current && startGround) {
            t.objectDrag = {
              kind: hit.kind,
              id: hit.id,
              startX: current.x,
              startZ: current.z,
              startGroundX: startGround.x,
              startGroundZ: startGround.z,
              moved: false,
            };
          }
        } else {
          t.dragging = true;
        }
      }
      t.lastX = e.clientX;
      t.lastY = e.clientY;
    };
    const onPointerMove = (e) => {
      const dx = e.clientX - t.lastX;
      const dy = e.clientY - t.lastY;
      t.lastX = e.clientX;
      t.lastY = e.clientY;

      if (t.panning) {
        const h = renderer.domElement.clientHeight || 1;
        const fovRad = (camera.fov * Math.PI) / 180;
        const worldPerPixel = (2 * Math.tan(fovRad / 2) * t.radius) / h;
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        t.pan.addScaledVector(right, -dx * worldPerPixel);
        t.pan.addScaledVector(up, dy * worldPerPixel);
        return;
      }

      if (t.objectDrag) {
        const ground = groundPointAt(e.clientX, e.clientY);
        if (!ground) return;
        const d = t.objectDrag;
        const worldDX = ground.x - d.startGroundX;
        const worldDZ = ground.z - d.startGroundZ;
        if (!d.moved && Math.hypot(worldDX, worldDZ) * (1 / SCALE) > 1) d.moved = true;
        if (!d.moved) return;
        const nextX = d.startX + worldDX / SCALE;
        const nextZ = d.startZ + worldDZ / SCALE;
        setInstancesByKind[d.kind]((prev) => prev.map((o) => (o.id === d.id ? { ...o, x: nextX, z: nextZ } : o)));
        return;
      }

      if (!t.dragging) return;
      t.azimuth -= dx * 0.007;
      t.elevation = Math.min(1.5, Math.max(-1.5, t.elevation + dy * 0.006));
    };
    const onPointerUp = () => {
      t.canvasPointerActive = false;
      t.dragging = false;
      t.panning = false;
      if (t.objectDrag) {
        t.objectDrag = null;
        t.recomputeFraming?.();
      }
    };
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) return; // ctrl/cmd+wheel zooms the artboard instead — see the viewport-level handler
      e.preventDefault();
      t.radius = Math.min(40, Math.max(0.4, t.radius * (1 + e.deltaY * 0.001)));
    };
    const onContextMenu = (e) => {
      if (t.panning) e.preventDefault();
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    // Ctrl/Cmd+wheel zooms the artboard, anywhere in the viewport (not just the box).
    // Bound as a plain, non-passive DOM listener rather than a React onWheel prop —
    // React attaches wheel listeners as passive by default, which silently makes
    // preventDefault() a no-op and lets the browser's own page-zoom fire instead.
    const onArtboardWheelZoom = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setArtboardZoom((z) => Math.min(4, Math.max(0.1, z * (1 - e.deltaY * 0.001))));
    };
    const viewportEl = viewportRef.current;
    viewportEl?.addEventListener("wheel", onArtboardWheelZoom, { passive: false });

    // the artboard is a fixed-size render target — sizing now comes from the
    // artboardW/H state (see the effect below), not from however big the
    // surrounding panel happens to be.
    const setArtboardRenderSize = (w, h) => {
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      fitBackgroundTexture(t, container);
    };
    t.setArtboardRenderSize = setArtboardRenderSize;

    // one-time: default the artboard to roughly fill whatever space is available on
    // first load, so the initial view still looks like "the box fills the panel".
    // The sidebar can take a couple of layout passes to settle (more so with more
    // content in it), so rather than trust a single deferred read, keep re-fitting on
    // every viewport resize for a short window after mount and then lock it in —
    // this "chases" the layout to whatever its final settled size turns out to be.
    const fitInitialArtboard = () => {
      if (!viewportRef.current) return;
      const vw = viewportRef.current.clientWidth;
      const vh = viewportRef.current.clientHeight;
      if (vw < 50 || vh < 50) return;
      setArtboardW(Math.max(200, vw - 64));
      setArtboardH(Math.max(150, vh - 64));
    };
    fitInitialArtboard();
    const initialFitRo = new ResizeObserver(() => {
      if (!artboardFittedRef.current) fitInitialArtboard();
    });
    if (viewportRef.current) initialFitRo.observe(viewportRef.current);
    const initialFitTimer = setTimeout(() => {
      artboardFittedRef.current = true;
      initialFitRo.disconnect();
    }, 400);

    let raf;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (autoRotateRef.current && !t.dragging) t.azimuth += 0.0026;

      const px = t.center.x + t.pan.x;
      const py = t.center.y + t.pan.y;
      const pz = t.center.z + t.pan.z;
      const x = px + t.radius * Math.sin(t.azimuth) * Math.cos(t.elevation);
      const y = py + t.radius * Math.sin(t.elevation) + 0.3;
      const z = pz + t.radius * Math.cos(t.azimuth) * Math.cos(t.elevation);
      camera.position.set(x, y, z);
      camera.lookAt(px, py, pz);

      const currentInstances = boxInstancesRef.current;
      const reference = currentInstances[0];
      Object.keys(instances).forEach((key) => {
        const inst = instances[key];
        const data = currentInstances.find((b) => b.id === Number(key));
        const effective = data && reference ? getEffectiveInstance(data, reference) : data;
        const openT = (effective?.lidOpen ?? 0) / 100;
        inst.lid.position.y = t.lidClosedY + openT * t.lidLift;
      });

      renderer.render(scene, camera);
    };
    animate();
    t.raf = raf;

    return () => {
      cancelAnimationFrame(t.raf);
      clearTimeout(initialFitTimer);
      initialFitRo.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      viewportEl?.removeEventListener("wheel", onArtboardWheelZoom);
      container.removeChild(renderer.domElement);
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the renderer's actual backing resolution + camera aspect track the artboard's own
  // size — NOT the surrounding panel — so zooming/panning the artboard on screen never
  // needs a re-render at a different resolution, same as Photoshop/AE canvas zoom.
  useEffect(() => {
    three.current.setArtboardRenderSize?.(artboardW, artboardH);
  }, [artboardW, artboardH]);

  // track the spacebar (After-Effects-style temporary "hand tool") so the viewport can
  // tell a pan-the-artboard drag apart from the 3D orbit drag, which stays on plain drag
  useEffect(() => {
    const isEditable = (el) => el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    const onKeyDown = (e) => {
      if (e.code !== "Space" || isEditable(document.activeElement)) return;
      spacePressedRef.current = true;
      setSpaceHeld(true);
      e.preventDefault();
    };
    const onKeyUp = (e) => {
      if (e.code !== "Space") return;
      spacePressedRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // ---- rebuild the shared body/lid geometry when dims/bevel change, and reassign it
  // to every existing box instance (cheap — geometry is shared, not duplicated) ----
  useEffect(() => {
    const t = three.current;
    if (!t.bodyGeo || !t.lidGeo) return;

    const bw = bodyW * SCALE;
    const bd = bodyD * SCALE;
    const bh = bodyH * SCALE;
    const lw = (bodyW + clearance * 2) * SCALE;
    const ld = (bodyD + clearance * 2) * SCALE;
    const lh = lidH * SCALE;
    const roundR = bevelRadius * SCALE;

    t.bodyGeo.dispose();
    t.lidGeo.dispose();
    t.bodyGeo = new RoundedBoxGeometry(bw, bh, bd, ROUND_SEGMENTS, roundR);
    t.lidGeo = new RoundedBoxGeometry(lw, lh, ld, ROUND_SEGMENTS, roundR);
    t.lidClosedY = bh - lh / 2;
    t.lidLift = bh * 1.4 + lh;

    Object.values(t.instances).forEach((inst) => {
      inst.body.geometry = t.bodyGeo;
      inst.lid.geometry = t.lidGeo;
      inst.body.position.set(0, bh / 2, 0);
      inst.lid.position.set(0, t.lidClosedY, 0);
    });
  }, [bodyW, bodyD, bodyH, lidH, clearance, bevelRadius]);

  // ---- rebuild the shared card geometry when dims/corner radius change ----
  useEffect(() => {
    const t = three.current;
    if (!t.cardGeo) return;
    t.cardGeo.dispose();
    t.cardGeo = new RoundedBoxGeometry(cardW * SCALE, cardThickness * SCALE, cardD * SCALE, ROUND_SEGMENTS, cardCornerRadius * SCALE);
    Object.values(t.cardInstancesTHREE || {}).forEach((rec) => {
      rec.mesh.geometry = t.cardGeo;
    });
  }, [cardW, cardD, cardThickness, cardCornerRadius]);

  // ---- rebuild each piece SHAPE DEF's own geometry when its kind/dims/corner fraction
  // change. Reassigning that geometry to whichever piece instances currently reference
  // it happens in the combined placement effect below (it reads t.pieceShapeGeos fresh
  // every pass), not here — this effect only owns the geometry cache itself. ----
  useEffect(() => {
    const t = three.current;
    if (!t.pieceShapeGeos) return;
    const liveIds = new Set(pieceShapeDefs.map((d) => d.id));
    Object.keys(t.pieceShapeGeos).forEach((key) => {
      if (liveIds.has(Number(key))) return;
      t.pieceShapeGeos[key].dispose();
      delete t.pieceShapeGeos[key];
    });
    pieceShapeDefs.forEach((def) => {
      t.pieceShapeGeos[def.id]?.dispose();
      // custom SVG shapes are re-parsed from the stored source text each time (cheap
      // for icon-sized SVGs) rather than caching a parsed THREE.Shape in React state —
      // keeps the shape def itself a plain, inspectable object.
      let shape;
      if (def.kind === "svg" && def.svgText) {
        const parsed = parseSvgToUnitShapes(def.svgText);
        shape = parsed ? parsed.shapes : buildPresetShape("roundedSquare", def.cornerFrac);
      } else {
        shape = buildPresetShape(def.kind, def.cornerFrac);
      }
      t.pieceShapeGeos[def.id] = buildExtrudedPieceGeometry(shape, {
        widthUnits: def.w * SCALE,
        depthUnits: def.d * SCALE,
        thicknessUnits: def.thickness * SCALE,
      });
    });
  }, [pieceShapeDefs]);

  // ---- add/remove box/card/piece instances to match state, and place each one per its
  // own position/rotation/tilt/orientation/floatHeight/layer/groundSnap. Combined into
  // one effect (rather than one per object kind) because camera framing/shadow fitting
  // below needs a bounding box across every kind at once, AND the ground-snap/layering
  // resolver needs every kind's footprint together to know what rests on what.
  //
  // Two passes:
  //  1. Set quaternion + XZ position (Y left at 0) for every object of every kind, and
  //     record a `place(floorY)` closure per object — XZ footprint doesn't depend on Y,
  //     so it's safe to measure before Y is known.
  //  2. Hand every object to resolveStacking (stacking.js), which walks layers
  //     bottom-to-top and tells each grounded object what Y to rest on (0, or the top
  //     of whatever lower-layer object it overlaps) — then call place(floorY) to
  //     actually assign group.position.y. ----
  useEffect(() => {
    const t = three.current;
    if (!t.allBoxesGroup) return;

    t.syncInstances?.(boxInstances.map((b) => b.id));
    t.syncCardInstances?.(cardInstances.map((c) => c.id));
    // pieces only have a mesh worth positioning once their shape def actually exists
    // (a piece can be added before any shape def is defined, e.g. mid-edit) — those
    // without a resolvable geometry are just left unsynced until a shape def is assigned.
    const placeablePieces = pieceInstances.filter((p) => t.pieceShapeGeos[p.shapeDefId]);
    t.syncPieceInstances?.(placeablePieces);

    const reference = boxInstances[0];
    const stackItems = [];

    boxInstances.forEach((rawData) => {
      const inst = t.instances[rawData.id];
      if (!inst) return;
      const data = getEffectiveInstance(rawData, reference);
      // orientation: "lying" = cover faces up (default box pose), "standing" = cover
      // faces the camera. Composed as quaternions around FIXED WORLD axes (not a raw
      // Euler triple) so rotY always spins around true world-vertical no matter what
      // the standing/lying base pose or tiltX/tiltZ lean currently is — with a plain
      // Euler("XYZ") triple, standing's -90° X pre-rotation remaps which axis "Y" and
      // "Z" actually rotate around (Y ends up rolling on the depth axis, Z ends up
      // being the one that yaws around vertical), which is exactly backwards from
      // what the rotY control promises.
      const baseX = data.orientation === "standing" ? -Math.PI / 2 : 0;
      const qLean = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        baseX + (data.tiltX * Math.PI) / 180
      );
      const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (data.tiltZ * Math.PI) / 180);
      const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (data.rotY * Math.PI) / 180);
      inst.boxGroup.quaternion.copy(qYaw).multiply(qRoll).multiply(qLean);
      inst.boxGroup.position.set(data.x * SCALE, 0, data.z * SCALE);
      inst.boxGroup.updateMatrixWorld(true);

      const footprint = measureXZFootprint(inst.boxGroup);
      stackItems.push({
        id: `box:${rawData.id}`,
        layer: data.layer ?? 0,
        groundSnap: data.groundSnap !== false,
        ...footprint,
        // the box's own rest offset is measured from its BODY specifically (not the
        // whole group, which would include an opened lid) — an open lid shouldn't
        // change how low the box itself sits, same as before this stacking resolver
        // existed.
        place: (floorY) => {
          const y = data.groundSnap === false
            ? data.floatHeight * SCALE
            : groundSnapY(inst.boxGroup, data.floatHeight || 0, SCALE, { floorY, measureObj: inst.body });
          inst.boxGroup.position.y = y;
          inst.boxGroup.updateMatrixWorld(true);
          return { y, topY: new THREE.Box3().setFromObject(inst.boxGroup).max.y };
        },
      });
    });

    cardInstances.forEach((data) => {
      const rec = t.cardInstancesTHREE[data.id];
      if (!rec) return;
      rec.group.quaternion.copy(composePlacementQuaternion(data));
      rec.group.position.set(data.x * SCALE, 0, data.z * SCALE);
      rec.group.updateMatrixWorld(true);

      const footprint = measureXZFootprint(rec.group);
      stackItems.push({
        id: `card:${data.id}`,
        layer: data.layer ?? 0,
        groundSnap: data.groundSnap !== false,
        ...footprint,
        place: (floorY) => {
          const y = data.groundSnap === false
            ? data.floatHeight * SCALE
            : groundSnapY(rec.group, data.floatHeight || 0, SCALE, { floorY });
          rec.group.position.y = y;
          rec.group.updateMatrixWorld(true);
          return { y, topY: new THREE.Box3().setFromObject(rec.group).max.y };
        },
      });
    });

    placeablePieces.forEach((data) => {
      const rec = t.pieceInstancesTHREE[data.id];
      if (!rec) return;
      rec.mesh.geometry = t.pieceShapeGeos[data.shapeDefId];
      rec.group.quaternion.copy(composePlacementQuaternion({ ...data, orientation: "lying" }));
      rec.group.position.set(data.x * SCALE, 0, data.z * SCALE);
      rec.group.updateMatrixWorld(true);

      const footprint = measureXZFootprint(rec.group);
      stackItems.push({
        id: `piece:${data.id}`,
        layer: data.layer ?? 0,
        groundSnap: data.groundSnap !== false,
        ...footprint,
        place: (floorY) => {
          const y = data.groundSnap === false
            ? data.floatHeight * SCALE
            : groundSnapY(rec.group, data.floatHeight || 0, SCALE, { floorY });
          rec.group.position.y = y;
          rec.group.updateMatrixWorld(true);
          return { y, topY: new THREE.Box3().setFromObject(rec.group).max.y };
        },
      });
    });

    resolveStacking(stackItems);

    // skipped while a drag is live — see t.recomputeFraming's own comment for why
    // recentering the camera mid-drag would fight the drag itself.
    if (!t.objectDrag) t.recomputeFraming?.();

    // ring under whichever object is the active selection (any kind) — only shown once
    // there's more than one object total, since with just one it's obvious which one
    // the controls apply to.
    if (t.selectionMarker) {
      const totalObjects = boxInstances.length + cardInstances.length + placeablePieces.length;
      const selGroup =
        activeSelection?.kind === "box"
          ? t.instances[activeSelection.id]?.boxGroup
          : activeSelection?.kind === "card"
            ? t.cardInstancesTHREE[activeSelection.id]?.group
            : activeSelection?.kind === "piece"
              ? t.pieceInstancesTHREE[activeSelection.id]?.group
              : null;
      if (selGroup && totalObjects > 1) {
        const selBox = new THREE.Box3().setFromObject(selGroup);
        const selSize = new THREE.Vector3();
        selBox.getSize(selSize);
        const radius = Math.max(selSize.x, selSize.z) * 0.5 * Math.SQRT2 + 0.08;
        t.selectionMarker.scale.set(radius, radius, 1);
        t.selectionMarker.position.set((selBox.min.x + selBox.max.x) / 2, 0.002, (selBox.min.z + selBox.max.z) / 2);
        t.selectionMarker.visible = true;
      } else {
        t.selectionMarker.visible = false;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    boxInstances,
    bodyW,
    bodyD,
    bodyH,
    lidH,
    clearance,
    bevelRadius,
    activeSelection,
    cardInstances,
    cardW,
    cardD,
    cardThickness,
    cardCornerRadius,
    pieceInstances,
    pieceShapeDefs,
  ]);

  // ---- rebuild each card instance's OWN materials (front face = its symbol's image,
  // cover-fit via UV repeat/offset so it never distorts; the other 5 faces = the
  // symbol's tint color) whenever that instance's symbol assignment, the symbol
  // library's contents, or the card's face aspect ratio changes. Keyed off a derived
  // "which instance points at which symbol" string rather than the raw cardInstances
  // array so dragging a card's position doesn't re-bake every texture on every frame. ----
  const cardSymbolAssignmentKey = cardInstances.map((c) => `${c.id}:${c.symbolId ?? ""}`).join("|");
  useEffect(() => {
    const t = three.current;
    if (!t.cardInstancesTHREE) return;
    const faceAspect = cardW / cardD;
    cardInstances.forEach((inst) => {
      const rec = t.cardInstancesTHREE[inst.id];
      if (!rec) return;
      const symbol = symbols.find((s) => s.id === inst.symbolId) || null;
      const canvas = buildSymbolFaceCanvas(symbol);
      const tex = new THREE.CanvasTexture(canvas);
      tex.encoding = THREE.sRGBEncoding;
      const texAspect = symbol?.img ? symbolAspect(symbol) : 1;
      const { repeat, offset } = coverFitRepeatOffset(texAspect, faceAspect);
      tex.repeat.set(repeat[0], repeat[1]);
      tex.offset.set(offset[0], offset[1]);
      tex.needsUpdate = true;

      const bodyColor = new THREE.Color(symbol?.color || DEFAULT_SYMBOL_COLOR);
      rec.mats.forEach((m, i) => {
        if (m.map) m.map.dispose();
        if (i === 2) {
          // top face (index 2 in BoxGeometry's [right,left,top,bottom,front,back] order)
          // — faces up when lying flat, faces the camera once "standing" rotates the
          // whole card, same as the box's lid/top face convention.
          m.map = tex;
          m.color.set(0xffffff);
        } else {
          m.map = null;
          m.color.copy(bodyColor);
        }
        m.needsUpdate = true;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardSymbolAssignmentKey, symbols, cardW, cardD]);

  // ---- same idea as the card texture effect above, but for pieces: the symbol's image
  // goes on the TOP cap only (materialIndex 1 — see splitCapGroups in shapes2d.js), the
  // bottom cap + sides (materialIndex 0/2) get the symbol's plain tint color. Cover-fit
  // aspect comes from the piece's OWN shape def (W/D), not the card's. ----
  const pieceSymbolAssignmentKey = pieceInstances.map((p) => `${p.id}:${p.shapeDefId ?? ""}:${p.symbolId ?? ""}`).join("|");
  useEffect(() => {
    const t = three.current;
    if (!t.pieceInstancesTHREE) return;
    const shapeDefById = new Map(pieceShapeDefs.map((d) => [d.id, d]));
    pieceInstances.forEach((inst) => {
      const rec = t.pieceInstancesTHREE[inst.id];
      if (!rec) return;
      const def = shapeDefById.get(inst.shapeDefId);
      const faceAspect = def ? def.w / def.d : 1;
      const symbol = symbols.find((s) => s.id === inst.symbolId) || null;
      const canvas = buildSymbolFaceCanvas(symbol);
      const tex = new THREE.CanvasTexture(canvas);
      tex.encoding = THREE.sRGBEncoding;
      const texAspect = symbol?.img ? symbolAspect(symbol) : 1;
      const { repeat, offset } = coverFitRepeatOffset(texAspect, faceAspect);
      tex.repeat.set(repeat[0], repeat[1]);
      tex.offset.set(offset[0], offset[1]);
      tex.needsUpdate = true;

      const bodyColor = new THREE.Color(symbol?.color || DEFAULT_SYMBOL_COLOR);
      rec.mats.forEach((m, i) => {
        if (m.map) m.map.dispose();
        if (i === 1) {
          m.map = tex;
          m.color.set(0xffffff);
        } else {
          m.map = null;
          m.color.copy(bodyColor);
        }
        m.needsUpdate = true;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieceSymbolAssignmentKey, symbols, pieceShapeDefs]);

  // ---- ground visibility ----
  useEffect(() => {
    const t = three.current;
    if (!t.ground) return;
    t.ground.visible = groundVisible;
  }, [groundVisible]);

  // ---- camera perspective (field of view) ----
  useEffect(() => {
    const t = three.current;
    if (!t.camera) return;
    t.camera.fov = fov;
    t.camera.updateProjectionMatrix();
  }, [fov]);

  // ---- key light position (studio light angle) ----
  useEffect(() => {
    const t = three.current;
    if (!t.key) return;
    const az = (lightAzimuth * Math.PI) / 180;
    const el = (lightElevation * Math.PI) / 180;
    const dist = 5.8;
    t.key.position.set(
      dist * Math.sin(az) * Math.cos(el),
      dist * Math.sin(el),
      dist * Math.cos(az) * Math.cos(el)
    );
    fitShadowToBox(t);
  }, [lightAzimuth, lightElevation]);

  // ---- background mode (studio dark / white product-shot / custom image) ----
  useEffect(() => {
    const t = three.current;
    if (!t.scene || !t.ground) return;
    t.ground.material.dispose();
    if (t.bgImageTexture) {
      t.bgImageTexture.dispose();
      t.bgImageTexture = null;
    }
    const baseAmbient = bgMode === "dark" ? 0.4 : 0.65;
    if (bgMode === "image" && bgImage) {
      const tex = new THREE.Texture(bgImage);
      tex.encoding = THREE.sRGBEncoding;
      tex.needsUpdate = true;
      t.bgImageTexture = tex;
      t.bgImageAspect = imgW(bgImage) / imgH(bgImage);
      fitBackgroundTexture(t, mountRef.current);
      t.scene.background = tex;
      t.ground.material = new THREE.ShadowMaterial({ opacity: 0.22 });
    } else if (bgMode === "dark") {
      t.scene.background = t.darkBgTexture;
      t.ground.material = new THREE.MeshStandardMaterial({ color: 0x1a1917, roughness: 1 });
    } else {
      // "white", or "image" mode before an image has been provided
      t.scene.background = new THREE.Color(0xf6f5f2);
      t.ground.material = new THREE.ShadowMaterial({ opacity: 0.22 });
    }
    if (t.ambient) t.ambient.intensity = baseAmbient * ambientBoost;
  }, [bgMode, bgImage, ambientBoost]);

  // ---- exposure / tone mapping (color correction for printed textures) ----
  useEffect(() => {
    const t = three.current;
    if (!t.renderer) return;
    t.renderer.toneMappingExposure = exposure;
    t.renderer.toneMapping =
      toneMappingMode === "flat" ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  }, [exposure, toneMappingMode]);

  // ---- slice net images & update textures whenever inputs change ----
  useEffect(() => {
    const t = three.current;
    if (!t.bodyMats || !t.lidMats) return;

    const lidW = bodyW + clearance * 2;
    const lidD = bodyD + clearance * 2;
    const bodyLayout = netLayout(bodyW, bodyD, bodyH, "body");
    const lidLayout = netLayout(lidW, lidD, lidH, "lid");
    const lidInnerLayout = singleFaceLayout("lid-inner", lidW, lidD);

    // apply each image's whole-image rotate once, up front, so slicing just treats the
    // result as "the image". The guide preview intentionally uses a separate,
    // baseline-free version (user's own rotate only) so what's shown always matches
    // the file as uploaded — see rawSpaceLayout/orientedTransform above.
    const bodySrc = bodyImg ? orientedImage(bodyImg, bodyTransform, BODY_ORIENT) : null;
    const lidSrc = lidImg ? orientedImage(lidImg, lidTransform, LID_ORIENT) : null;
    const lidInnerSrc = lidInnerImg ? orientedImage(lidInnerImg, lidInnerTransform) : null;

    const bodyRawSrc = bodyImg ? orientedImage(bodyImg, bodyTransform) : null;
    const lidRawSrc = lidImg ? orientedImage(lidImg, lidTransform) : null;

    if (bodyGuideCanvasRef.current) {
      drawNetGuide(bodyGuideCanvasRef.current, rawSpaceLayout(bodyLayout, BODY_ORIENT), bodyRawSrc, bodyTransform, guideColor);
    }
    if (lidGuideCanvasRef.current) {
      drawNetGuide(lidGuideCanvasRef.current, rawSpaceLayout(lidLayout, LID_ORIENT), lidRawSrc, lidTransform, guideColor);
    }
    if (lidInnerGuideCanvasRef.current) {
      drawNetGuide(lidInnerGuideCanvasRef.current, lidInnerLayout, lidInnerSrc, lidInnerTransform, guideColor);
    }

    const idxOrder = ["right", "left", "top", "bottom", "front", "back"];
    const bodyMap = { right: "body-right", left: "body-left", top: null, bottom: "body-center", front: "body-front", back: "body-back" };
    const lidMap = { right: "lid-right", left: "lid-left", top: "lid-center", bottom: "lid-inner", front: "lid-front", back: "lid-back" };

    const disposeMat = (m) => {
      if (m.map) m.map.dispose();
    };

    const canvasByKey = {};

    const sliceLayout = (layout, img, transform) => {
      layout.regions.forEach((r) => {
        canvasByKey[r.key] = extractFaceCanvas(img, r, layout.totalW, layout.totalH, transform);
      });
    };

    if (bodySrc) sliceLayout(bodyLayout, bodySrc, orientedTransform(bodyTransform, BODY_ORIENT));
    if (lidSrc) sliceLayout(lidLayout, lidSrc, orientedTransform(lidTransform, LID_ORIENT));
    if (lidInnerSrc) sliceLayout(lidInnerLayout, lidInnerSrc, orientedTransform(lidInnerTransform));

    // apply each face's own baked-in rotate/flipH/flipV, then the user's color
    // correction, directly to its sliced canvas.
    Object.keys(canvasByKey).forEach((key) => {
      canvasByKey[key] = applyFaceTransform(canvasByKey[key], DEFAULT_FACE_TRANSFORMS[key]);
      canvasByKey[key] = applyColorCorrection(canvasByKey[key], colorCorrection);
    });

    idxOrder.forEach((face, i) => {
      const bKey = bodyMap[face];
      const bMat = t.bodyMats[i];
      disposeMat(bMat);
      if (bKey && canvasByKey[bKey]) {
        const tex = new THREE.CanvasTexture(canvasByKey[bKey]);
        tex.encoding = THREE.sRGBEncoding;
        tex.needsUpdate = true;
        bMat.map = tex;
        bMat.color.set(0xffffff);
      } else {
        bMat.map = null;
        bMat.color.set(face === "top" ? 0xcbb98f : 0xdccbaa);
      }
      bMat.needsUpdate = true;

      const lKey = lidMap[face];
      const lMat = t.lidMats[i];
      disposeMat(lMat);
      if (lKey && canvasByKey[lKey]) {
        const tex = new THREE.CanvasTexture(canvasByKey[lKey]);
        tex.encoding = THREE.sRGBEncoding;
        tex.needsUpdate = true;
        lMat.map = tex;
        lMat.color.set(0xffffff);
      } else {
        lMat.map = null;
        lMat.color.set(face === "bottom" ? 0xe8ddc4 : 0xead9b6);
      }
      lMat.needsUpdate = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bodyImg,
    bodyTransform,
    lidImg,
    lidTransform,
    lidInnerImg,
    lidInnerTransform,
    bodyW,
    bodyD,
    bodyH,
    lidH,
    clearance,
    colorCorrection,
  ]);

  const makeFileHandler = (setFileName, setImg) => (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => setImg(img);
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleBodyFile = makeFileHandler(setBodyFileName, setBodyImg);
  const handleLidFile = makeFileHandler(setLidFileName, setLidImg);
  const handleLidInnerFile = makeFileHandler(setLidInnerFileName, setLidInnerImg);

  const handleBodyPaste = makePasteHandler((img) => {
    setBodyImg(img);
    setBodyFileName("(クリップボードから貼り付け)");
  });
  const handleLidPaste = makePasteHandler((img) => {
    setLidImg(img);
    setLidFileName("(クリップボードから貼り付け)");
  });
  const handleLidInnerPaste = makePasteHandler((img) => {
    setLidInnerImg(img);
    setLidInnerFileName("(クリップボードから貼り付け)");
  });

  const handleBgImageFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        setBgImage(img);
        setBgMode("image");
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  const handleBgImagePaste = makePasteHandler((img) => {
    setBgImage(img);
    setBgMode("image");
  });

  const downloadGuideCanvas = (canvasRef, filename) => {
    if (!canvasRef.current) return;
    const a = document.createElement("a");
    a.href = canvasRef.current.toDataURL("image/png");
    a.download = filename;
    a.click();
  };

  const downloadBodyGuide = () => downloadGuideCanvas(bodyGuideCanvasRef, "package-body-net-guide.png");
  const downloadLidGuide = () => downloadGuideCanvas(lidGuideCanvasRef, "package-lid-net-guide.png");
  const downloadLidInnerGuide = () => downloadGuideCanvas(lidInnerGuideCanvasRef, "package-lid-inner-guide.png");

  const exportRender = () => {
    const t = three.current;
    if (!t.renderer) return;
    setExporting(true);
    requestAnimationFrame(() => {
      const container = mountRef.current;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const scaleFactor = exportLongEdge / Math.max(cw, ch);

      const prevBackground = t.scene.background;
      const prevClearColor = new THREE.Color();
      t.renderer.getClearColor(prevClearColor);
      const prevClearAlpha = t.renderer.getClearAlpha();
      const prevGroundVisible = t.ground.visible;

      if (transparentExport) {
        t.scene.background = null;
        t.ground.visible = false;
        t.renderer.setClearColor(0x000000, 0);
      }

      t.renderer.setSize(Math.round(cw * scaleFactor), Math.round(ch * scaleFactor), false);
      t.camera.aspect = cw / ch;
      t.camera.updateProjectionMatrix();
      t.renderer.render(t.scene, t.camera);

      // draw into a plain 2D canvas first — needed either way to read pixels back out
      // for the transparent-export trim, and just as valid a toDataURL source otherwise
      let outCanvas = document.createElement("canvas");
      outCanvas.width = t.renderer.domElement.width;
      outCanvas.height = t.renderer.domElement.height;
      outCanvas.getContext("2d").drawImage(t.renderer.domElement, 0, 0);
      if (transparentExport) outCanvas = trimTransparentCanvas(outCanvas);
      const url = outCanvas.toDataURL("image/png");
      t.renderer.setSize(cw, ch, false);

      if (transparentExport) {
        t.scene.background = prevBackground;
        t.ground.visible = prevGroundVisible;
        t.renderer.setClearColor(prevClearColor, prevClearAlpha);
      }

      const a = document.createElement("a");
      a.href = url;
      a.download = transparentExport ? "package-mockup-transparent.png" : "package-mockup.png";
      a.click();
      setExporting(false);
    });
  };

  const numField = (label, value, setValue, min = 1, max = 500, unit = "mm") => (
    <ScrubField label={label} value={value} onChange={setValue} min={min} max={max} unit={unit} />
  );

  const imageUploadPanel = (
    title,
    img,
    fileNameVal,
    onFile,
    onPaste,
    transform,
    setTransform,
    onDownloadGuide,
    onOpenEditor,
    guideCanvasRef
  ) => {
    const isDefault =
      transform.cropTop === 0 &&
      transform.cropBottom === 0 &&
      transform.cropLeft === 0 &&
      transform.cropRight === 0 &&
      (transform.rotate || 0) === 0;
    const rotateImage = () => setTransform((p) => ({ ...p, rotate: ((p.rotate || 0) + 90) % 360 }));
    return (
      <div
        className="flex-shrink-0 rounded-lg p-3 flex flex-col"
        style={{ width: "340px", background: "#242220", border: "1px solid #3a372f", height: "100%" }}
      >
        <div className="text-xs uppercase mb-2 flex-shrink-0" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
          {title}
        </div>
        <div className="flex gap-3 flex-1 min-h-0">
          <div className="flex flex-col gap-2" style={{ width: "110px", flexShrink: 0 }}>
            <canvas
              ref={guideCanvasRef}
              style={{
                width: "100%",
                height: "72px",
                objectFit: "contain",
                display: "block",
                background: "#12203a",
                borderRadius: "4px",
                flexShrink: 0,
              }}
            />
            <label
              className="block text-center text-xs rounded py-2 cursor-pointer"
              style={{ background: "#e2432a", color: "#1c1a17", fontWeight: 600 }}
            >
              アップロード
              <input type="file" accept="image/*" onChange={onFile} className="hidden" />
            </label>
            <button
              onClick={onPaste}
              className="w-full text-xs rounded py-2"
              style={{ background: "#3a372f", color: "#efe6d4" }}
            >
              貼り付け
            </button>
            {img && (
              <>
                <button
                  onClick={onOpenEditor}
                  className="w-full text-xs rounded py-2"
                  style={{ background: "#5fd3d9", color: "#12203a", fontWeight: 600 }}
                >
                  トリミング編集
                </button>
                <button
                  onClick={rotateImage}
                  className="w-full text-xs rounded py-2"
                  style={{ background: "#3a372f", color: "#efe6d4" }}
                >
                  ↻ 画像を90°回転{transform.rotate ? `(${transform.rotate}°)` : ""}
                </button>
              </>
            )}
          </div>

          <div className="flex flex-col gap-1 flex-1 min-w-0">
            {fileNameVal && (
              <p className="text-xs truncate" style={{ color: "#7d7568" }}>
                {fileNameVal}
              </p>
            )}
            {img ? (
              !isDefault && (
                <button
                  onClick={() => setTransform(DEFAULT_CROP)}
                  className="w-full text-xs rounded py-1"
                  style={{ background: "#3a372f", color: "#efe6d4" }}
                >
                  トリミングをリセット
                </button>
              )
            ) : (
              <p className="text-xs" style={{ color: "#7d7568" }}>
                画像をアップロードするとトリミングを調整できます。
              </p>
            )}
            <button
              onClick={onDownloadGuide}
              className="w-full mt-auto text-xs rounded py-2"
              style={{ background: "transparent", border: "1px solid #5fd3d9", color: "#5fd3d9" }}
            >
              ガイド画像をダウンロード
            </button>
          </div>
        </div>
      </div>
    );
  };

  const exportSettingsCard = (
    <div
      className="flex-shrink-0 rounded-lg p-3 flex flex-col"
      style={{ width: "260px", background: "#242220", border: "1px solid #5a4a2f", height: "100%" }}
    >
      <div className="text-xs uppercase mb-2 flex-shrink-0" style={{ color: "#c9a15a", letterSpacing: "0.08em" }}>
        書き出し設定
      </div>
      <label className="flex items-center gap-2 text-xs mb-3" style={{ color: "#a89f8f" }}>
        <input
          type="checkbox"
          checked={transparentExport}
          onChange={(e) => setTransparentExport(e.target.checked)}
        />
        背景を透過にして書き出す(箱だけにトリミング)
      </label>

      <div className="flex items-center justify-between text-sm mb-1">
        <span style={{ color: "#a89f8f" }}>解像度(長辺)</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={500}
            max={8000}
            step={100}
            value={exportLongEdge}
            onChange={(e) =>
              setExportLongEdge(Math.max(500, Math.min(8000, Number(e.target.value) || 0)))
            }
            className="text-xs rounded px-1 py-0.5 text-right"
            style={{ width: "60px", background: "#12203a", color: "#efe6d4", border: "1px solid #3a5a78" }}
          />
          <span style={{ fontSize: "11px", color: "#7d7568" }}>px</span>
        </div>
      </div>
      <div className="flex gap-1 mb-3">
        {[2000, 3000, 4000, 6000].map((px) => (
          <button
            key={px}
            onClick={() => setExportLongEdge(px)}
            className="flex-1 text-xs rounded py-1"
            style={{
              background: exportLongEdge === px ? "#e2432a" : "#3a372f",
              color: exportLongEdge === px ? "#1c1a17" : "#efe6d4",
              fontWeight: exportLongEdge === px ? 600 : 400,
            }}
          >
            {px}
          </button>
        ))}
      </div>

      <button
        onClick={exportRender}
        disabled={exporting}
        className="w-full mt-auto text-sm rounded py-2"
        style={{ background: "#efe6d4", color: "#1c1a17", fontWeight: 600 }}
      >
        {exporting ? "書き出し中…" : transparentExport ? "透過PNGを書き出す" : "高解像度PNGを書き出す"}
      </button>
    </div>
  );

  // resizable panel dividers: sidebar width (drag right edge) and bottom bar height
  // (drag top edge) — the 3D viewport is whatever's left, so resizing either one is
  // effectively "resize the preview".
  const onSidebarHandleDown = (e) => {
    sidebarDragRef.current = { startX: e.clientX, startWidth: sidebarWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onSidebarHandleMove = (e) => {
    if (!sidebarDragRef.current) return;
    const dx = e.clientX - sidebarDragRef.current.startX;
    setSidebarWidth(Math.max(240, Math.min(640, sidebarDragRef.current.startWidth + dx)));
  };
  const onSidebarHandleUp = () => {
    sidebarDragRef.current = null;
  };

  const onBottomBarHandleDown = (e) => {
    bottomBarDragRef.current = { startY: e.clientY, startHeight: bottomBarHeight };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onBottomBarHandleMove = (e) => {
    if (!bottomBarDragRef.current) return;
    const dy = e.clientY - bottomBarDragRef.current.startY;
    setBottomBarHeight(Math.max(160, Math.min(640, bottomBarDragRef.current.startHeight - dy)));
  };
  const onBottomBarHandleUp = () => {
    bottomBarDragRef.current = null;
  };

  // artboard navigation, After-Effects-preview-style: Space+drag anywhere pans the
  // artboard, and middle-click-drag pans it too but ONLY when it starts outside the
  // artboard itself — middle-click-drag ON the box keeps panning the 3D camera exactly
  // as before (that handler lives on the canvas and is untouched).
  const onViewportPointerDown = (e) => {
    const isMiddleOutsideArtboard = e.button === 1 && !artboardRef.current?.contains(e.target);
    if (!spacePressedRef.current && !isMiddleOutsideArtboard) return;
    if (isMiddleOutsideArtboard) e.preventDefault();
    artboardPanRef.current = { startX: e.clientX, startY: e.clientY, startPos: artboardPos };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onViewportPointerMove = (e) => {
    if (!artboardPanRef.current) return;
    const dx = e.clientX - artboardPanRef.current.startX;
    const dy = e.clientY - artboardPanRef.current.startY;
    setArtboardPos({ x: artboardPanRef.current.startPos.x + dx, y: artboardPanRef.current.startPos.y + dy });
  };
  const onViewportPointerUp = () => {
    artboardPanRef.current = null;
  };
  const fitArtboard = () => {
    const vp = viewportRef.current;
    if (!vp) return;
    const vw = vp.clientWidth - 64;
    const vh = vp.clientHeight - 64;
    setArtboardZoom(Math.max(0.05, Math.min(4, Math.min(vw / artboardW, vh / artboardH))));
    setArtboardPos({ x: 0, y: 0 });
  };
  // min clamped to 1, not some larger "sane minimum" — a bigger floor fights the user
  // while they're still mid-keystroke typing a fresh value (e.g. typing "1980" hits an
  // intermediate "1" that would otherwise get force-corrected before they finish)
  const setArtboardWClamped = (v) => setArtboardW(Math.max(1, Math.min(8000, Math.round(v) || 1)));
  const setArtboardHClamped = (v) => setArtboardH(Math.max(1, Math.min(8000, Math.round(v) || 1)));

  // box arrangement: which instance the sidebar's placement controls are editing,
  // plus add/remove/update/link helpers for the instance list. box1 (array index 0)
  // is the implicit "reference" that other boxes can link individual params to.
  const selectedInstance = boxInstances.find((b) => b.id === selectedBoxId) || boxInstances[0];
  const referenceInstance = boxInstances[0];
  const isReferenceSelected = selectedInstance.id === referenceInstance.id;

  const displayValue = (key) =>
    !isReferenceSelected && selectedInstance.linked?.[key] ? referenceInstance[key] : selectedInstance[key];
  // editing a linked param on a follower actually edits the reference (that's what
  // every linked follower is reading from); editing an unlinked param, or editing the
  // reference itself, just updates that one instance as before.
  const setParamValue = (key, value) => {
    if (!isReferenceSelected && selectedInstance.linked?.[key]) {
      setBoxInstances((prev) => prev.map((b) => (b.id === referenceInstance.id ? { ...b, [key]: value } : b)));
    } else {
      setBoxInstances((prev) => prev.map((b) => (b.id === selectedInstance.id ? { ...b, [key]: value } : b)));
    }
  };
  const toggleParamLink = (key) => {
    if (isReferenceSelected) return; // the reference has nothing to link to
    setBoxInstances((prev) =>
      prev.map((b) =>
        b.id === selectedInstance.id ? { ...b, linked: { ...(b.linked || {}), [key]: !b.linked?.[key] } } : b
      )
    );
  };
  const addBoxInstance = () => {
    const id = nextBoxIdRef.current++;
    const spacing = bodyW + 40;
    setBoxInstances((prev) => [...prev, { id, ...DEFAULT_INSTANCE, x: prev.length * spacing }]);
    selectObject("box", id);
  };
  const duplicateBoxInstance = () => {
    const id = nextBoxIdRef.current++;
    const spacing = bodyW + 40;
    setBoxInstances((prev) => [...prev, { ...selectedInstance, id, linked: {}, x: selectedInstance.x + spacing }]);
    selectObject("box", id);
  };
  const removeBoxInstance = (id) => {
    if (boxInstances.length <= 1) return;
    const remaining = boxInstances.filter((b) => b.id !== id);
    setBoxInstances(remaining);
    if (selectedBoxId === id) setSelectedBoxId(remaining[0].id);
  };

  // ---- symbol library management ----
  const addSymbol = () => {
    const id = nextSymbolIdRef.current++;
    const num = nextSymbolNumRef.current++;
    setSymbols((prev) => [...prev, createSymbol({ id, name: `シンボル ${num}` })]);
  };
  const updateSymbol = (id, patch) => {
    setSymbols((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };
  const renameSymbol = (id, name) => updateSymbol(id, { name });
  const setSymbolColor = (id, color) => updateSymbol(id, { color });
  const removeSymbol = (id) => setSymbols((prev) => prev.filter((s) => s.id !== id));
  const uploadSymbolImage = (id, e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () =>
        updateSymbol(id, { img, fileName: file.name, transform: { cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 } });
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  const pasteSymbolImage = (id) =>
    makePasteHandler((img) =>
      updateSymbol(id, { img, fileName: "(クリップボードから貼り付け)", transform: { cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 } })
    )();
  const openSymbolCropEditor = (id) => {
    const symbol = symbols.find((s) => s.id === id);
    if (!symbol?.img) return;
    setCropEditor({
      img: symbol.img,
      aspectW: imgW(symbol.img),
      aspectH: imgH(symbol.img),
      regions: null,
      initialCrop: symbol.transform,
      setTransform: (updater) =>
        setSymbols((prev) => prev.map((s) => (s.id === id ? { ...s, transform: updater(s.transform) } : s))),
    });
  };
  // detects the corner radius baked into an already-rounded PNG's alpha channel and
  // converts it from source pixels to mm using the symbol's own crop + the card's
  // current width, then applies it as the shared card corner radius.
  const autoDetectCornerRadiusFromSymbol = (id) => {
    const symbol = symbols.find((s) => s.id === id);
    if (!symbol?.img) return;
    const cropped = cropToCanvas(symbol.img, symbol.transform);
    const radiusPx = detectAlphaCornerRadiusPx(cropped);
    if (!radiusPx) {
      alert("この画像から角丸を検出できませんでした(透明な角が見つかりません)。");
      return;
    }
    const mmPerPx = cardW / cropped.width;
    setCardCornerRadius(Math.max(0, Math.round(radiusPx * mmPerPx * 10) / 10));
  };

  // ---- card instance management ----
  const addCardInstance = () => {
    const id = nextCardIdRef.current++;
    const spacing = cardW + 20;
    setCardInstances((prev) => [...prev, { id, ...DEFAULT_CARD_INSTANCE, x: prev.length * spacing }]);
    selectObject("card", id);
  };
  const duplicateCardInstance = (sourceId) => {
    const source = cardInstances.find((c) => c.id === sourceId);
    if (!source) return;
    const id = nextCardIdRef.current++;
    const spacing = cardW + 20;
    setCardInstances((prev) => [...prev, { ...source, id, x: source.x + spacing }]);
    selectObject("card", id);
  };
  const removeCardInstance = (id) => {
    setCardInstances((prev) => {
      const remaining = prev.filter((c) => c.id !== id);
      if (selectedCardId === id) setSelectedCardId(remaining[0]?.id ?? null);
      return remaining;
    });
  };
  const updateCardInstance = (id, patch) => {
    setCardInstances((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  // ---- piece shape library management ----
  const addPieceShapeDef = () => {
    const id = nextPieceShapeIdRef.current++;
    const num = nextPieceShapeNumRef.current++;
    setPieceShapeDefs((prev) => [...prev, { id, name: `形状 ${num}`, ...DEFAULT_PIECE_SHAPE_DEF }]);
    return id;
  };
  // imports an uploaded SVG's outline as a new custom shape def — pushed to shape,
  // extruded exactly like a preset (see parseSvgToUnitShapes/buildExtrudedPieceGeometry
  // in shapes2d.js). Defaults the new def's W/D to the SVG's own aspect ratio (at a
  // fixed 30mm long edge) so it isn't squished on first use.
  const addPieceShapeDefFromSvg = (file) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const svgText = ev.target.result;
      const parsed = parseSvgToUnitShapes(svgText);
      if (!parsed) {
        alert("このSVGから形状を読み取れませんでした。");
        return;
      }
      const id = nextPieceShapeIdRef.current++;
      const num = nextPieceShapeNumRef.current++;
      const longEdge = 30;
      const w = parsed.aspect >= 1 ? longEdge : longEdge * parsed.aspect;
      const d = parsed.aspect >= 1 ? longEdge / parsed.aspect : longEdge;
      setPieceShapeDefs((prev) => [
        ...prev,
        { id, name: `形状 ${num}(SVG)`, kind: "svg", svgText, w, d, thickness: DEFAULT_PIECE_SHAPE_DEF.thickness, cornerFrac: 0 },
      ]);
    };
    reader.readAsText(file);
  };
  const updatePieceShapeDef = (id, patch) => {
    setPieceShapeDefs((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };
  const removePieceShapeDef = (id) => setPieceShapeDefs((prev) => prev.filter((d) => d.id !== id));

  // ---- piece instance management ----
  const addPieceInstance = () => {
    const id = nextPieceIdRef.current++;
    // pieces need a shape def to have any geometry — auto-create one on first use so
    // the user isn't forced to visit the shape library before placing anything.
    const shapeDefId = pieceShapeDefs[0]?.id ?? addPieceShapeDef();
    const spacing = 40;
    setPieceInstances((prev) => [...prev, { id, ...DEFAULT_PIECE_INSTANCE, shapeDefId, x: prev.length * spacing }]);
    selectObject("piece", id);
  };
  const duplicatePieceInstance = (sourceId) => {
    const source = pieceInstances.find((p) => p.id === sourceId);
    if (!source) return;
    const id = nextPieceIdRef.current++;
    setPieceInstances((prev) => [...prev, { ...source, id, x: source.x + 40 }]);
    selectObject("piece", id);
  };
  const removePieceInstance = (id) => {
    setPieceInstances((prev) => {
      const remaining = prev.filter((p) => p.id !== id);
      if (selectedPieceId === id) setSelectedPieceId(remaining[0]?.id ?? null);
      return remaining;
    });
  };
  const updatePieceInstance = (id, patch) => {
    setPieceInstances((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  // small "連動" (linked) badge-button shown next to a per-instance control's label —
  // only meaningful for boxes 2+, toggles whether that one param follows box1.
  const linkToggle = (key) => {
    if (isReferenceSelected || boxInstances.length <= 1) return null;
    const active = !!selectedInstance.linked?.[key];
    return (
      <button
        onClick={() => toggleParamLink(key)}
        title={active ? "箱1と連動中(クリックで解除)" : "クリックで箱1の値と連動"}
        className="rounded px-1 flex-shrink-0"
        style={{
          fontSize: "10px",
          lineHeight: "16px",
          background: active ? "#5fd3d9" : "#3a372f",
          color: active ? "#12203a" : "#7d7568",
          fontWeight: active ? 600 : 400,
        }}
      >
        連動
      </button>
    );
  };
  const isLinked = (key) => !isReferenceSelected && !!selectedInstance.linked?.[key];
  const instanceNumField = (label, key, min = -2000, max = 2000, unit) => (
    <ScrubField
      label={label}
      value={displayValue(key)}
      onChange={(v) => setParamValue(key, v)}
      min={min}
      max={max}
      unit={unit}
      linked={isLinked(key)}
      endAdornment={linkToggle(key)}
    />
  );

  return (
    <div
      className="flex w-full"
      style={{
        height: "100vh",
        background: "#151412",
        fontFamily: "Inter, sans-serif",
        color: "#efe6d4",
      }}
    >
      <style>{`
        input.no-spinner::-webkit-outer-spin-button,
        input.no-spinner::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input.no-spinner[type="number"] {
          -moz-appearance: textfield;
        }
        * {
          scrollbar-width: thin;
          scrollbar-color: #4a463c #1c1a17;
        }
        *::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        *::-webkit-scrollbar-track {
          background: transparent;
        }
        *::-webkit-scrollbar-thumb {
          background-color: #4a463c;
          border-radius: 8px;
        }
        *::-webkit-scrollbar-thumb:hover {
          background-color: #5c584a;
        }
      `}</style>
      {/* left control rail — full height, drag-resizable width */}
      <div
        className="flex-shrink-0 overflow-y-auto p-4"
        style={{ width: sidebarWidth, background: "#1c1a17", borderRight: "1px solid #302d27" }}
      >
        <div className="mb-4">
          <div
            className="text-xs tracking-widest uppercase"
            style={{ color: "#e2432a", letterSpacing: "0.15em" }}
          >
            Package Mockup Studio
          </div>
          <h1
            className="text-xl mt-1"
            style={{ fontFamily: "Fraunces, serif", fontWeight: 600, color: "#f4ede0" }}
          >
            化粧箱プレビュー
          </h1>
        </div>

        <div className="mb-4 rounded-lg p-3" style={{ background: "#242220", border: "1px solid #3a372f" }}>
          <div className="text-xs uppercase mb-2" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
            身(箱)のサイズ mm
          </div>
          <div className="flex flex-col gap-2">
            {numField("幅 W", bodyW, setBodyW)}
            {numField("奥行 D", bodyD, setBodyD)}
            {numField("高さ H", bodyH, setBodyH)}
          </div>
        </div>

        <div className="mb-4 rounded-lg p-3" style={{ background: "#242220", border: "1px solid #3a372f" }}>
          <div className="text-xs uppercase mb-2" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
            蓋のサイズ mm
          </div>
          <div className="flex flex-col gap-2">
            {numField("蓋の高さ", lidH, setLidH, 1, 200)}
            {numField("クリアランス", clearance, setClearance, 0, 20)}
          </div>
          <p className="text-xs mt-2" style={{ color: "#7d7568" }}>
            蓋の幅・奥行は 身+クリアランス×2 で自動計算されます。
          </p>
        </div>

        <div className="mb-4 rounded-lg p-3" style={{ background: "#242220", border: "1px solid #3a372f" }}>
          <div className="text-xs uppercase mb-2" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
            配置(箱の数)
          </div>
          <div className="flex flex-wrap gap-1 mb-3">
            {boxInstances.map((b, i) => (
              <button
                key={b.id}
                onClick={() => selectObject("box", b.id)}
                className="flex items-center gap-1 text-xs rounded pl-2 pr-1 py-1"
                style={{
                  background: b.id === selectedInstance.id ? "#e2432a" : "#3a372f",
                  color: b.id === selectedInstance.id ? "#1c1a17" : "#efe6d4",
                  fontWeight: b.id === selectedInstance.id ? 600 : 400,
                }}
              >
                箱{i + 1}
                {boxInstances.length > 1 && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      removeBoxInstance(b.id);
                    }}
                    className="rounded-full flex items-center justify-center"
                    style={{ width: "14px", height: "14px", background: "rgba(0,0,0,0.25)", fontSize: "10px", lineHeight: 1 }}
                  >
                    ×
                  </span>
                )}
              </button>
            ))}
            <button
              onClick={addBoxInstance}
              className="text-xs rounded px-2 py-1"
              style={{ background: "#3a372f", color: "#5fd3d9" }}
            >
              ＋追加
            </button>
            <button
              onClick={duplicateBoxInstance}
              className="text-xs rounded px-2 py-1"
              style={{ background: "#3a372f", color: "#5fd3d9" }}
              title="選択中の箱をそのまま複製します"
            >
              複製
            </button>
          </div>
          <p className="text-xs mb-2" style={{ color: "#7d7568" }}>
            同じデザインの箱を並べて配置できます。下の位置・回転・傾き・蓋の開きは選択中の箱(箱{boxInstances.findIndex((b) => b.id === selectedInstance.id) + 1})に対する設定です。
          </p>
          <div className="grid grid-cols-2 gap-2 mb-2">
            {instanceNumField("位置 X", "x", -2000, 2000, "mm")}
            {instanceNumField("位置 Z", "z", -2000, 2000, "mm")}
          </div>
          <div className="mb-2">
            {instanceNumField("回転(Y軸)", "rotY", 0, 359, "°")}
          </div>
          <div className="flex gap-1">
            {[
              { label: "正面", deg: 0 },
              { label: "右", deg: 90 },
              { label: "背面", deg: 180 },
              { label: "左", deg: 270 },
            ].map(({ label, deg }) => (
              <button
                key={deg}
                onClick={() => setParamValue("rotY", deg)}
                className="flex-1 text-xs rounded py-1"
                style={{
                  background: displayValue("rotY") === deg ? "#e2432a" : "#3a372f",
                  color: displayValue("rotY") === deg ? "#1c1a17" : "#efe6d4",
                  fontWeight: displayValue("rotY") === deg ? 600 : 400,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 rounded-lg p-3" style={{ background: "#242220", border: "1px solid #3a372f" }}>
          <div className="flex items-center gap-1 mb-2">
            <span className="text-xs uppercase" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
              置き方
            </span>
            {linkToggle("orientation")}
          </div>
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setParamValue("orientation", "standing")}
              className="flex-1 text-xs rounded py-2"
              style={{
                background: displayValue("orientation") === "standing" ? "#e2432a" : "#3a372f",
                color: displayValue("orientation") === "standing" ? "#1c1a17" : "#efe6d4",
                fontWeight: displayValue("orientation") === "standing" ? 600 : 400,
                boxShadow: isLinked("orientation") ? "0 0 0 1px #5fd3d9" : "none",
              }}
            >
              立てる
            </button>
            <button
              onClick={() => setParamValue("orientation", "lying")}
              className="flex-1 text-xs rounded py-2"
              style={{
                background: displayValue("orientation") === "lying" ? "#e2432a" : "#3a372f",
                color: displayValue("orientation") === "lying" ? "#1c1a17" : "#efe6d4",
                fontWeight: displayValue("orientation") === "lying" ? 600 : 400,
                boxShadow: isLinked("orientation") ? "0 0 0 1px #5fd3d9" : "none",
              }}
            >
              寝かせる
            </button>
          </div>
          <ScrubField label="角の丸み(半径)" value={bevelRadius} onChange={setBevelRadius} min={0} max={10} step={0.5} decimals={1} unit="mm" />
          <p className="text-xs mt-1" style={{ color: "#7d7568" }}>
            角の丸みは全ての箱で共通です。置き方は箱ごとに変えられます(「連動」で箱1に合わせることもできます)。
          </p>

          <div className="mt-3">{instanceNumField("傾き(前後)", "tiltX", -45, 45, "°")}</div>
          <div className="mt-2">{instanceNumField("傾き(左右)", "tiltZ", -45, 45, "°")}</div>
          {(displayValue("tiltX") !== 0 || displayValue("tiltZ") !== 0) && (
            <button
              onClick={() => {
                setParamValue("tiltX", 0);
                setParamValue("tiltZ", 0);
              }}
              className="w-full mt-2 text-xs rounded py-1"
              style={{ background: "#3a372f", color: "#efe6d4" }}
            >
              傾きをリセット
            </button>
          )}
        </div>

        <div className="mb-4 rounded-lg p-3" style={{ background: "#242220", border: "1px solid #3a372f" }}>
          {instanceNumField("蓋を開ける", "lidOpen", 0, 100, "%")}
          <p className="text-xs mt-1" style={{ color: "#7d7568" }}>
            選択中の箱(箱{boxInstances.findIndex((b) => b.id === selectedInstance.id) + 1})のみに適用されます(「連動」で箱1に合わせることもできます)。
          </p>
          <label className="flex items-center gap-2 mt-3 text-xs" style={{ color: "#a89f8f" }}>
            <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} />
            自動回転
          </label>
        </div>

        <CardPanel
          cardW={cardW}
          setCardW={setCardW}
          cardD={cardD}
          setCardD={setCardD}
          cardThickness={cardThickness}
          setCardThickness={setCardThickness}
          cardCornerRadius={cardCornerRadius}
          setCardCornerRadius={setCardCornerRadius}
          symbols={symbols}
          cardInstances={cardInstances}
          selectedCardId={selectedCardId}
          onSelectCard={(id) => selectObject("card", id)}
          onAdd={addCardInstance}
          onDuplicate={duplicateCardInstance}
          onRemove={removeCardInstance}
          onUpdate={updateCardInstance}
        />

        <PiecePanel
          shapeDefs={pieceShapeDefs}
          symbols={symbols}
          pieceInstances={pieceInstances}
          selectedPieceId={selectedPieceId}
          onSelectPiece={(id) => selectObject("piece", id)}
          onAdd={addPieceInstance}
          onDuplicate={duplicatePieceInstance}
          onRemove={removePieceInstance}
          onUpdate={updatePieceInstance}
        />

        <div className="mb-4 rounded-lg p-3" style={{ background: "#242220", border: "1px solid #3a372f" }}>
          <div className="text-xs uppercase mb-2" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
            アングル
          </div>
          <ScrubField label="遠近感(画角)" value={fov} onChange={setFov} min={15} max={90} unit="°" />
          <p className="text-xs mb-3 mt-1" style={{ color: "#7d7568" }}>
            数値が小さいほど圧縮された望遠風、大きいほど広角で遠近感が強調されます。
          </p>

          <div className="text-xs uppercase mb-2" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
            背景
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setBgMode("dark")}
              className="flex-1 text-xs rounded py-2"
              style={{
                background: bgMode === "dark" ? "#e2432a" : "#3a372f",
                color: bgMode === "dark" ? "#1c1a17" : "#efe6d4",
                fontWeight: bgMode === "dark" ? 600 : 400,
              }}
            >
              スタジオ黒
            </button>
            <button
              onClick={() => setBgMode("white")}
              className="flex-1 text-xs rounded py-2"
              style={{
                background: bgMode === "white" ? "#e2432a" : "#3a372f",
                color: bgMode === "white" ? "#1c1a17" : "#efe6d4",
                fontWeight: bgMode === "white" ? 600 : 400,
              }}
            >
              商品写真・白
            </button>
            <button
              onClick={() => setBgMode("image")}
              className="flex-1 text-xs rounded py-2"
              style={{
                background: bgMode === "image" ? "#e2432a" : "#3a372f",
                color: bgMode === "image" ? "#1c1a17" : "#efe6d4",
                fontWeight: bgMode === "image" ? 600 : 400,
              }}
            >
              画像
            </button>
          </div>

          {bgMode === "image" && (
            <div className="flex gap-2 mt-3">
              {bgImage && (
                <img
                  src={bgImage.src}
                  alt="background"
                  className="rounded flex-shrink-0"
                  style={{ width: "48px", height: "48px", objectFit: "cover", border: "1px solid #3a372f" }}
                />
              )}
              <div className="flex flex-col gap-1 flex-1">
                <label
                  className="block text-center text-xs rounded py-2 cursor-pointer"
                  style={{ background: "#e2432a", color: "#1c1a17", fontWeight: 600 }}
                >
                  画像をアップロード
                  <input type="file" accept="image/*" onChange={handleBgImageFile} className="hidden" />
                </label>
                <button
                  onClick={handleBgImagePaste}
                  className="w-full text-xs rounded py-2"
                  style={{ background: "#3a372f", color: "#efe6d4" }}
                >
                  クリップボードから貼り付け
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mb-4 rounded-lg p-3" style={{ background: "#242220", border: "1px solid #3a372f" }}>
          <div className="text-xs uppercase mb-2" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
            地面
          </div>
          <label className="flex items-center gap-2 mb-3 text-xs" style={{ color: "#a89f8f" }}>
            <input type="checkbox" checked={groundVisible} onChange={(e) => setGroundVisible(e.target.checked)} />
            地面を表示
          </label>
          {instanceNumField("地面からの高さ", "floatHeight", -200, 500, "mm")}
          <p className="text-xs mt-1" style={{ color: "#7d7568" }}>
            選択中の箱(箱{boxInstances.findIndex((b) => b.id === selectedInstance.id) + 1})のみに適用されます(「連動」で箱1に合わせることもできます)。
          </p>

          <div className="mt-3 pt-3" style={{ borderTop: "1px solid #3a372f" }}>
            <label className="flex items-center gap-2 mb-2 text-xs" style={{ color: "#a89f8f" }}>
              <input
                type="checkbox"
                checked={displayValue("groundSnap") !== false}
                onChange={(e) => setParamValue("groundSnap", e.target.checked)}
              />
              接地する(地面、または下のレイヤーのオブジェクトに自動で乗る)
            </label>
            <ScrubField label="レイヤー" value={displayValue("layer") ?? 0} onChange={(v) => setParamValue("layer", Math.round(v))} min={0} max={20} />
            <p className="text-xs mt-1" style={{ color: "#7d7568" }}>
              数字が大きいレイヤーほど上。接地オフのオブジェクトは「地面からの高さ」の数値がそのままY座標になります(自動配置の対象外)。
            </p>
          </div>
        </div>

        <div className="mb-4 rounded-lg p-3" style={{ background: "#242220", border: "1px solid #3a372f" }}>
          <div className="text-xs uppercase mb-2" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
            ライティング(主光源)
          </div>
          <div className="mb-3">
            <ScrubField label="光の向き" value={lightAzimuth} onChange={setLightAzimuth} min={-180} max={180} unit="°" />
          </div>
          <ScrubField label="光の高さ" value={lightElevation} onChange={setLightElevation} min={10} max={80} unit="°" />
        </div>

        <div className="mb-4 rounded-lg p-3" style={{ background: "#242220", border: "1px solid #3a372f" }}>
          <div className="text-xs uppercase mb-2" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
            見え方の補正(色あせ対策)
          </div>
          <div className="mb-3">
            <ScrubField label="露出" value={exposure} onChange={setExposure} min={0.4} max={2} step={0.05} decimals={2} />
          </div>
          <div className="mb-3">
            <ScrubField label="環境光の強さ" value={ambientBoost} onChange={setAmbientBoost} min={0} max={2} step={0.05} decimals={2} />
          </div>
          <p className="text-xs mb-2" style={{ color: "#7d7568" }}>
            環境光が強いと影が浅くなり色が白っぽく薄まって見えます。下げると発色が濃くなります。
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setToneMappingMode("filmic")}
              className="flex-1 text-xs rounded py-2"
              style={{
                background: toneMappingMode === "filmic" ? "#e2432a" : "#3a372f",
                color: toneMappingMode === "filmic" ? "#1c1a17" : "#efe6d4",
                fontWeight: toneMappingMode === "filmic" ? 600 : 400,
              }}
            >
              フィルム風
            </button>
            <button
              onClick={() => setToneMappingMode("flat")}
              className="flex-1 text-xs rounded py-2"
              style={{
                background: toneMappingMode === "flat" ? "#e2432a" : "#3a372f",
                color: toneMappingMode === "flat" ? "#1c1a17" : "#efe6d4",
                fontWeight: toneMappingMode === "flat" ? 600 : 400,
              }}
            >
              フラット(原色重視)
            </button>
          </div>
          <p className="text-xs mt-2" style={{ color: "#7d7568" }}>
            「フラット」は画像の色をそのまま出します(通常はこちらでOK)。「フィルム風」は明暗の差を強めてコントラストを付ける代わりに、色が少しくすみます。
          </p>

          <div className="mt-3 pt-3" style={{ borderTop: "1px solid #3a372f" }}>
            <p className="text-xs mb-2" style={{ color: "#7d7568" }}>
              露出・環境光はライティングの調整です。それでも印刷物より色が薄く見える場合は、下記で画像そのものの彩度・コントラストを直接補正できます。
            </p>
            <div className="mb-3">
              <ScrubField
                label="彩度"
                value={colorCorrection.saturation}
                onChange={(v) => setColorCorrection((p) => ({ ...p, saturation: v }))}
                min={50}
                max={200}
                unit="%"
              />
            </div>
            <div className="mb-3">
              <ScrubField
                label="コントラスト"
                value={colorCorrection.contrast}
                onChange={(v) => setColorCorrection((p) => ({ ...p, contrast: v }))}
                min={50}
                max={150}
                unit="%"
              />
            </div>
            <ScrubField
              label="明るさ"
              value={colorCorrection.brightness}
              onChange={(v) => setColorCorrection((p) => ({ ...p, brightness: v }))}
              min={50}
              max={150}
              unit="%"
            />
            {(colorCorrection.saturation !== 100 || colorCorrection.contrast !== 100 || colorCorrection.brightness !== 100) && (
              <button
                onClick={() => setColorCorrection({ saturation: 100, contrast: 100, brightness: 100 })}
                className="w-full mt-2 text-xs rounded py-1"
                style={{ background: "#3a372f", color: "#efe6d4" }}
              >
                補正をリセット
              </button>
            )}
          </div>
        </div>

      </div>

      {/* drag handle: sidebar width */}
      <div
        onPointerDown={onSidebarHandleDown}
        onPointerMove={onSidebarHandleMove}
        onPointerUp={onSidebarHandleUp}
        onPointerLeave={onSidebarHandleUp}
        style={{ width: "5px", flexShrink: 0, cursor: "col-resize", background: "#302d27", touchAction: "none" }}
      />

      {/* right column: 3D viewport + bottom bar, both drag-resizable */}
      <div className="flex flex-col flex-1" style={{ minWidth: "260px" }}>
        {/* main stage: pasteboard viewport with the render as a floating, resizable/
            zoomable/pannable artboard inside it — After Effects preview style */}
        <div
          ref={viewportRef}
          className="flex-1 relative overflow-hidden"
          style={{
            minHeight: "160px",
            background: "#100f0d",
            backgroundImage: "radial-gradient(circle, #2a2722 1px, transparent 1px)",
            backgroundSize: "22px 22px",
            cursor: spaceHeld ? "grab" : "default",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
          onPointerDown={onViewportPointerDown}
          onPointerMove={onViewportPointerMove}
          onPointerUp={onViewportPointerUp}
          onPointerLeave={onViewportPointerUp}
        >
          <div
            ref={artboardRef}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: artboardW,
              height: artboardH,
              transform: `translate(-50%, -50%) translate(${artboardPos.x}px, ${artboardPos.y}px) scale(${artboardZoom})`,
              boxShadow: "0 12px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)",
            }}
          >
            <div ref={mountRef} style={{ width: "100%", height: "100%" }} />
          </div>

          <div
            className="absolute top-3 left-3 text-xs px-2 py-1 rounded"
            style={{ background: "rgba(28,26,23,0.85)", color: "#9c968a", pointerEvents: "none" }}
          >
            オブジェクトをクリック:選択 / ドラッグ:移動 / それ以外をドラッグ:回転 / ホイール:ズーム / 中クリックドラッグ:パン / Space+ドラッグ:プレビュー移動 / Ctrl+ホイール:プレビュー倍率
          </div>

          <div
            className="absolute bottom-3 left-3 flex items-center gap-2 text-xs px-2 py-1.5 rounded"
            style={{ background: "rgba(28,26,23,0.85)", color: "#efe6d4" }}
          >
            <button
              onClick={() => setArtboardZoom((z) => Math.max(0.1, Math.round((z - 0.1) * 100) / 100))}
              className="rounded px-2 py-0.5"
              style={{ background: "#3a372f" }}
            >
              −
            </button>
            <span style={{ width: "40px", textAlign: "center", fontFamily: "'JetBrains Mono', monospace" }}>
              {Math.round(artboardZoom * 100)}%
            </span>
            <button
              onClick={() => setArtboardZoom((z) => Math.min(4, Math.round((z + 0.1) * 100) / 100))}
              className="rounded px-2 py-0.5"
              style={{ background: "#3a372f" }}
            >
              +
            </button>
            <button onClick={fitArtboard} className="rounded px-2 py-0.5" style={{ background: "#3a372f" }}>
              フィット
            </button>
            <span style={{ width: "1px", height: "16px", background: "#4a463c" }} />
            <input
              type="number"
              min={1}
              max={8000}
              value={artboardW}
              onChange={(e) => setArtboardWClamped(Number(e.target.value))}
              className="text-xs rounded px-1 py-0.5 text-right"
              style={{ width: "56px", background: "#12203a", color: "#efe6d4", border: "1px solid #3a5a78" }}
            />
            <span>×</span>
            <input
              type="number"
              min={1}
              max={8000}
              value={artboardH}
              onChange={(e) => setArtboardHClamped(Number(e.target.value))}
              className="text-xs rounded px-1 py-0.5 text-right"
              style={{ width: "56px", background: "#12203a", color: "#efe6d4", border: "1px solid #3a5a78" }}
            />
            <span style={{ color: "#7d7568" }}>px</span>
          </div>
        </div>

        {/* drag handle: bottom bar height */}
        <div
          onPointerDown={onBottomBarHandleDown}
          onPointerMove={onBottomBarHandleMove}
          onPointerUp={onBottomBarHandleUp}
          onPointerLeave={onBottomBarHandleUp}
          style={{ height: "5px", flexShrink: 0, cursor: "row-resize", background: "#302d27", touchAction: "none" }}
        />

      <div
        className="flex-shrink-0 flex gap-3 overflow-x-auto p-3"
        style={{ height: bottomBarHeight, background: "#1c1a17", borderTop: "1px solid #302d27" }}
      >
        {imageUploadPanel(
          "身(箱)側の展開図画像",
          bodyImg,
          bodyFileName,
          handleBodyFile,
          handleBodyPaste,
          bodyTransform,
          setBodyTransform,
          downloadBodyGuide,
          () => {
            if (!bodyImg) return;
            const layout = rawSpaceLayout(netLayout(bodyW, bodyD, bodyH, "body"), BODY_ORIENT);
            setCropEditor({
              img: orientedImage(bodyImg, bodyTransform),
              aspectW: layout.totalW,
              aspectH: layout.totalH,
              regions: layout.regions,
              initialCrop: bodyTransform,
              setTransform: setBodyTransform,
            });
          },
          bodyGuideCanvasRef
        )}

        {imageUploadPanel(
          "蓋(フタ)側の展開図画像",
          lidImg,
          lidFileName,
          handleLidFile,
          handleLidPaste,
          lidTransform,
          setLidTransform,
          downloadLidGuide,
          () => {
            if (!lidImg) return;
            const layout = rawSpaceLayout(netLayout(bodyW + clearance * 2, bodyD + clearance * 2, lidH, "lid"), LID_ORIENT);
            setCropEditor({
              img: orientedImage(lidImg, lidTransform),
              aspectW: layout.totalW,
              aspectH: layout.totalH,
              regions: layout.regions,
              initialCrop: lidTransform,
              setTransform: setLidTransform,
            });
          },
          lidGuideCanvasRef
        )}

        {imageUploadPanel(
          "蓋・裏面(内側)の画像",
          lidInnerImg,
          lidInnerFileName,
          handleLidInnerFile,
          handleLidInnerPaste,
          lidInnerTransform,
          setLidInnerTransform,
          downloadLidInnerGuide,
          () => {
            if (!lidInnerImg) return;
            const lidWmm = bodyW + clearance * 2;
            const lidDmm = bodyD + clearance * 2;
            setCropEditor({
              img: orientedImage(lidInnerImg, lidInnerTransform),
              aspectW: lidWmm,
              aspectH: lidDmm,
              regions: [{ key: "lid-inner", x: 0, y: 0, w: lidWmm, h: lidDmm, rotate: 0 }],
              initialCrop: lidInnerTransform,
              setTransform: setLidInnerTransform,
            });
          },
          lidInnerGuideCanvasRef
        )}

        <SymbolLibraryPanel
          symbols={symbols}
          onAddSymbol={addSymbol}
          onRenameSymbol={renameSymbol}
          onSetColor={setSymbolColor}
          onUploadImage={uploadSymbolImage}
          onPasteImage={pasteSymbolImage}
          onOpenCropEditor={openSymbolCropEditor}
          onRemoveSymbol={removeSymbol}
          onAutoRoundFromAlpha={autoDetectCornerRadiusFromSymbol}
        />

        <PieceShapeLibraryPanel
          shapeDefs={pieceShapeDefs}
          onAdd={addPieceShapeDef}
          onAddFromSvg={addPieceShapeDefFromSvg}
          onUpdate={updatePieceShapeDef}
          onRemove={removePieceShapeDef}
        />

        {exportSettingsCard}
      </div>
      </div>

      {cropEditor && (
        <CropEditorModal
          img={cropEditor.img}
          aspectW={cropEditor.aspectW}
          aspectH={cropEditor.aspectH}
          regions={cropEditor.regions}
          regionLabel={(key) => FACE_LABELS[key] || key}
          initialCrop={cropEditor.initialCrop}
          guideColor={guideColor}
          onGuideColorChange={setGuideColor}
          onCancel={() => setCropEditor(null)}
          onApply={(crop) => {
            cropEditor.setTransform((prev) => ({ ...prev, ...crop }));
            setCropEditor(null);
          }}
        />
      )}
    </div>
  );
}
