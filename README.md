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

## Racing Telemetry And Performance Baseline

Press `F2` while driving to show live vehicle, drivetrain, tire, physics, and rendering telemetry. Select `Coastal Festival Showcase` to run an `ISLAND TOUR` route that connects its road loop, tunnel, and rally branch. The original island free-drive map remains an untimed sandbox.

Run the deterministic scene-complexity and telemetry smoke benchmark with:

```bash
pnpm run test:e2e:perf
```

The browser debug interface also supports focused manual runs:

```js
__ackGamesDebug.racing.listTestScenarios()
__ackGamesDebug.racing.placeTestScenario("rally")
__ackGamesDebug.racing.startBenchmark({ label: "rally", durationSeconds: 10 })
__ackGamesDebug.racing.getTelemetry()
```

Select `Vehicle Proving Ground` for the flat development circuit, braking markers, skidpads, and slalom. Automated Rapier vehicle protocols are available from the browser debug interface:

```js
__ackGamesDebug.racing.listProvingGroundTests()
__ackGamesDebug.racing.startProvingGroundTest("zero-to-100")
__ackGamesDebug.racing.startProvingGroundTest("100-to-zero")
__ackGamesDebug.racing.startProvingGroundTest("skidpad")
__ackGamesDebug.racing.getState().provingGround
```

Run their browser integration coverage with `pnpm run test:e2e:proving`.

Build a comparable dynamics matrix for the representative classic RWD, modern AWD supercar, and heavy AWD SUV with:

```bash
pnpm run test:e2e:matrix
```

The matrix records acceleration, braking, skidpad radius, tire slip, ABS/TCS active time, gear shifts, road-contact ratio, and a 10 Hz acceleration trace containing RPM, gear, drivetrain/TCS scaling, and applied wheel force in `output/racing-vehicle-matrix.json`. Override the catalog subset with a comma-separated `RACING_MATRIX_CARS` environment variable.

## Notes

- The local static server is `scripts/serve.mjs`.
- The Playwright configuration is `playwright.config.js`.
- If you need a specific browser executable, set `PLAYWRIGHT_BROWSER_EXECUTABLE_PATH` before running `pnpm run test:e2e`.
- Production uses Cloudflare Pages for the game and R2 for versioned car models. See [the Cloudflare deployment guide](docs/cloudflare-deployment.md).
