import React from "react";
import { symbolThumbSrc } from "../lib/symbols.js";
import { PIECE_SHAPE_KINDS } from "../lib/shapes2d.js";
import ScrubField from "./ScrubField.jsx";

export default function PiecePanel({ shapeDefs, symbols, pieceInstances, selectedPieceId, onSelectPiece, onAdd, onDuplicate, onRemove, onUpdate }) {
  const selected = pieceInstances.find((p) => p.id === selectedPieceId) || pieceInstances[0] || null;
  const selectedIndex = selected ? pieceInstances.findIndex((p) => p.id === selected.id) : -1;
  const patch = (p) => selected && onUpdate(selected.id, p);

  return (
    <div className="mb-4 rounded-lg p-3" style={{ background: "#242220", border: "1px solid #3a372f" }}>
      <div className="text-xs uppercase mb-2" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
        配置(駒の数)
      </div>
      <div className="flex flex-wrap gap-1 mb-3">
        {pieceInstances.map((p, i) => (
          <button
            key={p.id}
            onClick={() => onSelectPiece(p.id)}
            className="flex items-center gap-1 text-xs rounded pl-2 pr-1 py-1"
            style={{
              background: p.id === selectedPieceId ? "#e2432a" : "#3a372f",
              color: p.id === selectedPieceId ? "#1c1a17" : "#efe6d4",
              fontWeight: p.id === selectedPieceId ? 600 : 400,
            }}
          >
            駒{i + 1}
            <span
              onClick={(e) => {
                e.stopPropagation();
                onRemove(p.id);
              }}
              className="rounded-full flex items-center justify-center"
              style={{ width: "14px", height: "14px", background: "rgba(0,0,0,0.25)", fontSize: "10px", lineHeight: 1 }}
            >
              ×
            </span>
          </button>
        ))}
        <button onClick={onAdd} className="text-xs rounded px-2 py-1" style={{ background: "#3a372f", color: "#5fd3d9" }}>
          ＋追加
        </button>
        {selected && (
          <button onClick={() => onDuplicate(selected.id)} className="text-xs rounded px-2 py-1" style={{ background: "#3a372f", color: "#5fd3d9" }}>
            複製
          </button>
        )}
      </div>

      {!selected ? (
        <p className="text-xs" style={{ color: "#7d7568" }}>
          まだ駒がありません。「＋追加」で配置できます(形状ライブラリが空の場合は自動で1つ作成されます)。
        </p>
      ) : (
        <>
          <div className="text-xs uppercase mb-1 mt-1" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
            形状
          </div>
          <div className="flex flex-wrap gap-1 mb-3">
            {shapeDefs.map((d) => {
              const kindLabel = PIECE_SHAPE_KINDS.find((k) => k.key === d.kind)?.label || d.kind;
              return (
                <button
                  key={d.id}
                  onClick={() => patch({ shapeDefId: d.id })}
                  title={`${d.name} (${kindLabel} ${d.w}×${d.d}×${d.thickness}mm)`}
                  className="text-xs rounded px-2 py-1"
                  style={{
                    background: selected.shapeDefId === d.id ? "#e2432a" : "#3a372f",
                    color: selected.shapeDefId === d.id ? "#1c1a17" : "#efe6d4",
                    fontWeight: selected.shapeDefId === d.id ? 600 : 400,
                  }}
                >
                  {d.name}
                </button>
              );
            })}
          </div>

          <div className="text-xs uppercase mb-1 mt-1" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
            絵柄(シンボル)
          </div>
          <div className="flex flex-wrap gap-1 mb-3">
            <button
              onClick={() => patch({ symbolId: null })}
              className="text-xs rounded px-2 py-1"
              style={{
                background: !selected.symbolId ? "#e2432a" : "#3a372f",
                color: !selected.symbolId ? "#1c1a17" : "#efe6d4",
              }}
            >
              なし
            </button>
            {symbols.map((s) => {
              const thumb = symbolThumbSrc(s);
              return (
                <button
                  key={s.id}
                  onClick={() => patch({ symbolId: s.id })}
                  title={s.name}
                  className="rounded overflow-hidden flex items-center justify-center"
                  style={{
                    width: "32px",
                    height: "32px",
                    background: s.color,
                    border: selected.symbolId === s.id ? "2px solid #5fd3d9" : "1px solid #3a372f",
                    flexShrink: 0,
                  }}
                >
                  {thumb && <img src={thumb} alt={s.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 mb-2">
            <ScrubField label="位置 X" value={selected.x} onChange={(v) => patch({ x: v })} min={-2000} max={2000} unit="mm" />
            <ScrubField label="位置 Z" value={selected.z} onChange={(v) => patch({ z: v })} min={-2000} max={2000} unit="mm" />
            <ScrubField label="回転(Y軸)" value={selected.rotY} onChange={(v) => patch({ rotY: v })} min={0} max={359} unit="°" />
            <ScrubField label="傾き(前後)" value={selected.tiltX} onChange={(v) => patch({ tiltX: v })} min={-45} max={45} unit="°" />
            <ScrubField label="傾き(左右)" value={selected.tiltZ} onChange={(v) => patch({ tiltZ: v })} min={-45} max={45} unit="°" />
            <ScrubField label="地面からの高さ" value={selected.floatHeight} onChange={(v) => patch({ floatHeight: v })} min={-200} max={500} unit="mm" />
          </div>

          <div className="mt-3 pt-3" style={{ borderTop: "1px solid #3a372f" }}>
            <label className="flex items-center gap-2 mb-2 text-xs" style={{ color: "#a89f8f" }}>
              <input
                type="checkbox"
                checked={selected.groundSnap !== false}
                onChange={(e) => patch({ groundSnap: e.target.checked })}
              />
              接地する(地面、または下のレイヤーのオブジェクトに自動で乗る)
            </label>
            <ScrubField label="レイヤー" value={selected.layer ?? 0} onChange={(v) => patch({ layer: Math.round(v) })} min={0} max={20} />
          </div>

          <p className="text-xs mt-2" style={{ color: "#7d7568" }}>
            選択中: 駒{selectedIndex + 1}
          </p>
        </>
      )}
    </div>
  );
}
