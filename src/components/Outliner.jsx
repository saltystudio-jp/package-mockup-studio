import React, { useState } from "react";

const TYPE_LABEL = { box: "箱", card: "カード", piece: "駒" };
const TYPE_DOT_STYLE = {
  box: { background: "#cbb98f", borderRadius: "2px" },
  card: { background: "#5fd3d9", borderRadius: "1px" },
  piece: {
    background: "#f2a65a",
    clipPath: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
  },
};

// unified layers panel: box/card/piece used to each have their own independent
// "配置(N数)" chip list (add/duplicate/remove/select), duplicating the same UI pattern
// three times and giving the user three separate places to learn. This merges them
// into one list — sorted by layer (higher = drawn later = visually "on top", same
// convention as a typical layers panel) — so selecting/adding/removing/duplicating any
// placed object works the same way regardless of its kind, and where something sits in
// the stacking order (see the ground-snap/layer resolver) is visible at a glance.
//
// Fills its whole column (h-full) rather than capping its own list at a small fixed
// height — it lives alone in a dedicated column now, so there's no reason to make it
// scroll internally after ~6 rows while the rest of that column sits empty below it.
export default function Outliner({ boxInstances, cardInstances, pieceInstances, activeSelection, onSelect, onAdd, onDuplicate, onRemove }) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const rows = [
    ...boxInstances.map((b, i) => ({ kind: "box", id: b.id, name: `箱${i + 1}`, layer: b.layer ?? 0 })),
    ...cardInstances.map((c, i) => ({ kind: "card", id: c.id, name: `カード${i + 1}`, layer: c.layer ?? 0 })),
    ...pieceInstances.map((p, i) => ({ kind: "piece", id: p.id, name: `駒${i + 1}`, layer: p.layer ?? 0 })),
  ].sort((a, b) => b.layer - a.layer);

  const canRemove = (kind) => kind !== "box" || boxInstances.length > 1;

  return (
    <div className="h-full flex flex-col rounded-lg p-3" style={{ background: "#242220", border: "1px solid #3a372f" }}>
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <div className="text-xs uppercase" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
          レイヤー(配置したオブジェクト)
        </div>
        <div className="flex gap-1 relative">
          {activeSelection && (
            <button
              onClick={() => onDuplicate(activeSelection.kind, activeSelection.id)}
              className="text-xs rounded px-2 py-1"
              style={{ background: "#3a372f", color: "#5fd3d9" }}
              title="選択中のオブジェクトを複製"
            >
              複製
            </button>
          )}
          <button
            onClick={() => setAddMenuOpen((v) => !v)}
            className="text-xs rounded px-2 py-1"
            style={{ background: "#e2432a", color: "#1c1a17", fontWeight: 600 }}
          >
            ＋追加 ▾
          </button>
          {addMenuOpen && (
            <div
              className="absolute right-0 top-full mt-1 rounded flex flex-col overflow-hidden z-10"
              style={{ background: "#1c1a17", border: "1px solid #3a372f", minWidth: "100px" }}
            >
              {["box", "card", "piece"].map((kind) => (
                <button
                  key={kind}
                  onClick={() => {
                    onAdd(kind);
                    setAddMenuOpen(false);
                  }}
                  className="text-xs text-left px-3 py-2"
                  style={{ color: "#efe6d4" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#2c2924")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {TYPE_LABEL[kind]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto">
        {rows.map((row) => {
          const selected = activeSelection?.kind === row.kind && activeSelection?.id === row.id;
          return (
            <div
              key={`${row.kind}:${row.id}`}
              onClick={() => onSelect(row.kind, row.id)}
              className="flex items-center gap-2 rounded px-2 py-2 cursor-pointer text-xs flex-shrink-0"
              style={{
                background: selected ? "#332e26" : "transparent",
                border: `1px solid ${selected ? "#5fd3d9" : "transparent"}`,
              }}
            >
              <span style={{ width: "9px", height: "9px", flexShrink: 0, ...TYPE_DOT_STYLE[row.kind] }} />
              <span className="flex-1" style={{ color: selected ? "#efe6d4" : "#c9c2b4", fontWeight: selected ? 600 : 400 }}>
                {row.name}
              </span>
              <span
                className="rounded px-1"
                style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", color: "#7d7568", background: "#1c1a17", border: "1px solid #3a372f" }}
                title="レイヤー"
              >
                L{row.layer}
              </span>
              {canRemove(row.kind) && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(row.kind, row.id);
                  }}
                  className="rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ width: "16px", height: "16px", background: "rgba(0,0,0,0.3)", fontSize: "11px", lineHeight: 1, color: "#a89f8f" }}
                  title="削除"
                >
                  ×
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs mt-2 flex-shrink-0" style={{ color: "#7d7568" }}>
        クリックで選択(右のインスペクターに反映)。レイヤー番号が大きいほど上に乗ります。
      </p>
    </div>
  );
}
