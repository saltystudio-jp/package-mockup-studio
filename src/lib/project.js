// Saving and loading a whole project (保存 / 開く), and the automatic save in the
// browser that brings the last session back on the next visit.
//
// A project is plain JSON: the scene's objects, the registered library, the scene-wide
// settings and the camera. Pictures (net sheets, card art, the background…) are held
// in the app as <img>/<canvas> objects; here each one becomes a data URL in an
// `images` table — stored once even when several objects share it — and the place it
// was is replaced by { $img: id }. Loading turns them back into decoded <img>s, so the
// rest of the app never sees the difference.

export const PROJECT_EXT = ".pmstudio";
const FORMAT = "package-mockup-studio";
const VERSION = 1;

const dataUrlCache = new WeakMap(); // image object → its data URL, so autosaves stay cheap

function isImage(v) {
  return (
    (typeof HTMLImageElement !== "undefined" && v instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== "undefined" && v instanceof HTMLCanvasElement) ||
    (typeof ImageBitmap !== "undefined" && v instanceof ImageBitmap)
  );
}

function toDataUrl(img) {
  if (dataUrlCache.has(img)) return dataUrlCache.get(img);
  let url;
  if (img instanceof HTMLImageElement && /^data:/.test(img.src)) url = img.src;
  else {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    c.getContext("2d").drawImage(img, 0, 0);
    url = c.toDataURL("image/png");
  }
  dataUrlCache.set(img, url);
  return url;
}

export function serializeProject(data) {
  const images = {};
  const ids = new Map();
  const walk = (v) => {
    if (v == null || typeof v !== "object") return typeof v === "function" ? undefined : v;
    if (isImage(v)) {
      if (!ids.has(v)) {
        const id = `i${ids.size + 1}`;
        ids.set(v, id);
        images[id] = toDataUrl(v);
      }
      return { $img: ids.get(v) };
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Set) return [...v].map(walk);
    if (Object.getPrototypeOf(v) !== Object.prototype) return undefined; // anything else isn't project data
    const out = {};
    Object.entries(v).forEach(([k, x]) => {
      const w = walk(x);
      if (w !== undefined) out[k] = w;
    });
    return out;
  };
  return JSON.stringify({ format: FORMAT, version: VERSION, savedAt: new Date().toISOString(), data: walk(data), images });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像を読み込めませんでした"));
    img.src = src;
  });
}

export async function deserializeProject(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("プロジェクトファイルとして読み込めませんでした。");
  }
  if (parsed?.format !== FORMAT) throw new Error("Package Mockup Studio のプロジェクトファイルではありません。");
  const decoded = {};
  await Promise.all(
    Object.entries(parsed.images || {}).map(async ([id, url]) => {
      const img = await loadImage(url);
      dataUrlCache.set(img, url);
      decoded[id] = img;
    })
  );
  const walk = (v) => {
    if (v == null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v.$img === "string") return decoded[v.$img] || null;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
  };
  return { data: walk(parsed.data), savedAt: parsed.savedAt };
}

// ---- the automatic save, in IndexedDB (localStorage is far too small for pictures) ----
const DB = "package-mockup-studio";
const STORE = "kv";
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function storeGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}
export async function storeSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    if (value == null) tx.objectStore(STORE).delete(key);
    else tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- files: the File System Access API where there is one (Chrome) — so 保存 can
// write back to the same file — and a plain download / file input otherwise ----
export const canPickFiles = typeof window !== "undefined" && "showSaveFilePicker" in window;
const PICKER_TYPES = [{ description: "Package Mockup Studio プロジェクト", accept: { "application/json": [PROJECT_EXT] } }];

export async function writeProjectFile(text, { handle, suggestedName }) {
  if (canPickFiles) {
    const h = handle || (await window.showSaveFilePicker({ suggestedName, types: PICKER_TYPES }));
    const w = await h.createWritable();
    await w.write(new Blob([text], { type: "application/json" }));
    await w.close();
    return h;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return null;
}

export async function readProjectFile() {
  if (canPickFiles) {
    const [h] = await window.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
    const file = await h.getFile();
    return { text: await file.text(), name: file.name, handle: h };
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `${PROJECT_EXT},.json,application/json`;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return reject(new DOMException("cancelled", "AbortError"));
      resolve({ text: await file.text(), name: file.name, handle: null });
    };
    input.click();
  });
}
