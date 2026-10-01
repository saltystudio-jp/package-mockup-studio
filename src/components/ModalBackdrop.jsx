import React, { useRef } from "react";

// The dimmed full-screen layer behind every dialog. Clicking it (outside the dialog)
// dismisses the dialog without applying — but only when the press STARTED on it too:
// a drag that begins inside the dialog (moving a face, scrubbing a number) and is
// released outside would otherwise count as a click on the backdrop and throw the
// edit away.
export default function ModalBackdrop({ onDismiss, zIndex = 50, children }) {
  const downOnBackdrop = useRef(false);
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.75)", zIndex }}
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current) onDismiss?.();
        downOnBackdrop.current = false;
      }}
    >
      {children}
    </div>
  );
}
