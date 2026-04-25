-- node-login-app で使う users テーブル
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  nickname VARCHAR(255) UNIQUE,
  birth_date DATE,
  age INTEGER,
  avatar_key VARCHAR(32) DEFAULT 'avatar-01',
  occupation VARCHAR(255),
  prefecture VARCHAR(255),
  bio TEXT,
  favorite_tags TEXT[] DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  mode VARCHAR(16) NOT NULL,
  keyword_raw VARCHAR(255) NOT NULL,
  keyword_normalized VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (mode, keyword_normalized)
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_presence (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW()
);
