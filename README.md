# HACK-U

HACK-U2026 で作成したメタバースアプリのリポジトリです。  
`node-login-app`（認証・ルーム管理）と `hack-u`（2Dメタバース）で構成されています。

## リポジトリ構成

- `node-login-app`:
  - 新規登録 / ログイン / セッション管理（Express + PostgreSQL）
  - ルーム作成・参加・一覧表示
- `hack-u`:
  - 2Dメタバース画面（Next.js + Phaser）
  - Socket同期（同ルーム内のプレイヤー表示、チャット）
- `hack-u/socket-server.js`:
  - `mode + keyword` を room key としてルーム管理

## 実装済み機能

### 認証・登録

- 新規登録項目:
  - 名前、ニックネーム、生年月日、年齢（自動計算）、職業、都道府県、自己紹介、好きなモノタグ、パスワード
- 都道府県は47都道府県プルダウン
- パスワードは `bcrypt` でハッシュ化して保存

### アバター

- 新規登録完了後に `avatar-select.html` で5種類から選択
- 選択したアバターを `users.avatar_key` に保存し、以降の仮想空間表示に反映
- 使用ファイル:
  - `hack-u/public/item/avatars/avatar-01.png`
  - `hack-u/public/item/avatars/avatar-02.png`
  - `hack-u/public/item/avatars/avatar-03.png`
  - `hack-u/public/item/avatars/avatar-04.png`
  - `hack-u/public/item/avatars/avatar-05.png`

### ルーム導線

- `main.html`:
  - 「話す」 -> `selecttalk.html`
  - 「会う」 -> `room.html?mode=meet&keyword=meet-lobby`
- `selecttalk.html`:
  - 「チャット」 -> `chat.html`
  - 「電話」 -> `call.html`
- `chat.html` / `call.html`:
  - キーワード検索、ルーム一覧、オンラインのみ表示、作成日時順/人気順
- `room.html`:
  - 参加者表示、オンライン人数・総参加人数表示
  - メタバース画面へ遷移（`mode`, `keyword`, `nickname`, `avatarKey` を引き継ぎ）

### 背景切り替え

- `chat` -> `background-chat.png`
- `call` -> `background-call.png`
- `meet` は時刻帯で切り替え:
  - 昼（5:00-16:59） -> `background-meet-day.png`
  - 夕方（17:00-18:59） -> `background-meet-evening.png`
  - 夜（その他） -> `background-meet-night.png`

### 2D同期・チャット

- 同一 `mode + keyword` のユーザーのみ同じ空間で同期
- プレイヤー座標同期
- 同ルーム人数バッジ:
  - オンライン人数
  - 総参加人数（サーバー起動中の累計）
- 入退室トースト
- 近接チャット（一定距離内のメッセージのみ表示）
- チャット送信時刻表示、自分発言の右寄せ・色分け
- 「ルームから抜ける」ボタンあり

## 起動手順

### 1) `node-login-app`（3000）

```powershell
cd "C:\Users\yukin\Desktop\ハッカソン\HACK-U\node-login-app"
npm start
```

#### ローカルDBで詰まったとき（一時的にDocker DBを使う）

```powershell
cd "C:\Users\yukin\Desktop\ハッカソン\HACK-U\node-login-app"
docker compose up -d db
npm run start:dockerdb
```

- `start:dockerdb` は `.env` を変更せず、`hacku_db`（`localhost:5433`）へ一時接続
- テーブル確認だけしたい場合は `npm run db:inspect:docker`
- 停止は `docker compose down`

### 2) Socketサーバー（3001）

```powershell
cd "C:\Users\yukin\Desktop\ハッカソン\HACK-U\hack-u"
npm run socket
```

### 3) メタバース画面（3002）

```powershell
cd "C:\Users\yukin\Desktop\ハッカソン\HACK-U\hack-u"
npm run dev:web
```

## 注意点

- 変更反映時は `socket` の再起動が必要
- `EADDRINUSE` が出たら既存プロセスを停止して再起動
- アバター画像はスプライトシート形式（48x48フレーム前提）で使用

## 今後の候補

- 会うモードのBGM切り替え
- ルーム説明・タグ・検索改善
- チャットの通報/ミュート/NGワード
- Socket認証強化（セッション連携）
