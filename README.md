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
