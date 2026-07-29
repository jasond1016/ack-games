import * as THREE from "three";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/utils/SkeletonUtils.js";

export const TENNIS_CHARACTERS = Object.freeze([
  Object.freeze({ id: "lin", name: "林风", role: "追风者", color: "#20c997", skin: "#e8aa78", power: 68, speed: 96, control: 78, reach: 66 }),
  Object.freeze({ id: "max", name: "马克斯", role: "重炮手", color: "#ff5b35", skin: "#8e583a", power: 98, speed: 62, control: 70, reach: 82 }),
  Object.freeze({ id: "mei", name: "梅", role: "落点大师", color: "#ffd447", skin: "#edb58b", power: 72, speed: 78, control: 98, reach: 72 }),
  Object.freeze({ id: "noa", name: "诺亚", role: "全能左手", color: "#5b7cfa", skin: "#5d3929", power: 82, speed: 82, control: 82, reach: 88 })
]);

const AI_PLAYER = Object.freeze({ name: "铁壁", color: "#e9edf0", skin: "#ad704d", power: 80, speed: 76, control: 84, reach: 82 });
const BALL_GRAVITY = 3.2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createGame() {
  const canvas = document.getElementById("tennisCanvas");
  const select = document.getElementById("tennisSelect");
  const characterGrid = document.getElementById("tennisCharacters");
  const startButton = document.getElementById("tennisStartButton");
  const restartButton = document.getElementById("tennisRestartButton");
  const result = document.getElementById("tennisResult");
  const rematchButton = document.getElementById("tennisRematchButton");
  const reselectButton = document.getElementById("tennisReselectButton");
  const resultTitle = document.getElementById("tennisResultTitle");
  const resultCopy = document.getElementById("tennisResultCopy");
  const callout = document.getElementById("tennisCallout");
  const playerName = document.getElementById("tennisPlayerName");
  const aiName = document.getElementById("tennisAiName");
  const playerScore = document.getElementById("tennisPlayerScore");
  const aiScore = document.getElementById("tennisAiScore");
  const controls = document.getElementById("tennisControls");
  const soloModeButton = document.getElementById("tennisSoloModeButton");
  const versusModeButton = document.getElementById("tennisVersusModeButton");
  const playerSlots = document.getElementById("tennisPlayerSlots");
  const playerOneSlot = document.getElementById("tennisPlayerOneSlot");
  const playerTwoSlot = document.getElementById("tennisPlayerTwoSlot");
  const splitHud = document.getElementById("tennisSplitHud");
  const splitPlayerOne = document.getElementById("tennisSplitPlayerOne");
  const splitPlayerTwo = document.getElementById("tennisSplitPlayerTwo");

  const keys = new Set();
  let selectedIndex = 0;
  let selectedIndex2 = 3;
  let selectingSide = 0;
  let gameMode = "solo";
  let phase = "select";
  let frameId = 0;
  let lastTime = 0;
  let listening = false;
  let gamepadPrevious = [
    { a: false, b: false, left: false, right: false },
    { a: false, b: false, left: false, right: false }
  ];
  let state = createMatchState();
  let renderer;
  let scene;
  let camera;
  let opponentCamera;
  let ballMesh;
  let ballTrail;
  let playerVisual;
  let aiVisual;
  const mixers = [];

  function createMatchState() {
    return {
      score: [0, 0],
      player: { x: 0, y: 0.72, swing: 0, lob: false, smash: false, motion: 0 },
      ai: { x: 0, y: -0.72, swing: 0, smash: false, motion: 0 },
      ball: { x: 0, y: 0.68, z: 0.16, vx: 0, vy: 0, vz: 0, moving: false, servePhase: "ready", server: 0, lastHitter: 0, bounces: 0 },
      pointDelay: 0,
      messageTime: 0,
      inputs: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      shotBuffers: [null, null],
      pendingHit: null,
      hitStop: 0,
      impactTrail: null,
      lastShot: null,
      lastHitQuality: null,
      rallyHits: 0,
      lastTarget: null,
      lastContact: null,
      lastLanding: null,
      particles: []
    };
  }

  async function start() {
    renderCharacters();
    setupThreeScene();
    resizeCanvas();
    await loadPlayerModels();
    showSelection();
    addListeners();
    lastTime = performance.now();
    frameId = requestAnimationFrame(loop);
    exposeDebug();
  }

  function stop() {
    phase = "stopped";
    cancelAnimationFrame(frameId);
    frameId = 0;
    removeListeners();
    keys.clear();
    renderer?.dispose();
    scene?.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
      else object.material?.dispose?.();
    });
    delete window.__ackGamesDebug?.tennis;
  }

  function renderCharacters() {
    characterGrid.replaceChildren(...TENNIS_CHARACTERS.map((character, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tennis-character";
      button.dataset.characterId = character.id;
      button.style.setProperty("--player-color", character.color);
      button.style.setProperty("--player-skin", character.skin);
      button.innerHTML = `
        <span class="tennis-character-number">0${index + 1}</span>
        <span class="tennis-character-portrait" aria-hidden="true"><i>${character.name.slice(0, 1)}</i></span>
        <span class="tennis-character-copy"><em>${character.role}</em><strong>${character.name}</strong></span>
        <span class="tennis-stats">
          ${statMarkup("力量", character.power)}
          ${statMarkup("速度", character.speed)}
          ${statMarkup("控球", character.control)}
          ${statMarkup("覆盖", character.reach)}
        </span>`;
      button.addEventListener("click", () => selectCharacter(index));
      button.addEventListener("dblclick", beginMatch);
      return button;
    }));
    updateCharacterSelection();
  }

  function statMarkup(label, value) {
    return `<span><i>${label}</i><b><u style="width:${value}%"></u></b><em>${value}</em></span>`;
  }

  function selectCharacter(index) {
    const normalizedIndex = (index + TENNIS_CHARACTERS.length) % TENNIS_CHARACTERS.length;
    if (gameMode === "versus" && selectingSide === 1) selectedIndex2 = normalizedIndex;
    else selectedIndex = normalizedIndex;
    updateCharacterSelection();
  }

  function updateCharacterSelection() {
    [...characterGrid.children].forEach((card, index) => {
      const selected = index === (selectingSide === 1 ? selectedIndex2 : selectedIndex);
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-pressed", String(selected));
      card.dataset.player = gameMode === "versus" && index === selectedIndex && index === selectedIndex2 ? "P1 · P2"
        : gameMode === "versus" && index === selectedIndex ? "P1"
          : gameMode === "versus" && index === selectedIndex2 ? "P2" : "";
    });
    playerOneSlot.querySelector("strong").textContent = TENNIS_CHARACTERS[selectedIndex].name;
    playerTwoSlot.querySelector("strong").textContent = TENNIS_CHARACTERS[selectedIndex2].name;
    playerOneSlot.classList.toggle("is-selected", selectingSide === 0);
    playerTwoSlot.classList.toggle("is-selected", selectingSide === 1);
  }

  function setGameMode(mode) {
    gameMode = mode;
    selectingSide = 0;
    soloModeButton.classList.toggle("is-selected", mode === "solo");
    versusModeButton.classList.toggle("is-selected", mode === "versus");
    playerSlots.hidden = mode !== "versus";
    startButton.textContent = mode === "versus" ? "开始双人对战" : "带他上场";
    controls.innerHTML = mode === "versus"
      ? `<span><kbd>P1：WASD</kbd> 移动 · <kbd>F / G</kbd> 击球 / 挑高</span><span><kbd>P2：方向键</kbd> 移动 · <kbd>1 / 2</kbd> 击球 / 挑高</span><span><kbd>手柄 1 / 2</kbd> 左摇杆移动 · A 击球 · B 挑高</span>`
      : `<span><kbd>方向键 / WASD</kbd> 移动</span><span><kbd>A / 空格 / J</kbd> 击球 / 高球扣杀</span><span><kbd>B / Shift / K</kbd> 挑高球</span>`;
    updateCharacterSelection();
  }

  function showSelection() {
    phase = "select";
    select.hidden = false;
    result.hidden = true;
    callout.hidden = true;
    restartButton.hidden = true;
    splitHud.hidden = true;
    canvas.parentElement.classList.remove("is-split");
  }

  function beginMatch() {
    const character = TENNIS_CHARACTERS[selectedIndex];
    const opponent = gameMode === "versus" ? TENNIS_CHARACTERS[selectedIndex2] : AI_PLAYER;
    phase = "playing";
    state = createMatchState();
    select.hidden = true;
    result.hidden = true;
    restartButton.hidden = false;
    playerName.textContent = character.name;
    aiName.textContent = opponent.name;
    setVisualColor(playerVisual, character.color);
    setVisualColor(aiVisual, opponent.color);
    splitPlayerOne.textContent = character.name;
    splitPlayerTwo.textContent = opponent.name;
    splitHud.hidden = gameMode !== "versus";
    canvas.parentElement.classList.toggle("is-split", gameMode === "versus");
    resizeCanvas();
    updateScore();
    prepareServe(0);
  }

  function prepareServe(server) {
    state.ball = {
      x: server === 0 ? state.player.x : state.ai.x,
      y: server === 0 ? state.player.y - 0.05 : state.ai.y + 0.05,
      z: 0.18,
      vx: 0,
      vy: 0,
      vz: 0,
      moving: false,
      servePhase: "ready",
      server,
      lastHitter: server,
      bounces: 0
    };
    state.pendingHit = null;
    state.shotBuffers = [null, null];
    syncHeldServeBall();
    state.pointDelay = server === 1 && gameMode === "solo" ? 0.65 : 0;
    announce(server === 0 ? "P1：按 A / F 抛球" : gameMode === "versus" ? "P2：按 A / 1 抛球" : "对手准备发球", 3, server);
  }

  function restartMatch() {
    beginMatch();
  }

  function loop(time) {
    const dt = Math.min((time - lastTime) / 1000, 0.035) || 0;
    lastTime = time;
    const gamepads = readGamepads();
    if (phase === "playing") updateMatch(dt, gamepads);
    if (phase === "select") updateSelectionGamepads(gamepads);
    draw(time / 1000);
    rememberGamepads(gamepads);
    frameId = requestAnimationFrame(loop);
  }

  function updateSelectionGamepads(gamepads) {
    gamepads.forEach((gamepad, side) => {
      if (side === 1 && gameMode !== "versus") return;
      if (gamepad.left && !gamepadPrevious[side].left) {
        selectingSide = side;
        selectCharacter((side === 0 ? selectedIndex : selectedIndex2) - 1);
      }
      if (gamepad.right && !gamepadPrevious[side].right) {
        selectingSide = side;
        selectCharacter((side === 0 ? selectedIndex : selectedIndex2) + 1);
      }
      if (gamepad.a && !gamepadPrevious[side].a) {
        if (gameMode === "versus" && side === 0) selectingSide = 1;
        else beginMatch();
        updateCharacterSelection();
      }
    });
  }

  function updateMatch(dt, gamepads) {
    if (state.hitStop > 0) {
      state.hitStop = Math.max(0, state.hitStop - dt);
      for (const mixer of mixers) mixer.update(dt * 0.15);
      return;
    }
    updateHumanPlayer(0, dt, gamepads[0]);
    if (gameMode === "versus") updateHumanPlayer(1, dt, gamepads[1]);
    else updateAi(dt);

    syncHeldServeBall();
    state.player.swing = Math.max(0, state.player.swing - dt * 3.8);
    state.ai.swing = Math.max(0, state.ai.swing - dt * 3.8);
    state.messageTime = Math.max(0, state.messageTime - dt);
    if (state.impactTrail) {
      state.impactTrail.time -= dt;
      if (state.impactTrail.time <= 0) state.impactTrail = null;
    }
    if (state.messageTime === 0) callout.hidden = true;

    if (state.pointDelay > 0) {
      state.pointDelay -= dt;
      if (state.pointDelay <= 0 && !state.ball.moving && state.ball.server === 1 && gameMode === "solo") tossServe(1);
    }

    for (const mixer of mixers) mixer.update(dt);
    updateLocomotion(playerVisual, state.player.motion, dt);
    updateLocomotion(aiVisual, state.ai.motion, dt);
    updatePendingHit(dt);
    if (state.ball.moving) updateBall(dt);
    updateParticles(dt);
  }

  function updateHumanPlayer(side, dt, gamepad) {
    const actor = side === 0 ? state.player : state.ai;
    const character = TENNIS_CHARACTERS[side === 0 ? selectedIndex : selectedIndex2];
    const keyboardX = side === 0
      ? Number(keys.has("KeyD") || gameMode === "solo" && keys.has("ArrowRight")) - Number(keys.has("KeyA") || gameMode === "solo" && keys.has("ArrowLeft"))
      : Number(keys.has("ArrowRight")) - Number(keys.has("ArrowLeft"));
    const keyboardY = side === 0
      ? Number(keys.has("KeyS") || gameMode === "solo" && keys.has("ArrowDown")) - Number(keys.has("KeyW") || gameMode === "solo" && keys.has("ArrowUp"))
      : Number(keys.has("ArrowDown")) - Number(keys.has("ArrowUp"));
    const dx = Math.abs(gamepad.x) > 0.15 ? gamepad.x : keyboardX;
    const dy = Math.abs(gamepad.y) > 0.15 ? gamepad.y : keyboardY;
    const worldX = side === 0 ? dx : -dx;
    const worldY = side === 0 ? dy : -dy;
    const moveLength = Math.hypot(dx, dy) || 1;
    const moveSpeed = 0.42 + character.speed * 0.0038;
    actor.x = clamp(actor.x + worldX / moveLength * moveSpeed * dt, -0.92, 0.92);
    actor.y = clamp(actor.y + worldY / moveLength * moveSpeed * dt, side === 0 ? 0.12 : -0.94, side === 0 ? 0.94 : -0.12);
    actor.motion = Math.min(1, Math.hypot(dx, dy));
    state.inputs[side].x = clamp(worldX, -1, 1);
    state.inputs[side].y = clamp(worldY, -1, 1);
    updateArcadeAssist(side, dt, moveSpeed);
    updateShotBuffer(side, dt);
    const normalPressed = gamepad.a && !gamepadPrevious[side].a;
    const lobPressed = gamepad.b && !gamepadPrevious[side].b;
    if (normalPressed) requestShot(side, false);
    if (lobPressed) requestShot(side, true);
  }

  function updateAi(dt) {
    const ball = state.ball;
    const targetX = ball.moving && ball.y < 0.25 ? clamp(ball.x, -0.86, 0.86) : 0;
    const targetY = ball.moving && ball.y < -0.05 ? clamp(ball.y - 0.08, -0.9, -0.2) : -0.72;
    const speed = 0.44 + AI_PLAYER.speed * 0.0037;
    const distance = Math.hypot(targetX - state.ai.x, targetY - state.ai.y);
    state.ai.motion = distance > 0.035 ? 1 : 0;
    if (distance > 0.01) {
      state.ai.x += (targetX - state.ai.x) / distance * speed * dt;
      state.ai.y += (targetY - state.ai.y) / distance * speed * dt;
    }
    state.ai.x = clamp(state.ai.x, -0.92, 0.92);
    state.ai.y = clamp(state.ai.y, -0.94, -0.12);

    const reach = 0.2 + AI_PLAYER.reach * 0.0016;
    const strikeDistance = Math.hypot(ball.x - state.ai.x, ball.y - state.ai.y);
    if (!state.pendingHit && ball.servePhase === "toss" && ball.server === 1 && ball.vz <= 0.12) {
      queueHit(1, "serve");
    } else if (!state.pendingHit && ball.moving && !ball.servePhase && ball.lastHitter === 0 && ball.y < -0.06 && ball.z < 1.25 && strikeDistance < reach + (ball.z > 0.68 ? 0.12 : 0)) {
      queueHit(1, ball.z > 0.68 ? "smash" : (Math.random() < 0.14 ? "lob" : "drive"));
    }
  }

  function requestShot(side, lob) {
    const ball = state.ball;
    if (!ball.moving && ball.server === side) {
      tossServe(side);
      return;
    }
    if (ball.servePhase === "toss" && ball.server === side) {
      if (ball.z < 0.55) {
        announce("再等一下，等球升高", 0.6);
        return;
      }
      queueHit(side, "serve");
      return;
    }
    if (isIncomingBall(side)) {
      state.shotBuffers[side] = { lob, time: 0.24 };
      updateShotBuffer(side, 0);
      return;
    }
    playMissedSwing(side, lob);
  }

  function isIncomingBall(side) {
    const ball = state.ball;
    const movingTowardSide = side === 0 ? ball.vy > 0 : ball.vy < 0;
    return ball.moving && !ball.servePhase && ball.lastHitter !== side && movingTowardSide;
  }

  function predictBallAt(time) {
    const ball = state.ball;
    return {
      x: ball.x + ball.vx * time,
      y: ball.y + ball.vy * time,
      z: ball.z + ball.vz * time - 0.5 * BALL_GRAVITY * time * time
    };
  }

  function findContactCandidate(side, horizon = 0.24) {
    if (!isIncomingBall(side)) return null;
    const actor = side === 0 ? state.player : state.ai;
    let best = null;
    for (let time = 0; time <= horizon + 0.001; time += 0.03) {
      const point = predictBallAt(time);
      const onSide = side === 0 ? point.y > 0.02 : point.y < -0.02;
      if (!onSide || point.z < 0.02 || point.z > 1.32) continue;
      const distance = Math.hypot(point.x - actor.x, point.y - actor.y);
      if (!best || distance < best.distance) best = { ...point, time, distance };
    }
    return best;
  }

  function updateArcadeAssist(side, dt, moveSpeed) {
    const candidate = findContactCandidate(side, 0.28);
    if (!candidate || candidate.time > 0.25) return;
    const actor = side === 0 ? state.player : state.ai;
    const hitter = TENNIS_CHARACTERS[side === 0 ? selectedIndex : selectedIndex2];
    const reach = 0.18 + hitter.reach * 0.002;
    if (candidate.distance > reach + 0.2) return;
    const targetY = candidate.y + (side === 0 ? 0.055 : -0.055);
    const deltaX = candidate.x - actor.x;
    const deltaY = targetY - actor.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < 0.001) return;
    const assistSpeed = moveSpeed * (state.shotBuffers[side] ? 0.72 : 0.38);
    const step = Math.min(distance, assistSpeed * dt);
    actor.x = clamp(actor.x + deltaX / distance * step, -0.92, 0.92);
    actor.y = clamp(actor.y + deltaY / distance * step, side === 0 ? 0.12 : -0.94, side === 0 ? 0.94 : -0.12);
    actor.motion = Math.max(actor.motion, step > 0 ? 0.45 : 0);
  }

  function updateShotBuffer(side, dt) {
    const buffer = state.shotBuffers[side];
    if (!buffer) return;
    buffer.time -= dt;
    const hitter = TENNIS_CHARACTERS[side === 0 ? selectedIndex : selectedIndex2];
    const reach = 0.18 + hitter.reach * 0.002;
    const candidate = findContactCandidate(side, 0.22);
    if (candidate && candidate.distance <= reach + 0.09) {
      const quality = candidate.distance <= reach * 0.58 ? "perfect" : candidate.distance <= reach * 0.86 ? "good" : "stretch";
      const smash = !buffer.lob && candidate.z > 0.68;
      state.shotBuffers[side] = null;
      queueHit(side, smash ? "smash" : (buffer.lob ? "lob" : "drive"), quality, clamp(candidate.time, 0.08, 0.2));
    } else if (buffer.time <= 0) {
      state.shotBuffers[side] = null;
      playMissedSwing(side, buffer.lob);
    }
  }

  function playMissedSwing(side, lob) {
    const actor = side === 0 ? state.player : state.ai;
    actor.swing = 0.75;
    actor.lob = lob;
    playVisualAction(side, lob ? "lob" : "drive");
  }

  function tossServe(side) {
    syncHeldServeBall();
    const visual = side === 0 ? playerVisual : aiVisual;
    const hand = visual?.root.getObjectByName("hand_l");
    if (hand) {
      visual.root.updateMatrixWorld(true);
      const world = hand.getWorldPosition(new THREE.Vector3());
      state.ball.x = clamp(world.x / 5.1, -0.96, 0.96);
      state.ball.y = clamp(world.z / 9.5, -0.96, 0.96);
      state.ball.z = clamp((world.y - 0.12) / 3.25, 0.3, 0.72);
    }
    state.ball.vx = 0;
    state.ball.vy = 0;
    state.ball.vz = 1.72;
    state.ball.moving = true;
    state.ball.servePhase = "toss";
    state.ball.bounces = 0;
    announce(side === 0 ? "P1 球已抛起 · 再按 A / F 发球" : gameMode === "versus" ? "P2 球已抛起 · 再按 A / 1 发球" : "对手抛球", 1.3, side);
  }

  function syncHeldServeBall() {
    const ball = state.ball;
    if (ball.moving || ball.servePhase !== "ready") return;
    const actor = ball.server === 0 ? state.player : state.ai;
    ball.x = actor.x + (ball.server === 0 ? -0.13 : 0.13);
    ball.y = actor.y;
    ball.z = 0.48;
  }

  function queueHit(side, shot = "drive", quality = "good", contactDelay = null) {
    if (state.pendingHit) return;
    state.pendingHit = {
      side,
      shot,
      quality,
      delay: contactDelay ?? (shot === "serve" ? 0.48 : shot === "smash" ? 0.26 : 0.22),
      aimX: side === 0 || gameMode === "versus" ? state.inputs[side].x : 0,
      aimY: side === 0 || gameMode === "versus" ? state.inputs[side].y : 0
    };
    const actor = side === 0 ? state.player : state.ai;
    actor.swing = 1;
    actor.lob = shot === "lob";
    actor.smash = shot === "smash";
    playVisualAction(side, shot);
  }

  function updatePendingHit(dt) {
    if (!state.pendingHit) return;
    state.pendingHit.delay -= dt;
    if (state.pendingHit.delay > 0) return;
    const pending = state.pendingHit;
    state.pendingHit = null;
    launchBall(pending.side, pending.shot, pending.aimX, pending.aimY, pending.quality);
  }

  function launchBall(side, shot = "drive", aimX = 0, aimY = 0, quality = "good") {
    const hitter = side === 0 ? TENNIS_CHARACTERS[selectedIndex] : gameMode === "versus" ? TENNIS_CHARACTERS[selectedIndex2] : AI_PLAYER;
    const actor = side === 0 ? state.player : state.ai;
    const direction = side === 0 ? -1 : 1;
    const control = hitter.control / 100;
    const power = hitter.power / 100;
    const humanControlled = side === 0 || gameMode === "versus";
    const opponent = side === 0 ? state.ai : state.player;
    const naturalTargetX = humanControlled
      ? clamp(state.ball.x + state.ball.vx * 0.12, -0.72, 0.72)
      : clamp(state.player.x * 0.5 + (Math.random() - 0.5) * (1 - control) * 0.35, -0.72, 0.72);
    const aimedTargetX = Math.abs(aimX) > 0.22 ? Math.sign(aimX) * 0.72 : -opponent.x * 0.42;
    const qualityControl = quality === "perfect" ? 1 : quality === "stretch" ? 0.58 : 0.82;
    const directionAuthority = humanControlled ? (0.2 + control * 0.5) * qualityControl : 0;
    const targetX = clamp(
      humanControlled ? naturalTargetX * (1 - directionAuthority) + aimedTargetX * directionAuthority : naturalTargetX,
      -0.78,
      0.78
    );
    const baseDepth = shot === "smash" ? 0.62 : shot === "lob" ? 0.78 : 0.72;
    const depthIntent = Math.abs(aimY) > 0.22 ? Math.sign(aimY) : 0;
    const targetDepth = humanControlled ? clamp(baseDepth - direction * depthIntent * 0.14, 0.54, 0.88) : baseDepth;
    const targetY = direction * targetDepth;
    state.lastTarget = { x: targetX, y: targetY, side };
    const qualityTime = quality === "perfect" ? 0.93 : quality === "stretch" ? 1.1 : 1;
    const flightTime = (shot === "lob" ? 1.52 : shot === "smash" ? 0.72 : shot === "serve" ? 1.02 : 1.08 - power * 0.1) * qualityTime;
    const contact = getRacketContact(side, actor);
    state.lastContact = { ...contact, side, shot };
    state.impactTrail = { time: 0.22, from: { ...contact } };
    state.ball.x = contact.x;
    state.ball.y = contact.y;
    state.ball.z = contact.z;
    state.ball.vx = (targetX - state.ball.x) / flightTime;
    state.ball.vy = (targetY - state.ball.y) / flightTime;
    state.ball.vz = (0.03 - state.ball.z + 0.5 * BALL_GRAVITY * flightTime * flightTime) / flightTime;
    state.ball.moving = true;
    state.ball.servePhase = null;
    state.ball.lastHitter = side;
    state.ball.bounces = 0;
    state.lastShot = shot;
    state.lastHitQuality = quality;
    if (shot !== "serve") state.rallyHits += 1;
    state.hitStop = quality === "perfect" ? 0.05 : 0.032;
    burst(state.ball.x, state.ball.y, quality === "perfect" ? "#f8ffba" : hitter.color);
    pulseGamepad(side, quality);
    if (quality === "perfect" && shot === "drive") announce("完美击球", 0.38, side);
    if (shot === "serve") announce("发球！", 0.55);
    if (shot === "lob") announce("挑高球！对手可以扣杀", 0.65);
    if (shot === "smash") announce("扣杀！", 0.65);
  }

  function pulseGamepad(side, quality) {
    const pad = navigator.getGamepads?.()?.[side];
    const actuator = pad?.vibrationActuator;
    if (!actuator?.playEffect) return;
    actuator.playEffect("dual-rumble", {
      duration: quality === "perfect" ? 85 : 55,
      strongMagnitude: quality === "perfect" ? 0.72 : 0.42,
      weakMagnitude: quality === "perfect" ? 0.48 : 0.26
    }).catch(() => {});
  }

  function getRacketContact(side, actor) {
    const visual = side === 0 ? playerVisual : aiVisual;
    const face = visual?.racket?.userData?.face;
    if (!face) return { x: actor.x, y: actor.y + (side === 0 ? -0.06 : 0.06), z: 0.42 };
    visual.root.updateMatrixWorld(true);
    const world = face.getWorldPosition(new THREE.Vector3());
    return {
      x: clamp(world.x / 5.1, -0.96, 0.96),
      y: clamp(world.z / 9.5, -0.96, 0.96),
      z: clamp((world.y - 0.12) / 3.25, 0.2, 1.2)
    };
  }

  function updateBall(dt) {
    const ball = state.ball;
    const previousY = ball.y;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.z += ball.vz * dt;
    ball.vz -= BALL_GRAVITY * dt;

    if (ball.servePhase === "toss") {
      if (ball.z <= 0.16 && ball.vz < 0) {
        ball.moving = false;
        prepareServe(ball.server);
        announce(ball.server === 0 ? "抛球落地，重新发球" : "对手重新发球", 1);
      }
      return;
    }

    if ((previousY < 0) !== (ball.y < 0) && ball.z < 0.29) {
      awardPoint(ball.lastHitter === 0 ? 1 : 0, "下网");
      return;
    }

    if (ball.z <= 0.03) {
      ball.z = 0.03;
      const inCourt = Math.abs(ball.x) <= 1 && Math.abs(ball.y) <= 1;
      if (!inCourt) {
        const winner = ball.bounces === 0 ? 1 - ball.lastHitter : ball.lastHitter;
        awardPoint(winner, ball.bounces === 0 ? "出界" : "制胜分");
        return;
      }
      ball.bounces += 1;
      state.lastLanding = { x: ball.x, y: ball.y, hitter: ball.lastHitter };
      if (ball.bounces >= 2) {
        awardPoint(ball.y > 0 ? 1 : 0, "二次落地");
        return;
      }
      ball.vz = Math.max(0.62, Math.abs(ball.vz) * 0.66);
      ball.vx *= 0.88;
      ball.vy *= 0.91;
      burst(ball.x, ball.y, "#dfff38");
    }
  }

  function awardPoint(winner, reason) {
    if (!state.ball.moving) return;
    state.pendingHit = null;
    state.ball.moving = false;
    state.score[winner] += 1;
    updateScore();
    const winnerName = winner === 0 ? TENNIS_CHARACTERS[selectedIndex].name : gameMode === "versus" ? TENNIS_CHARACTERS[selectedIndex2].name : AI_PLAYER.name;
    announce(`${winnerName} · ${reason}`, 2);
    if (state.score[winner] >= 7 && state.score[winner] - state.score[1 - winner] >= 2) {
      finishMatch(winner);
      return;
    }
    const nextServer = (state.score[0] + state.score[1]) % 2;
    state.pointDelay = 1.25;
    setTimeout(() => {
      if (phase === "playing" && !state.ball.moving) prepareServe(nextServer);
    }, 900);
  }

  function finishMatch(winner) {
    phase = "result";
    restartButton.hidden = true;
    callout.hidden = true;
    splitHud.hidden = true;
    canvas.parentElement.classList.remove("is-split");
    resizeCanvas();
    result.hidden = false;
    if (gameMode === "versus") {
      const winnerName = TENNIS_CHARACTERS[winner === 0 ? selectedIndex : selectedIndex2].name;
      resultTitle.textContent = `${winnerName} 获胜`;
      resultCopy.textContent = `P${winner + 1} 拿下了这场城市球场对决`;
    } else {
      resultTitle.textContent = winner === 0 ? "城市之王" : "再战一局";
      resultCopy.textContent = winner === 0 ? "你拿下了这片铁笼球场" : "铁壁守住了主场，下次打穿他";
    }
  }

  function updateScore() {
    playerScore.textContent = String(state.score[0]);
    aiScore.textContent = String(state.score[1]);
  }

  function announce(message, duration, side = null) {
    callout.textContent = message;
    callout.dataset.side = side === null ? "" : String(side);
    callout.hidden = false;
    state.messageTime = duration;
  }

  function burst(x, y, color) {
    for (let i = 0; i < 7; i += 1) {
      state.particles.push({ x, y, life: 1, color, dx: (Math.random() - 0.5) * 0.45, dy: (Math.random() - 0.5) * 0.25 });
    }
  }

  function updateParticles(dt) {
    state.particles = state.particles.filter((particle) => {
      particle.life -= dt * 2.6;
      particle.x += particle.dx * dt;
      particle.y += particle.dy * dt;
      return particle.life > 0;
    });
  }

  function readGamepad(pad) {
    const axisX = pad?.axes?.[0] ?? 0;
    const axisY = pad?.axes?.[1] ?? 0;
    return {
      x: (pad?.buttons?.[15]?.pressed ? 1 : 0) - (pad?.buttons?.[14]?.pressed ? 1 : 0) || axisX,
      y: (pad?.buttons?.[13]?.pressed ? 1 : 0) - (pad?.buttons?.[12]?.pressed ? 1 : 0) || axisY,
      a: Boolean(pad?.buttons?.[0]?.pressed),
      b: Boolean(pad?.buttons?.[1]?.pressed),
      left: Boolean(pad?.buttons?.[14]?.pressed) || axisX < -0.55,
      right: Boolean(pad?.buttons?.[15]?.pressed) || axisX > 0.55
    };
  }

  function readGamepads() {
    const pads = navigator.getGamepads?.() ?? [];
    return [readGamepad(pads[0]), readGamepad(pads[1])];
  }

  function rememberGamepads(gamepads) {
    gamepadPrevious = gamepads.map((gamepad) => ({ a: gamepad.a, b: gamepad.b, left: gamepad.left, right: gamepad.right }));
  }

  function handleKeyDown(event) {
    const controlled = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyF", "KeyG", "KeyJ", "KeyK", "Digit1", "Digit2", "Numpad1", "Numpad2", "ShiftLeft", "ShiftRight", "Enter"];
    if (!controlled.includes(event.code)) return;
    event.preventDefault();
    if (event.repeat && ["Space", "KeyF", "KeyG", "KeyJ", "KeyK", "Digit1", "Digit2", "Numpad1", "Numpad2", "ShiftLeft", "ShiftRight", "Enter"].includes(event.code)) return;
    keys.add(event.code);
    if (phase === "select") {
      if (["KeyA", "ArrowLeft"].includes(event.code)) selectCharacter((selectingSide === 0 ? selectedIndex : selectedIndex2) - 1);
      if (["KeyD", "ArrowRight"].includes(event.code)) selectCharacter((selectingSide === 0 ? selectedIndex : selectedIndex2) + 1);
      if (["Enter", "Space"].includes(event.code)) beginMatch();
    } else if (phase === "playing") {
      if (gameMode === "versus") {
        if (event.code === "KeyF") requestShot(0, false);
        if (event.code === "KeyG") requestShot(0, true);
        if (["Digit1", "Numpad1"].includes(event.code)) requestShot(1, false);
        if (["Digit2", "Numpad2"].includes(event.code)) requestShot(1, true);
      } else {
        if (["Space", "KeyJ", "KeyF"].includes(event.code)) requestShot(0, false);
        if (["KeyK", "KeyG", "ShiftLeft", "ShiftRight"].includes(event.code)) requestShot(0, true);
      }
    }
  }

  function handleKeyUp(event) {
    keys.delete(event.code);
  }

  function handleBlur() {
    keys.clear();
  }

  function addListeners() {
    if (listening) return;
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("resize", resizeCanvas);
    startButton.addEventListener("click", beginMatch);
    restartButton.addEventListener("click", restartMatch);
    rematchButton.addEventListener("click", beginMatch);
    reselectButton.addEventListener("click", showSelection);
    soloModeButton.addEventListener("click", selectSoloMode);
    versusModeButton.addEventListener("click", selectVersusMode);
    playerOneSlot.addEventListener("click", selectPlayerOneSlot);
    playerTwoSlot.addEventListener("click", selectPlayerTwoSlot);
    listening = true;
  }

  function removeListeners() {
    if (!listening) return;
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    window.removeEventListener("blur", handleBlur);
    window.removeEventListener("resize", resizeCanvas);
    startButton.removeEventListener("click", beginMatch);
    restartButton.removeEventListener("click", restartMatch);
    rematchButton.removeEventListener("click", beginMatch);
    reselectButton.removeEventListener("click", showSelection);
    soloModeButton.removeEventListener("click", selectSoloMode);
    versusModeButton.removeEventListener("click", selectVersusMode);
    playerOneSlot.removeEventListener("click", selectPlayerOneSlot);
    playerTwoSlot.removeEventListener("click", selectPlayerTwoSlot);
    listening = false;
  }

  function selectPlayerOneSlot() {
    selectingSide = 0;
    updateCharacterSelection();
  }

  function selectSoloMode() {
    setGameMode("solo");
  }

  function selectVersusMode() {
    setGameMode("versus");
  }

  function selectPlayerTwoSlot() {
    selectingSide = 1;
    updateCharacterSelection();
  }

  function setupThreeScene() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb9d3cc);
    scene.fog = new THREE.Fog(0xb9d3cc, 24, 49);
    camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 80);
    camera.position.set(0, 12.4, 18.8);
    camera.lookAt(0, 0.45, -1.5);
    opponentCamera = new THREE.PerspectiveCamera(42, 8 / 9, 0.1, 80);
    opponentCamera.position.set(0, 12.4, -18.8);
    opponentCamera.lookAt(0, 0.45, 1.5);

    scene.add(new THREE.HemisphereLight(0xffefca, 0x3a4c45, 2.2));
    const sun = new THREE.DirectionalLight(0xffd9a1, 3.5);
    sun.position.set(-7, 15, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 15; sun.shadow.camera.bottom = -15;
    scene.add(sun);
    buildCourtScene();
  }

  function buildCourtScene() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(32, 45), new THREE.MeshStandardMaterial({ color: 0x758f87, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.035;
    ground.receiveShadow = true;
    scene.add(ground);

    const court = new THREE.Mesh(new THREE.PlaneGeometry(11, 23.8), new THREE.MeshStandardMaterial({ color: 0xb95445, roughness: 0.94 }));
    court.rotation.x = -Math.PI / 2;
    court.receiveShadow = true;
    scene.add(court);

    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xfff4dd });
    const line = (x, z, width, depth) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.018, depth), lineMaterial);
      mesh.position.set(x, 0.012, z);
      scene.add(mesh);
      return mesh;
    };
    line(0, -11.85, 11, 0.07); line(0, 11.85, 11, 0.07);
    line(-5.5, 0, 0.07, 23.8); line(5.5, 0, 0.07, 23.8);
    line(-4.1, 0, 0.06, 23.8); line(4.1, 0, 0.06, 23.8);
    line(0, -6.2, 8.2, 0.06); line(0, 6.2, 8.2, 0.06); line(0, 0, 0.06, 12.4);

    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x28483e, roughness: 0.78 });
    for (const x of [-6.05, 6.05]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1.25, 10), postMaterial);
      post.position.set(x, 0.62, 0);
      post.castShadow = true;
      scene.add(post);
    }
    const net = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.03, 24, 4), new THREE.MeshBasicMaterial({ color: 0x172a24, wireframe: true, transparent: true, opacity: 0.72, side: THREE.DoubleSide }));
    net.position.set(0, 0.58, 0);
    scene.add(net);
    const netTape = line(0, 0, 12.2, 0.045);
    netTape.position.y = 1.1;

    buildPerimeterFence();
    buildCityBackdrop();

    ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 12), new THREE.MeshStandardMaterial({ color: 0xdfff38, emissive: 0x536600, emissiveIntensity: 0.5, roughness: 0.7 }));
    ballMesh.castShadow = true;
    scene.add(ballMesh);
    ballTrail = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xeaff74, transparent: true, opacity: 0.8 })
    );
    ballTrail.visible = false;
    scene.add(ballTrail);
  }

  function buildPerimeterFence() {
    const material = new THREE.LineBasicMaterial({ color: 0xdfe8dc, transparent: true, opacity: 0.34 });
    const addGrid = (x, z, width, height, rotationY = 0) => {
      const points = [];
      for (let offset = -width / 2; offset <= width / 2 + 0.01; offset += 0.55) points.push(new THREE.Vector3(offset, 0, 0), new THREE.Vector3(offset, height, 0));
      for (let y = 0; y <= height + 0.01; y += 0.55) points.push(new THREE.Vector3(-width / 2, y, 0), new THREE.Vector3(width / 2, y, 0));
      const grid = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), material);
      grid.position.set(x, 0, z);
      grid.rotation.y = rotationY;
      scene.add(grid);
    };
    addGrid(-7.1, 0, 29, 4.2, Math.PI / 2);
    addGrid(7.1, 0, 29, 4.2, Math.PI / 2);
    addGrid(0, -14.3, 14.2, 4.2);
  }

  function buildCityBackdrop() {
    const colors = [0x754f41, 0xc18d59, 0x8b4b3d, 0xd0a56d, 0x69483e];
    for (let index = 0; index < 11; index += 1) {
      const width = 3.8 + index % 3;
      const height = 7 + (index * 1.7) % 8;
      const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, 4), new THREE.MeshStandardMaterial({ color: colors[index % colors.length], roughness: 1 }));
      building.position.set(-24 + index * 4.8, height / 2 - 0.3, -24 - (index % 2) * 2.5);
      building.receiveShadow = true;
      scene.add(building);
      const windows = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.72, height * 0.72), new THREE.MeshBasicMaterial({ color: 0xe7bc79, transparent: true, opacity: 0.32 }));
      windows.position.set(building.position.x, building.position.y, building.position.z + 2.01);
      scene.add(windows);
    }
  }

  async function loadPlayerModels() {
    const gltf = await new GLTFLoader().loadAsync("./assets/tennis/models/ual2-standard.glb");
    playerVisual = createPlayerVisual(gltf, TENNIS_CHARACTERS[selectedIndex].color, false);
    aiVisual = createPlayerVisual(gltf, AI_PLAYER.color, true);
  }

  function createPlayerVisual(gltf, color, farSide) {
    const root = cloneSkeleton(gltf.scene);
    root.scale.setScalar(1.03);
    root.rotation.y = farSide ? 0 : Math.PI;
    root.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.material = object.material.clone();
      if (object.material.name === "M_Main") object.material.color.set(color);
    });
    scene.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const clips = Object.fromEntries(gltf.animations.map((clip) => [clip.name, clip]));
    const actions = {
      idle: mixer.clipAction(clips.Idle_No_Loop),
      walk: mixer.clipAction(clips.Walk_Carry_Loop),
      drive: mixer.clipAction(clips.Sword_Regular_A),
      lob: mixer.clipAction(clips.Sword_Regular_B),
      smash: mixer.clipAction(clips.Sword_Regular_C),
      serve: mixer.clipAction(clips.OverhandThrow)
    };
    actions.idle.setLoop(THREE.LoopRepeat).play();
    actions.idle.time = 0.2;
    actions.walk.setLoop(THREE.LoopRepeat).play();
    actions.walk.setEffectiveWeight(0);
    actions.walk.timeScale = 1.45;
    for (const action of [actions.drive, actions.lob, actions.smash, actions.serve]) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = false;
    }
    const racket = createRacket();
    const hand = root.getObjectByName("hand_r");
    if (hand) {
      hand.add(racket);
      racket.position.set(0, 0.05, 0);
      racket.rotation.set(0, 0, 0);
      racket.scale.setScalar(0.72);
    } else {
      scene.add(racket);
    }
    const visual = { root, mixer, actions, racket, racketAttached: Boolean(hand), walkWeight: 0, strikeTime: 0 };
    mixers.push(mixer);
    return visual;
  }

  function createRacket() {
    const group = new THREE.Group();
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x202b28, roughness: 0.5 });
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.035, 8, 22), frameMaterial);
    frame.scale.y = 1.35;
    frame.position.y = 0.72;
    group.userData.face = frame;
    group.add(frame);
    const strings = new THREE.Mesh(new THREE.CircleGeometry(0.27, 20), new THREE.MeshBasicMaterial({ color: 0xd9ece2, wireframe: true, transparent: true, opacity: 0.65, side: THREE.DoubleSide }));
    strings.scale.y = 1.35;
    strings.position.y = 0.72;
    group.add(strings);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.62, 8), frameMaterial);
    handle.position.y = 0.2;
    group.add(handle);
    return group;
  }

  function setVisualColor(visual, color) {
    visual?.root.traverse((object) => {
      if (object.isMesh && object.material.name === "M_Main") object.material.color.set(color);
    });
  }

  function playVisualAction(side, shot) {
    const visual = side === 0 ? playerVisual : aiVisual;
    if (!visual?.actions?.[shot]) return;
    for (const name of ["drive", "lob", "smash", "serve"]) visual.actions[name].stop();
    visual.strikeTime = shot === "serve" ? 1.05 : 0.62;
    visual.actions[shot].reset().setEffectiveWeight(1).fadeIn(0.06).play();
    setTimeout(() => {
      if (phase === "playing") visual.actions[shot].fadeOut(0.12);
    }, shot === "serve" ? 930 : 520);
  }

  function updateLocomotion(visual, motion, dt) {
    if (!visual) return;
    visual.strikeTime = Math.max(0, visual.strikeTime - dt);
    const target = motion > 0.12 ? 1 : 0;
    visual.walkWeight += (target - visual.walkWeight) * Math.min(1, dt * 9);
    const baseWeight = visual.strikeTime > 0 ? 0.08 : 1;
    visual.actions.walk.setEffectiveWeight(visual.walkWeight * baseWeight);
    visual.actions.idle.setEffectiveWeight((1 - visual.walkWeight * 0.72) * baseWeight);
  }

  function resizeCanvas() {
    if (!renderer || !camera) return;
    const rect = canvas.getBoundingClientRect();
    renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    const split = phase === "playing" && gameMode === "versus";
    camera.fov = split ? 48 : 42;
    camera.position.set(0, split ? 15.2 : 12.4, split ? 24.5 : 18.8);
    camera.lookAt(0, split ? 0.25 : 0.45, split ? 0 : -1.5);
    camera.aspect = Math.max(1, split ? rect.width / 2 : rect.width) / Math.max(1, rect.height);
    camera.updateProjectionMatrix();
    opponentCamera.fov = 48;
    opponentCamera.position.set(0, 15.2, -24.5);
    opponentCamera.lookAt(0, 0.25, 0);
    opponentCamera.aspect = Math.max(1, rect.width / 2) / Math.max(1, rect.height);
    opponentCamera.updateProjectionMatrix();
  }

  function draw() {
    if (!renderer || !scene || !playerVisual || !aiVisual) return;
    syncPlayerVisual(playerVisual, state.player, false);
    syncPlayerVisual(aiVisual, state.ai, true);
    if (!state.ball.moving && state.ball.servePhase === "ready") {
      const serverVisual = state.ball.server === 0 ? playerVisual : aiVisual;
      serverVisual.root.updateMatrixWorld(true);
      const hand = serverVisual.root.getObjectByName("hand_l");
      if (hand) ballMesh.position.copy(hand.getWorldPosition(new THREE.Vector3()));
      else ballMesh.position.set(state.ball.x * 5.1, 0.12 + state.ball.z * 3.25, state.ball.y * 9.5);
    } else {
      ballMesh.position.set(state.ball.x * 5.1, 0.12 + state.ball.z * 3.25, state.ball.y * 9.5);
    }
    if (state.impactTrail) {
      const positions = ballTrail.geometry.attributes.position;
      positions.setXYZ(0, state.impactTrail.from.x * 5.1, 0.12 + state.impactTrail.from.z * 3.25, state.impactTrail.from.y * 9.5);
      positions.setXYZ(1, ballMesh.position.x, ballMesh.position.y, ballMesh.position.z);
      positions.needsUpdate = true;
      ballTrail.material.opacity = state.impactTrail.time / 0.22 * 0.8;
      ballTrail.visible = true;
    } else {
      ballTrail.visible = false;
    }
    if (phase === "playing" && gameMode === "versus") {
      const size = renderer.getSize(new THREE.Vector2());
      const halfWidth = Math.floor(size.x / 2);
      renderer.setScissorTest(true);
      renderer.setViewport(0, 0, halfWidth, size.y);
      renderer.setScissor(0, 0, halfWidth, size.y);
      renderer.render(scene, camera);
      renderer.setViewport(halfWidth, 0, size.x - halfWidth, size.y);
      renderer.setScissor(halfWidth, 0, size.x - halfWidth, size.y);
      renderer.render(scene, opponentCamera);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.x, size.y);
    } else {
      renderer.render(scene, camera);
    }
  }

  function syncPlayerVisual(visual, actor, farSide) {
    const x = actor.x * 5.1;
    const z = actor.y * 9.5;
    visual.root.position.set(x, 0, z);
    if (!visual.racketAttached) {
      visual.racket.position.set(x + (farSide ? -0.48 : 0.48), 1.02, z);
      visual.racket.rotation.set(Math.PI / 2, 0, farSide ? -0.35 : 0.35);
    }
  }

  function exposeDebug() {
    window.__ackGamesDebug = window.__ackGamesDebug || {};
    window.__ackGamesDebug.tennis = Object.freeze({
      getState: () => ({
        phase,
        mode: gameMode,
        selectedCharacter: TENNIS_CHARACTERS[selectedIndex].id,
        selectedOpponent: gameMode === "versus" ? TENNIS_CHARACTERS[selectedIndex2].id : "ai",
        score: [...state.score],
        ballMoving: state.ball.moving,
        servePhase: state.ball.servePhase,
        server: state.ball.server,
        ball: { x: state.ball.x, y: state.ball.y, z: state.ball.z, vx: state.ball.vx, vy: state.ball.vy, vz: state.ball.vz, lastHitter: state.ball.lastHitter, bounces: state.ball.bounces },
        player: { x: state.player.x, y: state.player.y, motion: state.player.motion },
        opponent: { x: state.ai.x, y: state.ai.y, motion: state.ai.motion },
        animation: {
          playerServe: Boolean(playerVisual?.actions.serve.isRunning()),
          playerWalkWeight: playerVisual?.walkWeight ?? 0,
          opponentServe: Boolean(aiVisual?.actions.serve.isRunning()),
          opponentWalkWeight: aiVisual?.walkWeight ?? 0
        },
        lastShot: state.lastShot,
        lastHitQuality: state.lastHitQuality,
        rallyHits: state.rallyHits,
        shotBuffered: state.shotBuffers.map(Boolean),
        lastTarget: state.lastTarget ? { ...state.lastTarget } : null,
        lastContact: state.lastContact ? { ...state.lastContact } : null,
        lastLanding: state.lastLanding ? { ...state.lastLanding } : null
      }),
      selectCharacter,
      beginMatch,
      playShot: (side, shot) => queueHit(side, shot)
    });
  }

  return Object.freeze({ start, stop, destroy: stop });
}
