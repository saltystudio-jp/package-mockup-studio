import React, { useState, useRef, useEffect, useCallback } from "react";
import * as THREE from "three";
import { createDof } from "./lib/dof.js";
import { PROJECT_EXT, serializeProject, deserializeProject, storeGet, storeSet, writeProjectFile, readProjectFile } from "./lib/project.js";
import CropEditorModal from "./components/CropEditorModal.jsx";
import ScrubField from "./components/ScrubField.jsx";
import Outliner from "./components/Outliner.jsx";
import ComponentInstancePanel from "./components/ComponentInstancePanel.jsx";
import LibraryPanel from "./components/LibraryPanel.jsx";
import ObjectHeader from "./components/ObjectHeader.jsx";
import NetLayoutEditor from "./components/NetLayoutEditor.jsx";
import ToggleSwitch from "./components/ToggleSwitch.jsx";
import Section from "./components/Section.jsx";
import SegmentedControl from "./components/SegmentedControl.jsx";
import DimensionFields from "./components/DimensionFields.jsx";
import ModalBackdrop from "./components/ModalBackdrop.jsx";
import PasteImageDialog from "./components/PasteImageDialog.jsx";
import TransformGizmo from "./components/TransformGizmo.jsx";
import useClickOutside from "./hooks/useClickOutside.js";
import { sectionTitle, sectionMeta, helpText, buttonStyle } from "./lib/ui.js";
import { THEMES, THEME_ORDER, DEFAULT_THEME, THEME_STORAGE_KEY } from "./lib/theme.js";
import { buildComponentGeometry, parseSvgToUnitShapes } from "./lib/shapes2d.js";
import {
  imgW,
  imgH,
  applyColorCorrection,
  trimTransparentCanvas,
  makePasteHandler,
  imageFromClipboardItems,
  clipboardItemsFromDataTransfer,
  hasTransparency,
  coverFitRepeatOffset,
  detectAlphaCornerRadiusPx,
  detectAlphaShapeKind,
  cropToCanvas,
  imageKey,
} from "./lib/imaging.js";
import { buildComponentFaceCanvas } from "./lib/components.js";
import { composePlacementQuaternion, groundSnapY, measureXZFootprint } from "./lib/placement.js";
import { resolveStacking } from "./lib/stacking.js";
import { srgb, setSrgb } from "./lib/color.js";
import { BOX_FINISHES, makeEnvMap, makeEmbossNormalMap, applyFinish } from "./lib/finish.js";
import {
  faceRegions,
  faceRects,
  defaultFaceLayout,
  displayImage,
  sliceFace,
  rotateLayoutCW,
  drawLayoutPreview,
} from "./lib/netLayout.js";
import {
  applyFaceTransform,
  rawSpaceLayout,
  drawNetGuide,
  DEFAULT_GUIDE_COLOR,
  FACE_LABELS,
} from "./lib/nets.js";
import {
  BOX_TYPES,
  BOX_TYPE_LABEL,
  boxNetSlots,
  buildBoxModel,
  boxGeometryKey,
  composeFaceCanvases,
  boxBaseRotation,
} from "./lib/boxModels.js";
import {
  PRESET_ITEMS,
  BOX_DEFAULTS,
  COMPONENT_DEFAULTS,
  EMPTY_CROP,
  templateFromObject,
  objectFieldsFromTemplate,
  sizeLabel,
} from "./lib/presets.js";

/* ---------------------------------------------------------
   パッケージ(箱・カード・駒)3Dモックアップスタジオ
   ---------------------------------------------------------
   展開図(ネット)画像を箱の各面に、画像をカード・駒の面に貼って
   並べ、積み、書き出す。
--------------------------------------------------------- */

const SCALE = 0.01; // 1 three.js unit = 100mm

// MIME type for dragging a library entry onto the viewport (HTML5 drag-and-drop)
const LIBRARY_DRAG_TYPE = "application/x-pms-library-item";

// where-and-how-it-sits fields every scene object has, whatever it is
const PLACEMENT_DEFAULTS = { x: 0, z: 0, rotY: 0, tiltX: 0, tiltZ: 0, floatHeight: 0, layer: 0, groundSnap: true };

