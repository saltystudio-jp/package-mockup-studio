# TODO

## 進行中 / 未完了

- [ ] **GitHubへ公開** — `gh` が未インストール。ユーザー側で `winget install --id GitHub.cli` → `gh auth login` 後に `gh repo create package-mockup-studio --private --source=. --remote=origin --push`。

## 不具合

- [ ] **Illustratorからコピーした図形を「貼り付け」すると画像として認識されず壊れる**(2026-09-30 報告)
  - 再現: Illustrator(Windows)で図形をコピー → 箱の展開図/カード面の「貼り付け」
  - 仮説: Illustratorはクリップボードに複数形式(EMF/WMF・DIB・PDF/AIネイティブ等)を載せる。PowerPointはその中からビットマップ/EMFを選んで貼れている。アプリ側は `navigator.clipboard.read()` で最初の `image/*` だけを見ているため、期待外の形式を掴んでいる可能性
  - 調査・対応メモ: [docs/clipboard-illustrator.md](docs/clipboard-illustrator.md)
  - [x] 貼り付け処理を修正(全形式を順に試す・SVGをラスタライズ・デコード検証・形式をログ出力)— 想定形式での単体テストは合格
  - [ ] **実機のIllustratorで確認**(この環境ではクリップボードとGUI操作が使えず未実施。手順はメモ参照)
