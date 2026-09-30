import React from "react";
import ShapePreview from "./ShapePreview.jsx";

// Line drawings of the three box types — enough to tell them apart at thumbnail size
// before any artwork exists. Stroke uses currentColor so the icon follows the theme.
function BoxGlyph({ type }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinejoin: "round" };
  return (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      {type === "sleeve" ? (
        <>
          {/* tray pulled partway out of an open-ended sleeve */}
          <path d="M8 22 L22 15 L42 22 L28 29 Z" {...common} opacity="0.55" />
          <path d="M14 24 L28 17 L42 24 L42 32 L28 39 L14 32 Z" {...common} />
          <path d="M14 24 L28 31 L42 24 M28 31 L28 39" {...common} />
          <path d="M8 22 L8 28 L14 31" {...common} opacity="0.55" />
        </>
      ) : (
        <>
          <path d="M8 18 L24 10 L40 18 L40 32 L24 40 L8 32 Z" {...common} />
          <path d="M8 18 L24 26 L40 18 M24 26 L24 40" {...common} />
          {/* a lidded box shows the lid's lower edge; a one-piece carton doesn't */}
          {type !== "caramel" && <path d="M8 23 L24 31 L40 23" {...common} opacity="0.7" />}
        </>
      )}
    </svg>
  );
}

// the first sheet a box template carries art on, for its thumbnail
function firstNetImage(template) {
  const nets = template.nets || {};
  const slot = ["body", "lid", "caramel", "sleeve", "tray"].find((k) => nets[k]?.img);
  return slot ? nets[slot].img : null;
}

// Thumbnail for a library entry: a box shows its artwork if it has any, otherwise its
// type's glyph; a card or token shows its real shape, color and image (ShapePreview).
export default function LibraryThumb({ item }) {
  if (item.objKind !== "box") {
    return <ShapePreview component={{ ...item.template, name: item.name }} />;
  }
  const img = firstNetImage(item.template);
  if (img) {
    return <img src={img.src} alt={item.name} className="w-full h-full rounded" style={{ objectFit: "cover" }} />;
  }
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ color: "var(--text-secondary)", padding: "10%" }}>
      <BoxGlyph type={item.template.boxType} />
    </div>
  );
}
