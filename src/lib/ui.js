// Shared inspector chrome tokens.
//
// Before this file the sidebar was ~15 copies of the same `rounded-lg p-3` bordered
// card, each opened by the same `text-xs uppercase letterSpacing:.08em` label — every
// group, whatever it contained, got identical weight, so nothing read as more or less
// important than anything else and the panel was a wall of same-sized boxes. Two rules
// replace that:
//
// 1. Chrome encodes information. A box around something means "this is a distinct
//    object you can pick from or act on" (a library, a swatch grid). A plain heading
//    with a hairline above it means "this is another group of settings for the thing
//    you already selected". Most of the inspector is the second kind, so most of it
//    no longer has a box.
// 2. Two heading levels, not one. `sectionTitle` names a group; `fieldLabel` names a
//    control inside it. Uppercase + wide tracking is dropped — it does nothing for
//    Japanese text and made every label shout at the same volume.

export const sectionTitle = {
  fontSize: "12px",
  fontWeight: 600,
  color: "var(--text-primary)",
  lineHeight: 1.3,
};

export const fieldLabel = {
  fontSize: "11px",
  color: "var(--text-secondary)",
};

// right-hand annotation on a section heading: the unit its fields are in, or a
// summary of the values hidden inside while the section is folded away
export const sectionMeta = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: "10px",
  color: "var(--text-muted)",
  fontVariantNumeric: "tabular-nums",
};

export const helpText = {
  fontSize: "11px",
  color: "var(--text-muted)",
  lineHeight: 1.5,
};

// The three button roles the app is allowed to use, replacing the four ad-hoc
// treatments (accent fill / plain border fill / accent-outline / highlight-outline)
// that had accumulated with no rule about which meant what.
//
// primary — the one committing action of a screen (書き出す, 登録する)
// quiet   — every other action; recedes until hovered
// danger  — destructive (削除). Same shape as quiet so it doesn't shout, accent-colored
//           text so it's still distinguishable before you click it.
export function buttonStyle(role = "quiet", { active = false } = {}) {
  const base = {
    fontSize: "11px",
    borderRadius: "4px",
    padding: "4px 8px",
    // longhands only: roles below override the color, and mixing the `border` shorthand
    // with `borderColor` makes React drop the border when a button re-renders
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "transparent",
    transition: "background 120ms ease, color 120ms ease, border-color 120ms ease",
    cursor: "pointer",
  };
  if (role === "primary") {
    return { ...base, background: "var(--accent)", color: "#1c1a17", fontWeight: 600 };
  }
  if (role === "danger") {
    return { ...base, background: "transparent", borderColor: "var(--border)", color: "var(--accent)" };
  }
  return {
    ...base,
    background: active ? "var(--row-selected)" : "var(--bg-surface-1)",
    borderColor: "var(--border)",
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
  };
}
