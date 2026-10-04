import React, { useMemo, useState } from "react";
import ModalBackdrop from "./ModalBackdrop.jsx";
import { sectionTitle, sectionMeta, helpText, buttonStyle } from "../lib/ui.js";
import { imgW, imgH, hasTransparency } from "../lib/imaging.js";

// Shown when an image is pasted straight onto the app (Ctrl+V with nothing to paste it
// into): asks what it is, then places it. A box goes straight on to the 面の配置 editor
// with the picture as its net; a card or token asks whether to die-cut it to the
// picture's outline first.
//
// onChoose({ kind: "box", boxType, slotKey } | { kind: "card"|"token", dieCut })
const BOX_CHOICES = [
  { boxType: "lidded", slotKey: "lid", label: "身蓋箱・蓋", sub: "蓋の展開図" },
  { boxType: "lidded", slotKey: "body", label: "身蓋箱・身", sub: "身の展開図" },
  { boxType: "caramel", slotKey: "caramel", label: "キャラメル箱", sub: "展開図" },
  { boxType: "sleeve", slotKey: "sleeve", label: "スリーブ箱", sub: "スリーブの展開図" },
];

function Choice({ label, sub, onClick, disabled, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex flex-col items-start gap-0.5 rounded text-left"
      style={{
        ...buttonStyle("quiet"),
        padding: "10px 12px",
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>{label}</span>
      {sub && <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{sub}</span>}
    </button>
  );
}

export default function PasteImageDialog({ img, sizeMm, onChoose, onCancel }) {
  const [step, setStep] = useState("what"); // "what" | "box" | "card" | "token"
  const [src] = useState(() => img.src || img.toDataURL?.());
  const transparent = useMemo(() => hasTransparency(img), [img]);

  const back = (
    <button type="button" onClick={() => setStep("what")} style={buttonStyle("quiet")}>
      ← 戻る
    </button>
  );

  return (
    <ModalBackdrop onDismiss={onCancel}>
      <div className="rounded-lg p-4" style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border)", width: "380px", maxWidth: "calc(100vw - 32px)" }}>
        <div className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
          貼り付けた画像を配置
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div
            className="rounded flex items-center justify-center flex-shrink-0"
            style={{ width: "96px", height: "96px", background: "repeating-conic-gradient(#2a2a2a 0% 25%, #222 0% 50%) 0 0 / 12px 12px", border: "1px solid var(--border)" }}
          >
            <img src={src} alt="貼り付けた画像" style={{ maxWidth: "88px", maxHeight: "88px", objectFit: "contain" }} />
          </div>
          <div className="flex flex-col gap-0.5" style={sectionMeta}>
            {sizeMm ? (
              <span>
                実寸 {Math.round(sizeMm[0] * 10) / 10} × {Math.round(sizeMm[1] * 10) / 10} mm
              </span>
            ) : null}
            <span>
              {imgW(img)} × {imgH(img)} px
            </span>
            <span>{transparent ? "透過あり" : "透過なし"}</span>
          </div>
        </div>

        {step === "what" && (
          <>
            <div className="mb-2" style={sectionTitle}>
              何として配置しますか?
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <Choice label="箱" sub="展開図として" onClick={() => setStep("box")} />
              <Choice label="カード" sub="表面の絵柄" onClick={() => setStep("card")} />
              <Choice label="駒" sub="チット・タイル" onClick={() => setStep("token")} />
            </div>
          </>
        )}

        {step === "box" && (
          <>
            <div className="mb-2" style={sectionTitle}>
              どの箱の展開図ですか?
            </div>
            <div className="grid grid-cols-2 gap-1.5 mb-2">
              {BOX_CHOICES.map((c) => (
                <Choice key={`${c.boxType}:${c.slotKey}`} label={c.label} sub={c.sub} onClick={() => onChoose({ kind: "box", boxType: c.boxType, slotKey: c.slotKey })} />
              ))}
            </div>
            <p className="mb-3" style={helpText}>
              選ぶと面の配置画面が開きます。そこで各面の位置や箱のサイズを合わせてください。
            </p>
            {back}
          </>
        )}

        {(step === "card" || step === "token") && (
          <>
            <div className="mb-2" style={sectionTitle}>
              型抜き(ダイカット)にしますか?
            </div>
            <div className="grid grid-cols-2 gap-1.5 mb-2">
              <Choice
                label="型抜きする"
                sub="透過部分の輪郭で切り抜く"
                disabled={!transparent}
                title={transparent ? undefined : "透過部分がない画像は型抜きできません"}
                onClick={() => onChoose({ kind: step, dieCut: true })}
              />
              <Choice
                label="型抜きしない"
                sub={step === "card" ? "角丸の長方形" : "形は画像から推定"}
                onClick={() => onChoose({ kind: step, dieCut: false })}
              />
            </div>
            <p className="mb-3" style={helpText}>
              {transparent ? "" : "この画像には透過部分がないため、型抜きはできません。"}
              {sizeMm ? "サイズは画像の実寸になります。" : "サイズは画像の縦横比に合わせます(あとから変更できます)。"}
            </p>
            {back}
          </>
        )}

        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} className="flex-1 text-sm rounded py-2" style={{ background: "var(--border)", color: "var(--text-primary)" }}>
            キャンセル
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
