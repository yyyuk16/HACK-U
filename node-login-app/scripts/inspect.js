const pool = require("../db");
require("dotenv").config();

async function run() {
  const tables = await pool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
     ORDER BY table_name`
  );
  console.log("=== public テーブル ===");
  console.log(tables.rows.map((r) => r.table_name).join("\n") || "(なし)");
  const users = await pool.query(
    "SELECT id, username, left(password, 20) || '...' AS password_prefix FROM users ORDER BY id"
  );
  console.log("\n=== users 行 (パスワードは先頭20文字+...) ===");
  console.table(users.rows);
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
