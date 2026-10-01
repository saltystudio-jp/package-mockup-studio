import React, { useState } from "react";
import Section from "./Section.jsx";
import LibraryThumb from "./LibraryThumb.jsx";
import { buttonStyle, sectionMeta, helpText } from "../lib/ui.js";
import { LIBRARY_GROUPS, sizeLabel } from "../lib/presets.js";

// One entry. The whole tile places it (click) or can be dragged onto the 3D view; the
// ⇄ corner button swaps the selected object for it instead. Registered entries can be
// renamed (double-click the name) and removed; built-in presets can't.
function LibraryTile({ item, canReplace, onPlace, onReplace, onRename, onRemove, dragType }) {
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const isUser = item.group === "user";

  return (
    <div
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.setData(dragType, item.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => !editing && onPlace(item)}
      title={`${item.name}(クリックで配置・3Dビューへドラッグして配置)`}
      className="relative rounded p-1.5 flex flex-col gap-1 cursor-pointer"
      style={{
        background: hover ? "var(--row-hover)" : "var(--bg-surface-1)",
        border: "1px solid var(--border)",
        transition: "background 120ms ease",
      }}
    >
      <div className="rounded overflow-hidden" style={{ aspectRatio: "1 / 1", background: "var(--bg-well)", padding: item.objKind === "box" ? 0 : "12%" }}>
        <LibraryThumb item={item} />
      </div>
      {editing ? (
        <input
          autoFocus
          defaultValue={item.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name) onRename(item.id, name);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
          className="rounded px-1 w-full min-w-0"
          style={{ fontSize: "11px", background: "var(--bg-well)", color: "var(--text-primary)", border: "1px solid var(--highlight)" }}
        />
      ) : (
        <div
          className="truncate"
          style={{ fontSize: "11px", color: "var(--text-primary)", lineHeight: 1.3 }}
          onDoubleClick={(e) => {
            if (!isUser) return;
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {item.name}
        </div>
      )}
      <div className="truncate" style={sectionMeta}>
        {sizeLabel(item)}
      </div>

      {/* corner actions, shown on hover so a grid of tiles stays quiet */}
      {hover && !editing && (
        <div className="absolute flex gap-1" style={{ top: "4px", right: "4px" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (canReplace) onReplace(item);
            }}
            disabled={!canReplace}
            title={canReplace ? "選択中のオブジェクトをこれに置き換え" : "置き換えるオブジェクトを選択してください"}
            style={{ ...buttonStyle("quiet"), padding: "1px 5px", opacity: canReplace ? 1 : 0.4, cursor: canReplace ? "pointer" : "default" }}
          >
            ⇄
          </button>
          {isUser && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item.id);
              }}
              title="登録を削除(配置済みのオブジェクトには影響しません)"
              style={{ ...buttonStyle("danger"), padding: "1px 5px", background: "var(--bg-surface-1)" }}
            >
              ×
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// The コンポーネント tab: every template that can go into the scene — the three box
// types, standard card sizes, tokens, and whatever has been registered from the scene.
// Nothing here is edited in place (size, artwork etc. belong to the placed object and
// are edited in the オブジェクト tab); the library only places, replaces and registers.
export default function LibraryPanel({ items, selectedName, onPlace, onReplace, onRegister, onRename, onRemove, dragType }) {
  const [justRegistered, setJustRegistered] = useState(false);
  const canReplace = selectedName != null;
  const groups = LIBRARY_GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.key) }));

  return (
    <>
      {/* registering is offered here too (as well as next to 置き換え in the
          オブジェクト tab): this is where registered entries end up */}
      <Section
        first
        title="選択中のオブジェクト"
        hint="サイズや絵柄を設定したオブジェクトを登録すると、下の「登録済み」から同じものを配置したり、別のオブジェクトをそれに置き換えたりできます。"
      >
        {canReplace ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate" style={{ fontSize: "12px", color: "var(--text-primary)" }}>
              {selectedName}
            </span>
            <button
              onClick={() => {
                onRegister();
                setJustRegistered(true);
                setTimeout(() => setJustRegistered(false), 1500);
              }}
              style={buttonStyle("quiet", { active: justRegistered })}
            >
              {justRegistered ? "登録しました" : "コンポーネントとして登録"}
            </button>
          </div>
        ) : (
          <p style={helpText}>クリックまたはドラッグで配置。オブジェクトを選択すると、ここで登録したり、⇄ でそれに置き換えたりできます。</p>
        )}
      </Section>

      {groups.map((g) =>
        g.items.length === 0 && g.key === "user" ? null : (
          <Section key={g.key} title={g.label} meta={`${g.items.length}`}>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))" }}>
              {g.items.map((item) => (
                <LibraryTile
                  key={item.id}
                  item={item}
                  canReplace={canReplace}
                  onPlace={onPlace}
                  onReplace={onReplace}
                  onRename={onRename}
                  onRemove={onRemove}
                  dragType={dragType}
                />
              ))}
            </div>
          </Section>
        )
      )}
    </>
  );
}
