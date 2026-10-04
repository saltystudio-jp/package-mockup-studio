import React, { useState } from "react";

const STORE_KEY = "pms.sectionsOpen";
const remembered = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
  } catch {
    return {};
  }
})();
function remember(title, open) {
  remembered[title] = open;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(remembered));
  } catch {
    // storage unavailable: still remembered for this session
  }
}
import { sectionTitle, sectionMeta, helpText } from "../lib/ui.js";

// One group of settings in the inspector. Replaces the bordered card that every group
// used to be wrapped in (see lib/ui.js for why): a hairline rule and a heading, with
// the panel's own padding bled through so the rule spans the full sidebar width and
// reads as a divider between parts of one instrument, not as a gap between cards.
//
// `collapsible` sections remember whether they're open, by title: switching tabs or
// selecting another object (which unmounts and remounts them) used to fold everything
// back to its default every time. `defaultOpen` only applies until that section is
// first opened or closed; the choice also survives a reload (per browser).
//
// A folded section shows `summary` in its heading row, so collapsing is never
// information loss: "高さ 30 / クリア 2" tells you what's inside without unfolding it.
//
// `hint` is the long explanation a group sometimes needs ("環境光が強いと影が浅くなり…").
// Those used to sit permanently under their fields, so a panel of six groups carried
// six paragraphs you'd read once and then scroll past forever. Behind the ⓘ they're
// one click away and cost no vertical space until asked for. Deliberately click, not
// hover: the sidebar is narrow and resizable, and a hover tooltip there is a moving
// target that also never appears on a touch screen.
export default function Section({
  title,
  meta,
  summary,
  hint,
  collapsible = false,
  defaultOpen = true,
  first = false,
  children,
}) {
  const key = typeof title === "string" ? title : null;
  const [open, setOpenState] = useState(() => (key && key in remembered ? remembered[key] : defaultOpen));
  const setOpen = (fn) =>
    setOpenState((v) => {
      const next = typeof fn === "function" ? fn(v) : fn;
      if (key) remember(key, next);
      return next;
    });
  const [hintOpen, setHintOpen] = useState(false);
  const expanded = !collapsible || open;

  const headingInner = (
    <>
      {collapsible && (
        <span
          aria-hidden="true"
          style={{
            color: "var(--text-faint)",
            fontSize: "9px",
            width: "10px",
            flexShrink: 0,
            display: "inline-block",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 120ms ease",
          }}
        >
          ▶
        </span>
      )}
      <span style={sectionTitle}>{title}</span>
      <span className="flex-1" />
      {!expanded && summary && <span className="truncate" style={sectionMeta}>{summary}</span>}
      {expanded && meta && <span className="truncate" style={sectionMeta}>{meta}</span>}
    </>
  );

  return (
    <div
      style={{
        borderTop: first ? "none" : "1px solid var(--border-strong)",
        // cancel the scroll container's horizontal padding so the rule is full-bleed
        margin: "0 -16px",
        padding: expanded ? "12px 16px 16px" : "12px 16px",
      }}
    >
      <div className="flex items-center gap-1.5">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={expanded}
            className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            {headingInner}
          </button>
        ) : (
          <div className="flex-1 min-w-0 flex items-center gap-1.5">{headingInner}</div>
        )}
        {hint && (
          <button
            type="button"
            onClick={() => setHintOpen((v) => !v)}
            aria-expanded={hintOpen}
            aria-label="説明を表示"
            className="rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              width: "15px",
              height: "15px",
              fontSize: "10px",
              lineHeight: 1,
              background: "none",
              border: `1px solid ${hintOpen ? "var(--highlight)" : "var(--border)"}`,
              color: hintOpen ? "var(--highlight)" : "var(--text-faint)",
              cursor: "pointer",
            }}
          >
            i
          </button>
        )}
      </div>
      {expanded && hintOpen && hint && (
        <p className="mt-2" style={helpText}>
          {hint}
        </p>
      )}
      {expanded && <div className="mt-2.5">{children}</div>}
    </div>
  );
}
