# Illustratorからの貼り付けが壊れる件 — 調査・対応メモ

報告: 2026-09-30 / 対象: 箱の展開図・カード面の「貼り付け」ボタン

## 貼り付けの仕組み(変更前)

`src/lib/imaging.js` の `readClipboardImage()` が `navigator.clipboard.read()` を呼び、
**最初に見つかった `image/*` のBlobをそのまま** `<img>` に読み込んで使っていた。

- デコードできるか、サイズが0でないかを確認していなかった
- `text/html` / `text/plain` に載っているSVGコードなど、画像以外の形式は一切見ていなかった
- どの形式が届いたかのログもなかった

(アプリの Ctrl+V はオブジェクト複製に割り当てられているので、画像の貼り付けは「貼り付け」ボタン経由のみ)

## ブラウザが受け取れる形式

Windowsのクリップボードには、Illustratorが複数の形式を載せる(EMF/WMF、PDF、AICB、設定によってはSVGコードやビットマップ)。
ブラウザ(Chrome)の非同期クリップボードAPIに見えるのはその一部だけ:

| Windows側 | ブラウザに見える形 |
|---|---|
| CF_DIB / CF_BITMAP / 登録形式 "PNG" | `image/png`(Chromeが変換) |
| "image/svg+xml" 登録形式 | `image/svg+xml` |
| "HTML Format" | `text/html` |
| CF_UNICODETEXT | `text/plain`(Illustratorの「SVGコードを含める」はここにSVGマークアップを入れる) |
| EMF/WMF・PDF・AICB | **見えない**(ブラウザは読めない) |

PowerPointが貼れるのは、ネイティブアプリとしてEMFやDIBを直接読めるから。ブラウザではEMF/PDFは読めないので、
**ビットマップかSVGコードが載っていること**が前提になる。

## 試したこと

1. **実機でIllustratorからコピー → 形式を列挙**: COM(`Illustrator.Application`)で図形を作って `Copy()` したが、
   Windowsのクリップボードには載らなかった。Illustratorはアプリが**非アクティブになった時点で**システムの
   クリップボードへ書き出すため、裏で操作しただけでは書き出されない。さらにこの作業環境のシェルは対話デスクトップの
   外で動いていて、クリップボード自体を開けなかった(`OpenClipboard` が常に失敗、保持プロセスはなし)。
   GUI操作(computer use)はこの実行中には承認できなかったため、**実機での形式確認は未実施**。
2. **想定される形式ごとの単体テスト**(ブラウザ上で `imageFromClipboardItems` に擬似データを渡して確認):

| 入力 | 結果 |
|---|---|
| `image/png` のみ | OK(そのまま使用) |
| `image/svg+xml`(viewBoxのみ・CSSクラス・日本語ID — Illustratorが書き出す形) | OK、2048pxにラスタライズ |
| `text/plain` にSVGコード | OK |
| `text/html` にインラインSVG | OK |
| **壊れた `image/png` + SVGコードのテキスト** | OK — 旧コードはここで壊れた画像を使っていた。新コードはPNGのデコード失敗を検出してSVGに切り替え |
| テキストのみ / 空 | 分かりやすいエラー(受け取った形式を表示し、Illustratorの設定を案内) |

ラスタライズ結果の画素も確認済み(図形の色が正確に出て、背景は透明のまま → 型抜きにもそのまま使える)。

## 対応(`src/lib/imaging.js`)

- `imageFromClipboardItems()`: 届いたすべての形式を「ビットマップ → SVG → HTML → プレーンテキスト」の順に試し、
  **実際にサイズのある画像にデコードできたもの**だけを採用
- SVG(Blob・HTML内・テキスト内のどれでも)はcanvasで長辺2048px以上にラスタライズ。
  Illustrator形式に多い「viewBoxだけで幅・高さがない」「単位がpt/mm」も解決してから描画
- 結果は常にPNGのdata URLを持つ通常の画像に正規化(サムネイル・トリミング・テクスチャ側は出どころを気にしなくてよい)
- コンソールに `[paste] clipboard types: …` と、採用した形式/却下理由を出力
- 読めなかった場合は受け取った形式を明示し、Illustratorの「SVGコードを含める」を案内

## 残っている確認(実機)

Illustratorで実際に何が届いているかは未確認。次のどちらかで確定させる:

- **手動で30秒**: Illustratorで図形をコピー → アプリの「貼り付け」を押す → ブラウザのDevTools(F12)の
  コンソールに出る `[paste] clipboard types:` の行を見る
- **こちらで**: 会話からcomputer useのアクセスを承認してもらえれば、Illustratorでのコピー → 貼り付けまで実機で確認する

届いた形式が `(none)` や `text/plain`(SVGなし)だけの場合は、Illustratorの 環境設定 → ファイル管理・クリップボード
(クリップボード処理)で「SVGコードを含める」をオンにする必要がある。それでも駄目なら、Illustrator側の
コピー形式の設定と合わせて再調査する。
