import React, { useEffect, useRef, useState } from "react";
import { imgW, imgH, hexToRgba } from "../lib/imaging.js";
import ScrubField from "./ScrubField.jsx";
import ToggleSwitch from "./ToggleSwitch.jsx";
import { sectionTitle, sectionMeta, buttonStyle } from "../lib/ui.js";
import { DEFAULT_GUIDE_COLOR } from "../lib/nets.js";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const CONTROLS_W = 260; // side column
const STAGE_MARGIN = 44; // visible pasteboard around the frame, so the image outside it stays in view
const SNAP_PX = 8; // snap distance, in screen pixels (so it feels the same at any frame size)
const SNAP_GUIDE = "#ff4fa3"; // literal: drawn over arbitrary artwork, must stay visible on it

// Trim editor for anything that maps an image onto a known physical rectangle: a box
// net (aspectW × aspectH = the net's size in mm, with its face `regions` overlaid) or a
// card/token face (its w × d in mm).
//
// Everything is held in the frame's own millimetres — the image's top-left position
// (x, y) and its displayed size — rather than as edge percentages, because that's how
// the art was made: "the sheet is 142mm wide and my file should span it exactly" is a
// number you can type. Zoom is relative to "cover" (1× = the image just covers the
// frame), and goes below 1× so a file that's slightly too big can be shrunk to fit.
// The result is still saved as edge percentages (the slicer's format); percentages
// outside 0–100 mean the frame reaches past the image (see cropFractions).
//
// Dragging snaps the image's edges and centre to the frame's edges and centre and to
// every face boundary on a net, with a guide line showing what caught — hold Alt, or
// switch snapping off, to place freely.
export default function CropEditorModal({
  img,
  aspectW,
  aspectH,
  regions,
  regionLabel,
  initialCrop,
  guideColor,
  onGuideColorChange,
  onApply,
  onCancel,
}) {
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // frame fitted into whatever the window leaves after the controls column and chrome
  const availW = Math.max(240, Math.min(1200, viewport.w - 96 - CONTROLS_W - 2 * STAGE_MARGIN));
  const availH = Math.max(180, Math.min(820, viewport.h - 150 - 2 * STAGE_MARGIN));
  const pxPerMm = Math.min(availW / aspectW, availH / aspectH);
  const frameW = aspectW * pxPerMm;
  const frameH = aspectH * pxPerMm;

  const [displaySrc] = useState(() => (img.src ? img.src : img.toDataURL()));
  const iw = imgW(img);
  const ih = imgH(img);
  // mm per image pixel at 1× — the scale at which the image just covers the frame
  const coverMmPerPx = Math.max(aspectW / iw, aspectH / ih);

  // recover size + position from the saved edge percentages
  const [state, setState] = useState(() => {
    const l = (initialCrop?.cropLeft || 0) / 100;
    const r = (initialCrop?.cropRight || 0) / 100;
    const t = (initialCrop?.cropTop || 0) / 100;
    const spanX = 1 - l - r;
    const hasCrop = spanX > 0.001 && (l || r || t || initialCrop?.cropBottom);
    const zoom = hasCrop ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, aspectW / spanX / (iw * coverMmPerPx))) : 1;
    const wMm = iw * coverMmPerPx * zoom;
    const hMm = ih * coverMmPerPx * zoom;
    // no saved crop: centre the covering image, the same starting point as before
    return hasCrop ? { zoom, x: -l * wMm, y: -t * hMm } : { zoom, x: (aspectW - wMm) / 2, y: (aspectH - hMm) / 2 };
  });
  const { zoom, x, y } = state;
  const wMm = iw * coverMmPerPx * zoom;
  const hMm = ih * coverMmPerPx * zoom;

  const [snapOn, setSnapOn] = useState(true);
  const [guides, setGuides] = useState({ x: null, y: null });
  const dragRef = useRef(null);
  const strokeColor = /^#/.test(guideColor || "") ? guideColor : DEFAULT_GUIDE_COLOR;

  // zoom about a point given in frame mm (the frame centre for the field, the cursor
  // for the wheel), so what's under that point stays put
  const zoomAbout = (rawZoom, ax = aspectW / 2, ay = aspectH / 2) => {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, rawZoom));
    setState((s) => {
      const k = z / s.zoom;
      return { zoom: z, x: ax - (ax - s.x) * k, y: ay - (ay - s.y) * k };
    });
  };
  // width/height fields keep the top-left corner where it is, like a layout app
  const setWidthMm = (v) => setState((s) => ({ ...s, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v / (iw * coverMmPerPx))) }));
  const setHeightMm = (v) => setState((s) => ({ ...s, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v / (ih * coverMmPerPx))) }));

  const fitWidth = () => {
    const z = aspectW / (iw * coverMmPerPx);
    const h = ih * coverMmPerPx * z;
    setState({ zoom: z, x: 0, y: (aspectH - h) / 2 });
  };
  const fitHeight = () => {
    const z = aspectH / (ih * coverMmPerPx);
    const w = iw * coverMmPerPx * z;
    setState({ zoom: z, x: (aspectW - w) / 2, y: 0 });
  };
  const fitWhole = () => {
    const z = Math.min(aspectW / iw, aspectH / ih) / coverMmPerPx;
    const w = iw * coverMmPerPx * z;
    const h = ih * coverMmPerPx * z;
    setState({ zoom: z, x: (aspectW - w) / 2, y: (aspectH - h) / 2 });
  };
  const center = () => setState((s) => ({ ...s, x: (aspectW - wMm) / 2, y: (aspectH - hMm) / 2 }));

  // everything the image's edges and centre can catch on: the frame, and each face
  const targetsX = [0, aspectW / 2, aspectW];
  const targetsY = [0, aspectH / 2, aspectH];
  (regions || []).forEach((r) => {
    targetsX.push(r.x, r.x + r.w);
    targetsY.push(r.y, r.y + r.h);
  });
  const snapAxis = (start, size, targets, thresholdMm) => {
    let best = null;
    [start, start + size / 2, start + size].forEach((edge, i) => {
      targets.forEach((tg) => {
        const d = tg - edge;
        if (Math.abs(d) <= thresholdMm && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: tg, i };
      });
    });
    return best ? { pos: start + best.d, line: best.line } : { pos: start, line: null };
  };

  const onPointerDown = (e) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, x0: x, y0: y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    let nx = d.x0 + (e.clientX - d.startX) / pxPerMm;
    let ny = d.y0 + (e.clientY - d.startY) / pxPerMm;
    let gx = null;
    let gy = null;
    if (snapOn && !e.altKey) {
      const th = SNAP_PX / pxPerMm;
      const sx = snapAxis(nx, wMm, targetsX, th);
      const sy = snapAxis(ny, hMm, targetsY, th);
      nx = sx.pos;
      ny = sy.pos;
      gx = sx.line;
      gy = sy.line;
    }
    setGuides({ x: gx, y: gy });
    setState((s) => ({ ...s, x: nx, y: ny }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
    setGuides({ x: null, y: null });
  };
  const stageRef = useRef(null);
  // bound natively (non-passive) so preventDefault actually stops the page scrolling
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ax = (e.clientX - rect.left - STAGE_MARGIN) / pxPerMm;
      const ay = (e.clientY - rect.top - STAGE_MARGIN) / pxPerMm;
      setState((s) => {
        const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s.zoom * (1 - e.deltaY * 0.001)));
        const k = z / s.zoom;
        return { zoom: z, x: ax - (ax - s.x) * k, y: ay - (ay - s.y) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pxPerMm]);

  const apply = () => {
    onApply({
      cropLeft: (-x / wMm) * 100,
      cropRight: (1 - (aspectW - x) / wMm) * 100,
      cropTop: (-y / hMm) * 100,
      cropBottom: (1 - (aspectH - y) / hMm) * 100,
    });
  };

  // effective print resolution of the image as placed — the number that tells you
  // whether a file will hold up at this size
  const dpi = Math.round(iw / (wMm / 25.4));
  const span = Math.max(aspectW, aspectH) * 3;
  const mmField = (label, value, onChange, min = -span, max = span) => (
    <ScrubField label={label} value={value} onChange={onChange} min={min} max={max} step={0.1} decimals={1} unit="mm" dragRange={600} />
  );

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.75)", zIndex: 50 }}>
      <div
        className="rounded-lg p-4 flex gap-4"
        style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border)", maxWidth: "calc(100vw - 32px)" }}
      >
        <div
          ref={stageRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          style={{
            width: frameW + 2 * STAGE_MARGIN,
            height: frameH + 2 * STAGE_MARGIN,
            position: "relative",
            overflow: "hidden",
            background: "repeating-conic-gradient(#2a2a2a 0% 25%, #222 0% 50%) 0 0 / 16px 16px",
            cursor: dragRef.current ? "grabbing" : "grab",
            touchAction: "none",
            borderRadius: "4px",
            flexShrink: 0,
          }}
        >
          <img
            src={displaySrc}
            draggable={false}
            alt="トリミング対象"
            style={{
              position: "absolute",
              left: STAGE_MARGIN + x * pxPerMm,
              top: STAGE_MARGIN + y * pxPerMm,
              width: wMm * pxPerMm,
              height: hMm * pxPerMm,
              maxWidth: "none",
              pointerEvents: "none",
              userSelect: "none",
            }}
          />
          {/* the frame: everything outside it is dimmed but still visible */}
          <div
            style={{
              position: "absolute",
              left: STAGE_MARGIN,
              top: STAGE_MARGIN,
              width: frameW,
              height: frameH,
              border: `1px solid ${strokeColor}`,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
              pointerEvents: "none",
            }}
          />
          <svg
            width={frameW + 2 * STAGE_MARGIN}
            height={frameH + 2 * STAGE_MARGIN}
            style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
          >
            <g transform={`translate(${STAGE_MARGIN},${STAGE_MARGIN})`}>
              {(regions || []).map((r) => {
                const rx = r.x * pxPerMm;
                const ry = r.y * pxPerMm;
                const rw = r.w * pxPerMm;
                const rh = r.h * pxPerMm;
                const flap = r.face === false;
                return (
                  <g key={r.key}>
                    <rect
                      x={rx}
                      y={ry}
                      width={rw}
                      height={rh}
                      fill={flap ? "rgba(160,170,180,0.12)" : hexToRgba(strokeColor, 0.08)}
                      stroke={flap ? "#8a96a3" : strokeColor}
                      strokeWidth={1.5}
                      strokeDasharray={flap ? "3 3" : "6 4"}
                    />
                    {rw > 30 && rh > 16 && (
                      <text x={rx + rw / 2} y={ry + 14} fill="#eef6f6" fontSize={11} textAnchor="middle" fontFamily="Inter, sans-serif" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
                        {regionLabel ? regionLabel(r.key) : r.key}
                      </text>
                    )}
                  </g>
                );
              })}
              {guides.x != null && (
                <line x1={guides.x * pxPerMm} x2={guides.x * pxPerMm} y1={-STAGE_MARGIN} y2={frameH + STAGE_MARGIN} stroke={SNAP_GUIDE} strokeWidth={1} />
              )}
              {guides.y != null && (
                <line x1={-STAGE_MARGIN} x2={frameW + STAGE_MARGIN} y1={guides.y * pxPerMm} y2={guides.y * pxPerMm} stroke={SNAP_GUIDE} strokeWidth={1} />
              )}
            </g>
          </svg>
        </div>

        <div className="flex flex-col" style={{ width: CONTROLS_W, flexShrink: 0 }}>
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              トリミング編集
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
            ドラッグで移動、ホイールで拡大縮小。枠と各面の端・中央にスナップします(Altで一時解除)。
          </p>

          <div className="mb-2" style={sectionTitle}>
            サイズ
          </div>
          <div className="flex flex-col gap-2 mb-2">
            <ScrubField label="拡大" value={zoom} onChange={(v) => zoomAbout(v)} min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} decimals={2} unit="倍" />
            {mmField("幅", wMm, setWidthMm, 1, span)}
            {mmField("高さ", hMm, setHeightMm, 1, span)}
          </div>
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            <button onClick={fitWidth} style={buttonStyle("quiet")}>
              幅に合わせる
            </button>
            <button onClick={fitHeight} style={buttonStyle("quiet")}>
              高さに合わせる
            </button>
            <button onClick={fitWhole} style={buttonStyle("quiet")} title="画像全体が枠に収まるように">
              全体を表示
            </button>
            <button onClick={center} style={buttonStyle("quiet")}>
              中央に配置
            </button>
          </div>

          <div className="mb-2" style={sectionTitle}>
            位置(枠の左上から)
          </div>
          <div className="flex flex-col gap-2 mb-3">
            {mmField("X", x, (v) => setState((s) => ({ ...s, x: v })))}
            {mmField("Y", y, (v) => setState((s) => ({ ...s, y: v })))}
          </div>

          <ToggleSwitch checked={snapOn} onChange={setSnapOn} label="スナップ" />

          <div className="mt-3 flex flex-col gap-0.5" style={sectionMeta}>
            <span>
              枠 {Math.round(aspectW * 10) / 10} × {Math.round(aspectH * 10) / 10} mm
            </span>
            <span>
              画像 {iw} × {ih} px / 約 {dpi} dpi
            </span>
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
