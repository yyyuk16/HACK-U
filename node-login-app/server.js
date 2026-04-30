const express = require('express');
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');
const db = require('./db');
require('dotenv').config();

const app = express();
const ALLOWED_TAGS = ['ゲーム', '音楽', '映画', 'アニメ', 'スポーツ', '旅行'];
const ALLOWED_MODES = ['chat', 'talk', 'call', 'meet'];
const ALLOWED_AVATARS = [
    'avatar-01',
    'avatar-02',
    'avatar-03',
    'avatar-04',
    'avatar-05',
    'avatar-06',
    'avatar-07',
    'avatar-08',
    'avatar-09',
    'avatar-10'
];
const ONLINE_WINDOW_SECONDS = 300;

function normalizeKeyword(keyword) {
    return keyword.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeMode(mode) {
    return mode === 'talk' ? 'chat' : mode;
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
    await db.query(`
        CREATE TABLE IF NOT EXISTS friend_requests (
            id SERIAL PRIMARY KEY,
            requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            receiver_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            responded_at TIMESTAMP,
            CHECK (status IN ('pending', 'accepted', 'rejected')),
            CHECK (requester_user_id <> receiver_user_id)
        )
    `);
    await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pending_pair_key
        ON friend_requests (
            LEAST(requester_user_id, receiver_user_id),
            GREATEST(requester_user_id, receiver_user_id)
        )
        WHERE status = 'pending'
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

app.get('/me/profile', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'ログインが必要です。' });
    }
    try {
        const result = await db.query(
            `SELECT
                id,
                username,
                full_name,
                nickname,
                birth_date,
                age,
                COALESCE(avatar_key, 'avatar-01') AS avatar_key,
                occupation,
                prefecture,
                bio,
                COALESCE(favorite_tags, '{}') AS favorite_tags
             FROM users
             WHERE id = $1`,
            [req.session.userId]
        );
        const user = result.rows[0];
        if (!user) {
            return res.status(404).json({ error: 'ユーザーが見つかりません。' });
        }
        await touchUserPresence(user.id);
        return res.json({
            id: user.id,
            username: user.username,
            fullName: user.full_name || '',
            nickname: user.nickname || '',
            birthDate: user.birth_date ? new Date(user.birth_date).toISOString().slice(0, 10) : '',
            age: Number.isInteger(user.age) ? user.age : null,
            avatarKey: user.avatar_key,
            occupation: user.occupation || '',
            prefecture: user.prefecture || '',
            bio: user.bio || '',
            favoriteTags: Array.isArray(user.favorite_tags) ? user.favorite_tags : []
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'サーバーエラーが発生しました。' });
    }
});

app.post('/me/profile', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'ログインが必要です。' });
    }
    const nickname = String(req.body.nickname || '').trim();
    const avatarKey = String(req.body.avatarKey || '');
    const occupation = String(req.body.occupation || '').trim();
    const prefecture = String(req.body.prefecture || '').trim();
    const bio = String(req.body.bio || '').trim();
    const rawTags = req.body.favoriteTags;
    const favoriteTags = Array.isArray(rawTags) ? rawTags : (rawTags ? [rawTags] : []);

    if (!nickname || !occupation || !prefecture || !bio) {
        return res.status(400).json({ error: '入力必須項目が不足しています。' });
    }
    if (!ALLOWED_AVATARS.includes(avatarKey)) {
        return res.status(400).json({ error: '選択されたアバターが不正です。' });
    }
    if (favoriteTags.length === 0 || favoriteTags.some((tag) => !ALLOWED_TAGS.includes(tag))) {
        return res.status(400).json({ error: '好きなモノタグを正しく選択してください。' });
    }
    try {
        const duplicate = await db.query(
            `SELECT id
             FROM users
             WHERE nickname = $1
               AND id <> $2
             LIMIT 1`,
            [nickname, req.session.userId]
        );
        if (duplicate.rows.length > 0) {
            return res.status(409).json({ error: 'そのニックネームは既に使用されています。' });
        }
        const updated = await db.query(
            `UPDATE users
             SET nickname = $1,
                 avatar_key = $2,
                 occupation = $3,
                 prefecture = $4,
                 bio = $5,
                 favorite_tags = $6
             WHERE id = $7
             RETURNING id, nickname, avatar_key, occupation, prefecture, bio, favorite_tags`,
            [nickname, avatarKey, occupation, prefecture, bio, favoriteTags, req.session.userId]
        );
        req.session.nickname = updated.rows[0].nickname;
        req.session.avatarKey = updated.rows[0].avatar_key;
        await touchUserPresence(req.session.userId);
        return res.json({
            profile: {
                id: updated.rows[0].id,
                nickname: updated.rows[0].nickname,
                avatarKey: updated.rows[0].avatar_key,
                occupation: updated.rows[0].occupation,
                prefecture: updated.rows[0].prefecture,
                bio: updated.rows[0].bio,
                favoriteTags: updated.rows[0].favorite_tags || []
            }
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
    const normalizedMode = normalizeMode(mode);

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
            [normalizedMode, trimmedKeyword, normalizedKeyword]
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
    const normalizedMode = normalizeMode(mode);

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
        const roomsResult = await db.query(query, [normalizedMode]);
        return res.json({ rooms: roomsResult.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'サーバーエラーが発生しました。' });
    }
});

