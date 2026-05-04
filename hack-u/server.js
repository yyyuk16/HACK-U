/**
 * 統合サーバー: Express + Socket.IO + Next.js
 * ポート3000で全て動作
 */
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const next = require('next');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', 'node-login-app', '.env') });

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

// --- PostgreSQL接続 ---
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME || 'hacku_prod',
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
  ssl: false
});

// --- Next.js設定 ---
const nextApp = next({ dev: process.env.NODE_ENV !== 'production' });
const handle = nextApp.getRequestHandler();

// --- グローバル定数 ---
const ALLOWED_TAGS = ['ゲーム', '音楽', '映画', 'アニメ', 'スポーツ', '旅行'];
const ALLOWED_MODES = ['chat', 'talk', 'call', 'meet'];
const ALLOWED_AVATARS = [
  'avatar-01', 'avatar-02', 'avatar-03', 'avatar-04', 'avatar-05',
  'avatar-06', 'avatar-07', 'avatar-08', 'avatar-09', 'avatar-10'
];
const PORT = process.env.PORT || 3000;

// --- Socket.IO状態管理 ---
const playersBySocket = new Map();
const roomChats = new Map();
const roomSeenUsers = new Map();
const CHAT_RANGE = 170;
const PRIVATE_TALK_RANGE = 120;
const pendingPrivateRequests = new Map();
const privateSessions = new Map();
const socketToPrivateSession = new Map();

// --- ユーティリティ関数 ---
const normalizeKeyword = (keyword) => String(keyword || '').trim().replace(/\s+/g, ' ').toLowerCase();
const normalizeMode = (mode) => mode === 'talk' ? 'chat' : mode;
const buildRoomKey = (mode, keyword) => `${normalizeMode(mode)}:${normalizeKeyword(keyword)}`;

// --- ミドルウェア ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 公開ディレクトリ（node-login-app/public + hack-u/public）
app.use(express.static(path.join(__dirname, '..', 'node-login-app', 'public')));
app.use(express.static(path.join(__dirname, 'public')));

// セッション設定
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 60 * 60 * 1000 }
}));

// --- DBスキーマ初期化 ---
async function ensureSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        nickname VARCHAR(255) UNIQUE,
        birth_date DATE,
        age INTEGER,
        avatar_key VARCHAR(32) DEFAULT 'avatar-01',
        occupation VARCHAR(255),
        prefecture VARCHAR(255),
        bio TEXT,
        favorite_tags TEXT[] DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        mode VARCHAR(16) NOT NULL,
        keyword_raw VARCHAR(255) NOT NULL,
        keyword_normalized VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (mode, keyword_normalized)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS room_members (
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (room_id, user_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_presence (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        last_seen_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('✅ Database schema initialized');
  } catch (err) {
    console.error('⚠️  Schema init error:', err.message);
  }
}

// --- 認証API ---

// 新規登録
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName, nickname, birthDate, occupation, prefecture, bio, favoriteTags } = req.body;
    
    if (!email || !password || !nickname) {
      return res.status(400).json({ error: '必須項目が不足しています' });
    }

    // パスワードハッシュ化
    const hash = await bcrypt.hash(password, 10);

    // ユーザー挿入
    const result = await pool.query(
      `INSERT INTO users (email, password, full_name, nickname, birth_date, occupation, prefecture, bio, favorite_tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, nickname, avatar_key`,
      [email, hash, fullName, nickname, birthDate, occupation, prefecture, bio, favoriteTags || []]
    );

    const user = result.rows[0];
    req.session.userId = user.id;
    res.json({ userId: user.id, nickname: user.nickname, avatarKey: user.avatar_key });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'メールまたはニックネームが既に登録されています' });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// ログイン
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'メールとパスワードは必須です' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'ユーザーが見つかりません' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'パスワードが間違っています' });
    }

    req.session.userId = user.id;
    res.json({ userId: user.id, nickname: user.nickname, avatarKey: user.avatar_key });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// ログアウト
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// セッション確認
app.get('/api/session', (req, res) => {
  if (req.session.userId) {
    res.json({ userId: req.session.userId });
  } else {
    res.status(401).json({ error: 'セッションなし' });
  }
});

