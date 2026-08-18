import React from "react";
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
    case "roundedSquare":
    default:
      return "inset(0 round 18%)";
  }
}

// a component's real appearance (tint color + image, if any) clipped to its shape —
// more informative than a bare outline icon since it doubles as an actual preview of
// what gets textured onto the placed object's top face.
export default function ShapePreview({ component }) {
  if (!component) {
    return <div className="w-full h-full rounded" style={{ background: "#242220" }} />;
  }
  const thumb = componentThumbSrc(component);
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
