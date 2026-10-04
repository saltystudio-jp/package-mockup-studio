import React from "react";
import ScrubField from "./ScrubField.jsx";
import { changeDims } from "../lib/dims.js";

// A link (chain) icon; drawn rather than an emoji so it takes the button's color
export function ChainIcon({ on }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M6.5 9.5l3-3" opacity={on ? 1 : 0.35} />
      <path d="M7 4.5l1.2-1.2a2.8 2.8 0 014 4L11 8.5" />
      <path d="M9 11.5l-1.2 1.2a2.8 2.8 0 01-4-4L5 7.5" />
    </svg>
  );
}

// 幅 / 奥行 / 高さ fields, each with a chain toggle: every dimension whose chain is on
// keeps its ratio to the others that are on (see lib/dims.js). Shared by the box
// inspector and the net layout editor, so the lock works the same in both.
//
// fields: [{ key, label, min?, max? }]; values: { key: mm }; linked: Set of keys
export default function DimensionFields({ fields, values, linked, onToggleLink, onChange }) {
  return (
    <div className="flex flex-col gap-2">
      {fields.map((f) => {
        const on = linked.has(f.key);
        return (
          <div key={f.key} className="flex items-center gap-1.5">
            <ScrubField
              className="flex-1 min-w-0"
              label={f.label}
              value={values[f.key] ?? 0}
              onChange={(v) => onChange(changeDims(values, f.key, Math.min(f.max ?? 2000, v), linked, f.min ?? 1))}
              min={f.min ?? 1}
              max={f.max ?? 2000}
              step={0.1}
              decimals={1}
              unit="mm"
            />
            <button
              type="button"
              onClick={() => onToggleLink(f.key)}
              aria-pressed={on}
              aria-label={`${f.label}の比率を固定`}
              title={on ? "比率の固定を解除" : "比率を固定(チェーンがオンの寸法どうしが同じ比率で変わります)"}
              className="flex items-center justify-center rounded flex-shrink-0"
              style={{
                width: "24px",
                height: "24px",
                background: on ? "var(--row-selected)" : "transparent",
                color: on ? "var(--accent)" : "var(--text-muted)",
                borderWidth: "1px",
                borderStyle: "solid",
                borderColor: on ? "var(--accent)" : "var(--border)",
                cursor: "pointer",
              }}
            >
              <ChainIcon on={on} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
