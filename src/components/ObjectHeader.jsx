import React, { useRef, useState } from "react";
import LibraryMenu from "./LibraryMenu.jsx";
import useClickOutside from "../hooks/useClickOutside.js";
import { buttonStyle, sectionMeta } from "../lib/ui.js";

// Top of the inspector for whatever is selected, box or component alike: its name
// (editable in place — it's what the layer panel lists), what it is and its size, and
// the two library actions that act on it: swap it for a library entry, or save it as
// one.
export default function ObjectHeader({ object, kindLabel, sizeText, libraryItems, onRename, onReplace, onRegister }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);
  const menuRef = useRef(null);
  useClickOutside(menuRef, menuOpen, () => setMenuOpen(false));

  return (
    <div className="flex flex-col gap-1" style={{ marginBottom: "2px" }}>
      <input
        value={object.name ?? ""}
        placeholder={kindLabel}
        onChange={(e) => onRename(e.target.value)}
        className="w-full min-w-0 rounded px-1 -mx-1"
        style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", background: "transparent", border: "1px solid transparent", outline: "none" }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "var(--highlight)")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
        title="名前(レイヤーに表示されます)"
      />
      <div className="flex items-center gap-2">
        <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{kindLabel}</span>
        <span style={sectionMeta}>{sizeText}</span>
        <span className="flex-1" />
        <div ref={menuRef} className="relative">
          <button onClick={() => setMenuOpen((v) => !v)} style={buttonStyle("quiet", { active: menuOpen })} title="コンポーネント一覧から選んで置き換え(位置・向きはそのまま)">
            置き換え ▾
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1">
              <LibraryMenu
                items={libraryItems}
                onPick={(item) => {
                  onReplace(item);
                  setMenuOpen(false);
                }}
              />
            </div>
          )}
        </div>
        <button
          onClick={() => {
            onRegister();
            setJustRegistered(true);
            setTimeout(() => setJustRegistered(false), 1500);
          }}
          style={buttonStyle("quiet", { active: justRegistered })}
          title="この見た目(サイズ・絵柄)をコンポーネント一覧に登録"
        >
          {justRegistered ? "登録しました" : "登録"}
        </button>
      </div>
    </div>
  );
}
