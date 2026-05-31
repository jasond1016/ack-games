import * as THREE from "three";

export function createRacingGame() {
  const canvas = document.getElementById("racingCanvas");
  const lapValue = document.getElementById("racingLapValue");
  const placeValue = document.getElementById("racingPlaceValue");
  const speedValue = document.getElementById("racingSpeedValue");
  const boostValue = document.getElementById("racingBoostValue");
  const statusValue = document.getElementById("racingStatusValue");
  const resetButton = document.getElementById("racingResetButton");
  const resultOverlay = document.getElementById("racingResultOverlay");
  const resultCard = document.getElementById("racingResultCard");
  const confetti = document.getElementById("racingConfetti");
  const resultTag = document.getElementById("racingResultTag");
  const resultTitle = document.getElementById("racingResultTitle");
  const resultSummary = document.getElementById("racingResultSummary");
  const resultPlayerLaps = document.getElementById("racingResultPlayerLaps");
  const resultOpponentLaps = document.getElementById("racingResultOpponentLaps");
  const playAgainButton = document.getElementById("racingPlayAgainButton");

  const raceConfig = {
    totalLaps: 3,
    startProgress: 0.02,
    lapThreshold: 0.16,
    lapCooldownSeconds: 0.72,
    minForwardTrackSpeed: 2.2,
    lapArmProgressMin: 0.16,
    lapArmProgressMax: 0.84
  };

  const boostConfig = {
    charges: 3,
    durationSeconds: 5,
    topSpeedMultiplier: 2,
    engineForceMultiplier: 2.15
  };

  const trackConfig = {
    width: 14,
    samples: 520,
    controlPoints: [
      [-78, -54],
      [-28, -70],
      [38, -66],
      [84, -36],
      [70, 8],
      [30, 18],
      [78, 52],
      [26, 76],
      [-52, 66],
      [-92, 24],
      [-48, 0],
      [-90, -30]
    ]
  };

  const carConfig = {
    maxForwardSpeed: 44,
    maxReverseSpeed: 11,
    engineForce: 31,
    brakeForce: 44,
    reverseForce: 15,
    drag: 0.032,
    rollingResistance: 0.82,
    roadGrip: 8.4,
    grassGrip: 2.9,
    maxSteerRate: 1.55
  };

  const collisionConfig = {
    roadLimit: trackConfig.width / 2 - 0.3,
    railLimit: trackConfig.width / 2 + 1.0,
    stopSeconds: 1.1
  };

  const opponentConfig = {
    speed: Math.min(8.2, 30 / 3.6),
    laneOffset: -2.7,
    startProgress: raceConfig.startProgress
  };

  const keyState = new Set();
  const trackCurve = createTrackCurve();
  const trackSamples = createTrackSamples();
  const trackLength = measureTrackLength();
  const state = {
    position: new THREE.Vector2(),
    velocity: new THREE.Vector2(),
    heading: 0,
    steering: 0,
    throttle: 0,
    brake: 0,
    onRoad: true,
    stoppedByImpactSeconds: 0,
    trackIndex: 0,
    trackProgress: raceConfig.startProgress,
    raceProgress: 0,
    lastRaceProgress: 0,
    completedLaps: 0,
    lapLockSeconds: 0,
    lapArmed: false,
    boostSeconds: 0,
    boostCharges: boostConfig.charges
  };
  const opponentState = {
    progress: opponentConfig.startProgress,
    raceProgress: 0,
    lastRaceProgress: 0,
    completedLaps: 0,
    lapLockSeconds: 0,
    lapArmed: false
  };
  const raceState = {
    finished: false,
    winner: "",
    playerPlace: 1
  };

  let renderer;
  let scene;
  let camera;
  let car;
  let opponentCar;
  let initialized = false;
  let active = false;
  let listening = false;
  let animationFrameId = 0;
  let lastFrameTime = 0;

  function start() {
    initializeScene();
    prepareConfetti();
    keyState.clear();
    resetRace();
    addListeners();
    resizeRenderer();
    active = true;
    lastFrameTime = performance.now();

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }

    animationFrameId = requestAnimationFrame(loop);
  }

  function stop() {
    active = false;
    keyState.clear();
    removeListeners();

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }
  }

  function initializeScene() {
    if (initialized) return;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x9fc9f3);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fc9f3);
    scene.fog = new THREE.Fog(0x9fc9f3, 150, 260);

    camera = new THREE.PerspectiveCamera(58, 1, 0.1, 500);

    createLights();
    createWorld();

    car = createCar();
    opponentCar = createCar(0x1f4fa3);
    scene.add(car);
    scene.add(opponentCar);

    initialized = true;
  }

  function createLights() {
    const hemisphere = new THREE.HemisphereLight(0xb9dcff, 0x587044, 1.5);
    scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(0xfff0d0, 2.8);
    sun.position.set(-55, 82, 42);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.left = -120;
    sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120;
    sun.shadow.camera.bottom = -120;
    scene.add(sun);
  }

  function createWorld() {
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(270, 230),
      new THREE.MeshStandardMaterial({ color: 0x6fa35f, roughness: 0.92 })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    scene.add(grass);

    const road = createRoadMesh();
    road.receiveShadow = true;
    scene.add(road);

    addFinishLine();
    addLaneMarks();
    addGuardRails();
    addTrees();
    addMountains();
  }

  function createRoadMesh() {
    const positions = [];
    const indices = [];
    const halfWidth = trackConfig.width / 2;

    for (let index = 0; index < trackConfig.samples; index += 1) {
      const sample = sampleTrack(index / trackConfig.samples);
      const left = sample.center.clone().add(sample.normal.clone().multiplyScalar(halfWidth));
      const right = sample.center.clone().add(sample.normal.clone().multiplyScalar(-halfWidth));

      positions.push(left.x, 0.04, left.y);
      positions.push(right.x, 0.04, right.y);
    }

    for (let index = 0; index < trackConfig.samples; index += 1) {
      const next = (index + 1) % trackConfig.samples;
      const left = index * 2;
      const right = left + 1;
      const nextLeft = next * 2;
      const nextRight = nextLeft + 1;

      indices.push(left, right, nextLeft);
      indices.push(right, nextRight, nextLeft);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0x2f353b,
        roughness: 0.78,
        metalness: 0.02
      })
    );
  }

  function addFinishLine() {
    const sample = sampleTrack(raceConfig.startProgress);
    const group = new THREE.Group();
    group.position.set(sample.center.x, 0, sample.center.y);
    group.rotation.y = sample.heading;

    const checkerTexture = createCheckeredTexture();
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(trackConfig.width * 0.92, 2.05),
      new THREE.MeshStandardMaterial({
        map: checkerTexture,
        transparent: true,
        roughness: 0.56,
        metalness: 0.02,
        side: THREE.DoubleSide
      })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.06;

    const accent = new THREE.Mesh(
      new THREE.BoxGeometry(trackConfig.width + 2.6, 0.2, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xd64545, roughness: 0.44 })
    );
    accent.position.set(0, 3.18, 0);
    accent.castShadow = true;

    const postGeometry = new THREE.CylinderGeometry(0.14, 0.16, 3.3, 10);
    const postMaterial = new THREE.MeshStandardMaterial({
      color: 0xe2e8ef,
      roughness: 0.34,
      metalness: 0.48
    });
    const leftPost = new THREE.Mesh(postGeometry, postMaterial);
    const rightPost = new THREE.Mesh(postGeometry, postMaterial);
    leftPost.position.set(trackConfig.width / 2 + 1.15, 1.65, 0);
    rightPost.position.set(-trackConfig.width / 2 - 1.15, 1.65, 0);
    leftPost.castShadow = true;
    rightPost.castShadow = true;

    group.add(line, accent, leftPost, rightPost);
    scene.add(group);
  }

  function createCheckeredTexture() {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 512;
    textureCanvas.height = 96;

    const context = textureCanvas.getContext("2d");
    if (!context) {
      return null;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, textureCanvas.width, textureCanvas.height);

    const cell = 32;
    for (let row = 0; row < textureCanvas.height / cell; row += 1) {
      for (let column = 0; column < textureCanvas.width / cell; column += 1) {
        if ((row + column) % 2 === 0) {
          context.fillStyle = "#161a20";
          context.fillRect(column * cell, row * cell, cell, cell);
        }
      }
    }

    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;
    return texture;
  }

  function addLaneMarks() {
    const markMaterial = new THREE.MeshStandardMaterial({
      color: 0xf2d34f,
      roughness: 0.55,
      emissive: 0x3a3109,
      emissiveIntensity: 0.05
    });

    for (let index = 0; index < 92; index += 1) {
      const sample = sampleTrack(index / 92);
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.035, 3.4), markMaterial);
      mark.position.set(sample.center.x, 0.08, sample.center.y);
      mark.rotation.y = sample.heading;
      mark.receiveShadow = true;
      scene.add(mark);
    }
  }

  function addGuardRails() {
    const railMaterial = new THREE.MeshStandardMaterial({
      color: 0xd8dde3,
      roughness: 0.38,
      metalness: 0.55
    });

    const outerCurve = new THREE.CatmullRomCurve3(pointsFromTrackOffset(trackConfig.width / 2 + 1.2), true);
    const innerCurve = new THREE.CatmullRomCurve3(pointsFromTrackOffset(-trackConfig.width / 2 - 1.2), true);
    const outerRail = new THREE.Mesh(new THREE.TubeGeometry(outerCurve, 260, 0.16, 8, true), railMaterial);
    const innerRail = new THREE.Mesh(new THREE.TubeGeometry(innerCurve, 260, 0.16, 8, true), railMaterial);
    outerRail.position.y = 0.78;
    innerRail.position.y = 0.78;
    outerRail.castShadow = true;
    innerRail.castShadow = true;
    scene.add(outerRail, innerRail);
  }

  function addTrees() {
    for (let index = 0; index < 90; index += 1) {
      const side = index % 2 === 0 ? 1 : -1;
      const progress = (index / 90 + (index % 5) * 0.003) % 1;
      const sample = sampleTrack(progress);
      const offset = side * (trackConfig.width / 2 + 9 + ((index * 11) % 22));
      const position = sample.center.clone().add(sample.normal.clone().multiplyScalar(offset));
      const height = 3.6 + ((index * 7) % 18) / 10;
      const tree = createTree(height);
      tree.position.set(position.x, 0, position.y);
      tree.rotation.y = ((index * 37) % 360) * Math.PI / 180;
      scene.add(tree);
    }
  }

  function createTree(height) {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.26, height * 0.42, 8),
      new THREE.MeshStandardMaterial({ color: 0x7b4a2a, roughness: 0.86 })
    );
    trunk.position.y = height * 0.21;
    trunk.castShadow = true;

    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(height * 0.32, height * 0.82, 8),
      new THREE.MeshStandardMaterial({ color: 0x2f7d4f, roughness: 0.72 })
    );
    crown.position.y = height * 0.76;
    crown.castShadow = true;

    group.add(trunk, crown);
    return group;
  }

  function addMountains() {
    const material = new THREE.MeshStandardMaterial({ color: 0x8ea4ad, roughness: 0.96 });
    const placements = [
      [-105, -92, 22, 34],
      [-72, -108, 16, 26],
      [92, -96, 20, 31],
      [116, 62, 18, 28],
      [-118, 70, 16, 25]
    ];

    for (const [x, z, radius, height] of placements) {
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 4), material);
      mountain.position.set(x, height / 2 - 0.2, z);
      mountain.rotation.y = Math.PI / 4;
      mountain.receiveShadow = true;
      scene.add(mountain);
    }
  }

  function createCar(color = 0xa81f34) {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.55,
      roughness: 0.34
    });
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.55 });
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: 0xb7d9ee,
      metalness: 0.1,
      roughness: 0.08
    });
    const lightMaterial = new THREE.MeshStandardMaterial({
      color: 0xf7f0cf,
      emissive: 0xf4dca3,
      emissiveIntensity: 0.45,
      roughness: 0.32
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.58, 4.25), bodyMaterial);
    body.position.y = 0.72;
    body.castShadow = true;

    const hood = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.28, 1.45), bodyMaterial);
    hood.position.set(0, 0.98, 1.0);
    hood.castShadow = true;

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.62, 1.3), glassMaterial);
    cabin.position.set(0, 1.25, -0.52);
    cabin.castShadow = true;

    const rear = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.36, 0.72), bodyMaterial);
    rear.position.set(0, 0.96, -1.64);
    rear.castShadow = true;

    const frontLightLeft = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), lightMaterial);
    const frontLightRight = frontLightLeft.clone();
    frontLightLeft.position.set(-0.62, 0.78, 2.18);
    frontLightRight.position.set(0.62, 0.78, 2.18);

    const wheelGeometry = new THREE.CylinderGeometry(0.45, 0.45, 0.34, 20);
    const wheelPositions = [
      [-1.18, 0.48, 1.34],
      [1.18, 0.48, 1.34],
      [-1.18, 0.48, -1.36],
      [1.18, 0.48, -1.36]
    ];
    for (const [x, y, z] of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeometry, darkMaterial);
      wheel.position.set(x, y, z);
      wheel.rotation.z = Math.PI / 2;
      wheel.castShadow = true;
      group.add(wheel);
    }

    const boostGroup = new THREE.Group();
    boostGroup.position.set(0, 0.7, -2.42);
    boostGroup.visible = false;

    const flameMaterial = new THREE.MeshBasicMaterial({
      color: 0xff8f36,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0x8de9ff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc15c,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const flameGeometry = new THREE.SphereGeometry(0.22, 12, 12);
    const glowGeometry = new THREE.SphereGeometry(0.36, 14, 14);
    const flameOffsets = [-0.54, 0.54];
    const flames = [];

    for (const offsetX of flameOffsets) {
      const outer = new THREE.Mesh(flameGeometry, flameMaterial.clone());
      outer.position.set(offsetX, -0.03, -0.38);
      outer.scale.set(1.35, 1.35, 4.2);

      const core = new THREE.Mesh(flameGeometry, coreMaterial.clone());
      core.position.set(offsetX, -0.03, -0.22);
      core.scale.set(0.76, 0.76, 2.8);

      flames.push(outer, core);
      boostGroup.add(outer, core);
    }

    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.set(0, -0.04, -0.3);
    glow.scale.set(1.95, 1.15, 3.1);
    flames.push(glow);
    boostGroup.add(glow);

    group.userData.boostFlames = flames;
    group.userData.boostGroup = boostGroup;
    group.add(body, hood, cabin, rear, frontLightLeft, frontLightRight);
    group.add(boostGroup);
    return group;
  }

  function loop(timestamp) {
    if (!active) return;

    const deltaSeconds = Math.min((timestamp - lastFrameTime) / 1000, 0.04);
    lastFrameTime = timestamp;

    if (!raceState.finished) {
      updateControls();
      updatePhysics(deltaSeconds);
      updateOpponent(deltaSeconds);
      updateRaceState(deltaSeconds);
    } else {
      state.throttle = 0;
      state.brake = 0;
      state.steering += (0 - state.steering) * 0.18;
    }

    updateCarTransform();
    updateBoostEffect(timestamp);
    updateOpponentTransform();
    updateCamera(deltaSeconds);
    updateHud();
    renderer.render(scene, camera);

    animationFrameId = requestAnimationFrame(loop);
  }

  function updateControls() {
    const throttlePressed = keyState.has("KeyW") || keyState.has("ArrowUp");
    const brakePressed = keyState.has("KeyS") || keyState.has("ArrowDown");
    const leftPressed = keyState.has("KeyA") || keyState.has("ArrowLeft");
    const rightPressed = keyState.has("KeyD") || keyState.has("ArrowRight");

    state.throttle = throttlePressed ? 1 : 0;
    state.brake = brakePressed ? 1 : 0;

    const targetSteer = (leftPressed ? 1 : 0) - (rightPressed ? 1 : 0);
    state.steering += (targetSteer - state.steering) * 0.22;
  }

  function updateBoostEffect(timestamp) {
    const flames = car?.userData.boostFlames;
    const boostGroup = car?.userData.boostGroup;
    if (!flames) return;

    const activeBoost = state.boostSeconds > 0 && !raceState.finished;
    const moving = state.velocity.length() > 2;
    const active = activeBoost && moving;
    if (boostGroup) {
      boostGroup.visible = active;
    }
    const pulse = 0.84 + Math.sin(timestamp * 0.022) * 0.16;

    for (let index = 0; index < flames.length; index += 1) {
      const flame = flames[index];
      flame.visible = active;

      if (!active) {
        flame.material.opacity = 0;
        continue;
      }

      const isGlow = index === flames.length - 1;
      flame.material.opacity = isGlow ? 0.72 * pulse : 1 * pulse;

      if (isGlow) {
        flame.scale.set(1.9 + pulse * 0.36, 1.12 + pulse * 0.18, 3.1 + pulse * 0.78);
      } else if (index % 2 === 0) {
        flame.scale.set(1.35, 1.35, 4.2 + pulse * 1.65);
      } else {
        flame.scale.set(0.76, 0.76, 2.8 + pulse * 1.18);
      }
    }
  }

  function updatePhysics(deltaSeconds) {
    syncPlayerTrackMetrics();
    state.boostSeconds = Math.max(0, state.boostSeconds - deltaSeconds);

    if (state.stoppedByImpactSeconds > 0) {
      state.stoppedByImpactSeconds = Math.max(0, state.stoppedByImpactSeconds - deltaSeconds);
      state.velocity.set(0, 0);
      return;
    }

    const forward = forwardVector();
    const right = new THREE.Vector2(forward.y, -forward.x);
    const forwardSpeed = state.velocity.dot(forward);
    const boostActive = state.boostSeconds > 0;
    const currentMaxForwardSpeed = playerMaxForwardSpeed();
    const currentEngineForce = carConfig.engineForce * (boostActive ? boostConfig.engineForceMultiplier : 1);

    if (state.throttle > 0 && forwardSpeed < currentMaxForwardSpeed) {
      const speedRatio = Math.max(0, forwardSpeed / currentMaxForwardSpeed);
      const force = currentEngineForce * (1 - speedRatio * 0.32);
      state.velocity.addScaledVector(forward, force * deltaSeconds);
    }

    if (state.brake > 0) {
      if (forwardSpeed > 1.2) {
        state.velocity.addScaledVector(forward, -carConfig.brakeForce * deltaSeconds);
      } else if (forwardSpeed > -carConfig.maxReverseSpeed) {
        state.velocity.addScaledVector(forward, -carConfig.reverseForce * deltaSeconds);
      }
    }

    const lateralSpeed = state.velocity.dot(right);
    const grip = state.onRoad ? carConfig.roadGrip : carConfig.grassGrip;
    state.velocity.addScaledVector(right, -lateralSpeed * Math.min(1, grip * deltaSeconds));

    const rolling = Math.max(0, 1 - carConfig.rollingResistance * deltaSeconds * (state.onRoad ? 1 : 1.7));
    const drag = Math.max(0, 1 - state.velocity.lengthSq() * carConfig.drag * deltaSeconds * 0.01);
    state.velocity.multiplyScalar(rolling * drag);

    if (!state.onRoad) {
      state.velocity.multiplyScalar(Math.max(0, 1 - 1.25 * deltaSeconds));
    }

    const speed = state.velocity.length();
    const speedSign = forwardSpeed >= 0 ? 1 : -1;
    const steerFactor = Math.min(1, speed / 9);
    const turnRate = state.steering * carConfig.maxSteerRate * steerFactor * speedSign;
    state.heading += turnRate * deltaSeconds;

    const speedAlongHeading = state.velocity.dot(forwardVector());
    const maxSpeed = speedAlongHeading >= 0 ? currentMaxForwardSpeed : carConfig.maxReverseSpeed;
    if (speed > maxSpeed) {
      state.velocity.multiplyScalar(maxSpeed / speed);
    }

    const previousPosition = state.position.clone();
    const previousTrackIndex = state.trackIndex;

    state.position.addScaledVector(state.velocity, deltaSeconds);
    syncPlayerTrackMetrics(previousTrackIndex);
    handleRailCollision(previousPosition, previousTrackIndex);
  }

  function handleRailCollision(previousPosition, previousTrackIndex) {
    if (trackDistanceFromIndex(state.position, state.trackIndex) <= collisionConfig.railLimit) {
      return;
    }

    state.position.copy(previousPosition);
    state.velocity.set(0, 0);
    state.stoppedByImpactSeconds = collisionConfig.stopSeconds;
    syncPlayerTrackMetrics(previousTrackIndex);
  }

  function updateOpponent(deltaSeconds) {
    opponentState.progress = wrapProgress(opponentState.progress + (opponentConfig.speed * deltaSeconds) / trackLength);
    opponentState.raceProgress = relativeRaceProgress(opponentState.progress);
  }

  function updateRaceState(deltaSeconds) {
    state.lapLockSeconds = Math.max(0, state.lapLockSeconds - deltaSeconds);
    opponentState.lapLockSeconds = Math.max(0, opponentState.lapLockSeconds - deltaSeconds);

    advanceLapCounter(state, state.velocity.dot(trackSamples[state.trackIndex].tangent));
    advanceLapCounter(opponentState, opponentConfig.speed);

    raceState.playerPlace = playerRaceDistance() >= opponentRaceDistance() ? 1 : 2;

    if (state.completedLaps >= raceConfig.totalLaps) {
      finishRace("player");
    } else if (opponentState.completedLaps >= raceConfig.totalLaps) {
      finishRace("opponent");
    }
  }

  function advanceLapCounter(driverState, trackSpeed) {
    const previous = driverState.lastRaceProgress;
    const current = driverState.raceProgress;

    if (
      !driverState.lapArmed &&
      current > raceConfig.lapArmProgressMin &&
      current < raceConfig.lapArmProgressMax
    ) {
      driverState.lapArmed = true;
    }

    if (driverState.lapLockSeconds === 0 && driverState.lapArmed) {
      if (
        previous > 1 - raceConfig.lapThreshold &&
        current < raceConfig.lapThreshold &&
        trackSpeed > raceConfig.minForwardTrackSpeed
      ) {
        driverState.completedLaps += 1;
        driverState.lapLockSeconds = raceConfig.lapCooldownSeconds;
        driverState.lapArmed = false;
      } else if (
        previous < raceConfig.lapThreshold &&
        current > 1 - raceConfig.lapThreshold &&
        trackSpeed < -raceConfig.minForwardTrackSpeed
      ) {
        driverState.completedLaps = Math.max(0, driverState.completedLaps - 1);
        driverState.lapLockSeconds = raceConfig.lapCooldownSeconds * 0.6;
        driverState.lapArmed = false;
      }
    }

    driverState.lastRaceProgress = current;
  }

  function finishRace(winner) {
    if (raceState.finished) return;

    raceState.finished = true;
    raceState.winner = winner;
    raceState.playerPlace = winner === "player" ? 1 : 2;
    state.velocity.set(0, 0);
    state.boostSeconds = 0;
    keyState.clear();
    showResultOverlay(winner);
    updateHud();
  }

  function updateCarTransform() {
    car.position.set(state.position.x, 0, state.position.y);
    car.rotation.y = state.heading;
    car.rotation.z = -state.steering * Math.min(0.12, state.velocity.length() * 0.004);
  }

  function updateOpponentTransform() {
    const sample = sampleTrack(opponentState.progress);
    const laneOffset = clamp(
      opponentConfig.laneOffset,
      -collisionConfig.railLimit + 1.4,
      collisionConfig.railLimit - 1.4
    );
    const position = sample.center.clone().add(sample.normal.clone().multiplyScalar(laneOffset));

    opponentCar.position.set(position.x, 0, position.y);
    opponentCar.rotation.y = sample.heading;
    opponentCar.rotation.z = 0;
  }

  function updateCamera(deltaSeconds) {
    const forward = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
    const target = new THREE.Vector3(state.position.x, 1.1, state.position.y).addScaledVector(forward, 4.2);
    const desired = new THREE.Vector3(state.position.x, 0, state.position.y)
      .addScaledVector(forward, -11.8)
      .add(new THREE.Vector3(0, 6.4, 0));

    const follow = 1 - Math.exp(-deltaSeconds * 5.2);
    camera.position.lerp(desired, follow);
    camera.lookAt(target);
  }

  function updateHud() {
    lapValue.textContent = formatLapDisplay(state.completedLaps);
    placeValue.textContent = raceState.playerPlace === 1 ? "第1名" : "第2名";
    speedValue.textContent = `${Math.round(state.velocity.length() * 3.6)} km/h`;
    boostValue.textContent = state.boostSeconds > 0
      ? `${state.boostSeconds.toFixed(1)}秒`
      : `剩${state.boostCharges}次`;
    statusValue.textContent = currentStatusLabel();
  }

  function currentStatusLabel() {
    if (raceState.finished) {
      return raceState.winner === "player" ? "你赢了" : "惜败";
    }

    if (state.stoppedByImpactSeconds > 0) {
      return "撞停";
    }

    if (state.boostSeconds > 0) {
      return "加速中";
    }

    if (!state.onRoad) {
      return "草地减速";
    }

    return raceState.playerPlace === 1 ? "领先" : "追赶中";
  }

  function resetRace() {
    hideResultOverlay();

    const start = sampleTrack(raceConfig.startProgress);
    const startPosition = start.center.clone().add(start.normal.clone().multiplyScalar(2.8));

    state.position.copy(startPosition);
    state.velocity.set(0, 0);
    state.heading = start.heading;
    state.steering = 0;
    state.throttle = 0;
    state.brake = 0;
    state.onRoad = true;
    state.stoppedByImpactSeconds = 0;
    state.trackIndex = Math.round(raceConfig.startProgress * trackConfig.samples) % trackConfig.samples;
    state.trackProgress = raceConfig.startProgress;
    state.raceProgress = 0;
    state.lastRaceProgress = 0;
    state.completedLaps = 0;
    state.lapLockSeconds = 0;
    state.lapArmed = false;
    state.boostSeconds = 0;
    state.boostCharges = boostConfig.charges;

    opponentState.progress = opponentConfig.startProgress;
    opponentState.raceProgress = 0;
    opponentState.lastRaceProgress = 0;
    opponentState.completedLaps = 0;
    opponentState.lapLockSeconds = 0;
    opponentState.lapArmed = false;

    raceState.finished = false;
    raceState.winner = "";
    raceState.playerPlace = 1;

    syncPlayerTrackMetrics();
    state.lastRaceProgress = state.raceProgress;
    opponentState.raceProgress = relativeRaceProgress(opponentState.progress);
    opponentState.lastRaceProgress = opponentState.raceProgress;

    if (car && camera && renderer) {
      updateCarTransform();
      updateOpponentTransform();

      const forward = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
      camera.position.copy(
        new THREE.Vector3(state.position.x, 0, state.position.y)
          .addScaledVector(forward, -11.8)
          .add(new THREE.Vector3(0, 6.4, 0))
      );
      camera.lookAt(new THREE.Vector3(state.position.x, 1.1, state.position.y).addScaledVector(forward, 4.2));
      renderer.render(scene, camera);
    }

    updateHud();
  }

  function showResultOverlay(winner) {
    resultCard.classList.toggle("is-win", winner === "player");
    resultCard.classList.toggle("is-loss", winner !== "player");
    resultTag.textContent = winner === "player" ? "率先冲线" : "对手先冲线";
    resultTitle.textContent = winner === "player" ? "你赢了" : "惜败";
    resultSummary.textContent =
      winner === "player"
        ? `你率先完成 ${raceConfig.totalLaps} 圈，先冲过终点线。`
        : `对手先完成 ${raceConfig.totalLaps} 圈。你还在第 ${currentLapNumber(state.completedLaps)} 圈。`;
    resultPlayerLaps.textContent = formatLapDisplay(state.completedLaps);
    resultOpponentLaps.textContent = formatLapDisplay(opponentState.completedLaps);
    resultOverlay.hidden = false;
  }

  function hideResultOverlay() {
    resultOverlay.hidden = true;
    resultCard.classList.remove("is-win", "is-loss");
  }

  function activateBoost() {
    if (raceState.finished || state.stoppedByImpactSeconds > 0) {
      return false;
    }

    if (state.boostSeconds > 0 || state.boostCharges <= 0) {
      return false;
    }

    state.boostCharges -= 1;
    state.boostSeconds = boostConfig.durationSeconds;
    return true;
  }

  function prepareConfetti() {
    if (confetti.childElementCount > 0) {
      return;
    }

    const colors = ["#f2b705", "#0f8b8d", "#37b36d", "#f26857", "#ffffff", "#57a7ff"];

    for (let index = 0; index < 20; index += 1) {
      const piece = document.createElement("span");
      piece.className = "confetti-piece";
      piece.style.left = `${4 + index * 4.8}%`;
      piece.style.setProperty("--piece-color", colors[index % colors.length]);
      piece.style.setProperty("--delay", `${(index % 6) * 0.12}s`);
      piece.style.setProperty("--duration", `${2.6 + (index % 5) * 0.22}s`);
      piece.style.setProperty("--drift", `${-30 + ((index * 17) % 61)}px`);
      piece.style.setProperty("--spin", `${(index % 2 === 0 ? 1 : -1) * (160 + (index * 13) % 120)}deg`);
      confetti.append(piece);
    }
  }

  function resizeRenderer() {
    if (!renderer || !camera) return;

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width || 960));
    const height = Math.max(320, Math.floor(rect.height || 620));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function addListeners() {
    if (listening) return;

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("resize", resizeRenderer);
    listening = true;
  }

  function removeListeners() {
    if (!listening) return;

    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    window.removeEventListener("blur", handleBlur);
    window.removeEventListener("resize", resizeRenderer);
    listening = false;
  }

  function handleKeyDown(event) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "KeyR"].includes(event.code)) {
      event.preventDefault();
    }

    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
      keyState.add(event.code);
    }

    if (event.code === "KeyE" && !event.repeat) {
      activateBoost();
    }

    if (event.code === "KeyR") {
      resetRace();
    }
  }

  function handleKeyUp(event) {
    keyState.delete(event.code);
  }

  function handleBlur() {
    keyState.clear();
  }

  function createTrackCurve() {
    const points = trackConfig.controlPoints.map(([x, z]) => new THREE.Vector3(x, 0, z));
    return new THREE.CatmullRomCurve3(points, true, "centripetal", 0.45);
  }

  function createTrackSamples() {
    return Array.from({ length: trackConfig.samples }, (_, index) => sampleTrack(index / trackConfig.samples));
  }

  function measureTrackLength() {
    let length = 0;

    for (let index = 0; index < trackSamples.length; index += 1) {
      const current = trackSamples[index].center;
      const next = trackSamples[(index + 1) % trackSamples.length].center;
      length += current.distanceTo(next);
    }

    return length;
  }

  function sampleTrack(progress) {
    const wrapped = wrapProgress(progress);
    const point = trackCurve.getPointAt(wrapped);
    const tangent3 = trackCurve.getTangentAt(wrapped);
    const center = new THREE.Vector2(point.x, point.z);
    const tangent = new THREE.Vector2(tangent3.x, tangent3.z).normalize();
    const normal = new THREE.Vector2(-tangent.y, tangent.x);

    return {
      center,
      tangent,
      normal,
      heading: Math.atan2(tangent.x, tangent.y)
    };
  }

  function syncPlayerTrackMetrics(preferredIndex = state.trackIndex) {
    const nearest = closestTrackSample(state.position, preferredIndex);
    state.trackIndex = nearest.index;
    state.trackProgress = nearest.progress;
    state.raceProgress = relativeRaceProgress(nearest.progress);
    state.onRoad = nearest.distance <= collisionConfig.roadLimit;
    return nearest;
  }

  function closestTrackSample(position, preferredIndex = null) {
    const localWindow = preferredIndex == null ? trackSamples.length : 26;
    let bestIndex = 0;
    let bestDistanceSq = Infinity;

    if (preferredIndex == null) {
      for (let index = 0; index < trackSamples.length; index += 1) {
        const distanceSq = position.distanceToSquared(trackSamples[index].center);
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          bestIndex = index;
        }
      }
    } else {
      for (let offset = -localWindow; offset <= localWindow; offset += 1) {
        const index = wrapIndex(preferredIndex + offset, trackSamples.length);
        const distanceSq = position.distanceToSquared(trackSamples[index].center);
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          bestIndex = index;
        }
      }

      if (bestDistanceSq > 30 * 30) {
        return closestTrackSample(position, null);
      }
    }

    return {
      index: bestIndex,
      progress: bestIndex / trackConfig.samples,
      distance: Math.sqrt(bestDistanceSq)
    };
  }

  function trackDistanceFromIndex(position, preferredIndex) {
    return closestTrackSample(position, preferredIndex).distance;
  }

  function relativeRaceProgress(progress) {
    return wrapProgress(progress - raceConfig.startProgress);
  }

  function playerRaceDistance() {
    return raceDistanceFor(state);
  }

  function opponentRaceDistance() {
    return raceDistanceFor(opponentState);
  }

  function raceDistanceFor(driverState) {
    const progress = driverState.completedLaps > 0 || driverState.lapArmed ? driverState.raceProgress : 0;
    return driverState.completedLaps + progress;
  }

  function playerMaxForwardSpeed() {
    return carConfig.maxForwardSpeed * (state.boostSeconds > 0 ? boostConfig.topSpeedMultiplier : 1);
  }

  function formatLapDisplay(completedLaps) {
    return `${currentLapNumber(completedLaps)} / ${raceConfig.totalLaps}`;
  }

  function currentLapNumber(completedLaps) {
    return Math.min(raceConfig.totalLaps, completedLaps + 1);
  }

  function pointsFromTrackOffset(offset) {
    const points = [];

    for (let index = 0; index < 240; index += 1) {
      const sample = sampleTrack(index / 240);
      const point = sample.center.clone().add(sample.normal.clone().multiplyScalar(offset));
      points.push(new THREE.Vector3(point.x, 0, point.y));
    }

    return points;
  }

  function forwardVector() {
    return new THREE.Vector2(Math.sin(state.heading), Math.cos(state.heading));
  }

  function wrapProgress(progress) {
    return ((progress % 1) + 1) % 1;
  }

  function wrapIndex(index, length) {
    return ((index % length) + length) % length;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function registerDebugApi() {
    globalThis.__ackGamesDebug = globalThis.__ackGamesDebug || {};
    globalThis.__ackGamesDebug.racing = {
      activateBoost,
      resetRace,
      getState: () => ({
        lapText: formatLapDisplay(state.completedLaps),
        completedLaps: state.completedLaps,
        lapArmed: state.lapArmed,
        boostSeconds: Number(state.boostSeconds.toFixed(2)),
        boostCharges: state.boostCharges,
        speedKmh: Math.round(state.velocity.length() * 3.6),
        playerMaxForwardSpeed: playerMaxForwardSpeed(),
        status: currentStatusLabel(),
        flameStates: (car?.userData.boostFlames || []).map((flame) => ({
          visible: flame.visible,
          opacity: Number((flame.material.opacity || 0).toFixed(2))
        }))
      })
    };
  }

  registerDebugApi();
  resetButton.addEventListener("click", resetRace);
  playAgainButton.addEventListener("click", resetRace);

  return { start, stop, reset: resetRace };
}
