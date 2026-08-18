import React, { useState } from "react";
import ScrubField from "./ScrubField.jsx";
import ShapePreview, { shapeClipPath } from "./ShapePreview.jsx";
import { COMPONENT_SHAPE_KINDS } from "../lib/components.js";

function ShapeIconButton({ kind, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="rounded flex items-center justify-center"
      style={{
        width: "40px",
        height: "40px",
        background: "#12203a",
        border: active ? "2px solid #e2432a" : "1px solid #3a5a78",
        padding: "6px",
      }}
      title={COMPONENT_SHAPE_KINDS.find((k) => k.key === kind)?.label}
    >
      <div className="w-full h-full" style={{ background: "#5fd3d9", clipPath: shapeClipPath(kind) }} />
    </button>
  );
}

function ComponentEntry({ component, onRename, onSetColor, onUploadImage, onPasteImage, onOpenCropEditor, onRemove, onAutoDetectShape, onUpdate, onSetSvgShape }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hover, setHover] = useState(false);

  return (
    <div className="rounded p-2 flex flex-col gap-2" style={{ background: "#1c1a17", border: "1px solid #3a372f" }}>
      <div
        className="relative"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <button
          onClick={() => setPickerOpen((v) => !v)}
          className="w-full rounded overflow-hidden"
          style={{ aspectRatio: "1 / 1", background: "#12203a", border: "1px solid #3a5a78" }}
          title="クリックで形状を変更"
        >
          <ShapePreview component={component} />
        </button>
        {hover && !pickerOpen && (
          <button
            onClick={() => setPickerOpen(true)}
            className="absolute bottom-1.5 right-1.5 text-xs rounded px-2 py-1"
            style={{ background: "#efe6d4", color: "#1c1a17", fontWeight: 600 }}
          >
            変更
          </button>
        )}
        {pickerOpen && (
          <div
            className="absolute z-20 top-full mt-1 left-0 rounded p-2 flex flex-col gap-2"
            style={{ background: "#242220", border: "1px solid #3a372f", width: "180px" }}
          >
            <div className="grid grid-cols-4 gap-1">
              {COMPONENT_SHAPE_KINDS.map((k) => (
                <ShapeIconButton
                  key={k.key}
                  kind={k.key}
                  active={component.kind === k.key}
                  onClick={() => {
                    onUpdate(component.id, { kind: k.key });
                    setPickerOpen(false);
                  }}
                />
              ))}
            </div>
            <label
              className="text-center text-xs rounded py-2 cursor-pointer"
              style={{ background: component.kind === "svg" ? "#5fd3d9" : "#3a372f", color: component.kind === "svg" ? "#12203a" : "#efe6d4", fontWeight: 600 }}
            >
              + SVGを読み込む
              <input
                type="file"
                accept=".svg,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onSetSvgShape(component.id, file);
                  setPickerOpen(false);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              onClick={() => setPickerOpen(false)}
              className="text-xs rounded py-1"
              style={{ background: "#1c1a17", color: "#7d7568" }}
            >
              閉じる
            </button>
          </div>
        )}
      </div>

      <input
        type="text"
        value={component.name}
        onChange={(e) => onRename(component.id, e.target.value)}
        className="text-xs rounded px-1.5 py-1"
        style={{ background: "#12203a", color: "#efe6d4", border: "1px solid #3a5a78" }}
      />

      <div className="flex items-center gap-1">
        <input
          type="color"
          value={component.color}
          onChange={(e) => onSetColor(component.id, e.target.value)}
          title="カラー"
          style={{ width: "26px", height: "26px", padding: 0, border: "1px solid #3a372f", background: "none", cursor: "pointer", flexShrink: 0 }}
        />
        <label
          className="flex-1 text-center text-xs rounded py-1.5 cursor-pointer"
          style={{ background: "#3a372f", color: "#efe6d4" }}
        >
          画像
          <input type="file" accept="image/*" onChange={(e) => onUploadImage(component.id, e)} className="hidden" />
        </label>
      </div>

      {component.img && (
        <div className="flex items-center gap-1">
          <button onClick={() => onPasteImage(component.id)} className="flex-1 text-xs rounded py-1" style={{ background: "#3a372f", color: "#efe6d4" }}>
            貼付
          </button>
          <button onClick={() => onOpenCropEditor(component.id)} className="flex-1 text-xs rounded py-1" style={{ background: "#5fd3d9", color: "#12203a", fontWeight: 600 }}>
            トリム
          </button>
          <button onClick={() => onAutoDetectShape(component.id)} className="flex-1 text-xs rounded py-1" style={{ background: "transparent", border: "1px solid #5fd3d9", color: "#5fd3d9" }} title="透明部分から形状と角丸を推定します">
            形状検出
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-1">
        <ScrubField label="H" value={component.thickness} onChange={(v) => onUpdate(component.id, { thickness: Math.max(0.1, v) })} min={0.1} max={300} unit="mm" />
        <ScrubField label="W" value={component.w} onChange={(v) => onUpdate(component.id, { w: Math.max(1, v) })} min={1} max={500} unit="mm" />
      </div>
      <ScrubField label="D" value={component.d} onChange={(v) => onUpdate(component.id, { d: Math.max(1, v) })} min={1} max={500} unit="mm" />
      {component.kind === "roundedSquare" && (
        <ScrubField
          label="角の丸み"
          value={component.cornerRadius}
          onChange={(v) => onUpdate(component.id, { cornerRadius: Math.max(0, v) })}
          min={0}
          max={Math.max(1, Math.min(component.w, component.d) / 2)}
          unit="mm"
        />
      )}

      <button onClick={() => onRemove(component.id)} className="text-xs rounded py-1" style={{ background: "#3a372f", color: "#e2432a" }}>
        削除
      </button>
    </div>
  );
}

// unified component library: replaces the old separate symbol library (image+color)
// and piece shape library (kind+dims) — each entry now bundles shape, size, color, and
// image together. "＋新規コンポーネント" offers a card/piece PRESET as a quick-start
// (just default values — every field stays freely editable afterward regardless of
// which preset was picked).
export default function ComponentLibraryPanel({
  components,
  onAddComponent,
  onRename,
  onSetColor,
  onUploadImage,
  onPasteImage,
  onOpenCropEditor,
  onRemove,
  onAutoDetectShape,
  onUpdate,
  onSetSvgShape,
}) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  return (
    <div
      className="flex-shrink-0 rounded-lg p-3 flex flex-col"
      style={{ width: "460px", background: "#242220", border: "1px solid #3a372f", height: "100%" }}
    >
      <div className="flex items-center justify-between flex-shrink-0 mb-2 relative">
        <div className="text-xs uppercase" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
          コンポーネントライブラリ(カード・駒の絵柄)
        </div>
        <button
          onClick={() => setAddMenuOpen((v) => !v)}
          className="text-xs rounded px-2 py-1 flex-shrink-0"
          style={{ background: "#e2432a", color: "#1c1a17", fontWeight: 600 }}
        >
          ＋新規コンポーネント ▾
        </button>
        {addMenuOpen && (
          <div
            className="absolute right-0 top-full mt-1 rounded flex flex-col overflow-hidden z-10"
            style={{ background: "#1c1a17", border: "1px solid #3a372f", minWidth: "140px" }}
          >
            <button
              onClick={() => {
                onAddComponent("card");
                setAddMenuOpen(false);
              }}
              className="text-xs text-left px-3 py-2"
              style={{ color: "#efe6d4" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#2c2924")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              カード用(薄い角丸)
            </button>
            <button
              onClick={() => {
                onAddComponent("piece");
                setAddMenuOpen(false);
              }}
              className="text-xs text-left px-3 py-2"
              style={{ color: "#efe6d4" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#2c2924")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              駒用(厚い円形)
            </button>
          </div>
        )}
      </div>
      <p className="text-xs mb-2 flex-shrink-0" style={{ color: "#7d7568" }}>
        形状・サイズ・色・画像を1つのコンポーネントとして登録しておくと、配置したオブジェクトから選んで割り当てられます。カード用/駒用は初期値のプリセットで、登録後はどちらも自由に編集できます。
      </p>
      <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-3 gap-2 content-start" style={{ overflow: "visible" }}>
        {components.length === 0 && (
          <p className="text-xs col-span-3" style={{ color: "#7d7568" }}>
            まだコンポーネントがありません。「＋新規コンポーネント」から追加してください。
          </p>
        )}
        {components.map((c) => (
          <ComponentEntry
            key={c.id}
            component={c}
            onRename={onRename}
            onSetColor={onSetColor}
            onUploadImage={onUploadImage}
            onPasteImage={onPasteImage}
            onOpenCropEditor={onOpenCropEditor}
            onRemove={onRemove}
            onAutoDetectShape={onAutoDetectShape}
            onUpdate={onUpdate}
            onSetSvgShape={onSetSvgShape}
          />
        ))}
      </div>
    </div>
  );
}
