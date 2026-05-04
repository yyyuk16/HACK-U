# 統合サーバーへの移行ガイド

## 概要
HACK-Uアプリを3つの独立したプロセス（Express + Socket.IO + Next.js）から**1つの統合サーバー**に移行しました。  
これにより、起動が簡単になり、メモリ使用量が削減され、ポート3000のみでの運用が可能になります。

## 変更点

### 旧構成 (3プロセス)
- `node-login-app/server.js` → ポート3000 (Express認証API)
- `hack-u/socket-server.js` → ポート3001 (Socket.IO)
- `hack-u` Next.js → ポート3002 (メタバース画面)

**起動コマンド**:
```bash
# ターミナル1
cd node-login-app
npm start

# ターミナル2
cd hack-u
npm run socket

# ターミナル3
cd hack-u
npm run dev:web
```

### 新構成 (統合サーバー)
- `hack-u/server.js` → ポート3000 (Express + Socket.IO + Next.js)

**起動コマンド** (1つのみ):
```bash
cd hack-u
npm run start:unified
```

## セットアップ手順

### 1. 環境変数の設定
`hack-u/.env` ファイルを作成します（`.env.example` を参考）:
```bash
cp hack-u/.env.example hack-u/.env
```

編集内容:
```
DB_USER=your_db_user
DB_HOST=localhost
DB_NAME=hacku_prod
DB_PASSWORD=your_db_password
DB_PORT=5432
SESSION_SECRET=your_random_secret_key
PORT=3000
NODE_ENV=development
```

### 2. データベース確認
PostgreSQLが起動していることを確認:
```bash
psql -U your_db_user -d hacku_prod

# テーブル確認
\dt

# 終了
\q
```

### 3. 依存パッケージのインストール
統合サーバーは `node-login-app` のパッケージも使用するため、`hack-u` に追加パッケージをインストール:
```bash
cd hack-u
npm install express express-session bcrypt pg
npm install
```

### 4. サーバー起動
```bash
# 開発モード
npm run start:unified

# 本番モード（事前に npm run build が必要）
npm run build
npm run start:unified:prod
```

ブラウザで `http://localhost:3000` にアクセスするとログインページが表示されます。

## 統合サーバーの機能

統合サーバー (`hack-u/server.js`) は以下を1つで管理します:

### 1. **Express API** (認証・ルーム管理)
- `POST /api/register` - 新規登録
- `POST /api/login` - ログイン
- `POST /api/logout` - ログアウト
- `GET /api/session` - セッション確認
- `POST /api/avatar` - アバター選択
- `GET /api/rooms/:mode/:keyword` - ルーム情報取得
- `POST /api/rooms/join` - ルーム参加

### 2. **Socket.IO イベント**
- `player:join` - ルーム参加
- `player:move` - プレイヤー移動
- `chat:message` - チャット送信
- `disconnect` - 切断処理

### 3. **Next.js フロントエンド**
- `app/page.tsx` - メタバース画面
- `components/MetaverseGame.tsx` - ゲームロジック
- 静的ファイル: `public/` 配下

### 4. **静的ファイル配信**
- `node-login-app/public/` - ログインページなど
- `hack-u/public/` - ゲーム素材

## トラブルシューティング

### ポートが既に使用中の場合
```bash
# macOS
lsof -i :3000
kill -9 <PID>

# Linux
fuser -k 3000/tcp
```

### DB接続エラー
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```
**原因**: PostgreSQLが起動していない  
**対策**: 
```bash
# macOS (Homebrewの場合)
brew services start postgresql

# Docker使用の場合
docker start hacku-postgres
```

### Socket接続エラー
クライアントが正しいサーバーに接続しているか確認:
```javascript
// MetaverseGame.tsx 内で自動判定済み
// ローカル開発: http://localhost:3000
// 本番: https://gms.gdl.jp
```

### 静的ファイルが見つからない場合
```bash
# 公開ディレクトリの確認
ls hack-u/public/
ls node-login-app/public/

# Next.jsのビルド確認
npm run build
```

## 本番デプロイ

サーバーで PM2 で管理する場合:
```bash
pm2 start hack-u/server.js --name "hacku-server" --env production

# 自動再起動設定
pm2 save
pm2 startup
```

## 旧サーバーの無効化

互換性のため旧サーバーはそのまま保持されていますが、以下で無効化できます:
```bash
# 旧プロセスの停止確認
ps aux | grep "node"

# 不要なら削除
rm hack-u/socket-server.js  # または保持してもOK
```

## ロールバック (旧構成に戻す場合)

```bash
# 旧構成で起動
cd node-login-app && npm start &
cd hack-u && npm run socket &
cd hack-u && npm run dev:web &
```

## 参考資料
- [Express.js ドキュメント](https://expressjs.com/)
- [Socket.IO ドキュメント](https://socket.io/docs/)
- [Next.js ドキュメント](https://nextjs.org/docs)
