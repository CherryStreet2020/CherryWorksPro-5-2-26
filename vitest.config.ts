import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    globals: false,
    environment: "node",
    environmentMatchGlobs: [
      ["tests/unit/premium-*.test.tsx", "jsdom"],
    ],
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/integration/**/*.test.ts",
      "tests/email/**/*.test.ts",
      "server/**/*.test.ts",
    ],
    setupFiles: ["./tests/setup/jest-dom.ts"],
    retry: 0,
    testTimeout: 30000,
    hookTimeout: 30000,
    globalSetup: ["./tests/setup/global-setup.ts"],
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
});
