import React, { useState, useRef } from "react";
import { imgW, imgH, hexToRgba } from "../lib/imaging.js";
import ScrubField from "./ScrubField.jsx";
import { sectionTitle } from "../lib/ui.js";
import { DEFAULT_GUIDE_COLOR } from "../lib/nets.js";

const CROP_MAX_W = 640;
const CROP_MAX_H = 480;
const CROP_MAX_ZOOM = 5;

// crop editor: shows the raw uploaded image (no hidden baseline rotate/mirror).
// Zoom is a single uniform, aspect-preserving scale (center-anchored, like before) —
// dispW/dispH depend ONLY on zoom, never on the crop percentages. Dragging, and the
// four top/bottom/left/right slider+number fields, all just move imgPos (pan) at that
// fixed zoom — so adjusting one edge shifts the window rather than stretching the
// image; the opposite edge updates automatically since it's derived from the same
// imgPos, not set independently.
//
// Generalized beyond the box net editor: `regions` + `regionLabel` are optional — pass
// nothing to use this as a plain single-rectangle crop editor (e.g. for card/piece
// symbol images), or pass a net layout's regions plus a label lookup to overlay the
// per-face grid, same as the box body/lid crop editors.
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
  let frameW = CROP_MAX_W;
  let frameH = (CROP_MAX_W * aspectH) / aspectW;
  if (frameH > CROP_MAX_H) {
    frameH = CROP_MAX_H;
    frameW = (CROP_MAX_H * aspectW) / aspectH;
  }

  const [displaySrc] = useState(() => (img.src ? img.src : img.toDataURL()));
  const baseScale = Math.max(frameW / imgW(img), frameH / imgH(img));

  // best-effort recovery of a starting zoom/position from previously-saved crop %s
  // (picks whichever axis needed more zoom to fit; the other axis's saved value may
  // not be hit exactly, since zoom is now always uniform across both axes)
  const [zoom, setZoom] = useState(() => {
    const l = (initialCrop?.cropLeft || 0) / 100;
    const r = (initialCrop?.cropRight || 0) / 100;
    const t = (initialCrop?.cropTop || 0) / 100;
    const b = (initialCrop?.cropBottom || 0) / 100;
    const zx = 1 - l - r > 0.001 ? 1 / (1 - l - r) : 1;
    const zy = 1 - t - b > 0.001 ? 1 / (1 - t - b) : 1;
    return Math.min(CROP_MAX_ZOOM, Math.max(1, zx, zy));
  });
  const [imgPos, setImgPos] = useState(() => {
    const dispW0 = imgW(img) * baseScale * zoom;
    const dispH0 = imgH(img) * baseScale * zoom;
    const l = (initialCrop?.cropLeft || 0) / 100;
    const t = (initialCrop?.cropTop || 0) / 100;
    return {
      x: Math.min(0, Math.max(frameW - dispW0, -l * dispW0)),
      y: Math.min(0, Math.max(frameH - dispH0, -t * dispH0)),
    };
  });
  const dragRef = useRef(null);
  // a literal hex, never var(--token): it feeds <input type=color> (which only accepts
  // #rrggbb and showed black for anything else) and hexToRgba
  const strokeColor = /^#/.test(guideColor || "") ? guideColor : DEFAULT_GUIDE_COLOR;

  const dispW = imgW(img) * baseScale * zoom;
  const dispH = imgH(img) * baseScale * zoom;

  const clampPos = (pos, z) => {
    const w = imgW(img) * baseScale * z;
    const h = imgH(img) * baseScale * z;
    return {
      x: Math.min(0, Math.max(frameW - w, pos.x)),
      y: Math.min(0, Math.max(frameH - h, pos.y)),
    };
  };

  const handleZoom = (rawZoom) => {
    const newZoom = Math.min(CROP_MAX_ZOOM, Math.max(1, rawZoom));
    const cx = frameW / 2;
    const cy = frameH / 2;
    const fracX = (cx - imgPos.x) / dispW;
    const fracY = (cy - imgPos.y) / dispH;
    const newDispW = imgW(img) * baseScale * newZoom;
    const newDispH = imgH(img) * baseScale * newZoom;
    setImgPos(clampPos({ x: cx - fracX * newDispW, y: cy - fracY * newDispH }, newZoom));
    setZoom(newZoom);
  };

  const onPointerDown = (e) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPos: imgPos };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setImgPos(clampPos({ x: dragRef.current.startPos.x + dx, y: dragRef.current.startPos.y + dy }, zoom));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };
  const onWheelZoom = (e) => {
    e.preventDefault();
    handleZoom(zoom * (1 - e.deltaY * 0.001));
  };

  const clampPct = (v) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));
  const cropLeft = clampPct((-imgPos.x / dispW) * 100);
  const cropRight = clampPct(((dispW - (frameW - imgPos.x)) / dispW) * 100);
  const cropTop = clampPct((-imgPos.y / dispH) * 100);
  const cropBottom = clampPct(((dispH - (frameH - imgPos.y)) / dispH) * 100);

  const setLeftPct = (v) => setImgPos((p) => clampPos({ ...p, x: (-clampPct(v) / 100) * dispW }, zoom));
  const setRightPct = (v) => setImgPos((p) => clampPos({ ...p, x: frameW - dispW * (1 - clampPct(v) / 100) }, zoom));
  const setTopPct = (v) => setImgPos((p) => clampPos({ ...p, y: (-clampPct(v) / 100) * dispH }, zoom));
  const setBottomPct = (v) => setImgPos((p) => clampPos({ ...p, y: frameH - dispH * (1 - clampPct(v) / 100) }, zoom));

  const apply = () => {
    onApply({ cropLeft, cropRight, cropTop, cropBottom });
  };

  const sliderControl = (label, value, onChange, { min = 0, max = 90, step = 0.5, decimals = 1, unit = "%" } = {}) => (
    <ScrubField label={label} value={value} onChange={onChange} min={min} max={max} step={step} decimals={decimals} unit={unit} />
  );

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.75)", zIndex: 50 }}
    >
      <div
        className="rounded-lg p-4"
        style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border)", maxWidth: "92vw" }}
      >
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            トリミング編集
          </div>
          {onGuideColorChange && (
            <label
              className="flex items-center gap-1 text-xs flex-shrink-0"
              style={{ color: "var(--text-secondary)" }}
            >
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
          ドラッグで位置調整 / ホイールかスライダーで拡大縮小。下のスライダー・数値でも調整できます。
        </p>
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheelZoom}
          style={{
            width: frameW,
            height: frameH,
            position: "relative",
            overflow: "hidden",
            background: "#000",
            cursor: "grab",
            border: `1px solid ${strokeColor}`,
            touchAction: "none",
          }}
        >
          <img
            src={displaySrc}
            draggable={false}
            alt="crop preview"
            style={{
              position: "absolute",
              left: imgPos.x,
              top: imgPos.y,
              width: dispW,
              height: dispH,
              maxWidth: "none",
              pointerEvents: "none",
              userSelect: "none",
            }}
          />
          {regions && (
            <svg
              width={frameW}
              height={frameH}
              style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
            >
              {regions.map((r) => {
                const x = (r.x / aspectW) * frameW;
                const y = (r.y / aspectH) * frameH;
                const w = (r.w / aspectW) * frameW;
                const h = (r.h / aspectH) * frameH;
                return (
                  <g key={r.key}>
                    <rect
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      fill={hexToRgba(strokeColor, 0.08)}
                      stroke={strokeColor}
                      strokeWidth={1.5}
                      strokeDasharray="6 4"
                    />
                    <text
                      x={x + w / 2}
                      y={y + 14}
                      fill="#eef6f6"
                      fontSize={11}
                      textAnchor="middle"
                      fontFamily="Inter, sans-serif"
                      style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}
                    >
                      {regionLabel ? regionLabel(r.key) : r.key}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
        <div className="mt-3" style={{ width: Math.max(frameW, 320) }}>
          {sliderControl("拡大", zoom, handleZoom, { min: 1, max: CROP_MAX_ZOOM, step: 0.01, decimals: 2, unit: "倍" })}
        </div>
        <div
          className="mt-3 mb-1"
          style={{ ...sectionTitle, width: Math.max(frameW, 320) }}
        >
          位置調整
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2" style={{ width: Math.max(frameW, 320) }}>
          {sliderControl("上", cropTop, setTopPct)}
          {sliderControl("下", cropBottom, setBottomPct)}
          {sliderControl("左", cropLeft, setLeftPct)}
          {sliderControl("右", cropRight, setRightPct)}
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={onCancel}
            className="flex-1 text-sm rounded py-2"
            style={{ background: "var(--border)", color: "var(--text-primary)" }}
          >
            キャンセル
          </button>
          <button
            onClick={apply}
            className="flex-1 text-sm rounded py-2"
            style={{ background: "var(--accent)", color: "#1c1a17", fontWeight: 600 }}
          >
            適用
          </button>
        </div>
      </div>
    </div>
  );
}
