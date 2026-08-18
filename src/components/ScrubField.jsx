import React, { useRef, useState } from "react";

// Figma/After-Effects-style number field: drag horizontally to scrub the value, click
// (no movement) to type an exact one. Replaces the old "number input + separate range
// slider" pair used everywhere in this app with a single consistent control.
//
// Drag sensitivity is proportional to the field's own min..max range (a fixed drag of
// `dragRange` px covers the whole range) rather than a flat units-per-pixel — that way
// a ±2000mm position field and a 0.4–2.0 exposure field both feel reasonable to drag
// without per-field tuning. Hold Shift to move 5x faster, Alt/Option for 5x finer.
export default function ScrubField({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit,
  decimals,
  dragRange = 300,
  endAdornment,
  linked = false,
  className = "",
}) {
  const dec = decimals ?? (step < 1 ? 2 : 0);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const dragRef = useRef(null);
  const inputRef = useRef(null);

  const clamp = (v) => Math.max(min, Math.min(max, v));
  const round = (v) => {
    const factor = 10 ** dec;
    return Math.round(v * factor) / factor;
  };
  const display = round(value).toFixed(dec);

  const onPointerDown = (e) => {
    if (editing) return;
    dragRef.current = { startX: e.clientX, startVal: value, moved: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // no-op: capture can legitimately fail to attach (e.g. the pointer already
      // released) — the drag/click logic below only depends on dragRef, not capture
    }
    setDragging(true);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    if (Math.abs(dx) > 2) dragRef.current.moved = true;
    const speed = e.shiftKey ? 5 : e.altKey ? 0.2 : 1;
    const unitsPerPixel = ((max - min) / dragRange) * speed;
    onChange(clamp(round(dragRef.current.startVal + dx * unitsPerPixel)));
  };
  const finishDrag = () => {
    setDragging(false);
    if (dragRef.current && !dragRef.current.moved) {
      setEditValue(String(display));
      setEditing(true);
    }
    dragRef.current = null;
  };
  const commitEdit = () => {
    const v = parseFloat(editValue);
    if (Number.isFinite(v)) onChange(clamp(v));
    setEditing(false);
  };

  return (
    <label
      className={`flex items-center justify-between gap-2 text-sm ${className}`}
      style={{ userSelect: dragging ? "none" : undefined }}
    >
      <span className="flex items-center gap-1" style={{ color: "#a89f8f" }}>
        {label}
        {endAdornment}
      </span>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        className="flex items-center gap-1 rounded px-2 py-1"
        style={{
          background: "#242220",
          border: `1px solid ${dragging || editing ? "#5fd3d9" : linked ? "#5fd3d9" : "#3a372f"}`,
          cursor: editing ? "text" : "ew-resize",
          touchAction: "none",
          minWidth: "72px",
          justifyContent: "flex-end",
        }}
      >
        {editing ? (
          <input
            ref={inputRef}
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="no-spinner text-right"
            style={{
              width: "56px",
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#efe6d4",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "13px",
            }}
          />
        ) : (
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "13px",
              color: "#efe6d4",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {display}
          </span>
        )}
        {unit && (
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", color: "#7d7568" }}>{unit}</span>
        )}
      </div>
    </label>
  );
}
