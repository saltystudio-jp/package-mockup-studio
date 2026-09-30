import React from "react";
import LibraryThumb from "./LibraryThumb.jsx";
import { LIBRARY_GROUPS, sizeLabel } from "../lib/presets.js";

// Dropdown list of library entries, grouped like the コンポーネント tab. Shared by the
// layer panel's "＋追加" menu and the inspector's "置き換え" menu so both read the same
// catalogue the same way. Positioning is the caller's job.
export default function LibraryMenu({ items, onPick, footer }) {
  return (
    <div
      className="rounded flex flex-col overflow-y-auto z-20"
      style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border)", minWidth: "200px", maxHeight: "360px", boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}
    >
      {LIBRARY_GROUPS.map((g) => {
        const groupItems = items.filter((i) => i.group === g.key);
        if (!groupItems.length) return null;
        return (
          <div key={g.key} className="flex flex-col flex-shrink-0">
            <div className="px-3 pt-2 pb-1" style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              {g.label}
            </div>
            {groupItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onPick(item)}
                className="text-left px-3 py-1.5 flex items-center gap-2 flex-shrink-0"
                style={{ color: "var(--text-primary)", background: "transparent", border: "none", fontSize: "12px" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--dropdown-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span className="rounded overflow-hidden flex-shrink-0" style={{ width: "20px", height: "20px", background: "var(--bg-well)" }}>
                  <LibraryThumb item={item} />
                </span>
                <span className="flex-1 truncate">{item.name}</span>
                <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>{sizeLabel(item)}</span>
              </button>
            ))}
          </div>
        );
      })}
      {footer}
    </div>
  );
}
