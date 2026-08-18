import React from "react";
import { symbolThumbSrc } from "../lib/symbols.js";
import ScrubField from "./ScrubField.jsx";

// contextual inspector for the currently-selected card — rendered only when a card is
// the active selection (see PackageBoxMockup.jsx). Adding/duplicating/removing/
// selecting cards now happens in the unified Outliner; this only edits the shared card
// design (all cards) and the selected card's own placement/symbol.
export default function CardPanel({
  cardW,
  setCardW,
  cardD,
  setCardD,
  cardThickness,
  setCardThickness,
  cardCornerRadius,
  setCardCornerRadius,
  symbols,
  cardInstances,
  selectedCardId,
  onUpdate,
}) {
  const selected = cardInstances.find((c) => c.id === selectedCardId) || cardInstances[0] || null;
  const selectedIndex = selected ? cardInstances.findIndex((c) => c.id === selected.id) : -1;
  const patch = (p) => selected && onUpdate(selected.id, p);

  return (
    <>
      <div className="mb-4 rounded-lg p-3" style={{ background: "#242220", border: "1px solid #3a372f" }}>
        <div className="text-xs uppercase mb-2" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
          カードのサイズ mm(共通)
        </div>
        <div className="flex flex-col gap-2">
          <ScrubField label="幅 W" value={cardW} onChange={setCardW} min={5} max={500} unit="mm" />
          <ScrubField label="奥行 D" value={cardD} onChange={setCardD} min={5} max={500} unit="mm" />
          <ScrubField label="厚み" value={cardThickness} onChange={setCardThickness} min={0.1} max={30} step={0.1} unit="mm" />
          <ScrubField label="角の丸み" value={cardCornerRadius} onChange={setCardCornerRadius} min={0} max={30} unit="mm" />
        </div>
      </div>

      {selected && (
        <div className="mb-4 rounded-lg p-3" style={{ background: "#242220", border: "1px solid #3a372f" }}>
          <div className="text-xs uppercase mb-2" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
            配置(カード{selectedIndex + 1})
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
          </div>

          <div className="flex gap-2 mb-3">
            <button
              onClick={() => patch({ orientation: "standing" })}
              className="flex-1 text-xs rounded py-2"
              style={{
                background: selected.orientation === "standing" ? "#e2432a" : "#3a372f",
                color: selected.orientation === "standing" ? "#1c1a17" : "#efe6d4",
                fontWeight: selected.orientation === "standing" ? 600 : 400,
              }}
            >
              縦置き
            </button>
            <button
              onClick={() => patch({ orientation: "lying" })}
              className="flex-1 text-xs rounded py-2"
              style={{
                background: selected.orientation === "lying" ? "#e2432a" : "#3a372f",
                color: selected.orientation === "lying" ? "#1c1a17" : "#efe6d4",
                fontWeight: selected.orientation === "lying" ? 600 : 400,
              }}
            >
              平置き
            </button>
          </div>

          <div className="flex flex-col gap-2">
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
        </div>
      )}
    </>
  );
}
