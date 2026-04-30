const { spawn } = require("node:child_process");
const path = require("node:path");

const target = process.argv[2];

if (!target) {
  console.error("[docker-db] 実行対象が未指定です。");
  console.error("使い方: node scripts/run-with-docker-db.js <script-path>");
  process.exit(1);
}

const targetPath = path.resolve(__dirname, "..", target);
const mergedEnv = {
  ...process.env,
  DB_USER: "hacku",
  DB_HOST: "localhost",
  DB_NAME: "hacku_db",
  DB_PASSWORD: "hacku",
  DB_PORT: "5433",
};

console.log(`[docker-db] override DB_HOST=${mergedEnv.DB_HOST} DB_PORT=${mergedEnv.DB_PORT} DB_NAME=${mergedEnv.DB_NAME} DB_USER=${mergedEnv.DB_USER}`);
console.log(`[docker-db] running node ${target}`);

const child = spawn(process.execPath, [targetPath], {
  env: mergedEnv,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
