import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";

// .env vive na raiz do monorepo (cwd = apps/web quando o Next roda via turbo/pnpm)
loadEnv({ path: "../../.env" });

const nextConfig: NextConfig = {
  // Módulos nativos/Node não devem ser bundlados pelo Turbopack no server
  serverExternalPackages: ["argon2", "pg"],
};

export default nextConfig;
