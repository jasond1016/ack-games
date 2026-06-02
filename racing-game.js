import * as THREE from "three";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/loaders/GLTFLoader.js";
import RAPIER from "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.3/+esm";
import { loadActiveRacingMap, racingTrackShapeConfig } from "./racing-map.js";

const carModelUrl = new URL("./kenney_car-kit/Models/GLB format/race-future.glb", import.meta.url).href;
const carModelLoader = new GLTFLoader();
const rapierReadyPromise = RAPIER.init();
const upAxis = new THREE.Vector3(0, 1, 0);
const tempQuaternion = new THREE.Quaternion();

export function createRacingGame() {
  const mapData = loadActiveRacingMap();
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
  const handleResetButtonClick = () => resetRace();

  const raceConfig = {
    totalLaps: 3,
    startProgress: mapData.startProgress,
    lapThreshold: 0.16,
    lapCooldownSeconds: 0.72,
    minForwardTrackSpeed: 2.2,
    lapArmProgressMin: 0.16,
    lapArmProgressMax: 0.84
  };

  const boostConfig = {
    charges: 5,
    durationSeconds: 5,
    topSpeedMultiplier: 2,
    engineForceMultiplier: 2.15
  };

  const trackConfig = {
    width: mapData.track.width,
    samples: mapData.track.samples,
    controlPoints: mapData.track.controlPoints.map((point) => [...point])
  };

  const railConfig = {
    sampleCount: 200,
    railHeight: 0.78,
    railRadius: 0.16,
    postHeight: 0.72,
    postSpacing: 5
  };

  const treeConfig = {
    count: 52,
    minRoadClearance: trackConfig.width / 2 + 9.5,
    minRadius: 76,
    maxAttempts: 900,
    minSpacing: 8.5,
    boundsX: 126,
    boundsZ: 104
  };

  const carConfig = {
    maxForwardSpeed: 46,
    maxReverseSpeed: 11,
    engineForce: 35,
    brakeForce: 40,
    reverseForce: 15,
    drag: 0.028,
    rollingResistance: 0.76,
    roadGrip: 9.4,
    grassGrip: 2.9,
    maxSteerRate: 1.82
  };

  const handlingConfig = {
    steeringResponse: 0.3,
    steeringReleaseResponse: 0.2,
    lowSpeedSteerBoost: 1.42,
    highSpeedSteerStart: 18,
    highSpeedSteerEnd: 42,
    highSpeedSteerMin: 0.58,
    steerFactorFloor: 0.48,
    driftEntrySpeed: 9,
    driftSustainSpeed: 6.5,
    driftSteerThreshold: 0.22,
    driftGripMultiplier: 0.2,
    driftBrakeMultiplier: 0.26,
    driftTurnMultiplier: 1.48,
    driftYawAssist: 0.62,
    launchBoostThreshold: 12,
    launchForceMultiplier: 1.18,
    grassTopSpeedMultiplier: 0.66,
    grassDragMultiplier: 1.55
  };

  const collisionConfig = {
    stopSeconds: 0.16,
    carStopSeconds: 0.12,
    opponentPauseSeconds: 0.36
  };

  const opponentConfig = {
    speed: Math.min(8.2, 30 / 3.6),
    laneOffset: -2.7,
    startProgress: raceConfig.startProgress
  };

  const physicsConfig = {
    fixedHeight: 0.34,
    carHalfWidth: 0.9,
    carHalfHeight: 0.34,
    carHalfLength: 1.55,
    railHalfHeight: 0.56,
    railHalfDepth: 0.34,
    stepSeconds: 1 / 60
  };

  const trackShapeConfig = racingTrackShapeConfig;

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
    previousPosition: new THREE.Vector2(),
    previousTrackIndex: 0,
    trackIndex: 0,
    trackProgress: raceConfig.startProgress,
    raceProgress: 0,
    lastRaceProgress: 0,
    completedLaps: 0,
    lapLockSeconds: 0,
    lapArmed: false,
    boostSeconds: 0,
    boostCharges: boostConfig.charges,
    drifting: false
  };
  const opponentState = {
    progress: opponentConfig.startProgress,
    position: new THREE.Vector2(),
    heading: 0,
    laneOffset: opponentConfig.laneOffset,
    collisionHoldSeconds: 0,
    raceProgress: 0,
    lastRaceProgress: 0,
    completedLaps: 0,
    lapLockSeconds: 0,
    lapArmed: false
  };
  const raceState = {
    finished: false,
    winner: "",
    playerPlace: 1,
    opponentEnabled: true
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
  let initializationPromise = null;
  let carTemplatePromise = null;
  let startRequestId = 0;
  let physics = null;

  function start() {
    prepareConfetti();
    keyState.clear();
    addListeners();
    active = true;
    const requestId = ++startRequestId;
    statusValue.textContent = "载入赛车";

    initializeScene()
      .then(() => {
        if (!active || requestId !== startRequestId) {
          return;
        }

        resetRace();
        resizeRenderer();
        lastFrameTime = performance.now();

        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }

        animationFrameId = requestAnimationFrame(loop);
      })
      .catch((error) => {
        console.error("Failed to initialize racing scene.", error);
        if (requestId !== startRequestId) {
          return;
        }

        active = false;
        removeListeners();
        statusValue.textContent = "赛车加载失败";
      });
  }

  function stop() {
    active = false;
    startRequestId += 1;
    keyState.clear();
    removeListeners();

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }
  }

  function destroy() {
    stop();
    resetButton.removeEventListener("click", handleResetButtonClick);
    playAgainButton.removeEventListener("click", handleResetButtonClick);
  }

  async function initializeScene() {
    if (initialized) return;
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
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
      await initializePhysics();

      [car, opponentCar] = await Promise.all([
        createCar(0xd40000),
        createCar(0x88a5ff)
      ]);

      scene.add(car);
      scene.add(opponentCar);

      initialized = true;
    })();

    try {
      await initializationPromise;
    } catch (error) {
      initializationPromise = null;
      throw error;
    }
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
    grass.position.y = -0.08;
    grass.receiveShadow = true;
    scene.add(grass);

    const road = createRoadMesh();
    road.receiveShadow = true;
    scene.add(road);

    addFinishLine();
    addLaneMarks();
    addGuardRails();
    addTrackObstacles();
    addTrees();
    addMountains();
  }

  async function initializePhysics() {
    if (physics) {
      return;
    }

    await rapierReadyPromise;

    const world = new RAPIER.World({ x: 0, y: -18, z: 0 });
    world.timestep = physicsConfig.stepSeconds;

    physics = {
      world,
      eventQueue: new RAPIER.EventQueue(true),
      colliderTags: new Map(),
      colliderMeta: new Map(),
      playerBody: null,
      playerCollider: null,
      opponentBody: null,
      opponentCollider: null
    };

    const groundCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(180, 0.3, 150)
        .setTranslation(0, -0.3, 0)
        .setFriction(1.2)
    );
    physics.colliderTags.set(groundCollider.handle, "ground");

    createRailColliders(1);
    createRailColliders(-1);
    createObstacleColliders();

    const playerBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, physicsConfig.fixedHeight, 0)
      .enabledRotations(false, true, false)
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setAngularDamping(8);
    physics.playerBody = world.createRigidBody(playerBodyDesc);
    physics.playerCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        physicsConfig.carHalfWidth,
        physicsConfig.carHalfHeight,
        physicsConfig.carHalfLength
      )
        .setFriction(0.15)
        .setRestitution(0)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      physics.playerBody
    );
    physics.colliderTags.set(physics.playerCollider.handle, "player");

    const opponentBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(0, physicsConfig.fixedHeight, 0)
      .enabledRotations(false, true, false)
      .setCanSleep(false);
    physics.opponentBody = world.createRigidBody(opponentBodyDesc);
    physics.opponentCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        physicsConfig.carHalfWidth,
        physicsConfig.carHalfHeight,
        physicsConfig.carHalfLength
      )
        .setFriction(0.15)
        .setRestitution(0),
      physics.opponentBody
    );
    physics.colliderTags.set(physics.opponentCollider.handle, "opponent");
  }

  function createObstacleColliders() {
    if (!physics) {
      return;
    }

    for (const obstacle of mapData.obstacles) {
      const collider = physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(obstacle.width / 2, obstacle.height / 2, obstacle.depth / 2)
          .setTranslation(obstacle.x, obstacle.height / 2, obstacle.z)
          .setRotation(rapierRotationFromYaw(obstacle.rotation))
          .setFriction(0.18)
          .setRestitution(0.08)
      );
      physics.colliderTags.set(collider.handle, "obstacle");
      physics.colliderMeta.set(collider.handle, {
        x: obstacle.x,
        z: obstacle.z
      });
    }
  }

  function createRailColliders(side) {
    if (!physics) {
      return;
    }

    for (let index = 0; index < railConfig.sampleCount; index += 1) {
      const startSample = trackProfileAtProgress(index / railConfig.sampleCount);
      const endSample = trackProfileAtProgress((index + 1) / railConfig.sampleCount);
      const start = startSample.center.clone().add(startSample.normal.clone().multiplyScalar(startSample.railOffset * side));
      const end = endSample.center.clone().add(endSample.normal.clone().multiplyScalar(endSample.railOffset * side));
      const segment = end.clone().sub(start);
      const length = segment.length();

      if (length <= 0.01) {
        continue;
      }

      const midpoint = start.clone().add(end).multiplyScalar(0.5);
      const yaw = Math.atan2(segment.x, segment.y);
      const railCollider = physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(length * 0.5, physicsConfig.railHalfHeight, physicsConfig.railHalfDepth)
          .setTranslation(midpoint.x, physicsConfig.railHalfHeight, midpoint.y)
          .setRotation(rapierRotationFromYaw(yaw))
          .setFriction(0.12)
          .setRestitution(0.04)
      );
      physics.colliderTags.set(railCollider.handle, "rail");
    }
  }

  function syncPlayerPhysicsState(preferredIndex = state.trackIndex) {
    if (!physics?.playerBody) {
      return;
    }

    const translation = physics.playerBody.translation();
    const velocity = physics.playerBody.linvel();
    state.position.set(translation.x, translation.z);
    state.velocity.set(velocity.x, velocity.z);
    syncPlayerTrackMetrics(preferredIndex);
  }

  function syncOpponentPhysicsState() {
    if (!physics?.opponentBody) {
      return;
    }

    const translation = physics.opponentBody.translation();
    opponentState.position.set(translation.x, translation.z);
  }

  function setPlayerBodyPose(position, heading) {
    if (!physics?.playerBody) {
      return;
    }

    physics.playerBody.setTranslation({ x: position.x, y: physicsConfig.fixedHeight, z: position.y }, true);
    physics.playerBody.setRotation(rapierRotationFromYaw(heading), true);
    physics.playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    physics.playerBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  function setOpponentBodyPose(position, heading) {
    if (!physics?.opponentBody) {
      return;
    }

    physics.opponentBody.setTranslation({ x: position.x, y: physicsConfig.fixedHeight, z: position.y }, true);
    physics.opponentBody.setRotation(rapierRotationFromYaw(heading), true);
    physics.opponentBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    physics.opponentBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  function rapierRotationFromYaw(yaw) {
    tempQuaternion.setFromAxisAngle(upAxis, yaw);
    return {
      w: tempQuaternion.w,
      x: tempQuaternion.x,
      y: tempQuaternion.y,
      z: tempQuaternion.z
    };
  }

  function createRoadMesh() {
    const positions = [];
    const normals = [];
    const indices = [];

    for (const sample of trackSamples) {
      const left = sample.center.clone().add(sample.normal.clone().multiplyScalar(sample.halfWidth));
      const right = sample.center.clone().add(sample.normal.clone().multiplyScalar(-sample.halfWidth));

      positions.push(left.x, 0.06, left.y);
      positions.push(right.x, 0.06, right.y);
      normals.push(0, 1, 0, 0, 1, 0);
    }

    for (let index = 0; index < trackConfig.samples; index += 1) {
      const next = (index + 1) % trackConfig.samples;
      const left = index * 2;
      const right = left + 1;
      const nextLeft = next * 2;
      const nextRight = nextLeft + 1;

      indices.push(left, nextLeft, right);
      indices.push(right, nextLeft, nextRight);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);

    return new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0x16181c,
        roughness: 0.94,
        metalness: 0.02
      })
    );
  }

  function addFinishLine() {
    const sample = trackProfileAtProgress(raceConfig.startProgress);
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
    line.position.y = 0.1;

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
    leftPost.position.set(sample.railOffset + 0.07, 1.65, 0);
    rightPost.position.set(-sample.railOffset - 0.07, 1.65, 0);
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
    const edgeLineMaterial = new THREE.MeshStandardMaterial({
      color: 0xf3f5f7,
      roughness: 0.52,
      emissive: 0x111111,
      emissiveIntensity: 0.04
    });
    const curbRedMaterial = new THREE.MeshStandardMaterial({ color: 0xcf2e2e, roughness: 0.62 });
    const curbWhiteMaterial = new THREE.MeshStandardMaterial({ color: 0xf6f6f6, roughness: 0.58 });
    const lineGeometry = new THREE.BoxGeometry(0.18, 0.03, 3.8);
    const curbGeometry = new THREE.BoxGeometry(0.84, 0.05, 2.7);

    for (let index = 0; index < 120; index += 1) {
      const sample = trackProfileAtProgress(index / 120);
      const lineOffset = sample.halfWidth - 0.4;
      const curbOffset = sample.halfWidth + 0.18;
      const leftLinePosition = sample.center.clone().add(sample.normal.clone().multiplyScalar(lineOffset));
      const rightLinePosition = sample.center.clone().add(sample.normal.clone().multiplyScalar(-lineOffset));

      const leftLine = new THREE.Mesh(lineGeometry, edgeLineMaterial);
      leftLine.position.set(leftLinePosition.x, 0.11, leftLinePosition.y);
      leftLine.rotation.y = sample.heading;
      leftLine.receiveShadow = true;

      const rightLine = new THREE.Mesh(lineGeometry, edgeLineMaterial);
      rightLine.position.set(rightLinePosition.x, 0.11, rightLinePosition.y);
      rightLine.rotation.y = sample.heading;
      rightLine.receiveShadow = true;

      const curbMaterial = index % 2 === 0 ? curbRedMaterial : curbWhiteMaterial;
      const leftCurbPosition = sample.center.clone().add(sample.normal.clone().multiplyScalar(curbOffset));
      const rightCurbPosition = sample.center.clone().add(sample.normal.clone().multiplyScalar(-curbOffset));

      const leftCurb = new THREE.Mesh(curbGeometry, curbMaterial);
      leftCurb.position.set(leftCurbPosition.x, 0.09, leftCurbPosition.y);
      leftCurb.rotation.y = sample.heading;
      leftCurb.receiveShadow = true;
      leftCurb.castShadow = true;

      const rightCurb = new THREE.Mesh(curbGeometry, curbMaterial);
      rightCurb.position.set(rightCurbPosition.x, 0.09, rightCurbPosition.y);
      rightCurb.rotation.y = sample.heading;
      rightCurb.receiveShadow = true;
      rightCurb.castShadow = true;

      scene.add(leftLine, rightLine, leftCurb, rightCurb);
    }
  }

  function addGuardRails() {
    const railMaterial = new THREE.MeshStandardMaterial({
      color: 0xd8dde3,
      roughness: 0.38,
      metalness: 0.55
    });

    const outerPoints = createRailPoints(1, railConfig.sampleCount);
    const innerPoints = createRailPoints(-1, railConfig.sampleCount);

    scene.add(
      createRailRun(outerPoints, railMaterial),
      createRailRun(innerPoints, railMaterial)
    );
  }

  function addTrackObstacles() {
    for (const obstacle of mapData.obstacles) {
      const group = new THREE.Group();
      group.position.set(obstacle.x, 0, obstacle.z);
      group.rotation.y = obstacle.rotation;

      if (obstacle.type === "cone") {
        const coneMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(obstacle.color), roughness: 0.58 });
        const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xf6f6f6, roughness: 0.44 });
        const offsets = [-obstacle.width * 0.28, 0, obstacle.width * 0.28];
        for (const offset of offsets) {
          const cone = new THREE.Mesh(
            new THREE.ConeGeometry(obstacle.depth * 0.18, obstacle.height, 14),
            coneMaterial
          );
          cone.position.set(offset, obstacle.height / 2, 0);
          cone.castShadow = true;
          cone.receiveShadow = true;

          const stripe = new THREE.Mesh(
            new THREE.CylinderGeometry(obstacle.depth * 0.11, obstacle.depth * 0.11, obstacle.height * 0.16, 12),
            stripeMaterial
          );
          stripe.position.set(offset, obstacle.height * 0.45, 0);
          stripe.castShadow = true;
          stripe.receiveShadow = true;
          group.add(cone, stripe);
        }
      } else {
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(obstacle.color),
          roughness: obstacle.type === "barrier" ? 0.32 : 0.68,
          metalness: obstacle.type === "barrier" ? 0.46 : 0.08
        });
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(obstacle.width, obstacle.height, obstacle.depth),
          material
        );
        body.position.y = obstacle.height / 2;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);
      }

      scene.add(group);
    }
  }

  function addTrees() {
    const placed = [];
    let attempts = 0;

    while (placed.length < treeConfig.count && attempts < treeConfig.maxAttempts) {
      attempts += 1;

      const candidate = new THREE.Vector2(
        randomBetween(-treeConfig.boundsX, treeConfig.boundsX),
        randomBetween(-treeConfig.boundsZ, treeConfig.boundsZ)
      );

      if (candidate.length() < treeConfig.minRadius) {
        continue;
      }

      if (nearestRoadDistance(candidate) < treeConfig.minRoadClearance) {
        continue;
      }

      if (placed.some((position) => position.distanceToSquared(candidate) < treeConfig.minSpacing ** 2)) {
        continue;
      }

      placed.push(candidate);
      const height = randomBetween(3.8, 5.6);
      const tree = createTree(height);
      tree.position.set(candidate.x, 0, candidate.y);
      tree.rotation.y = randomBetween(0, Math.PI * 2);
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

  function createRailPoints(side, sampleCount) {
    return Array.from({ length: sampleCount }, (_, index) => {
      const sample = trackProfileAtProgress(index / sampleCount);
      const point = sample.center.clone().add(sample.normal.clone().multiplyScalar(sample.railOffset * side));
      return new THREE.Vector3(point.x, railConfig.railHeight, point.y);
    });
  }

  function createRailRun(points, material) {
    const group = new THREE.Group();
    const segmentGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
    const postGeometry = new THREE.CylinderGeometry(0.07, 0.09, railConfig.postHeight, 8);
    const up = new THREE.Vector3(0, 1, 0);

    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const direction = next.clone().sub(current);
      const length = direction.length();

      if (length <= 0.01) {
        continue;
      }

      direction.normalize();

      const segment = new THREE.Mesh(segmentGeometry, material);
      segment.position.copy(current).lerp(next, 0.5);
      segment.quaternion.setFromUnitVectors(up, direction);
      segment.scale.set(railConfig.railRadius, length, railConfig.railRadius);
      segment.castShadow = true;
      segment.receiveShadow = true;
      group.add(segment);

      if (index % railConfig.postSpacing === 0) {
        const post = new THREE.Mesh(postGeometry, material);
        post.position.set(current.x, railConfig.postHeight / 2, current.z);
        post.castShadow = true;
        post.receiveShadow = true;
        group.add(post);
      }
    }

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

  async function createCar(tint = null) {
    const template = await loadCarTemplate();
    if (!template) {
      return createFallbackCar(tint ?? 0xa81f34);
    }

    const group = new THREE.Group();
    const model = template.clone(true);
    cloneCarMaterials(model);
    applyCarTint(model, tint);
    group.add(model);

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const minZ = box.min.z;

    const boostGroup = createBoostGroup(size, minZ);
    group.userData.boostFlames = boostGroup.userData.flames;
    group.userData.boostGroup = boostGroup;
    group.add(boostGroup);
    return group;
  }

  async function loadCarTemplate() {
    if (carTemplatePromise) {
      return carTemplatePromise;
    }

    carTemplatePromise = carModelLoader.loadAsync(carModelUrl)
      .then((gltf) => {
        const template = (gltf.scene || gltf.scenes?.[0])?.clone(true);
        if (!template) {
          throw new Error("race-future.glb does not contain a scene.");
        }

        normalizeCarModel(template);
        template.traverse((child) => {
          if (!child.isMesh) {
            return;
          }

          child.castShadow = true;
          child.receiveShadow = true;

          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) {
            if (material?.map && renderer) {
              material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
            }
          }
        });
        return template;
      })
      .catch((error) => {
        console.warn("Failed to load race-future model, falling back to procedural car.", error);
        return null;
      });

    return carTemplatePromise;
  }

  function normalizeCarModel(model) {
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const targetLength = 4.35;
    const scale = size.z > 0.001 ? targetLength / size.z : 1;

    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    model.updateMatrixWorld(true);
  }

  function cloneCarMaterials(model) {
    model.traverse((child) => {
      if (!child.isMesh || !child.material) {
        return;
      }

      child.material = Array.isArray(child.material)
        ? child.material.map((material) => material.clone())
        : child.material.clone();
    });
  }

  function applyCarTint(model, tint) {
    if (!tint) {
      return;
    }

    const tintColor = new THREE.Color(tint);
    model.traverse((child) => {
      if (!child.isMesh || !child.material || !child.name.toLowerCase().includes("body")) {
        return;
      }

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if ("color" in material) {
          material.color.copy(tintColor);
        }
        if ("roughness" in material) {
          material.roughness = 0.64;
        }
        if ("metalness" in material) {
          material.metalness = 0.12;
        }
      }
    });
  }

  function createBoostGroup(carSize, rearZ) {
    const boostGroup = new THREE.Group();
    boostGroup.position.set(0, carSize.y * 0.54, rearZ - 0.18);
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

    const flameRadius = Math.max(0.18, carSize.x * 0.11);
    const glowRadius = Math.max(0.28, carSize.x * 0.18);
    const flameGeometry = new THREE.SphereGeometry(flameRadius, 12, 12);
    const glowGeometry = new THREE.SphereGeometry(glowRadius, 14, 14);
    const flameOffsets = [-carSize.x * 0.28, carSize.x * 0.28];
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
    boostGroup.userData.flames = flames;
    return boostGroup;
  }

  function createFallbackCar(color = 0xa81f34) {
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
    const steeringResponse = targetSteer === 0
      ? handlingConfig.steeringReleaseResponse
      : handlingConfig.steeringResponse;
    state.steering += (targetSteer - state.steering) * steeringResponse;
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
    if (!physics?.playerBody) {
      return;
    }

    physics.world.timestep = deltaSeconds;
    syncPlayerPhysicsState();
    state.previousPosition.copy(state.position);
    state.previousTrackIndex = state.trackIndex;
    state.boostSeconds = Math.max(0, state.boostSeconds - deltaSeconds);
    const verticalVelocity = physics.playerBody.linvel().y;
    const impactRecovery = state.stoppedByImpactSeconds > 0 ? 0.48 : 1;

    if (state.stoppedByImpactSeconds > 0) {
      state.stoppedByImpactSeconds = Math.max(0, state.stoppedByImpactSeconds - deltaSeconds);
      state.drifting = false;
    }

    drivePlayerBody(deltaSeconds, verticalVelocity, impactRecovery);

    updateOpponent(deltaSeconds);
    physics.world.step(physics.eventQueue);
    drainPhysicsEvents();
    syncPlayerPhysicsState(state.previousTrackIndex);
    syncOpponentPhysicsState();
  }

  function updateOpponent(deltaSeconds) {
    if (!physics?.opponentBody || !physics?.opponentCollider) {
      return;
    }

    opponentState.collisionHoldSeconds = Math.max(0, opponentState.collisionHoldSeconds - deltaSeconds);
    physics.opponentCollider.setEnabled(raceState.opponentEnabled);

    if (!raceState.opponentEnabled) {
      return;
    }

    if (opponentState.collisionHoldSeconds === 0) {
      opponentState.progress = wrapProgress(opponentState.progress + (opponentConfig.speed * deltaSeconds) / trackLength);
    }

    syncOpponentPose();
    opponentState.raceProgress = relativeRaceProgress(opponentState.progress);
    physics.opponentBody.setNextKinematicTranslation({
      x: opponentState.position.x,
      y: physicsConfig.fixedHeight,
      z: opponentState.position.y
    });
    physics.opponentBody.setNextKinematicRotation(rapierRotationFromYaw(opponentState.heading));
  }

  function drivePlayerBody(deltaSeconds, verticalVelocity, controlScale = 1) {
    const velocity = state.velocity.clone();
    const forward = forwardVector();
    const right = new THREE.Vector2(forward.y, -forward.x);
    const boostActive = state.boostSeconds > 0;
    const maxForwardSpeed = playerMaxForwardSpeed() * (state.onRoad ? 1 : handlingConfig.grassTopSpeedMultiplier);
    const currentEngineForce = carConfig.engineForce
      * (boostActive ? boostConfig.engineForceMultiplier : 1)
      * controlScale;
    let forwardSpeed = velocity.dot(forward);
    const driftIntent = controlScale >= 0.95 &&
      state.onRoad &&
      state.throttle > 0 &&
      state.brake > 0 &&
      Math.abs(state.steering) > handlingConfig.driftSteerThreshold &&
      Math.abs(forwardSpeed) > handlingConfig.driftEntrySpeed;

    if (state.drifting) {
      state.drifting =
        state.onRoad &&
        Math.abs(forwardSpeed) > handlingConfig.driftSustainSpeed &&
        Math.abs(state.steering) > 0.08 &&
        (driftIntent || state.throttle > 0);
    } else {
      state.drifting = driftIntent;
    }

    if (state.throttle > 0 && forwardSpeed < maxForwardSpeed) {
      const speedRatio = Math.max(0, forwardSpeed / maxForwardSpeed);
      const launchMultiplier = Math.abs(forwardSpeed) < handlingConfig.launchBoostThreshold
        ? handlingConfig.launchForceMultiplier
        : 1;
      const force = currentEngineForce * launchMultiplier * (1 - speedRatio * 0.34);
      velocity.addScaledVector(forward, force * deltaSeconds);
    }

    if (state.brake > 0) {
      if (forwardSpeed > 1.2) {
        const brakeForce = state.drifting
          ? carConfig.brakeForce * handlingConfig.driftBrakeMultiplier
          : carConfig.brakeForce;
        velocity.addScaledVector(forward, -brakeForce * deltaSeconds);
      } else if (forwardSpeed > -carConfig.maxReverseSpeed) {
        velocity.addScaledVector(forward, -carConfig.reverseForce * deltaSeconds);
      }
    }

    let lateralSpeed = velocity.dot(right);
    const grip = state.onRoad
      ? state.drifting ? carConfig.roadGrip * handlingConfig.driftGripMultiplier : carConfig.roadGrip
      : carConfig.grassGrip;
    velocity.addScaledVector(right, -lateralSpeed * Math.min(1, grip * deltaSeconds));

    const rolling = Math.max(0, 1 - carConfig.rollingResistance * deltaSeconds * (state.onRoad ? 1 : 1.75));
    const drag = Math.max(0, 1 - velocity.lengthSq() * carConfig.drag * deltaSeconds * 0.01);
    velocity.multiplyScalar(rolling * drag);

    if (!state.onRoad) {
      velocity.multiplyScalar(Math.max(0, 1 - handlingConfig.grassDragMultiplier * deltaSeconds));
    }

    const speed = velocity.length();
    const speedSign = forwardSpeed >= 0 ? 1 : -1;
    const lowSpeedBlend = 1 - clamp(speed / handlingConfig.highSpeedSteerStart, 0, 1);
    const highSpeedBlend = clamp(
      (speed - handlingConfig.highSpeedSteerStart)
        / (handlingConfig.highSpeedSteerEnd - handlingConfig.highSpeedSteerStart),
      0,
      1
    );
    const steerFactor = Math.max(
      handlingConfig.steerFactorFloor,
      handlingConfig.lowSpeedSteerBoost * lowSpeedBlend
        + (1 - highSpeedBlend) * (1 - lowSpeedBlend)
        + handlingConfig.highSpeedSteerMin * highSpeedBlend
    );
    const driftTurnBonus = state.drifting ? handlingConfig.driftTurnMultiplier : 1;
    const turnRate = state.steering * carConfig.maxSteerRate * steerFactor * speedSign * driftTurnBonus;
    state.heading += turnRate * deltaSeconds;

    if (state.drifting) {
      state.heading += state.steering * handlingConfig.driftYawAssist * deltaSeconds;
    }

    const headingForward = forwardVector();
    const speedAlongHeading = velocity.dot(headingForward);
    const maxSpeed = speedAlongHeading >= 0 ? maxForwardSpeed : carConfig.maxReverseSpeed;
    if (speed > maxSpeed) {
      velocity.multiplyScalar(maxSpeed / speed);
    }

    physics.playerBody.setRotation(rapierRotationFromYaw(state.heading), true);
    physics.playerBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    physics.playerBody.setLinvel(
      {
        x: velocity.x,
        y: clamp(verticalVelocity, -12, 12),
        z: velocity.y
      },
      true
    );
  }

  function drainPhysicsEvents() {
    if (!physics?.playerCollider || !physics?.playerBody) {
      return;
    }

    physics.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      if (!started) {
        return;
      }

      if (handle1 !== physics.playerCollider.handle && handle2 !== physics.playerCollider.handle) {
        return;
      }

      const otherHandle = handle1 === physics.playerCollider.handle ? handle2 : handle1;
      const tag = physics.colliderTags.get(otherHandle);
      const current = physics.playerBody.linvel();
      let responseVelocity = null;

      if (tag === "rail") {
        const impactNormal = currentRailImpactNormal();
        responseVelocity = resolveRailImpactVelocity(
          new THREE.Vector2(current.x, current.z),
          impactNormal
        );
        separatePlayerFromImpact(impactNormal, 0.18);
        physics.playerBody.setLinvel({ x: responseVelocity.x, y: current.y, z: responseVelocity.y }, true);
        state.boostSeconds = 0;
        state.drifting = false;
        state.stoppedByImpactSeconds = Math.max(state.stoppedByImpactSeconds, collisionConfig.stopSeconds);
      } else if (tag === "obstacle") {
        const impactNormal = currentObstacleImpactNormal(otherHandle);
        responseVelocity = resolveImpactVelocity(
          new THREE.Vector2(current.x, current.z),
          impactNormal,
          0.28,
          0.34
        );
        separatePlayerFromImpact(impactNormal, 0.22);
        physics.playerBody.setLinvel({ x: responseVelocity.x, y: current.y, z: responseVelocity.y }, true);
        state.boostSeconds = 0;
        state.drifting = false;
        state.stoppedByImpactSeconds = Math.max(state.stoppedByImpactSeconds, collisionConfig.stopSeconds);
      } else if (tag === "opponent" && raceState.opponentEnabled) {
        const opponentDelta = state.position.clone().sub(opponentState.position).normalize();
        responseVelocity = resolveImpactVelocity(
          new THREE.Vector2(current.x, current.z),
          opponentDelta.lengthSq() > 0.0001 ? opponentDelta : forwardVector(),
          0.56,
          0.24
        );
        physics.playerBody.setLinvel({ x: responseVelocity.x, y: current.y, z: responseVelocity.y }, true);
        state.boostSeconds = 0;
        state.drifting = false;
        state.stoppedByImpactSeconds = Math.max(state.stoppedByImpactSeconds, collisionConfig.carStopSeconds);
        opponentState.collisionHoldSeconds = Math.max(
          opponentState.collisionHoldSeconds,
          collisionConfig.opponentPauseSeconds
        );
      }

      if (responseVelocity && responseVelocity.lengthSq() > 0.4) {
        state.heading = Math.atan2(responseVelocity.x, responseVelocity.y);
      }
    });
  }

  function currentRailImpactNormal() {
    const sample = trackSamples[state.trackIndex];
    const delta = state.position.clone().sub(sample.center);
    const side = Math.sign(delta.dot(sample.normal)) || 1;
    return sample.normal.clone().multiplyScalar(side).normalize();
  }

  function currentObstacleImpactNormal(handle) {
    const obstacle = physics?.colliderMeta.get(handle);
    if (!obstacle) {
      return currentRailImpactNormal();
    }

    const delta = state.position.clone().sub(new THREE.Vector2(obstacle.x, obstacle.z));
    if (delta.lengthSq() <= 0.0001) {
      return forwardVector().multiplyScalar(-1);
    }

    return delta.normalize();
  }

  function resolveRailImpactVelocity(velocity, surfaceNormal) {
    const trackTangent = trackSamples[state.trackIndex].tangent.clone();
    const tangentDirection = velocity.dot(trackTangent) >= 0 ? 1 : -1;
    const slideDirection = trackTangent.multiplyScalar(tangentDirection);
    const forwardTrackSpeed = Math.abs(velocity.dot(slideDirection));
    const slideFloor = state.throttle > 0.1 ? 3.8 : 1.6;
    const slideVelocity = slideDirection.multiplyScalar(Math.max(forwardTrackSpeed * 0.62, slideFloor));
    const bounceVelocity = resolveImpactVelocity(velocity, surfaceNormal, 0.34, 0.28);

    return slideVelocity.add(bounceVelocity).clampLength(0, playerMaxForwardSpeed() * 0.76);
  }

  function separatePlayerFromImpact(surfaceNormal, distance) {
    if (!physics?.playerBody || distance <= 0) {
      return;
    }

    const translation = physics.playerBody.translation();
    physics.playerBody.setTranslation(
      {
        x: translation.x + surfaceNormal.x * distance,
        y: translation.y,
        z: translation.z + surfaceNormal.y * distance
      },
      true
    );
  }

  function resolveImpactVelocity(velocity, surfaceNormal, tangentDamping, bounceFactor) {
    const normal = surfaceNormal.clone().normalize();
    const tangent = new THREE.Vector2(-normal.y, normal.x);
    const normalSpeed = velocity.dot(normal);
    const tangentSpeed = velocity.dot(tangent);
    const bouncedNormalSpeed = normalSpeed > 0 ? -normalSpeed * bounceFactor : normalSpeed * 0.2;

    return tangent.multiplyScalar(tangentSpeed * tangentDamping)
      .add(normal.multiplyScalar(bouncedNormalSpeed));
  }

  function updateRaceState(deltaSeconds) {
    state.lapLockSeconds = Math.max(0, state.lapLockSeconds - deltaSeconds);
    if (raceState.opponentEnabled) {
      opponentState.lapLockSeconds = Math.max(0, opponentState.lapLockSeconds - deltaSeconds);
    }

    advanceLapCounter(state, state.velocity.dot(trackSamples[state.trackIndex].tangent));
    if (raceState.opponentEnabled) {
      advanceLapCounter(opponentState, opponentConfig.speed);
    }

    raceState.playerPlace = raceState.opponentEnabled && playerRaceDistance() < opponentRaceDistance() ? 2 : 1;

    if (state.completedLaps >= raceConfig.totalLaps) {
      finishRace("player");
    } else if (raceState.opponentEnabled && opponentState.completedLaps >= raceConfig.totalLaps) {
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
    state.drifting = false;
    keyState.clear();
    physics?.playerBody?.setLinvel({ x: 0, y: 0, z: 0 }, true);
    physics?.playerBody?.setAngvel({ x: 0, y: 0, z: 0 }, true);
    showResultOverlay(winner);
    updateHud();
  }

  function updateCarTransform() {
    car.position.set(state.position.x, 0, state.position.y);
    car.rotation.y = state.heading;
    car.rotation.z = -state.steering * Math.min(0.12, state.velocity.length() * 0.004);
  }

  function updateOpponentTransform() {
    opponentCar.visible = raceState.opponentEnabled;
    if (!raceState.opponentEnabled) {
      return;
    }

    opponentCar.position.set(opponentState.position.x, 0, opponentState.position.y);
    opponentCar.rotation.y = opponentState.heading;
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

    if (!raceState.opponentEnabled) {
      return "单人跑";
    }

    if (state.stoppedByImpactSeconds > 0) {
      return "碰撞恢复";
    }

    if (state.boostSeconds > 0) {
      return "加速中";
    }

    if (state.drifting) {
      return "漂移中";
    }

    if (!state.onRoad) {
      return "草地减速";
    }

    return raceState.playerPlace === 1 ? "领先" : "追赶中";
  }

  function resetRace() {
    hideResultOverlay();

    const start = trackProfileAtProgress(raceConfig.startProgress);
    const startPosition = start.center.clone().add(start.normal.clone().multiplyScalar(2.8));

    state.position.copy(startPosition);
    state.velocity.set(0, 0);
    state.heading = start.heading;
    state.steering = 0;
    state.throttle = 0;
    state.brake = 0;
    state.onRoad = true;
    state.stoppedByImpactSeconds = 0;
    state.previousPosition.copy(startPosition);
    state.previousTrackIndex = Math.round(raceConfig.startProgress * trackConfig.samples) % trackConfig.samples;
    state.trackIndex = Math.round(raceConfig.startProgress * trackConfig.samples) % trackConfig.samples;
    state.trackProgress = raceConfig.startProgress;
    state.raceProgress = 0;
    state.lastRaceProgress = 0;
    state.completedLaps = 0;
    state.lapLockSeconds = 0;
    state.lapArmed = false;
    state.boostSeconds = 0;
    state.boostCharges = boostConfig.charges;
    state.drifting = false;

    opponentState.progress = opponentConfig.startProgress;
    opponentState.laneOffset = opponentConfig.laneOffset;
    opponentState.collisionHoldSeconds = 0;
    opponentState.raceProgress = 0;
    opponentState.lastRaceProgress = 0;
    opponentState.completedLaps = 0;
    opponentState.lapLockSeconds = 0;
    opponentState.lapArmed = false;

    raceState.finished = false;
    raceState.winner = "";
    raceState.playerPlace = 1;

    syncPlayerTrackMetrics();
    syncOpponentPose();
    setPlayerBodyPose(startPosition, start.heading);
    setOpponentBodyPose(opponentState.position, opponentState.heading);
    if (physics?.opponentCollider) {
      physics.opponentCollider.setEnabled(raceState.opponentEnabled);
    }
    syncPlayerPhysicsState(state.trackIndex);
    syncOpponentPhysicsState();
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

  function toggleOpponent() {
    raceState.opponentEnabled = !raceState.opponentEnabled;
    opponentState.collisionHoldSeconds = 0;
    raceState.playerPlace = 1;
    if (physics?.opponentCollider) {
      physics.opponentCollider.setEnabled(raceState.opponentEnabled);
    }
    updateOpponentTransform();
    updateHud();
    return raceState.opponentEnabled;
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
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "KeyH", "KeyR"].includes(event.code)) {
      event.preventDefault();
    }

    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
      keyState.add(event.code);
    }

    if (event.code === "KeyE" && !event.repeat) {
      activateBoost();
    }

    if (event.code === "KeyH" && !event.repeat) {
      toggleOpponent();
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
    const baseSamples = Array.from(
      { length: trackConfig.samples },
      (_, index) => sampleTrack(index / trackConfig.samples)
    );
    const baseHalfWidth = trackConfig.width / 2;
    const minHalfWidth = baseHalfWidth * trackShapeConfig.minHalfWidthScale;
    let halfWidths = baseSamples.map((_, index) => {
      const previous = baseSamples[wrapIndex(index - 1, baseSamples.length)];
      const next = baseSamples[wrapIndex(index + 1, baseSamples.length)];
      const dot = clamp(previous.tangent.dot(next.tangent), -1, 1);
      const turnAngle = Math.acos(dot);
      const span = previous.center.distanceTo(next.center);
      const radiusEstimate = turnAngle < 0.0001 ? Number.POSITIVE_INFINITY : span / turnAngle;
      const widthScale = clamp(
        radiusEstimate / (baseHalfWidth * trackShapeConfig.curvatureRadiusFactor),
        trackShapeConfig.minHalfWidthScale,
        1
      );
      return Math.max(minHalfWidth, baseHalfWidth * widthScale);
    });

    for (let pass = 0; pass < trackShapeConfig.widthSmoothingPasses; pass += 1) {
      halfWidths = halfWidths.map((width, index) => {
        const previous = halfWidths[wrapIndex(index - 1, halfWidths.length)];
        const next = halfWidths[wrapIndex(index + 1, halfWidths.length)];
        return clamp(previous * 0.25 + width * 0.5 + next * 0.25, minHalfWidth, baseHalfWidth);
      });
    }

    return baseSamples.map((sample, index) => {
      const halfWidth = halfWidths[index];
      return {
        ...sample,
        halfWidth,
        railOffset: halfWidth + 1.08,
        roadLimit: Math.max(halfWidth - 0.3, 2.8),
        railLimit: halfWidth + 1.0
      };
    });
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

  function trackProfileAtProgress(progress) {
    const base = sampleTrack(progress);
    const profile = trackSamples[Math.round(wrapProgress(progress) * trackConfig.samples) % trackConfig.samples];
    return {
      ...base,
      halfWidth: profile.halfWidth,
      railOffset: profile.railOffset,
      roadLimit: profile.roadLimit,
      railLimit: profile.railLimit
    };
  }

  function syncOpponentPose() {
    const sample = trackProfileAtProgress(opponentState.progress);
    const laneOffset = clamp(
      opponentState.laneOffset,
      -sample.railLimit + 1.4,
      sample.railLimit - 1.4
    );
    const position = sample.center.clone().add(sample.normal.clone().multiplyScalar(laneOffset));

    opponentState.position.copy(position);
    opponentState.heading = sample.heading;
    return sample;
  }

  function syncPlayerTrackMetrics(preferredIndex = state.trackIndex) {
    const nearest = closestTrackSample(state.position, preferredIndex);
    state.trackIndex = nearest.index;
    state.trackProgress = nearest.progress;
    state.raceProgress = relativeRaceProgress(nearest.progress);
    state.onRoad = nearest.distance <= nearest.sample.roadLimit;
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
      distance: Math.sqrt(bestDistanceSq),
      sample: trackSamples[bestIndex]
    };
  }

  function trackDistanceFromIndex(position, preferredIndex) {
    return closestTrackSample(position, preferredIndex).distance;
  }

  function nearestRoadDistance(position) {
    return closestTrackSample(position).distance;
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

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function registerDebugApi() {
    globalThis.__ackGamesDebug = globalThis.__ackGamesDebug || {};
    globalThis.__ackGamesDebug.racing = {
      activateBoost,
      resetRace,
      placeCollisionScenario,
      toggleOpponent,
      getState: () => ({
        lapText: formatLapDisplay(state.completedLaps),
        completedLaps: state.completedLaps,
        lapArmed: state.lapArmed,
        boostSeconds: Number(state.boostSeconds.toFixed(2)),
        boostCharges: state.boostCharges,
        drifting: state.drifting,
        speedKmh: Math.round(state.velocity.length() * 3.6),
        playerMaxForwardSpeed: playerMaxForwardSpeed(),
        status: currentStatusLabel(),
        opponentEnabled: raceState.opponentEnabled,
        playerPosition: { x: Number(state.position.x.toFixed(2)), y: Number(state.position.y.toFixed(2)) },
        opponentPosition: {
          x: Number(opponentState.position.x.toFixed(2)),
          y: Number(opponentState.position.y.toFixed(2))
        },
        opponentHoldSeconds: Number(opponentState.collisionHoldSeconds.toFixed(2)),
        carDistance: Number(state.position.distanceTo(opponentState.position).toFixed(2)),
        flameStates: (car?.userData.boostFlames || []).map((flame) => ({
          visible: flame.visible,
          opacity: Number((flame.material.opacity || 0).toFixed(2))
        }))
      })
    };
  }

  function placeCollisionScenario() {
    const opponentProgress = 0.12;
    const laneOffset = 0;
    const playerProgress = wrapProgress(opponentProgress + 0.0065);
    const playerSample = trackProfileAtProgress(playerProgress);

    opponentState.progress = opponentProgress;
    opponentState.laneOffset = laneOffset;
    opponentState.collisionHoldSeconds = 0;
    syncOpponentPose();

    state.position.copy(playerSample.center.clone().add(playerSample.normal.clone().multiplyScalar(laneOffset)));
    state.previousPosition.copy(state.position);
    state.velocity.set(0, 0);
    state.heading = playerSample.heading;
    state.steering = 0;
    state.throttle = 0;
    state.brake = 0;
    state.onRoad = true;
    state.stoppedByImpactSeconds = 0;
    state.boostSeconds = 0;
    state.drifting = false;
    syncPlayerTrackMetrics();
    state.previousTrackIndex = state.trackIndex;
    setOpponentBodyPose(opponentState.position, opponentState.heading);
    setPlayerBodyPose(state.position, state.heading);
    if (physics?.opponentCollider) {
      physics.opponentCollider.setEnabled(true);
    }
    syncPlayerPhysicsState(state.trackIndex);
    syncOpponentPhysicsState();

    if (car && opponentCar && camera && renderer) {
      updateCarTransform();
      updateOpponentTransform();
      updateCamera(1 / 60);
      renderer.render(scene, camera);
    }
  }

  registerDebugApi();
  resetButton.addEventListener("click", handleResetButtonClick);
  playAgainButton.addEventListener("click", handleResetButtonClick);

  return { start, stop, reset: resetRace, destroy };
}
