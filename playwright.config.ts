import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 360_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:8788",
    viewport: { width: 1366, height: 768 },
  },
  webServer: {
    command: "npm run start -w server",
    env: {
      PORT: "8788",
      ADMIN_TOKEN: "e2e-token",
      ALLOW_LOCALHOST_FOR_TESTS: "1",
      DATA_DIR: "./data-e2e",
      EVIDENCE_DIR: "./data-e2e/evidence",
      // E2E оқшаулығы: уақыт терезесі дубликатын өшіру (белсенді жоба дубликаты бәрібір бұғатталады)
      DUPLICATE_WINDOW_MINUTES: "0",
    },
    url: "http://127.0.0.1:8788/api/system/info",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
