import React from "react";
import { symbolThumbSrc } from "../lib/symbols.js";

// Illustrator-symbol-style shared asset registry: register an image (+ crop + tint
// color) once here, then card/piece instances just pick which symbol to show — instead
// of uploading a separate image per card/piece.
export default function SymbolLibraryPanel({
  symbols,
  onAddSymbol,
  onRenameSymbol,
  onSetColor,
  onUploadImage,
  onPasteImage,
  onOpenCropEditor,
  onRemoveSymbol,
  onAutoRoundFromAlpha,
}) {
  return (
    <div
      className="flex-shrink-0 rounded-lg p-3 flex flex-col"
      style={{ width: "420px", background: "#242220", border: "1px solid #3a372f", height: "100%" }}
    >
      <div className="flex items-center justify-between flex-shrink-0 mb-2">
        <div className="text-xs uppercase" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
          シンボルライブラリ(カード・駒の絵柄)
        </div>
        <button
          onClick={onAddSymbol}
          className="text-xs rounded px-2 py-1 flex-shrink-0"
          style={{ background: "#e2432a", color: "#1c1a17", fontWeight: 600 }}
        >
          ＋新規シンボル
        </button>
      </div>
      <p className="text-xs mb-2 flex-shrink-0" style={{ color: "#7d7568" }}>
        画像とカラーを一度登録しておくと、カードや駒の各インスタンスから選んで割り当てられます。
      </p>
      <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-3 gap-2 content-start">
        {symbols.length === 0 && (
          <p className="text-xs col-span-3" style={{ color: "#7d7568" }}>
            まだシンボルがありません。「＋新規シンボル」から追加してください。
          </p>
        )}
        {symbols.map((s) => {
          const thumb = symbolThumbSrc(s);
          return (
            <div
              key={s.id}
              className="rounded p-1.5 flex flex-col gap-1"
              style={{ background: "#1c1a17", border: "1px solid #3a372f" }}
            >
              <div
                className="rounded flex items-center justify-center overflow-hidden"
                style={{ width: "100%", height: "64px", background: s.color, position: "relative" }}
              >
                {thumb && (
                  <img src={thumb} alt={s.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                )}
              </div>
              <input
                type="text"
                value={s.name}
                onChange={(e) => onRenameSymbol(s.id, e.target.value)}
                className="text-xs rounded px-1 py-0.5"
                style={{ background: "#12203a", color: "#efe6d4", border: "1px solid #3a5a78", width: "100%" }}
              />
              <div className="flex items-center gap-1">
                <input
                  type="color"
                  value={s.color}
                  onChange={(e) => onSetColor(s.id, e.target.value)}
                  title="カラー"
                  style={{ width: "22px", height: "22px", padding: 0, border: "1px solid #3a372f", background: "none", cursor: "pointer", flexShrink: 0 }}
                />
                <label
                  className="flex-1 text-center text-xs rounded py-1 cursor-pointer"
                  style={{ background: "#3a372f", color: "#efe6d4" }}
                  title="画像をアップロード"
                >
                  画像
                  <input type="file" accept="image/*" onChange={(e) => onUploadImage(s.id, e)} className="hidden" />
                </label>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onPasteImage(s.id)}
                  className="flex-1 text-xs rounded py-1"
                  style={{ background: "#3a372f", color: "#efe6d4" }}
                  title="クリップボードから貼り付け"
                >
                  貼付
                </button>
                {s.img && (
                  <button
                    onClick={() => onOpenCropEditor(s.id)}
                    className="flex-1 text-xs rounded py-1"
                    style={{ background: "#5fd3d9", color: "#12203a", fontWeight: 600 }}
                    title="トリミング編集"
                  >
                    トリム
                  </button>
                )}
                <button
                  onClick={() => onRemoveSymbol(s.id)}
                  className="text-xs rounded px-1.5 py-1 flex-shrink-0"
                  style={{ background: "#3a372f", color: "#e2432a" }}
                  title="削除"
                >
                  ×
                </button>
              </div>
              {s.img && onAutoRoundFromAlpha && (
                <button
                  onClick={() => onAutoRoundFromAlpha(s.id)}
                  className="text-xs rounded py-1"
                  style={{ background: "transparent", border: "1px solid #5fd3d9", color: "#5fd3d9" }}
                  title="PNGの透明部分から角丸半径を自動検出してカードに適用します"
                >
                  角丸を自動検出
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
