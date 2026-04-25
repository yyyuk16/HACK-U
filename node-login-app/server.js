const express = require('express');
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');
const db = require('./db');
require('dotenv').config();

const app = express();
const ALLOWED_TAGS = ['ゲーム', '音楽', '映画', 'アニメ', 'スポーツ', '旅行'];
const ALLOWED_MODES = ['chat', 'call', 'meet'];
const ALLOWED_AVATARS = ['avatar-01', 'avatar-02', 'avatar-03', 'avatar-04', 'avatar-05'];
const ONLINE_WINDOW_SECONDS = 300;

function normalizeKeyword(keyword) {
    return keyword.trim().replace(/\s+/g, ' ').toLowerCase();
}

async function touchUserPresence(userId) {
    await db.query(
        `INSERT INTO user_presence (user_id, last_seen_at)
         VALUES ($1, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
        [userId]
    );
}

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

// 起動時に users テーブルに必要なカラムを揃える
async function ensureUserSchema() {
    await db.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS full_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS nickname VARCHAR(255),
        ADD COLUMN IF NOT EXISTS birth_date DATE,
        ADD COLUMN IF NOT EXISTS age INTEGER,
        ADD COLUMN IF NOT EXISTS avatar_key VARCHAR(32) DEFAULT 'avatar-01',
        ADD COLUMN IF NOT EXISTS occupation VARCHAR(255),
        ADD COLUMN IF NOT EXISTS prefecture VARCHAR(255),
        ADD COLUMN IF NOT EXISTS bio TEXT,
        ADD COLUMN IF NOT EXISTS favorite_tags TEXT[] DEFAULT '{}'
    `);
    await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_key
        ON users (nickname)
        WHERE nickname IS NOT NULL
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS rooms (
            id SERIAL PRIMARY KEY,
            mode VARCHAR(16) NOT NULL,
            keyword_raw VARCHAR(255) NOT NULL,
            keyword_normalized VARCHAR(255) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE (mode, keyword_normalized)
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS room_members (
            room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
            PRIMARY KEY (room_id, user_id)
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS user_presence (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            last_seen_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    `);
}

// ルートURLへのアクセスをログイン画面へリダイレクト
app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// 1. 新規登録処理 (POST)
app.post('/register', async (req, res) => {
    const {
        fullName,
        nickname,
        birthDate,
        age,
        occupation,
        prefecture,
        bio,
        password,
        confirmPassword
    } = req.body;
    const rawTags = req.body.favoriteTags;
    const favoriteTags = Array.isArray(rawTags) ? rawTags : (rawTags ? [rawTags] : []);

    if (!fullName || !nickname || !birthDate || !age || !occupation || !prefecture || !bio || !password || !confirmPassword) {
        return res.status(400).send('入力必須項目が不足しています。');
    }
    const ageNumber = Number(age);
    if (!Number.isInteger(ageNumber) || ageNumber < 0) {
        return res.status(400).send('年齢の値が不正です。');
    }
    if (password !== confirmPassword) {
        return res.status(400).send('パスワードと確認用パスワードが一致しません。');
    }
    if (favoriteTags.length === 0) {
        return res.status(400).send('好きなモノタグを1つ以上選択してください。');
    }
    if (favoriteTags.some((tag) => !ALLOWED_TAGS.includes(tag))) {
        return res.status(400).send('不正なタグが含まれています。');
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await db.query(
            `INSERT INTO users
                (username, password, full_name, nickname, birth_date, age, avatar_key, occupation, prefecture, bio, favorite_tags)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING id, nickname, avatar_key`,
            [nickname, hashedPassword, fullName, nickname, birthDate, ageNumber, 'avatar-01', occupation, prefecture, bio, favoriteTags]
        );
        const createdUser = result.rows[0];
        req.session.userId = createdUser.id;
        req.session.nickname = createdUser.nickname;
        req.session.avatarKey = createdUser.avatar_key;
        await touchUserPresence(createdUser.id);
        res.redirect('/avatar-select.html');
    } catch (err) {
        console.error(err); // ★ここで本当のエラーをターミナルに出力
        if (err.code === '23505') {
            return res.status(400).send('そのニックネームは既に使用されています。');
        }
        res.status(500).send('サーバーエラーが発生しました。');
    }
});

// 2. ログイン処理 (POST)
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await db.query(
            'SELECT * FROM users WHERE username = $1 OR nickname = $1',
            [username]
        );
        const user = result.rows[0];

        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user.id;
            req.session.nickname = user.nickname || user.username;
            req.session.avatarKey = user.avatar_key || 'avatar-01';
            await touchUserPresence(user.id);
            res.redirect('/main.html');
        } else {
            res.status(401).send('ユーザー名またはパスワードが間違っています。');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('サーバーエラーが発生しました。');
    }
});

app.get('/me', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'ログインが必要です。' });
    }

    try {
        const result = await db.query(
            'SELECT id, nickname, COALESCE(avatar_key, \'avatar-01\') AS avatar_key FROM users WHERE id = $1',
            [req.session.userId]
        );
        const user = result.rows[0];
        if (!user) {
            return res.status(404).json({ error: 'ユーザーが見つかりません。' });
        }
        await touchUserPresence(user.id);
        return res.json({
            id: user.id,
            nickname: user.nickname,
            avatarKey: user.avatar_key
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'サーバーエラーが発生しました。' });
    }
});

app.post('/avatar/select', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).send('ログインが必要です。');
    }
    const avatarKey = req.body.avatarKey;
    if (!avatarKey || !ALLOWED_AVATARS.includes(avatarKey)) {
        return res.status(400).send('選択されたアバターが不正です。');
    }
    try {
        await db.query(
            'UPDATE users SET avatar_key = $1 WHERE id = $2',
            [avatarKey, req.session.userId]
        );
        req.session.avatarKey = avatarKey;
        return res.redirect('/main.html');
    } catch (err) {
        console.error(err);
        return res.status(500).send('サーバーエラーが発生しました。');
    }
});

app.post('/rooms/join', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'ログインが必要です。' });
    }

    const { mode, keyword } = req.body;
    if (!mode || !keyword || !ALLOWED_MODES.includes(mode)) {
        return res.status(400).json({ error: 'mode または keyword が不正です。' });
    }

    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
        return res.status(400).json({ error: 'keyword を入力してください。' });
    }

    const normalizedKeyword = normalizeKeyword(trimmedKeyword);

    try {
        await touchUserPresence(req.session.userId);
        await db.query('BEGIN');
        const roomResult = await db.query(
            `INSERT INTO rooms (mode, keyword_raw, keyword_normalized)
             VALUES ($1, $2, $3)
             ON CONFLICT (mode, keyword_normalized)
             DO UPDATE SET keyword_raw = EXCLUDED.keyword_raw
             RETURNING id, mode, keyword_raw, keyword_normalized`,
            [mode, trimmedKeyword, normalizedKeyword]
        );
        const room = roomResult.rows[0];

        await db.query(
            `INSERT INTO room_members (room_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT (room_id, user_id) DO NOTHING`,
            [room.id, req.session.userId]
        );

        const membersResult = await db.query(
            `SELECT u.id, u.nickname
             FROM room_members rm
             JOIN users u ON u.id = rm.user_id
             WHERE rm.room_id = $1
             ORDER BY rm.joined_at ASC`,
            [room.id]
        );
        const roomStatsResult = await db.query(
            `SELECT
                COUNT(*)::INTEGER AS participant_count,
                COUNT(*) FILTER (
                    WHERE up.last_seen_at >= NOW() - INTERVAL '${ONLINE_WINDOW_SECONDS} seconds'
                )::INTEGER AS online_count
             FROM room_members rm
             LEFT JOIN user_presence up ON up.user_id = rm.user_id
             WHERE rm.room_id = $1`,
            [room.id]
        );
        await db.query('COMMIT');

        return res.json({
            room: {
                id: room.id,
                mode: room.mode,
                keyword: room.keyword_raw,
                participantCount: roomStatsResult.rows[0].participant_count,
                onlineCount: roomStatsResult.rows[0].online_count
            },
            members: membersResult.rows
        });
    } catch (err) {
        await db.query('ROLLBACK');
        console.error(err);
        return res.status(500).json({ error: 'サーバーエラーが発生しました。' });
    }
});

app.get('/rooms', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'ログインが必要です。' });
    }

    const mode = req.query.mode;
    const sort = req.query.sort === 'popular' ? 'popular' : 'created';
    const onlineOnly = req.query.onlineOnly === 'true';

    if (!mode || !ALLOWED_MODES.includes(mode)) {
        return res.status(400).json({ error: 'mode が不正です。' });
    }

    try {
        await touchUserPresence(req.session.userId);
        const query = `
            SELECT
                r.id,
                r.mode,
                r.keyword_raw AS keyword,
                r.created_at,
                COUNT(rm.user_id)::INTEGER AS participant_count,
                COUNT(rm.user_id) FILTER (
                    WHERE up.last_seen_at >= NOW() - INTERVAL '${ONLINE_WINDOW_SECONDS} seconds'
                )::INTEGER AS online_count
            FROM rooms r
            LEFT JOIN room_members rm ON rm.room_id = r.id
            LEFT JOIN user_presence up ON up.user_id = rm.user_id
            WHERE r.mode = $1
            GROUP BY r.id, r.mode, r.keyword_raw, r.created_at
            ${onlineOnly ? `HAVING COUNT(rm.user_id) FILTER (
                WHERE up.last_seen_at >= NOW() - INTERVAL '${ONLINE_WINDOW_SECONDS} seconds'
            ) > 0` : ''}
            ORDER BY ${sort === 'popular'
                ? 'participant_count DESC, online_count DESC, r.created_at DESC'
                : 'r.created_at DESC'}
            LIMIT 100
        `;
        const roomsResult = await db.query(query, [mode]);
        return res.json({ rooms: roomsResult.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'サーバーエラーが発生しました。' });
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
ensureUserSchema()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });
    })
    .catch((err) => {
        console.error('Failed to ensure schema:', err);
        process.exit(1);
    });