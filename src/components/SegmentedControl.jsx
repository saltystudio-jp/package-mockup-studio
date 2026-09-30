import React from "react";

// One control for every "pick one of these" row in the app — 立てる/寝かせる,
// 縦置き/平置き, and the 正面/右/背面/左 rotation presets were each hand-rolled as a
// flex row of independently-styled buttons, which is why they'd drifted to different
// heights, radii and selected colors.
//
// Two tones, because those rows aren't the same kind of choice:
//   accent — a real mode. The object IS standing or lying; the filled segment states
//            which, and it's worth the accent color.
//   quiet  — shortcuts that jump a continuous value to a common setting (rotation
//            presets). Marking the matching one is useful feedback, but it isn't a
//            mode you're "in", so it stays inside the panel's normal palette.
export default function SegmentedControl({ options, value, onChange, tone = "accent", size = "md" }) {
  const pad = size === "sm" ? "4px 0" : "7px 0";
  return (
    <div
      className="flex w-full rounded overflow-hidden"
      style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border)" }}
      role="group"
    >
      {options.map((opt, i) => {
        const selected = value === opt.value;
        const accentOn = selected && tone === "accent";
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={selected}
            className="flex-1 text-xs"
            style={{
              padding: pad,
              background: accentOn ? "var(--accent)" : selected ? "var(--row-selected)" : "transparent",
              color: accentOn ? "#1c1a17" : selected ? "var(--text-primary)" : "var(--text-secondary)",
              fontWeight: selected ? 600 : 400,
              border: "none",
              borderLeft: i === 0 ? "none" : "1px solid var(--border)",
              cursor: "pointer",
              transition: "background 120ms ease, color 120ms ease",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
