import { useEffect } from "react";

// closes a popup/dropdown when a pointer goes down outside `ref`'s element — every
// picker/menu in this app (component picker, shape picker, add-menus) previously only
// closed via its own explicit button, which read as broken/stuck to anyone used to
// standard dropdown behavior. Listens on pointerdown (not click) so it fires before a
// dragstart or other pointerdown-driven interaction elsewhere in the app.
export default function useClickOutside(ref, active, onOutside) {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onOutside();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [active, onOutside]);
}
