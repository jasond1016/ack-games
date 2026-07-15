# ACK Games Local Workflow

This repo is a static browser game project. The game code stays as plain `html/css/js`; the local tooling added here only handles serving and smoke-testing it.

## Prerequisites

- Node.js 24+
- pnpm 11+
- Windows users can run the Playwright smoke test immediately if Microsoft Edge is already installed.
- If Playwright cannot find a local browser, run `pnpm run setup:e2e` once to install Chromium.

## Install

```bash
pnpm install
```

## Run Locally

```bash
pnpm run serve
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

赛车支持键盘和标准 Xbox 360 手柄。手柄映射：左摇杆或十字键转向，RT 油门，LT 刹车/倒车，A 开赛/氮气/再跑一场，Y 切换镜头，X 切换对手，Start 暂停/继续，Back 重开比赛。

If you want the browser opened automatically:

```bash
pnpm run serve:open
```

## End-to-End Smoke Test

Run the default headless smoke test:

```bash
pnpm run test:e2e
```

Useful variants:

```bash
pnpm run test:e2e:headed
pnpm run test:e2e:debug
```

## What The Smoke Test Covers

The current Playwright test exercises the main racing start flow:

- Enter the racing game from the home screen
- Verify the car selection overlay loads
- Scroll to and select the last available car
- Start a race
- Open the pause menu with `Esc`
- Return home and re-enter the racing flow
- Verify the reusable selected-car preview canvas is not stuck in a lost WebGL context

## Notes

- The local static server is `scripts/serve.mjs`.
- The Playwright configuration is `playwright.config.js`.
- If you need a specific browser executable, set `PLAYWRIGHT_BROWSER_EXECUTABLE_PATH` before running `pnpm run test:e2e`.
- Production uses Cloudflare Pages for the game and R2 for versioned car models. See [the Cloudflare deployment guide](docs/cloudflare-deployment.md).
