import * as THREE from "three";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/loaders/DRACOLoader.js";
import { toCreasedNormals } from "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/utils/BufferGeometryUtils.js";
import RAPIER from "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.3/+esm";
import {
  getDefaultOpponentRacingCarId,
  getRacingCarById,
  racingCarCatalog,
  racingSceneConfig
} from "./racing-car-config.js";
import { loadActiveRacingStartConfig, saveActiveRacingStartConfig } from "./racing-start-config.js";
import { TRACK_SURFACES, loadSelectedRacingMap } from "./racing-map.js";
import {
  buildTrackModel,
  getOpenFinishProgress,
  getTrackModeForShape,
  isLoopTrackShape,
  projectPointOntoTrack,
  sampleTrackModel
} from "./racing-track.js";
import {
  disposeObject3DTree,
  disposePhysicsState,
  disposeRenderer,
  disposeSceneResources,
  markMaterialsOnlyDispose
} from "./racing-resource-cleanup.mjs";

const dracoDecoderPath = "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/libs/draco/";
const carSurfaceExclusionPatterns = [
  "wheel",
  "tire",
  "tyre",
  "rim",
  "interior",
  "seat",
  "trim",
  "light",
  "lamp",
  "mirror",
  "disc",
  "brake",
  "caliper",
  "badge",
  "logo",
  "grille",
  "grill"
];
const carModelLoader = createCarModelLoader();
const carTemplatePromises = new Map();
const distanceMarkerTextureCache = new Map();
const rapierReadyPromise = RAPIER.init();
const upAxis = new THREE.Vector3(0, 1, 0);
const tempQuaternion = new THREE.Quaternion();
const collisionDebugColors = {
  player: 0x44ff88,
  opponent: 0x4da3ff,
  rail: 0xf4d35e,
  heading: 0xff5d73,
  velocity: 0x5fe0ff,
  response: 0xff9f1c,
  impact: 0xff4d4d
};
const defaultDrivingFeelPresetId = "arcade";
const drivingFeelPresets = {
  balanced: {
    camera: {
      speedFovBoost: 0,
      speedFovResponse: 4,
      speedLookAheadBoost: 0,
      headingFollowTightness: 7.5
    },
    car: (isGravelSurface) => ({
      maxForwardSpeed: 50,
      maxReverseSpeed: 40 / 3.6,
      engineForce: 35,
      brakeForce: isGravelSurface ? 31 : 40,
      reverseForce: 15,
      drag: 0.028,
      rollingResistance: 0.76,
      roadGrip: isGravelSurface ? 6.4 : 9.4,
      grassGrip: 2.9,
      maxSteerRate: isGravelSurface ? 1.68 : 1.82
    }),
    handling: (isGravelSurface) => ({
      steeringResponse: 0.3,
      steeringReleaseResponse: 0.2,
      lowSpeedSteerBoost: 1.42,
      highSpeedSteerStart: 18,
      highSpeedSteerEnd: 42,
      highSpeedSteerMin: isGravelSurface ? 0.52 : 0.58,
      steerFactorFloor: isGravelSurface ? 0.42 : 0.48,
      driftEntrySpeed: isGravelSurface ? 7.4 : 9,
      driftSustainSpeed: isGravelSurface ? 5.8 : 6.5,
      driftSteerThreshold: isGravelSurface ? 0.18 : 0.22,
      driftGripMultiplier: isGravelSurface ? 0.16 : 0.2,
      driftBrakeMultiplier: 0.26,
      driftTurnMultiplier: isGravelSurface ? 1.58 : 1.48,
      driftYawAssist: isGravelSurface ? 0.74 : 0.62,
      launchBoostThreshold: 12,
      launchForceMultiplier: 1.18,
      grassTopSpeedMultiplier: 0.66,
      grassDragMultiplier: 1.55
    }),
    collision: {
      stopSeconds: 0.16,
      carStopSeconds: 0.12,
      opponentPauseSeconds: 0.36,
      playerOpponentForwardRetention: 0.48,
      playerOpponentMinForwardSpeed: 2.8,
      playerOpponentSideShove: 2.1,
      opponentImpactSpeedMultiplier: 0.52,
      opponentSpeedLoss: 2.4,
      opponentLaneKick: 1.15,
      opponentYawKick: 0.18,
      opponentLaneRecovery: 3.2,
      opponentYawRecovery: 3.8,
      headingResponseMinSpeed: 2.4,
      headingCorrectionMax: 0.38,
      headingIgnoreAngle: Math.PI * 0.65
    },
    railImpact: {
      slideSpeedRetention: 0.62,
      throttleSlideFloor: 3.8,
      coastSlideFloor: 1.6,
      tangentDamping: 0.34,
      bounceFactor: 0.28,
      maxSpeedMultiplier: 0.76
    }
  },
  arcade: {
    camera: {
      fov: 58,
      followDistance: 9.8,
      height: 5.4,
      lookAhead: 6.2,
      targetHeight: 1.55,
      followTightness: 6.8,
      speedFovBoost: 8,
      speedFovResponse: 5.4,
      speedLookAheadBoost: 1.2,
      headingFollowTightness: 5.2
    },
    car: (isGravelSurface) => ({
      maxForwardSpeed: 50,
      maxReverseSpeed: 40 / 3.6,
      engineForce: 42,
      brakeForce: isGravelSurface ? 35 : 44,
      reverseForce: 16,
      drag: 0.024,
      rollingResistance: 0.68,
      roadGrip: isGravelSurface ? 8 : 11.2,
      grassGrip: 3.8,
      maxSteerRate: isGravelSurface ? 1.82 : 1.96
    }),
    handling: (isGravelSurface) => ({
      steeringResponse: 0.45,
      steeringReleaseResponse: 0.32,
      lowSpeedSteerBoost: 1.5,
      highSpeedSteerStart: 20,
      highSpeedSteerEnd: 46,
      highSpeedSteerMin: isGravelSurface ? 0.68 : 0.74,
      steerFactorFloor: isGravelSurface ? 0.6 : 0.64,
      driftEntrySpeed: isGravelSurface ? 6.9 : 7.5,
      driftSustainSpeed: isGravelSurface ? 5.3 : 5.8,
      driftSteerThreshold: isGravelSurface ? 0.12 : 0.14,
      driftGripMultiplier: isGravelSurface ? 0.26 : 0.3,
      driftBrakeMultiplier: 0.36,
      driftTurnMultiplier: isGravelSurface ? 1.72 : 1.6,
      driftYawAssist: isGravelSurface ? 0.92 : 0.85,
      launchBoostThreshold: 15,
      launchForceMultiplier: 1.35,
      grassTopSpeedMultiplier: 0.78,
      grassDragMultiplier: 1
    }),
    collision: {
      stopSeconds: 0.11,
      carStopSeconds: 0.08,
      opponentPauseSeconds: 0.22,
      playerOpponentForwardRetention: 0.62,
      playerOpponentMinForwardSpeed: 4.2,
      playerOpponentSideShove: 3.2,
      opponentImpactSpeedMultiplier: 0.64,
      opponentSpeedLoss: 2.8,
      opponentLaneKick: 1.55,
      opponentYawKick: 0.24,
      opponentLaneRecovery: 4.6,
      opponentYawRecovery: 5.4,
      headingResponseMinSpeed: 2.8,
      headingCorrectionMax: 0.32,
      headingIgnoreAngle: Math.PI * 0.62
    },
    railImpact: {
      slideSpeedRetention: 0.78,
      throttleSlideFloor: 5.4,
      coastSlideFloor: 2.4,
      tangentDamping: 0.46,
      bounceFactor: 0.22,
      maxSpeedMultiplier: 0.84
    }
  }
};

function resolveDrivingFeelPreset(presetId, isGravelSurface) {
  const preset = drivingFeelPresets[presetId] ?? drivingFeelPresets[defaultDrivingFeelPresetId];
  return {
    id: drivingFeelPresets[presetId] ? presetId : defaultDrivingFeelPresetId,
    camera: { ...preset.camera },
    car: preset.car(isGravelSurface),
    handling: preset.handling(isGravelSurface),
    collision: { ...preset.collision },
    railImpact: { ...preset.railImpact }
  };
}

function createCarModelLoader() {
  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(dracoDecoderPath);
  loader.setDRACOLoader(dracoLoader);
  return loader;
}

