const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME || 'hacku_prod',  // 新しいDB名をデフォルトに
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: false  // ★ここを追加（カンマ忘れに注意！）
});

module.exports = pool;