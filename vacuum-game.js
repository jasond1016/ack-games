export function createVacuumGame() {
  const canvas = document.getElementById("vacuumCanvas");
  const ctx = canvas.getContext("2d");
  const scoreValue = document.getElementById("vacuumScoreValue");
  const timeValue = document.getElementById("vacuumTimeValue");
  const targetValue = document.getElementById("vacuumTargetValue");
  const statusValue = document.getElementById("vacuumStatusValue");
  const restartButton = document.getElementById("vacuumRestartButton");

  const levelConfig = {
    width: 640,
    height: 760,
    durationSeconds: 60,
    passScore: 200,
    pipe: {
      count: 4,
      top: 54,
      bottom: 642,
      width: 106,
      gap: 34,
      wall: 12
    },
    vacuum: {
      width: 112,
      height: 58,
      y: 690,
      speed: 360,
      catchRadius: 34
    },
    itemRadius: 18,
    spawn: {
      firstDelay: 0.35,
      minInterval: 0.48,
      maxInterval: 0.86,
      minSpeed: 145,
      maxSpeed: 235
    },
    items: [
      { type: "bill", label: "纸币", score: 100, weight: 9 },
      { type: "coin", label: "硬币", score: 5, weight: 52 },
      { type: "poop", label: "屎", score: -5, weight: 23 },
      { type: "bomb", label: "炸弹", score: -10, weight: 16 }
    ]
  };

  const pipes = createPipes();
  const keyState = new Set();
  let state;
  let lastFrameTime = 0;
  let animationFrameId = 0;
  let gameActive = false;
  let listening = false;

  function start() {
    setupCanvas();
    resetGame();
    addListeners();
    startGameLoop();
  }

  function stop() {
    stopGameLoop();
    removeListeners();
    keyState.clear();
  }

  function setupCanvas() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(levelConfig.width * dpr);
    canvas.height = Math.floor(levelConfig.height * dpr);
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resetGame() {
    state = {
      score: 0,
      elapsedSeconds: 0,
      timeLeft: levelConfig.durationSeconds,
      status: "playing",
      nextSpawnIn: levelConfig.spawn.firstDelay,
      items: [],
      vacuum: {
        x: levelConfig.width / 2,
        y: levelConfig.vacuum.y,
        width: levelConfig.vacuum.width,
        height: levelConfig.vacuum.height
      }
    };

    lastFrameTime = performance.now();
    updateHud();
    drawGame();
  }

  function startGameLoop() {
    stopGameLoop();
    gameActive = true;
    lastFrameTime = performance.now();
    animationFrameId = requestAnimationFrame(gameLoop);
  }

  function stopGameLoop() {
    gameActive = false;

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }
  }

  function addListeners() {
    if (listening) return;

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("resize", setupCanvas);
    listening = true;
  }

  function removeListeners() {
    if (!listening) return;

    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    window.removeEventListener("blur", handleBlur);
    window.removeEventListener("resize", setupCanvas);
    listening = false;
  }

  function createPipes() {
    const { count, width, gap, top, bottom, wall } = levelConfig.pipe;
    const totalWidth = count * width + (count - 1) * gap;
    const startX = (levelConfig.width - totalWidth) / 2;

    return Array.from({ length: count }, (_, index) => {
      const x = startX + index * (width + gap);
      return {
        x,
        y: top,
        width,
        height: bottom - top,
        wall,
        centerX: x + width / 2
      };
    });
  }

  function gameLoop(timestamp) {
    if (!gameActive) return;

    const deltaSeconds = Math.min((timestamp - lastFrameTime) / 1000, 0.05);
    lastFrameTime = timestamp;

    if (state.status === "playing") {
      updateTimer(deltaSeconds);
      updateVacuum(deltaSeconds);
      spawnFallingItems(deltaSeconds);
      updateItems(deltaSeconds);
      collectTouchedItems();
      removeMissedItems();
      maybeFinishLevel();
    }

    drawGame();
    animationFrameId = requestAnimationFrame(gameLoop);
  }

  function updateTimer(deltaSeconds) {
    state.elapsedSeconds += deltaSeconds;
    state.timeLeft = Math.max(0, levelConfig.durationSeconds - state.elapsedSeconds);
  }

  function updateVacuum(deltaSeconds) {
    let dx = 0;
    if (keyState.has("ArrowLeft") || keyState.has("KeyA")) dx -= 1;
    if (keyState.has("ArrowRight") || keyState.has("KeyD")) dx += 1;
    if (dx === 0) return;

    const halfWidth = state.vacuum.width / 2;
    const minX = pipes[0].centerX - halfWidth;
    const maxX = pipes[pipes.length - 1].centerX + halfWidth;

    state.vacuum.x += dx * levelConfig.vacuum.speed * deltaSeconds;
    state.vacuum.x = clamp(state.vacuum.x, minX, maxX);
  }

  function spawnFallingItems(deltaSeconds) {
    state.nextSpawnIn -= deltaSeconds;

    while (state.nextSpawnIn <= 0) {
      state.items.push(createFallingItem());
      state.nextSpawnIn += randomBetween(levelConfig.spawn.minInterval, levelConfig.spawn.maxInterval);
    }
  }

  function createFallingItem() {
    const pipe = pipes[Math.floor(Math.random() * pipes.length)];
    const itemConfig = chooseWeightedItem();
    const sideMargin = levelConfig.itemRadius + 8;

    return {
      type: itemConfig.type,
      label: itemConfig.label,
      score: itemConfig.score,
      radius: levelConfig.itemRadius,
      x: randomBetween(pipe.x + sideMargin, pipe.x + pipe.width - sideMargin),
      y: levelConfig.pipe.top - levelConfig.itemRadius - randomBetween(0, 48),
      speed: randomBetween(levelConfig.spawn.minSpeed, levelConfig.spawn.maxSpeed),
      rotation: randomBetween(-0.2, 0.2),
      pipeIndex: pipes.indexOf(pipe)
    };
  }

  function chooseWeightedItem() {
    const totalWeight = levelConfig.items.reduce((sum, item) => sum + item.weight, 0);
    let ticket = Math.random() * totalWeight;

    for (const item of levelConfig.items) {
      ticket -= item.weight;
      if (ticket <= 0) return item;
    }

    return levelConfig.items[levelConfig.items.length - 1];
  }

  function updateItems(deltaSeconds) {
    for (const item of state.items) {
      item.y += item.speed * deltaSeconds;
      item.rotation += deltaSeconds * 0.9;
    }
  }

  function collectTouchedItems() {
    const nozzle = vacuumNozzle();

    state.items = state.items.filter((item) => {
      const lowEnough = item.y >= levelConfig.pipe.bottom - 22;
      const caught = lowEnough && distance(nozzle, item) <= levelConfig.vacuum.catchRadius + item.radius;

      if (caught) {
        state.score += item.score;
        return false;
      }

      return true;
    });

    updateHud();
  }

  function removeMissedItems() {
    state.items = state.items.filter((item) => item.y - item.radius <= levelConfig.height + 20);
  }

  function maybeFinishLevel() {
    if (state.timeLeft > 0) return;

    state.status = state.score >= levelConfig.passScore ? "won" : "lost";
    state.timeLeft = 0;
    updateHud();
  }

  function vacuumNozzle() {
    return {
      x: state.vacuum.x,
      y: levelConfig.pipe.bottom + 22
    };
  }

  function updateHud() {
    scoreValue.textContent = String(state.score);
    timeValue.textContent = `${Math.ceil(state.timeLeft)}秒`;
    targetValue.textContent = `${levelConfig.passScore}+`;

    if (state.status === "won") {
      statusValue.textContent = "成功";
    } else if (state.status === "lost") {
      statusValue.textContent = "失败";
    } else {
      statusValue.textContent = "游戏中";
    }
  }

  function drawGame() {
    ctx.clearRect(0, 0, levelConfig.width, levelConfig.height);
    drawBackground();
    drawPipes();
    drawCatchZone();

    for (const item of state.items) {
      drawItem(item);
    }

    drawVacuum(state.vacuum);

    if (state.status !== "playing") {
      drawResultOverlay();
    }
  }

  function drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, levelConfig.height);
    gradient.addColorStop(0, "#fafdff");
    gradient.addColorStop(1, "#ecf4f7");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, levelConfig.width, levelConfig.height);

    ctx.fillStyle = "rgba(15, 139, 141, 0.08)";
    for (let y = 38; y < levelConfig.height; y += 92) {
      ctx.fillRect(32, y, 36, 8);
      ctx.fillRect(572, y + 34, 30, 8);
    }

    ctx.fillStyle = "#d7dee8";
    roundRect(ctx, 24, levelConfig.pipe.bottom + 60, levelConfig.width - 48, 26, 8);
    ctx.fill();
  }

  function drawPipes() {
    for (const pipe of pipes) {
      drawPipe(pipe);
    }
  }

  function drawPipe(pipe) {
    ctx.save();
    ctx.shadowColor = "rgba(31, 41, 51, 0.16)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 8;
    roundRect(ctx, pipe.x - pipe.wall, pipe.y - pipe.wall, pipe.width + pipe.wall * 2, pipe.height + pipe.wall * 2, 26);
    ctx.fillStyle = "#b9c5d3";
    ctx.fill();
    ctx.restore();

    roundRect(ctx, pipe.x, pipe.y, pipe.width, pipe.height, 18);
    ctx.fillStyle = "#eef6fb";
    ctx.fill();

    const innerGradient = ctx.createLinearGradient(pipe.x, 0, pipe.x + pipe.width, 0);
    innerGradient.addColorStop(0, "rgba(156, 170, 189, 0.42)");
    innerGradient.addColorStop(0.34, "rgba(255, 255, 255, 0.9)");
    innerGradient.addColorStop(0.72, "rgba(255, 255, 255, 0.78)");
    innerGradient.addColorStop(1, "rgba(143, 156, 173, 0.5)");
    roundRect(ctx, pipe.x + 12, pipe.y + 16, pipe.width - 24, pipe.height - 24, 12);
    ctx.fillStyle = innerGradient;
    ctx.fill();

    ctx.strokeStyle = "rgba(15, 139, 141, 0.18)";
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 16]);
    ctx.beginPath();
    ctx.moveTo(pipe.centerX, pipe.y + 24);
    ctx.lineTo(pipe.centerX, pipe.y + pipe.height - 16);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#9caabd";
    ctx.lineWidth = 3;
    roundRect(ctx, pipe.x - 14, pipe.y - 18, pipe.width + 28, 38, 18);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#d1dce9";
    roundRect(ctx, pipe.x + 12, pipe.y + pipe.height - 4, pipe.width - 24, 20, 8);
    ctx.fill();
  }

  function drawCatchZone() {
    ctx.save();
    ctx.strokeStyle = "rgba(214, 69, 69, 0.38)";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.moveTo(40, levelConfig.pipe.bottom - 22);
    ctx.lineTo(levelConfig.width - 40, levelConfig.pipe.bottom - 22);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawItem(item) {
    if (item.type === "bill") drawBill(item);
    if (item.type === "coin") drawCoin(item);
    if (item.type === "poop") drawPoop(item);
    if (item.type === "bomb") drawBomb(item);
  }

  function drawBill(item) {
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(item.rotation);

    roundRect(ctx, -25, -15, 50, 30, 5);
    ctx.fillStyle = "#36a96a";
    ctx.fill();
    ctx.strokeStyle = "#177245";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = "#c9f4d6";
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#d9ffe3";
    ctx.lineWidth = 2;
    ctx.strokeRect(-18, -8, 36, 16);
    ctx.restore();
  }

  function drawCoin(item) {
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(item.rotation);

    ctx.fillStyle = "#f2b705";
    ctx.beginPath();
    ctx.arc(0, 0, 19, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#b77900";
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = "#ffe48a";
    ctx.beginPath();
    ctx.arc(-5, -6, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#9b6500";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(0, 10);
    ctx.stroke();
    ctx.restore();
  }

  function drawPoop(item) {
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(item.rotation * 0.5);

    ctx.fillStyle = "#7b4a2a";
    ctx.beginPath();
    ctx.ellipse(0, 10, 20, 10, 0, 0, Math.PI * 2);
    ctx.ellipse(0, 1, 15, 10, 0, 0, Math.PI * 2);
    ctx.ellipse(0, -9, 10, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#a9653b";
    ctx.beginPath();
    ctx.arc(-7, -6, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#4f2e1b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-18, 11);
    ctx.quadraticCurveTo(0, 19, 18, 11);
    ctx.stroke();
    ctx.restore();
  }

  function drawBomb(item) {
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(item.rotation * 0.8);

    ctx.fillStyle = "#25313f";
    ctx.beginPath();
    ctx.arc(0, 4, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#121820";
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.strokeStyle = "#5e6a79";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(7, -10);
    ctx.quadraticCurveTo(18, -24, 28, -17);
    ctx.stroke();

    ctx.fillStyle = "#ffcf33";
    ctx.beginPath();
    ctx.moveTo(31, -18);
    ctx.lineTo(39, -22);
    ctx.lineTo(35, -14);
    ctx.lineTo(43, -11);
    ctx.lineTo(34, -8);
    ctx.lineTo(30, 0);
    ctx.lineTo(27, -9);
    ctx.lineTo(18, -12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawVacuum(vacuum) {
    ctx.save();
    ctx.translate(vacuum.x, vacuum.y);

    ctx.fillStyle = "rgba(15, 139, 141, 0.16)";
    ctx.beginPath();
    ctx.arc(0, -28, levelConfig.vacuum.catchRadius, Math.PI, 0);
    ctx.lineTo(0, -28);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#0f8b8d";
    roundRect(ctx, -vacuum.width / 2, -vacuum.height / 2, vacuum.width, vacuum.height, 18);
    ctx.fill();

    ctx.fillStyle = "#0a6264";
    roundRect(ctx, -28, -46, 56, 28, 10);
    ctx.fill();

    ctx.fillStyle = "#f2b705";
    ctx.beginPath();
    ctx.arc(-29, 2, 13, 0, Math.PI * 2);
    ctx.arc(29, 2, 13, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(-18, -10, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#1f2933";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(18, -28);
    ctx.quadraticCurveTo(44, -58, 70, -36);
    ctx.stroke();
    ctx.restore();
  }

  function drawResultOverlay() {
    const won = state.status === "won";

    ctx.save();
    ctx.fillStyle = "rgba(31, 41, 51, 0.36)";
    ctx.fillRect(0, 0, levelConfig.width, levelConfig.height);

    roundRect(ctx, 118, 282, 404, 182, 8);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = won ? "#0f8b8d" : "#d64545";
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = "#1f2933";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 44px Microsoft YaHei, Arial";
    ctx.fillText(won ? "成功" : "失败", levelConfig.width / 2, 338);

    ctx.font = "700 24px Microsoft YaHei, Arial";
    ctx.fillStyle = won ? "#0a6264" : "#b42318";
    ctx.fillText(`分数 ${state.score} / 目标 ${levelConfig.passScore}`, levelConfig.width / 2, 390);

    ctx.font = "600 18px Microsoft YaHei, Arial";
    ctx.fillStyle = "#667085";
    ctx.fillText("点击右上角再来一次", levelConfig.width / 2, 426);
    ctx.restore();
  }

  function handleKeyDown(event) {
    if (["ArrowLeft", "ArrowRight", "KeyA", "KeyD"].includes(event.code)) {
      event.preventDefault();
      keyState.add(event.code);
    }
  }

  function handleKeyUp(event) {
    keyState.delete(event.code);
  }

  function handleBlur() {
    keyState.clear();
  }

  restartButton.addEventListener("click", resetGame);

  return { start, stop, reset: resetGame };
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}
