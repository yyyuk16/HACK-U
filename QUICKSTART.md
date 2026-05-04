# HACK-U クイックスタートガイド

## ローカル開発（統合サーバー版）

### 前提条件
- Node.js 18+ インストール済み
- PostgreSQL 起動済み

### 1分で起動

```bash
# hack-u ディレクトリに移動
cd hack-u

# 環境変数ファイルを作成
cp .env.example .env
# .env を編集（DB接続情報を入力）

# 依存パッケージをインストール
npm install

# サーバー起動
npm run start:unified
```

ブラウザで http://localhost:3000 を開くとログインページが表示されます。

---

## 本番デプロイ（gms.gdl.jp）

### セットアップ（初回のみ）

#### 1. サーバーにSSH接続
```bash
ssh user@gms.gdl.jp
```

#### 2. Node.js をインストール（nvm使用、sudoなし）
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18
nvm alias default 18
```

#### 3. PostgreSQL DB作成
```bash
psql -U your_db_user

CREATE DATABASE hacku_prod;

\i /path/to/hack-u/node-login-app/sql/init.sql

\q
```

#### 4. ファイルをサーバーにアップロード
```bash
# ローカルから実行
rsync -av --exclude-from=/Users/takumu/HACK-U/.gitignore /Users/takumu/HACK-U/ user@gms.gdl.jp:~/hack-u-app/
```

#### 5. サーバーで初期化
```bash
cd ~/hack-u-app/hack-u

# .env ファイル作成（DB認証情報を設定）
nano .env

# 依存インストール
npm install

# ビルド
npm run build

# PM2でプロセス管理
npm install -g pm2
pm2 start server.js --name "hacku-server" --env production
pm2 save
pm2 startup  # (sudoが必要なら管理者に依頼)
```

#### 6. Webサーバー設定（Apache/Nginx）
リバースプロキシを設定し、`https://gms.gdl.jp/~takumu0328/` をポート3000にマッピング。  
（詳細は DEPLOYMENT_GUIDE.md を参照）

---

## ディレクトリ構成

```
HACK-U/
├── hack-u/                      # メタバース + 統合サーバー
│   ├── server.js                # 統合サーバー (Express + Socket.IO + Next.js)
│   ├── socket-server.js         # 旧Socket.IOサーバー (互換用)
│   ├── package.json
│   ├── .env                     # 環境変数 (git無視)
│   ├── .env.example             # 環境変数テンプレート
│   ├── app/                     # Next.js アプリ
│   ├── components/              # Reactコンポーネント
│   ├── public/                  # 静的ファイル
│   └── phaser/                  # Phaserゲーム設定
│
├── node-login-app/              # 認証API (今は統合サーバーに含まれる)
│   ├── server.js                # 旧Express認証サーバー (互換用)
│   ├── public/                  # ログイン画面など
│   ├── sql/init.sql             # DB初期化スクリプト
│   └── .env                     # 環境変数
│
├── README.md                    # プロジェクトドキュメント
├── MIGRATION_GUIDE.md           # サーバー統合ガイド
├── DEPLOYMENT_GUIDE.md          # 本番デプロイガイド
└── .gitignore                   # Git無視ファイル
```

---

## よくある質問

### Q: ポート3000/3001/3002を全て使わないと起動しないのか？
**A**: いいえ。統合サーバーを使う場合は**ポート3000のみ**で十分です。  
`npm run start:unified` で全て動作します。

### Q: 旧サーバー（node-login-app + socket-server）はまだ使える？
**A**: はい。互換性のため保持されています。ただし統合サーバーの方が効率的です。  
詳細は MIGRATION_GUIDE.md を参照。

### Q: デプロイ後、ログインページのURLは？
**A**: `https://gms.gdl.jp/~takumu0328/` を想定。  
Webサーバーのリバースプロキシ設定により決定。

### Q: DBがリセットされても大丈夫？
**A**: ファイルアップロード時に `node-login-app/sql/init.sql` を実行すれば、テーブルが自動作成されます。

---

## トラブルシューティング

| 問題 | 原因 | 解決策 |
|------|------|--------|
| `EADDRINUSE: port 3000 already in use` | ポート3000が既に使用中 | `lsof -i :3000` で確認し既存プロセスを停止 |
| `connect ECONNREFUSED 127.0.0.1:5432` | PostgreSQLが起動していない | `psql --version` で確認後、起動コマンド実行 |
| `Module not found: dotenv` | 依存パッケージが未インストール | `npm install` を実行 |
| Socket接続エラー | クライアントがサーバーに接続できない | `.env` の `DB_HOST` を確認 |

---

## 次のステップ

1. **UI改善**: ログイン画面のデザイン調整
2. **機能拡張**: チャット通報、ミュート機能
3. **パフォーマンス**: Socket.IOの負荷テスト
4. **セキュリティ**: Socket認証強化、HTTPS設定

---

*詳細は各ドキュメントを参照：*
- [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) - サーバー統合詳細
- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - 本番デプロイ手順
- [README.md](./README.md) - 機能説明