// every object in one bottom-to-top list — ties (which shouldn't happen after
// normalizeLayers, but can in state restored by an older undo snapshot) fall back to
// a fixed kind/id order so the result is never ambiguous
function stackOrder(boxes, components) {
  return [
    ...boxes.map((o) => ({ kind: "box", id: o.id, layer: o.layer ?? 0 })),
    ...components.map((o) => ({ kind: "component", id: o.id, layer: o.layer ?? 0 })),
  ].sort((a, b) => a.layer - b.layer || (a.kind === b.kind ? a.id - b.id : a.kind === "box" ? -1 : 1));
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


// tracks the CURRENT scene bounds for shadow-map coverage — deliberately independent
// of t.center (the orbit camera's look-at point), which now only ever changes from
// explicit user action (orbit/pan/zoom, or the "reset camera" button), never
// automatically as objects move. The shadow frustum still needs to track the actual
// content regardless of where the viewer's camera happens to be pointed, so it
// computes its own target from the bounding box directly instead of borrowing t.center.
function fitShadowToBox(t) {
  if (!t.key || !t.allBoxesGroup) return;
  const box = t.fullBox || new THREE.Box3().setFromObject(t.allBoxesGroup);
  const size = new THREE.Vector3();
  box.getSize(size);
  const boxCenter = new THREE.Vector3();
  box.getCenter(boxCenter);
  const radius = Math.max(0.3, Math.max(size.x, size.y, size.z) * 0.5 * Math.SQRT2 + 0.15);
  t.shadowRadius = radius;

  // move the light+target TOGETHER (position = target + the fixed offset the
  // azimuth/elevation sliders computed) so re-centering the target on the current
  // content never changes the light's actual direction — see t.lightOffset above.
  if (t.lightOffset) t.key.position.copy(boxCenter).add(t.lightOffset);
  t.key.target.position.copy(boxCenter);
  t.key.target.updateMatrixWorld();

  const dist = Math.max(0.5, t.key.position.distanceTo(boxCenter));
  const cam = t.key.shadow.camera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.near = Math.max(0.05, dist - radius * 2);
  cam.far = dist + radius * 2;
  cam.updateProjectionMatrix();
}

export default function PackageBoxMockup() {
  const DEFAULT_CROP = EMPTY_CROP;
  const [cropEditor, setCropEditor] = useState(null);
  const [guideColor, setGuideColor] = useState(DEFAULT_GUIDE_COLOR);
  const [colorCorrection, setColorCorrection] = useState({ saturation: 100, contrast: 100, brightness: 100 });
  const [autoRotate, setAutoRotate] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bgMode, setBgMode] = useState("white");
  const [bgImage, setBgImage] = useState(null);
  const [fov, setFov] = useState(35);
  const [transparentExport, setTransparentExport] = useState(false);
  // trims the exported PNG to the content's own bounding box (vs. leaving it at the
  // full preview canvas size) — only meaningful once the background is transparent
  // (that's what lets the trim detect "content" vs "empty" by alpha), so toggling
  // transparency off forces this off too rather than leaving a checked-but-inert box.
  const [fitToContent, setFitToContent] = useState(false);
  const setTransparentExportGated = (v) => {
    setTransparentExport(v);
    if (!v) setFitToContent(false);
  };
  // output resolution is the current preview's own pixel size (artboardW/H) times this
  // multiplier — no separate target-resolution field to keep in sync with the preview.
  const [exportScale, setExportScale] = useState(2);
  const [exportSettingsOpen, setExportSettingsOpen] = useState(false);
  // generic yes/no confirmation modal — {title, message, confirmLabel, onConfirm} | null.
  // Used wherever a destructive action needs a heads-up before running (e.g. deleting a
  // component that's still placed in the scene) instead of window.confirm(), which
  // would look jarringly out of place against this app's own dark UI.
  const [confirmDialog, setConfirmDialog] = useState(null);
  // an image pasted onto the app itself, waiting for "what is it?" — { img, sizeMm }
  const [pastedImage, setPastedImage] = useState(null);
  // the transform box's size link (W/D/H change together) — on by default
  const [gizmoLink, setGizmoLink] = useState(true);
  const [lightAzimuth, setLightAzimuth] = useState(49);
  const [lightElevation, setLightElevation] = useState(46);
  const [groundVisible, setGroundVisible] = useState(true);
  const [exposure, setExposure] = useState(1);
  // 被写界深度 (depth of field): off by default; focus follows the selection or a set distance
  const [dofEnabled, setDofEnabled] = useState(false);
  const [dofFocusMode, setDofFocusMode] = useState("selection"); // "selection" | "distance"
  const [dofDistance, setDofDistance] = useState(600); // mm from the camera
  const [dofStrength, setDofStrength] = useState(40); // 0..100
  const [ambientBoost, setAmbientBoost] = useState(1);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  // inspector rail tab: オブジェクト(選択中の箱/コンポーネントの個別設定+箱の展開図画像) /
  // コンポーネント(ライブラリ) / 環境(アングル・背景・地面・ライティング・色補正など全体設定)
  const [activeTab, setActiveTab] = useState("object");
  // UI theme (dark/light/sepia) — persisted so it survives a reload. Applied as CSS
  // custom properties on the root element (see the return below); everything else in
  // the app reads colors through var(--token) rather than hardcoded hex so this one
  // switch repaints the whole UI.
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      return THEMES[saved] ? saved : DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // no-op: private-browsing/storage-disabled environments just won't persist
    }
  }, [theme]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // ---- project file (保存 / 開く) ----
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const fileMenuRef = useRef(null);
  useClickOutside(fileMenuRef, fileMenuOpen, () => setFileMenuOpen(false));
  const [projectName, setProjectName] = useState(null); // the file's name, once saved/opened
  const [toast, setToast] = useState(null);
  const [, forceRender] = useState(0);
  const settingsMenuRef = useRef(null);
  useClickOutside(settingsMenuRef, settingsOpen, () => setSettingsOpen(false));
  // viewport controls cheat-sheet: folded behind a ? button so it doesn't sit over the
  // top of the view all the time
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef(null);
  useClickOutside(helpRef, helpOpen, () => setHelpOpen(false));

  // the 3D render is a fixed-size "artboard" floating inside the viewport (pasteboard),
  // After Effects-preview-style: its own size, zoom, and pan position, independent of
  // however big the surrounding panel happens to be.
  const [artboardW, setArtboardW] = useState(1200);
  const [artboardH, setArtboardH] = useState(800);
  const [artboardZoom, setArtboardZoom] = useState(1);
  const [artboardPos, setArtboardPos] = useState({ x: 0, y: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);

  // ---- scene objects. Two lists because boxes and flat components (cards, tokens)
  // are built and textured by entirely different pipelines — but BOTH own everything
  // about themselves now: size, shape and artwork live on the object and are edited
  // in the inspector. The コンポーネント library only holds templates to place from or
  // swap to (see lib/presets.js); nothing in the scene references a library entry.
  //
  // `layer` is each object's unique slot in one shared stacking order (0 = bottom).
  // It used to default to 0 for everything, and the stacking resolver only lets a
  // HIGHER layer rest on a lower one — so with every object tied at 0, nothing ever
  // stacked. New objects now go on top, and normalizeLayers keeps the order dense.
  const [boxInstances, setBoxInstances] = useState(() => [
    { id: 1, ...PLACEMENT_DEFAULTS, ...objectFieldsFromTemplate(PRESET_ITEMS[0]) },
  ]);
  const nextBoxIdRef = useRef(2);
  const [componentInstances, setComponentInstances] = useState([]);
  const nextComponentInstanceIdRef = useRef(1);
  // registered library entries; the built-in presets are constants
  const [userComponents, setUserComponents] = useState([]);
  const nextUserComponentIdRef = useRef(1);
  const libraryItems = [...PRESET_ITEMS, ...userComponents];

  // one selection across both lists; null when nothing is selected (the scene is
  // allowed to be empty — a box is just another object now, not a required fixture)
  const [activeSelection, setActiveSelection] = useState({ kind: "box", id: 1 });
  // Multi-selection: `selectedKeys` ("box:1", "component:3", …) holds every selected
  // object; activeSelection is the one the inspector shows (the last one picked). Code
  // that sets activeSelection on its own (placing, duplicating, undo…) simply gets a
  // single selection again — the set only counts while it contains the active object.
  const [selectedKeys, setSelectedKeys] = useState(["box:1"]);
  const keyOf = (kind, id) => `${kind}:${id}`;
  const parseKey = (k) => {
    const [kind, id] = k.split(":");
    return { kind, id: Number(id) };
  };
  const activeKey = activeSelection ? keyOf(activeSelection.kind, activeSelection.id) : null;
  const objectExists = (k) => {
    const { kind, id } = parseKey(k);
    return (kind === "box" ? boxInstances : componentInstances).some((o) => o.id === id);
  };
  const selectionKeys = activeKey ? (selectedKeys.includes(activeKey) ? selectedKeys.filter(objectExists) : [activeKey]) : [];
  const lastFocusKeysRef = useRef(selectionKeys); // depth of field's target, kept after deselecting
  const selectionKeysRef = useRef(selectionKeys);
  selectionKeysRef.current = selectionKeys;
  // toggle: Shift/Ctrl-click — add the object to the selection, or take it out again
  const selectObject = (kind, id, { toggle = false } = {}) => {
    if (kind == null) {
      setActiveSelection(null);
      setSelectedKeys([]);
      return;
    }
    const key = keyOf(kind, id);
    if (!toggle) {
      setActiveSelection({ kind, id });
      setSelectedKeys([key]);
      return;
    }
    const cur = selectionKeysRef.current;
    if (cur.includes(key)) {
      const next = cur.filter((k) => k !== key);
      setSelectedKeys(next);
      setActiveSelection(next.length ? parseKey(next[next.length - 1]) : null);
    } else {
      setSelectedKeys([...cur, key]);
      setActiveSelection({ kind, id });
    }
  };
  const selectedBox = activeSelection?.kind === "box" ? boxInstances.find((b) => b.id === activeSelection.id) || null : null;
  const selectedComponent =
    activeSelection?.kind === "component" ? componentInstances.find((c) => c.id === activeSelection.id) || null : null;
  const selectedObject = selectedBox || selectedComponent;

  const mountRef = useRef(null);
  const viewportRef = useRef(null);
  const artboardRef = useRef(null);
  // the selected box's net previews in the inspector, keyed by net slot — which slots
  // exist depends on the box type, so these are registered by callback ref
  const guideCanvasRefs = useRef({});
  const boxInstancesRef = useRef(boxInstances);
  const componentInstancesRef = useRef(componentInstances);
  const autoRotateRef = useRef(false);
  const sidebarDragRef = useRef(null);
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
    componentInstancesRef.current = componentInstances;
  }, [componentInstances]);
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
    (hex) => new THREE.MeshStandardMaterial({ color: srgb(hex), roughness: 0.92, metalness: 0 }),
    []
  );

  const makeFaceMaterial = useCallback(() => {
    return new THREE.MeshStandardMaterial({ color: srgb(0xd8c9a8), roughness: 0.82, metalness: 0 });
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
    // Linear tone mapping is a plain multiply by toneMappingExposure — the colours stay
    // what the artwork says, and the 露出 slider has something to act on (under
    // NoToneMapping exposure is ignored). It's set once here: tone mapping is compiled
    // into every shader, so switching it at runtime silently did nothing until each
    // material happened to recompile.
    renderer.toneMapping = THREE.LinearToneMapping;
    renderer.toneMappingExposure = 1;
    // Sharpness of the preview:
    //  - the canvas renders at the screen's real pixel density (capped at 2×); at 1× a
    //    hi-DPI display upscaled the whole view, which the 2× export never showed
    //  - printed faces get anisotropic filtering: without it a face seen at a steep
    //    angle (the camera low over a card lying flat) fell back to a far smaller
    //    mipmap and the artwork smeared
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    t.maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);
    t.ambient = ambient;

    const key = new THREE.DirectionalLight(0xfff3e0, 0.6);
    key.position.set(3, 4.2, 2.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    scene.add(key.target);
    t.key = key;

    const fill = new THREE.DirectionalLight(0xdce8ff, 0.22);
    fill.position.set(-3, 1.6, -2);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.2);
    rim.position.set(-1.5, 2.5, -3.5);
    scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: srgb(0x1a1917), roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // ring on the floor under whichever box is selected in the sidebar — with several
    // boxes in a scene there's otherwise no way to tell which one the controls apply to
    const selectionMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1, 64),
      new THREE.MeshBasicMaterial({ color: srgb(0x5fd3d9), transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    selectionMarker.rotation.x = -Math.PI / 2;
    selectionMarker.renderOrder = 1;
    selectionMarker.visible = false;
    scene.add(selectionMarker);
    t.selectionMarker = selectionMarker;

    // Each box instance: a placement group (positioned by the placement effect) holding
    // a type-specific model from boxModels.js. The model is rebuilt only when something
    // that changes its geometry changes (type or any dimension — see boxGeometryKey);
    // moving, opening or re-texturing a box reuses it. A rebuilt model starts
    // untextured, and the texture effect notices via its per-model texKey.
    const allBoxesGroup = new THREE.Group();
    scene.add(allBoxesGroup);
    const instances = {};
    const syncBoxes = (boxes) => {
      const idSet = new Set(boxes.map((b) => b.id));
      Object.keys(instances).forEach((key) => {
        if (idSet.has(Number(key))) return;
        allBoxesGroup.remove(instances[key].boxGroup);
        instances[key].model.dispose();
        delete instances[key];
      });
      boxes.forEach((b) => {
        let inst = instances[b.id];
        const geoKey = boxGeometryKey(b);
        if (inst && inst.geoKey === geoKey) return;
        if (!inst) {
          const boxGroup = new THREE.Group();
          allBoxesGroup.add(boxGroup);
          inst = { boxGroup, model: null, geoKey: null };
          instances[b.id] = inst;
        }
        if (inst.model) {
          inst.boxGroup.remove(inst.model.group);
          inst.model.dispose();
        }
        const model = buildBoxModel(b, SCALE);
        model.group.traverse((o) => {
          if (o.isMesh && !o.userData.restProxy) o.userData = { kind: "box", instanceId: b.id };
        });
        inst.boxGroup.add(model.group);
        inst.model = model;
        inst.geoKey = geoKey;
      });
    };
    t.syncBoxes = syncBoxes;

    // flat components (cards, tokens): each instance has its OWN geometry, since its
    // shape lives on the instance rather than on a shared library entry — rebuilt only
    // when its shapeKey changes. Its three materials (bottom / top / side, see
    // splitCapGroups in shapes2d.js) are re-textured by the appearance effect below.
    const allComponentsGroup = new THREE.Group();
    scene.add(allComponentsGroup);
    const componentInstancesTHREE = {};
    // a die-cut's outline is traced from its image, so a new image or trim re-cuts it
    const componentShapeKey = (c) =>
      [
        c.kind,
        c.w,
        c.d,
        c.thickness,
        c.cornerRadius,
        c.kind === "svg" ? c.svgText : "",
        c.kind === "alpha" ? `${imageKey(c.img)}:${JSON.stringify(c.transform)}` : "",
        c.kind === "die" ? c.dieStyle : "",
      ].join("|");
    const syncComponentInstances = (items) => {
      const idSet = new Set(items.map((p) => p.id));
      Object.keys(componentInstancesTHREE).forEach((key) => {
        if (idSet.has(Number(key))) return;
        const rec = componentInstancesTHREE[key];
        rec.mesh.geometry.dispose();
        rec.mats.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
        allComponentsGroup.remove(rec.group);
        delete componentInstancesTHREE[key];
      });
      items.forEach((c) => {
        const shapeKey = componentShapeKey(c);
        const rec = componentInstancesTHREE[c.id];
        if (!rec) {
          const mats = Array.from({ length: 3 }, () => makeFaceMaterial());
          const mesh = new THREE.Mesh(buildComponentGeometry(c, SCALE), mats);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData = { kind: "component", instanceId: c.id };
          const group = new THREE.Group();
          group.add(mesh);
          allComponentsGroup.add(group);
          componentInstancesTHREE[c.id] = { group, mesh, mats, shapeKey, appearanceKey: null };
          return;
        }
        if (rec.shapeKey !== shapeKey) {
          rec.mesh.geometry.dispose();
          rec.mesh.geometry = buildComponentGeometry(c, SCALE);
          rec.shapeKey = shapeKey;
        }
      });
    };
    t.syncComponentInstances = syncComponentInstances;

    t.scene = scene;
    t.camera = camera;
    t.renderer = renderer;
    // shared by every box's surface finish (see finish.js)
    t.envMap = makeEnvMap(renderer);
    t.embossMap = makeEmbossNormalMap();
    t.embossMap.anisotropy = t.maxAnisotropy || 1; // the weave stays crisp at grazing angles too
    t.allBoxesGroup = allBoxesGroup;
    t.instances = instances;
    t.ground = ground;
    t.allComponentsGroup = allComponentsGroup;
    t.componentInstancesTHREE = componentInstancesTHREE;
    // dev-only handle for inspecting the live scene from the console (stripped from
    // production builds by the import.meta.env.DEV check)
    if (import.meta.env.DEV) window.__pms = t;

    // keeps the shadow map's coverage tracking the current scene bounds. Always safe
    // to call automatically (including live during a drag) since — unlike the orbit
    // camera — it never moves anything the user is actually looking through; it only
    // adjusts an invisible shadow-casting frustum.
    t.updateShadowFit = () => {
      const fullBox = new THREE.Box3().setFromObject(allBoxesGroup);
      if (allComponentsGroup.children.length) fullBox.union(new THREE.Box3().setFromObject(allComponentsGroup));
      t.fullBox = fullBox;
      fitShadowToBox(t);
    };

    // the ONLY thing allowed to move the orbit camera's look-at point or zoom — never
    // automatic. Earlier this ran on every object add/move (nudging radius/recentering
    // on every change), which felt like the view drifting on its own even when the
    // user hadn't touched the camera; now it's exclusively wired to an explicit
    // "reset camera" button (see the viewport UI) so the camera only ever moves when
    // asked to.
    t.resetCameraView = () => {
      t.updateShadowFit();
      const fullBox = t.fullBox;
      if (!fullBox || fullBox.isEmpty()) return;
      t.center.set((fullBox.min.x + fullBox.max.x) / 2, (fullBox.min.y + fullBox.max.y) / 2, (fullBox.min.z + fullBox.max.z) / 2);
      t.pan.set(0, 0, 0);
      // the closest distance at which every corner of the scene's bounds is in frame,
      // from the current viewing angle (a bounding sphere, as before, framed loosely —
      // the scene filled about half the view)
      const cam = t.camera;
      const corners = [];
      [fullBox.min.x, fullBox.max.x].forEach((x) =>
        [fullBox.min.y, fullBox.max.y].forEach((y) => [fullBox.min.z, fullBox.max.z].forEach((z) => corners.push(new THREE.Vector3(x, y, z))))
      );
      const v = new THREE.Vector3();
      const fits = (r) => {
        cam.position.set(
          t.center.x + r * Math.sin(t.azimuth) * Math.cos(t.elevation),
          t.center.y + r * Math.sin(t.elevation) + 0.3,
          t.center.z + r * Math.cos(t.azimuth) * Math.cos(t.elevation)
        );
        cam.lookAt(t.center);
        cam.updateMatrixWorld();
        return corners.every((c) => {
          v.copy(c).project(cam);
          return v.z < 1 && Math.abs(v.x) <= 0.8 && Math.abs(v.y) <= 0.8;
        });
      };
      let lo = 0.4;
      let hi = 40;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) hi = mid;
        else lo = mid;
      }
      t.radius = hi;
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
      const targets = [...allBoxesGroup.children, ...allComponentsGroup.children];
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
    // library drag-and-drop: where a dropped template should go, in scene mm. Dropping
    // ONTO an object means "put it on that": use the x/z of the point actually hit on
    // the object's surface (the stacking resolver then lifts the new object onto it,
    // since new objects go on top of the layer order). Only a drop onto empty space
    // falls through to the floor — otherwise the ray would pass a box's top face and
    // land the new object on the ground behind it.
    t.dropPointAt = (clientX, clientY) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hit = raycaster
        .intersectObjects([...allBoxesGroup.children, ...allComponentsGroup.children], true)
        .find((h) => {
          if (h.object.userData.instanceId == null) return false;
          // skip hidden material groups (a sleeve's open ends, the tray's open top)
          const m = Array.isArray(h.object.material) ? h.object.material[h.face?.materialIndex ?? 0] : h.object.material;
          return m?.visible !== false;
        });
      const p = hit ? hit.point : groundPointAt(clientX, clientY);
      return p ? { x: p.x / SCALE, z: p.z / SCALE } : null;
    };

    const instancesRefByKind = { box: boxInstancesRef, component: componentInstancesRef };
    const setInstancesByKind = { box: setBoxInstances, component: setComponentInstances };
    const groupByKind = {
      box: (id) => t.instances[id]?.boxGroup,
      component: (id) => t.componentInstancesTHREE[id]?.group,
    };
    // projects a world position to viewport pixel coordinates — used to find where an
    // object's own center sits on screen, so right-drag-to-rotate can measure the angle
    // AROUND that point (like turning a dial) instead of just horizontal pixel distance.
    const projectToScreen = (worldPos) => {
      const ndc = worldPos.clone().project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return {
        x: rect.left + (ndc.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (1 - (ndc.y * 0.5 + 0.5)) * rect.height,
      };
    };

    const onPointerDown = (e) => {
      if (spacePressedRef.current) return; // space+drag pans the artboard instead — see the viewport-level handler
      t.canvasPointerActive = true;
      t.downX = e.clientX;
      t.downY = e.clientY;
      if (e.button === 1) {
        t.panning = true;
        e.preventDefault();
      } else if (e.button === 0 || e.button === 2) {
        const hit = pickInstanceAt(e.clientX, e.clientY);
        if (hit && e.button === 0 && (e.shiftKey || e.ctrlKey || e.metaKey)) {
          // Shift/Ctrl-click adds to (or removes from) the selection — no drag
          selectObject(hit.kind, hit.id, { toggle: true });
          return;
        }
        const keys = selectionKeysRef.current;
        if (hit && e.button === 0 && !e.altKey && keys.length > 1 && keys.includes(`${hit.kind}:${hit.id}`)) {
          // pressing on an object that's part of a multi-selection drags the whole set;
          // a click without dragging narrows the selection to it (see onPointerUp)
          const startGround = groundPointAt(e.clientX, e.clientY);
          if (startGround) {
            const members = keys
              .map((k) => {
                const [kind, id] = k.split(":");
                const o = instancesRefByKind[kind].current.find((x) => x.id === Number(id));
                return o ? { kind, id: o.id, startX: o.x, startZ: o.z } : null;
              })
              .filter(Boolean);
            t.objectDrag = { mode: "moveMany", members, click: hit, startGroundX: startGround.x, startGroundZ: startGround.z, moved: false };
          }
          t.lastX = e.clientX;
          t.lastY = e.clientY;
          return;
        }
        if (hit) {
          // select immediately on mousedown (standard editor behavior: mousedown
          // selects, a subsequent drag moves/rotates the now-selected object) — this
          // is what lets a single press-drag gesture both pick AND act on an
          // unselected object in one motion.
          selectObject(hit.kind, hit.id);
          const current = instancesRefByKind[hit.kind].current.find((o) => o.id === hit.id);
          if (e.button === 2) {
            // right-drag rotates around world-up (Y), measured as the angle swept
            // around the object's own on-screen center — suppress the native context
            // menu that would otherwise pop up on release; see onContextMenu below.
            t.suppressNextContextMenu = true;
            const group = groupByKind[hit.kind](hit.id);
            if (current && group) {
              const worldPos = new THREE.Vector3();
              group.getWorldPosition(worldPos);
              const centerScreen = projectToScreen(worldPos);
              const startAngle = Math.atan2(e.clientY - centerScreen.y, e.clientX - centerScreen.x);
              t.objectDrag = { mode: "rotate", kind: hit.kind, id: hit.id, centerScreen, startAngle, startRotY: current.rotY || 0, moved: false };
            }
          } else {
            const startGround = groundPointAt(e.clientX, e.clientY);
            if (current && startGround) {
              // Alt+drag duplicates in place first, then drags the copy — the
              // original stays where it was, matching the standard
              // Illustrator/Figma alt-drag-to-duplicate gesture. The duplicate is
              // spawned at the SAME x/z as the source (offset: false) rather than
              // the button's usual spaced-apart offset, so it doesn't visually
              // jump out from under the cursor on the very next pointermove.
              let dragKind = hit.kind;
              let dragId = hit.id;
              if (e.altKey) {
                const newId = duplicateFnsRef.current?.(hit.kind, hit.id, { offset: false });
                if (newId != null) dragId = newId;
              }
              t.objectDrag = {
                mode: "move",
                kind: dragKind,
                id: dragId,
                startX: current.x,
                startZ: current.z,
                startGroundX: startGround.x,
                startGroundZ: startGround.z,
                moved: false,
              };
            }
          }
        } else if (e.button === 0) {
          t.dragging = true;
          // a press on empty space: if it ends up a click rather than an orbit drag,
          // it deselects (see onPointerUp)
          t.emptyPress = { x: e.clientX, y: e.clientY };
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

      if (t.objectDrag?.mode === "rotate") {
        const d = t.objectDrag;
        const currentAngle = Math.atan2(e.clientY - d.centerScreen.y, e.clientX - d.centerScreen.x);
        // negated: screen Y grows downward while rotY's positive direction (right-hand
        // rule around world +Y, viewed from the camera looking down at the scene from
        // above) reads as clockwise-on-screen — without the flip, dragging clockwise
        // around the object visually spun it counter-clockwise.
        const deltaDeg = -((currentAngle - d.startAngle) * 180) / Math.PI;
        if (!d.moved && Math.abs(deltaDeg) > 2) d.moved = true;
        if (!d.moved) return;
        const nextRotY = ((d.startRotY + deltaDeg) % 360 + 360) % 360;
        setInstancesByKind[d.kind]((prev) => prev.map((o) => (o.id === d.id ? { ...o, rotY: nextRotY } : o)));
        return;
      }

      if (t.objectDrag?.mode === "moveMany") {
        const ground = groundPointAt(e.clientX, e.clientY);
        if (!ground) return;
        const d = t.objectDrag;
        const worldDX = ground.x - d.startGroundX;
        const worldDZ = ground.z - d.startGroundZ;
        if (!d.moved && Math.hypot(worldDX, worldDZ) * (1 / SCALE) > 1) d.moved = true;
        if (!d.moved) return;
        ["box", "component"].forEach((kind) =>
          setInstancesByKind[kind]((prev) =>
            prev.map((o) => {
              const m = d.members.find((x) => x.kind === kind && x.id === o.id);
              return m ? { ...o, x: m.startX + worldDX / SCALE, z: m.startZ + worldDZ / SCALE } : o;
            })
          )
        );
        return;
      }

      if (t.objectDrag?.mode === "move") {
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
    const onPointerUp = (e) => {
      // clicked on nothing (no drag): drop the selection, hiding its transform box
      if (t.emptyPress && Math.hypot(e.clientX - t.emptyPress.x, e.clientY - t.emptyPress.y) < 4) selectObject(null);
      t.emptyPress = null;
      if (t.objectDrag?.mode === "moveMany" && !t.objectDrag.moved) selectObject(t.objectDrag.click.kind, t.objectDrag.click.id);
      t.canvasPointerActive = false;
      t.dragging = false;
      t.panning = false;
      t.objectDrag = null;
    };
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) return; // ctrl/cmd+wheel zooms the artboard instead — see the viewport-level handler
      e.preventDefault();
      t.radius = Math.min(40, Math.max(0.4, t.radius * (1 + e.deltaY * 0.001)));
    };
    const onContextMenu = (e) => {
      if (t.panning || t.suppressNextContextMenu) {
        e.preventDefault();
        t.suppressNextContextMenu = false;
      }
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
      t.dof?.setSize(w, h);
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
      // frame the starting scene once the artboard has its final shape
      setTimeout(() => {
        if (!t.cameraRestored) t.resetCameraView?.();
      }, 50);
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

      // lid lift / tray slide — each box type's model knows its own moving part
      boxInstancesRef.current.forEach((data) => {
        instances[data.id]?.model?.animate(data);
      });

      const ds = t.dofSettings;
      if (ds?.enabled && t.dof) {
        t.dof.render({ focusPoint: ds.mode === "selection" ? t.focusPoint : null, focusDistance: ds.distanceMm * SCALE, strength: ds.strength });
      } else {
        renderer.render(scene, camera);
      }
      t.onFrame?.(); // the transform box's overlay follows the camera
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

  // ---- sync every object's meshes to state, then place each one per its own
  // position/rotation/tilt/orientation/floatHeight/layer/groundSnap. One effect across
  // both kinds because the stacking resolver needs every footprint at once to know
  // what rests on what (and shadow fitting needs the whole scene's bounds).
  //
  // Two passes:
  //  1. Set quaternion + XZ position (Y left at 0) for every object, and record a
  //     `place(floorY)` closure per object — XZ footprint doesn't depend on Y, so it's
  //     safe to measure before Y is known.
  //  2. Hand every object to resolveStacking (stacking.js), which walks layers
  //     bottom-to-top and tells each grounded object what Y to rest on (0, or the top
  //     of whatever lower-layer object it overlaps). ----
  useEffect(() => {
    const t = three.current;
    if (!t.allBoxesGroup) return;

    t.syncBoxes?.(boxInstances);
    t.syncComponentInstances?.(componentInstances);

    const stackItems = [];

    boxInstances.forEach((data) => {
      const inst = t.instances[data.id];
      if (!inst?.model) return;
      // apply the lid/tray pose now rather than waiting for the next animation frame,
      // so everything measured below (and an export taken right after) sees it
      inst.model.animate(data);
      // a type can bring its own base pose (a standing スリーブ box turns so its tray
      // pulls upward); yaw/tilt still apply on top of it, around world axes
      const base = boxBaseRotation(data);
      inst.boxGroup.quaternion.copy(composePlacementQuaternion(base ? { ...data, orientation: "lying" } : data));
      if (base) inst.boxGroup.quaternion.multiply(base);
      inst.boxGroup.position.set(data.x * SCALE, 0, data.z * SCALE);
      inst.boxGroup.updateMatrixWorld(true);

      const footprint = measureXZFootprint(inst.boxGroup);
      stackItems.push({
        id: `box:${data.id}`,
        layer: data.layer ?? 0,
        groundSnap: data.groundSnap !== false,
        ...footprint,
        // rests on its body/shell (model.measureObj), not the whole group — an opened
        // lid or pulled-out tray shouldn't change how low the box itself sits
        place: (floorY) => {
          const y =
            data.groundSnap === false
              ? data.floatHeight * SCALE
              : groundSnapY(inst.boxGroup, data.floatHeight || 0, SCALE, { floorY, measureObj: inst.model.measureObj });
          inst.boxGroup.position.y = y;
          inst.boxGroup.updateMatrixWorld(true);
          return { y, topY: new THREE.Box3().setFromObject(inst.boxGroup).max.y };
        },
      });
    });

    componentInstances.forEach((data) => {
      const rec = t.componentInstancesTHREE[data.id];
      if (!rec) return;
      rec.group.quaternion.copy(composePlacementQuaternion(data));
      rec.group.position.set(data.x * SCALE, 0, data.z * SCALE);
      rec.group.updateMatrixWorld(true);

      const footprint = measureXZFootprint(rec.group);
      stackItems.push({
        id: `component:${data.id}`,
        layer: data.layer ?? 0,
        groundSnap: data.groundSnap !== false,
        ...footprint,
        place: (floorY) => {
          const y = data.groundSnap === false ? data.floatHeight * SCALE : groundSnapY(rec.group, data.floatHeight || 0, SCALE, { floorY });
          rec.group.position.y = y;
          rec.group.updateMatrixWorld(true);
          return { y, topY: new THREE.Box3().setFromObject(rec.group).max.y };
        },
      });
    });

    resolveStacking(stackItems);

    // shadow coverage tracks the scene automatically; the orbit camera itself does
    // not — see t.resetCameraView.
    t.updateShadowFit?.();

    // The selected object's transform box (TransformGizmo draws and drives it): its
    // bounds measured in its OWN yaw frame — so the box turns with the object instead of
    // being world-axis-aligned — plus which size field each of the three axes is. The
    // blue ring it replaces is kept hidden.
    if (t.selectionMarker) t.selectionMarker.visible = false;
    t.gizmo = null;
    const selData =
      activeSelection?.kind === "box"
        ? boxInstances.find((b) => b.id === activeSelection.id)
        : activeSelection?.kind === "component"
          ? componentInstances.find((c) => c.id === activeSelection.id)
          : null;
    const selGroup =
      activeSelection?.kind === "box"
        ? t.instances[activeSelection.id]?.boxGroup
        : activeSelection?.kind === "component"
          ? t.componentInstancesTHREE[activeSelection.id]?.group
          : null;
    // where depth of field focuses in "selection" mode: the last thing selected. It
    // stays on it after a click on empty space deselects — dropping back to the scene's
    // centre then made the focus jump every time the selection was cleared
    {
      if (selectionKeys.length) lastFocusKeysRef.current = selectionKeys;
      const focusKeys = selectionKeys.length ? selectionKeys : lastFocusKeysRef.current.filter(objectExists);
      const fb = new THREE.Box3();
      focusKeys.forEach((k) => {
        const { kind, id } = parseKey(k);
        const grp = kind === "box" ? t.instances[id]?.boxGroup : t.componentInstancesTHREE[id]?.group;
        if (grp) fb.union(new THREE.Box3().setFromObject(grp));
      });
      const src = !fb.isEmpty() ? fb : t.fullBox && !t.fullBox.isEmpty() ? t.fullBox : null;
      t.focusPoint = src ? src.getCenter(new THREE.Vector3()) : null;
    }
    if (selectionKeys.length > 1) {
      // several objects: one world-aligned box around all of them
      const bb = new THREE.Box3();
      let count = 0;
      selectionKeys.forEach((k) => {
        const { kind, id } = parseKey(k);
        const grp = kind === "box" ? t.instances[id]?.boxGroup : t.componentInstancesTHREE[id]?.group;
        if (!grp) return;
        bb.union(new THREE.Box3().setFromObject(grp));
        count++;
      });
      if (count > 1 && !bb.isEmpty()) {
        t.gizmo = { group: true, count, yaw: 0, P: [0, 0], x0: bb.min.x, x1: bb.max.x, z0: bb.min.z, z1: bb.max.z, y0: bb.min.y, y1: bb.max.y, fieldFor: {}, uniformOnly: true };
      }
    } else if (selData && selGroup) {
      const yaw = ((selData.rotY || 0) * Math.PI) / 180;
      const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const q = selGroup.quaternion.clone();
      const qNoYaw = qYaw.clone().invert().multiply(q);
      selGroup.quaternion.copy(qNoYaw);
      selGroup.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(selGroup);
      selGroup.quaternion.copy(q);
      selGroup.updateMatrixWorld(true);
      // model axes: x = W, y = H (box) / thickness (piece), z = D. After the pose (no
      // yaw), each lands on some world axis — that's the field that axis edits.
      const isBox = activeSelection.kind === "box";
      const local = [
        ["w", new THREE.Vector3(1, 0, 0)],
        [isBox ? "h" : "thickness", new THREE.Vector3(0, 1, 0)],
        ["d", new THREE.Vector3(0, 0, 1)],
      ];
      const fieldFor = {};
      local.forEach(([field, v]) => {
        v.applyQuaternion(qNoYaw);
        const ax = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
        fieldFor["xyz"[ax.indexOf(Math.max(...ax))]] = field;
      });
      const px = selGroup.position.x;
      const pz = selGroup.position.z;
      t.gizmo = {
        kind: activeSelection.kind,
        id: activeSelection.id,
        yaw,
        P: [px, pz],
        // bounds relative to the object's origin, in its yaw frame (world units)
        x0: bb.min.x - px,
        x1: bb.max.x - px,
        z0: bb.min.z - pz,
        z1: bb.max.z - pz,
        y0: bb.min.y,
        y1: bb.max.y,
        fieldFor,
        uniformOnly: selData.kind === "die", // a die is a cube: one size
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxInstances, activeSelection, componentInstances, selectedKeys]);

  // ---- each component instance's OWN materials: top face = its image, cover-fit via
  // UV repeat/offset so it never distorts; bottom + sides = its tint color. Re-baked
  // only when that instance's appearance actually changes (appearanceKey), not on every
  // move — dragging a card around shouldn't re-encode its texture every frame. ----
  useEffect(() => {
    const t = three.current;
    if (!t.componentInstancesTHREE) return;
    componentInstances.forEach((inst) => {
      const rec = t.componentInstancesTHREE[inst.id];
      if (!rec) return;
      const appearanceKey = [imageKey(inst.img), JSON.stringify(inst.transform), inst.color, inst.w, inst.d, inst.kind, inst.pipColor, JSON.stringify(colorCorrection)].join("|");
      if (rec.appearanceKey === appearanceKey) return;
      rec.appearanceKey = appearanceKey;

      // dice: plain colors — pips in slot 0, body in slot 2 (see dice.js)
      if (inst.kind === "die") {
        rec.mats.forEach((m, i) => {
          if (m.map) m.map.dispose();
          m.map = null;
          setSrgb(m.color, i === 0 ? inst.pipColor || "#1c1a17" : inst.color || COMPONENT_DEFAULTS.color);
          m.needsUpdate = true;
        });
        return;
      }

      const faceAspect = inst.w / inst.d;
      const canvas = applyColorCorrection(buildComponentFaceCanvas(inst), colorCorrection);
      const tex = new THREE.CanvasTexture(canvas);
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = t.maxAnisotropy || 1;
      // aspect of the canvas actually uploaded — the CROPPED image, not the original
      // file; using the original's aspect made every crop shift the art instead of
      // reframing it
      const texAspect = canvas.width / canvas.height;
      // a die-cut's outline was traced from this exact picture and stretches with W×D
      // just as the picture does, so it maps 1:1; cover-cropping it would pull the art
      // off its own cut
      const { repeat, offset } = inst.kind === "alpha" ? { repeat: [1, 1], offset: [0, 0] } : coverFitRepeatOffset(texAspect, faceAspect);
      tex.repeat.set(repeat[0], repeat[1]);
      tex.offset.set(offset[0], offset[1]);
      tex.needsUpdate = true;

      const bodyColor = srgb(inst.color || COMPONENT_DEFAULTS.color);
      rec.mats.forEach((m, i) => {
        if (m.map) m.map.dispose();
        if (i === 1) {
          // top cap (0=bottom, 1=top, 2=side — see splitCapGroups in shapes2d.js)
          m.map = tex;
          m.color.set(0xffffff);
        } else {
          m.map = null;
          m.color.copy(bodyColor);
        }
        m.needsUpdate = true;
      });
    });
  }, [componentInstances, colorCorrection]);

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
    // stored as an OFFSET (light position relative to its target), not a fixed world
    // position — fitShadowToBox re-applies this same offset around wherever the
    // scene's bounding box currently is, so moving/dragging an object (which shifts
    // that bounding box) can't change the light's actual DIRECTION, only where its
    // target re-centers. Anchoring position to a fixed world point instead would let
    // direction drift as soon as the target (which does need to track content, for
    // shadow coverage) moved away from that point — same bug class as the camera
    // fix above, just for the light instead of the viewer.
    t.lightOffset = new THREE.Vector3(
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
    // with the key/fill/rim above, a face lit from above sums to ≈1.0 — its artwork
    // colour — instead of the old ≈2.2× that washed every print out toward white
    const baseAmbient = bgMode === "dark" ? 0.26 : 0.42;
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
      t.ground.material = new THREE.MeshStandardMaterial({ color: srgb(0x1a1917), roughness: 1 });
    } else {
      // "white", or "image" mode before an image has been provided
      t.scene.background = new THREE.Color(0xf6f5f2);
      t.ground.material = new THREE.ShadowMaterial({ opacity: 0.22 });
    }
    if (t.ambient) t.ambient.intensity = baseAmbient * ambientBoost;
  }, [bgMode, bgImage, ambientBoost]);

  // ---- depth of field: the post-process is built the first time it's switched on ----
  useEffect(() => {
    const t = three.current;
    if (!t.renderer) return;
    t.dofSettings = { enabled: dofEnabled, mode: dofFocusMode, distanceMm: dofDistance, strength: dofStrength };
    if (dofEnabled && !t.dof) {
      t.dof = createDof(t.renderer, t.scene, t.camera);
      const size = t.renderer.getSize(new THREE.Vector2());
      t.dof.setSize(size.x, size.y);
    }
  }, [dofEnabled, dofFocusMode, dofDistance, dofStrength]);

  // ---- exposure: a uniform, so it applies on the next frame without recompiling ----
  useEffect(() => {
    const t = three.current;
    if (!t.renderer) return;
    t.renderer.toneMappingExposure = exposure;
  }, [exposure]);

  // ---- the selected box's net previews in the inspector: drawn against that box's
  // own type and dimensions, over its own uploaded sheets. UI-only canvases,
  // independent of the 3D textures below. The canvases mount and unmount with the
  // inspector (tab switches, selecting another box, a type change adding/removing
  // slots), so each mount bumps guideMountTick to trigger a redraw into it. ----
  const [guideMountTick, setGuideMountTick] = useState(0);
  const guideCanvasRef = (slotKey) => (el) => {
    if (!el || guideCanvasRefs.current[slotKey] === el) return;
    guideCanvasRefs.current[slotKey] = el;
    setGuideMountTick((n) => n + 1);
  };
  const selectedBoxNetsKey = selectedBox
    ? [
        selectedBox.id,
        boxGeometryKey(selectedBox),
        ...Object.entries(selectedBox.nets || {}).map(([k, v]) => `${k}:${imageKey(v?.img)}:${JSON.stringify(v?.transform)}:${JSON.stringify(v?.faceLayout)}`),
      ].join("|")
    : "";
  useEffect(() => {
    if (!selectedBox) return;
    boxNetSlots(selectedBox).forEach((slot) => {
      const canvas = guideCanvasRefs.current[slot.key];
      if (!canvas || !canvas.isConnected) return;
      const net = selectedBox.nets?.[slot.key];
      if (net?.img) {
        // the user's own sheet, with where each face currently sits on it
        const display = displayImage(net);
        drawLayoutPreview(canvas, display, faceRects(slot, net, imgW(display), imgH(display)), guideColor);
      } else {
        // no sheet yet: the template, so it's clear which faces this box type needs
        drawNetGuide(canvas, rawSpaceLayout(slot.layout, slot.orient), null, DEFAULT_CROP, guideColor, { maxPx: 480 });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBoxNetsKey, guideColor, guideMountTick]);

  // ---- slice each box's own net sheets against its own type/dims and texture its
  // model's faces. Every box is covered every pass, but a per-model texKey skips the
  // expensive reslice unless that box's texture inputs changed — dragging one box
  // doesn't re-slice the others. A rebuilt model (new type/dims) starts with no
  // texKey, so it always gets textured. ----
  useEffect(() => {
    const t = three.current;
    if (!t.instances) return;
    boxInstances.forEach((box) => {
      const model = t.instances[box.id]?.model;
      if (!model) return;
      const slots = boxNetSlots(box);
      const texKey = JSON.stringify({
        g: boxGeometryKey(box),
        nets: slots.map((s) => {
          const n = box.nets?.[s.key];
          return [s.key, imageKey(n?.img), n?.transform, n?.faceLayout];
        }),
        colorCorrection,
      });
      if (model.texKey === texKey) return;
      model.texKey = texKey;

      const canvasByKey = {};
      slots.forEach((slot) => {
        const net = box.nets?.[slot.key];
        if (!net?.img) return;
        // each face is cut from wherever its rectangle sits on the sheet (see
        // netLayout.js) — not from a fixed template position
        const display = displayImage(net);
        const rects = faceRects(slot, net, imgW(display), imgH(display));
        slot.layout.regions.forEach((r) => {
          if (r.face === false || !rects[r.key]) return;
          canvasByKey[r.key] = sliceFace(display, rects[r.key], slot.orient, r.rotate);
        });
      });
      Object.assign(canvasByKey, composeFaceCanvases(box, canvasByKey));

      Object.entries(model.faces).forEach(([key, { mat, transform }]) => {
        if (mat.map) mat.map.dispose();
        const sliced = canvasByKey[key];
        if (sliced) {
          const tex = new THREE.CanvasTexture(applyColorCorrection(applyFaceTransform(sliced, transform), colorCorrection));
          tex.anisotropy = t.maxAnisotropy || 1;
          tex.encoding = THREE.sRGBEncoding;
          tex.needsUpdate = true;
          mat.map = tex;
          mat.color.set(0xffffff);
        } else {
          mat.map = null;
          setSrgb(mat.color, mat.userData.baseColor);
        }
        mat.needsUpdate = true;
      });
    });
  }, [boxInstances, colorCorrection]);

  // ---- each box's surface finish on its printed faces. Kept apart from the texture
  // effect: changing the finish never needs a re-slice, and a rebuilt model (new type or
  // size) starts without a finishKey, so it always gets one. ----
  useEffect(() => {
    const t = three.current;
    if (!t.instances || !t.envMap) return;
    boxInstances.forEach((box) => {
      const model = t.instances[box.id]?.model;
      if (!model) return;
      const finish = box.finish || "matte";
      if (model.finishKey === finish) return;
      model.finishKey = finish;
      Object.values(model.faces).forEach(({ mat }) => applyFinish(mat, finish, { envMap: t.envMap, embossMap: t.embossMap }));
    });
  }, [boxInstances]);

  // ---- object editing ----
  const updateBox = (id, patch) =>
    setBoxInstances((prev) => prev.map((b) => (b.id === id ? { ...b, ...(typeof patch === "function" ? patch(b) : patch) } : b)));
  const updateComponentInstance = (id, patch) =>
    setComponentInstances((prev) => prev.map((c) => (c.id === id ? { ...c, ...(typeof patch === "function" ? patch(c) : patch) } : c)));

  // Reads a picked file as an image. Resets the input afterwards: a file input only
  // fires onChange when its value CHANGES, so without this, picking the same file
  // again (say, after clearing it) silently did nothing.
  const readImageFile = (e, onImage) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => onImage(img, file.name);
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const setBoxNet = (boxId, slotKey, patchOrFn) =>
    updateBox(boxId, (b) => {
      const current = b.nets?.[slotKey] || { img: null, fileName: "", transform: DEFAULT_CROP };
      const patch = typeof patchOrFn === "function" ? patchOrFn(current) : patchOrFn;
      return { nets: { ...(b.nets || {}), [slotKey]: { ...current, ...patch } } };
    });

  // everything the inspector's net slot UI can do to one sheet of one box. A re-upload
  // keeps the face layout: revised print files usually keep their arrangement, so the
  // same rectangles still line up (it's stored relative to the image's size).
  const [layoutEditor, setLayoutEditor] = useState(null); // { boxId, slotKey }
  const netSlotActions = (box, slot) => {
    const net = box.nets?.[slot.key];
    return {
      net,
      onFile: (e) => readImageFile(e, (img, fileName) => setBoxNet(box.id, slot.key, { img, fileName })),
      onPaste: makePasteHandler((img) => setBoxNet(box.id, slot.key, { img, fileName: "(クリップボードから貼り付け)" })),
      onClear: () => setBoxNet(box.id, slot.key, { img: null, fileName: "", transform: DEFAULT_CROP, faceLayout: null }),
      onOpenLayout: () => net?.img && setLayoutEditor({ boxId: box.id, slotKey: slot.key }),
      // a quarter turn of the sheet carries the placed faces round with it
      onRotate: () =>
        setBoxNet(box.id, slot.key, (cur) => {
          const display = displayImage(cur);
          const layout = cur.faceLayout || defaultFaceLayout(slot, cur, imgW(display), imgH(display));
          return {
            transform: { ...(cur.transform || DEFAULT_CROP), rotate: ((cur.transform?.rotate || 0) + 90) % 360 },
            faceLayout: rotateLayoutCW(layout, imgW(display), imgH(display)),
          };
        }),
    };
  };

  const handleBgImageFile = (e) =>
    readImageFile(e, (img) => {
      setBgImage(img);
      setBgMode("image");
    });
  const handleBgImagePaste = makePasteHandler((img) => {
    setBgImage(img);
    setBgMode("image");
  });

  const exportRender = () => {
    const t = three.current;
    if (!t.renderer) return;
    setExporting(true);
    // deferred only so React can paint the "書き出し中…" state before the synchronous
    // render+encode blocks the main thread. Uses a timeout rather than
    // requestAnimationFrame because rAF is suspended entirely while the tab is hidden —
    // which left the export never running and the button stuck disabled at "書き出し中…"
    // with no way to recover. The export does its own explicit renderer.render(), so it
    // has no reason to be tied to a display frame anyway.
    setTimeout(() => {
      const container = mountRef.current;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const scaleFactor = exportScale;

      const prevBackground = t.scene.background;
      const prevClearColor = new THREE.Color();
      t.renderer.getClearColor(prevClearColor);
      const prevClearAlpha = t.renderer.getClearAlpha();
      const prevGroundVisible = t.ground.visible;
      // the selection ring is an editor affordance, not part of the mockup — always
      // hide it for the render regardless of transparent/opaque export mode
      const prevMarkerVisible = t.selectionMarker?.visible ?? false;
      if (t.selectionMarker) t.selectionMarker.visible = false;

      if (transparentExport) {
        t.scene.background = null;
        t.ground.visible = false;
        t.renderer.setClearColor(0x000000, 0);
      }

      const prevPixelRatio = t.renderer.getPixelRatio();
      t.renderer.setPixelRatio(1); // the export's size is cw/ch × its own scale, nothing else
      t.dof?.composer.setPixelRatio(1);
      t.renderer.setSize(Math.round(cw * scaleFactor), Math.round(ch * scaleFactor), false);
      t.camera.aspect = cw / ch;
      t.camera.updateProjectionMatrix();
      // depth of field goes into the export too — except a transparent one, where the
      // blur would smear the subject's edges into the see-through background
      const ds = t.dofSettings;
      const withDof = ds?.enabled && t.dof && !transparentExport;
      if (withDof) {
        t.dof.setSize(Math.round(cw * scaleFactor), Math.round(ch * scaleFactor));
        t.dof.render({ focusPoint: ds.mode === "selection" ? t.focusPoint : null, focusDistance: ds.distanceMm * SCALE, strength: ds.strength });
      } else {
        t.renderer.render(t.scene, t.camera);
      }

      // draw into a plain 2D canvas first — needed either way to read pixels back out
      // for the transparent-export trim, and just as valid a toDataURL source otherwise
      let outCanvas = document.createElement("canvas");
      outCanvas.width = t.renderer.domElement.width;
      outCanvas.height = t.renderer.domElement.height;
      outCanvas.getContext("2d").drawImage(t.renderer.domElement, 0, 0);
      if (transparentExport && fitToContent) outCanvas = trimTransparentCanvas(outCanvas);
      const url = outCanvas.toDataURL("image/png");
      t.renderer.setPixelRatio(prevPixelRatio);
      t.dof?.composer.setPixelRatio(prevPixelRatio);
      t.renderer.setSize(cw, ch, false);
      t.dof?.setSize(cw, ch);

      if (transparentExport) {
        t.scene.background = prevBackground;
        t.ground.visible = prevGroundVisible;
        t.renderer.setClearColor(prevClearColor, prevClearAlpha);
      }
      if (t.selectionMarker) t.selectionMarker.visible = prevMarkerVisible;

      const a = document.createElement("a");
      a.href = url;
      a.download = transparentExport ? "package-mockup-transparent.png" : "package-mockup.png";
      a.click();
      setExporting(false);
    }, 0);
  };

  // The selected box's print sheets: previews side by side (they're what you compare),
  // every canvas kept mounted so the guide renderer can draw into all of them, and one
  // action bar acting on whichever sheet is selected. Which sheets exist depends on the
  // box type (see boxNetSlots), so a remembered slot that the current type doesn't have
  // falls back to its first sheet.
  const [netSlotKey, setNetSlotKey] = useState(null);
  const renderNetSlots = (box) => {
    const slots = boxNetSlots(box);
    const active = slots.find((s) => s.key === netSlotKey) || slots[0];
    const act = netSlotActions(box, active);
    const tf = act.net?.transform || DEFAULT_CROP;
    const hasImg = !!act.net?.img;
    return (
      <>
        <div className="flex gap-1.5">
          {slots.map((slot) => {
            const isActive = slot.key === active.key;
            return (
              <button
                key={slot.key}
                onClick={() => setNetSlotKey(slot.key)}
                title={slot.label}
                className="flex-1 min-w-0 rounded p-1"
                style={{
                  background: "var(--bg-surface-1)",
                  border: isActive ? "1px solid var(--highlight)" : "1px solid var(--border)",
                  cursor: "pointer",
                }}
              >
                <canvas
                  ref={guideCanvasRef(slot.key)}
                  style={{ width: "100%", height: "54px", objectFit: "contain", display: "block", background: "var(--bg-well)", borderRadius: "3px" }}
                />
                <div
                  className="truncate"
                  style={{ fontSize: "10px", marginTop: "3px", color: isActive ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: isActive ? 600 : 400 }}
                >
                  {slot.label}
                  {box.nets?.[slot.key]?.img ? "" : " ·"}
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-primary)" }}>{active.label}</span>
            {act.net?.fileName && (
              <span className="flex-1 truncate text-right" style={{ ...sectionMeta, direction: "rtl" }}>
                {act.net.fileName}
              </span>
            )}
          </div>
          <div className="flex gap-1.5">
            <label className="ui-btn flex-1 block text-center cursor-pointer" style={hasImg ? buttonStyle("quiet") : buttonStyle("primary")}>
              アップロード
              <input type="file" accept="image/*" onChange={act.onFile} className="hidden" />
            </label>
            <button onClick={act.onPaste} className="flex-1" style={buttonStyle("quiet")}>
              貼り付け
            </button>
          </div>
          {hasImg ? (
            <div className="flex gap-1.5">
              <button onClick={act.onOpenLayout} className="flex-1" style={buttonStyle("quiet", { active: !!act.net?.faceLayout })}>
                面の配置を編集
              </button>
              <button
                onClick={act.onRotate}
                title="画像を90°回転"
                style={{ ...buttonStyle("quiet"), width: "36px", flexShrink: 0 }}
              >
                ↻{tf.rotate ? tf.rotate : ""}
              </button>
              <button onClick={act.onClear} title="画像を削除" style={{ ...buttonStyle("danger"), width: "28px", flexShrink: 0 }}>
                ×
              </button>
            </div>
          ) : (
            <p style={helpText}>展開図の画像を入れたら「面の配置を編集」で各面の位置を合わせます。並び方は自由です。</p>
          )}
        </div>
      </>
    );
  };

  const exportOutW = Math.round(artboardW * exportScale);
  const exportOutH = Math.round(artboardH * exportScale);
  const exportSettingsDialog = exportSettingsOpen && (
    <ModalBackdrop onDismiss={() => setExportSettingsOpen(false)}>
      <div className="rounded-lg p-4" style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border)", width: "340px" }}>
        <div className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
          書き出し設定
        </div>

        <div className="mb-2" style={sectionTitle}>
          解像度(プレビューに対する倍率)
        </div>
        <ScrubField label="倍率" value={exportScale} onChange={setExportScale} min={0.5} max={8} step={0.5} decimals={1} unit="×" />
        <p className="text-xs mt-2 mb-4" style={{ color: "var(--text-muted)" }}>
          出力サイズ: {exportOutW} × {exportOutH} px(プレビュー {artboardW} × {artboardH} px の{exportScale}倍)
        </p>

        <div className="mb-2">
          <ToggleSwitch checked={transparentExport} onChange={setTransparentExportGated} label="背景を透過にして書き出す" />
        </div>
        <div className="mb-4 ml-5">
          <ToggleSwitch
            checked={fitToContent}
            disabled={!transparentExport}
            onChange={setFitToContent}
            label="画像サイズをコンポーネントに合わせる(余白をトリミング)"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setExportSettingsOpen(false)}
            className="flex-1 text-sm rounded py-2"
            style={{ background: "var(--border)", color: "var(--text-primary)" }}
          >
            閉じる
          </button>
          <button
            onClick={() => {
              exportRender();
              setExportSettingsOpen(false);
            }}
            disabled={exporting}
            className="flex-1 text-sm rounded py-2"
            style={{ background: "var(--accent)", color: "#1c1a17", fontWeight: 600 }}
          >
            {exporting ? "書き出し中…" : "書き出す"}
          </button>
        </div>
      </div>
    </ModalBackdrop>
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
    // the inspector sits to the RIGHT of this handle, so dragging the handle left
    // (negative dx) has to GROW it — hence minus, not plus. With plus the panel moved
    // opposite to the drag, which is what made resizing feel inverted.
    const dx = e.clientX - sidebarDragRef.current.startX;
    setSidebarWidth(Math.max(240, Math.min(640, sidebarDragRef.current.startWidth - dx)));
  };
  const onSidebarHandleUp = () => {
    sidebarDragRef.current = null;
  };

  // artboard navigation, After-Effects-preview-style: Space+drag anywhere pans the
  // artboard, and middle-click-drag pans it too but ONLY when it starts outside the
  // artboard itself — middle-click-drag ON the box keeps panning the 3D camera exactly
  // as before (that handler lives on the canvas and is untouched).
  const onViewportPointerDown = (e) => {
    // a plain click on the grey area around the artboard deselects too
    if (e.button === 0 && e.target === e.currentTarget && !spacePressedRef.current) selectObject(null);
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

  // ---- the selected box's fields, for the inspector ----
  const displayValue = (key) => selectedBox?.[key];
  // which of 幅/奥行/高さ have their ratio locked (the chain toggles) — a UI setting,
  // shared by the inspector and the net layout editor
  const [linkedDims, setLinkedDims] = useState(() => new Set());
  const toggleLinkedDim = (key) =>
    setLinkedDims((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const boxDimFields = (box) =>
    box.boxType === "sleeve"
      ? [
          { key: "w", label: "長さ(引き出す向き)", max: 500 },
          { key: "d", label: "幅", max: 500 },
          { key: "h", label: "厚み", max: 500 },
        ]
      : [
          { key: "w", label: "幅 W", max: 500 },
          { key: "d", label: "奥行 D", max: 500 },
          { key: "h", label: "高さ H", max: 500 },
        ];
  const setParamValue = (key, value) => {
    if (selectedBox) updateBox(selectedBox.id, { [key]: value });
  };
  const instanceNumField = (label, key, min = -2000, max = 2000, unit, extra) => (
    <ScrubField label={label} value={displayValue(key) ?? 0} onChange={(v) => setParamValue(key, v)} min={min} max={max} unit={unit} {...extra} />
  );

  // ---- layers ----
  // Commits a change that can touch both object lists at once, renumbering every
  // layer densely (0..n-1, bottom to top) in the resulting stack order. Callers express
  // "put this between those two" with a fractional layer (e.g. source + 0.5) and let
  // this settle it into a clean order.
  const commitObjects = (nextBoxes, nextComponents) => {
    const rank = new Map(stackOrder(nextBoxes, nextComponents).map((o, i) => [`${o.kind}:${o.id}`, i]));
    const relayer = (kind) => (o) => {
      const layer = rank.get(`${kind}:${o.id}`);
      return o.layer === layer ? o : { ...o, layer };
    };
    setBoxInstances(nextBoxes.map(relayer("box")));
    setComponentInstances(nextComponents.map(relayer("component")));
  };
  const topLayer = () => Math.max(-1, ...boxInstances.map((b) => b.layer ?? 0), ...componentInstances.map((c) => c.layer ?? 0));

  // Ctrl+] / Ctrl+[ : one step up / down. With Shift: all the way to the top / bottom.
  // Same convention as Illustrator/Photoshop/Figma's arrange commands.
  const moveSelectedLayer = (dir, toEnd) => {
    if (!activeSelection) return;
    const order = stackOrder(boxInstances, componentInstances);
    const idx = order.findIndex((o) => o.kind === activeSelection.kind && o.id === activeSelection.id);
    if (idx < 0) return;
    const target = toEnd ? (dir > 0 ? order.length - 1 : 0) : Math.max(0, Math.min(order.length - 1, idx + dir));
    if (target === idx) return;
    const [moved] = order.splice(idx, 1);
    order.splice(target, 0, moved);
    const rank = new Map(order.map((o, i) => [`${o.kind}:${o.id}`, i]));
    setBoxInstances((prev) => prev.map((b) => ({ ...b, layer: rank.get(`box:${b.id}`) ?? b.layer })));
    setComponentInstances((prev) => prev.map((c) => ({ ...c, layer: rank.get(`component:${c.id}`) ?? c.layer })));
  };

  // ---- placing, duplicating, removing, replacing ----
  // A clicked-in object goes on an EMPTY patch of floor (so it never lands on, and
  // stacks onto, something by accident — dropping onto the viewport is how you put it
  // somewhere specific) that is INSIDE the current view. It used to go just right of
  // everything, which the camera doesn't follow, so new objects often appeared outside
  // the export frame. Candidates spiral out from the floor point at the centre of the
  // view; the first one clear of every object whose whole footprint is on screen wins.
  // Only when the view has no room left does it fall back to "right of everything",
  // and then the camera is reset so the new object is still in frame.
  const nextFreeSpot = (item, fields) => {
    const t = three.current;
    if (boxInstances.length + componentInstances.length === 0) return { x: 0, z: 0 };
    const radius = Math.max(fields.w || 0, fields.d || 0) / 2; // any rotation fits inside
    // how tall it will stand: a sleeve box stands on end (see boxBaseRotation), a card
    // set upright stands on its long edge; anything else is its own height
    const heightMm =
      item.objKind === "box"
        ? fields.boxType === "sleeve"
          ? Math.max(fields.w, fields.d, fields.h)
          : (fields.h || 0) * 1.1
        : fields.orientation === "standing"
          ? Math.max(fields.w || 0, fields.d || 0)
          : fields.thickness || 0;
    const MARGIN = 8;
    const obstacles = [
      ...boxInstances.map((b) => t.instances?.[b.id]?.boxGroup),
      ...componentInstances.map((c) => t.componentInstancesTHREE?.[c.id]?.group),
    ]
      .filter(Boolean)
      .map((g) => new THREE.Box3().setFromObject(g))
      .filter((b) => !b.isEmpty())
      .map((b) => ({ x0: b.min.x / SCALE, x1: b.max.x / SCALE, z0: b.min.z / SCALE, z1: b.max.z / SCALE }));
    const clear = (x, z) => obstacles.every((o) => x + radius + MARGIN <= o.x0 || x - radius - MARGIN >= o.x1 || z + radius + MARGIN <= o.z0 || z - radius - MARGIN >= o.z1);

    const cam = t.camera;
    let center = null;
    if (cam) {
      cam.updateMatrixWorld();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(0, 0), cam);
      const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
      if (hit) center = { x: hit.x / SCALE, z: hit.z / SCALE };
    }
    const v = new THREE.Vector3();
    const onScreen = (x, z) =>
      [-1, 1].every((sx) =>
        [-1, 1].every((sz) =>
          [0, heightMm].every((y) => {
            v.set((x + sx * radius) * SCALE, y * SCALE, (z + sz * radius) * SCALE).project(cam);
            return Math.abs(v.x) <= 0.92 && Math.abs(v.y) <= 0.92 && v.z < 1;
          })
        )
      );
    if (center) {
      const step = Math.max(10, radius);
      for (let ring = 0; ring <= 12; ring++) {
        const cands = [];
        for (let i = -ring; i <= ring; i++)
          for (let j = -ring; j <= ring; j++) if (Math.max(Math.abs(i), Math.abs(j)) === ring) cands.push({ x: center.x + i * step, z: center.z + j * step });
        cands.sort((a, b) => Math.hypot(a.x - center.x, a.z - center.z) - Math.hypot(b.x - center.x, b.z - center.z));
        const found = cands.find((c) => clear(c.x, c.z) && onScreen(c.x, c.z));
        if (found) return { x: Math.round(found.x), z: Math.round(found.z) };
      }
    }
    // no room in view: beside everything, then bring it into frame
    setTimeout(() => three.current.resetCameraView?.(), 60);
    const box = t.fullBox;
    if (!box || box.isEmpty()) return { x: 0, z: 0 };
    return { x: Math.round(box.max.x / SCALE + 30 + fields.w / 2), z: Math.round((box.min.z + box.max.z) / 2 / SCALE) };
  };

  // new objects always go on top of the stack, so one dropped onto another rests on it
  const placeFromLibrary = (item, pos) => {
    const fields = objectFieldsFromTemplate(item);
    const at = pos || nextFreeSpot(item, fields);
    const obj = { ...PLACEMENT_DEFAULTS, ...fields, x: Math.round(at.x), z: Math.round(at.z), layer: topLayer() + 1 };
    if (item.objKind === "box") {
      const id = nextBoxIdRef.current++;
      setBoxInstances((prev) => [...prev, { id, ...obj }]);
      selectObject("box", id);
      return id;
    }
    const id = nextComponentInstanceIdRef.current++;
    setComponentInstances((prev) => [...prev, { id, ...obj }]);
    selectObject("component", id);
    return id;
  };

  // the copy goes directly above its source in the stack (not to the very top), so
  // duplicating something mid-stack doesn't lift the copy over unrelated objects
  const duplicateInstance = (kind, id, opts = {}) => {
    const list = kind === "box" ? boxInstances : componentInstances;
    const source = list.find((o) => o.id === id);
    if (!source) return null;
    const offset = opts.offset === false ? 0 : kind === "box" ? source.w + 40 : 40;
    const copy = { ...source, x: source.x + offset, layer: (source.layer ?? 0) + 0.5 };
    if (kind === "box") {
      const newId = nextBoxIdRef.current++;
      commitObjects([...boxInstances, { ...copy, id: newId }], componentInstances);
      selectObject("box", newId);
      return newId;
    }
    const newId = nextComponentInstanceIdRef.current++;
    commitObjects(boxInstances, [...componentInstances, { ...copy, id: newId }]);
    selectObject("component", newId);
    return newId;
  };

  const removeSelection = () => {
    const keys = new Set(selectionKeysRef.current);
    if (!keys.size) return;
    const nextBoxes = boxInstances.filter((b) => !keys.has(keyOf("box", b.id)));
    const nextComponents = componentInstances.filter((c) => !keys.has(keyOf("component", c.id)));
    commitObjects(nextBoxes, nextComponents);
    const top = stackOrder(nextBoxes, nextComponents).pop();
    selectObject(top?.kind ?? null, top?.id);
  };
  const selectAll = () => {
    const keys = [...boxInstances.map((b) => keyOf("box", b.id)), ...componentInstances.map((c) => keyOf("component", c.id))];
    if (!keys.length) return;
    setSelectedKeys(keys);
    if (!activeSelection) setActiveSelection(parseKey(keys[keys.length - 1]));
  };
  const removeInstance = (kind, id) => {
    const nextBoxes = kind === "box" ? boxInstances.filter((b) => b.id !== id) : boxInstances;
    const nextComponents = kind === "component" ? componentInstances.filter((c) => c.id !== id) : componentInstances;
    commitObjects(nextBoxes, nextComponents);
    if (activeSelection?.kind === kind && activeSelection.id === id) {
      // select whatever is now on top, or nothing if the scene is empty
      const top = stackOrder(nextBoxes, nextComponents).pop();
      selectObject(top?.kind ?? null, top?.id);
    }
  };

  // Swaps the selected object's appearance for a library entry's while keeping where
  // it is: position, rotation, tilt, height, stacking slot. Within the same kind the
  // orientation is kept too (a card deliberately stood up stays standing); across kinds
  // (box ↔ card) the new object takes its template's own orientation, since a box's
  // and a card's natural poses differ. Crossing kinds means moving between the two
  // object lists, so the object gets a new id there.
  const replaceSelected = (item) => {
    const sel = selectedObject;
    const kind = activeSelection?.kind;
    if (!sel) return;
    const fields = objectFieldsFromTemplate(item);
    const placement = Object.fromEntries(Object.keys(PLACEMENT_DEFAULTS).map((k) => [k, sel[k]]));
    if (item.objKind === kind) {
      // a die has no standing/lying control, so it never inherits (or passes on) a
      // card's standing pose — it would be stuck on its side with no way back
      const keepPose = fields.kind !== "die" && sel.kind !== "die";
      const next = { ...fields, ...placement, orientation: keepPose ? sel.orientation : fields.orientation, id: sel.id };
      if (kind === "box") setBoxInstances((prev) => prev.map((b) => (b.id === sel.id ? next : b)));
      else setComponentInstances((prev) => prev.map((c) => (c.id === sel.id ? next : c)));
      return;
    }
    if (item.objKind === "box") {
      const id = nextBoxIdRef.current++;
      commitObjects([...boxInstances, { ...fields, ...placement, id }], componentInstances.filter((c) => c.id !== sel.id));
      selectObject("box", id);
    } else {
      const id = nextComponentInstanceIdRef.current++;
      commitObjects(boxInstances.filter((b) => b.id !== sel.id), [...componentInstances, { ...fields, ...placement, id }]);
      selectObject("component", id);
    }
  };

  // ---- registered library entries ----
  const registerSelected = () => {
    const sel = selectedObject;
    if (!sel) return null;
    const kind = activeSelection.kind;
    const base = sel.name || (kind === "box" ? BOX_TYPE_LABEL[sel.boxType || "lidded"] : "コンポーネント");
    const taken = new Set(userComponents.map((u) => u.name));
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
    const id = `user:${nextUserComponentIdRef.current++}`;
    setUserComponents((prev) => [...prev, { id, name, group: "user", objKind: kind, template: templateFromObject(sel) }]);
    return id;
  };
  const renameUserComponent = (id, name) => setUserComponents((prev) => prev.map((u) => (u.id === id ? { ...u, name } : u)));
  // nothing in the scene points at a library entry, so removing one never affects
  // placed objects — no cascade, no confirmation
  const removeUserComponent = (id) => setUserComponents((prev) => prev.filter((u) => u.id !== id));

  // ---- the selected component's own appearance (shape, color, image) ----
  const patchSelectedComponent = (patch) => {
    if (selectedComponent) updateComponentInstance(selectedComponent.id, patch);
  };
  // a die-cut keeps the new picture's proportions (its outline comes from the picture)
  const newImagePatch = (img) =>
    selectedComponent?.kind === "alpha"
      ? { d: Math.round(((selectedComponent.w * imgH(img)) / imgW(img)) * 10) / 10 }
      : {};
  const uploadComponentImage = (e) =>
    readImageFile(e, (img, fileName) => patchSelectedComponent({ img, fileName, transform: EMPTY_CROP, ...newImagePatch(img) }));
  const pasteComponentImage = makePasteHandler((img) =>
    patchSelectedComponent({ img, fileName: "(クリップボードから貼り付け)", transform: EMPTY_CROP, ...newImagePatch(img) })
  );
  const clearComponentImage = () => patchSelectedComponent({ img: null, fileName: "", transform: EMPTY_CROP });
  const openComponentCropEditor = () => {
    const c = selectedComponent;
    if (!c?.img) return;
    const id = c.id;
    setCropEditor({
      img: c.img,
      // the crop frame is the shape of the FACE the art is seen through (w × d), not
      // of the uploaded file
      aspectW: c.w,
      aspectH: c.d,
      initialCrop: c.transform,
      setTransform: (updater) => updateComponentInstance(id, (cur) => ({ transform: updater(cur.transform) })),
    });
  };
  // imports an uploaded SVG's outline as the shape — extruded exactly like a preset
  // (see parseSvgToUnitShapes/buildComponentGeometry in shapes2d.js). Resized to the
  // SVG's own aspect ratio at the current long edge, so it isn't squished on first use.
  const setComponentSvgShape = (file) => {
    const c = selectedComponent;
    if (!c || !file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const svgText = ev.target.result;
      const parsed = parseSvgToUnitShapes(svgText);
      if (!parsed) {
        alert("このSVGから形状を読み取れませんでした。");
        return;
      }
      const longEdge = Math.max(c.w, c.d);
      const w = parsed.aspect >= 1 ? longEdge : longEdge * parsed.aspect;
      const d = parsed.aspect >= 1 ? longEdge / parsed.aspect : longEdge;
      updateComponentInstance(c.id, { kind: "svg", svgText, w, d });
    };
    reader.readAsText(file);
  };
  // die-cut (トムソン): cut the piece to the image's own silhouette. D is set from the
  // trimmed picture's aspect so the art isn't stretched — the outline is traced in the
  // picture's frame and scales with W×D exactly as the picture does.
  const dieCutComponent = () => {
    const c = selectedComponent;
    if (!c?.img) return;
    const cropped = cropToCanvas(c.img, c.transform);
    updateComponentInstance(c.id, { kind: "alpha", d: Math.round(((c.w * cropped.height) / cropped.width) * 10) / 10 });
  };
  // ---- an image pasted onto the app: becomes a new box / card / token ----
  // A box gets the picture as the chosen net and goes straight to the 面の配置 editor.
  // Vector art from Illustrator knows its real size, so it's used: a card comes out at
  // the art's actual mm, and a net is laid out at true print scale (the editor then
  // resizes the box to the art). Bitmaps have no size, so they keep their proportions
  // at a standard size instead.
  const placePastedImage = ({ img, sizeMm }, choice) => {
    const fileName = "(クリップボードから貼り付け)";
    if (choice.kind === "box") {
      const preset = PRESET_ITEMS.find((it) => it.objKind === "box" && it.template.boxType === choice.boxType);
      const fields = objectFieldsFromTemplate(preset);
      const slots = boxNetSlots(fields);
      const slot = slots.find((x) => x.key === choice.slotKey) || slots[0];
      let faceLayout = null;
      if (sizeMm) {
        const fit = defaultFaceLayout(slot, { img, transform: DEFAULT_CROP }, imgW(img), imgH(img));
        const s = 1 / sizeMm[0] / fit.k; // true print scale over the fitted one, about the image centre
        faceLayout = {
          k: fit.k * s,
          centers: Object.fromEntries(Object.entries(fit.centers).map(([k, [cx, cy]]) => [k, [0.5 + (cx - 0.5) * s, 0.5 + (cy - 0.5) * s]])),
        };
      }
      const id = placeFromLibrary(preset);
      setBoxNet(id, slot.key, { img, fileName, transform: DEFAULT_CROP, faceLayout });
      setLayoutEditor({ boxId: id, slotKey: slot.key });
      return;
    }
    const isCard = choice.kind === "card";
    const preset =
      PRESET_ITEMS.find((it) => it.id === (isCard ? "preset:card-poker" : "preset:token-chit25")) || PRESET_ITEMS.find((it) => it.objKind === "component");
    const longEdge = isCard ? 88 : 25;
    const aspect = imgW(img) / imgH(img);
    const r1 = (v) => Math.round(v * 10) / 10;
    const [w, d] = sizeMm ? sizeMm.map(r1) : aspect >= 1 ? [longEdge, r1(longEdge / aspect)] : [r1(longEdge * aspect), longEdge];
    let shape = {};
    if (choice.dieCut) shape = { kind: "alpha" };
    else if (!isCard && hasTransparency(img)) {
      // a token's printed outline usually IS its shape: circle or rounded square
      const canvas = cropToCanvas(img, EMPTY_CROP);
      const kind = detectAlphaShapeKind(canvas);
      if (kind === "circle") shape = { kind: "circle" };
      else if (kind) shape = { kind: "roundedSquare", cornerRadius: r1(detectAlphaCornerRadiusPx(canvas) * (w / canvas.width)) };
    } else if (!isCard) shape = { kind: "roundedSquare", cornerRadius: 0.5 };
    placeFromLibrary({
      objKind: "component",
      name: isCard ? "カード" : "駒",
      template: { ...preset.template, w, d, img, fileName, transform: EMPTY_CROP, ...shape },
    });
  };

  // best-guess shape (circle vs. rounded-rect) + corner radius from the image's alpha
  // channel — see detectAlphaShapeKind/detectAlphaCornerRadiusPx in imaging.js
  const autoDetectComponentShape = () => {
    const c = selectedComponent;
    if (!c?.img) return;
    const cropped = cropToCanvas(c.img, c.transform);
    const kind = detectAlphaShapeKind(cropped);
    if (!kind) {
      alert("この画像から形状を検出できませんでした(透明な部分が見つかりません)。");
      return;
    }
    if (kind === "circle") {
      updateComponentInstance(c.id, { kind: "circle" });
      return;
    }
    const radiusPx = detectAlphaCornerRadiusPx(cropped);
    const mmPerPx = c.w / cropped.width;
    updateComponentInstance(c.id, { kind: "roundedSquare", cornerRadius: Math.max(0, Math.round(radiusPx * mmPerPx * 10) / 10) });
  };

  // always-fresh handles for imperative (non-React) callers — the pointer-drag handler
  // and the global keydown listener live in effects that run once, so they read the
  // current render's functions through these refs instead of closing over stale ones
  const duplicateFnsRef = useRef(null);
  duplicateFnsRef.current = duplicateInstance;
  const activeSelectionRef = useRef(activeSelection);
  activeSelectionRef.current = activeSelection;
  const clipboardRef = useRef(null);
  const removeFnsRef = useRef(null);
  removeFnsRef.current = removeSelection;
  const selectAllRef = useRef(null);
  selectAllRef.current = selectAll;
  const moveLayerRef = useRef(null);
  moveLayerRef.current = moveSelectedLayer;
  // while a modal is up, the scene behind it must not react to keys — Delete in the
  // trim editor used to delete the object being trimmed, Ctrl+Z undid scene edits
  // underneath the dialog
  const modalOpenRef = useRef(false);
  modalOpenRef.current = !!(cropEditor || layoutEditor || exportSettingsOpen || confirmDialog || pastedImage);
  // Esc closes the topmost dialog without applying (a field being typed into keeps Esc
  // for itself — ScrubField uses it to cancel the edit)
  useEffect(() => {
    if (!modalOpenRef.current) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
      e.preventDefault();
      if (confirmDialog) setConfirmDialog(null);
      else if (pastedImage) setPastedImage(null);
      else if (cropEditor) setCropEditor(null);
      else if (layoutEditor) setLayoutEditor(null);
      else setExportSettingsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cropEditor, layoutEditor, exportSettingsOpen, confirmDialog, pastedImage]);

  // ---- copy / paste on the app itself (not into a field or a dialog) ----
  // Copying an object also overwrites the system clipboard with a marker: otherwise an
  // image copied earlier from Illustrator would still be there, and the next paste
  // couldn't tell "duplicate my object" from "place this picture". Paste then decides by
  // what's actually on the clipboard: the marker → duplicate the copied object; an
  // image → ask what it is (PasteImageDialog); anything else → nothing.
  const placePastedRef = useRef(null);
  placePastedRef.current = placePastedImage;
  useEffect(() => {
    const MARKER = "[Package Mockup Studio object]";
    const busy = () => {
      const ae = document.activeElement;
      return modalOpenRef.current || (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable));
    };
    const onCopy = (e) => {
      if (busy()) return;
      if (window.getSelection && String(window.getSelection())) return; // copying page text
      const sel = activeSelectionRef.current;
      if (!sel) return;
      clipboardRef.current = { kind: sel.kind, id: sel.id };
      e.clipboardData.setData("text/plain", MARKER);
      e.preventDefault();
    };
    const onPaste = async (e) => {
      if (busy()) return;
      const dt = e.clipboardData;
      if (dt?.getData("text/plain") === MARKER) {
        e.preventDefault();
        const clip = clipboardRef.current;
        if (clip) duplicateFnsRef.current?.(clip.kind, clip.id);
        return;
      }
      const items = clipboardItemsFromDataTransfer(dt);
      const types = items.flatMap((it) => it.types);
      const plain = dt?.getData("text/plain") || "";
      const html = dt?.getData("text/html") || "";
      const looksLikeImage = types.some((t) => t.startsWith("image/")) || plain.includes("<svg") || /<svg|<img/.test(html);
      if (!looksLikeImage) return;
      e.preventDefault();
      try {
        const { img, sizeMm } = await imageFromClipboardItems(items);
        setPastedImage({ img, sizeMm });
      } catch (err) {
        alert(err?.message || "クリップボードからの貼り付けに失敗しました");
      }
    };
    window.addEventListener("copy", onCopy);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  // ---- undo/redo history over the scene objects and the registered library — the
  // "what you actually did" layer, not every scene-wide setting. Snapshots are pushed
  // on a 500ms debounce so a continuous drag or scrub collapses into ONE undo step;
  // undo/redo clear any pending debounce first so a still-settling edit can't clobber
  // the state they just applied. Kept in a ref: the stack itself never needs to render.
  const historyRef = useRef({ stack: [{ boxInstances, componentInstances, userComponents }], index: 0 });
  const historyTimerRef = useRef(null);
  const isApplyingHistoryRef = useRef(false);
  const historyMountedRef = useRef(false);
  useEffect(() => {
    if (!historyMountedRef.current) {
      historyMountedRef.current = true;
      return;
    }
    if (isApplyingHistoryRef.current) {
      isApplyingHistoryRef.current = false;
      return;
    }
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      const h = historyRef.current;
      const snapshot = { boxInstances, componentInstances, userComponents };
      const truncated = h.stack.slice(0, h.index + 1);
      truncated.push(snapshot);
      const MAX_HISTORY = 100;
      const trimmed = truncated.length > MAX_HISTORY ? truncated.slice(truncated.length - MAX_HISTORY) : truncated;
      historyRef.current = { stack: trimmed, index: trimmed.length - 1 };
    }, 500);
  }, [boxInstances, componentInstances, userComponents]);
  const applyHistorySnapshot = (snapshot) => {
    isApplyingHistoryRef.current = true;
    setBoxInstances(snapshot.boxInstances);
    setComponentInstances(snapshot.componentInstances);
    setUserComponents(snapshot.userComponents);
    // the selection may point at an object this snapshot doesn't have
    const sel = activeSelectionRef.current;
    const list = sel?.kind === "box" ? snapshot.boxInstances : snapshot.componentInstances;
    if (sel && !list.some((o) => o.id === sel.id)) {
      const top = stackOrder(snapshot.boxInstances, snapshot.componentInstances).pop();
      setActiveSelection(top ? { kind: top.kind, id: top.id } : null);
    }
  };
  const undo = () => {
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    const h = historyRef.current;
    if (h.index <= 0) return;
    const newIndex = h.index - 1;
    applyHistorySnapshot(h.stack[newIndex]);
    historyRef.current = { ...h, index: newIndex };
  };
  const redo = () => {
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    const h = historyRef.current;
    if (h.index >= h.stack.length - 1) return;
    const newIndex = h.index + 1;
    applyHistorySnapshot(h.stack[newIndex]);
    historyRef.current = { ...h, index: newIndex };
  };
  // ---- the project: everything a save holds ----
  const projectSettings = {
    guideColor,
    colorCorrection,
    bgMode,
    bgImage,
    fov,
    lightAzimuth,
    lightElevation,
    groundVisible,
    exposure,
    ambientBoost,
    dofEnabled,
    dofFocusMode,
    dofDistance,
    dofStrength,
    artboardW,
    artboardH,
    exportScale,
    transparentExport,
    fitToContent,
  };
  const settingSetters = {
    guideColor: setGuideColor,
    colorCorrection: setColorCorrection,
    bgMode: setBgMode,
    bgImage: setBgImage,
    fov: setFov,
    lightAzimuth: setLightAzimuth,
    lightElevation: setLightElevation,
    groundVisible: setGroundVisible,
    exposure: setExposure,
    ambientBoost: setAmbientBoost,
    dofEnabled: setDofEnabled,
    dofFocusMode: setDofFocusMode,
    dofDistance: setDofDistance,
    dofStrength: setDofStrength,
    artboardW: setArtboardW,
    artboardH: setArtboardH,
    exportScale: setExportScale,
    transparentExport: setTransparentExport,
    fitToContent: setFitToContent,
  };
  // what a 新規 project starts from: the values this session started with
  const initialProjectRef = useRef(null);
  if (!initialProjectRef.current) initialProjectRef.current = { boxInstances, componentInstances: [], userComponents: [], settings: projectSettings, camera: null };
  const collectProject = () => {
    const t = three.current;
    return {
      boxInstances,
      componentInstances,
      userComponents,
      settings: projectSettings,
      camera: t.center ? { azimuth: t.azimuth, elevation: t.elevation, radius: t.radius, center: t.center.toArray(), pan: t.pan.toArray() } : null,
    };
  };
  // the values a save holds, as of the last save/open — anything different is unsaved
  const trackedValues = [boxInstances, componentInstances, userComponents, ...Object.values(projectSettings)];
  const savedValuesRef = useRef(null);
  const markCleanRef = useRef(true);
  useEffect(() => {
    if (markCleanRef.current) {
      savedValuesRef.current = trackedValues;
      markCleanRef.current = false;
    }
  });
  const dirty = !!savedValuesRef.current && trackedValues.some((v, i) => v !== savedValuesRef.current[i]);

  const applyProject = (d) => {
    const boxes = d.boxInstances || [];
    const comps = d.componentInstances || [];
    const users = d.userComponents || [];
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    isApplyingHistoryRef.current = true;
    historyRef.current = { stack: [{ boxInstances: boxes, componentInstances: comps, userComponents: users }], index: 0 }; // a loaded project starts its own undo history
    setBoxInstances(boxes);
    setComponentInstances(comps);
    setUserComponents(users);
    Object.entries(d.settings || {}).forEach(([k, v]) => settingSetters[k]?.(v));
    nextBoxIdRef.current = Math.max(0, ...boxes.map((b) => b.id)) + 1;
    nextComponentInstanceIdRef.current = Math.max(0, ...comps.map((c) => c.id)) + 1;
    nextUserComponentIdRef.current = Math.max(0, ...users.map((u) => Number(String(u.id).split(":")[1]) || 0)) + 1;
    const top = stackOrder(boxes, comps).pop();
    selectObject(top?.kind ?? null, top?.id);
    const t = three.current;
    if (d.camera && t.center) {
      t.azimuth = d.camera.azimuth;
      t.elevation = d.camera.elevation;
      t.radius = d.camera.radius;
      t.center.fromArray(d.camera.center);
      t.pan.fromArray(d.camera.pan);
      t.cameraRestored = true;
    } else {
      t.cameraRestored = false;
      setTimeout(() => three.current.resetCameraView?.(), 120);
    }
    markCleanRef.current = true;
  };

  const fileHandleRef = useRef(null);
  const showToast = (text) => {
    setToast(text);
    setTimeout(() => setToast((cur) => (cur === text ? null : cur)), 3500);
  };
  const saveProject = async (saveAs = false) => {
    setFileMenuOpen(false);
    try {
      const text = serializeProject(collectProject());
      const handle = await writeProjectFile(text, {
        handle: saveAs ? null : fileHandleRef.current,
        suggestedName: `${projectName || "mockup"}${PROJECT_EXT}`,
      });
      if (handle) fileHandleRef.current = handle;
      setProjectName((handle?.name || `${projectName || "mockup"}${PROJECT_EXT}`).replace(PROJECT_EXT, ""));
      savedValuesRef.current = trackedValues; // exactly what was just written
      forceRender((n) => n + 1); // so the unsaved mark clears
      showToast("保存しました");
    } catch (err) {
      if (err?.name !== "AbortError") alert(`保存できませんでした: ${err?.message || err}`);
    }
  };
  const openProject = async () => {
    setFileMenuOpen(false);
    try {
      const { text, name, handle } = await readProjectFile();
      const { data } = await deserializeProject(text);
      applyProject(data);
      fileHandleRef.current = handle;
      setProjectName(name.replace(PROJECT_EXT, "").replace(/\.json$/, ""));
      showToast(`「${name}」を開きました`);
    } catch (err) {
      if (err?.name !== "AbortError") alert(err?.message || "開けませんでした");
    }
  };
  const newProject = () => {
    setFileMenuOpen(false);
    setConfirmDialog({
      title: "新規作成",
      message: dirty ? "今の作業を閉じて、新しいプロジェクトを始めます。保存していない変更は失われます。" : "今の作業を閉じて、新しいプロジェクトを始めます。",
      confirmLabel: "新規作成",
      onConfirm: () => {
        applyProject(initialProjectRef.current);
        fileHandleRef.current = null;
        setProjectName(null);
      },
    });
  };
  const fileActionsRef = useRef(null);
  fileActionsRef.current = { saveProject, openProject };

  // ---- automatic save in the browser, restored on the next visit ----
  const autosaveReadyRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    storeGet("autosave")
      .then(async (text) => {
        if (!text || cancelled) return;
        const { data } = await deserializeProject(text);
        if (cancelled) return;
        applyProject(data);
        if (data.projectName) setProjectName(data.projectName);
        showToast("前回の作業を復元しました");
      })
      .catch((err) => console.warn("[autosave] restore failed", err))
      .finally(() => {
        autosaveReadyRef.current = true;
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const autosaveRef = useRef(null);
  autosaveRef.current = () => {
    if (!autosaveReadyRef.current) return;
    try {
      storeSet("autosave", serializeProject({ ...collectProject(), projectName })).catch((err) => console.warn("[autosave]", err));
    } catch (err) {
      console.warn("[autosave]", err);
    }
  };
  useEffect(() => {
    const id = setTimeout(() => autosaveRef.current?.(), 1200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...trackedValues, projectName]);
  useEffect(() => {
    // the camera isn't React state: save it too when the tab is hidden or closed
    const flush = () => document.visibilityState === "hidden" && autosaveRef.current?.();
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, []);

  const undoRef = useRef(null);
  undoRef.current = undo;
  const redoRef = useRef(null);
  redoRef.current = redo;

  // global shortcuts for the active selection — copy/paste, delete, undo/redo, and the
  // layer arrange keys. Skipped while a text field has focus so they never hijack
  // ordinary typing. Paste duplicates whatever was COPIED, not what's selected now.
  //
  // Layer keys match on e.key, not e.code: on a JIS keyboard the physical keys that
  // type [ and ] sit where a US layout has ] and \, so the code values would be wrong;
  // with Shift held the same keys report { and }.
  useEffect(() => {
    const isEditableTarget = (el) => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    const onKeyDown = (e) => {
      if (isEditableTarget(document.activeElement) || modalOpenRef.current) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "]" || e.key === "}" || e.key === "[" || e.key === "{") {
          e.preventDefault();
          moveLayerRef.current?.(e.key === "]" || e.key === "}" ? 1 : -1, e.shiftKey);
          return;
        }
        const key = e.key.toLowerCase();
        // Ctrl+C / Ctrl+V are handled by the copy/paste listeners above
        if (key === "s") {
          e.preventDefault();
          fileActionsRef.current?.saveProject(e.shiftKey);
        } else if (key === "o") {
          e.preventDefault();
          fileActionsRef.current?.openProject();
        } else if (key === "a") {
          e.preventDefault();
          selectAllRef.current?.();
        } else if (key === "z") {
          e.preventDefault();
          if (e.shiftKey) redoRef.current?.();
          else undoRef.current?.();
        } else if (key === "y") {
          e.preventDefault();
          redoRef.current?.();
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (activeSelectionRef.current) {
          e.preventDefault();
          removeFnsRef.current?.(); // everything selected
        }
      } else if (e.key === "Escape") {
        selectObject(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // applies the Outliner's drag-to-reorder result: `entries` is the full row list in
  // its new visual order, each pre-tagged with the layer that order implies
  const reorderInstances = (entries) => {
    const boxLayers = new Map(entries.filter((e) => e.kind === "box").map((e) => [e.id, e.layer]));
    const componentLayers = new Map(entries.filter((e) => e.kind === "component").map((e) => [e.id, e.layer]));
    if (boxLayers.size) setBoxInstances((prev) => prev.map((b) => (boxLayers.has(b.id) ? { ...b, layer: boxLayers.get(b.id) } : b)));
    if (componentLayers.size)
      setComponentInstances((prev) => prev.map((c) => (componentLayers.has(c.id) ? { ...c, layer: componentLayers.get(c.id) } : c)));
  };

  // ---- library → viewport drag and drop ----
  const [libraryDragOver, setLibraryDragOver] = useState(false);
  const onViewportDragOver = (e) => {
    if (!e.dataTransfer.types.includes(LIBRARY_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!libraryDragOver) setLibraryDragOver(true);
  };
  const onViewportDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setLibraryDragOver(false);
  };
  const onViewportDrop = (e) => {
    setLibraryDragOver(false);
    const itemId = e.dataTransfer.getData(LIBRARY_DRAG_TYPE);
    const item = libraryItems.find((i) => i.id === itemId);
    if (!item) return;
    e.preventDefault();
    // dropped onto the render: at that point on the ground. Dropped beside it (on the
    // pasteboard): no meaningful ground point, so the usual next-free-spot.
    const onArtboard = artboardRef.current?.contains(e.target);
    const at = onArtboard ? three.current.dropPointAt?.(e.clientX, e.clientY) : null;
    placeFromLibrary(item, at || undefined);
  };

  return (
    <div
      className="flex flex-col w-full"
      style={{
        ...Object.fromEntries(Object.entries(THEMES[theme]).filter(([k]) => k !== "label")),
        height: "100vh",
        background: "var(--bg-app)",
        fontFamily: "Inter, sans-serif",
        color: "var(--text-primary)",
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
        /* the layer list's delete affordance is hover/selection-revealed (see
           Outliner.jsx); keyboard focus has to reveal it too or it becomes
           mouse-only */
        .toggle-switch:focus-visible {
          outline: 2px solid var(--highlight);
          outline-offset: 2px;
        }
        .outliner-remove:focus-visible {
          opacity: 1 !important;
          outline: 1px solid var(--highlight);
        }
        /* one hover rule for every button, instead of per-button JS hover state.
           .ui-btn opts in the few file-picker labels that act as buttons; a bare
           label:hover would also catch ScrubField, whose outer element is a label. */
        button:hover:not(:disabled), .ui-btn:hover {
          filter: brightness(1.12);
        }
        * {
          scrollbar-width: thin;
          scrollbar-color: var(--border-strong) var(--bg-surface-2);
        }
        *::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        *::-webkit-scrollbar-track {
          background: transparent;
        }
        *::-webkit-scrollbar-thumb {
          background-color: var(--border-strong);
          border-radius: 8px;
        }
        *::-webkit-scrollbar-thumb:hover {
          background-color: var(--text-faint);
        }
        /* one rule instead of touching every button's own style: every plain
           <button> (and file-upload trigger built from a <label
           className="...cursor-pointer">, same visual role) brightens on hover so
           the whole UI reads as interactive, not just the handful of controls with
           bespoke hover states (ScrubField, Outliner rows, custom dropdown items —
           all plain <div>s, so this doesn't touch or fight those). Excludes
           disabled buttons. */
        button:not(:disabled), label.cursor-pointer {
          transition: filter 100ms ease;
        }
        button:not(:disabled):hover, label.cursor-pointer:hover {
          filter: brightness(1.12);
        }
        button:not(:disabled):active, label.cursor-pointer:active {
          filter: brightness(0.96);
        }
      `}</style>

      {/* top toolbar — thin, full width */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4"
        style={{ height: "48px", background: "var(--bg-surface-2)", borderBottom: "1px solid var(--border-strong)" }}
      >
        <h1
          className="text-base flex-shrink-0"
          style={{ fontFamily: "Fraunces, serif", fontWeight: 600, color: "var(--text-primary)" }}
          title="化粧箱・カード・駒のモックアップスタジオ"
        >
          Package Mockup Studio<span style={{ color: "var(--accent)" }}>.</span>
        </h1>
        <span className="truncate" style={{ fontSize: "12px", color: "var(--text-secondary)", minWidth: 0 }} title={dirty ? "保存していない変更があります" : undefined}>
          {projectName ? `${projectName}${PROJECT_EXT}` : "未保存のプロジェクト"}
          {dirty && <span style={{ color: "var(--accent)", marginLeft: "6px" }}>● 未保存</span>}
        </span>
        <div className="flex-1" />
        <div ref={fileMenuRef} className="relative flex-shrink-0">
          <button onClick={() => setFileMenuOpen((v) => !v)} style={{ ...buttonStyle("quiet", { active: fileMenuOpen }), fontSize: "12px", padding: "6px 10px" }}>
            ファイル ▾
          </button>
          {fileMenuOpen && (
            <div
              className="absolute right-0 top-full mt-1 rounded-lg p-1.5 z-20 flex flex-col"
              style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border)", width: "220px" }}
            >
              {[
                ["新規作成", "", newProject],
                ["開く…", "Ctrl+O", openProject],
                ["保存", "Ctrl+S", () => saveProject(false)],
                ["名前を付けて保存…", "Ctrl+Shift+S", () => saveProject(true)],
              ].map(([label, keys, fn]) => (
                <button
                  key={label}
                  onClick={fn}
                  className="flex items-center justify-between text-xs text-left rounded px-2 py-2"
                  style={{ color: "var(--text-primary)", background: "transparent" }}
                >
                  <span>{label}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", color: "var(--text-muted)" }}>{keys}</span>
                </button>
              ))}
              <p className="px-2 pt-1.5 pb-1" style={{ fontSize: "10px", lineHeight: 1.5, color: "var(--text-muted)", borderTop: "1px solid var(--border)", marginTop: "4px" }}>
                作業はこのブラウザにも自動で保存され、次に開いたときに復元されます。
              </p>
            </div>
          )}
        </div>
        <div ref={settingsMenuRef} className="relative flex-shrink-0">
          <button
            onClick={() => setSettingsOpen((v) => !v)}
            className="flex items-center justify-center"
            style={{ ...buttonStyle("quiet", { active: settingsOpen }), width: "32px", height: "30px", padding: 0, fontSize: "15px" }}
            title="環境設定"
          >
            ⚙
          </button>
          {settingsOpen && (
            <div
              className="absolute right-0 top-full mt-1 rounded-lg p-3 z-20"
              style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border)", width: "200px" }}
            >
              <div className="mb-2" style={sectionTitle}>
                テーマ
              </div>
              <div className="flex flex-col gap-1">
                {THEME_ORDER.map((key) => (
                  <button
                    key={key}
                    onClick={() => setTheme(key)}
                    className="text-xs text-left rounded px-2 py-2"
                    style={{
                      background: theme === key ? "var(--accent)" : "var(--bg-surface-1)",
                      color: theme === key ? "#1c1a17" : "var(--text-primary)",
                      fontWeight: theme === key ? 600 : 400,
                    }}
                  >
                    {THEMES[key].label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* the app's one committing action, and the only accent-filled control in the
            chrome — it used to be a hardcoded cream fill, which was a fourth button
            treatment AND near-invisible against the light theme's own background */}
        <button
          onClick={() => setExportSettingsOpen(true)}
          style={{ ...buttonStyle("primary"), fontSize: "13px", padding: "6px 16px" }}
        >
          書き出し
        </button>
      </div>

      {/* main row: outliner (left) / viewport (center) / inspector (right, resizable) */}
      <div className="flex flex-1 min-h-0">

      {/* outliner rail — fixed width, left. Flex column filling the full row height so
          the Outliner's own list can flex to fill it, instead of scrolling internally
          after only a handful of rows while the rest of the column sits empty. */}
      <div
        className="flex-shrink-0 flex flex-col p-3"
        style={{ order: 0, width: "260px", background: "var(--bg-surface-2)", borderRight: "1px solid var(--border-strong)" }}
      >
        <Outliner
          boxInstances={boxInstances}
          componentInstances={componentInstances}
          libraryItems={libraryItems}
          activeSelection={activeSelection}
          selectedKeys={selectionKeys}
          onSelect={selectObject}
          onPlace={(item) => placeFromLibrary(item)}
          onOpenLibrary={() => setActiveTab("component")}
          onDuplicate={duplicateInstance}
          onRemove={removeInstance}
          onReorder={reorderInstances}
        />
      </div>

      {/* inspector rail — contextual (selected object) + scene-wide settings,
          drag-resizable width. Visually placed on the RIGHT via `order` (CSS), while
          staying in this position in the source — the viewport block right after this
          one in the source is `order: 1` so it renders in the middle instead; keeping
          source order as-is and reordering with CSS avoided relocating a few thousand
          lines of existing, working JSX. */}
      <div
        className="flex-shrink-0 flex flex-col"
        style={{ order: 3, width: sidebarWidth, background: "var(--bg-surface-2)", borderLeft: "1px solid var(--border-strong)" }}
      >
        <div className="flex-shrink-0 flex" style={{ borderBottom: "1px solid var(--border-strong)" }}>
          {[
            { key: "object", label: "オブジェクト" },
            { key: "component", label: "コンポーネント" },
            { key: "environment", label: "環境" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="flex-1 text-xs py-2.5"
              style={{
                background: activeTab === tab.key ? "var(--bg-surface-1)" : "transparent",
                color: activeTab === tab.key ? "var(--text-primary)" : "var(--text-muted)",
                fontWeight: activeTab === tab.key ? 600 : 400,
                borderBottom: `2px solid ${activeTab === tab.key ? "var(--accent)" : "transparent"}`,
                marginBottom: "-1px",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">

        {activeTab === "object" && (
        <>
        {selectionKeys.length > 1 && (
          <p className="mb-3 rounded px-2.5 py-2" style={{ fontSize: "11px", lineHeight: 1.5, color: "var(--text-secondary)", background: "var(--bg-surface-1)", border: "1px solid var(--border)" }}>
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{selectionKeys.length}個を選択中。</span>
            3Dビューの枠でまとめて移動・拡大縮小・回転、Deleteでまとめて削除できます。下は最後に選んだオブジェクトの設定です。
          </p>
        )}
        {!selectedObject && (
          <div className="flex flex-col items-start gap-2 py-6">
            <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>オブジェクトが選択されていません</div>
            <p style={helpText}>3Dビューかレイヤーで選択するか、コンポーネントから配置してください。</p>
            <button onClick={() => setActiveTab("component")} style={buttonStyle("quiet")}>
              コンポーネントを開く
            </button>
          </div>
        )}

        {selectedObject && (
          <ObjectHeader
            object={selectedObject}
            kindLabel={
              selectedBox
                ? BOX_TYPE_LABEL[selectedBox.boxType || "lidded"]
                : { roundedSquare: "角丸四角", circle: "円", hexagon: "六角形", triangle: "三角形", svg: "SVG形状", alpha: "型抜き(画像の形)", die: "ダイス" }[selectedComponent.kind] || "コンポーネント"
            }
            sizeText={(selectedBox ? [selectedBox.w, selectedBox.d, selectedBox.h] : [selectedComponent.w, selectedComponent.d, selectedComponent.thickness])
              .map((v) => Math.round(v * 10) / 10)
              .join(" × ")}
            libraryItems={libraryItems}
            onRename={(name) =>
              selectedBox ? updateBox(selectedBox.id, { name }) : updateComponentInstance(selectedComponent.id, { name })
            }
            onReplace={replaceSelected}
            onRegister={registerSelected}
          />
        )}

        {selectedBox && (
        <>
        {/* the type decides everything below it — which size fields mean anything,
            which extra section appears, and which print sheets the box needs */}
        <Section first title="箱の種類">
          <SegmentedControl
            value={selectedBox.boxType || "lidded"}
            // the name follows the type while it's still the automatic one ("身蓋箱" →
            // "スリーブ箱"); a name the user typed is left alone
            onChange={(v) =>
              updateBox(selectedBox.id, (b) => ({
                boxType: v,
                ...(!b.name || b.name === BOX_TYPE_LABEL[b.boxType || "lidded"] ? { name: BOX_TYPE_LABEL[v] } : {}),
              }))
            }
            options={BOX_TYPES.map((t) => ({ value: t.key, label: t.label }))}
          />
        </Section>

        <Section
          title="サイズ"
          meta="mm"
          hint={
            selectedBox.boxType === "sleeve"
              ? "スリーブ(外箱)の外寸です。内箱はスリーブの内側にぴったり収まる寸法に自動で決まります。立てた状態では、長さの方向(上)に引き出されます。"
              : undefined
          }
        >
          {/* a standing sleeve's axes don't read as width/depth/height — name them by
              what they are for that box: its length (the pull direction), width and
              thickness */}
          <div className="flex flex-col gap-2">
            <DimensionFields
              fields={boxDimFields(selectedBox)}
              values={{ w: selectedBox.w, d: selectedBox.d, h: selectedBox.h }}
              linked={linkedDims}
              onToggleLink={toggleLinkedDim}
              onChange={(dims) => updateBox(selectedBox.id, dims)}
            />
            {/* the sleeve is built from flat panels (open ends), so there's no edge to round */}
            {selectedBox.boxType !== "sleeve" &&
              instanceNumField("角の丸み", "bevelRadius", 0, 10, "mm", { step: 0.5, decimals: 1 })}
          </div>
        </Section>

        {(selectedBox.boxType || "lidded") === "lidded" && (
          <Section
            title="蓋"
            meta="mm"
            collapsible
            summary={`高さ ${displayValue("lidH")} / クリア ${displayValue("clearance")}`}
            hint="蓋の幅・奥行は 身 + クリアランス×2 で自動計算されます。"
          >
            <div className="flex flex-col gap-2">
              {instanceNumField("蓋の高さ", "lidH", 1, 200, "mm")}
              {instanceNumField("クリアランス", "clearance", 0, 20, "mm")}
              {instanceNumField("蓋を開ける", "lidOpen", 0, 100, "%")}
            </div>
          </Section>
        )}

        {selectedBox.boxType === "sleeve" && (
          <Section
            title="内箱"
            collapsible
            summary={`フチ ${displayValue("wallThickness")}mm / ${displayValue("trayOut")}%`}
            hint="フチの厚みは内箱の壁の厚さ(二重に折り返した壁の、上から見えるフチ幅)です。"
          >
            <div className="flex flex-col gap-2">
              {instanceNumField("フチの厚み", "wallThickness", 1, 30, "mm", { step: 0.5, decimals: 1 })}
              {instanceNumField("引き出す", "trayOut", 0, 100, "%")}
            </div>
          </Section>
        )}

        <Section
          title="展開図"
          hint="ガイド画像を保存して、その上にデザインを配置した画像を入れてください。矢印は各面の絵柄の上方向です。のりしろ・差込部分は箱には表示されません。"
        >
          {renderNetSlots(selectedBox)}
        </Section>

        <Section
          title="質感"
          collapsible
          summary={BOX_FINISHES.find((f) => f.key === (selectedBox.finish || "matte"))?.label}
          hint="印刷面の仕上げです。グロスはラミネートのような光沢と映り込み、網目エンボスは布目状の細かな凹凸(0.8mmピッチ)を表現します。"
        >
          <SegmentedControl
            value={selectedBox.finish || "matte"}
            onChange={(v) => updateBox(selectedBox.id, { finish: v })}
            options={BOX_FINISHES.map((f) => ({ value: f.key, label: f.label }))}
          />
        </Section>

        <Section
          title="配置"
          collapsible
          summary={`${Math.round(displayValue("x"))}, ${Math.round(displayValue("z"))} / ${Math.round(displayValue("rotY"))}°`}
        >
          <div className="flex flex-col gap-2">
            {instanceNumField("位置 X", "x", -2000, 2000, "mm")}
            {instanceNumField("位置 Y", "floatHeight", -200, 500, "mm")}
            {instanceNumField("位置 Z", "z", -2000, 2000, "mm")}
            {instanceNumField("回転 Y", "rotY", 0, 359, "°")}
          </div>
          <div className="mt-2">
            <SegmentedControl
              tone="quiet"
              size="sm"
              value={displayValue("rotY")}
              onChange={(deg) => setParamValue("rotY", deg)}
              options={[
                { value: 0, label: "正面" },
                { value: 90, label: "右" },
                { value: 180, label: "背面" },
                { value: 270, label: "左" },
              ]}
            />
          </div>
        </Section>

        <Section
          title="姿勢"
          collapsible
          defaultOpen={false}
          summary={`${displayValue("orientation") === "lying" ? "寝かせる" : "立てる"}${
            displayValue("tiltX") !== 0 || displayValue("tiltZ") !== 0
              ? ` / 傾き ${displayValue("tiltX")}°,${displayValue("tiltZ")}°`
              : ""
          }`}
        >
          <SegmentedControl
            value={displayValue("orientation") === "lying" ? "lying" : "standing"}
            onChange={(v) => setParamValue("orientation", v)}
            options={[
              { value: "standing", label: "立てる" },
              { value: "lying", label: "寝かせる" },
            ]}
          />
          <div className="flex flex-col gap-2 mt-3">
            {instanceNumField("傾き(前後)", "tiltX", -45, 45, "°")}
            {instanceNumField("傾き(左右)", "tiltZ", -45, 45, "°")}
          </div>
          {(displayValue("tiltX") !== 0 || displayValue("tiltZ") !== 0) && (
            <button onClick={() => updateBox(selectedBox.id, { tiltX: 0, tiltZ: 0 })} className="w-full mt-2" style={buttonStyle("quiet")}>
              傾きをリセット
            </button>
          )}
        </Section>

        <Section
          title="スタッキング"
          collapsible
          defaultOpen={false}
          summary={displayValue("groundSnap") !== false ? "接地する" : "固定"}
        >
          <ToggleSwitch
            checked={displayValue("groundSnap") !== false}
            onChange={(v) => setParamValue("groundSnap", v)}
            label="接地する(地面、または下のレイヤーに自動で乗る)"
          />
        </Section>
        </>
        )}

        {selectedComponent && (
        <ComponentInstancePanel
          instance={selectedComponent}
          onUpdate={(patch) => updateComponentInstance(selectedComponent.id, patch)}
          onUploadImage={uploadComponentImage}
          onPasteImage={pasteComponentImage}
          onClearImage={clearComponentImage}
          onOpenCropEditor={openComponentCropEditor}
          onAutoDetectShape={autoDetectComponentShape}
          onSetSvgShape={setComponentSvgShape}
          onDieCut={dieCutComponent}
        />
        )}
        </>
        )}

        {activeTab === "component" && (
          <LibraryPanel
            items={libraryItems}
            selectedName={selectedObject ? selectedObject.name || (selectedBox ? BOX_TYPE_LABEL[selectedBox.boxType || "lidded"] : "コンポーネント") : null}
            onPlace={(item) => placeFromLibrary(item)}
            onReplace={replaceSelected}
            onRegister={registerSelected}
            onRename={renameUserComponent}
            onRemove={removeUserComponent}
            dragType={LIBRARY_DRAG_TYPE}
          />
        )}

        {activeTab === "environment" && (
        <>
        <Section
          first
          title="アングル"
          hint="画角の数値が小さいほど圧縮された望遠風、大きいほど広角で遠近感が強調されます。"
        >
          <ScrubField label="遠近感(画角)" value={fov} onChange={setFov} min={15} max={90} unit="°" />
        </Section>

        <Section
          title="背景"
          collapsible
          summary={bgMode === "dark" ? "スタジオ黒" : bgMode === "white" ? "白" : "画像"}
        >
          <SegmentedControl
            value={bgMode}
            onChange={setBgMode}
            options={[
              { value: "dark", label: "スタジオ黒" },
              { value: "white", label: "白" },
              { value: "image", label: "画像" },
            ]}
          />
          {bgMode === "image" && (
            <div className="flex gap-2 mt-2.5">
              {bgImage && (
                <div className="relative flex-shrink-0">
                  <img
                    src={bgImage.src}
                    alt="background"
                    className="rounded"
                    style={{ width: "48px", height: "48px", objectFit: "cover", border: "1px solid var(--border)" }}
                  />
                  <button
                    onClick={() => setBgImage(null)}
                    className="absolute rounded-full flex items-center justify-center"
                    style={{
                      top: "-6px",
                      right: "-6px",
                      width: "16px",
                      height: "16px",
                      background: "var(--accent)",
                      color: "#1c1a17",
                      fontSize: "11px",
                      lineHeight: 1,
                      border: "none",
                      cursor: "pointer",
                    }}
                    title="背景画像を削除"
                  >
                    ×
                  </button>
                </div>
              )}
              <div className="flex gap-1.5 flex-1">
                <label className="ui-btn flex-1 block text-center cursor-pointer" style={bgImage ? buttonStyle("quiet") : buttonStyle("primary")}>
                  アップロード
                  <input type="file" accept="image/*" onChange={handleBgImageFile} className="hidden" />
                </label>
                <button onClick={handleBgImagePaste} className="flex-1" style={buttonStyle("quiet")}>
                  貼り付け
                </button>
              </div>
            </div>
          )}
        </Section>

        <Section title="地面" collapsible defaultOpen={false} summary={groundVisible ? "表示" : "非表示"}>
          <ToggleSwitch checked={groundVisible} onChange={setGroundVisible} label="地面を表示" />
        </Section>

        <Section
          title="ライティング"
          meta="主光源"
          collapsible
          summary={`${lightAzimuth}° / ${lightElevation}°`}
        >
          <div className="flex flex-col gap-2">
            <ScrubField label="光の向き" value={lightAzimuth} onChange={setLightAzimuth} min={-180} max={180} unit="°" />
            <ScrubField label="光の高さ" value={lightElevation} onChange={setLightElevation} min={10} max={80} unit="°" />
            <ScrubField label="露出" value={exposure} onChange={setExposure} min={0.4} max={2} step={0.05} decimals={2} />
            <ScrubField label="環境光の強さ" value={ambientBoost} onChange={setAmbientBoost} min={0} max={2} step={0.05} decimals={2} />
          </div>
        </Section>

        <Section
          title="被写界深度"
          collapsible
          defaultOpen={false}
          summary={dofEnabled ? `${dofFocusMode === "selection" ? "最後に選択" : `${dofDistance}mm`} / ${dofStrength}%` : "オフ"}
          hint="ピントの合っていない所をぼかして、写真のような奥行きを出します。「選択したものに合わせる」は最後に選択したオブジェクトにピントを合わせ、選択を解除してもそのままです。書き出しにも反映されます(透過PNGを除く)。"
        >
          <ToggleSwitch checked={dofEnabled} onChange={setDofEnabled} label="被写界深度を使う" />
          {dofEnabled && (
            <div className="flex flex-col gap-2 mt-3">
              <SegmentedControl
                value={dofFocusMode}
                onChange={setDofFocusMode}
                size="sm"
                options={[
                  { value: "selection", label: "選択したものに合わせる" },
                  { value: "distance", label: "距離で指定" },
                ]}
              />
              {dofFocusMode === "distance" && (
                <ScrubField label="ピント距離" value={dofDistance} onChange={setDofDistance} min={50} max={5000} unit="mm" dragRange={600} />
              )}
              <ScrubField label="ボケの強さ" value={dofStrength} onChange={setDofStrength} min={0} max={100} unit="%" />
            </div>
          )}
        </Section>

        {/* changes the IMAGE itself (every printed face: boxes, cards, tokens); the light is set above */}
        <Section
          title="色補正"
          meta="%"
          collapsible
          defaultOpen={false}
          summary={`${colorCorrection.saturation} / ${colorCorrection.contrast} / ${colorCorrection.brightness}`}
          hint="箱・カード・トークンなど、すべての印刷面の画像そのものを補正します。光の当たり方(露出・環境光)は「ライティング」で調整します。"
        >
          <div className="flex flex-col gap-2">
            <ScrubField
              label="彩度"
              value={colorCorrection.saturation}
              onChange={(v) => setColorCorrection((p) => ({ ...p, saturation: v }))}
              min={50}
              max={200}
              unit="%"
            />
            <ScrubField
              label="コントラスト"
              value={colorCorrection.contrast}
              onChange={(v) => setColorCorrection((p) => ({ ...p, contrast: v }))}
              min={50}
              max={150}
              unit="%"
            />
            <ScrubField
              label="明るさ"
              value={colorCorrection.brightness}
              onChange={(v) => setColorCorrection((p) => ({ ...p, brightness: v }))}
              min={50}
              max={150}
              unit="%"
            />
          </div>
          {(colorCorrection.saturation !== 100 || colorCorrection.contrast !== 100 || colorCorrection.brightness !== 100) && (
            <button
              onClick={() => setColorCorrection({ saturation: 100, contrast: 100, brightness: 100 })}
              className="w-full mt-2"
              style={buttonStyle("quiet")}
            >
              補正をリセット
            </button>
          )}
        </Section>
        </>
        )}

        </div>
      </div>

      {/* drag handle: inspector width — see the ordering note on the inspector rail
          above for why this sits at order:2 despite its source position */}
      <div
        onPointerDown={onSidebarHandleDown}
        onPointerMove={onSidebarHandleMove}
        onPointerUp={onSidebarHandleUp}
        onPointerLeave={onSidebarHandleUp}
        style={{ order: 2, width: "5px", flexShrink: 0, cursor: "col-resize", background: "var(--border-strong)", touchAction: "none" }}
      />

      {/* center: 3D viewport (drag-resizable bottom bar lives outside this row now,
          full-width, see below) */}
      <div className="flex flex-col flex-1" style={{ order: 1, minWidth: "260px" }}>
        {/* main stage: pasteboard viewport with the render as a floating, resizable/
            zoomable/pannable artboard inside it — After Effects preview style */}
        <div
          ref={viewportRef}
          className="flex-1 relative overflow-hidden"
          style={{
            minHeight: "160px",
            background: "var(--bg-canvas)",
            backgroundImage: "radial-gradient(circle, #2a2722 1px, transparent 1px)",
            backgroundSize: "22px 22px",
            cursor: spaceHeld ? "grab" : "default",
            userSelect: "none",
            WebkitUserSelect: "none",
            // drop target feedback while a library entry is dragged over the stage
            boxShadow: libraryDragOver ? "inset 0 0 0 2px var(--highlight)" : "none",
          }}
          onPointerDown={onViewportPointerDown}
          onPointerMove={onViewportPointerMove}
          onPointerUp={onViewportPointerUp}
          onPointerLeave={onViewportPointerUp}
          onDragOver={onViewportDragOver}
          onDragLeave={onViewportDragLeave}
          onDrop={onViewportDrop}
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
            {selectedObject && activeSelection && (
              <TransformGizmo
                t={three.current}
                SCALE={SCALE}
                obj={selectedObject}
                members={selectionKeys
                  .map(parseKey)
                  .map(({ kind, id }) => ({ kind, id, obj: (kind === "box" ? boxInstances : componentInstances).find((o) => o.id === id) }))
                  .filter((m) => m.obj)}
                onPatchMany={(list) => {
                  const apply = (kind) => (prev) =>
                    prev.map((o) => {
                      const hit = list.find((l) => l.kind === kind && l.id === o.id);
                      return hit ? { ...o, ...hit.patch } : o;
                    });
                  setBoxInstances(apply("box"));
                  setComponentInstances(apply("component"));
                }}
                artW={artboardW}
                artH={artboardH}
                zoom={artboardZoom}
                link={gizmoLink}
                onToggleLink={() => setGizmoLink((v) => !v)}
                onPatch={(patch) =>
                  activeSelection.kind === "box" ? updateBox(activeSelection.id, patch) : updateComponentInstance(activeSelection.id, patch)
                }
              />
            )}
          </div>

          <div ref={helpRef} className="absolute top-3 left-3 flex flex-col items-start gap-1.5">
            <button
              onClick={() => setHelpOpen((v) => !v)}
              aria-expanded={helpOpen}
              aria-label="操作方法"
              className="text-xs rounded"
              style={{
                width: "26px",
                height: "26px",
                background: "rgba(28,26,23,0.85)",
                color: helpOpen ? "var(--text-primary)" : "var(--highlight)",
                border: `1px solid ${helpOpen ? "var(--highlight)" : "var(--border-well)"}`,
                fontWeight: 600,
              }}
              title="操作方法"
            >
              ?
            </button>
            {helpOpen && (
              <div className="text-xs px-3 py-2 rounded" style={{ background: "rgba(28,26,23,0.92)", color: "#c9c3b6", border: "1px solid var(--border-well)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: "14px", rowGap: "3px" }}>
                    {[
                      ["クリック", "オブジェクトを選択"],
                      ["ドラッグ(オブジェクト上)", "移動"],
                      ["右クリックドラッグ", "選択中のオブジェクトを回転"],
                      ["ドラッグ(何もない所)", "視点を回転"],
                      ["ホイール", "ズーム"],
                      ["中クリックドラッグ", "パン"],
                      ["Space+ドラッグ", "プレビュー枠を移動"],
                      ["Ctrl+ホイール", "プレビューの倍率"],
                      ["Ctrl+] / Ctrl+[", "レイヤーを上へ / 下へ(Shiftで最前面・最背面)"],
                      ["Ctrl+C / Ctrl+V", "オブジェクトをコピー / 貼り付け(画像を貼ると箱・カード・駒として配置)"],
                      ["Delete", "選択中のオブジェクトを削除"],
                      ["Ctrl+Z / Ctrl+Y", "元に戻す / やり直す"],
                    ].map(([k, v]) => (
                      <React.Fragment key={k}>
                        <span style={{ color: "var(--text-primary)", whiteSpace: "nowrap" }}>{k}</span>
                        <span>{v}</span>
                      </React.Fragment>
                    ))}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => three.current.resetCameraView?.()}
            className="absolute top-3 right-3 text-xs px-2 py-1 rounded"
            style={{ background: "rgba(28,26,23,0.85)", color: "var(--highlight)", border: "1px solid var(--border-well)" }}
            title="オブジェクトを動かしてもカメラは自動で動きません。全体が収まる視点に戻したいときはこちら。"
          >
            ⟲ カメラをリセット
          </button>

          <div
            className="absolute bottom-3 left-3 flex items-center gap-2 text-xs px-2 py-1.5 rounded"
            style={{ background: "rgba(28,26,23,0.85)", color: "var(--text-primary)" }}
          >
            <button
              onClick={() => setArtboardZoom((z) => Math.max(0.1, Math.round((z - 0.1) * 100) / 100))}
              className="rounded px-2 py-0.5"
              style={{ background: "var(--border)" }}
            >
              −
            </button>
            <span style={{ width: "40px", textAlign: "center", fontFamily: "'JetBrains Mono', monospace" }}>
              {Math.round(artboardZoom * 100)}%
            </span>
            <button
              onClick={() => setArtboardZoom((z) => Math.min(4, Math.round((z + 0.1) * 100) / 100))}
              className="rounded px-2 py-0.5"
              style={{ background: "var(--border)" }}
            >
              +
            </button>
            <button onClick={fitArtboard} className="rounded px-2 py-0.5" style={{ background: "var(--border)" }}>
              フィット
            </button>
            <span style={{ width: "1px", height: "16px", background: "var(--border-strong)" }} />
            <ScrubField compact value={artboardW} onChange={setArtboardWClamped} min={1} max={8000} dragRange={1200} />
            <span>×</span>
            <ScrubField compact value={artboardH} onChange={setArtboardHClamped} min={1} max={8000} unit="px" dragRange={1200} />
            <span style={{ width: "1px", height: "16px", background: "var(--border-strong)" }} />
            <button
              onClick={() => setAutoRotate((v) => !v)}
              className="rounded px-2 py-0.5"
              style={{
                background: autoRotate ? "var(--accent)" : "var(--border)",
                color: autoRotate ? "#1c1a17" : "var(--text-primary)",
              }}
              title="カメラの自動回転"
            >
              ↻ 自動回転
            </button>
          </div>
        </div>
      </div>
      {/* end center viewport column */}

      </div>
      {/* end main row (outliner / viewport / inspector) */}

      {exportSettingsDialog}

      {toast && (
        <div
          role="status"
          className="fixed rounded px-3 py-2"
          style={{ left: "50%", bottom: "24px", transform: "translateX(-50%)", zIndex: 70, background: "var(--bg-surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "12px", boxShadow: "0 6px 24px rgba(0,0,0,0.4)" }}
        >
          {toast}
        </div>
      )}

      {pastedImage && (
        <PasteImageDialog
          img={pastedImage.img}
          sizeMm={pastedImage.sizeMm}
          onCancel={() => setPastedImage(null)}
          onChoose={(choice) => {
            const p = pastedImage;
            setPastedImage(null);
            placePastedRef.current(p, choice);
          }}
        />
      )}

      {confirmDialog && (
        <ModalBackdrop zIndex={60} onDismiss={() => setConfirmDialog(null)}>
          <div className="rounded-lg p-4" style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border)", width: "340px" }}>
            <div className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
              {confirmDialog.title}
            </div>
            <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
              {confirmDialog.message}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="flex-1 text-xs rounded py-2"
                style={{ background: "var(--border)", color: "var(--text-primary)" }}
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
                className="flex-1 text-xs rounded py-2"
                style={{ background: "var(--accent)", color: "#1c1a17", fontWeight: 600 }}
              >
                {confirmDialog.confirmLabel || "実行する"}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {layoutEditor &&
        (() => {
          const box = boxInstances.find((b) => b.id === layoutEditor.boxId);
          const slot = box && boxNetSlots(box).find((s) => s.key === layoutEditor.slotKey);
          const net = slot && box.nets?.[slot.key];
          if (!net?.img) return null;
          const display = displayImage(net);
          const dw = imgW(display);
          const dh = imgH(display);
          // the editor can resize the box: everything it needs is a function of the dims
          const isLidded = (box.boxType || "lidded") === "lidded";
          const dimFields = [...boxDimFields(box), ...(isLidded ? [{ key: "lidH", label: "蓋の高さ", max: 200 }] : [])];
          const dims = Object.fromEntries(dimFields.map((f) => [f.key, box[f.key]]));
          const slotFor = (d) => boxNetSlots({ ...box, ...d }).find((x) => x.key === slot.key);
          return (
            <NetLayoutEditor
              title={`面の配置 — ${slot.label}`}
              image={display}
              facesFor={(d) =>
                faceRegions(slotFor(d)).map((r) => ({
                  key: r.key,
                  label: r.label || FACE_LABELS[r.key] || r.key,
                  wMm: r.w,
                  hMm: r.h,
                  tx: r.x + r.w / 2,
                  ty: r.y + r.h / 2,
                  arrowRotate: r.arrowRotate || 0,
                }))
              }
              dims={dims}
              dimFields={dimFields}
              linked={linkedDims}
              onToggleLink={toggleLinkedDim}
              layout={net.faceLayout || defaultFaceLayout(slot, net, dw, dh)}
              // "template" reset ignores any old whole-net trim: the template fitted to the image
              defaultLayoutFor={(d) => defaultFaceLayout(slotFor(d), { ...net, transform: { rotate: net.transform?.rotate || 0 } }, dw, dh)}
              guideColor={guideColor}
              onGuideColorChange={setGuideColor}
              onCancel={() => setLayoutEditor(null)}
              onApply={(faceLayout, nextDims) => {
                updateBox(box.id, nextDims);
                setBoxNet(box.id, slot.key, { faceLayout });
                setLayoutEditor(null);
              }}
            />
          );
        })()}
      {cropEditor && (
        <CropEditorModal
          img={cropEditor.img}
          aspectW={cropEditor.aspectW}
          aspectH={cropEditor.aspectH}
          initialCrop={cropEditor.initialCrop}
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
