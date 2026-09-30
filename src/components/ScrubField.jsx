import React, { useEffect, useRef, useState } from "react";

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
  className = "",
  compact = false,
}) {
  const dec = decimals ?? (step < 1 ? 2 : 0);
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [cursorPos, setCursorPos] = useState(null);
  const dragRef = useRef(null);
  const inputRef = useRef(null);
  const wrapperRef = useRef(null);
  // set right before we programmatically return focus to the chip after Enter/Escape,
  // so that refocus doesn't immediately re-open the editor it just closed
  const suppressAutoEditRef = useRef(false);

  const clamp = (v) => Math.max(min, Math.min(max, v));
  const round = (v) => {
    const factor = 10 ** dec;
    return Math.round(v * factor) / factor;
  };
  const display = round(value).toFixed(dec);

  const beginEdit = () => {
    setEditValue(String(display));
    setEditing(true);
  };
  // leaves the text editor but keeps keyboard position on this field, so Enter/Escape
  // don't dump focus to <body> and break Tab order mid-way through a form
  const refocusAfterEditRef = useRef(false);
  const exitEditKeepingFocus = () => {
    refocusAfterEditRef.current = true;
    setEditing(false);
  };
  // Opening: select the whole value so tabbing into a field lets you retype it
  // immediately. Closing (via Enter/Escape): hand focus back to the chip.
  // Both live in an effect rather than on the input's autoFocus/onFocus or in a
  // requestAnimationFrame, because neither of those is dependable — focus events don't
  // fire while the window is unfocused, and rAF is throttled in background tabs.
  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
      return;
    }
    if (!refocusAfterEditRef.current) return;
    refocusAfterEditRef.current = false;
    suppressAutoEditRef.current = true;
    wrapperRef.current?.focus();
    // focus() dispatches synchronously, so onWrapperFocus has already consumed the
    // flag by now; this only clears it in the case where no focus event fired at all,
    // so a later genuine tab-in doesn't get swallowed.
    setTimeout(() => {
      suppressAutoEditRef.current = false;
    }, 0);
  }, [editing]);

  // once the OS cursor is physically pinned against a screen edge, plain mousemove
  // stops reporting further movement in that direction — there's no more room for it
  // to go. Pointer Lock sidesteps that: it hides the real cursor and reports
  // movementX/Y deltas with no positional limit, so the drag can keep going past where
  // the screen would otherwise stop it. We draw our OWN cursor dot and wrap ITS
  // position at the viewport edges, so the drag visually "loops" instead of just
  // vanishing. Falls back to the previous absolute-position math (unchanged) wherever
  // pointer lock isn't available/granted, so behavior never regresses, only improves.
  const onPointerDown = (e) => {
    suppressAutoEditRef.current = false;
    if (editing) return;
    dragRef.current = { startX: e.clientX, startVal: value, moved: false, accumDx: 0 };
    setCursorPos({ x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // no-op: capture can legitimately fail to attach (e.g. the pointer already
      // released) — the drag/click logic below only depends on dragRef, not capture
    }
    try {
      // requestPointerLock() returns a Promise in current browsers (and returns
      // undefined in older ones) — it can reject asynchronously (e.g. sandboxed/
      // embedded contexts that don't allow pointer lock at all), which a plain
      // try/catch can't catch since the rejection happens after this call returns.
      // Either way, a failure here just means the fallback absolute-position drag
      // math below keeps handling everything, so the rejection is safe to swallow.
      e.currentTarget.requestPointerLock?.()?.catch?.(() => {});
    } catch {
      // no-op: unsupported/denied — falls back to normal absolute-position dragging
    }
    setDragging(true);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const locked = typeof document !== "undefined" && document.pointerLockElement != null;
    let dx;
    if (locked) {
      dx = e.movementX || 0;
      dragRef.current.accumDx += dx;
    } else {
      dragRef.current.accumDx = e.clientX - dragRef.current.startX;
      dx = dragRef.current.accumDx;
    }
    if (Math.abs(dragRef.current.accumDx) > 2) dragRef.current.moved = true;
    const speed = e.shiftKey ? 5 : e.altKey ? 0.2 : 1;
    const unitsPerPixel = ((max - min) / dragRange) * speed;
    onChange(clamp(round(dragRef.current.startVal + dragRef.current.accumDx * unitsPerPixel)));

    if (locked) {
      setCursorPos((p) => {
        if (!p) return p;
        const w = window.innerWidth;
        const h = window.innerHeight;
        let nx = (p.x + dx) % w;
        if (nx < 0) nx += w;
        let ny = (p.y + (e.movementY || 0)) % h;
        if (ny < 0) ny += h;
        return { x: nx, y: ny };
      });
    }
  };
  const finishDrag = () => {
    setDragging(false);
    if (typeof document !== "undefined" && document.pointerLockElement) {
      try {
        document.exitPointerLock();
      } catch {
        // no-op
      }
    }
    setCursorPos(null);
    if (dragRef.current && !dragRef.current.moved) beginEdit();
    dragRef.current = null;
  };
  const commitEdit = () => {
    const v = parseFloat(editValue);
    if (Number.isFinite(v)) onChange(clamp(v));
    setEditing(false);
  };
  // arrow-key nudge, mirrors the drag gesture's speed modifiers (Shift=5x, Alt=0.2x)
  // so keyboard and pointer input feel like the same control at different speeds.
  const nudge = (dir, e, base = value) => {
    const speed = e.shiftKey ? 5 : e.altKey ? 0.2 : 1;
    return clamp(round(base + dir * step * speed));
  };
  const onKeyDown = (e) => {
    if (editing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      beginEdit();
      return;
    }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    onChange(nudge(e.key === "ArrowUp" ? 1 : -1, e));
  };
  // Tab (or any other non-pointer focus) opens the editor with the whole value
  // pre-selected, so the field can be retyped straight away without reaching for the
  // mouse. A pointer-driven focus is excluded: onPointerDown has already stored a drag
  // record by the time focus fires, and click-to-edit is handled on release instead
  // (otherwise a click-and-drag scrub would pop the text editor open mid-gesture).
  const onWrapperFocus = (e) => {
    if (e.target !== e.currentTarget) return; // ignore focus bubbling up from the input
    setFocused(true);
    if (suppressAutoEditRef.current) {
      suppressAutoEditRef.current = false;
      return;
    }
    if (!dragRef.current && !editing) beginEdit();
  };
  const onWrapperBlur = (e) => {
    if (e.target !== e.currentTarget) return;
    setFocused(false);
  };
  const onInputKeyDown = (e) => {
    if (e.key === "Enter") {
      commitEdit();
      exitEditKeepingFocus();
    } else if (e.key === "Escape") {
      exitEditKeepingFocus();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const base = Number.isFinite(parseFloat(editValue)) ? parseFloat(editValue) : value;
      const next = nudge(e.key === "ArrowUp" ? 1 : -1, e, base);
      onChange(next);
      setEditValue(String(next));
    }
  };

  // stand-in for the real (now pointer-locked-and-hidden) OS cursor, drawn at
  // `cursorPos` and wrapped at the viewport edges in onPointerMove above — only
  // rendered while a pointer-locked drag is actually in progress.
  const fakeCursor = cursorPos && (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        left: cursorPos.x,
        top: cursorPos.y,
        width: "14px",
        height: "14px",
        marginLeft: "-7px",
        marginTop: "-7px",
        borderRadius: "50%",
        border: "2px solid var(--highlight)",
        background: "rgba(95,211,217,0.25)",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    />
  );

  return (
    <>
      <label
        className={`flex items-center justify-between gap-2 text-sm ${className}`}
        style={{ userSelect: dragging ? "none" : undefined }}
      >
        <span style={{ color: "var(--text-secondary)" }}>{label}</span>
        <div
          ref={wrapperRef}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onKeyDown={onKeyDown}
          onFocus={onWrapperFocus}
          onBlur={onWrapperBlur}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          className={`relative flex items-center gap-1 rounded overflow-hidden ${compact ? "px-1.5 py-0.5" : "px-2 py-1"}`}
          style={{
            background: "var(--bg-surface-1)",
            border: `1px solid ${dragging || editing || focused ? "var(--highlight)" : "var(--border)"}`,
            cursor: editing ? "text" : "ew-resize",
            touchAction: "none",
            minWidth: compact ? "48px" : "72px",
            justifyContent: "flex-end",
            outline: "none",
          }}
        >
          {!editing && !compact && (
            <span
              aria-hidden="true"
              className="relative"
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "10px",
                letterSpacing: "-2px",
                color: hovering || dragging ? "var(--highlight)" : "var(--text-faint)",
                opacity: hovering || dragging ? 1 : 0.6,
                marginRight: "1px",
                transition: "color 120ms ease, opacity 120ms ease",
              }}
            >
              ‹›
            </span>
          )}
          {editing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={onInputKeyDown}
              className="no-spinner text-right relative"
              style={{
                width: compact ? "36px" : "56px",
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--text-primary)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: compact ? "11px" : "13px",
              }}
            />
          ) : (
            <span
              className="relative"
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: compact ? "11px" : "13px",
                color: "var(--text-primary)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {display}
            </span>
          )}
          {unit && (
            <span
              className="relative"
              style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: compact ? "9px" : "11px", color: "var(--text-muted)" }}
            >
              {unit}
            </span>
          )}
        </div>
      </label>
      {fakeCursor}
    </>
  );
}
