import { defineConfig } from "vite";
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

export default defineConfig({
  plugins: [react()],
  define: {
    __AURA_BUILD__: JSON.stringify(buildInfo)
  }
});