// アバター選択
app.post('/api/avatar', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'ログインが必要です' });
    }

    const { avatarKey } = req.body;
    if (!ALLOWED_AVATARS.includes(avatarKey)) {
      return res.status(400).json({ error: '無効なアバターです' });
    }

    await pool.query('UPDATE users SET avatar_key = $1 WHERE id = $2', [avatarKey, req.session.userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Avatar error:', err);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// ルーム情報取得
app.get('/api/rooms/:mode/:keyword', async (req, res) => {
  try {
    const { mode, keyword } = req.params;
    const normalized = normalizeKeyword(keyword);

    const result = await pool.query(
      `SELECT id, mode, keyword_raw FROM rooms WHERE mode = $1 AND keyword_normalized = $2`,
      [normalizeMode(mode), normalized]
    );

    if (result.rows.length === 0) {
      return res.json({ notFound: true });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Room info error:', err);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// ルーム作成/参加
app.post('/api/rooms/join', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'ログインが必要です' });
    }

    const { mode, keyword } = req.body;
    if (!ALLOWED_MODES.includes(mode)) {
      return res.status(400).json({ error: '無効なモードです' });
    }

    const normalized = normalizeKeyword(keyword);
    
    // ルーム作成（既存ならスキップ）
    const roomResult = await pool.query(
      `INSERT INTO rooms (mode, keyword_raw, keyword_normalized)
       VALUES ($1, $2, $3)
       ON CONFLICT (mode, keyword_normalized) DO NOTHING
       RETURNING id`,
      [normalizeMode(mode), keyword, normalized]
    );

    const roomId = roomResult.rows[0]?.id || 
      (await pool.query(`SELECT id FROM rooms WHERE mode = $1 AND keyword_normalized = $2`, 
        [normalizeMode(mode), normalized])).rows[0].id;

    // メンバー追加
    await pool.query(
      `INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [roomId, req.session.userId]
    );

    res.json({ roomId });
  } catch (err) {
    console.error('Room join error:', err);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// --- Socket.IO イベント ---
io.on('connection', (socket) => {
  console.log('🔗 Socket connected:', socket.id);

  // ルーム参加
  socket.on('player:join', (data) => {
    const { userId, nickname, avatarKey, roomKey } = data;
    if (!roomKey) return;

    socket.join(roomKey);
    playersBySocket.set(socket.id, {
      userId,
      nickname,
      avatarKey,
      roomKey,
      x: 0,
      y: 0
    });

    io.to(roomKey).emit('room:playerJoined', { socketId: socket.id, nickname, avatarKey });
  });

  // プレイヤー移動
  socket.on('player:move', (data) => {
    const info = playersBySocket.get(socket.id);
    if (!info) return;

    const { x, y } = data;
    info.x = x;
    info.y = y;

    io.to(info.roomKey).emit('room:playerMoved', { socketId: socket.id, x, y });
  });

  // チャット送信
  socket.on('chat:message', (data) => {
    const info = playersBySocket.get(socket.id);
    if (!info) return;

    const { message } = data;
    const roomKey = info.roomKey;

    // 近接チャット処理（距離内のプレイヤーのみ受信）
    for (const [otherId, otherInfo] of playersBySocket.entries()) {
      if (otherInfo.roomKey !== roomKey) continue;

      const dist = Math.sqrt((info.x - otherInfo.x) ** 2 + (info.y - otherInfo.y) ** 2);
      if (dist <= CHAT_RANGE) {
        io.to(otherId).emit('chat:message', {
          socketId: socket.id,
          nickname: info.nickname,
          message,
          timestamp: new Date()
        });
      }
    }
  });

  // 切断
  socket.on('disconnect', () => {
    const info = playersBySocket.get(socket.id);
    if (info) {
      io.to(info.roomKey).emit('room:playerLeft', { socketId: socket.id });
      playersBySocket.delete(socket.id);
    }
    console.log('❌ Socket disconnected:', socket.id);
  });
});

// --- Next.js ルーティング ---
app.all('*', (req, res) => {
  return handle(req, res);
});

// --- サーバー起動 ---
async function start() {
  try {
    await nextApp.prepare();
    await ensureSchema();

    httpServer.listen(PORT, () => {
      console.log(`🚀 統合サーバー起動: http://localhost:${PORT}`);
      console.log(`   ✓ Express API (ポート${PORT})`);
      console.log(`   ✓ Socket.IO (ポート${PORT})`);
      console.log(`   ✓ Next.js (ポート${PORT})`);
    });
  } catch (err) {
    console.error('❌ 起動エラー:', err);
    process.exit(1);
  }
}

start();

// エラーハンドリング
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err);
  process.exit(1);
});
