import React, { useMemo } from "react";
import { componentThumbSrc } from "../lib/components.js";

// outline/fill approximation for a shape kind via CSS clip-path — used for a
// component's own preview thumbnail and for the small buttons in shape-picker
// popups. Good enough to recognize at a glance; "svg" (an arbitrary uploaded outline)
// can't be cheaply previewed this way, so it gets a plain text badge instead.
export function shapeClipPath(kind) {
  switch (kind) {
    case "circle":
      return "circle(50% at 50% 50%)";
    case "hexagon":
      return "polygon(25% 6.7%, 75% 6.7%, 100% 50%, 75% 93.3%, 25% 93.3%, 0% 50%)";
    case "triangle":
      return "polygon(50% 2%, 98% 98%, 2% 98%)";
    case "roundTop":
      return "inset(0 round 34% 34% 0 0)";
    case "roundedSquare":
    default:
      return "inset(0 round 18%)";
  }
}

// a component's real appearance (tint color + image, if any) clipped to its shape —
// more informative than a bare outline icon since it doubles as an actual preview of
// what gets textured onto the placed object's top face.
export default function ShapePreview({ component }) {
  // cropping re-encodes the image to a data URL, which is far too expensive to redo on
  // every render (this component renders once per library card AND once per swatch) —
  // recompute only when the image or its crop rectangle actually changes.
  const thumb = useMemo(
    () => (component ? componentThumbSrc(component) : null),
    [component?.img, component?.transform]
  );
  if (!component) {
    return <div className="w-full h-full rounded" style={{ background: "var(--bg-surface-1)" }} />;
  }
  // a die: its top face (the 5), with the body's outline — round for the ball-cut style
  if (component.kind === "die") {
    const round = component.dieStyle === "ballcut";
    return (
      <svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden="true">
        <rect x="2" y="2" width="36" height="36" rx={round ? 18 : 7} fill={component.color} stroke="rgba(0,0,0,0.25)" />
        {[
          [12, 12],
          [28, 12],
          [20, 20],
          [12, 28],
          [28, 28],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={round ? 3 : 3.4} fill={component.pipColor || "#1c1a17"} />
        ))}
      </svg>
    );
  }
  // a die-cut IS its image's silhouette: the transparent PNG shows the shape by itself
  if (component.kind === "alpha" && thumb) {
    return <img src={thumb} alt={component.name} className="w-full h-full" style={{ objectFit: "contain" }} />;
  }
  if (component.kind === "svg") {
    return (
      <div
        className="w-full h-full rounded flex items-center justify-center text-xs"
        style={{ background: component.color, color: "#1c1a17", fontWeight: 700 }}
      >
        SVG
      </div>
    );
  }
  return (
    <div className="relative w-full h-full">
      <div className="absolute inset-0" style={{ background: component.color, clipPath: shapeClipPath(component.kind) }} />
      {thumb && (
        <img
          src={thumb}
          alt={component.name}
          className="absolute inset-0 w-full h-full"
          style={{ objectFit: "contain", clipPath: shapeClipPath(component.kind) }}
        />
      )}
    </div>
  );
}
