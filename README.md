# HACK-U

HACK-U2026 で作成したメタバースアプリのリポジトリです。

`hack-u/` 配下に Next.js ベースのアプリが含まれます。

## やるべきこと（`node-login-app` 用）

# プロジェクトの初期化 (package.jsonの作成)
npm init -y

# 必要なパッケージのインストール
npm install express pg bcrypt express-session dotenv

この2つを実行 → `node_modules` というディレクトリができます。

## ルート（モノレポ用）

`package.json` の各スクリプトは `hack-u/` を向いています。

```bash
npm run dev
```
