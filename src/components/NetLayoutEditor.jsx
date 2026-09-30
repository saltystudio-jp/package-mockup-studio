import React, { useEffect, useRef, useState } from "react";
import { imgW, imgH, hexToRgba } from "../lib/imaging.js";
import ToggleSwitch from "./ToggleSwitch.jsx";
import ScrubField from "./ScrubField.jsx";
import { sectionTitle, sectionMeta, buttonStyle } from "../lib/ui.js";
import { DEFAULT_GUIDE_COLOR } from "../lib/nets.js";
import { connectedFaces } from "../lib/netLayout.js";

const CONTROLS_W = 260;
const SNAP_PX = 8; // screen px
const HANDLE_PX = 7; // half-size of a corner handle, screen px
const SNAP_GUIDE = "#ff4fa3"; // literal: drawn over arbitrary artwork

// Places each face of a box's net on the uploaded sheet as its own rectangle.
//
//  - Drag a face to move it; drag empty space to move the whole layout.
//  - Drag a corner handle of the selected face to scale. Every face shares one print
//    scale (see netLayout.js), so scaling one scales them all: faces joined to it (edge
//    or corner touching) scale with it around its centre and stay joined; faces not
//    joined to it scale in place around their own centres.
//  - Edges snap to other faces' edges and to the image border — horizontally,
//    vertically, and so corner to corner — whether or not the faces are joined. Toggle
//    it off, or hold Alt.
//
// Props: `image` is the display image (upload + the user's 90° rotation); `faces` is
// [{ key, label, wMm, hMm, arrowRotate }]; `layout`/`defaultLayout` are { k, centers }
// in the stored normalized form. onApply gets the new layout in that form.
export default function NetLayoutEditor({ title, image, faces, layout, defaultLayout, guideColor, onGuideColorChange, onApply, onCancel }) {
  const dispW = imgW(image);
  const dispH = imgH(image);
  const [displaySrc] = useState(() => (image.src ? image.src : image.toDataURL()));
  const strokeColor = /^#/.test(guideColor || "") ? guideColor : DEFAULT_GUIDE_COLOR;

  // working state in display-image pixels
  const fromStored = (l) => ({
    pxPerMm: l.k * dispW,
    centers: Object.fromEntries(faces.map((f) => [f.key, (l.centers[f.key] || [0.5, 0.5]).map((v, i) => v * (i ? dispH : dispW))])),
  });
  const [state, setState] = useState(() => fromStored(layout));
  const { pxPerMm, centers } = state;
  const rectOf = (key, st = state) => {
    const f = faces.find((x) => x.key === key);
    const w = f.wMm * st.pxPerMm;
    const h = f.hMm * st.pxPerMm;
    const [cx, cy] = st.centers[key];
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  };
  const rectsOf = (st = state) => Object.fromEntries(faces.map((f) => [f.key, rectOf(f.key, st)]));

  const [selected, setSelected] = useState(faces[0]?.key ?? null);
  const [snapOn, setSnapOn] = useState(true);
  const [guides, setGuides] = useState([]); // [{ axis: "x"|"y", at }] in image px
  const [linked, setLinked] = useState(null); // faces moving with the one being scaled

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
  const snapTargets = (rects, exclude) => {
    const xs = [0, dispW];
    const ys = [0, dispH];
    Object.entries(rects).forEach(([k, r]) => {
      if (exclude.has(k)) return;
      xs.push(...edgesX(r));
      ys.push(...edgesY(r));
    });
    return { xs, ys };
  };

  // ---- pointer ----
  const hitHandle = (ix, iy) => {
    if (!selected) return null;
    const r = rectOf(selected);
    const tol = (HANDLE_PX + 3) / view.v;
    const corners = [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x, r.y + r.h],
      [r.x + r.w, r.y + r.h],
    ];
    return corners.find(([cx, cy]) => Math.abs(ix - cx) <= tol && Math.abs(iy - cy) <= tol) || null;
  };
  const hitFace = (ix, iy) => {
    for (let i = faces.length - 1; i >= 0; i--) {
      const r = rectOf(faces[i].key);
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
    const corner = hitHandle(ix, iy);
    if (corner) {
      const rects = rectsOf();
      const eps = Math.max(1, 0.3 * pxPerMm);
      const group = connectedFaces(rects, selected, eps);
      const c = state.centers[selected];
      dragRef.current = { mode: "scale", key: selected, state0: state, rects0: rects, group, c, s0: [corner[0] - c[0], corner[1] - c[1]] };
      setLinked(group);
      return;
    }
    const face = hitFace(ix, iy);
    if (face) {
      setSelected(face);
      dragRef.current = { mode: "move", key: face, ix, iy, state0: state };
      return;
    }
    dragRef.current = { mode: "moveAll", ix, iy, state0: state };
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

    if (d.mode === "move" || d.mode === "moveAll") {
      let dx = ix - d.ix;
      let dy = iy - d.iy;
      const moving = d.mode === "move" ? [d.key] : faces.map((f) => f.key);
      const shifted = (ox, oy) => ({
        ...d.state0,
        centers: { ...d.state0.centers, ...Object.fromEntries(moving.map((k) => [k, [d.state0.centers[k][0] + ox, d.state0.centers[k][1] + oy]])) },
      });
      const next = [];
      if (snapping) {
        const trial = rectsOf(shifted(dx, dy));
        const others = snapTargets(trial, new Set(moving));
        // the layout's outline when moving everything, the face itself otherwise
        const mineRects = moving.map((k) => trial[k]);
        const mx = mineRects.flatMap(edgesX);
        const my = mineRects.flatMap(edgesY);
        const bx = bestShift(d.mode === "moveAll" ? [Math.min(...mx), Math.max(...mx)] : mx, others.xs);
        const by = bestShift(d.mode === "moveAll" ? [Math.min(...my), Math.max(...my)] : my, others.ys);
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

    if (d.mode === "scale") {
      const [c0x, c0y] = d.c;
      const [s0x, s0y] = d.s0;
      let s = ((ix - c0x) * s0x + (iy - c0y) * s0y) / (s0x * s0x + s0y * s0y);
      s = Math.max(0.05, s);
      const next = [];
      if (snapping) {
        // manipulated edge = c + a·s; a free face's edge = cj + b·s (it scales in place);
        // an image edge is fixed. Solve each pairing for s, keep the nearest in reach.
        const r0 = d.rects0[d.key];
        const aX = [-r0.w / 2, r0.w / 2];
        const aY = [-r0.h / 2, r0.h / 2];
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
      setState(scaled(d.state0, d.key, s, d.group));
    }
  };
  const onPointerUp = () => {
    dragRef.current = null;
    setGuides([]);
    setLinked(null);
  };
  // hover feedback: a move cursor over faces, a resize cursor over the handles
  const [hoverCursor, setHoverCursor] = useState("default");
  const onHover = (e) => {
    if (dragRef.current) return;
    const [ix, iy] = toImage(...localPoint(e));
    const corner = hitHandle(ix, iy);
    if (corner) {
      const r = rectOf(selected);
      const diag = (corner[0] === r.x) === (corner[1] === r.y);
      setHoverCursor(diag ? "nwse-resize" : "nesw-resize");
    } else setHoverCursor(hitFace(ix, iy) ? "move" : "grab");
  };

  // one scale step for the whole sheet: faces joined to `key` scale around its centre
  // (and stay joined); every other face scales in place around its own
  function scaled(st0, key, s, group) {
    const [cx, cy] = st0.centers[key];
    const centersNext = { ...st0.centers };
    group.forEach((k) => {
      const [x, y] = st0.centers[k];
      centersNext[k] = [cx + (x - cx) * s, cy + (y - cy) * s];
    });
    return { pxPerMm: st0.pxPerMm * s, centers: centersNext };
  }
  const joinedTo = (key, st = state) => connectedFaces(rectsOf(st), key, Math.max(1, 0.3 * st.pxPerMm));
  // the scale typed as dpi, applied like a corner drag on the selected face
  const setDpi = (dpiValue) => {
    const target = dpiValue / 25.4;
    if (!(target > 0)) return;
    const key = selected || faces[0].key;
    setState((st) => scaled(st, key, target / st.pxPerMm, joinedTo(key, st)));
  };
  // the selected face's top-left, in mm from the image's top-left
  const setFacePos = (axis, mm) =>
    setState((st) => {
      const r = rectOf(selected, st);
      const [cx, cy] = st.centers[selected];
      const px = mm * st.pxPerMm;
      return { ...st, centers: { ...st.centers, [selected]: axis === "x" ? [px + r.w / 2, cy] : [cx, px + r.h / 2] } };
    });

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

  // arrow keys nudge the selected face by 1px of the image (Shift: 10px)
  useEffect(() => {
    const onKey = (e) => {
      if (!selected || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      // only when nothing else wants the arrows — not a number field, button or toggle
      const ae = document.activeElement;
      if (ae && ae !== document.body && ae !== stageRef.current) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      setState((st) => ({ ...st, centers: { ...st.centers, [selected]: [st.centers[selected][0] + dx, st.centers[selected][1] + dy] } }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const apply = () => {
    onApply({
      k: pxPerMm / dispW,
      centers: Object.fromEntries(Object.entries(centers).map(([k, [x, y]]) => [k, [x / dispW, y / dispH]])),
    });
  };

  const rects = rectsOf();
  const sel = selected ? faces.find((f) => f.key === selected) : null;
  const dpi = Math.round(pxPerMm * 25.4);
  const S = (x) => view.ox + x * view.v;
  const T = (y) => view.oy + y * view.v;

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.75)", zIndex: 50 }}>
      <div className="rounded-lg p-4 flex gap-4" style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border)", maxWidth: "calc(100vw - 32px)" }}>
        <div
          ref={stageRef}
          tabIndex={0}
          aria-label="展開図の面の配置"
          onPointerDown={(e) => {
            stageRef.current?.focus({ preventScroll: true }); // so the arrow keys reach the selected face
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
              const isSel = f.key === selected;
              const isLinked = linked?.has(f.key);
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
            {sel &&
              (() => {
                const r = rects[sel.key];
                return [
                  [r.x, r.y],
                  [r.x + r.w, r.y],
                  [r.x, r.y + r.h],
                  [r.x + r.w, r.y + r.h],
                ].map(([hx, hy], i) => (
                  <rect key={i} x={S(hx) - HANDLE_PX} y={T(hy) - HANDLE_PX} width={HANDLE_PX * 2} height={HANDLE_PX * 2} fill="#ffffff" stroke={strokeColor} strokeWidth={1.5} />
                ));
              })()}
            {guides.map((g, i) =>
              g.axis === "x" ? (
                <line key={i} x1={S(g.at)} x2={S(g.at)} y1={0} y2={stageH} stroke={SNAP_GUIDE} strokeWidth={1} />
              ) : (
                <line key={i} x1={0} x2={stageW} y1={T(g.at)} y2={T(g.at)} stroke={SNAP_GUIDE} strokeWidth={1} />
              )
            )}
          </svg>
        </div>

        <div className="flex flex-col" style={{ width: CONTROLS_W, flexShrink: 0 }}>
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
            面をドラッグで移動、何もない所のドラッグで全体を移動。選択した面の角をドラッグすると、全面の縮尺が変わります。面の端・角同士と画像の端にスナップします(Altで一時解除)。ホイールで表示倍率、右ドラッグで表示を移動。
          </p>

          <div className="mb-2" style={sectionTitle}>
            面
          </div>
          {/* every face is selectable from here too — by keyboard, or when it's too
              small to hit on the stage */}
          <div className="flex flex-wrap gap-1 mb-3">
            {faces.map((f) => (
              <button key={f.key} onClick={() => setSelected(f.key)} style={buttonStyle("quiet", { active: f.key === selected })}>
                {f.label}
              </button>
            ))}
          </div>

          {sel && (
            <>
              <div className="mb-2" style={sectionTitle}>
                位置(画像の左上から)
              </div>
              <div className="flex flex-col gap-2 mb-1">
                <ScrubField label="X" value={rects[sel.key].x / pxPerMm} onChange={(v) => setFacePos("x", v)} min={-1000} max={2000} step={0.1} decimals={1} unit="mm" dragRange={600} />
                <ScrubField label="Y" value={rects[sel.key].y / pxPerMm} onChange={(v) => setFacePos("y", v)} min={-1000} max={2000} step={0.1} decimals={1} unit="mm" dragRange={600} />
              </div>
              <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
                {Math.round(sel.wMm * 10) / 10} × {Math.round(sel.hMm * 10) / 10} mm。矢印キーで1px移動(Shiftで10px)。
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
            <button onClick={() => setState(fromStored(defaultLayout))} style={buttonStyle("quiet")} title="テンプレートの並びで画像に収まるように配置し直す">
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
    </div>
  );
}
