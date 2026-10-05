import React, { useRef, useState } from "react";
import useClickOutside from "../hooks/useClickOutside.js";
import LibraryMenu from "./LibraryMenu.jsx";
import { sectionTitle, buttonStyle, modKeys } from "../lib/ui.js";

const TYPE_DOT_STYLE = {
  box: { background: "#cbb98f", borderRadius: "2px" },
  component: { background: "var(--highlight)", borderRadius: "50%" },
};

function OutlinerRow({ row, index, selected, onSelect, onRemove, canRemove, dragHandlers, dragging, dropBefore, dropAfter }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      draggable
      data-row-index={index}
      // Shift/Ctrl-click adds to or removes from the selection
      onClick={(e) => onSelect(row.kind, row.id, { toggle: e.shiftKey || e.ctrlKey || e.metaKey })}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      {...dragHandlers}
      className="flex items-center gap-2 rounded px-2 py-2 cursor-pointer text-xs flex-shrink-0"
      style={{
        background: selected ? "var(--row-selected)" : hover ? "var(--row-hover)" : "transparent",
        border: `1px solid ${selected ? "var(--highlight)" : "transparent"}`,
        opacity: dragging ? 0.4 : 1,
        boxShadow: dropBefore ? "inset 0 2px 0 0 var(--highlight)" : dropAfter ? "inset 0 -2px 0 0 var(--highlight)" : "none",
        cursor: dragging ? "grabbing" : "pointer",
      }}
    >
      <span
        aria-hidden="true"
        className="flex-shrink-0"
        style={{ color: "var(--text-faint)", fontSize: "11px", cursor: "grab", letterSpacing: "-1px" }}
        title="ドラッグして並び替え"
      >
        ⋮⋮
      </span>
      <span style={{ width: "9px", height: "9px", flexShrink: 0, ...TYPE_DOT_STYLE[row.kind] }} />
      <span className="flex-1 truncate" style={{ color: selected ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: selected ? 600 : 400 }}>
        {row.name}
      </span>
      {/* delete stays mounted (so the row's width never shifts as the pointer moves
          across the list) but is invisible until the row is hovered or selected — a ×
          on every row at all times reads as the list's main affordance, which it isn't.
          Keyboard users still reach it: focus makes it visible via :focus-visible. */}
      {canRemove && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(row.kind, row.id);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            e.stopPropagation();
            onRemove(row.kind, row.id);
          }}
          className="outliner-remove rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            width: "16px",
            height: "16px",
            background: "rgba(0,0,0,0.3)",
            fontSize: "11px",
            lineHeight: 1,
            color: "var(--text-secondary)",
            opacity: hover || selected ? 1 : 0,
            transition: "opacity 120ms ease",
            cursor: "pointer",
          }}
          title="削除"
        >
          ×
        </span>
      )}
    </div>
  );
}

