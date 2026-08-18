import React from "react";
import { symbolThumbSrc } from "../lib/symbols.js";

const fieldBox = { background: "#242220", border: "1px solid #3a372f", color: "#efe6d4", fontFamily: "'JetBrains Mono', monospace", fontSize: "13px" };

function NumField({ label, value, onChange, min = 0, max = 500, unit }) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span style={{ color: "#a89f8f" }}>{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
          className="no-spinner w-16 rounded px-2 py-1 text-right"
          style={fieldBox}
        />
        {unit && <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#efe6d4", fontSize: "12px" }}>{unit}</span>}
      </div>
    </label>
  );
}

function SliderField({ label, value, onChange, min = -45, max = 45, unit = "°" }) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between text-sm mb-1">
        <span style={{ color: "#a89f8f" }}>{label}</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#efe6d4" }}>
          {value}
          {unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </div>
  );
}

// mirrors the box "配置" sidebar section, but simpler: no reference-instance link
// system (each card is independent) since decks are usually mixed-orientation anyway.
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
  setSelectedCardId,
  onAdd,
  onDuplicate,
  onRemove,
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
          <NumField label="幅 W" value={cardW} onChange={setCardW} min={5} max={500} />
          <NumField label="奥行 D" value={cardD} onChange={setCardD} min={5} max={500} />
          <NumField label="厚み" value={cardThickness} onChange={setCardThickness} min={0.1} max={30} />
          <NumField label="角の丸み" value={cardCornerRadius} onChange={setCardCornerRadius} min={0} max={30} />
        </div>
      </div>

      <div className="mb-4 rounded-lg p-3" style={{ background: "#242220", border: "1px solid #3a372f" }}>
        <div className="text-xs uppercase mb-2" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
          配置(カードの数)
        </div>
        <div className="flex flex-wrap gap-1 mb-3">
          {cardInstances.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setSelectedCardId(c.id)}
              className="flex items-center gap-1 text-xs rounded pl-2 pr-1 py-1"
              style={{
                background: c.id === selectedCardId ? "#e2432a" : "#3a372f",
                color: c.id === selectedCardId ? "#1c1a17" : "#efe6d4",
                fontWeight: c.id === selectedCardId ? 600 : 400,
              }}
            >
              カード{i + 1}
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(c.id);
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
            まだカードがありません。「＋追加」で配置できます。
          </p>
        ) : (
          <>
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

            <div className="grid grid-cols-2 gap-2 mb-2">
              <NumField label="位置 X" value={selected.x} onChange={(v) => patch({ x: v })} min={-2000} max={2000} unit="mm" />
              <NumField label="位置 Z" value={selected.z} onChange={(v) => patch({ z: v })} min={-2000} max={2000} unit="mm" />
            </div>
            <SliderField label="回転(Y軸)" value={selected.rotY} onChange={(v) => patch({ rotY: v })} min={0} max={359} unit="°" />

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

            <SliderField label="傾き(前後)" value={selected.tiltX} onChange={(v) => patch({ tiltX: v })} />
            <SliderField label="傾き(左右)" value={selected.tiltZ} onChange={(v) => patch({ tiltZ: v })} />
            <NumField label="地面からの高さ" value={selected.floatHeight} onChange={(v) => patch({ floatHeight: v })} min={-200} max={500} unit="mm" />

            <div className="mt-3 pt-3" style={{ borderTop: "1px solid #3a372f" }}>
              <label className="flex items-center gap-2 mb-2 text-xs" style={{ color: "#a89f8f" }}>
                <input
                  type="checkbox"
                  checked={selected.groundSnap !== false}
                  onChange={(e) => patch({ groundSnap: e.target.checked })}
                />
                接地する(地面、または下のレイヤーのオブジェクトに自動で乗る)
              </label>
              <NumField label="レイヤー" value={selected.layer ?? 0} onChange={(v) => patch({ layer: Math.round(v) })} min={0} max={20} />
            </div>

            <p className="text-xs mt-2" style={{ color: "#7d7568" }}>
              選択中: カード{selectedIndex + 1}
            </p>
          </>
        )}
      </div>
    </>
  );
}
