const fs = require("node:fs");
const path = require("node:path");
const { defineConfig } = require("@playwright/test");

const port = Number(process.env.PLAYWRIGHT_PORT || 4173);

function resolveExecutablePath() {
  const candidates = [
    process.env.PLAYWRIGHT_BROWSER_EXECUTABLE_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? undefined;
}

const executablePath = resolveExecutablePath();

module.exports = defineConfig({
  testDir: path.join(__dirname, "tests"),
  fullyParallel: false,
  reporter: "list",
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    headless: true,
    viewport: {
      width: 1440,
      height: 900
    },
    launchOptions: executablePath ? { executablePath } : {},
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: `node ./scripts/serve.mjs --port ${port}`,
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000
  }
});
