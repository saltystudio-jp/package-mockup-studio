// The コンポーネント library: templates to place into the scene or swap an object for.
//
// A template is an object's APPEARANCE — shape, size, color, images — with none of its
// placement. Everything a template carries is copied onto the object when it's placed,
// after which the object owns it outright and is edited in the inspector; the library
// entry itself is never edited in place. That's what lets the library be a plain list
// of starting points: built-in standard sizes below, plus whatever the user registers
// from an object they've already set up.
import { BOX_TYPE_LABEL } from "./boxModels.js";

export const EMPTY_CROP = { cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0, rotate: 0 };

// owned by the scene object and never carried by a template
export const PLACEMENT_KEYS = ["id", "x", "z", "rotY", "tiltX", "tiltZ", "floatHeight", "layer", "groundSnap"];

const CARD_COLOR = "#f3efe6";
const BOARD_COLOR = "#c9b896";
const WOOD_COLOR = "#d6a867";

export const BOX_DEFAULTS = {
  boxType: "lidded",
  orientation: "standing",
  w: 150,
  d: 150,
  h: 45,
  lidH: 20,
  clearance: 2,
  bevelRadius: 2,
  lidOpen: 0,
  // スリーブ: wall thickness of the double-wall tray (the visible rim), and how far out
  // it's pulled
  wallThickness: 6,
  trayOut: 0,
  // net images, keyed by the slot keys from boxNetSlots(): { img, fileName, transform }
  nets: {},
};

export const COMPONENT_DEFAULTS = {
  orientation: "lying",
  kind: "roundedSquare",
  w: 63,
  d: 88,
  thickness: 0.3,
  cornerRadius: 3,
  svgText: null,
  color: CARD_COLOR,
  img: null,
  fileName: "",
  transform: EMPTY_CROP,
};

export const LIBRARY_GROUPS = [
  { key: "box", label: "箱" },
  { key: "card", label: "カード" },
  { key: "token", label: "トークン・駒" },
  { key: "user", label: "登録済み" },
];

const boxPreset = (boxType, dims) => ({
  id: `preset:box-${boxType}`,
  name: BOX_TYPE_LABEL[boxType],
  group: "box",
  objKind: "box",
  template: { ...BOX_DEFAULTS, boxType, ...dims },
});

// standard card sizes, mm. Corner radius and 0.3mm stock are typical of printed cards.
const cardPreset = (key, name, w, d, cornerRadius = 3) => ({
  id: `preset:card-${key}`,
  name,
  group: "card",
  objKind: "component",
  template: { ...COMPONENT_DEFAULTS, kind: "roundedSquare", w, d, thickness: 0.3, cornerRadius, color: CARD_COLOR },
});

// punchboard tokens are ~2mm board; wooden bits are their own solid thickness
const tokenPreset = (key, name, kind, w, d, thickness, color, cornerRadius = 0) => ({
  id: `preset:token-${key}`,
  name,
  group: "token",
  objKind: "component",
  template: { ...COMPONENT_DEFAULTS, kind, w, d, thickness, cornerRadius, color },
});

export const PRESET_ITEMS = [
  boxPreset("lidded", { w: 150, d: 150, h: 45, lidH: 20 }),
  boxPreset("caramel", { w: 68, d: 95, h: 22 }),
  boxPreset("sleeve", { w: 150, d: 100, h: 40 }),

  cardPreset("poker", "ポーカー", 63, 88),
  cardPreset("bridge", "ブリッジ", 57, 89),
  cardPreset("euro", "ユーロ", 59, 92),
  cardPreset("small", "スモール", 59, 86),
  cardPreset("mini-euro", "ミニユーロ", 44, 68, 2.5),
  cardPreset("mini-us", "ミニアメリカン", 41, 63, 2.5),
  cardPreset("tarot", "タロット", 70, 120, 4),
  cardPreset("square", "スクエア", 70, 70),

  tokenPreset("chit16", "丸チット 16", "circle", 16, 16, 2, BOARD_COLOR),
  tokenPreset("chit20", "丸チット 20", "circle", 20, 20, 2, BOARD_COLOR),
  tokenPreset("chit25", "丸チット 25", "circle", 25, 25, 2, BOARD_COLOR),
  tokenPreset("chit30", "丸チット 30", "circle", 30, 30, 2, BOARD_COLOR),
  tokenPreset("tile25", "角タイル 25", "roundedSquare", 25, 25, 2, BOARD_COLOR, 1),
  tokenPreset("hex30", "六角タイル 30", "hexagon", 30, 30, 2, BOARD_COLOR),
  tokenPreset("disc16", "木製ディスク 16", "circle", 16, 16, 5, WOOD_COLOR),
  tokenPreset("cube8", "木製キューブ 8", "roundedSquare", 8, 8, 8, WOOD_COLOR, 0.8),
];

export function sizeLabel(item) {
  const t = item.template;
  const r = (v) => Math.round(v * 10) / 10;
  return item.objKind === "box" ? `${r(t.w)}×${r(t.d)}×${r(t.h)}` : `${r(t.w)}×${r(t.d)}`;
}

// snapshot of an object's appearance. Net slot objects are copied so later edits to
// the object (a new crop, a replaced image) can't reach back into the saved template;
// the image elements themselves are immutable and safely shared.
export function templateFromObject(obj) {
  const template = { ...obj };
  PLACEMENT_KEYS.forEach((k) => delete template[k]);
  delete template.name;
  if (template.nets) {
    template.nets = Object.fromEntries(Object.entries(template.nets).map(([k, v]) => [k, { ...v }]));
  }
  if (template.transform) template.transform = { ...template.transform };
  return template;
}

// the object half of a template: defaults for its kind, then the template, fresh copies
// of anything nested (so two objects placed from one template never share a mutable
// net/crop record)
export function objectFieldsFromTemplate(item) {
  const defaults = item.objKind === "box" ? BOX_DEFAULTS : COMPONENT_DEFAULTS;
  const fields = { ...defaults, ...templateFromObject(item.template), name: item.name };
  if (fields.nets) fields.nets = Object.fromEntries(Object.entries(fields.nets).map(([k, v]) => [k, { ...v }]));
  return fields;
}
