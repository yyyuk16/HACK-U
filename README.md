# HACK-U

HACK-U2026 で作成したメタバースアプリのリポジトリです。  
`node-login-app`（認証・ルーム管理）と `hack-u`（2Dメタバース）で構成されています。

## リポジトリ構成

- `node-login-app`:
  - 新規登録 / ログイン / セッション管理（Express + PostgreSQL）
  - ルーム作成・参加・一覧表示
- `hack-u`:
  - 2Dメタバース画面（Next.js + Phaser）
  - Socket同期（同ルーム内のプレイヤー表示、チャット、個別会話、通話）
- `hack-u/socket-server.js`:
  - `mode + keyword` を room key としてルーム管理

## 実装済み機能

### 認証・登録

- 新規登録項目:
  - 名前、ニックネーム、生年月日、年齢（自動計算）、職業、都道府県、自己紹介、好きなモノタグ、パスワード
- 都道府県は47都道府県プルダウン
- パスワードは `bcrypt` でハッシュ化して保存

### アバター

- 新規登録完了後に `avatar-select.html` で10種類から選択
- 選択したアバターを `users.avatar_key` に保存し、以降の仮想空間表示に反映
- アバター素材は以下2箇所で管理:
  - `node-login-app/public/avatars/avatar-01.png`〜`avatar-10.png`（選択画面用）
  - `hack-u/public/item/avatars/avatar-01.png`〜`avatar-10.png`（メタバース表示用）
- アバター選択画面は正面画像のみ表示:
  - `node-login-app/public/avatars/front/avatar-01-front.png`〜`avatar-10-front.png`

### ルーム導線

- `main.html`:
  - 「話す」 -> `selecttalk.html`
  - 「会う」 -> `selectmeet.html`
- `selecttalk.html`:
  - キーワード入力で `mode=talk` ルーム作成/参加
  - ルーム一覧はチャット系のみ表示
  - 一覧は「仮想空間にオンラインユーザーがいるルームのみ」表示
  - 中間画面を挟まず、即メタバースへ遷移
- `selectmeet.html`:
  - 都道府県 + キーワード入力
  - `都道府県-キーワード` を `mode=meet` のルームキーとして作成
  - 中間画面を挟まず、即メタバースへ遷移
- `room.html`:
  - 互換のため残置（現在の主導線では未使用）

### mode運用

- API許可モード: `chat`, `talk`, `call`, `meet`
- `talk` はサーバー内で `chat` に正規化して扱う（互換維持）

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
- 近くの人一覧で自分を除外（socketId/userId/nicknameで判定）
- 自分のアバター上にもニックネームを表示
- HUD上の座標表示は非表示化

### 個別会話・通話

- 近くのユーザーに個別会話リクエスト送信
- 承認後に個別チャット開始
- WebRTC通話（offer/answer/ice）対応
- 通話UI: 通話開始 / ミュート / 通話終了 / 再試行
- 接続タイムアウトと自動再試行あり

### UI

- `login.html`, `register.html`, `avatar-select.html`, `main.html`, `selecttalk.html`, `selectmeet.html`, `mypage.html` を同系統デザインに統一
  - ベージュ基調
  - 太枠 + ハードシャドウ
  - ドット見出し系トーン
- `logo.png`（`/logo.png`）をログイン・登録・アバター選択・メイン画面に表示
- メタバース右HUDも同系統トーンへ調整

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
- アバター画像はスプライトシート形式（`32x32` フレーム、`3列x4行` 前提）で使用
- `node-login-app/public/logo.png` を更新するとロゴ表示画面へ反映される

## 今後の候補

- 会うモードのBGM切り替え
- ルーム説明・タグ・検索改善
- チャットの通報/ミュート/NGワード
- Socket認証強化（セッション連携）
