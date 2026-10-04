import React from "react";
import ScrubField from "./ScrubField.jsx";
import ShapePreview, { shapeClipPath } from "./ShapePreview.jsx";
import ToggleSwitch from "./ToggleSwitch.jsx";
import Section from "./Section.jsx";
import SegmentedControl from "./SegmentedControl.jsx";
import { buttonStyle, helpText, sectionMeta } from "../lib/ui.js";
import { COMPONENT_SHAPE_KINDS } from "../lib/components.js";
import { DIE_STYLES } from "../lib/dice.js";
import { STAND_STYLES } from "../lib/standee.js";

// Inspector for the selected card/token/piece. Everything about it is edited here —
// shape and size included — since the object owns its own appearance; the library
// is only where it came from. Built from the same Section/SegmentedControl pieces as
// the box inspector so selecting a box vs. a card changes the sidebar's contents, not
// its shape. (The name / 置き換え / 登録 header above this is shared with boxes.)
export default function ComponentInstancePanel({
  instance: c,
  onUpdate,
  onUploadImage,
  onPasteImage,
  onClearImage,
  onOpenCropEditor,
  onAutoDetectShape,
  onSetSvgShape,
  onDieCut,
  onUploadBackImage,
  onPasteBackImage,
}) {
  const standee = !!c.standee;
  // turning any flat piece into a standee (or back): it stands up, on a slot foot by
  // default, and gets a board's thickness if it was as thin as a card
  const setStandee = (on) =>
    onUpdate(
      on
        ? { standee: true, orientation: "standing", stand: c.stand || "slot", thickness: c.thickness < 1 ? 2 : c.thickness }
        : { standee: false, orientation: "lying" }
    );
  const t = c.transform || {};
  const cropped = !!(t.cropTop || t.cropBottom || t.cropLeft || t.cropRight);
  return (
    <>
      {c.kind === "die" ? (
        <>
      {/* a die has its own few controls: body style, one size, pip and body colors.
          It has no image — the pips are its face. */}
      <Section first title="ダイス" meta="mm">
        <SegmentedControl
          value={c.dieStyle || "rounded"}
          onChange={(v) => onUpdate({ dieStyle: v })}
          options={DIE_STYLES.map((d) => ({ value: d.key, label: d.label }))}
        />
        <div className="flex flex-col gap-2 mt-2.5">
          <ScrubField
            label="サイズ"
            value={c.w}
            onChange={(v) => {
              const size = Math.max(2, v);
              onUpdate({ w: size, d: size, thickness: size });
            }}
            min={2}
            max={60}
            step={0.5}
            decimals={1}
            unit="mm"
          />
          {c.dieStyle !== "ballcut" && (
            <ScrubField
              label="角の丸み"
              value={c.cornerRadius}
              onChange={(v) => onUpdate({ cornerRadius: Math.max(0, v) })}
              min={0}
              max={Math.max(0.5, c.w / 2)}
              step={0.1}
              decimals={1}
              unit="mm"
            />
          )}
        </div>
        <div className="flex items-center gap-4 mt-3">
          <label className="flex items-center gap-2" style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
            本体
            <input type="color" value={c.color} onChange={(e) => onUpdate({ color: e.target.value })} style={{ width: "26px", height: "22px", padding: 0, border: "1px solid var(--border)", background: "none", cursor: "pointer" }} />
          </label>
          <label className="flex items-center gap-2" style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
            目
            <input type="color" value={c.pipColor || "#1c1a17"} onChange={(e) => onUpdate({ pipColor: e.target.value })} style={{ width: "26px", height: "22px", padding: 0, border: "1px solid var(--border)", background: "none", cursor: "pointer" }} />
          </label>
        </div>
      </Section>

        </>
      ) : (
        <>
      <Section first title="形状" meta="mm">
        <div className="flex gap-1.5 mb-2.5">
          {COMPONENT_SHAPE_KINDS.map((k) => {
            const active = c.kind === k.key;
            return (
              <button
                key={k.key}
                onClick={() => onUpdate({ kind: k.key })}
                title={k.label}
                aria-pressed={active}
                className="flex-1 rounded flex items-center justify-center"
                style={{ height: "32px", padding: "6px", background: "var(--bg-well)", border: active ? "2px solid var(--accent)" : "1px solid var(--border-well)" }}
              >
                <div className="w-full h-full" style={{ background: active ? "var(--accent)" : "var(--text-muted)", clipPath: shapeClipPath(k.key) }} />
              </button>
            );
          })}
          <label
            className="ui-btn flex-1 rounded flex items-center justify-center cursor-pointer"
            title="SVGの輪郭を形状として読み込む"
            style={{
              height: "32px",
              fontSize: "10px",
              fontWeight: 600,
              background: "var(--bg-well)",
              border: c.kind === "svg" ? "2px solid var(--accent)" : "1px solid var(--border-well)",
              color: c.kind === "svg" ? "var(--accent)" : "var(--text-muted)",
            }}
          >
            SVG
            <input
              type="file"
              accept=".svg,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                onSetSvgShape(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {/* die-cut: the outline of the image itself — needs an image with transparency */}
          <button
            onClick={onDieCut}
            disabled={!c.img}
            aria-pressed={c.kind === "alpha"}
            title={c.img ? "画像の輪郭(透過部分)で型抜き — トムソン加工" : "型抜きには透過PNGの画像が必要です"}
            className="flex-1 rounded flex items-center justify-center"
            style={{
              height: "32px",
              fontSize: "10px",
              fontWeight: 600,
              background: "var(--bg-well)",
              border: c.kind === "alpha" ? "2px solid var(--accent)" : "1px solid var(--border-well)",
              color: c.kind === "alpha" ? "var(--accent)" : "var(--text-muted)",
              opacity: c.img ? 1 : 0.4,
              cursor: c.img ? "pointer" : "default",
            }}
          >
            型抜き
          </button>
        </div>
        {c.kind === "alpha" && (
          <p className="mb-2.5" style={helpText}>
            画像の透過部分に沿って型抜きしています。画像やトリミングを変えると形も追従します。
          </p>
        )}
        <div className="flex flex-col gap-2">
          <ScrubField label={standee ? "幅" : "幅 W"} value={c.w} onChange={(v) => onUpdate({ w: Math.max(1, v) })} min={1} max={500} unit="mm" step={0.5} decimals={1} />
          <ScrubField label={standee ? "高さ" : "奥行 D"} value={c.d} onChange={(v) => onUpdate({ d: Math.max(1, v) })} min={1} max={500} unit="mm" step={0.5} decimals={1} />
          <ScrubField label="厚み" value={c.thickness} onChange={(v) => onUpdate({ thickness: Math.max(0.1, v) })} min={0.1} max={300} unit="mm" step={0.1} decimals={1} />
          {(c.kind === "roundedSquare" || c.kind === "roundTop") && (
            <ScrubField
              label="角の丸み"
              value={c.cornerRadius}
              onChange={(v) => onUpdate({ cornerRadius: Math.max(0, v) })}
              min={0}
              max={Math.max(1, Math.min(c.w, c.d) / 2)}
              unit="mm"
              step={0.5}
              decimals={1}
            />
          )}
        </div>
        {/* the board's edge, rounded where it meets a face — a punched cardboard chip */}
        <div className="flex flex-col gap-2 mt-2">
          <ScrubField
            label="フチの丸み"
            value={c.edgeRadius || 0}
            onChange={(v) => onUpdate({ edgeRadius: Math.max(0, v) })}
            min={0}
            max={Math.max(0.1, (c.edgeRound || "both") === "both" ? c.thickness / 2 : c.thickness)}
            unit="mm"
            step={0.05}
            decimals={2}
          />
          {(c.edgeRadius || 0) > 0 && (
            <SegmentedControl
              size="sm"
              value={c.edgeRound || "both"}
              onChange={(v) => onUpdate({ edgeRound: v })}
              options={
                standee
                  ? [
                      { value: "both", label: "両面" },
                      { value: "top", label: "表だけ" },
                      { value: "bottom", label: "裏だけ" },
                    ]
                  : [
                      { value: "both", label: "両面" },
                      { value: "top", label: "上側だけ" },
                      { value: "bottom", label: "下側だけ" },
                    ]
              }
            />
          )}
        </div>
        <div className="mt-3">
          <ToggleSwitch checked={standee} onChange={setStandee} label="立てて使う(スタンド駒)" />
        </div>
      </Section>

      <Section title="色・画像" hint="画像は上面に貼られます(面の形に合わせて自動でトリミング)。透過PNGなら、透明部分から形状と角の丸みを検出できます。">
        <div className="flex gap-2.5">
          <div className="rounded overflow-hidden flex-shrink-0" style={{ width: "64px", height: "64px", background: "var(--bg-well)", padding: "6px" }}>
            <ShapePreview component={c} />
          </div>
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={c.color}
                onChange={(e) => onUpdate({ color: e.target.value })}
                title="本体の色(側面・裏面、画像の透明部分)"
                style={{ width: "26px", height: "22px", padding: 0, border: "1px solid var(--border)", background: "none", cursor: "pointer", flexShrink: 0 }}
              />
              <span style={sectionMeta}>{c.color}</span>
              {c.fileName && (
                <span className="flex-1 truncate text-right" style={{ ...sectionMeta, direction: "rtl" }}>
                  {c.fileName}
                </span>
              )}
            </div>
            <div className="flex gap-1.5">
              <label className="ui-btn flex-1 block text-center cursor-pointer" style={c.img ? buttonStyle("quiet") : buttonStyle("primary")}>
                アップロード
                <input type="file" accept="image/*" onChange={onUploadImage} className="hidden" />
              </label>
              <button onClick={onPasteImage} className="flex-1" style={buttonStyle("quiet")}>
                貼り付け
              </button>
            </div>
            {c.img ? (
              <div className="flex gap-1.5">
                <button onClick={onOpenCropEditor} className="flex-1" style={buttonStyle("quiet", { active: cropped })}>
                  トリミング
                </button>
                <button onClick={onAutoDetectShape} className="flex-1" style={buttonStyle("quiet")} title="透明部分から形状と角の丸みを推定">
                  形状検出
                </button>
                <button onClick={onClearImage} title="画像を削除" style={{ ...buttonStyle("danger"), width: "28px", flexShrink: 0 }}>
                  ×
                </button>
              </div>
            ) : (
              <p style={helpText}>画像がないときは本体の色で表示されます。</p>
            )}
          </div>
        </div>
      </Section>

      {standee && (
        <>
          <Section title="スタンド" meta="mm" hint="差し込み: 同じ厚紙の半円を十字に差し込んだ足。台座: プラスチックの台座に差したもの。">
            <SegmentedControl value={c.stand || "slot"} onChange={(v) => onUpdate({ stand: v })} options={STAND_STYLES.map((st) => ({ value: st.key, label: st.label }))} />
            {(c.stand || "slot") !== "none" && (
              <div className="flex flex-col gap-2 mt-2.5">
                <ScrubField
                  label={(c.stand || "slot") === "slot" ? "足の半径(0で自動)" : "台座の長さ(0で自動)"}
                  value={c.standSize || 0}
                  onChange={(v) => onUpdate({ standSize: Math.max(0, v) })}
                  min={0}
                  max={150}
                  unit="mm"
                  step={0.5}
                  decimals={1}
                />
                {c.stand === "base" && (
                  <label className="flex items-center justify-between text-sm" style={{ color: "var(--text-secondary)" }}>
                    台座の色
                    <input
                      type="color"
                      value={c.standColor || "#2b2b2b"}
                      onChange={(e) => onUpdate({ standColor: e.target.value })}
                      style={{ width: "26px", height: "22px", padding: 0, border: "1px solid var(--border)", background: "none", cursor: "pointer" }}
                    />
                  </label>
                )}
              </div>
            )}
          </Section>

          <Section title="裏面" hint="裏面の絵柄です。設定しないときは表と同じ絵柄が裏にも印刷されます(型抜きの輪郭にも合います)。">
            <div className="flex gap-2.5">
              <div className="rounded overflow-hidden flex-shrink-0" style={{ width: "64px", height: "64px", background: "var(--bg-well)", padding: "6px" }}>
                <ShapePreview component={{ ...c, img: c.backImg || c.img, transform: c.backImg ? null : c.transform }} />
              </div>
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <div className="flex gap-1.5">
                  <label className="ui-btn flex-1 block text-center cursor-pointer" style={buttonStyle("quiet")}>
                    アップロード
                    <input type="file" accept="image/*" onChange={onUploadBackImage} className="hidden" />
                  </label>
                  <button onClick={onPasteBackImage} className="flex-1" style={buttonStyle("quiet")}>
                    貼り付け
                  </button>
                </div>
                {c.backImg ? (
                  <button onClick={() => onUpdate({ backImg: null })} style={buttonStyle("quiet")}>
                    表と同じにする
                  </button>
                ) : (
                  <p style={helpText}>今は表と同じ絵柄です。</p>
                )}
              </div>
            </div>
          </Section>
        </>
      )}

        </>
      )}

      <Section title="配置" collapsible summary={`${Math.round(c.x)}, ${Math.round(c.z)} / ${Math.round(c.rotY)}°`}>
        <div className="flex flex-col gap-2">
          <ScrubField label="位置 X" value={c.x} onChange={(v) => onUpdate({ x: v })} min={-2000} max={2000} unit="mm" />
          <ScrubField label="位置 Y" value={c.floatHeight} onChange={(v) => onUpdate({ floatHeight: v })} min={-200} max={500} unit="mm" />
          <ScrubField label="位置 Z" value={c.z} onChange={(v) => onUpdate({ z: v })} min={-2000} max={2000} unit="mm" />
          <ScrubField label="回転 Y" value={c.rotY} onChange={(v) => onUpdate({ rotY: v })} min={0} max={359} unit="°" />
        </div>
      </Section>

      <Section
        title="姿勢"
        collapsible
        defaultOpen={false}
        summary={[c.kind !== "die" && (c.orientation === "standing" ? "縦置き" : "平置き"), (c.tiltX !== 0 || c.tiltZ !== 0) && `傾き ${c.tiltX}°,${c.tiltZ}°`].filter(Boolean).join(" / ") || "傾きなし"}
      >
        {/* a cube has no standing/lying — only its tilt means anything */}
        {c.kind !== "die" && (
          <SegmentedControl
            value={c.orientation === "standing" ? "standing" : "lying"}
            onChange={(v) => onUpdate({ orientation: v })}
            options={[
              { value: "standing", label: "縦置き" },
              { value: "lying", label: "平置き" },
            ]}
          />
        )}
        <div className={`flex flex-col gap-2 ${c.kind !== "die" ? "mt-3" : ""}`}>
          <ScrubField label="傾き(前後)" value={c.tiltX} onChange={(v) => onUpdate({ tiltX: v })} min={-90} max={90} unit="°" />
          <ScrubField label="傾き(左右)" value={c.tiltZ} onChange={(v) => onUpdate({ tiltZ: v })} min={-90} max={90} unit="°" />
        </div>
        <div className="mt-3">
          <ToggleSwitch
            checked={c.autoSettle ?? (c.kind === "die" || !!c.standee)}
            onChange={(v) => onUpdate({ autoSettle: v })}
            label="傾けて離したら自然に倒れる・転がる"
          />
        </div>
        {c.poseQuat && (
          <button onClick={() => onUpdate({ poseQuat: null })} className="mt-2" style={buttonStyle("quiet")} title="置き直しで変わった向きを元に戻す">
            置き直した向きをリセット
          </button>
        )}
      </Section>

      <Section title="スタッキング" collapsible defaultOpen={false} summary={c.groundSnap !== false ? "接地する" : "固定"}>
        <ToggleSwitch checked={c.groundSnap !== false} onChange={(v) => onUpdate({ groundSnap: v })} label="接地する(下のレイヤーに自動で乗る)" />
      </Section>
    </>
  );
}
