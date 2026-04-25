import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// next.config があるディレクトリ＝本アプリのルート（Turbopack の誤推論を防ぐ）
const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // 別端末のブラウザから http://<LAN-IP>:3000 で開くと HMR WebSocket が 403 になるのを防ぐ
  // 環境に合わせて IP またはホスト名を足す
  allowedDevOrigins: ["192.168.0.232"],
  turbopack: {
    root: appRoot,
  },
};

export default nextConfig;
