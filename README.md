# 搬入管理アプリ

スマホで搬入予定を入力すると、Notion の「搬入管理」DB に登録されるアプリです。

## 構成

- `public/`：画面（スマホで開くページ）
  - `app.js`：画面の切り替え（`#/` 一覧、`#/new` 新規登録、`#/edit/{id}` 変更）
  - `list.js` / `entry.js` / `edit.js`：一覧・登録・変更の各画面
  - `sender.js` / `outbox.js`：送信待ちの保存と自動再送
  - `sw.js` / `manifest.webmanifest`：ホーム画面に追加して、電波がなくても開けるようにする設定（画面を更新したら `sw.js` の `VERSION` を上げる）
- `src/worker.js`：中継役。画面からの依頼を受けて Notion とやり取りする
- `src/notion.js`：Notion との変換・通信
- `src/duplicates.js`：重複チェック（同じ現場・同じ搬入口・前後15分、「中止」は除外）
- `test/`：自動テスト（`npm test`）。本物の Notion には接続しない

## 中継役の窓口（API）

| 操作 | 方法 | 内容 |
| --- | --- | --- |
| 選択肢の取得 | `GET /api/options` | 現場名・搬入口・ステータス・立会担当の候補 |
| 一覧 | `GET /api/deliveries?from=…&to=…` | 期間内の搬入（最大31日） |
| 新規登録 | `POST /api/deliveries` | 近い時間の搬入があれば 409 で知らせる。`force: true` でそのまま登録 |
| 変更 | `PATCH /api/deliveries/{id}` | 時間・ステータスなど |

削除の窓口はありません。取りやめはステータス「中止」にします。

## 大事な約束

- Notion の秘密キー（トークン）はこのフォルダに書かない。Cloudflare の Secret（`NOTION_TOKEN`）に登録する
- 開発中はテスト用DB「搬入管理（テスト）」に接続する。本番DBへの切り替えは承認を得てから