export function createRacingGame({ onHome = () => {}, onEditMap = () => {} } = {}) {
  const mapData = loadSelectedRacingMap();
  const startConfig = loadActiveRacingStartConfig();
  const canvas = document.getElementById("racingCanvas");
  const hudOverlay = document.getElementById("racingHudOverlay");
  const progressLabel = document.getElementById("racingProgressLabel");
  const progressValue = document.getElementById("racingProgressValue");
  const placeValue = document.getElementById("racingPlaceValue");
  const speedValue = document.getElementById("racingSpeedValue");
  const boostValue = document.getElementById("racingBoostValue");
  const startOverlay = document.getElementById("racingStartOverlay");
  const startMapValue = document.getElementById("racingStartMapValue");
  const startModeValue = document.getElementById("racingStartModeValue");
  const startOpponentValue = document.getElementById("racingStartOpponentValue");
  const startStatus = document.getElementById("racingStartStatus");
  const selectedCarPanel = document.getElementById("racingSelectedCarPanel");
  const selectedCarPreviewCanvas = document.getElementById("racingSelectedCarPreview");
  const selectedCarBadge = document.getElementById("racingSelectedCarBadge");
  const selectedCarMake = document.getElementById("racingSelectedCarMake");
  const selectedCarName = document.getElementById("racingSelectedCarName");
  const selectedCarSummary = document.getElementById("racingSelectedCarSummary");
  const carOptions = document.getElementById("racingCarOptions");
  const startRaceButton = document.getElementById("racingStartRaceButton");
  const startEditorButton = document.getElementById("racingStartEditorButton");
  const startHomeButton = document.getElementById("racingStartHomeButton");
  const pauseOverlay = document.getElementById("racingPauseOverlay");
  const resumeButton = document.getElementById("racingResumeButton");
  const pauseResetButton = document.getElementById("racingPauseResetButton");
  const pauseEditorButton = document.getElementById("racingPauseEditorButton");
  const pauseHomeButton = document.getElementById("racingPauseHomeButton");
  const resultOverlay = document.getElementById("racingResultOverlay");
  const resultCard = document.getElementById("racingResultCard");
  const confetti = document.getElementById("racingConfetti");
  const resultTag = document.getElementById("racingResultTag");
  const resultTitle = document.getElementById("racingResultTitle");
  const resultSummary = document.getElementById("racingResultSummary");
  const resultPlayerLabel = document.getElementById("racingResultPlayerLabel");
  const resultPlayerValue = document.getElementById("racingResultPlayerValue");
  const resultOpponentLabel = document.getElementById("racingResultOpponentLabel");
  const resultOpponentValue = document.getElementById("racingResultOpponentValue");
  const playAgainButton = document.getElementById("racingPlayAgainButton");
  let selectedCarId = getRacingCarById(startConfig.playerCarId).id;
  const handleResumeButtonClick = () => setPaused(false);
  const handleStartRaceButtonClick = () => {
    beginRace();
  };
  const handleStartEditorButtonClick = () => {
    onEditMap();
  };
  const handleStartHomeButtonClick = () => {
    onHome();
  };
  const handlePauseResetButtonClick = () => {
    setPaused(false);
    resetRace();
  };
  const handlePauseEditorButtonClick = () => {
    setPaused(false);
    onEditMap();
  };
  const handlePauseHomeButtonClick = () => {
    setPaused(false);
    onHome();
  };
  const handleResetButtonClick = () => {
    setPaused(false);
    resetRace();
  };

  const visualScale = racingSceneConfig.visualScale || 1;
  const collisionScale = racingSceneConfig.collisionScale || visualScale;
  const trackWidth = racingSceneConfig.trackWidthOverride ?? mapData.track.width;
  const trackSurface = mapData.track.surface;
  const isGravelSurface = trackSurface === TRACK_SURFACES.GRAVEL;
  const drivingFeelPreset = resolveDrivingFeelPreset(
    racingSceneConfig.drivingFeelPreset ?? defaultDrivingFeelPresetId,
    isGravelSurface
  );
  const cameraConfig = {
    fov: drivingFeelPreset.camera.fov ?? racingSceneConfig.cameraFov ?? 58,
    followDistance: drivingFeelPreset.camera.followDistance ?? racingSceneConfig.cameraFollowDistance ?? 11.8,
    height: drivingFeelPreset.camera.height ?? racingSceneConfig.cameraHeight ?? 6.4,
    lookAhead: drivingFeelPreset.camera.lookAhead ?? racingSceneConfig.cameraLookAhead ?? 4.2,
    targetHeight: drivingFeelPreset.camera.targetHeight ?? racingSceneConfig.cameraTargetHeight ?? 1.1,
    followTightness: drivingFeelPreset.camera.followTightness ?? racingSceneConfig.cameraFollowTightness ?? 5.2,
    speedFovBoost: drivingFeelPreset.camera.speedFovBoost ?? 0,
    speedFovResponse: drivingFeelPreset.camera.speedFovResponse ?? 4,
    speedLookAheadBoost: drivingFeelPreset.camera.speedLookAheadBoost ?? 0,
    headingFollowTightness: drivingFeelPreset.camera.headingFollowTightness ?? 7
  };

  const trackConfig = {
    shape: mapData.track.shape,
    surface: trackSurface,
    width: trackWidth,
    samples: mapData.track.samples,
    startProgress: isLoopTrackShape(mapData.track.shape) ? mapData.track.startPosition.progress : 0,
    controlPoints: mapData.track.controlPoints.map((point) => [...point])
  };
  const trackModel = buildTrackModel(trackConfig);
  const trackSamples = trackModel.samples;
  const trackLength = trackModel.totalLength;
  const raceMode = getTrackModeForShape(trackConfig.shape);
  const raceModeLabel = raceMode === "lap" ? "闭环赛" : "点到点冲刺赛";

  const raceConfig = {
    mode: raceMode,
    totalLaps: 3,
    startProgress: trackConfig.startProgress,
    finishProgress: raceMode === "sprint" ? getOpenFinishProgress(trackModel) : trackConfig.startProgress,
    lapThreshold: 0.16,
    lapCooldownSeconds: 0.72,
    sprintGlideSeconds: 1.6,
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

  const railConfig = {
    sampleCount: 200,
    railHeight: 0.78,
    railRadius: 0.16,
    postHeight: 0.72,
    postSpacing: 5
  };

  const environmentConfig = racingSceneConfig.environment ?? {};
  const groundConfig = environmentConfig.ground ?? {};
  const foliageConfig = environmentConfig.foliage ?? {};
  const backdropConfig = environmentConfig.backdrop ?? {};
  const roadsidePropsConfig = environmentConfig.roadsideProps ?? {};
  const sceneBounds = computeTrackBounds(trackSamples);
  const sceneCenter = sceneBounds.center;
  const environmentScale = Math.max(1, trackLength / 650);
  const nearFieldPadding = 56;
  const farFieldPadding = 118;
  const nearFieldWidth = Math.max(groundConfig.nearFieldSize ?? 320, sceneBounds.width + nearFieldPadding * 2);
  const nearFieldDepth = Math.max(groundConfig.nearFieldSize ?? 320, sceneBounds.depth + nearFieldPadding * 2);
  const farFieldWidth = Math.max(groundConfig.farFieldSize ?? 460, sceneBounds.width + farFieldPadding * 2);
  const farFieldDepth = Math.max(groundConfig.farFieldSize ?? 460, sceneBounds.depth + farFieldPadding * 2);
  const groundRadius = Math.max(
    Math.hypot(farFieldWidth * 0.5, farFieldDepth * 0.5),
    sceneBounds.radius + 88
  );

  const carConfig = drivingFeelPreset.car;
  const handlingConfig = drivingFeelPreset.handling;
  const collisionConfig = drivingFeelPreset.collision;
  const railImpactConfig = drivingFeelPreset.railImpact;

  const opponentConfig = {
    speed: isGravelSurface ? Math.min(7.1, 26 / 3.6) : Math.min(8.2, 30 / 3.6),
    laneOffset: -2.7,
    startProgress: raceMode === "lap" ? raceConfig.startProgress : 0
  };

  const physicsConfig = {
    fixedHeight: 0.34 * collisionScale,
    carHalfWidth: 0.9 * collisionScale,
    carHalfHeight: 0.34 * collisionScale,
    carHalfLength: 1.55 * collisionScale,
    railHalfHeight: 0.56,
    railHalfDepth: 0.34,
    stepSeconds: 1 / 60
  };

  const keyState = new Set();
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
    trackProgress: raceMode === "lap" ? raceConfig.startProgress : 0,
    raceProgress: 0,
    lastRaceProgress: 0,
    maxForwardProgress: 0,
    maxForwardDistance: 0,
    finishTimeSeconds: null,
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
    collisionLaneOffset: 0,
    collisionYawOffset: 0,
    onRoad: true,
    collisionHoldSeconds: 0,
    currentSpeed: opponentConfig.speed,
    raceProgress: 0,
    lastRaceProgress: 0,
    maxForwardProgress: 0,
    maxForwardDistance: 0,
    finishTimeSeconds: null,
    completedLaps: 0,
    lapLockSeconds: 0,
    lapArmed: false
  };
  const raceState = {
    finished: false,
    resultVisible: false,
    winner: "",
    playerPlace: 1,
    opponentEnabled: true,
    paused: false,
    elapsedSeconds: 0,
    settleSeconds: 0
  };

  let renderer;
  let scene;
  let camera;
  let cameraHeading = 0;
  let car;
  let opponentCar;
  let initialized = false;
  let active = false;
  let listening = false;
  let animationFrameId = 0;
  let lastFrameTime = 0;
  let initializationPromise = null;
  let startRequestId = 0;
  let raceStarting = false;
  let physics = null;
  let runtimeToken = 0;
  let carPreviewRenderGeneration = 0;
  const carThumbnailUrls = new Map();
  const carThumbnailPromises = new Map();
  let carThumbnailQueue = Promise.resolve();
  let selectedCarPreviewRenderer = null;
  let selectedCarPreviewScene = null;
  let selectedCarPreviewCamera = null;
  let selectedCarPreviewShadowDisc = null;
  let selectedCarPreviewCar = null;
  let selectedCarPreviewMetrics = null;
  let selectedCarPreviewFrameId = 0;
  let selectedCarPreviewLastFrameTime = 0;
  let selectedCarPreviewAngle = THREE.MathUtils.degToRad(-30);
  let selectedCarPreviewSpinVelocity = 0;
  let selectedCarPreviewPointerId = null;
  let selectedCarPreviewLastPointerX = 0;
  let selectedCarPreviewLastPointerTime = 0;
  const collisionDebug = {
    enabled: false,
    group: null,
    hud: null,
    playerWire: null,
    opponentWire: null,
    headingArrow: null,
    velocityArrow: null,
    responseArrow: null,
    railWiresByHandle: new Map(),
    lastCollision: null
  };
  const debugApi = {
    activateBoost,
    resetRace,
    placeCollisionScenario,
    toggleOpponent,
    toggleCollisionDebug: () => setCollisionDebugEnabled(!collisionDebug.enabled),
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
      paused: raceState.paused,
      opponentEnabled: raceState.opponentEnabled,
      playerPosition: { x: Number(state.position.x.toFixed(2)), y: Number(state.position.y.toFixed(2)) },
      opponentPosition: {
        x: Number(opponentState.position.x.toFixed(2)),
        y: Number(opponentState.position.y.toFixed(2))
      },
      opponentHoldSeconds: Number(opponentState.collisionHoldSeconds.toFixed(2)),
      opponentLaneImpact: Number(opponentState.collisionLaneOffset.toFixed(2)),
      opponentYawImpact: Number(opponentState.collisionYawOffset.toFixed(2)),
      carDistance: Number(state.position.distanceTo(opponentState.position).toFixed(2)),
      playerCar: formatCarLabel(selectedCar()),
      opponentCar: formatCarLabel(opponentCarSelection()),
      drivingFeelPreset: drivingFeelPreset.id,
      visualScale,
      collisionScale,
      trackWidth: trackConfig.width,
      collider: {
        halfWidth: Number(physicsConfig.carHalfWidth.toFixed(2)),
        halfHeight: Number(physicsConfig.carHalfHeight.toFixed(2)),
        halfLength: Number(physicsConfig.carHalfLength.toFixed(2))
      },
      collisionDebugEnabled: collisionDebug.enabled,
      lastCollision: collisionDebug.lastCollision,
      flameStates: (car?.userData.boostFlames || []).map((flame) => ({
        visible: flame.visible,
        opacity: Number((flame.material.opacity || 0).toFixed(2))
      }))
    })
  };

  function start() {
    prepareConfetti();
    keyState.clear();
    setPaused(false);
    addListeners();
    active = true;
    updateCollisionDebugVisibility();
    showStartOverlay();
  }

  function stop() {
    active = false;
    startRequestId += 1;
    raceStarting = false;
    keyState.clear();
    setPaused(false);
    removeListeners();
    disposeCarOptionPreviews();
    startOverlay.hidden = true;
    pauseOverlay.hidden = true;
    resultOverlay.hidden = true;
    hudOverlay.hidden = true;
    updateCollisionDebugVisibility();

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }

    invalidateRuntime();
  }

  function destroy() {
    stop();
    startRaceButton.removeEventListener("click", handleStartRaceButtonClick);
    startEditorButton.removeEventListener("click", handleStartEditorButtonClick);
    startHomeButton.removeEventListener("click", handleStartHomeButtonClick);
    resumeButton.removeEventListener("click", handleResumeButtonClick);
    pauseResetButton.removeEventListener("click", handlePauseResetButtonClick);
    pauseEditorButton.removeEventListener("click", handlePauseEditorButtonClick);
    pauseHomeButton.removeEventListener("click", handlePauseHomeButtonClick);
    playAgainButton.removeEventListener("click", handleResetButtonClick);
    removeCollisionDebugHud();
    if (globalThis.__ackGamesDebug?.racing === debugApi) {
      delete globalThis.__ackGamesDebug.racing;
    }
  }

  function selectedCar() {
    return getRacingCarById(selectedCarId);
  }

  function opponentCarSelection() {
    return getRacingCarById(getDefaultOpponentRacingCarId(selectedCarId));
  }

  function formatCarLabel(carConfig) {
    return `${carConfig.make} ${carConfig.name}`;
  }

  function setStartStatus(message, isError = false) {
    startStatus.textContent = message;
    startStatus.classList.toggle("is-error", isError);
  }

  function renderCarOptions() {
    const rival = opponentCarSelection();
    const currentCar = selectedCar();
    startOpponentValue.textContent = rival.name;
    updateSelectedCarPanel(currentCar);
    carOptions.replaceChildren(
      ...racingCarCatalog.map((carConfig) => {
        const button = document.createElement("button");
        const isSelected = carConfig.id === selectedCarId;
        button.type = "button";
        button.className = `race-car-option${isSelected ? " is-selected" : ""}`;
        button.dataset.carId = carConfig.id;
        button.style.setProperty("--car-accent", carConfig.accentColor);
        button.setAttribute("aria-pressed", String(isSelected));
        button.innerHTML = `
          <span class="race-car-hero" aria-hidden="true">
            <img class="race-car-thumbnail" alt="" data-car-id="${carConfig.id}">
            <span class="race-car-option-top">
              <span class="race-car-badge">${carConfig.tag}</span>
              <span class="race-car-picked">${isSelected ? "当前选择" : "可选择"}</span>
            </span>
          </span>
          <span class="race-car-copy">
            <strong class="race-car-name">${carConfig.name}</strong>
            <span class="race-car-meta">${carConfig.make}</span>
          </span>
        `;
        button.addEventListener("click", () => {
          selectedCarId = carConfig.id;
          renderCarOptions();
          setStartStatus(`已选择 ${formatCarLabel(selectedCar())}。`);
        });
        const thumbnail = button.querySelector(".race-car-thumbnail");
        if (thumbnail instanceof HTMLImageElement) {
          void hydrateCarOptionThumbnail(thumbnail, carConfig);
        }
        return button;
      })
    );
    scheduleSelectedCarPreview(currentCar);
  }

  function disposeCarOptionPreviews() {
    carPreviewRenderGeneration += 1;
    endSelectedCarPreviewDrag();
    if (selectedCarPreviewFrameId) {
      cancelAnimationFrame(selectedCarPreviewFrameId);
      selectedCarPreviewFrameId = 0;
    }
    disposeSelectedCarPreviewCar();
    disposeCarThumbnailCache();
    if (selectedCarPreviewRenderer) {
      disposeSceneResources(selectedCarPreviewScene);
      disposeRenderer(selectedCarPreviewRenderer);
      selectedCarPreviewRenderer = null;
    }
    selectedCarPreviewScene = null;
    selectedCarPreviewCamera = null;
    selectedCarPreviewShadowDisc = null;
    selectedCarPreviewLastFrameTime = 0;
  }

  function updateSelectedCarPanel(carConfig) {
    selectedCarPanel.style.setProperty("--car-accent", carConfig.accentColor);
    selectedCarBadge.textContent = carConfig.tag;
    selectedCarMake.textContent = carConfig.make;
    selectedCarName.textContent = carConfig.name;
    selectedCarSummary.textContent = carConfig.summary;
  }

  function scheduleSelectedCarPreview(carConfig) {
    carPreviewRenderGeneration += 1;
    const renderGeneration = carPreviewRenderGeneration;
    resetSelectedCarPreviewScene();
    requestAnimationFrame(() => {
      if (renderGeneration !== carPreviewRenderGeneration || !isStartOverlayVisible()) {
        return;
      }

      void renderSelectedCarPreview(carConfig, renderGeneration);
    });
  }

  function resetSelectedCarPreviewScene() {
    endSelectedCarPreviewDrag();
    if (selectedCarPreviewFrameId) {
      cancelAnimationFrame(selectedCarPreviewFrameId);
      selectedCarPreviewFrameId = 0;
    }
    disposeSelectedCarPreviewCar();
    selectedCarPreviewLastFrameTime = 0;
    selectedCarPreviewSpinVelocity = 0;
    selectedCarPreviewAngle = THREE.MathUtils.degToRad(-30);
  }

  function disposeSelectedCarPreviewCar() {
    if (selectedCarPreviewCar) {
      disposeObject3DTree(selectedCarPreviewCar);
    }
    selectedCarPreviewCar = null;
    selectedCarPreviewMetrics = null;
  }

  function disposeCarThumbnailCache() {
    carThumbnailUrls.clear();
    carThumbnailPromises.clear();
    carThumbnailQueue = Promise.resolve();
  }

  function ensureSelectedCarPreviewRenderer() {
    if (selectedCarPreviewRenderer && selectedCarPreviewScene && selectedCarPreviewCamera) {
      return;
    }

    selectedCarPreviewRenderer = new THREE.WebGLRenderer({
      canvas: selectedCarPreviewCanvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
    selectedCarPreviewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    selectedCarPreviewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    selectedCarPreviewRenderer.toneMappingExposure = 1.08;

    selectedCarPreviewScene = new THREE.Scene();
    selectedCarPreviewCamera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 100);
    selectedCarPreviewScene.add(new THREE.HemisphereLight(0xdbeeff, 0x14202c, 1.7));

    const keyLight = new THREE.DirectionalLight(0xfff1d8, 2.2);
    keyLight.position.set(7, 8, -8);
    selectedCarPreviewScene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x7fc2ff, 1.2);
    fillLight.position.set(-6, 3, 5);
    selectedCarPreviewScene.add(fillLight);

    selectedCarPreviewShadowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(4.8, 48),
      new THREE.MeshBasicMaterial({ color: 0x02060c, transparent: true, opacity: 0.22 })
    );
    selectedCarPreviewShadowDisc.rotation.x = -Math.PI / 2;
    selectedCarPreviewShadowDisc.position.y = -0.02;
    selectedCarPreviewScene.add(selectedCarPreviewShadowDisc);
    resizeSelectedCarPreview();
  }

  async function renderSelectedCarPreview(carConfig, renderGeneration) {
    ensureSelectedCarPreviewRenderer();
    const previewCar = await buildCarPreviewObject(carConfig);
    if (
      renderGeneration !== carPreviewRenderGeneration ||
      !selectedCarPreviewCanvas.isConnected ||
      !selectedCarPreviewScene ||
      !selectedCarPreviewCamera ||
      !selectedCarPreviewShadowDisc
    ) {
      return;
    }

    selectedCarPreviewCar = previewCar;
    selectedCarPreviewMetrics = measurePreviewCar(previewCar);
    selectedCarPreviewScene.add(previewCar);
    configurePreviewCamera(selectedCarPreviewCamera, selectedCarPreviewShadowDisc, selectedCarPreviewMetrics);
    applyPreviewAngle(previewCar, selectedCarPreviewAngle);
    renderSelectedCarPreviewFrame();
    startSelectedCarPreviewLoop();
  }

  function startSelectedCarPreviewLoop() {
    if (selectedCarPreviewFrameId) {
      return;
    }

    selectedCarPreviewFrameId = requestAnimationFrame(tickSelectedCarPreview);
  }

  function tickSelectedCarPreview(timestamp) {
    if (
      !selectedCarPreviewRenderer ||
      !selectedCarPreviewScene ||
      !selectedCarPreviewCamera ||
      !selectedCarPreviewCar ||
      !isStartOverlayVisible()
    ) {
      selectedCarPreviewFrameId = 0;
      return;
    }

    if (selectedCarPreviewLastFrameTime > 0) {
      const deltaSeconds = Math.min((timestamp - selectedCarPreviewLastFrameTime) / 1000, 0.05);
      if (selectedCarPreviewPointerId === null) {
        selectedCarPreviewAngle +=
          THREE.MathUtils.degToRad(10) * deltaSeconds +
          selectedCarPreviewSpinVelocity * deltaSeconds;
        selectedCarPreviewSpinVelocity *= 0.9;
        if (Math.abs(selectedCarPreviewSpinVelocity) < 0.01) {
          selectedCarPreviewSpinVelocity = 0;
        }
        applyPreviewAngle(selectedCarPreviewCar, selectedCarPreviewAngle);
        renderSelectedCarPreviewFrame();
      }
    } else {
      renderSelectedCarPreviewFrame();
    }

    selectedCarPreviewLastFrameTime = timestamp;
    selectedCarPreviewFrameId = requestAnimationFrame(tickSelectedCarPreview);
  }

  function applyPreviewAngle(previewCar, angle) {
    previewCar.rotation.y = angle;
  }

  function measurePreviewCar(previewCar) {
    const previewBounds = new THREE.Box3().setFromObject(previewCar);
    const previewSize = previewBounds.getSize(new THREE.Vector3());
    return {
      length: Math.max(previewSize.z, 6.8),
      focusY: Math.max(0.9, Math.max(previewSize.y, 1.6) * 0.44)
    };
  }

  function configurePreviewCamera(previewCamera, shadowDisc, previewMetrics) {
    shadowDisc.scale.set(previewMetrics.length * 0.72, previewMetrics.length * 0.56, 1);
    previewCamera.position.set(
      previewMetrics.length * 0.38,
      previewMetrics.focusY + 0.9,
      -previewMetrics.length * 1.02
    );
    previewCamera.lookAt(0, previewMetrics.focusY, previewMetrics.length * 0.08);
  }

  function renderSelectedCarPreviewFrame() {
    if (!selectedCarPreviewRenderer || !selectedCarPreviewScene || !selectedCarPreviewCamera) {
      return;
    }

    selectedCarPreviewRenderer.render(selectedCarPreviewScene, selectedCarPreviewCamera);
  }

  async function hydrateCarOptionThumbnail(imageElement, carConfig) {
    const thumbnailUrl = await ensureCarThumbnail(carConfig);
    if (!thumbnailUrl || !imageElement.isConnected || imageElement.dataset.carId !== carConfig.id) {
      return;
    }

    imageElement.src = thumbnailUrl;
  }

  function ensureCarThumbnail(carConfig) {
    if (carThumbnailUrls.has(carConfig.id)) {
      return Promise.resolve(carThumbnailUrls.get(carConfig.id));
    }

    if (carThumbnailPromises.has(carConfig.id)) {
      return carThumbnailPromises.get(carConfig.id);
    }

    const thumbnailPromise = (carThumbnailQueue = carThumbnailQueue
      .catch(() => null)
      .then(async () => {
        const thumbnailUrl = await renderCarThumbnail(carConfig);
        if (thumbnailUrl) {
          carThumbnailUrls.set(carConfig.id, thumbnailUrl);
        }
        return thumbnailUrl;
      }))
      .finally(() => {
        carThumbnailPromises.delete(carConfig.id);
      });

    carThumbnailPromises.set(carConfig.id, thumbnailPromise);
    return thumbnailPromise;
  }

  async function renderCarThumbnail(carConfig) {
    const previewCanvas = document.createElement("canvas");
    previewCanvas.width = 640;
    previewCanvas.height = 360;

    const previewRenderer = new THREE.WebGLRenderer({
      canvas: previewCanvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance"
    });
    previewRenderer.setPixelRatio(1);
    previewRenderer.setSize(640, 360, false);
    previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    previewRenderer.toneMappingExposure = 1.08;

    const previewScene = new THREE.Scene();
    const previewCamera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 100);
    previewScene.add(new THREE.HemisphereLight(0xdbeeff, 0x14202c, 1.7));

    const keyLight = new THREE.DirectionalLight(0xfff1d8, 2.2);
    keyLight.position.set(7, 8, -8);
    previewScene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x7fc2ff, 1.2);
    fillLight.position.set(-6, 3, 5);
    previewScene.add(fillLight);

    const shadowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(4.8, 48),
      new THREE.MeshBasicMaterial({ color: 0x02060c, transparent: true, opacity: 0.22 })
    );
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = -0.02;
    previewScene.add(shadowDisc);

    const previewCar = await buildCarPreviewObject(carConfig);
    previewScene.add(previewCar);
    configurePreviewCamera(previewCamera, shadowDisc, measurePreviewCar(previewCar));
    applyPreviewAngle(previewCar, THREE.MathUtils.degToRad(-30));
    previewRenderer.render(previewScene, previewCamera);

    const thumbnailUrl = previewCanvas.toDataURL("image/png");
    disposeSceneResources(previewScene);
    disposeRenderer(previewRenderer, { loseContext: true });
    return thumbnailUrl;
  }

  async function buildCarPreviewObject(carConfig) {
    const template = await loadCarTemplate(carConfig);
    return template
      ? buildPreviewCarFromTemplate(template)
      : createFallbackCar(carConfig, Number.parseInt(carConfig.accentColor.slice(1), 16));
  }

  function buildPreviewCarFromTemplate(template) {
    const previewCar = new THREE.Group();
    const previewVisualRoot = new THREE.Group();
    const previewModel = template.clone(true);

    cloneCarMaterials(previewModel);
    markMaterialsOnlyDispose(previewModel);
    applyConfiguredCarTint(previewModel, template.userData?.carSpec ?? null);
    previewVisualRoot.add(previewModel);
    previewVisualRoot.position.y = racingSceneConfig.groundOffset;
    previewCar.add(previewVisualRoot);
    return previewCar;
  }

  function showStartOverlay() {
    hideResultOverlay();
    pauseOverlay.hidden = true;
    hudOverlay.hidden = true;
    startOverlay.hidden = false;
    startMapValue.textContent = mapData.name;
    startModeValue.textContent = raceModeLabel;
    startRaceButton.textContent = raceMode === "lap" ? "开始闭环赛" : "开始冲刺赛";
    startRaceButton.disabled = false;
    startEditorButton.disabled = false;
    startHomeButton.disabled = false;
    renderCarOptions();
    setStartStatus(`已选择 ${formatCarLabel(selectedCar())}。`);
  }

  function hideStartOverlay() {
    startOverlay.hidden = true;
    hudOverlay.hidden = false;
    disposeCarOptionPreviews();
  }

  function isStartOverlayVisible() {
    return !startOverlay.hidden;
  }

  function ensureCollisionDebugHud() {
    if (collisionDebug.hud) {
      return collisionDebug.hud;
    }

    const hud = document.createElement("pre");
    hud.setAttribute("aria-hidden", "true");
    hud.style.position = "fixed";
    hud.style.top = "16px";
    hud.style.right = "16px";
    hud.style.zIndex = "40";
    hud.style.margin = "0";
    hud.style.padding = "12px 14px";
    hud.style.minWidth = "260px";
    hud.style.maxWidth = "360px";
    hud.style.borderRadius = "12px";
    hud.style.background = "rgba(7, 10, 16, 0.82)";
    hud.style.border = "1px solid rgba(255, 255, 255, 0.14)";
    hud.style.boxShadow = "0 18px 40px rgba(0, 0, 0, 0.28)";
    hud.style.color = "#dce8f2";
    hud.style.font = "12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace";
    hud.style.whiteSpace = "pre-wrap";
    hud.style.pointerEvents = "none";
    hud.hidden = true;
    document.body.append(hud);
    collisionDebug.hud = hud;
    return hud;
  }

  function removeCollisionDebugHud() {
    collisionDebug.hud?.remove();
    collisionDebug.hud = null;
  }

  function setCollisionDebugEnabled(enabled) {
    collisionDebug.enabled = enabled;
    if (enabled) {
      ensureCollisionDebugHud();
    }
    updateCollisionDebugVisibility();
    if (enabled) {
      ensureCollisionDebugVisuals();
      updateCollisionDebugVisuals();
      updateCollisionDebugHud();
    }
    return collisionDebug.enabled;
  }

  function updateCollisionDebugVisibility() {
    if (collisionDebug.group) {
      collisionDebug.group.visible = collisionDebug.enabled && Boolean(scene);
    }
    if (collisionDebug.hud) {
      collisionDebug.hud.hidden = !(collisionDebug.enabled && active);
    }
  }

  function setStartButtonsDisabled(disabled) {
    startRaceButton.disabled = disabled;
    startEditorButton.disabled = disabled;
    startHomeButton.disabled = disabled;
  }

  async function beginRace() {
    if (!active || raceStarting) {
      return;
    }

    raceStarting = true;
    const requestId = ++startRequestId;
    setStartButtonsDisabled(true);
    setStartStatus(`正在加载 ${selectedCar().name} 与对手车辆...`);

    try {
      saveActiveRacingStartConfig({ playerCarId: selectedCarId });
      await initializeScene();
      if (!active || requestId !== startRequestId) {
        return;
      }

      hideStartOverlay();
      resetRace();
      resizeRenderer();
      lastFrameTime = performance.now();

      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }

      animationFrameId = requestAnimationFrame(loop);
    } catch (error) {
      console.error("Failed to initialize racing scene.", error);
      if (requestId !== startRequestId) {
        return;
      }

      setStartStatus("比赛启动失败，请重试。", true);
      setStartButtonsDisabled(false);
    } finally {
      if (requestId === startRequestId) {
        raceStarting = false;
      }
    }
  }

  async function initializeScene() {
    if (initialized) return;
    if (initializationPromise) return initializationPromise;

    const initializationToken = runtimeToken;
    initializationPromise = (async () => {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setClearColor(racingSceneConfig.backgroundColor ?? 0x9fc9f3);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = racingSceneConfig.toneMappingExposure ?? 1;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;

      scene = new THREE.Scene();
      scene.background = new THREE.Color(racingSceneConfig.backgroundColor ?? 0x9fc9f3);
      scene.fog = new THREE.Fog(
        racingSceneConfig.fogColor ?? racingSceneConfig.backgroundColor ?? 0x9fc9f3,
        150,
        260
      );

      camera = new THREE.PerspectiveCamera(cameraConfig.fov, 1, 0.1, 500);

      applySceneEnvironment();
      createLights();
      createWorld();
      await initializePhysics();
      if (initializationToken !== runtimeToken) {
        disposeRuntimeResources();
        return;
      }

      [car, opponentCar] = await Promise.all([
        createCar(selectedCar(), 0xd40000),
        createCar(opponentCarSelection(), 0x88a5ff)
      ]);
      if (initializationToken !== runtimeToken) {
        disposeRuntimeResources();
        return;
      }

      scene.add(car);
      scene.add(opponentCar);
      ensureCollisionDebugVisuals();
      updateCollisionDebugVisuals();
      updateCollisionDebugHud();

      initialized = true;
    })();

    try {
      await initializationPromise;
    } catch (error) {
      initializationPromise = null;
      throw error;
    } finally {
      if (initializationToken === runtimeToken) {
        initializationPromise = null;
      }
    }
  }

  function invalidateRuntime() {
    runtimeToken += 1;
    initialized = false;
    initializationPromise = null;
    disposeRuntimeResources();
  }

  function disposeRuntimeResources() {
    collisionDebug.lastCollision = null;
    collisionDebug.group = null;
    collisionDebug.playerWire = null;
    collisionDebug.opponentWire = null;
    collisionDebug.headingArrow = null;
    collisionDebug.velocityArrow = null;
    collisionDebug.responseArrow = null;
    collisionDebug.railWiresByHandle.clear();
    if (car) {
      disposeObject3DTree(car);
      car = null;
    }
    if (opponentCar) {
      disposeObject3DTree(opponentCar);
      opponentCar = null;
    }
    if (scene) {
      disposeSceneResources(scene);
      scene = null;
    }
    camera = null;
    if (renderer) {
      disposeRenderer(renderer);
      renderer = null;
    }
    if (physics) {
      disposePhysicsState(physics);
      physics = null;
    }
    updateCollisionDebugVisibility();
  }

  function ensureCollisionDebugVisuals() {
    if (!scene || !physics || collisionDebug.group) {
      return;
    }

    const group = new THREE.Group();
    group.name = "collision-debug";
    collisionDebug.group = group;

    collisionDebug.playerWire = createCollisionWireBox(
      physicsConfig.carHalfWidth * 2,
      physicsConfig.carHalfHeight * 2,
      physicsConfig.carHalfLength * 2,
      collisionDebugColors.player
    );
    collisionDebug.opponentWire = createCollisionWireBox(
      physicsConfig.carHalfWidth * 2,
      physicsConfig.carHalfHeight * 2,
      physicsConfig.carHalfLength * 2,
      collisionDebugColors.opponent
    );

    group.add(collisionDebug.playerWire, collisionDebug.opponentWire);

    for (const rail of physics.debugRailColliders) {
      const wire = createCollisionWireBox(
        rail.length,
        physicsConfig.railHalfHeight * 2,
        physicsConfig.railHalfDepth * 2,
        collisionDebugColors.rail
      );
      wire.position.set(rail.midpoint.x, physicsConfig.railHalfHeight, rail.midpoint.y);
      wire.rotation.y = rail.yaw;
      collisionDebug.railWiresByHandle.set(rail.handle, wire);
      group.add(wire);
    }

    collisionDebug.headingArrow = createDebugArrow(collisionDebugColors.heading);
    collisionDebug.velocityArrow = createDebugArrow(collisionDebugColors.velocity);
    collisionDebug.responseArrow = createDebugArrow(collisionDebugColors.response);
    group.add(collisionDebug.headingArrow, collisionDebug.velocityArrow, collisionDebug.responseArrow);
    scene.add(group);
    updateCollisionDebugVisibility();
  }

  function createCollisionWireBox(width, height, depth, color) {
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth));
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.94,
      depthTest: false
    });
    const wire = new THREE.LineSegments(geometry, material);
    wire.renderOrder = 1000;
    return wire;
  }

  function createDebugArrow(color) {
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 1, color, 0.5, 0.28);
    arrow.visible = false;
    arrow.line.material.depthTest = false;
    arrow.line.renderOrder = 1001;
    if (arrow.cone?.material) {
      arrow.cone.material.depthTest = false;
      arrow.cone.renderOrder = 1001;
    }
    return arrow;
  }

  function createLights() {
    const hemisphere = new THREE.HemisphereLight(
      0xb9dcff,
      0x587044,
      racingSceneConfig.hemisphereIntensity ?? 1.2
    );
    scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(0xfff0d0, racingSceneConfig.sunIntensity ?? 2.4);
    sun.position.set(-55, 82, 42);
    sun.castShadow = true;
    sun.shadow.mapSize.width = isGravelSurface ? 1024 : 2048;
    sun.shadow.mapSize.height = isGravelSurface ? 1024 : 2048;
    sun.shadow.bias = racingSceneConfig.sunShadowBias ?? 0;
    sun.shadow.normalBias = racingSceneConfig.sunShadowNormalBias ?? 0;
    sun.shadow.camera.left = -120;
    sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120;
    sun.shadow.camera.bottom = -120;
    scene.add(sun);
  }

  function applySceneEnvironment() {
    if (!renderer || !scene) {
      return;
    }

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const environmentTexture = createTrackEnvironmentTexture();
    scene.environment = pmremGenerator.fromEquirectangular(environmentTexture).texture;
    environmentTexture.dispose();
    pmremGenerator.dispose();
  }

  function createTrackEnvironmentTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;

    const context = canvas.getContext("2d");
    if (!context) {
      const fallback = new THREE.CanvasTexture(canvas);
      fallback.colorSpace = THREE.SRGBColorSpace;
      fallback.mapping = THREE.EquirectangularReflectionMapping;
      return fallback;
    }

    const skyGradient = context.createLinearGradient(0, 0, 0, canvas.height);
    skyGradient.addColorStop(0, "#6489b3");
    skyGradient.addColorStop(0.34, "#86a7c6");
    skyGradient.addColorStop(0.48, "#acbcc8");
    skyGradient.addColorStop(0.5, "#8b949e");
    skyGradient.addColorStop(0.62, "#505864");
    skyGradient.addColorStop(1, "#2b3037");
    context.fillStyle = skyGradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const sunGlow = context.createRadialGradient(
      canvas.width * 0.26,
      canvas.height * 0.18,
      0,
      canvas.width * 0.26,
      canvas.height * 0.18,
      canvas.height * 0.22
    );
    sunGlow.addColorStop(0, "rgba(255, 246, 220, 0.22)");
    sunGlow.addColorStop(0.5, "rgba(255, 246, 220, 0.09)");
    sunGlow.addColorStop(1, "rgba(255, 246, 220, 0)");
    context.fillStyle = sunGlow;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let index = 0; index < 8; index += 1) {
      const cloudX = canvas.width * (0.12 + index * 0.1) + Math.sin(index * 1.7) * 26;
      const cloudY = canvas.height * (0.16 + (index % 3) * 0.08);
      const cloudWidth = 170 + (index % 4) * 26;
      const cloudHeight = 34 + (index % 3) * 8;
      const cloud = context.createRadialGradient(cloudX, cloudY, 0, cloudX, cloudY, cloudWidth * 0.58);
      cloud.addColorStop(0, "rgba(248, 250, 255, 0.15)");
      cloud.addColorStop(0.5, "rgba(235, 241, 248, 0.09)");
      cloud.addColorStop(1, "rgba(235, 241, 248, 0)");
      context.fillStyle = cloud;
      context.beginPath();
      context.ellipse(cloudX, cloudY, cloudWidth, cloudHeight, 0, 0, Math.PI * 2);
      context.fill();
    }

    const horizonGlow = context.createLinearGradient(0, canvas.height * 0.42, 0, canvas.height * 0.58);
    horizonGlow.addColorStop(0, "rgba(210, 220, 228, 0)");
    horizonGlow.addColorStop(0.5, "rgba(210, 220, 228, 0.12)");
    horizonGlow.addColorStop(1, "rgba(210, 220, 228, 0)");
    context.fillStyle = horizonGlow;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const haze = context.createLinearGradient(0, canvas.height * 0.5, 0, canvas.height * 0.82);
    haze.addColorStop(0, "rgba(225, 232, 236, 0)");
    haze.addColorStop(0.58, "rgba(206, 215, 223, 0.18)");
    haze.addColorStop(1, "rgba(166, 177, 188, 0.28)");
    context.fillStyle = haze;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    return texture;
  }

  function createWorld() {
    addGroundLayers();
    addBackdrop();

    const road = createRoadMesh();
    road.receiveShadow = true;
    scene.add(road);

    addTrackVerges();
    addInfieldSurface();
    addStartFinishLines();
    addLaneMarks();
    addGuardRails();
    addRoadsideProps();
    addVenueCluster();
    addFoliage();
  }

  function addGroundLayers() {
    const nearField = createTerrainPlane({
      width: nearFieldWidth,
      depth: nearFieldDepth,
      segmentsX: groundConfig.nearFieldSegments ?? 28,
      segmentsZ: groundConfig.nearFieldSegments ?? 28,
      y: -0.18,
      undulation: groundConfig.nearUndulation ?? 0.55,
      textureScale: 22,
      color: groundConfig.nearFieldColor ?? 0x6f9d57,
      texture: createGroundTexture({
        base: "#7cab5f",
        accent: "#5f874c",
        soil: "#857145",
        dry: "#96b872"
      })
    });
    nearField.receiveShadow = false;
    scene.add(nearField);

    const farField = createTerrainPlane({
      width: farFieldWidth,
      depth: farFieldDepth,
      segmentsX: groundConfig.farFieldSegments ?? 16,
      segmentsZ: groundConfig.farFieldSegments ?? 16,
      y: -0.34,
      undulation: groundConfig.farUndulation ?? 1.1,
      textureScale: 40,
      color: groundConfig.farFieldColor ?? 0x90aa77,
      texture: createGroundTexture({
        base: "#93a978",
        accent: "#819164",
        soil: "#80694a",
        dry: "#a9b98e"
      })
    });
    farField.receiveShadow = false;
    scene.add(farField);

    for (const side of [1, -1]) {
      const shoulder = createTrackBandMesh({
        side,
        innerOffset: groundConfig.shoulderInnerOffset ?? 1.8,
        outerOffset: groundConfig.shoulderOuterOffset ?? 6.4,
        height: 0.055,
        color: groundConfig.shoulderColor ?? 0xa48d63,
        texture: createShoulderTexture()
      });
      shoulder.receiveShadow = false;
      scene.add(shoulder);
    }
  }

  function addTrackVerges() {
    const texture = createVergeTexture(trackSurface);
    const vergeColor = isGravelSurface ? 0x7f7a55 : 0x6f9a4f;
    const outerOffset = isGravelSurface ? 1.42 : 1.78;

    for (const side of [1, -1]) {
      const verge = createTrackBandMesh({
        side,
        innerOffset: 0.42,
        outerOffset,
        height: 0.072,
        color: vergeColor,
        texture
      });
      verge.receiveShadow = false;
      scene.add(verge);
    }
  }

  function addInfieldSurface() {
    if (!trackModel.closed || trackSamples.length < 3) {
      return;
    }

    const shape = new THREE.Shape();
    trackSamples.forEach((sample, index) => {
      if (index === 0) {
        shape.moveTo(sample.center.x, sample.center.y);
      } else {
        shape.lineTo(sample.center.x, sample.center.y);
      }
    });
    shape.closePath();

    const infield = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshStandardMaterial({
        color: isGravelSurface ? 0x7d8d63 : 0x6d9251,
        map: createInfieldTexture(trackSurface),
        roughness: 0.97,
        metalness: 0,
        fog: true
      })
    );
    infield.rotation.x = -Math.PI / 2;
    infield.position.y = 0.028;
    infield.receiveShadow = false;
    scene.add(infield);

    addInfieldPads();
  }

  function addInfieldPads() {
    const startSample = trackProfileAtProgress(raceConfig.startProgress);
    const infieldSide = trackModel.closed && startSample.center.clone().sub(sceneCenter).dot(startSample.normal) >= 0 ? -1 : 1;
    const padCenter = startSample.center
      .clone()
      .add(startSample.normal.clone().multiplyScalar(trackConfig.width * 0.24 * infieldSide))
      .add(startSample.tangent.clone().multiplyScalar(9.5));

    const padGroup = new THREE.Group();
    padGroup.position.set(padCenter.x, 0.035, padCenter.y);
    padGroup.rotation.y = startSample.heading;

    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 8.4),
      new THREE.MeshStandardMaterial({
        color: 0x80878b,
        map: createServicePadTexture(),
        roughness: 0.88,
        metalness: 0.02,
        side: THREE.DoubleSide
      })
    );
    apron.rotation.x = -Math.PI / 2;

    const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xf1f4f6, roughness: 0.54 });
    for (let index = 0; index < 3; index += 1) {
      const bay = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 6.2), stripeMaterial);
      bay.position.set(-4.8 + index * 4.8, 0.02, -0.4);
      padGroup.add(bay);
    }

    padGroup.add(apron);
    scene.add(padGroup);
  }

  function createTerrainPlane({
    width,
    depth,
    segmentsX,
    segmentsZ,
    y,
    undulation,
    textureScale,
    color,
    texture
  }) {
    const geometry = new THREE.PlaneGeometry(width, depth, segmentsX, segmentsZ);
    geometry.rotateX(-Math.PI / 2);
    const positionAttribute = geometry.attributes.position;

    for (let index = 0; index < positionAttribute.count; index += 1) {
      const x = positionAttribute.getX(index) + sceneCenter.x;
      const z = positionAttribute.getZ(index) + sceneCenter.y;
      positionAttribute.setY(index, terrainUndulationAt(x, z) * undulation);
    }

    geometry.computeVertexNormals();
    if (texture) {
      texture.repeat.set(width / textureScale, depth / textureScale);
    }

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color,
        map: texture,
        roughness: 0.96,
        metalness: 0,
        fog: true
      })
    );
    mesh.position.set(sceneCenter.x, y, sceneCenter.y);
    return mesh;
  }

  function terrainUndulationAt(x, z) {
    const low = Math.sin(x * 0.018 + z * 0.014) * 0.55;
    const mid = Math.cos(z * 0.031 - x * 0.022) * 0.3;
    const wide = Math.sin((x + z) * 0.009) * 0.15;
    return low + mid + wide;
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
      debugRailColliders: [],
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

  function createRailColliders(side) {
    if (!physics) {
      return;
    }

    const segmentCount = trackModel.closed ? railConfig.sampleCount : railConfig.sampleCount - 1;
    for (let index = 0; index < segmentCount; index += 1) {
      const startSample = trackProfileAtProgress(sampleProgressForIndex(index, railConfig.sampleCount));
      const endSample = trackProfileAtProgress(sampleProgressForIndex(index + 1, railConfig.sampleCount));
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
      physics.debugRailColliders.push({
        handle: railCollider.handle,
        midpoint: midpoint.clone(),
        yaw,
        length
      });
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
    const uvs = [];
    const indices = [];
    const roadTexture = createRoadTexture(trackSurface);

    for (const sample of trackSamples) {
      const left = sample.center.clone().add(sample.normal.clone().multiplyScalar(sample.halfWidth));
      const right = sample.center.clone().add(sample.normal.clone().multiplyScalar(-sample.halfWidth));

      positions.push(left.x, 0.06, left.y);
      positions.push(right.x, 0.06, right.y);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, sample.distance / 7.5, 1, sample.distance / 7.5);
    }

    for (let index = 0; index < trackModel.segmentCount; index += 1) {
      const next = trackModel.closed ? (index + 1) % trackConfig.samples : index + 1;
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
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    return new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: roadTexture,
        roughness: 0.92,
        metalness: 0.03
      })
    );
  }

  function createTrackBandMesh({ side, innerOffset, outerOffset, height, color, texture }) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    for (const sample of trackSamples) {
      const inner = sample.center.clone().add(sample.normal.clone().multiplyScalar((sample.halfWidth + innerOffset) * side));
      const outer = sample.center.clone().add(sample.normal.clone().multiplyScalar((sample.halfWidth + outerOffset) * side));
      positions.push(inner.x, height, inner.y);
      positions.push(outer.x, height, outer.y);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, sample.distance / 5.5, 1, sample.distance / 5.5);
    }

    for (let index = 0; index < trackModel.segmentCount; index += 1) {
      const next = trackModel.closed ? (index + 1) % trackConfig.samples : index + 1;
      const inner = index * 2;
      const outer = inner + 1;
      const nextInner = next * 2;
      const nextOuter = nextInner + 1;

      indices.push(inner, nextInner, outer);
      indices.push(outer, nextInner, nextOuter);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    return new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color,
        map: texture,
        roughness: 0.98,
        metalness: 0,
        fog: true
      })
    );
  }

  function addStartFinishLines() {
    if (raceConfig.mode === "lap") {
      addTrackLine(raceConfig.startProgress, 0xd64545, 0xd64545);
      return;
    }

    addTrackLine(0, 0x27ae60, 0x27ae60);
    addTrackLine(raceConfig.finishProgress, 0xd64545, 0xd64545);
  }

  function addTrackLine(progress, lineColor, accentColor) {
    const sample = trackProfileAtProgress(progress);
    const group = new THREE.Group();
    group.position.set(sample.center.x, 0, sample.center.y);
    group.rotation.y = sample.heading;

    const checkerTexture = createCheckeredTexture();
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(trackConfig.width * 0.92, 2.05),
      new THREE.MeshStandardMaterial({
        map: checkerTexture,
        color: lineColor,
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
      new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.44 })
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

  function createRoadTexture(surface) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    if (surface === TRACK_SURFACES.GRAVEL) {
      context.fillStyle = "#9c845d";
      context.fillRect(0, 0, canvas.width, canvas.height);

      for (let index = 0; index < 2400; index += 1) {
        const warm = 128 + Math.floor(Math.random() * 48);
        const cool = 102 + Math.floor(Math.random() * 34);
        context.fillStyle = `rgba(${warm}, ${cool}, ${74 + Math.floor(Math.random() * 24)}, ${0.12 + Math.random() * 0.16})`;
        const size = 1 + Math.random() * 4.4;
        context.beginPath();
        context.arc(Math.random() * canvas.width, Math.random() * canvas.height, size, 0, Math.PI * 2);
        context.fill();
      }

      for (let streak = 0; streak < 7; streak += 1) {
        context.strokeStyle = `rgba(120, 98, 70, ${0.12 + streak * 0.025})`;
        context.lineWidth = 18 - streak * 2;
        context.beginPath();
        context.moveTo(canvas.width * (0.12 + streak * 0.11), 0);
        context.lineTo(canvas.width * (0.18 + streak * 0.1), canvas.height);
        context.stroke();
      }

      context.fillStyle = "rgba(160, 137, 104, 0.24)";
      context.fillRect(0, 0, 26, canvas.height);
      context.fillRect(canvas.width - 26, 0, 26, canvas.height);
      return finalizeCanvasTexture(canvas);
    }

    context.fillStyle = "#2a2c30";
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let index = 0; index < 1900; index += 1) {
      const shade = 42 + Math.floor(Math.random() * 20);
      context.fillStyle = `rgba(${shade}, ${shade}, ${shade + 2}, ${0.1 + Math.random() * 0.1})`;
      const size = 1 + Math.random() * 3;
      context.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, size, size);
    }

    for (let lane = 0; lane < 4; lane += 1) {
      context.strokeStyle = `rgba(18, 18, 18, ${0.12 + lane * 0.03})`;
      context.lineWidth = 22 - lane * 3;
      context.beginPath();
      context.moveTo(canvas.width * (0.2 + lane * 0.15), 0);
      context.lineTo(canvas.width * (0.16 + lane * 0.15), canvas.height);
      context.stroke();
    }

    context.fillStyle = "rgba(172, 146, 108, 0.15)";
    context.fillRect(0, 0, 22, canvas.height);
    context.fillRect(canvas.width - 22, 0, 22, canvas.height);
    return finalizeCanvasTexture(canvas);
  }

  function createVergeTexture(surface) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 512;
    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    if (surface === TRACK_SURFACES.GRAVEL) {
      const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
      gradient.addColorStop(0, "#6e7a55");
      gradient.addColorStop(0.4, "#897f5a");
      gradient.addColorStop(1, "#6f6a49");
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);

      for (let index = 0; index < 1100; index += 1) {
        const tone = 104 + Math.floor(Math.random() * 46);
        context.fillStyle = `rgba(${tone}, ${tone - 8}, ${76 + Math.floor(Math.random() * 16)}, ${0.08 + Math.random() * 0.1})`;
        const size = 1 + Math.random() * 3;
        context.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, size, size);
      }
      return finalizeCanvasTexture(canvas);
    }

    const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
    gradient.addColorStop(0, "#5a8441");
    gradient.addColorStop(0.58, "#84a85a");
    gradient.addColorStop(1, "#5a7b3f");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let index = 0; index < 14; index += 1) {
      context.fillStyle = index % 2 === 0 ? "rgba(206, 228, 171, 0.15)" : "rgba(41, 77, 32, 0.1)";
      context.fillRect((index / 14) * canvas.width, 0, canvas.width / 18, canvas.height);
    }

    for (let index = 0; index < 520; index += 1) {
      context.fillStyle = `rgba(${76 + Math.floor(Math.random() * 28)}, ${112 + Math.floor(Math.random() * 40)}, ${56 + Math.floor(Math.random() * 24)}, ${0.05 + Math.random() * 0.08})`;
      const width = 6 + Math.random() * 22;
      const height = 2 + Math.random() * 7;
      context.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, width, height);
    }

    return finalizeCanvasTexture(canvas);
  }

  function createInfieldTexture(surface) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    const base = surface === TRACK_SURFACES.GRAVEL ? "#72845d" : "#688d4b";
    const stripeA = surface === TRACK_SURFACES.GRAVEL ? "rgba(140, 148, 109, 0.14)" : "rgba(164, 196, 111, 0.13)";
    const stripeB = surface === TRACK_SURFACES.GRAVEL ? "rgba(84, 94, 67, 0.12)" : "rgba(56, 92, 41, 0.1)";
    context.fillStyle = base;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let index = 0; index < 18; index += 1) {
      context.fillStyle = index % 2 === 0 ? stripeA : stripeB;
      context.fillRect(0, (index / 18) * canvas.height, canvas.width, canvas.height / 20);
    }

    for (let index = 0; index < 760; index += 1) {
      context.fillStyle = `rgba(${92 + Math.floor(Math.random() * 42)}, ${112 + Math.floor(Math.random() * 48)}, ${68 + Math.floor(Math.random() * 28)}, ${0.04 + Math.random() * 0.05})`;
      const radius = 4 + Math.random() * 18;
      context.beginPath();
      context.ellipse(
        Math.random() * canvas.width,
        Math.random() * canvas.height,
        radius,
        radius * (0.32 + Math.random() * 0.55),
        Math.random() * Math.PI,
        0,
        Math.PI * 2
      );
      context.fill();
    }

    return finalizeCanvasTexture(canvas);
  }

  function createGroundTexture({ base, accent, soil, dry }) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    context.fillStyle = base;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let index = 0; index < 900; index += 1) {
      context.fillStyle = index % 5 === 0 ? dry : accent;
      context.globalAlpha = 0.05 + Math.random() * 0.08;
      const width = 10 + Math.random() * 26;
      const height = 4 + Math.random() * 12;
      context.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, width, height);
    }

    for (let index = 0; index < 280; index += 1) {
      context.fillStyle = soil;
      context.globalAlpha = 0.04 + Math.random() * 0.05;
      const radius = 5 + Math.random() * 14;
      context.beginPath();
      context.ellipse(
        Math.random() * canvas.width,
        Math.random() * canvas.height,
        radius,
        radius * (0.5 + Math.random() * 0.8),
        Math.random() * Math.PI,
        0,
        Math.PI * 2
      );
      context.fill();
    }

    context.globalAlpha = 1;
    return finalizeCanvasTexture(canvas);
  }

  function createShoulderTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 512;
    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
    gradient.addColorStop(0, "#8d7650");
    gradient.addColorStop(0.32, "#b29a72");
    gradient.addColorStop(0.75, "#7f6b49");
    gradient.addColorStop(1, "#5f583e");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let index = 0; index < 1400; index += 1) {
      const tone = 132 + Math.floor(Math.random() * 50);
      context.fillStyle = `rgba(${tone}, ${tone - 8}, ${tone - 22}, ${0.08 + Math.random() * 0.1})`;
      const size = 1 + Math.random() * 2.8;
      context.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, size, size);
    }

    context.fillStyle = "rgba(222, 208, 177, 0.18)";
    context.fillRect(canvas.width * 0.08, 0, canvas.width * 0.12, canvas.height);
    context.fillStyle = "rgba(90, 84, 67, 0.2)";
    context.fillRect(canvas.width * 0.82, 0, canvas.width * 0.18, canvas.height);
    return finalizeCanvasTexture(canvas);
  }

  function createServicePadTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    context.fillStyle = "#737a7f";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(255, 255, 255, 0.06)";
    for (let index = 0; index < 12; index += 1) {
      context.fillRect(index * 44, 0, 18, canvas.height);
    }
    context.fillStyle = "rgba(26, 32, 38, 0.14)";
    for (let index = 0; index < 900; index += 1) {
      const size = 1 + Math.random() * 3;
      context.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, size, size);
    }

    return finalizeCanvasTexture(canvas);
  }

  function finalizeCanvasTexture(canvas) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
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
      const sample = trackProfileAtProgress(sampleProgressForIndex(index, 120));
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

  function addRoadsideProps() {
    addReflectorPosts();
    addDistanceMarkers();
    addSponsorBoards();
    addTireStacks();
  }

  function addReflectorPosts() {
    const step = Math.max(2, roadsidePropsConfig.reflectorSpacing ?? 5);
    const postSamples = [];

    for (let index = 0; index < railConfig.sampleCount; index += step) {
      for (const side of [1, -1]) {
        const sample = trackProfileAtProgress(sampleProgressForIndex(index, railConfig.sampleCount));
        const position = sample.center
          .clone()
          .add(sample.normal.clone().multiplyScalar((sample.railOffset + 0.7) * side));
        postSamples.push({ position, heading: sample.heading });
      }
    }

    const postGeometry = new THREE.BoxGeometry(0.14, 1.02, 0.14);
    const capGeometry = new THREE.BoxGeometry(0.12, 0.2, 0.1);
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0xd9dfdf, roughness: 0.72 });
    const capMaterial = new THREE.MeshStandardMaterial({
      color: 0xff8b3d,
      emissive: 0x4d1e03,
      emissiveIntensity: 0.28,
      roughness: 0.42
    });
    const postMesh = new THREE.InstancedMesh(postGeometry, postMaterial, postSamples.length);
    const capMesh = new THREE.InstancedMesh(capGeometry, capMaterial, postSamples.length);
    const dummy = new THREE.Object3D();

    postMesh.castShadow = true;
    postMesh.receiveShadow = true;

    postSamples.forEach((sample, index) => {
      dummy.position.set(sample.position.x, 0.52, sample.position.y);
      dummy.rotation.set(0, sample.heading, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      postMesh.setMatrixAt(index, dummy.matrix);

      dummy.position.set(sample.position.x, 0.84, sample.position.y);
      dummy.rotation.set(0, sample.heading, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      capMesh.setMatrixAt(index, dummy.matrix);
    });

    postMesh.instanceMatrix.needsUpdate = true;
    capMesh.instanceMatrix.needsUpdate = true;

    scene.add(postMesh, capMesh);
  }

  function addDistanceMarkers() {
    const corners = findCornerMarkerAnchors(Math.min(6, Math.max(2, Math.floor(trackLength / 90))));
    if (corners.length === 0) {
      return;
    }

    const markerSpecs = [
      { label: "150", distance: 26 },
      { label: "100", distance: 16 },
      { label: "50", distance: 8 }
    ];

    for (const corner of corners) {
      for (const spec of markerSpecs) {
        const progressDelta = spec.distance / Math.max(trackLength, 0.0001);
        const progress = trackModel.closed
          ? wrapProgress(corner.progress - progressDelta)
          : clamp(corner.progress - progressDelta, 0.02, 0.98);
        const sample = trackProfileAtProgress(progress);
        const offset = sample.railOffset + 2.2;
        const position = sample.center
          .clone()
          .add(sample.normal.clone().multiplyScalar(offset * corner.outerSide));

        const group = new THREE.Group();
        group.position.set(position.x, 0, position.y);
        group.rotation.y = sample.heading + (corner.outerSide > 0 ? Math.PI / 2 : -Math.PI / 2);

        const board = new THREE.Mesh(
          new THREE.PlaneGeometry(1.4, 1.6),
          new THREE.MeshStandardMaterial({
            map: createDistanceMarkerTexture(spec.label),
            color: 0xffffff,
            roughness: 0.5,
            metalness: 0.02,
            side: THREE.DoubleSide
          })
        );
        board.position.set(0, 1.46, 0);
        board.castShadow = true;

        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 1.52, 0.08),
          new THREE.MeshStandardMaterial({ color: 0x666c73, roughness: 0.82 })
        );
        post.position.set(0, 0.76, -0.06);
        post.castShadow = true;

        group.add(board, post);
        scene.add(group);
      }
    }
  }

  function findCornerMarkerAnchors(limit) {
    const candidates = [];
    const totalSamples = trackSamples.length;
    if (totalSamples < 6) {
      return candidates;
    }

    for (let index = 0; index < totalSamples; index += 1) {
      const previous = trackSamples[wrapIndex(index - 2, totalSamples)];
      const current = trackSamples[index];
      const next = trackSamples[wrapIndex(index + 2, totalSamples)];
      const headingDelta = shortestAngleDelta(previous.heading, next.heading);
      const strength = Math.abs(headingDelta);
      if (strength < 0.24) {
        continue;
      }

      candidates.push({
        progress: current.progress ?? sampleProgressForIndex(index, totalSamples),
        strength,
        outerSide: headingDelta > 0 ? -1 : 1
      });
    }

    candidates.sort((left, right) => right.strength - left.strength);
    const selected = [];
    const minSpacing = 52 / Math.max(trackLength, 0.0001);

    for (const candidate of candidates) {
      if (selected.length >= limit) {
        break;
      }

      if (selected.some((entry) => circularProgressDistance(entry.progress, candidate.progress) < minSpacing)) {
        continue;
      }

      selected.push(candidate);
    }

    return selected;
  }

  function addSponsorBoards() {
    const material = new THREE.MeshStandardMaterial({
      map: createSponsorBoardTexture(),
      color: 0xffffff,
      roughness: 0.54,
      metalness: 0.04,
      side: THREE.DoubleSide
    });
    const placements = buildTracksidePlacements(scaleEnvironmentCount(roadsidePropsConfig.sponsorBoardCount ?? 8, 0.8), {
      minOffset: 17,
      maxOffset: 22,
      minSpacing: 26,
      maxAttempts: 260
    });

    for (const placement of placements) {
      const sample = trackProfileAtProgress(placement.progress);
      const group = new THREE.Group();
      group.position.set(placement.position.x, 0, placement.position.y);
      group.rotation.y = sample.heading + (placement.side > 0 ? Math.PI / 2 : -Math.PI / 2);

      const panel = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.2), material);
      panel.position.set(0, 2.1, 0);
      panel.castShadow = true;

      const postGeometry = new THREE.CylinderGeometry(0.08, 0.1, 2.4, 8);
      const postMaterial = new THREE.MeshStandardMaterial({ color: 0x73787f, roughness: 0.78 });
      const leftPost = new THREE.Mesh(postGeometry, postMaterial);
      const rightPost = new THREE.Mesh(postGeometry, postMaterial);
      leftPost.position.set(-2.15, 1.2, -0.08);
      rightPost.position.set(2.15, 1.2, -0.08);
      leftPost.castShadow = true;
      rightPost.castShadow = true;

      group.add(panel, leftPost, rightPost);
      scene.add(group);
    }
  }

  function addTireStacks() {
    const placements = buildTracksidePlacements(scaleEnvironmentCount(roadsidePropsConfig.tireStackCount ?? 8, 0.8), {
      minOffset: 9,
      maxOffset: 14,
      minSpacing: 18,
      maxAttempts: 260
    });

    for (const placement of placements) {
      const group = new THREE.Group();
      const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x151719, roughness: 0.86 });
      const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xd34f32, roughness: 0.52 });

      for (let index = 0; index < 3; index += 1) {
        const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.28, 16), tireMaterial);
        tire.rotation.z = Math.PI / 2;
        tire.position.set((index - 1) * 0.48, 0.46, 0);
        tire.castShadow = true;
        group.add(tire);

        if (index === 1) {
          const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.26, 0.08), stripeMaterial);
          stripe.position.set(0, 0.94, 0.3);
          stripe.castShadow = true;
          group.add(stripe);
        }
      }

      group.position.set(placement.position.x, 0, placement.position.y);
      group.rotation.y = randomBetween(0, Math.PI * 2);
      scene.add(group);
    }
  }

  function buildTracksidePlacements(count, { minOffset, maxOffset, minSpacing, maxAttempts }) {
    const placements = [];
    let attempts = 0;

    while (placements.length < count && attempts < maxAttempts) {
      attempts += 1;
      const progress = Math.random();
      const sample = trackProfileAtProgress(progress);
      const side = Math.random() < 0.5 ? 1 : -1;
      const offset = Math.max(sample.railOffset + 2.4, randomBetween(minOffset, maxOffset));
      const alongJitter = randomBetween(-(foliageConfig.placementJitter ?? 7), foliageConfig.placementJitter ?? 7);
      const candidate = sample.center
        .clone()
        .add(sample.normal.clone().multiplyScalar(offset * side))
        .add(sample.tangent.clone().multiplyScalar(alongJitter));

      if (candidate.distanceTo(sceneCenter) > groundRadius - 18) {
        continue;
      }

      if (nearestRoadDistance(candidate) < sample.railOffset + 0.9) {
        continue;
      }

      if (placements.some((placement) => placement.position.distanceToSquared(candidate) < minSpacing ** 2)) {
        continue;
      }

      placements.push({ position: candidate, side, progress });
    }

    return placements;
  }

  function addVenueCluster() {
    const startSample = trackProfileAtProgress(raceConfig.startProgress);
    const outwardSide = trackModel.closed && startSample.center.clone().sub(sceneCenter).dot(startSample.normal) >= 0 ? 1 : -1;
    const anchor = startSample.center
      .clone()
      .add(startSample.normal.clone().multiplyScalar((startSample.railOffset + 12) * outwardSide))
      .add(startSample.tangent.clone().multiplyScalar(-6));

    const group = new THREE.Group();
    group.position.set(anchor.x, 0, anchor.y);
    group.rotation.y = startSample.heading + (outwardSide > 0 ? Math.PI / 2 : -Math.PI / 2);

    const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0xc6cbcf, roughness: 0.72 });
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x343b44, roughness: 0.64 });
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: 0x87aac2,
      emissive: 0x17303d,
      emissiveIntensity: 0.18,
      roughness: 0.22,
      metalness: 0.08
    });

    const baseHall = new THREE.Mesh(new THREE.BoxGeometry(8.5, 2.8, 4.2), buildingMaterial);
    baseHall.position.set(0, 1.4, 0);
    baseHall.castShadow = true;
    baseHall.receiveShadow = true;

    const roof = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.26, 4.9), roofMaterial);
    roof.position.set(0, 2.86, 0);
    roof.castShadow = true;

    const glassBand = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.56, 0.08), glassMaterial);
    glassBand.position.set(0, 1.92, 2.12);

    const tower = new THREE.Mesh(new THREE.BoxGeometry(2.2, 5.4, 2.2), buildingMaterial);
    tower.position.set(4.8, 2.7, -0.8);
    tower.castShadow = true;

    const towerRoof = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.24, 2.7), roofMaterial);
    towerRoof.position.set(4.8, 5.52, -0.8);
    towerRoof.castShadow = true;

    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(8.8, 0.16, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xff7a3d, roughness: 0.54 })
    );
    awning.position.set(-0.2, 2.26, 2.76);
    awning.castShadow = true;

    const standStepsMaterial = new THREE.MeshStandardMaterial({ color: 0x737a80, roughness: 0.86 });
    for (let index = 0; index < 4; index += 1) {
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(4.8, 0.44, 1.5 + index * 0.42),
        standStepsMaterial
      );
      step.position.set(-6.6, 0.22 + index * 0.44, -1.6 - index * 0.42);
      step.castShadow = true;
      step.receiveShadow = true;
      group.add(step);
    }

    for (let index = 0; index < 2; index += 1) {
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.12, 6.8, 8),
        new THREE.MeshStandardMaterial({ color: 0xc8d0d8, roughness: 0.46, metalness: 0.28 })
      );
      mast.position.set(1.8 + index * 2.4, 3.4, -2.5);
      mast.castShadow = true;
      group.add(mast);

      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.22, 0.22),
        new THREE.MeshStandardMaterial({
          color: 0xf5e7c5,
          emissive: 0x7d5a22,
          emissiveIntensity: 0.3,
          roughness: 0.24
        })
      );
      lamp.position.set(1.8 + index * 2.4, 6.56, -2.24);
      group.add(lamp);
    }

    group.add(baseHall, roof, glassBand, tower, towerRoof, awning);
    scene.add(group);
  }

  function addFoliage() {
    const nearTreeBaseCount = Math.round((foliageConfig.nearTreeCount ?? 30) * (isGravelSurface ? 0.58 : 1));
    const farTreeBaseCount = Math.round((foliageConfig.farTreeCount ?? 120) * (isGravelSurface ? 0.72 : 1));
    const shrubBaseCount = Math.round((foliageConfig.shrubCount ?? 68) * (isGravelSurface ? 0.82 : 1));
    const nearTrees = buildTracksidePlacements(scaleEnvironmentCount(nearTreeBaseCount, 0.95), {
      minOffset: foliageConfig.nearTreeBandMin ?? 18,
      maxOffset: foliageConfig.nearTreeBandMax ?? 42,
      minSpacing: foliageConfig.nearTreeMinSpacing ?? 11,
      maxAttempts: foliageConfig.maxAttempts ?? 1400
    }).map((placement, index) => ({
      ...placement,
      height: randomBetween(5.2, 8.4),
      variant: index % 2
    }));
    const farTrees = buildTracksidePlacements(scaleEnvironmentCount(farTreeBaseCount, 1), {
      minOffset: foliageConfig.farTreeBandMin ?? 36,
      maxOffset: foliageConfig.farTreeBandMax ?? 112,
      minSpacing: foliageConfig.farTreeMinSpacing ?? 8,
      maxAttempts: foliageConfig.maxAttempts ?? 1400
    }).map((placement) => ({
      ...placement,
      height: randomBetween(8, 15)
    }));
    const shrubs = buildTracksidePlacements(scaleEnvironmentCount(shrubBaseCount, 0.9), {
      minOffset: foliageConfig.shrubBandMin ?? 8,
      maxOffset: foliageConfig.shrubBandMax ?? 18,
      minSpacing: foliageConfig.shrubMinSpacing ?? 4.6,
      maxAttempts: foliageConfig.maxAttempts ?? 1400
    }).map((placement) => ({
      ...placement,
      width: randomBetween(1.2, 2.8),
      height: randomBetween(0.55, 1.2)
    }));

    addNearTreeInstances(nearTrees);
    addBillboardTreeInstances(farTrees, 0x90a98e);
    addShrubInstances(shrubs);
  }

  function scaleEnvironmentCount(baseCount, capMultiplier = 1) {
    const scale = Math.min(capMultiplier + 2, environmentScale * capMultiplier);
    return Math.max(baseCount, Math.round(baseCount * scale));
  }

  function addNearTreeInstances(placements) {
    const slender = placements.filter((placement) => placement.variant === 0);
    const layered = placements.filter((placement) => placement.variant === 1);
    const castTreeShadows = !isGravelSurface;
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x745336, roughness: 0.92 });
    const foliageMaterial = new THREE.MeshStandardMaterial({
      color: 0x356b41,
      roughness: 0.88,
      flatShading: true
    });
    const dummy = new THREE.Object3D();

    const slenderTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.3, 1, 6), trunkMaterial, slender.length);
    const slenderCrowns = new THREE.InstancedMesh(new THREE.ConeGeometry(0.92, 1.9, 7), foliageMaterial, slender.length);
    slenderTrunks.castShadow = castTreeShadows;
    slenderCrowns.castShadow = castTreeShadows;

    slender.forEach((tree, index) => {
      const trunkHeight = tree.height * 0.42;
      const yaw = randomBetween(0, Math.PI * 2);
      dummy.position.set(tree.position.x, trunkHeight * 0.5, tree.position.y);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, trunkHeight, 1);
      dummy.updateMatrix();
      slenderTrunks.setMatrixAt(index, dummy.matrix);

      dummy.position.set(tree.position.x, tree.height * 0.78, tree.position.y);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(tree.height * 0.38, tree.height * 0.62, tree.height * 0.38);
      dummy.updateMatrix();
      slenderCrowns.setMatrixAt(index, dummy.matrix);
    });

    const layeredTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.28, 1, 6), trunkMaterial, layered.length);
    const layeredLower = new THREE.InstancedMesh(new THREE.ConeGeometry(1.02, 1.42, 7), foliageMaterial, layered.length);
    const layeredUpper = new THREE.InstancedMesh(new THREE.ConeGeometry(0.78, 1.1, 7), foliageMaterial, layered.length);
    layeredTrunks.castShadow = castTreeShadows;
    layeredLower.castShadow = castTreeShadows;
    layeredUpper.castShadow = castTreeShadows;

    layered.forEach((tree, index) => {
      const yaw = randomBetween(0, Math.PI * 2);
      const trunkHeight = tree.height * 0.38;
      dummy.position.set(tree.position.x, trunkHeight * 0.5, tree.position.y);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, trunkHeight, 1);
      dummy.updateMatrix();
      layeredTrunks.setMatrixAt(index, dummy.matrix);

      dummy.position.set(tree.position.x, tree.height * 0.54, tree.position.y);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(tree.height * 0.42, tree.height * 0.46, tree.height * 0.42);
      dummy.updateMatrix();
      layeredLower.setMatrixAt(index, dummy.matrix);

      dummy.position.set(tree.position.x, tree.height * 0.9, tree.position.y);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(tree.height * 0.28, tree.height * 0.32, tree.height * 0.28);
      dummy.updateMatrix();
      layeredUpper.setMatrixAt(index, dummy.matrix);
    });

    slenderTrunks.instanceMatrix.needsUpdate = true;
    slenderCrowns.instanceMatrix.needsUpdate = true;
    layeredTrunks.instanceMatrix.needsUpdate = true;
    layeredLower.instanceMatrix.needsUpdate = true;
    layeredUpper.instanceMatrix.needsUpdate = true;

    scene.add(slenderTrunks, slenderCrowns, layeredTrunks, layeredLower, layeredUpper);
  }

  function addBillboardTreeInstances(placements, color) {
    if (placements.length === 0) {
      return;
    }

    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.translate(0, 0.5, 0);
    const texture = createBillboardTreeTexture();
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color,
      transparent: true,
      alphaTest: 0.42,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide
    });
    const primary = new THREE.InstancedMesh(geometry, material, placements.length);
    const secondary = new THREE.InstancedMesh(geometry, material, placements.length);
    const dummy = new THREE.Object3D();

    placements.forEach((tree, index) => {
      const yaw = randomBetween(0, Math.PI * 2);
      const width = tree.height * randomBetween(0.42, 0.58);

      dummy.position.set(tree.position.x, 0, tree.position.y);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(width, tree.height, 1);
      dummy.updateMatrix();
      primary.setMatrixAt(index, dummy.matrix);

      dummy.rotation.set(0, yaw + Math.PI / 2, 0);
      dummy.updateMatrix();
      secondary.setMatrixAt(index, dummy.matrix);
    });

    primary.instanceMatrix.needsUpdate = true;
    secondary.instanceMatrix.needsUpdate = true;

    scene.add(primary, secondary);
  }

  function addShrubInstances(placements) {
    if (placements.length === 0) {
      return;
    }

    const geometry = new THREE.IcosahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({
      color: 0x4d7c4f,
      roughness: 0.94,
      flatShading: true
    });
    const shrubs = new THREE.InstancedMesh(geometry, material, placements.length);
    const dummy = new THREE.Object3D();

    placements.forEach((shrub, index) => {
      dummy.position.set(shrub.position.x, shrub.height * 0.52, shrub.position.y);
      dummy.rotation.set(randomBetween(-0.16, 0.16), randomBetween(0, Math.PI * 2), 0);
      dummy.scale.set(shrub.width, shrub.height, shrub.width * randomBetween(0.76, 1.18));
      dummy.updateMatrix();
      shrubs.setMatrixAt(index, dummy.matrix);
    });

    shrubs.instanceMatrix.needsUpdate = true;

    scene.add(shrubs);
  }

  function createBillboardTreeTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 512;
    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#4c351f";
    context.fillRect(canvas.width * 0.46, canvas.height * 0.68, canvas.width * 0.08, canvas.height * 0.28);

    context.fillStyle = "#2c5d37";
    for (let layer = 0; layer < 4; layer += 1) {
      const top = canvas.height * (0.12 + layer * 0.12);
      const width = canvas.width * (0.5 - layer * 0.06);
      context.beginPath();
      context.moveTo(canvas.width * 0.5, top);
      context.lineTo(canvas.width * 0.5 - width * 0.5, top + canvas.height * 0.18);
      context.lineTo(canvas.width * 0.5 + width * 0.5, top + canvas.height * 0.18);
      context.closePath();
      context.fill();
    }

    return finalizeCanvasTexture(canvas);
  }

  function createRailPoints(side, sampleCount) {
    return Array.from({ length: sampleCount }, (_, index) => {
      const sample = trackProfileAtProgress(sampleProgressForIndex(index, sampleCount));
      const point = sample.center.clone().add(sample.normal.clone().multiplyScalar(sample.railOffset * side));
      return new THREE.Vector3(point.x, railConfig.railHeight, point.y);
    });
  }

  function createRailRun(points, material) {
    const group = new THREE.Group();
    const segmentGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
    const postGeometry = new THREE.CylinderGeometry(0.07, 0.09, railConfig.postHeight, 8);
    const up = new THREE.Vector3(0, 1, 0);

    const segmentCount = trackModel.closed ? points.length : points.length - 1;

    for (let index = 0; index < segmentCount; index += 1) {
      const current = points[index];
      const next = trackModel.closed ? points[(index + 1) % points.length] : points[index + 1];
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

    if (!trackModel.closed && points.length > 0) {
      const finalPoint = points[points.length - 1];
      const finalPost = new THREE.Mesh(postGeometry, material);
      finalPost.position.set(finalPoint.x, railConfig.postHeight / 2, finalPoint.z);
      finalPost.castShadow = true;
      finalPost.receiveShadow = true;
      group.add(finalPost);
    }

    return group;
  }

  function addBackdrop() {
    const ridgeInset = backdropConfig.radiusPadding ?? 78;
    const ridgeBounds = {
      minX: sceneBounds.minX - ridgeInset,
      maxX: sceneBounds.maxX + ridgeInset,
      minZ: sceneBounds.minZ - ridgeInset,
      maxZ: sceneBounds.maxZ + ridgeInset
    };
    scene.add(
      createBackdropRidge({
        bounds: ridgeBounds,
        depth: 32,
        segments: backdropConfig.ridgeSegments ?? 36,
        minHeight: backdropConfig.ridgeHeightMin ?? 16,
        maxHeight: backdropConfig.ridgeHeightMax ?? 36,
        color: 0x7d8e8f
      }),
      createBackdropRidge({
        bounds: expandBounds(ridgeBounds, 18),
        depth: 48,
        segments: Math.max(20, Math.floor((backdropConfig.ridgeSegments ?? 36) * 0.7)),
        minHeight: 22,
        maxHeight: 46,
        color: 0x6a7980
      })
    );

    const innerBackdropTrees = buildBackdropTreePlacements(
      backdropConfig.innerTreeCount ?? 36,
      insetBounds(ridgeBounds, 20),
      10
    ).map((placement) => ({
      ...placement,
      height: randomBetween(
        backdropConfig.innerTreeHeightMin ?? 14,
        backdropConfig.innerTreeHeightMax ?? 28
      )
    }));
    addBillboardTreeInstances(innerBackdropTrees, 0x738572);
  }

  function createBackdropRidge({ bounds, depth, segments, minHeight, maxHeight, color }) {
    const positions = [];
    const indices = [];

    const outline = buildRectPerimeterPoints(bounds, segments);
    const outlineCenter = new THREE.Vector2((bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2);

    for (let index = 0; index < outline.length; index += 1) {
      const point = outline[index];
      const angle = (index / Math.max(1, outline.length - 1)) * Math.PI * 2;
      const localNoise = 0.5 + 0.5 * Math.sin(angle * 3.2 + Math.cos(angle * 5.4));
      const height = THREE.MathUtils.lerp(minHeight, maxHeight, localNoise);
      const outward = point.clone().sub(outlineCenter).normalize();
      const backPoint = point.clone().add(outward.multiplyScalar(depth));

      positions.push(
        point.x, 0, point.y,
        point.x, height, point.y,
        backPoint.x, 0, backPoint.y,
        backPoint.x, height * 0.78, backPoint.y
      );
    }

    for (let index = 0; index < outline.length - 1; index += 1) {
      const stride = index * 4;
      const nextStride = (index + 1) * 4;
      indices.push(stride, nextStride, stride + 1, stride + 1, nextStride, nextStride + 1);
      indices.push(stride + 2, stride + 3, nextStride + 2, stride + 3, nextStride + 3, nextStride + 2);
      indices.push(stride + 1, nextStride + 1, stride + 3, stride + 3, nextStride + 1, nextStride + 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.98,
        metalness: 0,
        flatShading: true,
        fog: true,
        side: THREE.DoubleSide
      })
    );
  }

  function buildBackdropTreePlacements(count, bounds, jitter = 0) {
    const placements = [];
    const perimeterPoints = buildRectPerimeterPoints(bounds, count);

    for (let index = 0; index < count; index += 1) {
      const point = perimeterPoints[index];
      placements.push({
        position: new THREE.Vector2(
          point.x + randomBetween(-jitter, jitter),
          point.y + randomBetween(-jitter, jitter)
        )
      });
    }

    return placements;
  }

  function buildRectPerimeterPoints(bounds, count) {
    const points = [];
    const spanX = Math.max(1, bounds.maxX - bounds.minX);
    const spanZ = Math.max(1, bounds.maxZ - bounds.minZ);
    const perimeter = spanX * 2 + spanZ * 2;

    for (let index = 0; index <= count; index += 1) {
      let distance = (index / Math.max(1, count)) * perimeter;
      if (distance <= spanX) {
        points.push(new THREE.Vector2(bounds.minX + distance, bounds.minZ));
        continue;
      }
      distance -= spanX;
      if (distance <= spanZ) {
        points.push(new THREE.Vector2(bounds.maxX, bounds.minZ + distance));
        continue;
      }
      distance -= spanZ;
      if (distance <= spanX) {
        points.push(new THREE.Vector2(bounds.maxX - distance, bounds.maxZ));
        continue;
      }
      distance -= spanX;
      points.push(new THREE.Vector2(bounds.minX, bounds.maxZ - Math.min(distance, spanZ)));
    }

    return points;
  }

  function expandBounds(bounds, amount) {
    return {
      minX: bounds.minX - amount,
      maxX: bounds.maxX + amount,
      minZ: bounds.minZ - amount,
      maxZ: bounds.maxZ + amount
    };
  }

  function insetBounds(bounds, amount) {
    return {
      minX: bounds.minX + amount,
      maxX: bounds.maxX - amount,
      minZ: bounds.minZ + amount,
      maxZ: bounds.maxZ - amount
    };
  }

  function createSponsorBoardTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#fa8f2d");
    gradient.addColorStop(0.5, "#ffb347");
    gradient.addColorStop(1, "#f26041");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = "rgba(17, 21, 27, 0.18)";
    for (let index = 0; index < 8; index += 1) {
      context.fillRect(index * 64, 0, 20, canvas.height);
    }

    context.fillStyle = "#111827";
    context.font = "700 92px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("RACE", canvas.width * 0.31, canvas.height * 0.5);
    context.fillStyle = "#f8fafc";
    context.fillText("LINE", canvas.width * 0.7, canvas.height * 0.5);
    return finalizeCanvasTexture(canvas);
  }

  function createDistanceMarkerTexture(label) {
    if (distanceMarkerTextureCache.has(label)) {
      return distanceMarkerTextureCache.get(label);
    }

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 320;
    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    context.fillStyle = "#f7fafc";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#e03b2f";
    context.fillRect(0, 0, canvas.width, 30);
    context.fillRect(0, canvas.height - 30, canvas.width, 30);
    context.strokeStyle = "#101418";
    context.lineWidth = 10;
    context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);

    context.fillStyle = "#101418";
    context.font = "700 136px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, canvas.width * 0.5, canvas.height * 0.54);

    const texture = finalizeCanvasTexture(canvas);
    distanceMarkerTextureCache.set(label, texture);
    return texture;
  }

  async function createCar(carSpec, tint = null) {
    const template = await loadCarTemplate(carSpec);
    if (!template) {
      return createFallbackCar(carSpec, tint ?? 0xa81f34);
    }

    const group = new THREE.Group();
    const visualRoot = new THREE.Group();
    const model = template.clone(true);
    cloneCarMaterials(model);
    markMaterialsOnlyDispose(model);
    configureCarMaterials(model);
    applyConfiguredCarTint(model, carSpec, tint);
    visualRoot.add(model);

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const minZ = box.min.z;

    const boostGroup = createBoostGroup(size, minZ);
    visualRoot.position.y = racingSceneConfig.groundOffset;
    group.userData.visualRoot = visualRoot;
    group.userData.model = model;
    group.userData.boostFlames = boostGroup.userData.flames;
    group.userData.boostGroup = boostGroup;
    visualRoot.add(boostGroup);
    group.add(visualRoot);
    return group;
  }

  async function loadCarTemplate(carSpec) {
    if (carTemplatePromises.has(carSpec.id)) {
      return carTemplatePromises.get(carSpec.id);
    }

    const templatePromise = carModelLoader.loadAsync(carSpec.modelUrl)
      .then((gltf) => {
        const template = (gltf.scene || gltf.scenes?.[0])?.clone(true);
        if (!template) {
          throw new Error("Configured car model does not contain a scene.");
        }

        normalizeCarModel(template, carSpec);
        smoothCarBodyGeometry(template);
        template.userData.carSpec = carSpec;
        template.traverse((child) => {
          if (!child.isMesh) {
            return;
          }

          const materials = Array.isArray(child.material) ? child.material : [child.material];
          const isBody = materials.some((material) =>
            matchesAnyPattern(materialLabelFor(child, material), racingSceneConfig.bodyNamePatterns)
          );

          child.castShadow = true;
          child.receiveShadow = isBody ? racingSceneConfig.bodyReceiveShadow !== false : true;

          for (const material of materials) {
            if (material?.map && renderer) {
              material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
            }
          }
        });
        return template;
      })
      .catch((error) => {
        console.warn(`Failed to load ${carSpec.modelUrl}, falling back to procedural car.`, error);
        return null;
      });

    carTemplatePromises.set(carSpec.id, templatePromise);
    return templatePromise;
  }

  function normalizeCarModel(model, carSpec) {
    model.rotation.y = THREE.MathUtils.degToRad(carSpec.modelRotationDegrees || 0);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const targetLength = carSpec.targetLength || 4.35;
    const scale = size.z > 0.001 ? (targetLength / size.z) * visualScale : visualScale;

    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    model.updateMatrixWorld(true);
  }

  function smoothCarBodyGeometry(model) {
    if (racingSceneConfig.smoothBodyGeometry === false) {
      return;
    }

    const smoothingPatterns = racingSceneConfig.bodySmoothingNamePatterns ?? racingSceneConfig.bodyNamePatterns;
    const creaseAngleDegrees = racingSceneConfig.bodySmoothingCreaseAngleDegrees ?? 60;
    const creaseAngle = THREE.MathUtils.degToRad(creaseAngleDegrees);

    model.traverse((child) => {
      if (!child.isMesh || !child.geometry) {
        return;
      }

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      const shouldSmooth = materials.some((material) => {
        const label = materialLabelFor(child, material);
        return matchesAnyPattern(label, smoothingPatterns);
      });

      if (!shouldSmooth) {
        return;
      }

      const smoothedGeometry = toCreasedNormals(child.geometry, creaseAngle);
      smoothedGeometry.computeBoundingBox();
      smoothedGeometry.computeBoundingSphere();
      child.geometry = smoothedGeometry;
    });
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

  function configureCarMaterials(model) {
    model.traverse((child) => {
      if (!child.isMesh || !child.material) {
        return;
      }

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        const label = materialLabelFor(child, material);
        const isGlass = matchesAnyPattern(label, racingSceneConfig.glassNamePatterns);
        const isBody = matchesAnyPattern(label, racingSceneConfig.bodyNamePatterns);
        const preserveBodyMaterialProperties = racingSceneConfig.preserveBodyMaterialProperties !== false;

        if (material?.map && renderer) {
          material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }

        if ("envMapIntensity" in material) {
          if (isGlass) {
            material.envMapIntensity = racingSceneConfig.glassEnvMapIntensity;
          } else if (isBody) {
            if (!preserveBodyMaterialProperties && racingSceneConfig.bodyEnvMapIntensity != null) {
              material.envMapIntensity = racingSceneConfig.bodyEnvMapIntensity;
            }
          } else if (racingSceneConfig.detailEnvMapIntensity != null) {
            material.envMapIntensity = racingSceneConfig.detailEnvMapIntensity;
          }
        }

        if ("roughness" in material) {
          if (isGlass) {
            const roughnessFloor = racingSceneConfig.glassRoughnessFloor;
            if (roughnessFloor != null) {
              material.roughness = Math.max(material.roughness ?? roughnessFloor, roughnessFloor);
            }
          } else if (isBody && !preserveBodyMaterialProperties) {
            const roughnessFloor = racingSceneConfig.bodyRoughnessFloor;
            if (roughnessFloor != null) {
              material.roughness = Math.max(material.roughness ?? roughnessFloor, roughnessFloor);
            }
          }
        }

        if ("metalness" in material) {
          if (isGlass) {
            const metalnessCeiling = racingSceneConfig.glassMetalnessCeiling;
            if (metalnessCeiling != null) {
              material.metalness = Math.min(material.metalness ?? metalnessCeiling, metalnessCeiling);
            }
          } else if (isBody && !preserveBodyMaterialProperties) {
            const metalnessCeiling = racingSceneConfig.bodyMetalnessCeiling;
            if (metalnessCeiling != null) {
              material.metalness = Math.min(material.metalness ?? metalnessCeiling, metalnessCeiling);
            }
          }
        }

        material.needsUpdate = true;
      }
    });
  }

  function applyConfiguredCarTint(model, carSpec, tint = null) {
    const defaultPaintColor = carSpec?.defaultPaintColor
      ? Number.parseInt(carSpec.defaultPaintColor.replace("#", ""), 16)
      : null;
    const resolvedTint = defaultPaintColor ?? tint;
    const forceTint = defaultPaintColor != null;
    applyCarTint(model, resolvedTint, forceTint, carSpec?.tintIncludePatterns ?? null);
  }

  function applyCarTint(model, tint, force = false, includePatterns = null) {
    if (!tint || (!force && racingSceneConfig.allowTint === false)) {
      return;
    }

    const tintColor = new THREE.Color(tint);
    for (const material of tintTargetMaterialsFor(model, includePatterns)) {
      if ("color" in material) {
        material.color.copy(tintColor);
      }
      if ("roughness" in material) {
        material.roughness = Math.min(material.roughness ?? 0.58, 0.54);
      }
      if ("metalness" in material) {
        material.metalness = Math.max(material.metalness ?? 0.22, 0.22);
      }
      material.needsUpdate = true;
    }
  }

  function tintTargetMaterialsFor(model, includePatterns = null) {
    const exactMatches = [];
    const fallbackMatches = [];
    const targetPatterns = includePatterns?.length ? includePatterns : racingSceneConfig.bodyNamePatterns;

    model.traverse((child) => {
      if (!child.isMesh || !child.material) {
        return;
      }

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!("color" in material) || !material.color) {
          continue;
        }

        const label = materialLabelFor(child, material);
        if (matchesAnyPattern(label, racingSceneConfig.glassNamePatterns) || matchesAnyPattern(label, carSurfaceExclusionPatterns)) {
          continue;
        }

        if (matchesAnyPattern(label, targetPatterns)) {
          exactMatches.push(material);
          continue;
        }

        const colorEnergy = material.color.r + material.color.g + material.color.b;
        if (!material.transparent && colorEnergy > 0.24) {
          fallbackMatches.push(material);
        }
      }
    });

    return [...new Set(exactMatches.length > 0 ? exactMatches : fallbackMatches)];
  }

  function materialLabelFor(child, material) {
    return [
      child.name,
      child.parent?.name,
      material?.name
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function matchesAnyPattern(label, patterns) {
    return patterns.some((pattern) => label.includes(pattern));
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

  function createFallbackCar(_carSpec, color = 0xa81f34) {
    const group = new THREE.Group();
    const visualRoot = new THREE.Group();
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
      visualRoot.add(wheel);
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

    visualRoot.position.y = racingSceneConfig.groundOffset;
    group.userData.boostFlames = flames;
    group.userData.boostGroup = boostGroup;
    group.userData.visualRoot = visualRoot;
    visualRoot.add(body, hood, cabin, rear, frontLightLeft, frontLightRight);
    visualRoot.add(boostGroup);
    group.add(visualRoot);
    return group;
  }

  function loop(timestamp) {
    if (!active) return;

    const deltaSeconds = Math.min((timestamp - lastFrameTime) / 1000, 0.04);
    lastFrameTime = timestamp;
    if (!raceState.paused) {
      const sprintGlide = raceConfig.mode === "sprint" && raceState.finished && !raceState.resultVisible;

      if (!raceState.finished || sprintGlide) {
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
      updateCollisionDebugVisuals();
      updateCollisionDebugHud();
    }

    updateHud();
    renderer.render(scene, camera);

    animationFrameId = requestAnimationFrame(loop);
  }

  function setPaused(nextPaused) {
    if (!active && nextPaused) {
      return false;
    }

    if (nextPaused && isStartOverlayVisible()) {
      return false;
    }

    if (nextPaused && raceState.resultVisible) {
      return false;
    }

    if (raceState.paused === nextPaused) {
      return raceState.paused;
    }

    raceState.paused = nextPaused;
    keyState.clear();
    pauseOverlay.hidden = !nextPaused;

    if (nextPaused) {
      resumeButton.focus({ preventScroll: true });
    } else if (document.activeElement instanceof HTMLElement && pauseOverlay.contains(document.activeElement)) {
      document.activeElement.blur();
    }

    updateHud();
    return raceState.paused;
  }

  function updateControls() {
    const throttlePressed = keyState.has("KeyW") || keyState.has("ArrowUp");
    const brakePressed = keyState.has("KeyS") || keyState.has("ArrowDown");
    const leftPressed = keyState.has("KeyA") || keyState.has("ArrowLeft");
    const rightPressed = keyState.has("KeyD") || keyState.has("ArrowRight");
    const sprintGlide = raceConfig.mode === "sprint" && raceState.finished && !raceState.resultVisible;

    state.throttle = sprintGlide ? 0 : throttlePressed ? 1 : 0;
    state.brake = sprintGlide ? 0 : brakePressed ? 1 : 0;

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

    const activeBoost = state.boostSeconds > 0 && !(raceState.finished && raceConfig.mode === "sprint");
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
    opponentState.collisionLaneOffset = moveToward(
      opponentState.collisionLaneOffset,
      0,
      deltaSeconds * collisionConfig.opponentLaneRecovery
    );
    opponentState.collisionYawOffset = moveToward(
      opponentState.collisionYawOffset,
      0,
      deltaSeconds * collisionConfig.opponentYawRecovery
    );
    physics.opponentCollider.setEnabled(raceState.opponentEnabled);

    if (!raceState.opponentEnabled) {
      return;
    }

    if (!raceState.finished) {
      const targetSpeed = opponentConfig.speed * (
        opponentState.collisionHoldSeconds > 0
          ? collisionConfig.opponentImpactSpeedMultiplier
          : 1
      );
      const speedRecovery = opponentState.collisionHoldSeconds > 0 ? 8.4 : 6;
      opponentState.currentSpeed = moveToward(opponentState.currentSpeed, targetSpeed, deltaSeconds * speedRecovery);
    } else if (raceConfig.mode === "sprint") {
      opponentState.currentSpeed = Math.max(0, opponentState.currentSpeed - deltaSeconds * 6.5);
    } else {
      opponentState.currentSpeed = 0;
    }

    const deltaProgress = (opponentState.currentSpeed * deltaSeconds) / Math.max(trackLength, 0.0001);
    opponentState.progress = raceConfig.mode === "lap"
      ? wrapProgress(opponentState.progress + deltaProgress)
      : clamp(opponentState.progress + deltaProgress, 0, 1);

    syncOpponentPose();
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
      let impactNormal = null;
      const headingBeforeImpact = state.heading;

      if (tag === "rail") {
        impactNormal = currentRailImpactNormal();
        responseVelocity = resolveRailImpactVelocity(
          new THREE.Vector2(current.x, current.z),
          impactNormal
        );
        separatePlayerFromImpact(impactNormal, 0.18);
        physics.playerBody.setLinvel({ x: responseVelocity.x, y: current.y, z: responseVelocity.y }, true);
        state.boostSeconds = 0;
        state.drifting = false;
        state.stoppedByImpactSeconds = Math.max(state.stoppedByImpactSeconds, collisionConfig.stopSeconds);
      } else if (tag === "opponent" && raceState.opponentEnabled) {
        const opponentDelta = state.position.clone().sub(opponentState.position).normalize();
        impactNormal = opponentDelta.lengthSq() > 0.0001 ? opponentDelta : forwardVector();
        responseVelocity = resolveOpponentCarImpactVelocity(
          new THREE.Vector2(current.x, current.z),
          impactNormal,
          opponentState.currentSpeed
        );
        physics.playerBody.setLinvel({ x: responseVelocity.x, y: current.y, z: responseVelocity.y }, true);
        state.boostSeconds = 0;
        state.drifting = false;
        state.stoppedByImpactSeconds = Math.max(state.stoppedByImpactSeconds, collisionConfig.carStopSeconds);
        opponentState.collisionHoldSeconds = Math.max(
          opponentState.collisionHoldSeconds,
          collisionConfig.opponentPauseSeconds
        );
        applyOpponentCollisionReaction(impactNormal);
      }

      if (responseVelocity) {
        applyCollisionHeading(responseVelocity);
        recordCollisionDebug({
          tag: tag ?? "unknown",
          handle: otherHandle,
          currentVelocity: new THREE.Vector2(current.x, current.z),
          responseVelocity,
          impactNormal,
          headingBefore: headingBeforeImpact,
          headingAfter: state.heading
        });
      }
    });
  }

  function currentRailImpactNormal() {
    const sample = trackSamples[state.trackIndex];
    const delta = state.position.clone().sub(sample.center);
    const side = Math.sign(delta.dot(sample.normal)) || 1;
    return sample.normal.clone().multiplyScalar(side).normalize();
  }

  function resolveRailImpactVelocity(velocity, surfaceNormal) {
    const trackTangent = trackSamples[state.trackIndex].tangent.clone();
    const tangentDirection = velocity.dot(trackTangent) >= 0 ? 1 : -1;
    const slideDirection = trackTangent.multiplyScalar(tangentDirection);
    const forwardTrackSpeed = Math.abs(velocity.dot(slideDirection));
    const slideFloor = state.throttle > 0.1
      ? railImpactConfig.throttleSlideFloor
      : railImpactConfig.coastSlideFloor;
    const slideVelocity = slideDirection.multiplyScalar(
      Math.max(forwardTrackSpeed * railImpactConfig.slideSpeedRetention, slideFloor)
    );
    const bounceVelocity = resolveImpactVelocity(
      velocity,
      surfaceNormal,
      railImpactConfig.tangentDamping,
      railImpactConfig.bounceFactor
    );

    return slideVelocity.add(bounceVelocity).clampLength(0, playerMaxForwardSpeed() * railImpactConfig.maxSpeedMultiplier);
  }

  function resolveOpponentCarImpactVelocity(velocity, surfaceNormal, opponentForwardSpeed) {
    const trackTangent = trackSamples[state.trackIndex].tangent.clone();
    const tangentDirection = velocity.dot(trackTangent) >= 0 ? 1 : -1;
    const forwardDirection = trackTangent.multiplyScalar(tangentDirection);
    const currentForwardSpeed = Math.abs(velocity.dot(forwardDirection));
    const preservedForwardSpeed = Math.max(
      currentForwardSpeed * collisionConfig.playerOpponentForwardRetention,
      Math.min(collisionConfig.playerOpponentMinForwardSpeed, playerMaxForwardSpeed() * 0.22)
    );
    const shoveDirection = surfaceNormal.clone().normalize();
    const relativeSpeedBoost = clamp(opponentForwardSpeed / Math.max(opponentConfig.speed, 0.0001), 0.7, 1.3);
    const shoveVelocity = shoveDirection.multiplyScalar(collisionConfig.playerOpponentSideShove * relativeSpeedBoost);
    const bounceVelocity = resolveImpactVelocity(velocity, surfaceNormal, 0.58, 0.2);

    return forwardDirection
      .multiplyScalar(preservedForwardSpeed)
      .add(shoveVelocity)
      .add(bounceVelocity)
      .clampLength(0, playerMaxForwardSpeed() * 0.78);
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

  function applyCollisionHeading(responseVelocity) {
    const responseSpeed = responseVelocity.length();
    if (responseSpeed < collisionConfig.headingResponseMinSpeed) {
      return;
    }

    const targetHeading = Math.atan2(responseVelocity.x, responseVelocity.y);
    const headingDelta = shortestAngleDelta(state.heading, targetHeading);
    if (Math.abs(headingDelta) >= collisionConfig.headingIgnoreAngle) {
      return;
    }

    state.heading = normalizeAngle(
      state.heading + clamp(headingDelta, -collisionConfig.headingCorrectionMax, collisionConfig.headingCorrectionMax)
    );
  }

  function applyOpponentCollisionReaction(impactNormal) {
    const sample = trackProfileAtProgress(opponentState.progress);
    const lateralRelation = impactNormal.dot(sample.normal);
    const fallbackLateral = state.velocity.dot(sample.normal);
    const shoveDirection = Math.abs(lateralRelation) > 0.14
      ? -Math.sign(lateralRelation)
      : -(Math.sign(fallbackLateral) || 1);

    opponentState.currentSpeed = Math.max(0, opponentState.currentSpeed - collisionConfig.opponentSpeedLoss);
    opponentState.collisionLaneOffset = clamp(
      opponentState.collisionLaneOffset + shoveDirection * collisionConfig.opponentLaneKick,
      -sample.railLimit * 0.55,
      sample.railLimit * 0.55
    );
    opponentState.collisionYawOffset = clamp(
      opponentState.collisionYawOffset + shoveDirection * collisionConfig.opponentYawKick,
      -0.5,
      0.5
    );
  }

  function recordCollisionDebug({
    tag,
    handle,
    currentVelocity,
    responseVelocity,
    impactNormal,
    headingBefore,
    headingAfter
  }) {
    collisionDebug.lastCollision = {
      tag,
      handle,
      timeSeconds: raceState.elapsedSeconds,
      preSpeed: currentVelocity.length(),
      postSpeed: responseVelocity.length(),
      headingDelta: shortestAngleDelta(headingBefore, headingAfter),
      responseVelocity: responseVelocity.clone(),
      impactNormalLabel: impactNormal
        ? `${impactNormal.x.toFixed(2)}, ${impactNormal.y.toFixed(2)}`
        : "--"
    };
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
    raceState.elapsedSeconds += deltaSeconds;

    if (raceConfig.mode === "lap") {
      if (raceState.finished) {
        return;
      }

      state.lapLockSeconds = Math.max(0, state.lapLockSeconds - deltaSeconds);
      if (raceState.opponentEnabled) {
        opponentState.lapLockSeconds = Math.max(0, opponentState.lapLockSeconds - deltaSeconds);
      }

      advanceLapCounter(state, state.velocity.dot(trackSamples[state.trackIndex].tangent));
      if (raceState.opponentEnabled) {
        advanceLapCounter(opponentState, opponentState.currentSpeed);
      }

      raceState.playerPlace = raceState.opponentEnabled && playerRaceDistance() < opponentRaceDistance() ? 2 : 1;

      if (state.completedLaps >= raceConfig.totalLaps) {
        finishLapRace("player");
      } else if (raceState.opponentEnabled && opponentState.completedLaps >= raceConfig.totalLaps) {
        finishLapRace("opponent");
      }

      return;
    }

    updateSprintDriverProgress(state);
    if (raceState.opponentEnabled) {
      updateSprintDriverProgress(opponentState);
    }

    raceState.playerPlace = raceState.opponentEnabled && state.maxForwardDistance < opponentState.maxForwardDistance ? 2 : 1;

    const playerTrackSpeed = state.velocity.dot(trackSamples[state.trackIndex].tangent);
    const playerCrossed = didDriverCrossSprintFinish(state, playerTrackSpeed);
    const opponentCrossed = raceState.opponentEnabled && didDriverCrossSprintFinish(opponentState, opponentState.currentSpeed);

    if (!raceState.finished && (playerCrossed || opponentCrossed)) {
      lockSprintFinish(playerCrossed, opponentCrossed);
    }

    if (raceState.finished && !raceState.resultVisible) {
      raceState.settleSeconds += deltaSeconds;
      if (raceState.settleSeconds >= raceConfig.sprintGlideSeconds) {
        revealSprintResult();
      }
    }

    state.lastRaceProgress = state.raceProgress;
    if (raceState.opponentEnabled) {
      opponentState.lastRaceProgress = opponentState.raceProgress;
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

  function updateSprintDriverProgress(driverState) {
    driverState.maxForwardProgress = Math.max(driverState.maxForwardProgress, driverState.raceProgress);
    driverState.maxForwardDistance = Math.max(driverState.maxForwardDistance, driverState.raceProgress * trackLength);
  }

  function didDriverCrossSprintFinish(driverState, trackSpeed) {
    if (raceState.finished || driverState.finishTimeSeconds != null) {
      return false;
    }

    if (!driverState.onRoad || trackSpeed <= raceConfig.minForwardTrackSpeed) {
      return false;
    }

    return driverState.lastRaceProgress < raceConfig.finishProgress
      && driverState.raceProgress >= raceConfig.finishProgress;
  }

  function lockSprintFinish(playerCrossed, opponentCrossed) {
    let winner = "";

    if (playerCrossed && opponentCrossed) {
      winner = sprintFinishLead(state) >= sprintFinishLead(opponentState) ? "player" : "opponent";
    } else {
      winner = playerCrossed ? "player" : "opponent";
    }

    raceState.finished = true;
    raceState.winner = winner;
    raceState.playerPlace = winner === "player" ? 1 : 2;
    raceState.settleSeconds = 0;
    state.boostSeconds = 0;
    state.drifting = false;
    keyState.delete("KeyW");
    keyState.delete("ArrowUp");
    keyState.delete("KeyS");
    keyState.delete("ArrowDown");

    const winnerState = winner === "player" ? state : opponentState;
    winnerState.finishTimeSeconds = raceState.elapsedSeconds;
  }

  function sprintFinishLead(driverState) {
    return driverState.raceProgress - raceConfig.finishProgress;
  }

  function finishLapRace(winner) {
    if (raceState.finished) return;

    raceState.finished = true;
    raceState.resultVisible = true;
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
    car.rotation.set(0, state.heading, 0);

    const visualRoot = car.userData.visualRoot;
    if (visualRoot) {
      visualRoot.rotation.x = (state.brake - state.throttle * 0.45) * 0.03;
      visualRoot.rotation.z = -state.steering * Math.min(0.12, state.velocity.length() * 0.004);
    }
  }

  function updateOpponentTransform() {
    opponentCar.visible = raceState.opponentEnabled;
    if (!raceState.opponentEnabled) {
      return;
    }

    opponentCar.position.set(opponentState.position.x, 0, opponentState.position.y);
    opponentCar.rotation.set(0, opponentState.heading, 0);

    const visualRoot = opponentCar.userData.visualRoot;
    if (visualRoot) {
      visualRoot.rotation.x = -Math.abs(opponentState.collisionYawOffset) * 0.08;
      visualRoot.rotation.z = -opponentState.collisionYawOffset * 0.55;
    }
  }

  function updateCollisionDebugVisuals() {
    if (!collisionDebug.enabled) {
      updateCollisionDebugVisibility();
      return;
    }

    ensureCollisionDebugVisuals();
    if (!collisionDebug.group || !collisionDebug.playerWire || !collisionDebug.opponentWire) {
      return;
    }

    const playerBodyHeight = physicsConfig.fixedHeight;
    collisionDebug.playerWire.position.set(state.position.x, playerBodyHeight, state.position.y);
    collisionDebug.playerWire.rotation.set(0, state.heading, 0);

    collisionDebug.opponentWire.visible = raceState.opponentEnabled;
    if (raceState.opponentEnabled) {
      collisionDebug.opponentWire.position.set(opponentState.position.x, playerBodyHeight, opponentState.position.y);
      collisionDebug.opponentWire.rotation.set(0, opponentState.heading, 0);
    }

    const activeImpactHandle = collisionDebug.lastCollision && raceState.elapsedSeconds - collisionDebug.lastCollision.timeSeconds < 1.25
      ? collisionDebug.lastCollision.handle
      : null;
    setWireColor(collisionDebug.playerWire, collisionDebugColors.player);
    setWireColor(collisionDebug.opponentWire, activeImpactHandle === physics?.opponentCollider?.handle ? collisionDebugColors.impact : collisionDebugColors.opponent);
    for (const [handle, wire] of collisionDebug.railWiresByHandle) {
      setWireColor(wire, handle === activeImpactHandle ? collisionDebugColors.impact : collisionDebugColors.rail);
    }

    const arrowOrigin = new THREE.Vector3(state.position.x, playerBodyHeight + 0.2, state.position.y);
    setDebugArrow(
      collisionDebug.headingArrow,
      arrowOrigin,
      new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading)),
      3.6,
      true
    );

    const velocitySpeed = state.velocity.length();
    setDebugArrow(
      collisionDebug.velocityArrow,
      arrowOrigin.clone().add(new THREE.Vector3(0, 0.2, 0)),
      new THREE.Vector3(state.velocity.x, 0, state.velocity.y),
      clamp(velocitySpeed * 0.28, 0.8, 5.4),
      velocitySpeed > 0.08
    );

    const responseVector = collisionDebug.lastCollision?.responseVelocity;
    const responseAge = collisionDebug.lastCollision ? raceState.elapsedSeconds - collisionDebug.lastCollision.timeSeconds : Number.POSITIVE_INFINITY;
    setDebugArrow(
      collisionDebug.responseArrow,
      arrowOrigin.clone().add(new THREE.Vector3(0, 0.4, 0)),
      responseVector ? new THREE.Vector3(responseVector.x, 0, responseVector.y) : new THREE.Vector3(),
      clamp((responseVector?.length() ?? 0) * 0.28, 0.8, 5.4),
      Boolean(responseVector) && responseAge < 1.5
    );
  }

  function setWireColor(wire, color) {
    if (!wire?.material?.color) {
      return;
    }
    wire.material.color.setHex(color);
  }

  function setDebugArrow(arrow, origin, direction, length, visible) {
    if (!arrow) {
      return;
    }

    arrow.visible = visible;
    if (!visible) {
      return;
    }

    const normalized = direction.clone().normalize();
    if (!Number.isFinite(normalized.x) || direction.lengthSq() < 0.000001) {
      arrow.visible = false;
      return;
    }

    arrow.position.copy(origin);
    arrow.setDirection(normalized);
    arrow.setLength(length, 0.5, 0.28);
  }

  function updateCollisionDebugHud() {
    if (!collisionDebug.enabled) {
      updateCollisionDebugVisibility();
      return;
    }

    const hud = ensureCollisionDebugHud();
    const headingDegrees = THREE.MathUtils.radToDeg(state.heading);
    const velocityHeading = state.velocity.lengthSq() > 0.0001
      ? THREE.MathUtils.radToDeg(Math.atan2(state.velocity.x, state.velocity.y))
      : null;
    const lastCollision = collisionDebug.lastCollision;
    const lastCollisionLines = lastCollision
      ? [
          `last ${lastCollision.tag}  t=${lastCollision.timeSeconds.toFixed(2)}s`,
          `pre  ${lastCollision.preSpeed.toFixed(2)} m/s`,
          `post ${lastCollision.postSpeed.toFixed(2)} m/s`,
          `turn ${THREE.MathUtils.radToDeg(lastCollision.headingDelta).toFixed(1)} deg`,
          `impact ${lastCollision.impactNormalLabel}`
        ]
      : ["last none"];

    hud.textContent = [
      "Collision Debug  [F2]",
      `preset ${drivingFeelPreset.id}`,
      `onRoad ${state.onRoad ? "yes" : "no"}  paused ${raceState.paused ? "yes" : "no"}`,
      `speed ${(state.velocity.length() * 3.6).toFixed(0)} km/h`,
      `heading ${headingDegrees.toFixed(1)} deg`,
      `velocity ${velocityHeading === null ? "--" : velocityHeading.toFixed(1)} deg`,
      `player box ${(physicsConfig.carHalfWidth * 2).toFixed(2)} x ${(physicsConfig.carHalfHeight * 2).toFixed(2)} x ${(physicsConfig.carHalfLength * 2).toFixed(2)}`,
      ...lastCollisionLines
    ].join("\n");
    updateCollisionDebugVisibility();
  }

  function updateCamera(deltaSeconds) {
    const speedRatio = clamp(state.velocity.length() / Math.max(playerMaxForwardSpeed(), 0.0001), 0, 1);
    const dynamicLookAhead = cameraConfig.lookAhead + cameraConfig.speedLookAheadBoost * speedRatio;
    const headingFollow = 1 - Math.exp(-deltaSeconds * cameraConfig.headingFollowTightness);
    cameraHeading = normalizeAngle(
      cameraHeading + shortestAngleDelta(cameraHeading, state.heading) * headingFollow
    );
    const forward = new THREE.Vector3(Math.sin(cameraHeading), 0, Math.cos(cameraHeading));
    const target = new THREE.Vector3(state.position.x, cameraConfig.targetHeight, state.position.y)
      .addScaledVector(forward, dynamicLookAhead);
    const desired = new THREE.Vector3(state.position.x, 0, state.position.y)
      .addScaledVector(forward, -cameraConfig.followDistance)
      .add(new THREE.Vector3(0, cameraConfig.height, 0));

    const follow = 1 - Math.exp(-deltaSeconds * cameraConfig.followTightness);
    camera.position.lerp(desired, follow);
    const targetFov = cameraConfig.fov + cameraConfig.speedFovBoost * speedRatio;
    const fovFollow = 1 - Math.exp(-deltaSeconds * cameraConfig.speedFovResponse);
    camera.fov += (targetFov - camera.fov) * fovFollow;
    camera.updateProjectionMatrix();
    camera.lookAt(target);
  }

  function updateHud() {
    progressLabel.textContent = raceConfig.mode === "lap" ? "LAP" : "LEFT";
    progressValue.textContent = raceConfig.mode === "lap"
      ? formatLapDisplay(state.completedLaps)
      : formatDistanceHud(sprintRemainingDistance(state));
    placeValue.textContent = `${raceState.playerPlace} / ${raceState.opponentEnabled ? 2 : 1}`;
    speedValue.textContent = `${Math.round(state.velocity.length() * 3.6)}`;
    boostValue.textContent = state.boostSeconds > 0
      ? `${state.boostSeconds.toFixed(1)}S`
      : `x${state.boostCharges}`;
  }

  function currentStatusLabel() {
    if (raceState.finished) {
      if (raceConfig.mode === "sprint" && !raceState.resultVisible) {
        return raceState.winner === "player" ? "冲线滑行" : "败方收尾";
      }

      return raceState.winner === "player" ? "你赢了" : "惜败";
    }

    if (!raceState.opponentEnabled) {
      return raceConfig.mode === "lap" ? "单人跑" : "单人冲刺";
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

    if (raceConfig.mode === "sprint") {
      return raceState.playerPlace === 1 ? "冲刺领先" : "追赶中";
    }

    return raceState.playerPlace === 1 ? "领先" : "追赶中";
  }

  function resetRace() {
    hideResultOverlay();
    pauseOverlay.hidden = true;
    collisionDebug.lastCollision = null;

    const start = trackProfileAtProgress(raceConfig.startProgress);
    const startPosition = start.center.clone().add(start.normal.clone().multiplyScalar(2.8));

    state.position.copy(startPosition);
    state.velocity.set(0, 0);
    state.heading = start.heading;
    cameraHeading = start.heading;
    state.steering = 0;
    state.throttle = 0;
    state.brake = 0;
    state.onRoad = true;
    state.stoppedByImpactSeconds = 0;
    state.previousPosition.copy(startPosition);
    state.previousTrackIndex = Math.round(raceConfig.startProgress * trackConfig.samples) % trackConfig.samples;
    state.trackIndex = Math.round(raceConfig.startProgress * trackConfig.samples) % trackConfig.samples;
    state.trackProgress = raceMode === "lap" ? raceConfig.startProgress : 0;
    state.raceProgress = 0;
    state.lastRaceProgress = 0;
    state.maxForwardProgress = 0;
    state.maxForwardDistance = 0;
    state.finishTimeSeconds = null;
    state.completedLaps = 0;
    state.lapLockSeconds = 0;
    state.lapArmed = false;
    state.boostSeconds = 0;
    state.boostCharges = boostConfig.charges;
    state.drifting = false;

    opponentState.progress = opponentConfig.startProgress;
    opponentState.laneOffset = opponentConfig.laneOffset;
    opponentState.collisionLaneOffset = 0;
    opponentState.collisionYawOffset = 0;
    opponentState.onRoad = true;
    opponentState.collisionHoldSeconds = 0;
    opponentState.currentSpeed = opponentConfig.speed;
    opponentState.raceProgress = 0;
    opponentState.lastRaceProgress = 0;
    opponentState.maxForwardProgress = 0;
    opponentState.maxForwardDistance = 0;
    opponentState.finishTimeSeconds = null;
    opponentState.completedLaps = 0;
    opponentState.lapLockSeconds = 0;
    opponentState.lapArmed = false;

    raceState.finished = false;
    raceState.resultVisible = false;
    raceState.winner = "";
    raceState.playerPlace = 1;
    raceState.paused = false;
    raceState.elapsedSeconds = 0;
    raceState.settleSeconds = 0;

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
    if (raceMode === "sprint") {
      state.maxForwardProgress = state.raceProgress;
      state.maxForwardDistance = state.raceProgress * trackLength;
    }
    opponentState.raceProgress = relativeRaceProgress(opponentState.progress);
    opponentState.lastRaceProgress = opponentState.raceProgress;
    if (raceMode === "sprint") {
      opponentState.maxForwardProgress = opponentState.raceProgress;
      opponentState.maxForwardDistance = opponentState.raceProgress * trackLength;
    }

    if (car && camera && renderer) {
      updateCarTransform();
      updateOpponentTransform();

      const forward = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
      camera.position.copy(
        new THREE.Vector3(state.position.x, 0, state.position.y)
          .addScaledVector(forward, -cameraConfig.followDistance)
          .add(new THREE.Vector3(0, cameraConfig.height, 0))
      );
      camera.lookAt(
        new THREE.Vector3(state.position.x, cameraConfig.targetHeight, state.position.y)
          .addScaledVector(forward, cameraConfig.lookAhead)
      );
    }

    updateHud();
  }

  function revealSprintResult() {
    if (raceState.resultVisible) {
      return;
    }

    raceState.resultVisible = true;
    showResultOverlay(raceState.winner);
    updateHud();
  }

  function showResultOverlay(winner) {
    raceState.paused = false;
    pauseOverlay.hidden = true;
    resultCard.classList.toggle("is-win", winner === "player");
    resultCard.classList.toggle("is-loss", winner !== "player");
    resultTag.textContent = winner === "player" ? "率先冲线" : "对手先冲线";
    resultTitle.textContent = winner === "player" ? "你赢了" : "惜败";

    if (raceConfig.mode === "lap") {
      resultSummary.textContent = !raceState.opponentEnabled
        ? `你完成了 ${raceConfig.totalLaps} 圈。`
        : winner === "player"
          ? `你率先完成 ${raceConfig.totalLaps} 圈，先冲过终点线。`
          : `对手先完成 ${raceConfig.totalLaps} 圈。你还在第 ${currentLapNumber(state.completedLaps)} 圈。`;
      resultPlayerLabel.textContent = "你的圈数";
      resultPlayerValue.textContent = formatLapDisplay(state.completedLaps);
      resultOpponentLabel.textContent = raceState.opponentEnabled ? "对手圈数" : "对手状态";
      resultOpponentValue.textContent = raceState.opponentEnabled ? formatLapDisplay(opponentState.completedLaps) : "未启用";
    } else {
      const playerWon = winner === "player";
      const winnerTime = playerWon ? state.finishTimeSeconds : opponentState.finishTimeSeconds;
      const playerRemaining = sprintRemainingDistance(state);
      const opponentRemaining = sprintRemainingDistance(opponentState);

      resultSummary.textContent = !raceState.opponentEnabled
        ? `你用时 ${formatTime(state.finishTimeSeconds)} 完成冲刺。`
        : playerWon
          ? `你用时 ${formatTime(winnerTime)} 率先通过终点，对手还剩 ${formatDistance(opponentRemaining)}。`
          : `对手用时 ${formatTime(winnerTime)} 完赛，你还剩 ${formatDistance(playerRemaining)}。`;
      resultPlayerLabel.textContent = playerWon ? "完赛用时" : "剩余距离";
      resultPlayerValue.textContent = playerWon ? formatTime(state.finishTimeSeconds) : formatDistance(playerRemaining);
      resultOpponentLabel.textContent = raceState.opponentEnabled
        ? playerWon ? "对手剩余" : "完赛用时"
        : "对手状态";
      resultOpponentValue.textContent = raceState.opponentEnabled
        ? playerWon ? formatDistance(opponentRemaining) : formatTime(opponentState.finishTimeSeconds)
        : "未启用";
    }

    resultOverlay.hidden = false;
  }

  function hideResultOverlay() {
    resultOverlay.hidden = true;
    resultCard.classList.remove("is-win", "is-loss");
    raceState.resultVisible = false;
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
    if (renderer && camera) {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(320, Math.floor(rect.width || 960));
      const height = Math.max(320, Math.floor(rect.height || 620));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    resizeSelectedCarPreview();
  }

  function resizeSelectedCarPreview() {
    if (!selectedCarPreviewRenderer || !selectedCarPreviewCamera) {
      return;
    }

    const rect = selectedCarPreviewCanvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width || 960));
    const height = Math.max(200, Math.floor(rect.height || 540));
    selectedCarPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    selectedCarPreviewRenderer.setSize(width, height, false);
    selectedCarPreviewCamera.aspect = width / height;
    selectedCarPreviewCamera.updateProjectionMatrix();
    renderSelectedCarPreviewFrame();
  }

  function addListeners() {
    if (listening) return;

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("resize", resizeRenderer);
    selectedCarPreviewCanvas.addEventListener("pointerdown", handleSelectedCarPreviewPointerDown);
    selectedCarPreviewCanvas.addEventListener("pointermove", handleSelectedCarPreviewPointerMove);
    selectedCarPreviewCanvas.addEventListener("pointerup", handleSelectedCarPreviewPointerUp);
    selectedCarPreviewCanvas.addEventListener("pointercancel", handleSelectedCarPreviewPointerUp);
    listening = true;
  }

  function removeListeners() {
    if (!listening) return;

    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    window.removeEventListener("blur", handleBlur);
    window.removeEventListener("resize", resizeRenderer);
    selectedCarPreviewCanvas.removeEventListener("pointerdown", handleSelectedCarPreviewPointerDown);
    selectedCarPreviewCanvas.removeEventListener("pointermove", handleSelectedCarPreviewPointerMove);
    selectedCarPreviewCanvas.removeEventListener("pointerup", handleSelectedCarPreviewPointerUp);
    selectedCarPreviewCanvas.removeEventListener("pointercancel", handleSelectedCarPreviewPointerUp);
    listening = false;
  }

  function handleKeyDown(event) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "KeyH", "KeyR", "Escape", "F2"].includes(event.code)) {
      event.preventDefault();
    }

    if (event.code === "F2" && !event.repeat) {
      setCollisionDebugEnabled(!collisionDebug.enabled);
      return;
    }

    if (isStartOverlayVisible()) {
      return;
    }

    if (event.code === "Escape" && !event.repeat) {
      setPaused(!raceState.paused);
      return;
    }

    if (raceState.paused) {
      return;
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

    if (event.code === "KeyR" && !event.repeat) {
      resetRace();
    }
  }

  function handleKeyUp(event) {
    keyState.delete(event.code);
  }

  function handleBlur() {
    keyState.clear();
    endSelectedCarPreviewDrag();
  }

  function handleSelectedCarPreviewPointerDown(event) {
    if (!isStartOverlayVisible() || !selectedCarPreviewCar) {
      return;
    }

    selectedCarPreviewPointerId = event.pointerId;
    selectedCarPreviewLastPointerX = event.clientX;
    selectedCarPreviewLastPointerTime = performance.now();
    selectedCarPreviewSpinVelocity = 0;
    selectedCarPanel.querySelector(".race-car-feature-stage")?.classList.add("is-dragging");
    selectedCarPreviewCanvas.setPointerCapture(event.pointerId);
  }

  function handleSelectedCarPreviewPointerMove(event) {
    if (event.pointerId !== selectedCarPreviewPointerId || !selectedCarPreviewCar) {
      return;
    }

    const now = performance.now();
    const deltaX = event.clientX - selectedCarPreviewLastPointerX;
    const deltaSeconds = Math.max((now - selectedCarPreviewLastPointerTime) / 1000, 0.016);
    const deltaAngle = deltaX * 0.012;

    selectedCarPreviewAngle += deltaAngle;
    selectedCarPreviewSpinVelocity = THREE.MathUtils.clamp(deltaAngle / deltaSeconds, -2.4, 2.4);
    selectedCarPreviewLastPointerX = event.clientX;
    selectedCarPreviewLastPointerTime = now;
    applyPreviewAngle(selectedCarPreviewCar, selectedCarPreviewAngle);
    renderSelectedCarPreviewFrame();
  }

  function handleSelectedCarPreviewPointerUp(event) {
    if (event.pointerId !== selectedCarPreviewPointerId) {
      return;
    }

    endSelectedCarPreviewDrag();
  }

  function endSelectedCarPreviewDrag() {
    if (selectedCarPreviewPointerId !== null && selectedCarPreviewCanvas.hasPointerCapture(selectedCarPreviewPointerId)) {
      selectedCarPreviewCanvas.releasePointerCapture(selectedCarPreviewPointerId);
    }
    selectedCarPreviewPointerId = null;
    selectedCarPanel.querySelector(".race-car-feature-stage")?.classList.remove("is-dragging");
  }

  function computeTrackBounds(samples) {
    const xs = samples.map((sample) => sample.center.x);
    const zs = samples.map((sample) => sample.center.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const width = maxX - minX;
    const depth = maxZ - minZ;
    const center = new THREE.Vector2((minX + maxX) / 2, (minZ + maxZ) / 2);
    const radius = samples.reduce((maxRadius, sample) => {
      return Math.max(maxRadius, sample.center.distanceTo(center) + sample.railOffset);
    }, 0);
    return { center, radius, minX, maxX, minZ, maxZ, width, depth };
  }

  function trackProfileAtProgress(progress) {
    return sampleTrackModel(trackModel, progress);
  }

  function syncOpponentPose() {
    const sample = trackProfileAtProgress(opponentState.progress);
    const laneOffset = clamp(
      opponentState.laneOffset + opponentState.collisionLaneOffset,
      -sample.railLimit + 1.4,
      sample.railLimit - 1.4
    );
    const position = sample.center.clone().add(sample.normal.clone().multiplyScalar(laneOffset));

    opponentState.position.copy(position);
    opponentState.heading = sample.heading + opponentState.collisionYawOffset;
    opponentState.onRoad = true;
    opponentState.raceProgress = relativeRaceProgress(opponentState.progress);
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
    const projection = projectPointOntoTrack(trackModel, position, preferredIndex);
    return {
      index: projection.segmentIndex,
      progress: projection.progress,
      distance: projection.distance,
      sample: projection
    };
  }

  function nearestRoadDistance(position) {
    return closestTrackSample(position).distance;
  }

  function relativeRaceProgress(progress) {
    return raceConfig.mode === "lap"
      ? wrapProgress(progress - raceConfig.startProgress)
      : clamp(progress, 0, 1);
  }

  function playerRaceDistance() {
    return raceDistanceFor(state);
  }

  function opponentRaceDistance() {
    return raceDistanceFor(opponentState);
  }

  function raceDistanceFor(driverState) {
    if (raceConfig.mode === "sprint") {
      return driverState.maxForwardDistance;
    }

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

  function sprintRemainingDistance(driverState) {
    return Math.max(0, raceConfig.finishProgress * trackLength - driverState.maxForwardDistance);
  }

  function formatDistance(distance) {
    return `${Math.max(0, Math.round(distance))} 米`;
  }

  function formatDistanceHud(distance) {
    return `${Math.max(0, Math.round(distance))} M`;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) {
      return "--";
    }

    return `${seconds.toFixed(2)} 秒`;
  }

  function sampleProgressForIndex(index, sampleCount) {
    if (trackModel.closed) {
      return index / sampleCount;
    }

    return sampleCount <= 1 ? 0 : clamp(index / (sampleCount - 1), 0, 1);
  }

  function forwardVector() {
    return new THREE.Vector2(Math.sin(state.heading), Math.cos(state.heading));
  }

  function wrapProgress(progress) {
    return ((progress % 1) + 1) % 1;
  }

  function circularProgressDistance(left, right) {
    const delta = Math.abs(wrapProgress(left) - wrapProgress(right));
    return Math.min(delta, 1 - delta);
  }

  function wrapIndex(index, length) {
    return ((index % length) + length) % length;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function normalizeAngle(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  function shortestAngleDelta(from, to) {
    return normalizeAngle(to - from);
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function moveToward(current, target, maxDelta) {
    if (current < target) {
      return Math.min(current + maxDelta, target);
    }

    return Math.max(current - maxDelta, target);
  }

  function registerDebugApi() {
    globalThis.__ackGamesDebug = globalThis.__ackGamesDebug || {};
    globalThis.__ackGamesDebug.racing = debugApi;
  }

  function placeCollisionScenario() {
    const opponentProgress = 0.12;
    const laneOffset = 0;
    const playerProgress = wrapProgress(opponentProgress + 0.0065);
    const playerSample = trackProfileAtProgress(playerProgress);

    opponentState.progress = opponentProgress;
    opponentState.laneOffset = laneOffset;
    opponentState.collisionLaneOffset = 0;
    opponentState.collisionYawOffset = 0;
    opponentState.collisionHoldSeconds = 0;
    syncOpponentPose();

    state.position.copy(playerSample.center.clone().add(playerSample.normal.clone().multiplyScalar(laneOffset)));
    state.previousPosition.copy(state.position);
    state.velocity.set(0, 0);
    state.heading = playerSample.heading;
    cameraHeading = playerSample.heading;
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
      updateCollisionDebugVisuals();
      updateCollisionDebugHud();
      renderer.render(scene, camera);
    }
  }

  registerDebugApi();
  startRaceButton.addEventListener("click", handleStartRaceButtonClick);
  startEditorButton.addEventListener("click", handleStartEditorButtonClick);
  startHomeButton.addEventListener("click", handleStartHomeButtonClick);
  resumeButton.addEventListener("click", handleResumeButtonClick);
  pauseResetButton.addEventListener("click", handlePauseResetButtonClick);
  pauseEditorButton.addEventListener("click", handlePauseEditorButtonClick);
  pauseHomeButton.addEventListener("click", handlePauseHomeButtonClick);
  playAgainButton.addEventListener("click", handleResetButtonClick);

  return { start, stop, reset: resetRace, destroy };
}
