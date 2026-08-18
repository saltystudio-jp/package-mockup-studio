# Package Mockup Studio (ローカル実行用)

化粧箱(身+蓋)の3Dモックアップを、1枚の展開図画像から作成するツールです。

## セットアップ

1. Node.js が入っていない場合は https://nodejs.org からLTS版をインストール(v18以上推奨)
2. このフォルダを VS Code で開く
3. VS Code のターミナル(Terminal → New Terminal)で以下を実行

```bash
npm install
npm run dev
```

4. 自動でブラウザが開きます(開かない場合は表示された `http://localhost:5173` にアクセス)

## 終了する場合

ターミナルで `Ctrl + C`

## ファイル構成

- `src/PackageBoxMockup.jsx` — 本体のコンポーネント。ロジックやUIを直接編集できます
- `src/main.jsx` — 起動用エントリーポイント
- `index.html` — Tailwind CSS はCDN経由で読み込んでいます(オフライン環境では見た目が崩れるので注意)

## 今後Claude Codeで機能追加したい場合

このフォルダをそのまま Claude Code で開いて「〇〇の機能を追加して」と頼めば、続きから拡張できます。
