const express = require('express');
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');
const db = require('./db');
require('dotenv').config();

const app = express();

// ミドルウェアの設定
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// セッションの設定
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 60 * 60 * 1000 } // 1時間有効
}));

// --- ルーティング ---

// ルートURLへのアクセスをログイン画面へリダイレクト
app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// 1. 新規登録処理 (POST)
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query(
            'INSERT INTO users (username, password) VALUES ($1, $2)',
            [username, hashedPassword]
        );
        res.redirect('/login.html');
    } catch (err) {
        console.error(err); // ★ここで本当のエラーをターミナルに出力
        if (err.code === '23505') {
            return res.status(400).send('そのユーザー名は既に使用されています。');
        }
        res.status(500).send('サーバーエラーが発生しました。');
    }
});

// 2. ログイン処理 (POST)
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user.id;
            req.session.username = user.username;
            res.send(`<h1>ログイン成功！</h1><p>ようこそ、${user.username}さん</p><a href="/logout">ログアウト</a>`);
        } else {
            res.status(401).send('ユーザー名またはパスワードが間違っています。');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('サーバーエラーが発生しました。');
    }
});

// 3. ログアウト処理 (GET)
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('ログアウトに失敗しました。');
        }
        res.redirect('/login.html');
    });
});

// サーバー起動
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});