app.get('/users/public', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'ログインが必要です。' });
    }
    const idsRaw = String(req.query.ids || '');
    const ids = idsRaw
        .split(',')
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
        .slice(0, 50);
    if (ids.length === 0) {
        return res.json({ users: [] });
    }
    try {
        const result = await db.query(
            `SELECT id, nickname, occupation, prefecture, bio, favorite_tags
             FROM users
             WHERE id = ANY($1::int[])`,
            [ids]
        );
        return res.json({ users: result.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'サーバーエラーが発生しました。' });
    }
});

app.post('/friend-requests', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'ログインが必要です。' });
    }
    const targetUserId = Number(req.body.targetUserId);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return res.status(400).json({ error: 'targetUserId が不正です。' });
    }
    if (targetUserId === req.session.userId) {
        return res.status(400).json({ error: '自分自身には申請できません。' });
    }
    try {
        const existingFriend = await db.query(
            `SELECT id
             FROM friend_requests
             WHERE status = 'accepted'
               AND ((requester_user_id = $1 AND receiver_user_id = $2)
                 OR (requester_user_id = $2 AND receiver_user_id = $1))
             LIMIT 1`,
            [req.session.userId, targetUserId]
        );
        if (existingFriend.rows.length > 0) {
            return res.status(409).json({ error: 'すでにフレンドです。' });
        }
        const inserted = await db.query(
            `INSERT INTO friend_requests (requester_user_id, receiver_user_id, status)
             VALUES ($1, $2, 'pending')
             RETURNING id, requester_user_id, receiver_user_id, status, created_at`,
            [req.session.userId, targetUserId]
        );
        return res.status(201).json({ request: inserted.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'すでに申請中です。' });
        }
        console.error(err);
        return res.status(500).json({ error: 'サーバーエラーが発生しました。' });
    }
});

app.get('/friend-requests/incoming', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'ログインが必要です。' });
    }
    try {
        const result = await db.query(
            `SELECT fr.id, fr.requester_user_id, fr.receiver_user_id, fr.status, fr.created_at,
                    u.nickname AS requester_nickname, u.avatar_key AS requester_avatar_key
             FROM friend_requests fr
             JOIN users u ON u.id = fr.requester_user_id
             WHERE fr.receiver_user_id = $1
               AND fr.status = 'pending'
             ORDER BY fr.created_at DESC`,
            [req.session.userId]
        );
        return res.json({ requests: result.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'サーバーエラーが発生しました。' });
    }
});

app.post('/friend-requests/:requestId/respond', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'ログインが必要です。' });
    }
    const requestId = Number(req.params.requestId);
    const accept = Boolean(req.body.accept);
    if (!Number.isInteger(requestId) || requestId <= 0) {
        return res.status(400).json({ error: 'requestId が不正です。' });
    }
    try {
        const result = await db.query(
            `UPDATE friend_requests
             SET status = $1, responded_at = NOW()
             WHERE id = $2
               AND receiver_user_id = $3
               AND status = 'pending'
             RETURNING id, requester_user_id, receiver_user_id, status, responded_at`,
            [accept ? 'accepted' : 'rejected', requestId, req.session.userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '対象の申請が見つかりません。' });
        }
        return res.json({ request: result.rows[0] });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'サーバーエラーが発生しました。' });
    }
});

app.get('/friends', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'ログインが必要です。' });
    }
    try {
        const result = await db.query(
            `SELECT
                CASE
                    WHEN fr.requester_user_id = $1 THEN fr.receiver_user_id
                    ELSE fr.requester_user_id
                END AS user_id,
                u.nickname,
                u.avatar_key,
                u.occupation,
                u.prefecture,
                u.bio,
                up.last_seen_at
             FROM friend_requests fr
             JOIN users u
               ON u.id = CASE
                    WHEN fr.requester_user_id = $1 THEN fr.receiver_user_id
                    ELSE fr.requester_user_id
               END
             LEFT JOIN user_presence up ON up.user_id = u.id
             WHERE fr.status = 'accepted'
               AND (fr.requester_user_id = $1 OR fr.receiver_user_id = $1)
             ORDER BY u.nickname ASC`,
            [req.session.userId]
        );
        return res.json({ friends: result.rows });
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