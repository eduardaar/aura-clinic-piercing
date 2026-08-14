import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

function safeGitValue(command, fallback) {
  try {
    return execSync(command, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || fallback;
  } catch {
    return fallback;
  }
}

const buildInfo = {
  version: process.env.npm_package_version || "1.0.0",
  commit: safeGitValue("git rev-parse --short HEAD", "local"),
  builtAt: new Date().toISOString()
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    define: {
      __AURA_BUILD__: JSON.stringify(buildInfo)
    },
    server: {
      proxy: {
        "/api": {
          target: env.VITE_DEV_API_TARGET || "http://localhost:4000",
          changeOrigin: true,
          secure: true
        },
        "/uploads": {
          target: env.VITE_DEV_API_TARGET || "http://localhost:4000",
          changeOrigin: true,
          secure: true
        }
      }
    },
    // Testes de componente com Vitest. O import segue vindo de "vite" (e não de
    // "vitest/config") para o `vite build` não passar a exigir o vitest instalado.
    test: {
      environment: "jsdom",
      globals: true,
      include: ["tests/**/*.test.{js,jsx}"],
      setupFiles: ["./tests/setup.js"],
      restoreMocks: true
    }
  };
});
