import React from "react";
import { PIECE_SHAPE_KINDS } from "../lib/shapes2d.js";

// piece shape library: a small reusable set of GEOMETRY definitions (as opposed to the
// symbol library, which is images) — define a shape (preset, later also custom SVG)
// once, then piece instances reference which one to use. Kept separate from symbols
// since a scene typically mixes several different piece TYPES (pawn vs king), each
// possibly reused many times with different top-face images/colors.
export default function PieceShapeLibraryPanel({ shapeDefs, onAdd, onAddFromSvg, onUpdate, onRemove }) {
  return (
    <div
      className="flex-shrink-0 rounded-lg p-3 flex flex-col"
      style={{ width: "420px", background: "#242220", border: "1px solid #3a372f", height: "100%" }}
    >
      <div className="flex items-center justify-between flex-shrink-0 mb-2 gap-1">
        <div className="text-xs uppercase" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
          駒の形状ライブラリ
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {onAddFromSvg && (
            <label
              className="text-xs rounded px-2 py-1 cursor-pointer"
              style={{ background: "#5fd3d9", color: "#12203a", fontWeight: 600 }}
              title="SVGファイルの輪郭を押し出して形状にします"
            >
              SVGを読み込む
              <input
                type="file"
                accept=".svg,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onAddFromSvg(file);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          <button
            onClick={onAdd}
            className="text-xs rounded px-2 py-1"
            style={{ background: "#e2432a", color: "#1c1a17", fontWeight: 600 }}
          >
            ＋新規形状
          </button>
        </div>
      </div>
      <p className="text-xs mb-2 flex-shrink-0" style={{ color: "#7d7568" }}>
        形状(円・四角・六角形など)とサイズを登録しておくと、駒の各インスタンスから選んで割り当てられます。SVGを読み込むと、その輪郭を押し出した独自形状も作れます。
      </p>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
        {shapeDefs.length === 0 && (
          <p className="text-xs" style={{ color: "#7d7568" }}>
            まだ形状がありません。「＋新規形状」から追加してください。
          </p>
        )}
        {shapeDefs.map((d) => (
          <div key={d.id} className="rounded p-2 flex flex-col gap-1.5" style={{ background: "#1c1a17", border: "1px solid #3a372f" }}>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={d.name}
                onChange={(e) => onUpdate(d.id, { name: e.target.value })}
                className="text-xs rounded px-1 py-0.5 flex-1"
                style={{ background: "#12203a", color: "#efe6d4", border: "1px solid #3a5a78" }}
              />
              <button
                onClick={() => onRemove(d.id)}
                className="text-xs rounded px-1.5 py-1 flex-shrink-0"
                style={{ background: "#3a372f", color: "#e2432a" }}
                title="削除"
              >
                ×
              </button>
            </div>
            {d.kind === "svg" ? (
              <div
                className="text-xs rounded py-1 text-center"
                style={{ background: "#12203a", color: "#5fd3d9", border: "1px solid #3a5a78" }}
              >
                SVG形状(読み込み済み)
              </div>
            ) : (
              <div className="flex gap-1">
                {PIECE_SHAPE_KINDS.map((k) => (
                  <button
                    key={k.key}
                    onClick={() => onUpdate(d.id, { kind: k.key })}
                    className="flex-1 text-xs rounded py-1"
                    style={{
                      background: d.kind === k.key ? "#e2432a" : "#3a372f",
                      color: d.kind === k.key ? "#1c1a17" : "#efe6d4",
                      fontWeight: d.kind === k.key ? 600 : 400,
                    }}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-3 gap-1">
              <label className="flex flex-col text-xs" style={{ color: "#a89f8f" }}>
                幅mm
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={d.w}
                  onChange={(e) => onUpdate(d.id, { w: Math.max(1, Number(e.target.value) || 1) })}
                  className="no-spinner rounded px-1 py-0.5 text-right"
                  style={{ background: "#12203a", color: "#efe6d4", border: "1px solid #3a5a78" }}
                />
              </label>
              <label className="flex flex-col text-xs" style={{ color: "#a89f8f" }}>
                奥行mm
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={d.d}
                  onChange={(e) => onUpdate(d.id, { d: Math.max(1, Number(e.target.value) || 1) })}
                  className="no-spinner rounded px-1 py-0.5 text-right"
                  style={{ background: "#12203a", color: "#efe6d4", border: "1px solid #3a5a78" }}
                />
              </label>
              <label className="flex flex-col text-xs" style={{ color: "#a89f8f" }}>
                高さmm
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={d.thickness}
                  onChange={(e) => onUpdate(d.id, { thickness: Math.max(1, Number(e.target.value) || 1) })}
                  className="no-spinner rounded px-1 py-0.5 text-right"
                  style={{ background: "#12203a", color: "#efe6d4", border: "1px solid #3a5a78" }}
                />
              </label>
            </div>
            {d.kind === "roundedSquare" && (
              <label className="flex items-center justify-between text-xs" style={{ color: "#a89f8f" }}>
                角の丸み
                <input
                  type="range"
                  min={0}
                  max={0.5}
                  step={0.01}
                  value={d.cornerFrac}
                  onChange={(e) => onUpdate(d.id, { cornerFrac: Number(e.target.value) })}
                  style={{ width: "60%" }}
                />
              </label>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
