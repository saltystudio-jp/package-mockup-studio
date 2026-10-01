import React, { useEffect, useMemo, useRef, useState } from "react";
import { imgW, imgH, hexToRgba } from "../lib/imaging.js";
import ToggleSwitch from "./ToggleSwitch.jsx";
import ModalBackdrop from "./ModalBackdrop.jsx";
import ScrubField from "./ScrubField.jsx";
import SegmentedControl from "./SegmentedControl.jsx";
import DimensionFields from "./DimensionFields.jsx";
import { sectionTitle, sectionMeta, buttonStyle } from "../lib/ui.js";
import { DEFAULT_GUIDE_COLOR } from "../lib/nets.js";
import { connectedFaces } from "../lib/netLayout.js";
import { changeDims } from "../lib/dims.js";

const CONTROLS_W = 268;
const SNAP_PX = 8; // screen px
const HANDLE_PX = 6; // half-size of a handle, screen px
const SNAP_GUIDE = "#ff4fa3"; // literal: drawn over arbitrary artwork
const MARQUEE = "#7fb2ff";
const MIN_DIM = 5; // mm

// Places each face of a box's net on the uploaded sheet as its own rectangle, and can
// resize the box itself while doing it.
//
//  - Click a face to select it; Shift-click adds/removes; drag on empty space draws a
//    selection box (範囲選択), and a click outside the selected faces clears it.
//    Dragging any selected face moves the whole selection; with several selected, the
//    corners of the selection's outline scale it (the print scale) about the opposite corner.
//  - Handles on the one selected face, in one of two modes:
//      箱のサイズ — edges and corners resize the BOX: the face's width/height maps to
//                   whichever box dimension produces it (found numerically from the
//                   templates, so it works for every box type), the joined faces follow
//                   the template's new arrangement, and the opposite edge stays put.
//                   The chain toggles lock dimension ratios, here and in the inspector.
//      印刷の縮尺 — corners scale the print scale for the whole sheet (every face
//                   shares one scale, see netLayout.js): faces joined to it scale with it
//                   around its centre; faces not joined scale in place.
//  - Edges snap to other faces' edges and to the image border. Toggle it off, or hold Alt.
//
// Props: `image` is the display image; `facesFor(dims)` lists the faces for a set of box
// dimensions as [{ key, label, wMm, hMm, arrowRotate, tx, ty }] (tx/ty: the face's centre
// on the template net, mm); `dims`/`dimFields` are the editable box dimensions;
// `layout` is { k, centers } in the stored normalized form and `defaultLayoutFor(dims)`
// gives the template placement. onApply(layout, dims).
export default function NetLayoutEditor({
  title,
  image,
  facesFor,
  dims: initialDims,
  dimFields,
  linked,
  onToggleLink,
  layout,
  defaultLayoutFor,
  guideColor,
  onGuideColorChange,
  onApply,
  onCancel,
}) {
  const dispW = imgW(image);
  const dispH = imgH(image);
  const [displaySrc] = useState(() => (image.src ? image.src : image.toDataURL()));
  const strokeColor = /^#/.test(guideColor || "") ? guideColor : DEFAULT_GUIDE_COLOR;

  // working state in display-image pixels, plus the box dimensions being edited
  const fromStored = (l, dims) => ({
    dims,
    pxPerMm: l.k * dispW,
    centers: Object.fromEntries(facesFor(dims).map((f) => [f.key, (l.centers[f.key] || [0.5, 0.5]).map((v, i) => v * (i ? dispH : dispW))])),
  });
  const [state, setState] = useState(() => fromStored(layout, initialDims));
  const { pxPerMm, centers } = state;
  const faces = useMemo(() => facesFor(state.dims), [state.dims]); // eslint-disable-line react-hooks/exhaustive-deps
  const facesOf = (st) => (st.dims === state.dims ? faces : facesFor(st.dims));
  const byKey = (list) => Object.fromEntries(list.map((f) => [f.key, f]));
  const rectsOf = (st = state) =>
    Object.fromEntries(
      facesOf(st).map((f) => {
        const w = f.wMm * st.pxPerMm;
        const h = f.hMm * st.pxPerMm;
        const [cx, cy] = st.centers[f.key] || [dispW / 2, dispH / 2];
        return [f.key, { x: cx - w / 2, y: cy - h / 2, w, h }];
      })
    );
  const rects = rectsOf();

  // which box dimension drives each face's width and height, and by how much (lid
  // faces are W + 2×clearance, sleeve tray faces are inset, …): nudge each dimension
  // and watch which face sizes move
  const axisDims = useMemo(() => {
    const base = byKey(faces);
    const out = Object.fromEntries(faces.map((f) => [f.key, { w: null, h: null }]));
    dimFields.forEach(({ key }) => {
      const moved = byKey(facesFor({ ...state.dims, [key]: state.dims[key] + 10 }));
      faces.forEach((f) => {
        ["w", "h"].forEach((axis) => {
          const c = ((moved[f.key]?.[axis + "Mm"] ?? 0) - base[f.key][axis + "Mm"]) / 10;
          if (Math.abs(c) > 0.5 && (!out[f.key][axis] || Math.abs(c) > Math.abs(out[f.key][axis].c))) out[f.key][axis] = { key, c };
        });
      });
    });
    return out;
  }, [faces]); // eslint-disable-line react-hooks/exhaustive-deps

  const [selection, setSelection] = useState(() => new Set(faces[0] ? [faces[0].key] : []));
  const single = selection.size === 1 ? [...selection][0] : null;
  const [handleMode, setHandleMode] = useState("size"); // "size" | "scale"
  const [snapOn, setSnapOn] = useState(true);
  const [guides, setGuides] = useState([]); // [{ axis: "x"|"y", at }] in image px
  const [linkedFaces, setLinkedFaces] = useState(null); // faces moving with the one being edited
  const [marquee, setMarquee] = useState(null); // { x0, y0, x1, y1 } image px

  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const stageW = Math.max(320, Math.min(1400, viewport.w - 96 - CONTROLS_W));
  const stageH = Math.max(240, Math.min(900, viewport.h - 120));
  const fitView = () => {
    const v = Math.min(stageW / dispW, stageH / dispH) * 0.9;
    return { v, ox: (stageW - dispW * v) / 2, oy: (stageH - dispH * v) / 2 };
  };
  const [view, setView] = useState(fitView);
  const toImage = (sx, sy) => [(sx - view.ox) / view.v, (sy - view.oy) / view.v];

  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const localPoint = (e) => {
    const r = stageRef.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  // ---- snapping ----
  const edgesX = (r) => [r.x, r.x + r.w];
  const edgesY = (r) => [r.y, r.y + r.h];
  // best shift (image px) that puts one of `mine` on one of `targets`, within the snap distance
  const bestShift = (mine, targets) => {
    let best = null;
    mine.forEach((m) =>
      targets.forEach((t) => {
        const d = t - m;
        if (Math.abs(d) * view.v <= SNAP_PX && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
      })
    );
    return best;
  };
  const snapTargets = (rs, exclude) => {
    const xs = [0, dispW];
    const ys = [0, dispH];
    Object.entries(rs).forEach(([k, r]) => {
      if (exclude.has(k)) return;
      xs.push(...edgesX(r));
      ys.push(...edgesY(r));
    });
    return { xs, ys };
  };

  // ---- geometry steps ----
  const joinedTo = (key, st = state) => connectedFaces(rectsOf(st), key, Math.max(1, 0.3 * st.pxPerMm));

  // one print-scale step for the whole sheet: faces in `group` (joined to the face being
  // scaled, or the selection) scale around `pivot` and keep their arrangement; every
  // other face scales in place around its own centre
  function scaled(st0, pivot, s, group) {
    const [cx, cy] = pivot;
    const centersNext = { ...st0.centers };
    group.forEach((k) => {
      const [x, y] = st0.centers[k];
      centersNext[k] = [cx + (x - cx) * s, cy + (y - cy) * s];
    });
    return { ...st0, pxPerMm: st0.pxPerMm * s, centers: centersNext };
  }

  // new box dimensions: faces in `group` (joined to the anchor face) follow the
  // template's new arrangement; then everything in it shifts so the anchor point — a
  // spot on the anchor face given as fractions of its size — stays where it was. Faces
  // outside the group keep their centres and resize in place.
  function resized(st0, dims, group, anchor) {
    const f0 = byKey(facesFor(st0.dims));
    const f1 = byKey(facesFor(dims));
    const p = st0.pxPerMm;
    const c = { ...st0.centers };
    group.forEach((k) => {
      if (!f0[k] || !f1[k]) return;
      c[k] = [st0.centers[k][0] + (f1[k].tx - f0[k].tx) * p, st0.centers[k][1] + (f1[k].ty - f0[k].ty) * p];
    });
    const a0 = f0[anchor.key];
    const a1 = f1[anchor.key];
    const before = [st0.centers[anchor.key][0] + (anchor.fx - 0.5) * a0.wMm * p, st0.centers[anchor.key][1] + (anchor.fy - 0.5) * a0.hMm * p];
    const after = [c[anchor.key][0] + (anchor.fx - 0.5) * a1.wMm * p, c[anchor.key][1] + (anchor.fy - 0.5) * a1.hMm * p];
    const dx = before[0] - after[0];
    const dy = before[1] - after[1];
    group.forEach((k) => {
      if (c[k]) c[k] = [c[k][0] + dx, c[k][1] + dy];
    });
    return { ...st0, dims, centers: c };
  }

  // ---- pointer ----
  // handles of the single selected face, as (hx, hy) ∈ {-1,0,1}²: corners, plus edge
  // midpoints in size mode — only along axes some box dimension actually drives
  const handlesOf = (key) => {
    if (!key) return [];
    const ax = axisDims[key] || {};
    const out = [];
    [-1, 0, 1].forEach((hy) =>
      [-1, 0, 1].forEach((hx) => {
        if (!hx && !hy) return;
        if (handleMode === "scale") {
          if (hx && hy) out.push([hx, hy]);
          return;
        }
        if ((hx && !ax.w) || (hy && !ax.h)) return;
        out.push([hx, hy]);
      })
    );
    return out;
  };
  const handlePos = (r, [hx, hy]) => [r.x + ((hx + 1) / 2) * r.w, r.y + ((hy + 1) / 2) * r.h];
  // what the handles are on: the one selected face, or — with several selected — the
  // selection's outline, whose corners scale the selection (拡大縮小) in either mode
  const handleTarget = () => {
    if (selection.size > 1 && selBox) {
      return { multi: true, rect: { x: selBox.x, y: selBox.y, w: selBox.x1 - selBox.x, h: selBox.y1 - selBox.y }, handles: [[-1, -1], [1, -1], [-1, 1], [1, 1]] };
    }
    if (single) return { multi: false, rect: rects[single], handles: handlesOf(single) };
    return null;
  };
  const hitHandle = (ix, iy) => {
    const tgt = handleTarget();
    if (!tgt) return null;
    const r = tgt.rect;
    const tol = (HANDLE_PX + 3) / view.v;
    return tgt.handles.find((h) => {
      const [px, py] = handlePos(r, h);
      return Math.abs(ix - px) <= tol && Math.abs(iy - py) <= tol;
    });
  };
  const hitFace = (ix, iy) => {
    for (let i = faces.length - 1; i >= 0; i--) {
      const r = rects[faces[i].key];
      if (ix >= r.x && ix <= r.x + r.w && iy >= r.y && iy <= r.y + r.h) return faces[i].key;
    }
    return null;
  };

  const onPointerDown = (e) => {
    const [sx, sy] = localPoint(e);
    const [ix, iy] = toImage(sx, sy);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      dragRef.current = { mode: "pan", sx, sy, view0: view };
      return;
    }
    const handle = hitHandle(ix, iy);
    if (handle) {
      const tgt = handleTarget();
      if (tgt.multi) {
        // the selection scales about its opposite corner, like any design tool
        const group = new Set(selection);
        setLinkedFaces(group);
        const c = handlePos(tgt.rect, [-handle[0], -handle[1]]);
        const [px, py] = handlePos(tgt.rect, handle);
        dragRef.current = { mode: "scale", state0: state, rects0: rects, box: tgt.rect, group, c, s0: [px - c[0], py - c[1]] };
        return;
      }
      const group = joinedTo(single);
      setLinkedFaces(group);
      if (handleMode === "scale") {
        const c = state.centers[single];
        const [px, py] = handlePos(rects[single], handle);
        dragRef.current = { mode: "scale", state0: state, rects0: rects, box: rects[single], group, c, s0: [px - c[0], py - c[1]] };
      } else {
        dragRef.current = { mode: "size", key: single, handle, state0: state, rects0: rects, group };
      }
      return;
    }
    const face = hitFace(ix, iy);
    if (face) {
      if (e.shiftKey) {
        setSelection((prev) => {
          const next = new Set(prev);
          if (next.has(face)) next.delete(face);
          else next.add(face);
          return next;
        });
        return;
      }
      const moving = selection.has(face) ? [...selection] : [face];
      if (!selection.has(face)) setSelection(new Set([face]));
      dragRef.current = { mode: "move", moving, ix, iy, state0: state };
      return;
    }
    // a click outside the selected faces drops the selection (Shift keeps it and adds)
    if (!e.shiftKey) setSelection(new Set());
    dragRef.current = { mode: "marquee", ix, iy, additive: e.shiftKey, base: new Set(selection) };
    setMarquee({ x0: ix, y0: iy, x1: ix, y1: iy });
  };

  const marqueeHits = (m) => {
    const x0 = Math.min(m.x0, m.x1);
    const x1 = Math.max(m.x0, m.x1);
    const y0 = Math.min(m.y0, m.y1);
    const y1 = Math.max(m.y0, m.y1);
    return faces.filter((f) => {
      const r = rects[f.key];
      return r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0;
    }).map((f) => f.key);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const [sx, sy] = localPoint(e);
    if (d.mode === "pan") {
      setView({ ...d.view0, ox: d.view0.ox + (sx - d.sx), oy: d.view0.oy + (sy - d.sy) });
      return;
    }
    const [ix, iy] = toImage(sx, sy);
    const snapping = snapOn && !e.altKey;

    if (d.mode === "marquee") {
      const m = { x0: d.ix, y0: d.iy, x1: ix, y1: iy };
      setMarquee(m);
      setSelection(new Set([...(d.additive ? d.base : []), ...marqueeHits(m)]));
      return;
    }

    if (d.mode === "move") {
      let dx = ix - d.ix;
      let dy = iy - d.iy;
      const shifted = (ox, oy) => ({
        ...d.state0,
        centers: { ...d.state0.centers, ...Object.fromEntries(d.moving.map((k) => [k, [d.state0.centers[k][0] + ox, d.state0.centers[k][1] + oy]])) },
      });
      const next = [];
      if (snapping) {
        const trial = rectsOf(shifted(dx, dy));
        const others = snapTargets(trial, new Set(d.moving));
        // a single face snaps by any of its edges; a selection by its outline
        const mine = d.moving.map((k) => trial[k]);
        const mx = mine.flatMap(edgesX);
        const my = mine.flatMap(edgesY);
        const bx = bestShift(d.moving.length > 1 ? [Math.min(...mx), Math.max(...mx)] : mx, others.xs);
        const by = bestShift(d.moving.length > 1 ? [Math.min(...my), Math.max(...my)] : my, others.ys);
        if (bx) {
          dx += bx.d;
          next.push({ axis: "x", at: bx.at });
        }
        if (by) {
          dy += by.d;
          next.push({ axis: "y", at: by.at });
        }
      }
      setGuides(next);
      setState(shifted(dx, dy));
      return;
    }

    if (d.mode === "size") {
      const [hx, hy] = d.handle;
      const r0 = d.rects0[d.key];
      const p = d.state0.pxPerMm;
      const ax = axisDims[d.key];
      const targets = snapping ? snapTargets(d.rects0, d.group) : { xs: [], ys: [] };
      const next = [];
      // where the dragged edge(s) want to be, snapped
      let ex = ix;
      let ey = iy;
      if (hx) {
        const b = bestShift([ex], targets.xs);
        if (b) {
          ex += b.d;
          next.push({ axis: "x", at: b.at });
        }
      }
      if (hy) {
        const b = bestShift([ey], targets.ys);
        if (b) {
          ey += b.d;
          next.push({ axis: "y", at: b.at });
        }
      }
      const wantW = hx > 0 ? ex - r0.x : r0.x + r0.w - ex;
      const wantH = hy > 0 ? ey - r0.y : r0.y + r0.h - ey;
      const step = (dims, info, wantPx, axis) => {
        const cur = byKey(facesFor(dims))[d.key][axis + "Mm"];
        return changeDims(dims, info.key, dims[info.key] + (wantPx / p - cur) / info.c, linked, MIN_DIM);
      };
      let dims = d.state0.dims;
      if (hx && hy && linked.has(ax.w.key) && linked.has(ax.h.key)) {
        // both edges are tied to one locked ratio: follow whichever moved further
        const rw = Math.abs(wantW / r0.w - 1);
        const rh = Math.abs(wantH / r0.h - 1);
        dims = rw >= rh ? step(dims, ax.w, wantW, "w") : step(dims, ax.h, wantH, "h");
      } else {
        if (hx) dims = step(dims, ax.w, wantW, "w");
        if (hy) dims = step(dims, ax.h, wantH, "h");
      }
      setGuides(next);
      setState(resized(d.state0, dims, d.group, { key: d.key, fx: hx > 0 ? 0 : hx < 0 ? 1 : 0.5, fy: hy > 0 ? 0 : hy < 0 ? 1 : 0.5 }));
      return;
    }

    if (d.mode === "scale") {
      const [c0x, c0y] = d.c;
      const [s0x, s0y] = d.s0;
      let s = ((ix - c0x) * s0x + (iy - c0y) * s0y) / (s0x * s0x + s0y * s0y);
      s = Math.max(0.05, s);
      const next = [];
      if (snapping) {
        // manipulated edge = c + a·s; a free face's edge = cj + b·s (it scales in place);
        // an image edge is fixed. Solve each pairing for s, keep the nearest in reach.
        // the scaled outline's edges, as offsets from the pivot
        const aX = [d.box.x - c0x, d.box.x + d.box.w - c0x];
        const aY = [d.box.y - c0y, d.box.y + d.box.h - c0y];
        let best = null;
        const consider = (axis, a, cm, target, b) => {
          const denom = a - b;
          if (Math.abs(denom) < 1e-9) return;
          const sStar = (target - cm) / denom;
          if (sStar < 0.05) return;
          const gapNow = Math.abs(cm + a * s - (target + b * s)) * view.v;
          if (gapNow > SNAP_PX) return;
          if (!best || Math.abs(sStar - s) < Math.abs(best.s - s)) best = { s: sStar, axis, at: (cmAt) => cm + a * cmAt };
        };
        aX.forEach((a) => {
          consider("x", a, c0x, 0, 0);
          consider("x", a, c0x, dispW, 0);
        });
        aY.forEach((a) => {
          consider("y", a, c0y, 0, 0);
          consider("y", a, c0y, dispH, 0);
        });
        Object.entries(d.rects0).forEach(([k, rj]) => {
          if (d.group.has(k)) return; // joined faces move with it, never a target
          const [cjx, cjy] = d.state0.centers[k];
          aX.forEach((a) => [-rj.w / 2, rj.w / 2].forEach((b) => consider("x", a, c0x, cjx, b)));
          aY.forEach((a) => [-rj.h / 2, rj.h / 2].forEach((b) => consider("y", a, c0y, cjy, b)));
        });
        if (best) {
          s = best.s;
          next.push({ axis: best.axis, at: best.at(s) });
        }
      }
      setGuides(next);
      setState(scaled(d.state0, d.c, s, d.group));
    }
  };
  const onPointerUp = () => {
    dragRef.current = null;
    setGuides([]);
    setLinkedFaces(null);
    setMarquee(null);
  };
  // hover feedback: a move cursor over faces, a resize cursor over the handles
  const [hoverCursor, setHoverCursor] = useState("default");
  const onHover = (e) => {
    if (dragRef.current) return;
    const [ix, iy] = toImage(...localPoint(e));
    const h = hitHandle(ix, iy);
    if (h) {
      const [hx, hy] = h;
      setHoverCursor(!hx ? "ns-resize" : !hy ? "ew-resize" : hx === hy ? "nwse-resize" : "nesw-resize");
    } else setHoverCursor(hitFace(ix, iy) ? "move" : "crosshair");
  };

  // ---- panel actions ----
  const anchorKey = single || [...selection][0] || faces[0]?.key;
  // the scale typed as dpi, applied like a corner drag on the selected face
  const setDpi = (dpiValue) => {
    const target = dpiValue / 25.4;
    if (!(target > 0)) return;
    setState((st) => scaled(st, st.centers[anchorKey], target / st.pxPerMm, joinedTo(anchorKey, st)));
  };
  // box dimensions typed in: the selected face (or the first one) stays centred
  const setDims = (dims) => setState((st) => resized(st, dims, joinedTo(anchorKey, st), { key: anchorKey, fx: 0.5, fy: 0.5 }));
  // the selection's top-left, in mm from the image's top-left
  const selRects = [...selection].map((k) => rects[k]).filter(Boolean);
  const selBox = selRects.length
    ? {
        x: Math.min(...selRects.map((r) => r.x)),
        y: Math.min(...selRects.map((r) => r.y)),
        x1: Math.max(...selRects.map((r) => r.x + r.w)),
        y1: Math.max(...selRects.map((r) => r.y + r.h)),
      }
    : null;
  const moveSelection = (dx, dy) =>
    setState((st) => ({
      ...st,
      centers: { ...st.centers, ...Object.fromEntries([...selection].map((k) => [k, [st.centers[k][0] + dx, st.centers[k][1] + dy]])) },
    }));
  const setSelPos = (axis, mm) => {
    if (!selBox) return;
    const px = mm * pxPerMm;
    if (axis === "x") moveSelection(px - selBox.x, 0);
    else moveSelection(0, px - selBox.y);
  };

  // wheel zooms the VIEW (not the layout) around the cursor; bound natively so it can
  // stop the page from scrolling
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      setView((vw) => {
        const v = Math.min(20, Math.max(0.02, vw.v * (1 - e.deltaY * 0.0012)));
        const k = v / vw.v;
        return { v, ox: sx - (sx - vw.ox) * k, oy: sy - (sy - vw.oy) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // arrow keys nudge the selection by 1px of the image (Shift: 10px); Ctrl+A selects all
  useEffect(() => {
    const onKey = (e) => {
      // only when nothing else wants the keys — not a number field, button or toggle
      const ae = document.activeElement;
      if (ae && ae !== document.body && ae !== stageRef.current) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(new Set(faces.map((f) => f.key)));
        return;
      }
      if (!selection.size || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      moveSelection(e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, faces]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    onApply(
      {
        k: pxPerMm / dispW,
        centers: Object.fromEntries(Object.entries(centers).map(([k, [x, y]]) => [k, [x / dispW, y / dispH]])),
      },
      state.dims
    );
  };

  const singleFace = single ? faces.find((f) => f.key === single) : null;
  const dpi = Math.round(pxPerMm * 25.4);
  const S = (x) => view.ox + x * view.v;
  const T = (y) => view.oy + y * view.v;
  const dimsChanged = dimFields.some((f) => state.dims[f.key] !== initialDims[f.key]);

  return (
    <ModalBackdrop onDismiss={onCancel}>
      <div className="rounded-lg p-4 flex gap-4" style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border)", maxWidth: "calc(100vw - 32px)" }}>
        <div
          ref={stageRef}
          tabIndex={0}
          aria-label="展開図の面の配置"
          onPointerDown={(e) => {
            stageRef.current?.focus({ preventScroll: true }); // so the arrow keys reach the selection
            onPointerDown(e);
          }}
          onPointerMove={(e) => {
            onHover(e);
            onPointerMove(e);
          }}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            outline: "none",
            width: stageW,
            height: stageH,
            position: "relative",
            overflow: "hidden",
            background: "repeating-conic-gradient(#2a2a2a 0% 25%, #222 0% 50%) 0 0 / 16px 16px",
            touchAction: "none",
            borderRadius: "4px",
            flexShrink: 0,
            cursor: dragRef.current?.mode === "pan" ? "grabbing" : hoverCursor,
          }}
        >
          <img
            src={displaySrc}
            draggable={false}
            alt="展開図の画像"
            style={{ position: "absolute", left: view.ox, top: view.oy, width: dispW * view.v, height: dispH * view.v, maxWidth: "none", pointerEvents: "none", userSelect: "none" }}
          />
          <svg width={stageW} height={stageH} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <rect x={S(0)} y={T(0)} width={dispW * view.v} height={dispH * view.v} fill="none" stroke="rgba(255,255,255,0.25)" />
            {faces.map((f) => {
              const r = rects[f.key];
              const isSel = selection.has(f.key);
              const isLinked = linkedFaces?.has(f.key);
              const x = S(r.x);
              const y = T(r.y);
              const w = r.w * view.v;
              const h = r.h * view.v;
              const cx = x + w / 2;
              const cy = y + h / 2;
              return (
                <g key={f.key}>
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    fill={hexToRgba(strokeColor, isLinked ? 0.22 : isSel ? 0.14 : 0.06)}
                    stroke={strokeColor}
                    strokeWidth={isSel ? 2 : 1.25}
                    strokeDasharray={isSel ? undefined : "6 4"}
                  />
                  {w > 24 && h > 24 && (
                    <g transform={`translate(${cx},${cy}) rotate(${f.arrowRotate || 0})`} stroke="#ffb454" strokeWidth={1.5} fill="none">
                      <path d="M0 9 L0 -9 M-5 -3 L0 -9 L5 -3" />
                    </g>
                  )}
                  {w > 40 && h > 18 && (
                    <text x={cx} y={y + 13} fill="#eef6f6" fontSize={11} textAnchor="middle" fontFamily="Inter, sans-serif" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}>
                      {f.label}
                    </text>
                  )}
                </g>
              );
            })}
            {/* the selection's outline when it's more than one face */}
            {selBox && selection.size > 1 && (
              <rect
                x={S(selBox.x) - 3}
                y={T(selBox.y) - 3}
                width={(selBox.x1 - selBox.x) * view.v + 6}
                height={(selBox.y1 - selBox.y) * view.v + 6}
                fill="none"
                stroke={MARQUEE}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}
            {(() => {
              const tgt = handleTarget();
              if (!tgt) return null;
              return tgt.handles.map((h) => {
                const [hx, hy] = handlePos(tgt.rect, h);
                const corner = h[0] && h[1];
                // white squares scale (印刷の縮尺, or a multi-face selection); orange ones resize the box
                return handleMode === "scale" || tgt.multi ? (
                  <rect key={h.join()} x={S(hx) - HANDLE_PX} y={T(hy) - HANDLE_PX} width={HANDLE_PX * 2} height={HANDLE_PX * 2} fill="#ffffff" stroke={strokeColor} strokeWidth={1.5} />
                ) : (
                  // size handles are filled with the accent so the two modes never look alike
                  <rect
                    key={h.join()}
                    x={S(hx) - (corner ? HANDLE_PX : HANDLE_PX - 1)}
                    y={T(hy) - (corner ? HANDLE_PX : HANDLE_PX - 1)}
                    width={(corner ? HANDLE_PX : HANDLE_PX - 1) * 2}
                    height={(corner ? HANDLE_PX : HANDLE_PX - 1) * 2}
                    fill="#ffb454"
                    stroke="#1c1a17"
                    strokeWidth={1}
                  />
                );
              });
            })()}
            {marquee && (
              <rect
                x={S(Math.min(marquee.x0, marquee.x1))}
                y={T(Math.min(marquee.y0, marquee.y1))}
                width={Math.abs(marquee.x1 - marquee.x0) * view.v}
                height={Math.abs(marquee.y1 - marquee.y0) * view.v}
                fill={hexToRgba(MARQUEE, 0.12)}
                stroke={MARQUEE}
                strokeWidth={1}
              />
            )}
            {guides.map((g, i) =>
              g.axis === "x" ? (
                <line key={i} x1={S(g.at)} x2={S(g.at)} y1={0} y2={stageH} stroke={SNAP_GUIDE} strokeWidth={1} />
              ) : (
                <line key={i} x1={0} x2={stageW} y1={T(g.at)} y2={T(g.at)} stroke={SNAP_GUIDE} strokeWidth={1} />
              )
            )}
          </svg>
        </div>

        <div className="flex flex-col" style={{ width: CONTROLS_W, flexShrink: 0, maxHeight: stageH, overflowY: "auto" }}>
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {title}
            </div>
            {onGuideColorChange && (
              <label className="flex items-center gap-1 text-xs flex-shrink-0" style={{ color: "var(--text-secondary)" }}>
                線の色
                <input
                  type="color"
                  value={strokeColor}
                  onChange={(e) => onGuideColorChange(e.target.value)}
                  style={{ width: "28px", height: "22px", padding: 0, border: "1px solid var(--border)", background: "none", cursor: "pointer" }}
                />
              </label>
            )}
          </div>
          <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
            面のクリックで選択(Shiftで追加)、何もない所のドラッグで範囲選択、Ctrl+Aで全選択、選択の外をクリックで解除。選択した面はドラッグで移動、複数選択中は四隅の白いハンドルで拡大縮小できます。端や角にスナップします(Altで一時解除)。ホイールで表示倍率、右ドラッグで表示を移動。
          </p>

          <div className="mb-2" style={sectionTitle}>
            箱のサイズ
          </div>
          <div className="mb-1">
            <DimensionFields fields={dimFields} values={state.dims} linked={linked} onToggleLink={onToggleLink} onChange={setDims} />
          </div>
          <p className="text-xs mb-3" style={{ color: dimsChanged ? "var(--accent)" : "var(--text-muted)" }}>
            {dimsChanged ? "適用すると3Dの箱のサイズも変わります。" : "チェーンをオンにした寸法どうしは比率を保って変わります。"}
          </p>

          <div className="mb-2" style={sectionTitle}>
            ハンドルの操作
          </div>
          <div className="mb-3">
            <SegmentedControl
              value={handleMode}
              onChange={setHandleMode}
              size="sm"
              options={[
                { value: "size", label: "箱のサイズ" },
                { value: "scale", label: "印刷の縮尺" },
              ]}
            />
            <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>
              {handleMode === "size"
                ? "選択した面の辺・角をドラッグすると、箱の寸法が変わります(反対側の辺は固定)。"
                : "選択した面の角をドラッグすると、全面の縮尺(画像に対する大きさ)が変わります。"}
            </p>
          </div>

          <div className="mb-2" style={sectionTitle}>
            面
          </div>
          {/* every face is selectable from here too — by keyboard, or when it's too
              small to hit on the stage. Shift adds to the selection, as on the stage */}
          <div className="flex flex-wrap gap-1 mb-1.5">
            {faces.map((f) => (
              <button
                key={f.key}
                onClick={(e) =>
                  setSelection((prev) => {
                    if (!e.shiftKey) return new Set([f.key]);
                    const next = new Set(prev);
                    if (next.has(f.key)) next.delete(f.key);
                    else next.add(f.key);
                    return next;
                  })
                }
                style={buttonStyle("quiet", { active: selection.has(f.key) })}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 mb-3">
            <button onClick={() => setSelection(new Set(faces.map((f) => f.key)))} style={buttonStyle("quiet")}>
              すべて選択
            </button>
            <button onClick={() => setSelection(new Set())} style={buttonStyle("quiet")} disabled={!selection.size}>
              選択解除
            </button>
          </div>

          {selBox && (
            <>
              <div className="mb-2" style={sectionTitle}>
                {selection.size > 1 ? `選択範囲の位置(${selection.size}面)` : "位置(画像の左上から)"}
              </div>
              <div className="flex flex-col gap-2 mb-1">
                <ScrubField label="X" value={selBox.x / pxPerMm} onChange={(v) => setSelPos("x", v)} min={-1000} max={2000} step={0.1} decimals={1} unit="mm" dragRange={600} />
                <ScrubField label="Y" value={selBox.y / pxPerMm} onChange={(v) => setSelPos("y", v)} min={-1000} max={2000} step={0.1} decimals={1} unit="mm" dragRange={600} />
              </div>
              <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
                {singleFace ? `${Math.round(singleFace.wMm * 10) / 10} × ${Math.round(singleFace.hMm * 10) / 10} mm。` : ""}
                矢印キーで1px移動(Shiftで10px)。
              </p>
            </>
          )}

          <div className="mb-2" style={sectionTitle}>
            縮尺
          </div>
          <div className="mb-3">
            <ScrubField label="解像度" value={dpi} onChange={setDpi} min={30} max={1200} step={1} unit="dpi" />
          </div>

          <ToggleSwitch checked={snapOn} onChange={setSnapOn} label="スナップ" />

          <div className="mt-3 mb-3 flex flex-col gap-0.5" style={sectionMeta}>
            <span>1mm = {pxPerMm.toFixed(2)} px</span>
            <span>
              画像 {dispW} × {dispH} px
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={() => setView(fitView())} style={buttonStyle("quiet")}>
              画面に合わせる
            </button>
            <button onClick={() => setState(fromStored(defaultLayoutFor(state.dims), state.dims))} style={buttonStyle("quiet")} title="テンプレートの並びで画像に収まるように配置し直す(箱のサイズはそのまま)">
              テンプレートに戻す
            </button>
          </div>

          <div className="flex-1" />
          <div className="flex gap-2 mt-4">
            <button onClick={onCancel} className="flex-1 text-sm rounded py-2" style={{ background: "var(--border)", color: "var(--text-primary)" }}>
              キャンセル
            </button>
            <button onClick={apply} className="flex-1 text-sm rounded py-2" style={{ background: "var(--accent)", color: "#1c1a17", fontWeight: 600 }}>
              適用
            </button>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}
