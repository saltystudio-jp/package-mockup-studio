import React, { useState } from "react";
import ScrubField from "./ScrubField.jsx";
import ShapePreview from "./ShapePreview.jsx";

// contextual inspector for the currently-selected component instance — rendered only
// when a component is the active selection (see PackageBoxMockup.jsx). Replaces the
// old separate CardPanel/PiecePanel: since a component now bundles shape+size+color+
// image, picking "which component" is a single big-thumbnail-click-to-open-a-grid
// control (matching the reference layout) instead of two separate pickers (shape, then
// symbol). Registering a brand new component still happens in the library (asset
// drawer) — this panel only assigns an EXISTING one plus this instance's placement.
export default function ComponentInstancePanel({ components, componentInstances, selectedInstanceId, onUpdate, onOpenComponentLibrary }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const selected = componentInstances.find((c) => c.id === selectedInstanceId) || componentInstances[0] || null;
  const selectedIndex = selected ? componentInstances.findIndex((c) => c.id === selected.id) : -1;
  const patch = (p) => selected && onUpdate(selected.id, p);

  if (!selected) return null;
  const current = components.find((c) => c.id === selected.componentId) || null;

  return (
    <div className="mb-4 rounded-lg p-3" style={{ background: "#242220", border: "1px solid #3a372f" }}>
      <div className="text-xs uppercase mb-2" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
        配置(コンポーネント{selectedIndex + 1})
      </div>

      <div className="text-xs uppercase mb-1" style={{ color: "#a89f8f", letterSpacing: "0.08em" }}>
        絵柄(コンポーネント)
      </div>
      <div className="relative mb-3" style={{ width: "96px" }} onMouseLeave={() => {}}>
        <button
          onClick={() => setPickerOpen((v) => !v)}
          className="w-full rounded overflow-hidden"
          style={{ aspectRatio: "1 / 1", background: "#12203a", border: "1px solid #3a5a78" }}
          title="クリックでコンポーネントを変更"
        >
          <ShapePreview component={current} />
        </button>
        <button
          onClick={() => setPickerOpen(true)}
          className="absolute bottom-1 right-1 text-xs rounded px-1.5 py-0.5"
          style={{ background: "#efe6d4", color: "#1c1a17", fontWeight: 600 }}
        >
          変更
        </button>

        {pickerOpen && (
          <div
            className="absolute z-20 top-full mt-1 left-0 rounded p-2 flex flex-col gap-2"
            style={{ background: "#1c1a17", border: "1px solid #3a372f", width: "220px" }}
          >
            {components.length === 0 ? (
              <p className="text-xs" style={{ color: "#7d7568" }}>
                まだコンポーネントがありません。
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-1">
                {components.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      patch({ componentId: c.id });
                      setPickerOpen(false);
                    }}
                    title={c.name}
                    className="rounded overflow-hidden"
                    style={{
                      width: "44px",
                      height: "44px",
                      border: selected.componentId === c.id ? "2px solid #e2432a" : "1px solid #3a372f",
                    }}
                  >
                    <ShapePreview component={c} />
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => {
                setPickerOpen(false);
                onOpenComponentLibrary?.();
              }}
              className="text-xs rounded py-1.5"
              style={{ background: "#3a372f", color: "#5fd3d9" }}
            >
              ライブラリを開く(新規登録・編集)
            </button>
            <button onClick={() => setPickerOpen(false)} className="text-xs rounded py-1" style={{ background: "#1c1a17", color: "#7d7568" }}>
              閉じる
            </button>
          </div>
        )}
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
  );
}