// unified layers panel: box/card/piece used to each have their own independent
// "配置(N数)" chip list (add/duplicate/remove/select), duplicating the same UI pattern
// three times and giving the user three separate places to learn. This merges them
// into one list — sorted by layer (higher = drawn later = visually "on top", same
// convention as a typical layers panel) — so selecting/adding/removing/duplicating any
// placed object works the same way regardless of its kind, and where something sits in
// the stacking order (see the ground-snap/layer resolver) is visible at a glance.
// Card/piece are no longer distinct kinds here — both are "component" instances now
// (see lib/components.js); only box remains structurally separate.
//
// Fills its whole column (h-full) rather than capping its own list at a small fixed
// height — it lives alone in a dedicated column now, so there's no reason to make it
// scroll internally after ~6 rows while the rest of that column sits empty below it.
export default function Outliner({
  boxInstances,
  componentInstances,
  libraryItems,
  activeSelection,
  selectedKeys = [],
  onSelect,
  onPlace,
  onOpenLibrary,
  onDuplicate,
  onRemove,
  onReorder,
}) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef(null);
  useClickOutside(addMenuRef, addMenuOpen, () => setAddMenuOpen(false));
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [overPos, setOverPos] = useState("before"); // "before" | "after" the overIndex row
  const listRef = useRef(null);

  // each object's own name (from the template it was placed from, editable in the
  // inspector), falling back to a numbered generic one
  const rows = [
    ...boxInstances.map((b, i) => ({ kind: "box", id: b.id, name: b.name || `箱${i + 1}`, layer: b.layer ?? 0 })),
    ...componentInstances.map((c, i) => ({ kind: "component", id: c.id, name: c.name || `コンポーネント${i + 1}`, layer: c.layer ?? 0 })),
  ].sort((a, b) => b.layer - a.layer);

  // every object is removable, boxes included — the scene is allowed to be empty
  const canRemove = () => true;

  // drag reorders the visual list; on drop, every row's `layer` is renumbered to match
  // the new order (highest = top of list = drawn last = visually "on top", same
  // convention the list already sorts by) — a deliberate manual override, so any
  // same-layer grouping the items had before (see resolveStacking's "same layer never
  // stacks" rule) is intentionally collapsed into the explicit order the user just set.
  const resetDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };
  // listens on the whole scrollable list (not each row individually) so the drop
  // target keeps tracking the cursor even in the gaps between rows, over the
  // container's own padding, or past the first/last row — previously each row only
  // updated the target while the cursor was directly over ITS OWN half, so drifting
  // even slightly off a row (easy to do, especially against the last row where
  // there's no row below to hand off to) froze the drop target and made it read as
  // "stuck"/un-droppable. Finds whichever row's vertical CENTER is nearest the
  // cursor and drops before/after it based on which side the cursor is on — this
  // naturally extends the first row's "before" zone and the last row's "after" zone
  // to cover all remaining space above/below the list.
  const handleListDragOver = (e) => {
    if (dragIndex === null || !listRef.current) return;
    e.preventDefault();
    const rowEls = listRef.current.querySelectorAll("[data-row-index]");
    let nearestIndex = null;
    let nearestPos = "before";
    let minDist = Infinity;
    rowEls.forEach((el) => {
      const idx = Number(el.dataset.rowIndex);
      const rect = el.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const dist = Math.abs(e.clientY - mid);
      if (dist < minDist) {
        minDist = dist;
        nearestIndex = idx;
        nearestPos = e.clientY < mid ? "before" : "after";
      }
    });
    if (nearestIndex === null) return;
    setOverIndex(nearestIndex);
    setOverPos(nearestPos);
  };
  // Alt+drag duplicates instead of moving: the original row stays put and a new
  // instance is inserted at the drop position (mirrors the same Alt+drag gesture on
  // objects in the viewport — see the pointer-down handler in PackageBoxMockup.jsx).
  const handleDrop = (altKey) => {
    if (dragIndex === null || overIndex === null) {
      resetDrag();
      return;
    }
    const draggedRow = rows[dragIndex];
    const overRow = rows[overIndex];

    if (altKey) {
      const newId = onDuplicate(draggedRow.kind, draggedRow.id);
      if (newId == null) {
        resetDrag();
        return;
      }
      const newRow = { kind: draggedRow.kind, id: newId, layer: 0 };
      let insertAt = rows.findIndex((r) => r.kind === overRow.kind && r.id === overRow.id);
      if (overPos === "after") insertAt += 1;
      const withDup = [...rows.slice(0, insertAt), newRow, ...rows.slice(insertAt)];
      const n = withDup.length;
      onReorder(withDup.map((row, i) => ({ kind: row.kind, id: row.id, layer: n - 1 - i })));
      resetDrag();
      return;
    }

    const withoutDragged = rows.filter((_, i) => i !== dragIndex);
    let insertAt = withoutDragged.findIndex((r) => r.kind === overRow.kind && r.id === overRow.id);
    if (insertAt === -1) insertAt = withoutDragged.length;
    if (overPos === "after") insertAt += 1;
    const reordered = [...withoutDragged.slice(0, insertAt), draggedRow, ...withoutDragged.slice(insertAt)];
    const n = reordered.length;
    onReorder(reordered.map((row, i) => ({ kind: row.kind, id: row.id, layer: n - 1 - i })));
    resetDrag();
  };

  return (
    <div className="h-full flex flex-col rounded-lg p-3" style={{ background: "var(--bg-surface-1)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <div style={sectionTitle}>
          レイヤー(配置したコンポーネント)
        </div>
        <div ref={addMenuRef} className="flex gap-1 relative">
          {activeSelection && (
            <button
              onClick={() => onDuplicate(activeSelection.kind, activeSelection.id)}
              style={buttonStyle("quiet")}
              title="選択中のオブジェクトを複製"
            >
              複製
            </button>
          )}
          {/* quiet, not accent: adding a layer is routine, and the accent is spent on
              書き出し in the header — one loud control per screen, not three */}
          <button onClick={() => setAddMenuOpen((v) => !v)} style={buttonStyle("quiet", { active: addMenuOpen })}>
            ＋追加 ▾
          </button>
          {addMenuOpen && (
            <div className="absolute right-0 top-full mt-1">
              <LibraryMenu
                items={libraryItems}
                onPick={(item) => {
                  onPlace(item);
                  setAddMenuOpen(false);
                }}
                footer={
                  <button
                    onClick={() => {
                      onOpenLibrary?.();
                      setAddMenuOpen(false);
                    }}
                    className="text-xs text-left px-3 py-2 flex-shrink-0"
                    style={{ color: "var(--highlight)", background: "transparent", border: "none", borderTop: "1px solid var(--border)" }}
                  >
                    コンポーネント一覧を開く
                  </button>
                }
              />
            </div>
          )}
        </div>
      </div>

      <div
        ref={listRef}
        className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto"
        onDragOver={handleListDragOver}
        onDrop={(e) => {
          e.preventDefault();
          handleDrop(e.altKey);
        }}
      >
        {rows.map((row, index) => {
          const selected = selectedKeys.includes(`${row.kind}:${row.id}`) || (activeSelection?.kind === row.kind && activeSelection?.id === row.id);
          return (
            <OutlinerRow
              key={`${row.kind}:${row.id}`}
              row={row}
              index={index}
              selected={selected}
              onSelect={onSelect}
              onRemove={onRemove}
              canRemove={canRemove(row.kind)}
              dragging={dragIndex === index}
              dropBefore={overIndex === index && overPos === "before" && dragIndex !== index}
              dropAfter={overIndex === index && overPos === "after" && dragIndex !== index}
              dragHandlers={{
                onDragStart: (e) => {
                  setDragIndex(index);
                  e.dataTransfer.effectAllowed = "move";
                },
                onDragEnd: resetDrag,
              }}
            />
          );
        })}
      </div>
      <p className="text-xs mt-2 flex-shrink-0" style={{ color: "var(--text-muted)" }}>
        {modKeys("上にあるものほど上に積まれます。ドラッグ、または Ctrl+] / Ctrl+[(Shiftで最前面・最背面)で並び替え。Shift/Ctrlクリック、または3DビューでShift+ドラッグで複数選択。")}
      </p>
    </div>
  );
}
