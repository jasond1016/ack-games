import * as THREE from "three";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/loaders/DRACOLoader.js";
import { RGBELoader } from "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/loaders/RGBELoader.js";
import { toCreasedNormals } from "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/utils/BufferGeometryUtils.js";
import RAPIER from "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.3/+esm";
import {
  getDefaultOpponentRacingCarId,
  getRacingCarById,
  racingCarCatalog,
  racingSceneConfig
} from "./racing-car-config.js";
import {
  RACING_CAMERA_MODES,
  loadActiveRacingStartConfig,
  saveActiveRacingStartConfig
} from "./racing-start-config.js";
import { RACING_ACTIVITIES, TRACK_SURFACES, racingMapLibrary } from "./racing-map.js";
import {
  createRacingTrackRuntimeAdapter,
  inspectRacingTrack
} from "./racing-track.mjs";
import {
  disposeObject3DTree,
  disposePhysicsState,
  disposeRenderer,
  disposeSceneResources,
  markMaterialsOnlyDispose
} from "./racing-resource-cleanup.mjs";
import { createRacingFinishCinematic } from "./racing-finish-cinematic.js";
import {
  createRacingResult,
  createRacingSession,
  createRacingSnapshot,
  createSeededRandom
} from "./racing-session.mjs";
import { createBrowserRacingClock, createBrowserRacingInput } from "./racing-runtime-adapters.mjs";
import { createResourceLeaseCache } from "./racing-resource-leases.mjs";
import { createRacingAudioController } from "./racing-audio.mjs";
import { createRacingHapticsController } from "./racing-haptics.mjs";
import {
  partitionSurfaceTrianglesBySlope,
  validateDrivableRibbon,
  validateDrivableSurfaceSet
} from "./racing-drivable-surface-validation.mjs";
import {
  FREE_DRIVE_RALLY,
  FREE_DRIVE_SHOWCASE,
  FREE_DRIVE_TUNNEL,
  createFreeDriveShowcaseDrivingLine,
  createFreeDriveShowcaseRoute,
  createFreeDriveRallyRibbon,
  createFreeDriveRallyRoute,
  createFreeDriveTunnelSegments,
  sampleFreeDriveShowcaseDrivingLine
} from "./racing-free-drive-features.mjs";
import {
  createFreeDriveTimeTrial,
  sampleGhostPose
} from "./racing-free-drive-challenge.mjs";
import {
  advanceWheelSpin,
  createWheelAnimationState,
  findWheelGeometryLayout,
  isWheelVisualLabel
} from "./racing-wheel-animation.mjs";
import {
  shouldActivateComputerBoost
} from "./racing-driving-dynamics.mjs";
import { createRacingTelemetry } from "./racing-telemetry.mjs";
import { PROVING_GROUND_TESTS, createProvingGroundTestRunner } from "./racing-proving-ground.mjs";
import {
  createVehicleContactPoints,
  resolveVehicleSupport
} from "./racing-surface-contact.mjs";
import {
  createPhysicalVehicle,
  getPhysicalVehicleSpec,
  resetPhysicalVehicleControls,
  updatePhysicalVehicle
} from "./racing-physical-vehicle.mjs";
import {
  isPhysicalVehicleSurface,
  physicalFallbackGroundHeight,
  physicalRoadSupportHalfWidth
} from "./racing-physical-surfaces.mjs";
import {
  FREE_DRIVE_JUMP,
  FREE_DRIVE_STUNT_JUMP,
  createFreeDriveStuntRampColliderSpecs,
  freeDriveJumpRampRise,
  freeDriveStuntRampRise,
  isFreeDriveJumpGap,
  isFreeDriveJumpGapSegment,
  resolveFreeDriveJumpLaunch
} from "./racing-jump-rules.mjs";

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
const carTemplateLeases = createResourceLeaseCache({
  load: ({ carSpec, prepare }) => prepare(carSpec)
});
const distanceMarkerTextureCache = new Map();
const rapierReadyPromise = RAPIER.init();
const upAxis = new THREE.Vector3(0, 1, 0);
const tempQuaternion = new THREE.Quaternion();
const showcaseCountdownSeconds = 3;
const showcaseGoBannerSeconds = 0.8;
const showcaseFinishHoldSeconds = 0.9;
const showcaseRecoveryPenaltySeconds = 2.5;
const collisionDebugColors = {
  player: 0x44ff88,
  opponent: 0x4da3ff,
  rail: 0xf4d35e,
  heading: 0xff5d73,
  velocity: 0x5fe0ff,
  response: 0xff9f1c,
  impact: 0xff4d4d
};
const physicalDrivingConfig = Object.freeze({
  maxForwardSpeed: 50,
  steeringResponse: 0.45,
  steeringReleaseResponse: 0.32,
  opponentImpactSpeedMultiplier: 0.64,
  opponentLaneRecovery: 4.6,
  opponentYawRecovery: 5.4,
  camera: Object.freeze({
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
  })
});

function createCarModelLoader() {
  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(dracoDecoderPath);
  loader.setDRACOLoader(dracoLoader);
  return loader;
}

export function createRacingGame({
  initialSnapshot = null,
  clock = createBrowserRacingClock(),
  onHome = () => {},
  onEditMap = () => {},
  onReplaceSession = () => {}
} = {}) {
  const qualityPreset = resolveRacingQualityPreset();
  const selectedMapEntry = initialSnapshot ? null : racingMapLibrary.snapshot().selected;
  const mapData = initialSnapshot?.map ?? selectedMapEntry.map;
  const environmentProfile = initialSnapshot?.environmentProfile ?? selectedMapEntry?.environmentProfile ?? null;
  const isShowcase = environmentProfile === "coastal-showcase";
  const isProvingGround = environmentProfile === "proving-ground";
  const isIslandWorld = environmentProfile === "island-sandbox" || isShowcase;
  const startConfig = initialSnapshot?.startConfig ?? loadActiveRacingStartConfig();
  const canvas = document.getElementById("racingCanvas");
  const hudOverlay = document.getElementById("racingHudOverlay");
  const progressLabel = document.getElementById("racingProgressLabel");
  const progressValue = document.getElementById("racingProgressValue");
  const placeValue = document.getElementById("racingPlaceValue");
  const speedValue = document.getElementById("racingSpeedValue");
  const boostValue = document.getElementById("racingBoostValue");
  const cameraValue = document.getElementById("racingCameraValue");
  const eventBanner = document.getElementById("racingEventBanner");
  const eventBannerKicker = document.getElementById("racingEventBannerKicker");
  const eventBannerValue = document.getElementById("racingEventBannerValue");
  const eventBannerDetail = document.getElementById("racingEventBannerDetail");
  const routeGuide = document.getElementById("racingRouteGuide");
  const routeArrow = document.getElementById("racingRouteArrow");
  const routeSection = document.getElementById("racingRouteSection");
  const routeDistance = document.getElementById("racingRouteDistance");
  const routeNotice = document.getElementById("racingRouteNotice");
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
  const finishCanvas = document.getElementById("racingFinishCanvas");
  const finishTrack = document.getElementById("racingFinishTrack");
  const finishPlaceNumber = document.getElementById("racingFinishPlaceNumber");
  const finishPlaceSuffix = document.getElementById("racingFinishPlaceSuffix");
  const resultCard = document.getElementById("racingResultCard");
  const confetti = document.getElementById("racingConfetti");
  const resultTag = document.getElementById("racingResultTag");
  const resultTitle = document.getElementById("racingResultTitle");
  const resultSummary = document.getElementById("racingResultSummary");
  const resultPlayerLabel = document.getElementById("racingResultPlayerLabel");
  const resultPlayerValue = document.getElementById("racingResultPlayerValue");
  const resultOpponentLabel = document.getElementById("racingResultOpponentLabel");
  const resultOpponentValue = document.getElementById("racingResultOpponentValue");
  const finishCinematic = createRacingFinishCinematic({ overlay: resultOverlay, canvas: finishCanvas });
  const playAgainButton = document.getElementById("racingPlayAgainButton");
  const racingAudio = createRacingAudioController();
  const racingHaptics = createRacingHapticsController();
  let selectedCarId = getRacingCarById(startConfig.playerCarId).id;
  let cameraMode = startConfig.cameraMode;
  let session = null;
  let sessionControls = null;
  let activeSnapshot = initialSnapshot;
  let lockedResult = null;
  let random = initialSnapshot ? createSeededRandom(initialSnapshot.randomSeed) : Math.random;
  const handleResumeButtonClick = () => {
    void racingAudio.resume();
    setPaused(false);
  };
  const handleStartRaceButtonClick = () => {
    void racingAudio.resume();
    beginRace();
  };
  const handleStartEditorButtonClick = () => {
    void requestSessionIntent({ type: "exit-to-editor" });
  };
  const handleStartHomeButtonClick = () => {
    void requestSessionIntent({ type: "exit-to-home" });
  };
  const handlePauseResetButtonClick = () => {
    if (isShowcase) restartShowcaseEvent();
    else void requestSessionIntent({ type: "replace-session", snapshot: activeSnapshot });
  };
  const handlePauseEditorButtonClick = () => {
    void requestSessionIntent({ type: "exit-to-editor" });
  };
  const handlePauseHomeButtonClick = () => {
    void requestSessionIntent({ type: "exit-to-home" });
  };
  const handleResetButtonClick = () => {
    if (isShowcase) restartShowcaseEvent();
    else void requestSessionIntent({ type: "replace-session", snapshot: activeSnapshot });
  };
  const input = createBrowserRacingInput({
    onDrive(code, pressed) {
      if (isStartOverlayVisible() || raceState.paused) return;
      if (pressed) void racingAudio.resume();
      if (pressed) keyState.add(code);
      else keyState.delete(code);
    },
    onPause: () => {
      if (!isStartOverlayVisible()) setPaused(!raceState.paused);
    },
    onBoost: () => {
      void racingAudio.resume();
      if (isStartOverlayVisible()) {
        beginRace();
      } else if (raceState.resultVisible) {
        if (isShowcase) restartShowcaseEvent();
        else void requestSessionIntent({ type: "replace-session", snapshot: activeSnapshot });
      } else if (!raceState.paused) {
        activateBoost();
      }
    },
    onToggleOpponent: () => {
      if (!isStartOverlayVisible() && !raceState.paused) toggleOpponent();
    },
    onToggleCamera: () => {
      if (!isStartOverlayVisible() && !raceState.paused) toggleCameraMode();
    },
    onReplaceSession: () => {
      if (!isStartOverlayVisible() && !raceState.paused) {
        if (isShowcase) restartShowcaseEvent();
        else void requestSessionIntent({ type: "replace-session", snapshot: activeSnapshot });
      }
    },
    onToggleDebug: () => setCollisionDebugEnabled(!collisionDebug.enabled),
    onGamepadDrive: (gamepadState) => {
      gamepadDrive = gamepadState;
    },
    onBlur: handleBlur,
    onHidden: handleVisibilityChange
  });

  const visualScale = racingSceneConfig.visualScale || 1;
  const collisionScale = racingSceneConfig.collisionScale || visualScale;
  const trackSurface = mapData.track.surface;
  const isFreeDrive = mapData.activity === RACING_ACTIVITIES.FREE_DRIVE;
  const trackWidth = isFreeDrive
    ? mapData.track.width
    : racingSceneConfig.trackWidthOverride ?? mapData.track.width;
  const isGravelSurface = trackSurface === TRACK_SURFACES.GRAVEL;
  const cameraConfig = {
    ...physicalDrivingConfig.camera
  };
  const fallbackHoodCameraConfig = {
    position: [0, 1.45, 2.05],
    lookAhead: 15,
    fov: 70
  };

  const trackConfig = {
    shape: mapData.track.shape,
    surface: trackSurface,
    width: trackWidth,
    samples: mapData.track.samples,
    startProgress: mapData.track.startPosition?.progress ?? 0,
    controlPoints: mapData.track.controlPoints.map((point) => [...point])
  };
  const trackSemantics = inspectRacingTrack(trackConfig);
  const trackRuntime = createRacingTrackRuntimeAdapter(trackConfig);
  const trackModel = trackRuntime.model;
  const trackSamples = trackModel.samples;
  const trackLength = trackModel.totalLength;
  const raceMode = isFreeDrive ? "free-drive" : trackSemantics.summary.raceMode;
  const raceModeLabel = isFreeDrive ? "自由驾驶" : raceMode === "lap" ? "闭环赛" : "点到点冲刺赛";

  const raceConfig = {
    mode: raceMode,
    totalLaps: 3,
    startProgress: trackConfig.startProgress,
    finishProgress: trackSemantics.summary.finishProgress,
    lapThreshold: 0.16,
    lapCooldownSeconds: 0.72,
    sprintGlideSeconds: 1.6,
    minForwardTrackSpeed: 2.2,
    lapArmProgressMin: 0.16,
    lapArmProgressMax: 0.84
  };

  const boostConfig = {
    charges: 5,
    unlimited: true,
    durationSeconds: 5,
    topSpeedMultiplier: 1.08,
    engineForceMultiplier: 2.15
  };
  const opponentBoostConfig = {
    charges: 3,
    activationTimesSeconds: [2, 10, 18]
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
  const environmentDensity = qualityPreset.environmentDensity;
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

  const opponentConfig = {
    speed: physicalDrivingConfig.maxForwardSpeed,
    laneOffset: -2.7,
    startProgress: raceMode === "lap" || isFreeDrive ? raceConfig.startProgress : 0
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
  const staticWorldColliderSpecs = [];
  const staticWorldMeshColliderSpecs = [];
  let roadCollisionMeshData = null;
  let surfaceValidationReport = Object.freeze({
    valid: true,
    surfaceCount: 0,
    triangleCount: 0,
    errors: Object.freeze([]),
    warnings: Object.freeze([])
  });
  const surfaceRibbonReports = [];

  const keyState = new Set();
  let gamepadDrive = Object.freeze({ connected: false, steering: 0, throttle: 0, brake: 0 });
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
    trackProgress: raceMode === "lap" || isFreeDrive ? raceConfig.startProgress : 0,
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
  };
  const freeDriveJumpState = {
    airborne: false,
    wasGrounded: true
  };
  const playerSurfaceState = {
    grounded: true,
    height: 0,
    pitch: 0,
    roll: 0,
    surfaceId: "road",
    contacts: []
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
    lapArmed: false,
    boostSeconds: 0,
    boostCharges: opponentBoostConfig.charges
  };
  const raceState = {
    finished: false,
    resultVisible: false,
    winner: "",
    playerPlace: 1,
    opponentEnabled: !isFreeDrive,
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
  const freeDriveTraffic = [];
  let drivingDust = null;
  let wheelSpinAngle = 0;
  let playerVisualElevation = 0;
  let freeDriveWater = null;
  let freeDriveRallyRoute = [];
  let freeDriveRallyCheckpoints = [];
  let freeDriveRallyChallenge = null;
  let freeDriveRallyGhost = null;
  let freeDriveShowcaseCheckpoints = [];
  let freeDriveShowcaseDrivingLine = [];
  let freeDriveShowcaseCheckpointDistances = [];
  let freeDriveShowcaseChallenge = null;
  let activeFreeDriveChallenge = null;
  let displayedFreeDriveChallenge = null;
  const showcaseEvent = {
    phase: isShowcase ? "idle" : "unavailable",
    countdownSeconds: 0,
    bannerSeconds: 0,
    finishHoldSeconds: 0,
    startX: 0,
    startZ: 0,
    startHeading: 0,
    playerDistance: 0,
    playerPlace: 1,
    finalPlace: null,
    elapsedSeconds: 0,
    upsideDownSeconds: 0,
    offRouteSeconds: 0,
    recoveryCooldownSeconds: 0,
    recoveryNoticeSeconds: 0,
    recoveryCount: 0,
    currentSection: "road",
    lastAnnouncedSection: null,
    announcedSections: new Set(),
    pendingSectionCue: null
  };
  let boostCameraKick = 0;
  const presentationState = {
    environment: "road",
    exposure: 1,
    baselineExposure: 1,
    jumpFovPulse: 0,
    jumpLiftPulse: 0,
    landingKick: 0,
    lastLandingImpactSpeed: 0,
    landingArmed: false,
    maximumAirborneDownwardSpeed: 0,
    suppressJumpTransitions: false
  };
  const startGateLights = [];
  let initialized = false;
  let active = false;
  let listening = false;
  let animationFrameId = 0;
  let lastFrameTime = 0;
  let physicsAccumulator = 0;
  let initializationPromise = null;
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
  const racingTelemetry = createRacingTelemetry();
  const provingGroundRunner = createProvingGroundTestRunner();
  const testScenarios = Object.freeze([
    Object.freeze({ id: "asphalt", label: "Asphalt handling" }),
    Object.freeze({ id: "rally", label: "Rally grip" }),
    Object.freeze({ id: "tunnel", label: "Tunnel rendering" }),
    Object.freeze({ id: "stunt-jump", label: "Stunt jump" })
  ]);
  const debugApi = {
    activateBoost,
    resetRace,
    toggleCamera: toggleCameraMode,
    finishRace: (winner = "player") => finishLapRace(winner === "opponent" ? "opponent" : "player"),
    placeCollisionScenario: (progress, laneOffset, progressGap) => placeCollisionScenario(progress, laneOffset, progressGap),
    placeStuntJumpScenario: (direction = 1) => placeStuntJumpScenario(direction),
    placeTunnelScenario: () => placeTunnelScenario(),
    placeRallyScenario: () => placeRallyScenario(),
    startRallyChallengeScenario: () => startRallyChallengeScenario(),
    completeRallyChallengeScenario: () => completeRallyChallengeScenario(),
    completeShowcaseEventScenario: () => completeShowcaseEventScenario(),
    advanceShowcaseCheckpointScenario: () => advanceShowcaseCheckpointScenario(),
    recoverShowcaseScenario: () => recoverShowcaseScenario(),
    rollShowcaseScenario: () => rollShowcaseScenario(),
    placeTrackScenario: (progress = 0) => placeTrackScenario(progress),
    placeWorldScenario: (x, z, heading = 0) => placeWorldScenario(x, z, heading),
    listTestScenarios: () => testScenarios,
    placeTestScenario,
    startBenchmark: (options = {}) => racingTelemetry.startBenchmark(options),
    cancelBenchmark: () => racingTelemetry.cancelBenchmark(),
    getTelemetry: () => racingTelemetry.snapshot(),
    listProvingGroundTests: () => PROVING_GROUND_TESTS,
    startProvingGroundTest,
    cancelProvingGroundTest: () => provingGroundRunner.cancel(),
    toggleOpponent,
    toggleCollisionDebug: () => setCollisionDebugEnabled(!collisionDebug.enabled),
    getState: () => ({
      quality: qualityPreset.id,
      render: renderer ? {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        points: renderer.info.render.points
      } : null,
      telemetry: racingTelemetry.snapshot(),
      provingGround: provingGroundRunner.snapshot(),
      lapText: formatLapDisplay(state.completedLaps),
      completedLaps: state.completedLaps,
      lapArmed: state.lapArmed,
      boostSeconds: Number(state.boostSeconds.toFixed(2)),
      boostCharges: state.boostCharges,
      playerBoostUnlimited: boostConfig.unlimited,
      airborne: freeDriveJumpState.airborne,
      surface: {
        grounded: playerSurfaceState.grounded,
        id: playerSurfaceState.surfaceId,
        height: Number(playerSurfaceState.height.toFixed(2)),
        contacts: playerSurfaceState.contacts.length,
        pitchDegrees: Number(THREE.MathUtils.radToDeg(playerSurfaceState.pitch).toFixed(1)),
        rollDegrees: Number(THREE.MathUtils.radToDeg(playerSurfaceState.roll).toFixed(1))
      },
      physicsHeight: physics?.playerBody
        ? Number(physics.playerBody.translation().y.toFixed(2))
        : null,
      worldColliders: {
        roadMesh: Boolean(roadCollisionMeshData),
        tunnelPieces: staticWorldColliderSpecs.filter((spec) => spec.tag === "tunnel-wall" || spec.tag === "tunnel-roof").length,
        rallyDirtMeshes: staticWorldMeshColliderSpecs.filter((spec) => spec.tag === FREE_DRIVE_RALLY.surfaceId).length,
        buildings: staticWorldColliderSpecs
          .filter((spec) => spec.tag === "building")
          .map((spec) => ({ x: spec.x, z: spec.z, width: spec.width, depth: spec.depth }))
      },
      surfaceValidation: {
        valid: surfaceValidationReport.valid,
        surfaceCount: surfaceValidationReport.surfaceCount,
        triangleCount: surfaceValidationReport.triangleCount,
        errorCount: surfaceValidationReport.errors.length,
        warningCount: surfaceValidationReport.warnings.length,
        errors: surfaceValidationReport.errors.slice(0, 6)
      },
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
      opponentSpeedKmh: Math.round(opponentState.currentSpeed * 3.6),
      opponentBoostSeconds: Number(opponentState.boostSeconds.toFixed(2)),
      opponentBoostCharges: opponentState.boostCharges,
      opponentLaneImpact: Number(opponentState.collisionLaneOffset.toFixed(2)),
      opponentYawImpact: Number(opponentState.collisionYawOffset.toFixed(2)),
      traffic: freeDriveTraffic.map((traffic) => ({
        progress: Number(traffic.progress.toFixed(3)),
        speedKmh: Math.round(traffic.currentSpeed * 3.6),
        direction: traffic.direction,
        airborne: traffic.airborne,
        boostSeconds: Number(traffic.boostSeconds.toFixed(2)),
        boostCharges: traffic.boostCharges,
        boostVisible: (traffic.visual.userData.boostFlames || []).some((flame) => flame.visible),
        collisionHoldSeconds: Number(traffic.collisionHoldSeconds.toFixed(2)),
        position: { x: Number(traffic.position.x.toFixed(1)), y: Number(traffic.position.y.toFixed(1)) },
        eventOpponent: Boolean(traffic.eventOpponent),
        name: traffic.name,
        labelVisible: Boolean(traffic.nameplate?.visible),
        eventDistance: Number((traffic.eventDistance ?? 0).toFixed(1)),
        finishTimeSeconds: traffic.finishTimeSeconds == null ? null : Number(traffic.finishTimeSeconds.toFixed(2))
      })),
      carDistance: Number(state.position.distanceTo(opponentState.position).toFixed(2)),
      playerCar: formatCarLabel(selectedCar()),
      opponentCar: formatCarLabel(opponentCarSelection()),
      cameraMode,
      vehiclePhysics: {
        mode: "physical",
        specId: playerVehicleSpec().id,
        mass: playerVehicleSpec().mass,
        driveLayout: playerVehicleSpec().driveLayout,
        topSpeedKmh: playerVehicleSpec().topSpeedKmh,
        wheelRadius: playerVehicleSpec().wheelRadius,
        finalDrive: playerVehicleSpec().finalDrive,
        gearRatios: [...playerVehicleSpec().gearRatios],
        upshiftRpm: playerVehicleSpec().upshiftRpm,
        wheelContacts: physics?.playerVehicle?.contactCount ?? 0,
        signedSpeed: Number((physics?.playerVehicle?.speed ?? 0).toFixed(2)),
        steeringDegrees: Number(THREE.MathUtils.radToDeg(
          physics?.playerVehicle?.steeringAngle ?? 0
        ).toFixed(1)),
        suspensionLengths: (physics?.playerVehicle?.suspensionLengths ?? [])
          .map((length) => Number(length.toFixed(2)))
      },
      drivetrain: physics?.playerVehicle?.drivetrain ? {
        gear: physics.playerVehicle.drivetrain.gear,
        engineRpm: Math.round(physics.playerVehicle.drivetrain.engineRpm),
        shiftSeconds: Number(physics.playerVehicle.drivetrain.shiftSeconds.toFixed(3)),
        shiftCount: physics.playerVehicle.drivetrain.shiftCount,
        torqueRatio: Number(physics.playerVehicle.drivetrain.torqueRatio.toFixed(3)),
        clutch: Number(physics.playerVehicle.drivetrain.clutch.toFixed(3))
      } : null,
      tireDynamics: physics?.playerVehicle?.tireDynamics ? {
        surfaceGrip: Number(physics.playerVehicle.tireDynamics.grip.toFixed(2)),
        maximumSlip: Number(physics.playerVehicle.tireDynamics.maximumSlip.toFixed(3)),
        squeal: Number(physics.playerVehicle.tireDynamics.squeal.toFixed(3)),
        absActive: physics.playerVehicle.tireDynamics.absActive,
        tractionControlActive: physics.playerVehicle.tireDynamics.tractionControlActive,
        wheels: physics.playerVehicle.tireDynamics.wheels.map((wheel) => ({
          driven: wheel.driven,
          normalLoad: Math.round(wheel.normalLoad),
          longitudinalSlip: Number(wheel.longitudinalSlip.toFixed(3)),
          lateralSlip: Number(wheel.lateralSlip.toFixed(3)),
          combinedSlip: Number(wheel.combinedSlip.toFixed(3)),
          tcsActive: wheel.tractionControlActive,
          engineScale: Number(wheel.engineScale.toFixed(3)),
          absActive: wheel.absActive,
          brakePressure: Number(wheel.brakeScale.toFixed(3))
        }))
      } : null,
      rallyChallenge: freeDriveRallyChallenge ? formatRallyChallengeDebugState() : null,
      showcaseChallenge: freeDriveShowcaseChallenge ? formatChallengeDebugState(freeDriveShowcaseChallenge) : null,
      showcaseEvent: isShowcase ? Object.freeze({
        phase: showcaseEvent.phase,
        countdownSeconds: Number(showcaseEvent.countdownSeconds.toFixed(2)),
        playerDistance: Number(showcaseEvent.playerDistance.toFixed(1)),
        playerPlace: showcaseEvent.playerPlace,
        recoveryCount: showcaseEvent.recoveryCount,
        currentSection: showcaseEvent.currentSection,
        lastAnnouncedSection: showcaseEvent.lastAnnouncedSection,
        announcedSections: [...showcaseEvent.announcedSections],
        opponents: freeDriveTraffic.map(({ eventDistance, finishTimeSeconds }) => ({
          distance: Number((eventDistance ?? 0).toFixed(1)),
          finishTimeSeconds: finishTimeSeconds == null ? null : Number(finishTimeSeconds.toFixed(2))
        }))
      }) : null,
      presentation: Object.freeze({
        environment: presentationState.environment,
        exposure: Number(presentationState.exposure.toFixed(3)),
        jumpFovPulse: Number(presentationState.jumpFovPulse.toFixed(3)),
        jumpLiftPulse: Number(presentationState.jumpLiftPulse.toFixed(3)),
        landingKick: Number(presentationState.landingKick.toFixed(3)),
        lastLandingImpactSpeed: Number(presentationState.lastLandingImpactSpeed.toFixed(2))
      }),
      wheelAnimation: {
        wheelCount: car?.userData.wheelCount ?? 0,
        shaderBindings: car?.userData.wheelShaderBindings?.length ?? 0,
        spinAngle: Number((car?.userData.wheelAnimationState?.spinAngle ?? 0).toFixed(3)),
        steeringDegrees: Number(THREE.MathUtils.radToDeg(
          car?.userData.wheelAnimationState?.steeringAngle ?? 0
        ).toFixed(1))
      },
      audio: racingAudio.getState(),
      haptics: racingHaptics.getState(),
      randomSeed: activeSnapshot?.randomSeed ?? null,
      visualScale,
      collisionScale,
      trackWidth: trackConfig.width,
      collider: {
        halfWidth: Number(playerVehicleSpec().chassisHalfWidth.toFixed(2)),
        halfHeight: Number(playerVehicleSpec().chassisHalfHeight.toFixed(2)),
        halfLength: Number(playerVehicleSpec().chassisHalfLength.toFixed(2))
      },
      collisionDebugEnabled: collisionDebug.enabled,
      lastCollision: collisionDebug.lastCollision,
      flameStates: (car?.userData.boostFlames || []).map((flame) => ({
        visible: flame.visible,
        opacity: Number((flame.material.opacity || 0).toFixed(2)),
        layer: flame.userData.boostLayer,
        color: `#${flame.material.color.getHexString()}`,
        exhaustPosition: flame.userData.exhaustPosition
      })),
      opponentFlameStates: (opponentCar?.userData.boostFlames || []).map((flame) => ({
        visible: flame.visible,
        opacity: Number((flame.material.opacity || 0).toFixed(2)),
        layer: flame.userData.boostLayer,
        color: `#${flame.material.color.getHexString()}`,
        exhaustPosition: flame.userData.exhaustPosition
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
    if (initialSnapshot) {
      void beginRace();
    }
  }

  function stop() {
    active = false;
    raceStarting = false;
    keyState.clear();
    setPaused(false);
    removeListeners();
    disposeCarOptionPreviews();
    startOverlay.hidden = true;
    pauseOverlay.hidden = true;
    resultOverlay.hidden = true;
    finishCinematic.stop();
    hudOverlay.hidden = true;
    updateCollisionDebugVisibility();

    if (animationFrameId) {
      clock.cancelFrame(animationFrameId);
      animationFrameId = 0;
    }

    invalidateRuntime();
    void session?.destroy();
    session = null;
    sessionControls = null;
    void racingAudio.suspend();
    racingHaptics.stop();
  }

  function destroy() {
    stop();
    racingAudio.destroy();
    startRaceButton.removeEventListener("click", handleStartRaceButtonClick);
    startEditorButton.removeEventListener("click", handleStartEditorButtonClick);
    startHomeButton.removeEventListener("click", handleStartHomeButtonClick);
    resumeButton.removeEventListener("click", handleResumeButtonClick);
    pauseResetButton.removeEventListener("click", handlePauseResetButtonClick);
    pauseEditorButton.removeEventListener("click", handlePauseEditorButtonClick);
    pauseHomeButton.removeEventListener("click", handlePauseHomeButtonClick);
    playAgainButton.removeEventListener("click", handleResetButtonClick);
    finishCinematic.destroy();
    removeCollisionDebugHud();
    if (globalThis.__ackGamesDebug?.racing === debugApi) {
      delete globalThis.__ackGamesDebug.racing;
    }
  }

  function selectedCar() {
    return getRacingCarById(selectedCarId);
  }

  function playerVehicleSpec() {
    return physics?.playerVehicle?.config ?? getPhysicalVehicleSpec(selectedCarId);
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
    startOpponentValue.textContent = isShowcase
      ? "3 位 Festival 对手"
      : isFreeDrive ? "无 · 自由探索" : rival.name;
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
          setStartStatus(`已选择 ${formatCarLabel(selectedCar())}。Xbox 360 手柄按 A 开赛。`);
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
      clock.cancelFrame(selectedCarPreviewFrameId);
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
    clock.requestFrame(() => {
      if (renderGeneration !== carPreviewRenderGeneration || !isStartOverlayVisible()) {
        return;
      }

      void renderSelectedCarPreview(carConfig, renderGeneration);
    });
  }

  function resetSelectedCarPreviewScene() {
    endSelectedCarPreviewDrag();
    if (selectedCarPreviewFrameId) {
      clock.cancelFrame(selectedCarPreviewFrameId);
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

    selectedCarPreviewFrameId = clock.requestFrame(tickSelectedCarPreview);
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
    selectedCarPreviewFrameId = clock.requestFrame(tickSelectedCarPreview);
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
    if (!imageElement.isConnected || imageElement.dataset.carId !== carConfig.id) return;
    if (new URLSearchParams(location.search).has("generate-car-thumbnails")) {
      imageElement.src = await ensureCarThumbnail(carConfig);
      return;
    }
    imageElement.loading = "lazy";
    imageElement.decoding = "async";
    imageElement.src = carConfig.thumbnailUrl;
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
    const lease = await loadCarTemplate({
      ...carConfig,
      id: `${carConfig.id}:preview`,
      modelUrl: carConfig.previewModelUrl ?? carConfig.modelUrl
    });
    try {
      return lease.value
        ? buildPreviewCarFromTemplate(lease.value)
        : createFallbackCar(carConfig, Number.parseInt(carConfig.accentColor.slice(1), 16));
    } finally {
      lease.release();
    }
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
    hideEventBanner();
    pauseOverlay.hidden = true;
    hudOverlay.hidden = true;
    startOverlay.hidden = false;
    startMapValue.textContent = mapData.name;
    startModeValue.textContent = isShowcase ? "Festival Showcase" : raceModeLabel;
    startOpponentValue.textContent = isShowcase ? "3 位 Festival 对手" : formatCarLabel(opponentCarSelection());
    startRaceButton.textContent = isShowcase
      ? "开始 Island Tour"
      : isFreeDrive ? "进入自由驾驶" : raceMode === "lap" ? "开始闭环赛" : "开始冲刺赛";
    startRaceButton.disabled = false;
    startEditorButton.disabled = false;
    startHomeButton.disabled = false;
    renderCarOptions();
    setStartStatus(`已选择 ${formatCarLabel(selectedCar())}。Xbox 360 手柄按 A 开赛。`);
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
      collisionDebug.hud.hidden = !active;
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
    setStartButtonsDisabled(true);
    setStartStatus(`正在加载 ${selectedCar().name} 与对手车辆...`);
    const savedStartConfig = saveActiveRacingStartConfig({ playerCarId: selectedCarId, cameraMode });
    activeSnapshot ??= createRacingSnapshot({ map: mapData, startConfig: savedStartConfig, environmentProfile });
    random = createSeededRandom(activeSnapshot.randomSeed);
    session = createRacingSession({
      snapshot: activeSnapshot,
      view: {
        render(model) {
          if (model.phase === "failed") {
            setStartStatus(model.message, true);
            setStartButtonsDisabled(false);
          }
        }
      },
      onIntent: handleSessionIntent,
      implementation: {
        async start(controls) {
          sessionControls = controls;
          await initializeScene();
          if (controls.signal.aborted || !active) return;
          hideStartOverlay();
          resetRace();
          resizeRenderer();
          lastFrameTime = clock.now();
          controls.transition("running");
          if (animationFrameId) clock.cancelFrame(animationFrameId);
          animationFrameId = clock.requestFrame(loop);
        },
        destroy: destroyRaceRuntime
      }
    });
    await session.start();
    raceStarting = false;
  }

  async function requestSessionIntent(intent) {
    if (sessionControls) {
      await sessionControls.requestIntent(intent);
      return;
    }
    handleSessionIntent(intent);
  }

  function handleSessionIntent(intent) {
    if (intent.type === "replace-session") {
      onReplaceSession(intent.snapshot ?? activeSnapshot);
    } else if (intent.type === "exit-to-editor") {
      onEditMap();
    } else if (intent.type === "exit-to-home") {
      onHome();
    }
  }

  function destroyRaceRuntime() {
    keyState.clear();
    setPaused(false);
    if (animationFrameId) {
      clock.cancelFrame(animationFrameId);
      animationFrameId = 0;
    }
    finishCinematic.stop();
    racingTelemetry.reset();
    provingGroundRunner.reset();
    invalidateRuntime();
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
      renderer.toneMappingExposure = (racingSceneConfig.toneMappingExposure ?? 1) * (isFreeDrive ? 0.98 : 1);
      presentationState.baselineExposure = renderer.toneMappingExposure;
      presentationState.exposure = renderer.toneMappingExposure;
      renderer.shadowMap.enabled = qualityPreset.shadows;
      renderer.shadowMap.type = THREE.PCFShadowMap;

      scene = new THREE.Scene();
      scene.background = new THREE.Color(racingSceneConfig.backgroundColor ?? 0x9fc9f3);
      scene.fog = isFreeDrive ? null : new THREE.Fog(
        racingSceneConfig.fogColor ?? racingSceneConfig.backgroundColor ?? 0x9fc9f3,
        138,
        285
      );

      camera = new THREE.PerspectiveCamera(cameraConfig.fov, 1, 0.1, isFreeDrive ? 900 : 500);

      await applySceneEnvironment();
      createLights();
      await createWorld();
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
      if (isFreeDrive && !isProvingGround) await initializeFreeDriveTraffic();
      if (initializationToken !== runtimeToken) {
        disposeRuntimeResources();
        return;
      }
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
    freeDriveTraffic.length = 0;
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

    const vehicleSpec = playerVehicleSpec();
    const playerHalfWidth = vehicleSpec.chassisHalfWidth;
    const playerHalfHeight = vehicleSpec.chassisHalfHeight;
    const playerHalfLength = vehicleSpec.chassisHalfLength;
    collisionDebug.playerWire = createCollisionWireBox(
      playerHalfWidth * 2,
      playerHalfHeight * 2,
      playerHalfLength * 2,
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
      wire.position.set(rail.midpoint.x, rail.elevation + physicsConfig.railHalfHeight, rail.midpoint.y);
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
      isFreeDrive ? 0xdceeff : 0xb9dcff,
      isFreeDrive ? 0x6f795c : 0x587044,
      isFreeDrive ? 1.25 : racingSceneConfig.hemisphereIntensity ?? 1.2
    );
    scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(isFreeDrive ? 0xfff4dc : 0xfff0d0, isFreeDrive ? 2.7 : racingSceneConfig.sunIntensity ?? 2.4);
    sun.position.set(isFreeDrive ? -165 : -72, isFreeDrive ? 190 : 58, isFreeDrive ? -115 : 46);
    sun.castShadow = true;
    sun.shadow.mapSize.width = qualityPreset.shadowMapSize;
    sun.shadow.mapSize.height = qualityPreset.shadowMapSize;
    sun.shadow.bias = racingSceneConfig.sunShadowBias ?? 0;
    sun.shadow.normalBias = racingSceneConfig.sunShadowNormalBias ?? 0;
    const shadowExtent = isFreeDrive ? 330 : 120;
    sun.shadow.camera.left = -shadowExtent;
    sun.shadow.camera.right = shadowExtent;
    sun.shadow.camera.top = shadowExtent;
    sun.shadow.camera.bottom = -shadowExtent;
    sun.shadow.camera.far = isFreeDrive ? 650 : 500;
    scene.add(sun);

    const horizonFill = new THREE.DirectionalLight(isFreeDrive ? 0xa9d5ff : 0x8bbbe2, isFreeDrive ? 0.42 : 0.28);
    horizonFill.position.set(68, 24, -52);
    scene.add(horizonFill);
  }

  async function applySceneEnvironment() {
    if (!renderer || !scene) {
      return;
    }

    if (isFreeDrive) {
      const texture = await new RGBELoader().loadAsync(
        new URL("./assets/freedrive/environment/qwantani-noon-puresky-1k.hdr", import.meta.url).href
      );
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = texture;
      scene.background = texture;
      scene.backgroundBlurriness = 0;
      scene.environmentIntensity = 0.92;
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

  async function createWorld() {
    staticWorldColliderSpecs.length = 0;
    staticWorldMeshColliderSpecs.length = 0;
    roadCollisionMeshData = null;
    surfaceRibbonReports.length = 0;
    freeDriveRallyRoute = [];
    freeDriveRallyCheckpoints = [];
    freeDriveRallyChallenge = null;
    freeDriveRallyGhost = null;
    freeDriveShowcaseCheckpoints = [];
    freeDriveShowcaseChallenge = null;
    activeFreeDriveChallenge = null;
    displayedFreeDriveChallenge = null;
    startGateLights.length = 0;
    if (!isFreeDrive || isProvingGround) addSkyDome();
    if (isIslandWorld) addFreeDriveGroundLayers();
    else addGroundLayers();
    if (!isFreeDrive || isProvingGround) addBackdrop();

    const road = createRoadMesh();
    road.receiveShadow = true;
    scene.add(road);

    addTrackVerges();
    if (!isFreeDrive) addInfieldSurface();
    if (!isFreeDrive) addStartFinishLines();
    if (isIslandWorld) addFreeDriveLaneMarks();
    else addLaneMarks();
    if (!isFreeDrive) addGuardRails();
    if (!isFreeDrive) addRoadsideProps();
    if (!isFreeDrive) addVenueCluster();
    if (!isFreeDrive) addFoliage();
    if (isIslandWorld) {
      addFreeDriveRallyRoad();
      addFreeDriveLandmarks();
      addFreeDriveBridge();
      addFreeDriveStuntRamps();
      addFreeDriveTunnel();
      addFreeDriveCity();
      await Promise.all([addRealFreeDriveVegetation(), addFreeDriveCoastalCliffs(), addRealFreeDriveCityProps()]);
    }
    if (isProvingGround) addProvingGroundFacilities();
    validateWorldDrivableSurfaces();
    drivingDust = createDrivingDust();
    scene.add(drivingDust.points);
  }

  function addProvingGroundFacilities() {
    const apron = new THREE.Mesh(
      new THREE.CircleGeometry(68, 128),
      new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.92, metalness: 0.02 })
    );
    apron.name = "proving-ground-skidpad-apron";
    apron.position.set(0, 0.035, 40);
    apron.rotation.x = -Math.PI * 0.5;
    apron.receiveShadow = true;
    scene.add(apron);

    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const accentMaterial = new THREE.MeshBasicMaterial({ color: 0xffc947, side: THREE.DoubleSide });
    for (const radius of [30, 60]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius - 0.22, radius + 0.22, 128),
        radius === 30 ? accentMaterial : lineMaterial
      );
      ring.name = `proving-ground-skidpad-${radius}`;
      ring.position.set(0, 0.075, 40);
      ring.rotation.x = -Math.PI * 0.5;
      scene.add(ring);
    }

    const markerGeometry = new THREE.BoxGeometry(0.18, 0.025, 18);
    for (let x = -450; x <= 500; x += 50) {
      const marker = new THREE.Mesh(markerGeometry, x === -450 ? accentMaterial : lineMaterial);
      marker.position.set(x, 0.09, -60);
      scene.add(marker);
    }

    const coneGeometry = new THREE.ConeGeometry(0.38, 1.2, 10);
    const coneMaterial = new THREE.MeshStandardMaterial({ color: 0xff6b2c, roughness: 0.72 });
    for (let index = 0; index < 10; index += 1) {
      const cone = new THREE.Mesh(coneGeometry, coneMaterial);
      cone.position.set(-120 + index * 18, 0.6, 15 + (index % 2 === 0 ? -4 : 4));
      cone.castShadow = qualityPreset.shadows;
      scene.add(cone);
    }
  }

  async function addRealFreeDriveVegetation() {
    try {
      const [tree, shrub] = await Promise.all([
        loadFreeDriveVegetationTemplate("island-tree-lod0.glb", 11),
        loadFreeDriveVegetationTemplate("shrub-03-lod0.glb", 1.5)
      ]);
      placeFreeDriveVegetation(tree, Math.max(10, Math.round(22 * environmentDensity)), {
        minOffset: 17, maxOffset: 62, minSpacing: 15, minScale: 0.62, maxScale: 1.28
      });
      placeFreeDriveVegetation(shrub, Math.max(28, Math.round(64 * environmentDensity)), {
        minOffset: 10, maxOffset: 36, minSpacing: 4.2, minScale: 0.72, maxScale: 1.4
      });
    } catch (error) {
      console.warn("Free Drive vegetation models failed to load.", error);
    }
  }

  async function loadFreeDriveVegetationTemplate(filename, targetHeight) {
    const url = new URL(`./assets/freedrive/models/${filename}`, import.meta.url).href;
    const gltf = await carModelLoader.loadAsync(url);
    const template = gltf.scene || gltf.scenes?.[0];
    if (!template) throw new Error(`${filename} has no scene.`);
    template.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(template);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = targetHeight / Math.max(size.y, 0.001);
    template.scale.setScalar(scale);
    template.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    template.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = qualityPreset.shadows;
      child.receiveShadow = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material.map) material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        material.side = THREE.DoubleSide;
        material.alphaTest = Math.max(material.alphaTest ?? 0, 0.28);
      });
    });
    return template;
  }

  async function loadFreeDrivePropTemplate(filename, targetHeight) {
    const url = new URL(`./assets/freedrive/models/${filename}`, import.meta.url).href;
    const gltf = await carModelLoader.loadAsync(url);
    const template = gltf.scene || gltf.scenes?.[0];
    if (!template) throw new Error(`${filename} has no scene.`);
    template.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(template);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = targetHeight / Math.max(size.y, 0.001);
    template.scale.setScalar(scale);
    template.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    template.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = qualityPreset.shadows;
      child.receiveShadow = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material.map) material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
      });
    });
    return template;
  }

  async function addRealFreeDriveCityProps() {
    try {
      const [streetLamp, seating, hydrant, trashCan, storefront, planter, cafeSet] = await Promise.all([
        loadFreeDrivePropTemplate("street_lamp_01-lod0.glb", 6.4),
        loadFreeDrivePropTemplate("modular_street_seating-lod0.glb", 1.05),
        loadFreeDrivePropTemplate("fire_hydrant-lod0.glb", 0.92),
        loadFreeDrivePropTemplate("metal_trash_can-lod0.glb", 1.08),
        loadFreeDrivePropTemplate("rollershutter_door-lod0.glb", 3.15),
        loadFreeDrivePropTemplate("planter_box_01-lod0.glb", 0.78),
        loadFreeDrivePropTemplate("outdoor_table_chair_set_01-lod0.glb", 1.2)
      ]);
      const citySamples = trackSamples.filter((sample) => sample.center.x > 246);
      citySamples.filter((_, index) => index % 20 === 0).forEach((sample) => {
        for (const side of [-1, 1]) {
          const position = sample.center.clone().add(sample.normal.clone().multiplyScalar((sample.halfWidth + 3.35) * side));
          const lamp = streetLamp.clone(true);
          lamp.position.set(position.x, 1.12, position.y);
          lamp.rotation.y = sample.heading + (side > 0 ? 0 : Math.PI);
          scene.add(lamp);
        }
      });
      citySamples.filter((_, index) => index % 58 === 12).forEach((sample, index) => {
        const side = index % 2 === 0 ? 1 : -1;
        const base = sample.center.clone().add(sample.normal.clone().multiplyScalar((sample.halfWidth + 5.5) * side));
        const bench = seating.clone(true);
        bench.position.set(base.x, 1.1, base.y);
        bench.rotation.y = sample.heading + (side > 0 ? Math.PI : 0);
        const smallProp = (index % 3 === 0 ? hydrant : trashCan).clone(true);
        const propPosition = base.clone().add(sample.tangent.clone().multiplyScalar(3.2));
        smallProp.position.set(propPosition.x, 1.1, propPosition.y);
        smallProp.rotation.y = randomBetween(0, Math.PI * 2);
        scene.add(bench, smallProp);
      });
      const cityCore = new THREE.Vector2(340, 34);
      citySamples.filter((_, index) => index % 72 === 24).forEach((sample, index) => {
        const inwardSide = Math.sign(cityCore.clone().sub(sample.center).dot(sample.normal)) || 1;
        const storefrontPosition = sample.center.clone().add(sample.normal.clone().multiplyScalar((sample.halfWidth + 13.5) * inwardSide));
        const door = storefront.clone(true);
        door.position.set(storefrontPosition.x, 1.1, storefrontPosition.y);
        door.rotation.y = sample.heading + (inwardSide > 0 ? Math.PI : 0);
        const planterPosition = sample.center.clone().add(sample.normal.clone().multiplyScalar((sample.halfWidth + 6.2) * inwardSide));
        const planterModel = planter.clone(true);
        planterModel.position.set(planterPosition.x, 1.1, planterPosition.y);
        planterModel.rotation.y = sample.heading;
        const socialProp = (index % 2 === 0 ? cafeSet : seating).clone(true);
        const socialPosition = planterPosition.clone().add(sample.tangent.clone().multiplyScalar(4.5));
        socialProp.position.set(socialPosition.x, 1.1, socialPosition.y);
        socialProp.rotation.y = sample.heading + (inwardSide > 0 ? Math.PI : 0);
        scene.add(door, planterModel, socialProp);
      });
    } catch (error) {
      console.warn("Free Drive city prop models failed to load.", error);
    }
  }

  function placeFreeDriveVegetation(template, count, options) {
    const placements = buildTracksidePlacements(count, {
      minOffset: options.minOffset,
      maxOffset: options.maxOffset,
      minSpacing: options.minSpacing,
      maxAttempts: Math.max(1800, count * 32)
    });
    placements.forEach((placement) => {
      if (placement.position.x > 118) return;
      if (nearestRallyRoadDistance(placement.position) < FREE_DRIVE_RALLY.halfWidth + 4) return;
      const model = template.clone(true);
      const groundElevation = freeDriveGroundElevationAt(placement.position, placement.progress);
      model.position.set(placement.position.x, groundElevation, placement.position.y);
      model.rotation.y = randomBetween(0, Math.PI * 2);
      model.scale.multiplyScalar(randomBetween(options.minScale, options.maxScale));
      scene.add(model);
    });
  }

  function addFreeDriveGroundLayers() {
    const textureLoader = new THREE.TextureLoader();
    const loadTiled = (path, colorSpace = null, repeatX = 42, repeatY = repeatX) => {
      const texture = textureLoader.load(new URL(path, import.meta.url).href);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeatX, repeatY);
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      if (colorSpace) texture.colorSpace = colorSpace;
      return texture;
    };

    const waterMaterial = new THREE.ShaderMaterial({
      fog: false,
      uniforms: {
        time: { value: 0 },
        shallowColor: { value: new THREE.Color(0x20b8bd) },
        deepColor: { value: new THREE.Color(0x07527f) },
        skyColor: { value: new THREE.Color(0x9bc9e3) }
      },
      vertexShader: `
        uniform float time;
        varying vec3 vWorldPosition;
        varying float vWave;
        void main() {
          vec3 displaced = position;
          float waveA = sin(position.x * 0.055 + time * 0.72);
          float waveB = sin(position.y * 0.083 - time * 0.54);
          float waveC = sin((position.x + position.y) * 0.031 + time * 0.34);
          vWave = waveA * 0.45 + waveB * 0.35 + waveC * 0.2;
          displaced.z += vWave * 0.22;
          vec4 world = modelMatrix * vec4(displaced, 1.0);
          vWorldPosition = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 shallowColor;
        uniform vec3 deepColor;
        uniform vec3 skyColor;
        varying vec3 vWorldPosition;
        varying float vWave;
        void main() {
          vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
          float fresnel = pow(1.0 - max(dot(viewDirection, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
          float detail = sin(vWorldPosition.x * 0.18 + time) * sin(vWorldPosition.z * 0.16 - time * 0.8);
          vec3 water = mix(deepColor, shallowColor, 0.38 + vWave * 0.12 + detail * 0.035);
          water = mix(water, skyColor, fresnel * 0.52);
          float glint = pow(max(0.0, vWave * 0.5 + detail * 0.5), 10.0) * 0.28;
          gl_FragColor = vec4(water + glint, 1.0);
        }
      `
    });
    const ocean = new THREE.Mesh(new THREE.CircleGeometry(groundRadius + 220, 128), waterMaterial);
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(sceneCenter.x, -1.5, sceneCenter.y);
    freeDriveWater = ocean;
    scene.add(ocean);

    const islandRadius = 188;
    const islandCenter = new THREE.Vector2(0, 0);
    const islandGeometry = new THREE.CircleGeometry(islandRadius, 96, 24);
    const positions = islandGeometry.getAttribute("position");
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const radius = Math.hypot(x, y);
      const edge = smoothstep(islandRadius - 42, islandRadius, radius);
      positions.setZ(index, -0.18 - edge * 2.4);
    }
    positions.needsUpdate = true;
    islandGeometry.computeVertexNormals();
    const createGrassMaterial = (repeatX, repeatY) => new THREE.MeshStandardMaterial({
      map: loadTiled("./assets/freedrive/textures/sparse_grass_diff_1k.jpg", THREE.SRGBColorSpace, repeatX, repeatY),
      normalMap: loadTiled("./assets/freedrive/textures/sparse_grass_nor_gl_1k.jpg", null, repeatX, repeatY),
      roughnessMap: loadTiled("./assets/freedrive/textures/sparse_grass_rough_1k.jpg", null, repeatX, repeatY),
      color: 0x9aad87,
      roughness: 0.94,
      side: THREE.DoubleSide
    });
    const island = new THREE.Mesh(
      islandGeometry,
      createGrassMaterial(34, 34)
    );
    island.rotation.x = -Math.PI / 2;
    island.position.set(islandCenter.x, 0, islandCenter.y);
    island.receiveShadow = true;
    registerStaticWorldMesh(island, "ground");
    scene.add(island);
    const createSandMaterial = (tint) => new THREE.MeshStandardMaterial({
      map: loadTiled("./assets/freedrive/textures/coast_sand_01_diff_1k.jpg", THREE.SRGBColorSpace, 16, 16),
      normalMap: loadTiled("./assets/freedrive/textures/coast_sand_01_nor_gl_1k.jpg", null, 16, 16),
      roughnessMap: loadTiled("./assets/freedrive/textures/coast_sand_01_rough_1k.jpg", null, 16, 16),
      color: tint,
      roughness: 0.9,
      side: THREE.DoubleSide
    });
    const coastStart = islandRadius - 42;
    const coastMeshes = [
      createFreeDriveCoastRing(coastStart, islandRadius - 12, -0.2, -0.78, createSandMaterial(0xc7ad82), islandCenter),
      createFreeDriveCoastRing(islandRadius - 13, islandRadius + 3, -0.76, -1.38, createSandMaterial(0x766b5d), islandCenter)
    ];
    coastMeshes.forEach((mesh) => registerStaticWorldMesh(mesh, "ground"));
    scene.add(...coastMeshes);
    const cityGround = new THREE.Mesh(
      new THREE.BoxGeometry(250, 0.7, 250),
      createFreeDrivePbrMaterial("brushed_concrete", { color: 0x737b7c, repeatX: 28, repeatY: 28, roughness: 0.92 })
    );
    cityGround.position.set(340, -0.42, 14);
    cityGround.receiveShadow = true;
    scene.add(cityGround);
    registerStaticWorldBox({
      x: cityGround.position.x,
      y: cityGround.position.y,
      z: cityGround.position.z,
      width: 250,
      height: 0.7,
      depth: 250,
      tag: "ground"
    });
    scene.add(
      createFreeDriveEmbankmentMesh(1, createGrassMaterial(3, 1), (sample) => sample.center.x <= 116),
      createFreeDriveEmbankmentMesh(-1, createGrassMaterial(3, 1), (sample) => sample.center.x <= 116),
      createFreeDriveEmbankmentMesh(1, createFreeDrivePbrMaterial("brick_pavement", { color: 0x999d98, repeatX: 4, repeatY: 2 }), (sample) => sample.center.x > 238),
      createFreeDriveEmbankmentMesh(-1, createFreeDrivePbrMaterial("brick_pavement", { color: 0x999d98, repeatX: 4, repeatY: 2 }), (sample) => sample.center.x > 238)
    );
  }

  function createFreeDriveCoastRing(innerRadius, outerRadius, innerY, outerY, material, center = sceneCenter) {
    const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 128, 8);
    const positions = geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index += 1) {
      const radius = Math.hypot(positions.getX(index), positions.getY(index));
      const blend = smoothstep(innerRadius, outerRadius, radius);
      positions.setZ(index, THREE.MathUtils.lerp(innerY, outerY, blend));
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(center.x, 0, center.y);
    ring.receiveShadow = true;
    return ring;
  }

  function createFreeDriveEmbankmentMesh(side, material, segmentFilter = null) {
    const positions = [];
    const uvs = [];
    const indices = [];
    trackSamples.forEach((sample, index) => {
      const progress = sampleProgressForIndex(index, trackSamples.length);
      const elevation = freeDriveElevationAtProgress(progress);
      const inner = sample.center.clone().add(sample.normal.clone().multiplyScalar((sample.halfWidth + 1.4) * side));
      const outer = sample.center.clone().add(sample.normal.clone().multiplyScalar((sample.halfWidth + 18) * side));
      const outerHeight = sample.center.x > 238 ? -0.05 : sample.center.x > 116 ? -1.22 : -0.16;
      positions.push(inner.x, elevation - 0.02, inner.y, outer.x, outerHeight, outer.y);
      uvs.push(0, sample.distance / 12, 1, sample.distance / 12);
    });
    for (let index = 0; index < trackModel.segmentCount; index += 1) {
      const next = trackModel.closed ? (index + 1) % trackSamples.length : index + 1;
      if (segmentFilter && (!segmentFilter(trackSamples[index]) || !segmentFilter(trackSamples[next]))) continue;
      const inner = index * 2;
      const outer = inner + 1;
      const nextInner = next * 2;
      const nextOuter = nextInner + 1;
      indices.push(inner, nextInner, outer, outer, nextInner, nextOuter);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    registerStaticWorldMesh(mesh, "embankment", { partitionSteep: true });
    return mesh;
  }

  function updateFreeDriveWater(deltaSeconds) {
    if (!freeDriveWater?.material?.uniforms?.time) return;
    freeDriveWater.material.uniforms.time.value += deltaSeconds;
  }

  function addFreeDriveLandmarks() {
    const center = new THREE.Vector2(0, 0);
    const tower = new THREE.Group();
    const plasterMaterial = createFreeDrivePbrMaterial("painted_plaster_wall", { color: 0xf1e7d4, repeatX: 3, repeatY: 5 });
    const roofMaterial = createFreeDrivePbrMaterial("roof_09", { color: 0xb94838, repeatX: 3, repeatY: 2 });
    const woodMaterial = createFreeDrivePbrMaterial("wood_planks_grey", { color: 0x8d6d54, repeatX: 2, repeatY: 3 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 6.2, 13, 24), plasterMaterial);
    base.position.y = 6.5;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 2.2, 24), roofMaterial);
    cap.position.y = 13.8;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.25, 18, 12), new THREE.MeshPhysicalMaterial({ color: 0xfff1b5, emissive: 0xffb43b, emissiveIntensity: 2.2, transmission: 0.38, roughness: 0.12 }));
    beacon.position.y = 16;
    const balcony = new THREE.Mesh(new THREE.TorusGeometry(4.9, 0.14, 8, 32), new THREE.MeshStandardMaterial({ color: 0x4d5558, roughness: 0.42, metalness: 0.55 }));
    balcony.rotation.x = Math.PI / 2;
    balcony.position.y = 14.8;
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.7, 3.1, 0.25), woodMaterial);
    door.position.set(0, 1.6, 5.22);
    tower.add(base, cap, beacon, balcony, door);
    tower.position.set(center.x - 18, 0, center.y + 5);
    tower.traverse((child) => { if (child.isMesh) child.castShadow = qualityPreset.shadows; });
    scene.add(tower);
    addFreeDriveResort();
  }

  async function addFreeDriveCoastalCliffs() {
    try {
      const url = new URL("./assets/freedrive/models/coastal-cliff-lod0.glb", import.meta.url).href;
      const gltf = await carModelLoader.loadAsync(url);
      const template = gltf.scene || gltf.scenes?.[0];
      if (!template) return;
      template.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(template);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const scale = 38 / Math.max(size.x, size.z, 0.001);
      template.scale.setScalar(scale);
      template.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
      template.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = qualityPreset.shadows;
        child.receiveShadow = true;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          if (material.map) material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        });
      });
      const placements = [0.12, 0.29, 0.48, 0.7, 0.88];
      placements.forEach((progress, index) => {
        const sample = trackProfileAtProgress(progress);
        const side = index % 2 === 0 ? 1 : -1;
        const offset = sample.halfWidth + randomBetween(42, 66);
        const position = sample.center.clone().add(sample.normal.clone().multiplyScalar(offset * side));
        if (position.x > 112) return;
        const cliff = template.clone(true);
        cliff.position.set(position.x, Math.max(-0.5, freeDriveGroundElevationAt(position, progress) - 0.4), position.y);
        cliff.rotation.y = sample.heading + (side > 0 ? Math.PI * 0.5 : -Math.PI * 0.5) + randomBetween(-0.22, 0.22);
        cliff.scale.multiplyScalar(randomBetween(0.72, 1.18));
        scene.add(cliff);
      });
    } catch (error) {
      console.warn("Free Drive coastal cliff model failed to load.", error);
    }
  }

  function addFreeDriveResort() {
    const sample = trackSamples.reduce((best, candidate) => {
      const target = new THREE.Vector2(50, 92);
      return candidate.center.distanceToSquared(target) < best.center.distanceToSquared(target) ? candidate : best;
    }, trackSamples[0]);
    const anchor = sample.center.clone().add(sample.normal.clone().multiplyScalar(31));
    const group = new THREE.Group();
    group.position.set(anchor.x, 0, anchor.y);
    group.rotation.y = sample.heading + Math.PI * 0.5;
    const colors = [0xe7c39b, 0xd99a85, 0x8fb7b3];
    const glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0x8ab8ca, roughness: 0.12, metalness: 0.05, transmission: 0.28 });
    const deckMaterial = createFreeDrivePbrMaterial("wood_planks_grey", { color: 0xa88a6c, repeatX: 4, repeatY: 2 });
    for (let index = 0; index < 3; index += 1) {
      const height = 4 + index * 0.8;
      const localX = (index - 1) * 9;
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(8, height, 6),
        createFreeDrivePbrMaterial("painted_plaster_wall", { color: colors[index], repeatX: 3, repeatY: 2 })
      );
      building.position.set(localX, height * 0.5, 0);
      building.castShadow = qualityPreset.shadows;
      building.receiveShadow = true;
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(8.9, 0.42, 6.9),
        createFreeDrivePbrMaterial("roof_09", { color: index === 1 ? 0xb95c42 : 0x9b5d47, repeatX: 3, repeatY: 2 })
      );
      roof.position.set((index - 1) * 9, height + 0.2, 0);
      roof.castShadow = qualityPreset.shadows;
      const windowBand = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.15, 0.16), glassMaterial);
      windowBand.position.set((index - 1) * 9, height * 0.58, 3.04);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.22, 2.1), deckMaterial);
      deck.position.set((index - 1) * 9, 0.14, 4.0);
      deck.receiveShadow = true;
      group.add(building, roof, windowBand, deck);
      registerStaticWorldBox({
        x: anchor.x + Math.cos(group.rotation.y) * localX,
        y: height * 0.5,
        z: anchor.y - Math.sin(group.rotation.y) * localX,
        width: 8,
        height,
        depth: 6,
        yaw: group.rotation.y,
        tag: "building"
      });
    }
    scene.add(group);
  }

  function addFreeDriveBridge() {
    const concrete = createFreeDrivePbrMaterial("brushed_concrete", { color: 0xb8bec0, repeatX: 3, repeatY: 2, roughness: 0.82 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x344b58, roughness: 0.36, metalness: 0.72 });
    const bridgeSamples = trackSamples.filter((sample) => sample.center.x > 116 && sample.center.x < 240);

    for (let index = 0; index < bridgeSamples.length - 1; index += 3) {
      const start = bridgeSamples[index];
      const end = bridgeSamples[Math.min(index + 3, bridgeSamples.length - 1)];
      if (Math.sign(start.center.y) !== Math.sign(end.center.y) || start.center.distanceTo(end.center) > 18) continue;
      if (isFreeDriveJumpGapSegment(start.center, end.center)) continue;
      for (const side of [-1, 1]) {
        const a = start.center.clone().add(start.normal.clone().multiplyScalar((start.halfWidth + 0.42) * side));
        const b = end.center.clone().add(end.normal.clone().multiplyScalar((end.halfWidth + 0.42) * side));
        const segment = b.clone().sub(a);
        const barrier = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.92, segment.length()), concrete);
        barrier.position.set((a.x + b.x) * 0.5, freeDriveElevationAtPosition(start.center, start.progress) + 0.46, (a.y + b.y) * 0.5);
        barrier.rotation.y = Math.atan2(segment.x, segment.y);
        barrier.castShadow = qualityPreset.shadows;
        barrier.receiveShadow = true;
        scene.add(barrier);
      }
    }

    const towerCandidates = [];
    for (const targetX of [154, 204]) {
      for (const corridorSide of [-1, 1]) {
        const corridor = bridgeSamples.filter((sample) => Math.sign(sample.center.y || corridorSide) === corridorSide);
        const target = corridor.reduce((best, sample) => Math.abs(sample.center.x - targetX) < Math.abs(best.center.x - targetX) ? sample : best, corridor[0]);
        if (target) towerCandidates.push(target);
      }
    }
    towerCandidates.forEach((sample) => {
      const deckY = freeDriveElevationAtPosition(sample.center, sample.progress);
      for (const side of [-1, 1]) {
        const point = sample.center.clone().add(sample.normal.clone().multiplyScalar((sample.halfWidth + 1.15) * side));
        const pierHeight = deckY + 2.2;
        const pier = new THREE.Mesh(new THREE.BoxGeometry(2.1, pierHeight, 2.6), concrete);
        pier.position.set(point.x, pierHeight * 0.5 - 1.35, point.y);
        pier.rotation.y = sample.heading;
        const mast = new THREE.Mesh(new THREE.BoxGeometry(1.2, 15, 1.4), steel);
        mast.position.set(point.x, deckY + 7.4, point.y);
        mast.rotation.y = sample.heading;
        pier.castShadow = mast.castShadow = qualityPreset.shadows;
        scene.add(pier, mast);
      }
      const crossbeam = new THREE.Mesh(new THREE.BoxGeometry(sample.halfWidth * 2 + 4, 0.75, 0.9), steel);
      crossbeam.position.set(sample.center.x, deckY + 14.2, sample.center.y);
      crossbeam.rotation.y = sample.heading + Math.PI * 0.5;
      crossbeam.castShadow = qualityPreset.shadows;
      scene.add(crossbeam);
    });

    const warningMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: 0.54, metalness: 0.08 });
    for (const corridorSide of [-1, 1]) {
      const corridorSamples = bridgeSamples.filter(
        (sample) => Math.sign(sample.center.y || corridorSide) === corridorSide
      );
      for (const edgeX of [FREE_DRIVE_JUMP.gapMinX, FREE_DRIVE_JUMP.gapMaxX]) {
        const edgeSample = corridorSamples.reduce(
          (best, sample) => Math.abs(sample.center.x - edgeX) < Math.abs(best.center.x - edgeX) ? sample : best,
          corridorSamples[0]
        );
        if (!edgeSample) continue;
        const deckY = freeDriveElevationAtPosition(edgeSample.center, edgeSample.progress);
        const endFace = new THREE.Mesh(
          new THREE.BoxGeometry(edgeSample.halfWidth * 2, 1.5, 0.72),
          concrete
        );
        endFace.position.set(edgeSample.center.x, deckY - 0.72, edgeSample.center.y);
        endFace.rotation.y = edgeSample.heading;
        endFace.castShadow = endFace.receiveShadow = qualityPreset.shadows;
        const warningBar = new THREE.Mesh(
          new THREE.BoxGeometry(edgeSample.halfWidth * 1.7, 0.12, 0.9),
          warningMaterial
        );
        warningBar.position.set(edgeSample.center.x, deckY + 0.1, edgeSample.center.y);
        warningBar.rotation.y = edgeSample.heading;
        warningBar.receiveShadow = true;
        scene.add(endFace, warningBar);
      }
    }

  }

  function addFreeDriveStuntRamps() {
    const rampLength = FREE_DRIVE_STUNT_JUMP.leftTakeoffX - FREE_DRIVE_STUNT_JUMP.leftRampStartX;
    const slopeLength = Math.hypot(rampLength, FREE_DRIVE_STUNT_JUMP.rampRise);
    const slopeAngle = Math.atan2(FREE_DRIVE_STUNT_JUMP.rampRise, rampLength);
    const baseY = -1.2;
    const rampMaterial = new THREE.MeshStandardMaterial({ color: 0xd94b32, roughness: 0.48, metalness: 0.28 });
    const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0x252a30, roughness: 0.4, metalness: 0.5 });
    const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x5d8f43, roughness: 0.98, metalness: 0 });
    const arrowMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd84d,
      emissive: 0x8a4b00,
      emissiveIntensity: 0.7,
      roughness: 0.42
    });

    const minimumFlightDistance = FREE_DRIVE_STUNT_JUMP.rightRampEndX
      + FREE_DRIVE_STUNT_JUMP.landingOvershoot
      - FREE_DRIVE_STUNT_JUMP.leftTakeoffX;
    const landingExtension = FREE_DRIVE_STUNT_JUMP.landingOvershoot
      + minimumFlightDistance * (FREE_DRIVE_STUNT_JUMP.airtimeMultiplier - 1);
    const grassPadLength = rampLength + landingExtension + 4;
    const grassPadCenters = [
      (FREE_DRIVE_STUNT_JUMP.leftRampStartX - landingExtension + FREE_DRIVE_STUNT_JUMP.leftTakeoffX) * 0.5,
      (FREE_DRIVE_STUNT_JUMP.rightTakeoffX + FREE_DRIVE_STUNT_JUMP.rightRampEndX + landingExtension) * 0.5
    ];
    for (const centerX of grassPadCenters) {
      const grassPad = new THREE.Mesh(
        new THREE.BoxGeometry(grassPadLength, 0.18, FREE_DRIVE_STUNT_JUMP.halfWidth * 2 + 5),
        grassMaterial
      );
      grassPad.position.set(centerX, baseY - 0.08, FREE_DRIVE_STUNT_JUMP.centerY);
      grassPad.receiveShadow = true;
      scene.add(grassPad);
      registerStaticWorldBox({
        x: centerX,
        y: baseY - 0.08,
        z: FREE_DRIVE_STUNT_JUMP.centerY,
        width: grassPadLength,
        height: 0.18,
        depth: FREE_DRIVE_STUNT_JUMP.halfWidth * 2 + 5,
        tag: "ground"
      });
    }

    const rampColliderSpecs = createFreeDriveStuntRampColliderSpecs({ baseY });
    for (const direction of [1, -1]) {
      const startX = direction > 0 ? FREE_DRIVE_STUNT_JUMP.leftRampStartX : FREE_DRIVE_STUNT_JUMP.rightRampEndX;
      const takeoffX = direction > 0 ? FREE_DRIVE_STUNT_JUMP.leftTakeoffX : FREE_DRIVE_STUNT_JUMP.rightTakeoffX;
      const centerX = (startX + takeoffX) * 0.5;
      const ramp = new THREE.Mesh(
        new THREE.BoxGeometry(slopeLength, 0.55, FREE_DRIVE_STUNT_JUMP.halfWidth * 2),
        rampMaterial
      );
      ramp.position.set(centerX, baseY + FREE_DRIVE_STUNT_JUMP.rampRise * 0.5, FREE_DRIVE_STUNT_JUMP.centerY);
      ramp.rotation.z = direction * slopeAngle;
      ramp.castShadow = ramp.receiveShadow = qualityPreset.shadows;
      scene.add(ramp);
      registerStaticWorldBox(rampColliderSpecs[direction > 0 ? 0 : 1]);

      for (const side of [-1, 1]) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(slopeLength, 0.24, 0.28), edgeMaterial);
        edge.position.set(centerX, baseY + FREE_DRIVE_STUNT_JUMP.rampRise * 0.5 + 0.3, FREE_DRIVE_STUNT_JUMP.centerY + side * FREE_DRIVE_STUNT_JUMP.halfWidth);
        edge.rotation.z = direction * slopeAngle;
        edge.castShadow = true;
        scene.add(edge);
      }

      for (const progress of [0.28, 0.52, 0.76]) {
        const arrow = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 2.8), arrowMaterial);
        const x = startX + (takeoffX - startX) * progress;
        arrow.position.set(
          x,
          baseY + FREE_DRIVE_STUNT_JUMP.rampRise * progress + 0.32,
          FREE_DRIVE_STUNT_JUMP.centerY
        );
        arrow.rotation.z = direction * slopeAngle;
        arrow.receiveShadow = true;
        scene.add(arrow);
      }
    }
  }

  function addFreeDriveTunnel() {
    const segments = createFreeDriveTunnelSegments({
      sampleTrack: trackProfileAtProgress,
      elevationAt: freeDriveElevationAtProgress
    });
    if (!segments.length) return;

    const tunnel = new THREE.Group();
    tunnel.name = "free-drive-tunnel";
    const concrete = createFreeDrivePbrMaterial("brushed_concrete", {
      color: 0x525a5c,
      repeatX: 3,
      repeatY: 4,
      roughness: 0.88
    });
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: 0x343b3e,
      roughness: 0.82,
      metalness: 0.12
    });
    const lightMaterial = new THREE.MeshStandardMaterial({
      color: 0xffe0a3,
      emissive: 0xffa742,
      emissiveIntensity: 2.6,
      roughness: 0.28
    });
    const portalMaterial = new THREE.MeshStandardMaterial({
      color: 0x252b2e,
      roughness: 0.64,
      metalness: 0.28
    });

    for (const segment of segments) {
      for (const wallSpec of segment.walls) {
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(wallSpec.width, wallSpec.height, wallSpec.depth),
          concrete
        );
        wall.position.set(wallSpec.x, wallSpec.y, wallSpec.z);
        wall.rotation.y = wallSpec.yaw;
        wall.castShadow = wall.receiveShadow = qualityPreset.shadows;
        tunnel.add(wall);
        registerStaticWorldBox(wallSpec);
      }

      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(segment.roof.width, segment.roof.height, segment.roof.depth),
        roofMaterial
      );
      roof.position.set(segment.roof.x, segment.roof.y, segment.roof.z);
      roof.rotation.y = segment.roof.yaw;
      roof.castShadow = roof.receiveShadow = qualityPreset.shadows;
      tunnel.add(roof);
      registerStaticWorldBox(segment.roof);

      if (segment.index % 2 === 0) {
        const normalX = Math.cos(segment.yaw);
        const normalZ = -Math.sin(segment.yaw);
        for (const side of [-1, 1]) {
          const strip = new THREE.Mesh(
            new THREE.BoxGeometry(0.16, 0.14, segment.length * 0.72),
            lightMaterial
          );
          strip.position.set(
            segment.x + normalX * (segment.innerHalfWidth - 0.12) * side,
            segment.roadHeight + segment.wallHeight - 0.65,
            segment.z + normalZ * (segment.innerHalfWidth - 0.12) * side
          );
          strip.rotation.y = segment.yaw;
          tunnel.add(strip);
        }
      }
    }

    for (const segment of [segments[0], segments.at(-1)]) {
      const portal = new THREE.Mesh(
        new THREE.BoxGeometry(segment.roofWidth + 1.8, 0.8, 0.72),
        portalMaterial
      );
      portal.position.set(segment.x, segment.roadHeight + segment.wallHeight - 0.15, segment.z);
      portal.rotation.y = segment.yaw;
      portal.castShadow = true;
      tunnel.add(portal);
    }
    scene.add(tunnel);
  }

  function addFreeDriveRallyRoad() {
    freeDriveRallyRoute = createFreeDriveRallyRoute({
      sampleTrack: trackProfileAtProgress,
      elevationAt: (x, z) => {
        const position = new THREE.Vector2(x, z);
        const projection = closestTrackSample(position);
        return freeDriveGroundElevationAt(position, projection.progress);
      }
    });
    if (!freeDriveRallyRoute.length) return;

    const loader = new THREE.TextureLoader();
    const loadDirtTexture = (name, colorSpace = null) => {
      const texture = loader.load(new URL(`./assets/freedrive/textures/${name}`, import.meta.url).href);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      if (colorSpace) texture.colorSpace = colorSpace;
      return texture;
    };
    const dirtMaterial = new THREE.MeshStandardMaterial({
      color: 0x9b704b,
      map: loadDirtTexture("coast_sand_01_diff_1k.jpg", THREE.SRGBColorSpace),
      normalMap: loadDirtTexture("coast_sand_01_nor_gl_1k.jpg"),
      roughnessMap: loadDirtTexture("coast_sand_01_rough_1k.jpg"),
      normalScale: new THREE.Vector2(1.25, 1.25),
      roughness: 0.98,
      metalness: 0,
      side: THREE.DoubleSide
    });
    const road = createRallyRibbonMesh(createFreeDriveRallyRibbon(freeDriveRallyRoute), dirtMaterial);
    road.name = "free-drive-rally-dirt-road";
    road.receiveShadow = true;
    registerStaticWorldMesh(road, FREE_DRIVE_RALLY.surfaceId);
    surfaceRibbonReports.push(validateDrivableRibbon({
      id: "rally-dirt-ribbon",
      vertices: road.geometry.getAttribute("position").array
    }));
    scene.add(road);

    const rutMaterial = new THREE.MeshStandardMaterial({
      color: 0x3f281c,
      roughness: 1,
      transparent: true,
      opacity: 0.58,
      depthWrite: false
    });
    const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0x65442d, roughness: 1 });
    for (const side of [-1, 1]) {
      const rut = createRallyRibbonMesh(createFreeDriveRallyRibbon(freeDriveRallyRoute, {
        halfWidth: 0.18,
        centerOffset: side * 1.48,
        heightOffset: 0.025
      }), rutMaterial);
      const edge = createRallyRibbonMesh(createFreeDriveRallyRibbon(freeDriveRallyRoute, {
        halfWidth: 0.24,
        centerOffset: side * (FREE_DRIVE_RALLY.halfWidth - 0.18),
        heightOffset: 0.018
      }), edgeMaterial);
      scene.add(rut, edge);
    }

    const markerMaterials = [
      new THREE.MeshStandardMaterial({ color: 0xf0eee5, roughness: 0.76 }),
      new THREE.MeshStandardMaterial({ color: 0xc94732, roughness: 0.7 })
    ];
    for (let index = 8; index < freeDriveRallyRoute.length - 5; index += 11) {
      const sample = freeDriveRallyRoute[index];
      for (const side of [-1, 1]) {
        const marker = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.15, 1.15, 8),
          markerMaterials[(index + (side > 0 ? 1 : 0)) % markerMaterials.length]
        );
        marker.position.set(
          sample.x + sample.normalX * side * (FREE_DRIVE_RALLY.halfWidth + 0.65),
          sample.y + 0.56,
          sample.z + sample.normalZ * side * (FREE_DRIVE_RALLY.halfWidth + 0.65)
        );
        marker.castShadow = qualityPreset.shadows;
        scene.add(marker);
      }
    }

    addFreeDriveRallyChallenge();
  }

  function addFreeDriveRallyChallenge() {
    const lastIndex = freeDriveRallyRoute.length - 1;
    const checkpointIndexes = [0, 0.25, 0.5, 0.75, 1]
      .map((ratio) => Math.round(lastIndex * ratio));
    freeDriveRallyCheckpoints = checkpointIndexes.map((index) => {
      const sample = freeDriveRallyRoute[index];
      return Object.freeze({
        x: sample.x,
        y: sample.y,
        z: sample.z,
        heading: Math.atan2(sample.tangentX, sample.tangentZ),
        normalX: sample.normalX,
        normalZ: sample.normalZ
      });
    });
    freeDriveRallyChallenge = createFreeDriveTimeTrial({
      checkpoints: freeDriveRallyCheckpoints,
      gateRadius: FREE_DRIVE_RALLY.halfWidth + 1.8,
      storageKey: `ack-games:racing:rally-ghost:v1:${selectedCarId}`
    });

    if (isShowcase) {
      freeDriveShowcaseDrivingLine = createFreeDriveShowcaseDrivingLine({
        sampleTrack: trackProfileAtProgress,
        elevationAt: (progress) => freeDriveElevationAtProgress(progress) + 0.06,
        rallyRoute: freeDriveRallyRoute
      });
      freeDriveShowcaseCheckpoints = createFreeDriveShowcaseRoute({
        sampleTrack: trackProfileAtProgress,
        elevationAt: (progress) => freeDriveElevationAtProgress(progress) + 0.06,
        rallyRoute: freeDriveRallyRoute
      });
      let minimumLineIndex = 0;
      freeDriveShowcaseCheckpointDistances = freeDriveShowcaseCheckpoints.map((checkpoint) => {
        let nearestIndex = minimumLineIndex;
        let nearestDistance = Infinity;
        for (let index = minimumLineIndex; index < freeDriveShowcaseDrivingLine.length; index += 1) {
          const sample = freeDriveShowcaseDrivingLine[index];
          const distance = Math.hypot(sample.x - checkpoint.x, sample.z - checkpoint.z);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
          }
        }
        minimumLineIndex = nearestIndex;
        return freeDriveShowcaseDrivingLine[nearestIndex]?.distance ?? 0;
      });
      freeDriveShowcaseChallenge = createFreeDriveTimeTrial({
        checkpoints: freeDriveShowcaseCheckpoints,
        gateRadius: FREE_DRIVE_SHOWCASE.gateRadius,
        storageKey: `ack-games:racing:coastal-showcase:v1:${selectedCarId}`,
        autoStart: false
      });
    }

    const gateColors = [0x5cff9d, 0x58d8ff, 0xffd45a, 0xff9a54, 0xff5d73];
    freeDriveRallyCheckpoints.forEach((checkpoint, index) => {
      const gate = createRallyCheckpointGate(checkpoint, gateColors[index], index);
      scene.add(gate);
    });
    freeDriveShowcaseCheckpoints.slice(1).forEach((checkpoint, offset) => {
      const index = offset + 1;
      const color = checkpoint.section === "rally" ? 0xffb24c : checkpoint.section === "tunnel" ? 0x68e7ff : 0xb8ff68;
      const gate = createRallyCheckpointGate(checkpoint, color, `showcase-${index}`);
      gate.scale.setScalar(1.12);
      scene.add(gate);
    });

    freeDriveRallyGhost = createRallyGhostCar();
    scene.add(freeDriveRallyGhost);
  }

  function createRallyCheckpointGate(checkpoint, color, index) {
    const gate = new THREE.Group();
    gate.name = `rally-checkpoint-${index}`;
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.85,
      roughness: 0.34,
      metalness: 0.18
    });
    const gateHalfWidth = FREE_DRIVE_RALLY.halfWidth + 0.72;
    const height = 3.4;
    const postGeometry = new THREE.CylinderGeometry(0.12, 0.16, height, 10);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeometry, material);
      post.position.set(
        checkpoint.x + checkpoint.normalX * side * gateHalfWidth,
        checkpoint.y + height * 0.5,
        checkpoint.z + checkpoint.normalZ * side * gateHalfWidth
      );
      post.castShadow = qualityPreset.shadows;
      gate.add(post);
    }
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(gateHalfWidth * 2 + 0.3, 0.25, 0.24),
      material
    );
    beam.position.set(checkpoint.x, checkpoint.y + height, checkpoint.z);
    beam.rotation.y = checkpoint.heading;
    beam.castShadow = qualityPreset.shadows;
    gate.add(beam);

    const beacon = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.62, 20),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.84 })
    );
    beacon.position.set(checkpoint.x, checkpoint.y + height + 0.72, checkpoint.z);
    beacon.rotation.y = checkpoint.heading;
    gate.add(beacon);
    return gate;
  }

  function createRallyGhostCar() {
    const ghost = new THREE.Group();
    ghost.name = "rally-best-ghost";
    ghost.visible = false;
    const vehicleSpec = playerVehicleSpec();
    const material = new THREE.MeshStandardMaterial({
      color: 0x62e8ff,
      emissive: 0x2fb8e5,
      emissiveIntensity: 0.78,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      roughness: 0.24,
      metalness: 0.3
    });
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(
        vehicleSpec.chassisHalfWidth * 1.72,
        vehicleSpec.chassisHalfHeight * 0.92,
        vehicleSpec.chassisHalfLength * 1.78
      ),
      material
    );
    body.position.y = vehicleSpec.chassisHalfHeight * 0.8;
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(
        vehicleSpec.chassisHalfWidth * 1.18,
        vehicleSpec.chassisHalfHeight * 0.78,
        vehicleSpec.chassisHalfLength * 0.84
      ),
      material
    );
    cabin.position.set(0, vehicleSpec.chassisHalfHeight * 1.45, -vehicleSpec.chassisHalfLength * 0.12);
    ghost.add(body, cabin);
    ghost.renderOrder = 3;
    return ghost;
  }

  function createRallyRibbonMesh(ribbon, material) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(ribbon.positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(ribbon.uvs, 2));
    geometry.setIndex(ribbon.indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
  }

  function nearestRallyRoadDistance(position) {
    if (!freeDriveRallyRoute.length) return Infinity;
    let nearest = Infinity;
    for (const sample of freeDriveRallyRoute) {
      nearest = Math.min(nearest, Math.hypot(position.x - sample.x, position.y - sample.z));
    }
    return nearest;
  }

  function nearestRallyRouteSample(x, z) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const sample of freeDriveRallyRoute) {
      const distance = Math.hypot(x - sample.x, z - sample.z);
      if (distance < nearestDistance) {
        nearest = sample;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  function addFreeDriveCity() {
    const city = new THREE.Group();
    const concrete = createFreeDrivePbrMaterial("brushed_concrete", { color: 0xaeb4b3, repeatX: 4, repeatY: 6, roughness: 0.86 });
    const brick = createFreeDrivePbrMaterial("brick_wall_001", { color: 0xb98268, repeatX: 5, repeatY: 8, roughness: 0.9 });
    const pavement = createFreeDrivePbrMaterial("brick_pavement", { color: 0x9ca09a, repeatX: 8, repeatY: 4, roughness: 0.92 });
    const darkGlass = new THREE.MeshPhysicalMaterial({ color: 0x41677a, metalness: 0.18, roughness: 0.2, transmission: 0.12, envMapIntensity: 1.3 });
    const warmGlass = new THREE.MeshStandardMaterial({ color: 0x92aeb4, emissive: 0x8a7148, emissiveIntensity: 0.16, roughness: 0.25, metalness: 0.18 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x303b40, roughness: 0.58, metalness: 0.34 });
    const layouts = [
      [286,4,18,24,15,"brick"],[313,2,20,38,17,"glass"],[344,0,22,52,19,"glass"],[376,3,20,30,17,"brick"],
      [400,8,17,42,16,"concrete"],[290,34,20,32,17,"concrete"],[320,34,22,46,18,"brick"],
      [352,35,24,62,20,"glass"],[386,36,21,38,18,"brick"],[306,64,19,28,16,"brick"],
      [337,68,22,42,18,"concrete"],[370,68,25,54,20,"glass"],[399,64,18,30,16,"brick"]
    ];
    layouts.forEach(([x, z, width, height, depth, type], index) => {
      const position = new THREE.Vector2(x, z);
      if (nearestRoadDistance(position) < 30) return;
      const wall = type === "brick" ? brick : type === "glass" ? darkGlass : concrete;
      const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wall);
      building.position.set(x, height * 0.5, z);
      building.castShadow = qualityPreset.shadows;
      building.receiveShadow = true;
      const crown = new THREE.Mesh(new THREE.BoxGeometry(width + 0.8, 0.65, depth + 0.8), roof);
      crown.position.set(x, height + 0.3, z);
      crown.castShadow = qualityPreset.shadows;
      city.add(building, crown);
      registerStaticWorldBox({
        x,
        y: height * 0.5,
        z,
        width,
        height,
        depth,
        tag: "building"
      });
      if (type !== "glass") {
        const rows = Math.max(2, Math.floor(height / 5));
        for (let row = 0; row < rows; row += 1) {
          const windows = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, 1.5, 0.16), warmGlass);
          windows.position.set(x, 3.2 + row * 4.3, z + depth * 0.5 + 0.09);
          city.add(windows);
        }
      } else {
        for (let floor = 1; floor < Math.floor(height / 4); floor += 1) {
          const floorBand = new THREE.Mesh(new THREE.BoxGeometry(width + 0.2, 0.2, depth + 0.2), roof);
          floorBand.position.set(x, floor * 4, z);
          city.add(floorBand);
        }
      }
      if (index % 3 === 0) {
        const podium = new THREE.Mesh(new THREE.BoxGeometry(width + 5, 1.1, depth + 5), pavement);
        podium.position.set(x, 0.35, z);
        podium.receiveShadow = true;
        city.add(podium);
      }
    });

    scene.add(city);
  }

  function registerStaticWorldBox({ x, y, z, width, height, depth, yaw = 0, pitch = 0, roll = 0, tag = "world" }) {
    staticWorldColliderSpecs.push(Object.freeze({ x, y, z, width, height, depth, yaw, pitch, roll, tag }));
  }

  function registerStaticWorldMesh(mesh, tag = "world", { partitionSteep = false } = {}) {
    const geometry = mesh?.geometry;
    const position = geometry?.getAttribute("position");
    if (!position?.count) return;

    mesh.updateMatrixWorld(true);
    const vertices = new Float32Array(position.count * 3);
    const point = new THREE.Vector3();
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
      vertices[index * 3] = point.x;
      vertices[index * 3 + 1] = point.y;
      vertices[index * 3 + 2] = point.z;
    }
    const indices = geometry.index
      ? new Uint32Array(geometry.index.array)
      : Uint32Array.from({ length: position.count }, (_, index) => index);
    if (partitionSteep) {
      const partition = partitionSurfaceTrianglesBySlope(vertices, indices);
      if (partition.drivableIndices.length) {
        staticWorldMeshColliderSpecs.push(Object.freeze({ vertices, indices: partition.drivableIndices, tag }));
      }
      if (partition.barrierIndices.length) {
        staticWorldMeshColliderSpecs.push(Object.freeze({
          vertices,
          indices: partition.barrierIndices,
          tag: "surface-barrier"
        }));
      }
      return;
    }
    staticWorldMeshColliderSpecs.push(Object.freeze({ vertices, indices, tag }));
  }

  function validateWorldDrivableSurfaces() {
    const surfaces = [];
    if (roadCollisionMeshData?.vertices?.length && roadCollisionMeshData.indices?.length) {
      surfaces.push({
        id: "road:0",
        tag: "road",
        vertices: roadCollisionMeshData.vertices,
        indices: roadCollisionMeshData.indices
      });
    }
    for (let index = 0; index < staticWorldMeshColliderSpecs.length; index += 1) {
      const spec = staticWorldMeshColliderSpecs[index];
      if (!isPhysicalVehicleSurface(spec.tag)) continue;
      surfaces.push({ id: `${spec.tag}:${index}`, ...spec });
    }
    const meshReport = validateDrivableSurfaceSet(surfaces);
    const ribbonErrors = surfaceRibbonReports.flatMap((report) => report.errors);
    surfaceValidationReport = Object.freeze({
      ...meshReport,
      valid: meshReport.valid && ribbonErrors.length === 0,
      errors: Object.freeze([...meshReport.errors, ...ribbonErrors])
    });
    if (!surfaceValidationReport.valid) {
      const summary = surfaceValidationReport.errors
        .slice(0, 4)
        .map((entry) => `${entry.surfaceId}: ${entry.message}`)
        .join("；");
      throw new Error(`可驾驶表面校验失败：${summary}`);
    }
  }

  function smoothstep(edge0, edge1, value) {
    const x = clamp((value - edge0) / Math.max(edge1 - edge0, 0.0001), 0, 1);
    return x * x * (3 - 2 * x);
  }

  function createDrivingDust() {
    const count = qualityPreset.particleCount;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const smokeTexture = createSoftSmokeTexture();
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: isGravelSurface ? 1.5 : 1.35,
        map: smokeTexture,
        vertexColors: true,
        transparent: true,
        opacity: 0.76,
        alphaTest: 0.015,
        depthWrite: false,
        sizeAttenuation: true,
        fog: true
      })
    );
    points.frustumCulled = false;
    return {
      points,
      particles: Array.from({ length: count }, (_, index) => ({
        index,
        life: 0,
        maxLife: 1,
        velocity: new THREE.Vector3()
      })),
      cursor: 0,
      emissionCarry: 0
    };
  }

  function createSoftSmokeTexture() {
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (x + 0.5) / size * 2 - 1;
        const dy = (y + 0.5) / size * 2 - 1;
        const distance = Math.hypot(dx, dy);
        const softness = clamp(1 - distance, 0, 1);
        const alpha = Math.round(255 * softness * softness * (3 - 2 * softness));
        const offset = (y * size + x) * 4;
        data[offset] = 255;
        data[offset + 1] = 255;
        data[offset + 2] = 255;
        data[offset + 3] = alpha;
      }
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
  }

  function updateDrivingDust(deltaSeconds) {
    if (!drivingDust || deltaSeconds <= 0) return;

    const speed = state.velocity.length();
    const tireSlip = physics?.playerVehicle?.tireDynamics?.maximumSlip ?? 0;
    const dustySurface = isGravelSurface || !state.onRoad || tireSlip > 0.22;
    const emissionRate = dustySurface
      ? clamp((speed - 2) * 2.1 + tireSlip * 24, 0, 58)
      : 0;
    drivingDust.emissionCarry += emissionRate * deltaSeconds;
    while (drivingDust.emissionCarry >= 1) {
      emitDrivingDustParticle(dustySurface);
      drivingDust.emissionCarry -= 1;
    }

    const positionAttribute = drivingDust.points.geometry.getAttribute("position");
    const colorAttribute = drivingDust.points.geometry.getAttribute("color");
    const baseColor = new THREE.Color(dustySurface ? 0xb59a70 : 0x9ba1a5);
    for (const particle of drivingDust.particles) {
      if (particle.life <= 0) continue;
      particle.life = Math.max(0, particle.life - deltaSeconds);
      const offset = particle.index * 3;
      if (particle.life <= 0) {
        setAttributeTriple(positionAttribute, offset, 0, -20, 0);
        setAttributeTriple(colorAttribute, offset, 0, 0, 0);
        continue;
      }
      positionAttribute.array[offset] += particle.velocity.x * deltaSeconds;
      positionAttribute.array[offset + 1] += particle.velocity.y * deltaSeconds;
      positionAttribute.array[offset + 2] += particle.velocity.z * deltaSeconds;
      particle.velocity.y += deltaSeconds * 0.34;
      particle.velocity.multiplyScalar(Math.max(0, 1 - deltaSeconds * 0.8));
      const alpha = particle.life / particle.maxLife;
      setAttributeTriple(colorAttribute, offset, baseColor.r * alpha, baseColor.g * alpha, baseColor.b * alpha);
    }
    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
  }

  function emitDrivingDustParticle(dustySurface) {
    const particle = drivingDust.particles[drivingDust.cursor];
    drivingDust.cursor = (drivingDust.cursor + 1) % drivingDust.particles.length;
    const forward = new THREE.Vector2(Math.sin(state.heading), Math.cos(state.heading));
    const right = new THREE.Vector2(Math.cos(state.heading), -Math.sin(state.heading));
    const rear = new THREE.Vector2(state.position.x, state.position.y)
      .addScaledVector(forward, -2.1)
      .addScaledVector(right, (random() < 0.5 ? -1 : 1) * 0.82);
    const positionAttribute = drivingDust.points.geometry.getAttribute("position");
    setAttributeTriple(
      positionAttribute,
      particle.index * 3,
      rear.x + randomBetween(-0.18, 0.18),
      playerVisualElevation + randomBetween(0.18, 0.42),
      rear.y + randomBetween(-0.18, 0.18)
    );
    particle.maxLife = randomBetween(dustySurface ? 0.7 : 0.65, dustySurface ? 1.35 : 1.15);
    particle.life = particle.maxLife;
    particle.velocity.set(
      -forward.x * randomBetween(1.2, 3.4) + right.x * randomBetween(-0.8, 0.8),
      randomBetween(0.35, 1.15),
      -forward.y * randomBetween(1.2, 3.4) + right.y * randomBetween(-0.8, 0.8)
    );
  }

  function setAttributeTriple(attribute, offset, x, y, z) {
    attribute.array[offset] = x;
    attribute.array[offset + 1] = y;
    attribute.array[offset + 2] = z;
  }

  function addSkyDome() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(groundRadius + 155, 32, 18),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          topColor: { value: new THREE.Color(0x4f86b9) },
          horizonColor: { value: new THREE.Color(0xb9d2df) },
          groundColor: { value: new THREE.Color(0x8899a1) },
          sunColor: { value: new THREE.Color(0xffe2a8) },
          sunDirection: { value: new THREE.Vector3(-0.7, 0.48, 0.42).normalize() }
        },
        vertexShader: `
          varying vec3 vWorldDirection;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldDirection = normalize(worldPosition.xyz - cameraPosition);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vWorldDirection;
          uniform vec3 topColor;
          uniform vec3 horizonColor;
          uniform vec3 groundColor;
          uniform vec3 sunColor;
          uniform vec3 sunDirection;
          void main() {
            float height = vWorldDirection.y;
            float skyMix = smoothstep(-0.04, 0.72, height);
            vec3 color = mix(groundColor, mix(horizonColor, topColor, skyMix), smoothstep(-0.16, 0.04, height));
            float horizonHaze = exp(-abs(height) * 12.0) * 0.16;
            color += horizonColor * horizonHaze;
            float sunDot = max(dot(vWorldDirection, sunDirection), 0.0);
            color += sunColor * pow(sunDot, 420.0) * 2.4;
            color += sunColor * pow(sunDot, 18.0) * 0.16;
            gl_FragColor = vec4(color, 1.0);
          }
        `
      })
    );
    sky.name = "festival-sky";
    sky.position.set(sceneCenter.x, -22, sceneCenter.y);
    sky.renderOrder = -1000;
    scene.add(sky);
  }

  function addGroundLayers() {
    const nearField = createTerrainPlane({
      width: nearFieldWidth,
      depth: nearFieldDepth,
      segmentsX: groundConfig.nearFieldSegments ?? 28,
      segmentsZ: groundConfig.nearFieldSegments ?? 28,
      y: -0.18,
      undulation: isProvingGround ? 0 : groundConfig.nearUndulation ?? 0.55,
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
      undulation: isProvingGround ? 0 : groundConfig.farUndulation ?? 1.1,
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
    if (isIslandWorld) {
      const zones = [
        { test: (sample) => sample.center.x <= 116, prefix: "sparse_grass", color: 0xffffff, roughness: 0.94 },
        { test: (sample) => sample.center.x > 116 && sample.center.x <= 238, prefix: "brushed_concrete", color: 0xb5bbba, roughness: 0.86 },
        { test: (sample) => sample.center.x > 238, prefix: "brick_pavement", color: 0xa5a7a1, roughness: 0.92 }
      ];
      for (const zone of zones) {
        for (const side of [1, -1]) {
          const verge = createTrackBandMesh({
            side,
            innerOffset: -0.04,
            outerOffset: zone.prefix === "brick_pavement" ? 4.2 : 1.78,
            height: zone.prefix === "brick_pavement" ? 0.11 : 0.072,
            color: zone.color,
            texture: loadFreeDriveTiledTexture(`${zone.prefix}_diff_1k.jpg`, THREE.SRGBColorSpace, 2, 1),
            segmentFilter: zone.test
          });
          verge.material.normalMap = loadFreeDriveTiledTexture(`${zone.prefix}_nor_gl_1k.jpg`, null, 2, 1);
          verge.material.roughnessMap = loadFreeDriveTiledTexture(`${zone.prefix}_rough_1k.jpg`, null, 2, 1);
          verge.material.roughness = zone.roughness;
          verge.material.needsUpdate = true;
          verge.receiveShadow = true;
          registerStaticWorldMesh(verge, "verge");
          scene.add(verge);
        }
      }
      return;
    }
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

  function loadFreeDriveTiledTexture(filename, colorSpace = null, repeatX = 1, repeatY = repeatX) {
    const texture = new THREE.TextureLoader().load(
      new URL(`./assets/freedrive/textures/${filename}`, import.meta.url).href
    );
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (colorSpace) texture.colorSpace = colorSpace;
    return texture;
  }

  function createFreeDrivePbrMaterial(prefix, {
    color = 0xffffff,
    repeatX = 2,
    repeatY = repeatX,
    roughness = 0.86,
    metalness = 0
  } = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      map: loadFreeDriveTiledTexture(`${prefix}_diff_1k.jpg`, THREE.SRGBColorSpace, repeatX, repeatY),
      normalMap: loadFreeDriveTiledTexture(`${prefix}_nor_gl_1k.jpg`, null, repeatX, repeatY),
      roughnessMap: loadFreeDriveTiledTexture(`${prefix}_rough_1k.jpg`, null, repeatX, repeatY),
      roughness,
      metalness
    });
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
      playerVehicle: null,
      opponentBody: null,
      opponentCollider: null
    };

    const fallbackGroundHeight = physicalFallbackGroundHeight(isIslandWorld);
    const groundCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(Math.max(180, farFieldWidth * 0.55), 0.3, Math.max(150, farFieldDepth * 0.55))
        .setTranslation(sceneCenter.x, fallbackGroundHeight - 0.3, sceneCenter.y)
        .setFriction(1.2)
    );
    physics.colliderTags.set(groundCollider.handle, isProvingGround ? "road" : "ground");

    if (roadCollisionMeshData?.vertices.length && roadCollisionMeshData.indices.length) {
      const roadCollider = world.createCollider(
        RAPIER.ColliderDesc.trimesh(
          roadCollisionMeshData.vertices,
          roadCollisionMeshData.indices,
          RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES
        ).setFriction(1.15)
      );
      physics.colliderTags.set(roadCollider.handle, "road");
    }

    for (const spec of staticWorldMeshColliderSpecs) {
      if (!spec.vertices.length || !spec.indices.length) continue;
      const collider = world.createCollider(
        RAPIER.ColliderDesc.trimesh(spec.vertices, spec.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
          .setFriction(spec.tag === FREE_DRIVE_RALLY.surfaceId ? 0.74 : 1.05)
      );
      physics.colliderTags.set(collider.handle, spec.tag);
    }

    for (const spec of staticWorldColliderSpecs) {
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(spec.width * 0.5, spec.height * 0.5, spec.depth * 0.5)
          .setTranslation(spec.x, spec.y, spec.z)
          .setRotation(rapierRotationFromEuler(spec.pitch, spec.yaw, spec.roll))
          .setFriction(0.72)
          .setRestitution(0.02)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      );
      physics.colliderTags.set(collider.handle, spec.tag);
    }

    if (!isFreeDrive) {
      createRailColliders(1);
      createRailColliders(-1);
    } else if (isIslandWorld) {
      createRailColliders(1, (sample) => sample.center.x > 116 && sample.center.x < 240);
      createRailColliders(-1, (sample) => sample.center.x > 116 && sample.center.x < 240);
    }

    const playerBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, physicsConfig.fixedHeight, 0)
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(0.08)
      .setAngularDamping(1.2)
      .setAdditionalSolverIterations(4);
    physics.playerBody = world.createRigidBody(playerBodyDesc);
    const vehicleSpec = getPhysicalVehicleSpec(selectedCarId);
    const playerColliderDesc = RAPIER.ColliderDesc.roundCuboid(
      vehicleSpec.chassisHalfWidth,
      vehicleSpec.chassisHalfHeight,
      vehicleSpec.chassisHalfLength,
      vehicleSpec.chassisRoundRadius
    )
      .setMass(vehicleSpec.mass)
      .setFriction(0.42)
      .setRestitution(0.03);
    physics.playerCollider = world.createCollider(
      playerColliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      physics.playerBody
    );
    physics.colliderTags.set(physics.playerCollider.handle, "player");
    physics.playerVehicle = createPhysicalVehicle({
      world,
      chassis: physics.playerBody,
      config: vehicleSpec
    });

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

  function createRailColliders(side, sampleFilter = null) {
    if (!physics) {
      return;
    }

    const segmentCount = trackModel.closed ? railConfig.sampleCount : railConfig.sampleCount - 1;
    for (let index = 0; index < segmentCount; index += 1) {
      const startSample = trackProfileAtProgress(sampleProgressForIndex(index, railConfig.sampleCount));
      const endSample = trackProfileAtProgress(sampleProgressForIndex(index + 1, railConfig.sampleCount));
      if (sampleFilter && (!sampleFilter(startSample) || !sampleFilter(endSample))) continue;
      if (isFreeDrive && isFreeDriveJumpGapSegment(startSample.center, endSample.center)) continue;
      const start = startSample.center.clone().add(startSample.normal.clone().multiplyScalar(startSample.railOffset * side));
      const end = endSample.center.clone().add(endSample.normal.clone().multiplyScalar(endSample.railOffset * side));
      const segment = end.clone().sub(start);
      const length = segment.length();

      if (length <= 0.01) {
        continue;
      }

      const midpoint = start.clone().add(end).multiplyScalar(0.5);
      const yaw = Math.atan2(segment.x, segment.y);
      const startHeight = 0.06 + freeDriveElevationAtPosition(startSample.center, startSample.progress);
      const endHeight = 0.06 + freeDriveElevationAtPosition(endSample.center, endSample.progress);
      const elevation = (startHeight + endHeight) * 0.5;
      const railCollider = physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(length * 0.5, physicsConfig.railHalfHeight, physicsConfig.railHalfDepth)
          .setTranslation(midpoint.x, elevation + physicsConfig.railHalfHeight, midpoint.y)
          .setRotation(rapierRotationFromYaw(yaw))
          .setFriction(0.12)
          .setRestitution(0.04)
      );
      physics.colliderTags.set(railCollider.handle, "rail");
      physics.debugRailColliders.push({
        handle: railCollider.handle,
        midpoint: midpoint.clone(),
        elevation,
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
    const rotation = physics.playerBody.rotation();
    tempQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(tempQuaternion);
    if (forward.x * forward.x + forward.z * forward.z > 0.0001) {
      state.heading = Math.atan2(forward.x, forward.z);
    }
    syncPlayerTrackMetrics(preferredIndex);
  }

  function syncPhysicalVehicleState() {
    const vehicle = physics?.playerVehicle;
    if (!vehicle || !physics?.playerBody) return;

    const contacts = [];
    const surfaceCounts = new Map();
    for (let index = 0; index < vehicle.controller.numWheels(); index += 1) {
      if (!vehicle.controller.wheelIsInContact(index)) continue;
      const point = vehicle.controller.wheelContactPoint(index);
      const collider = vehicle.controller.wheelGroundObject(index);
      const surfaceId = physics.colliderTags.get(collider?.handle) ?? "surface";
      if (point) contacts.push({ x: point.x, z: point.z, height: point.y, surfaceId });
      surfaceCounts.set(surfaceId, (surfaceCounts.get(surfaceId) ?? 0) + 1);
    }

    const rotation = physics.playerBody.rotation();
    tempQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    const euler = new THREE.Euler().setFromQuaternion(tempQuaternion, "YXZ");
    const velocity = physics.playerBody.linvel();
    const downwardSpeed = Math.max(0, -(velocity?.y ?? 0));
    playerSurfaceState.grounded = contacts.length >= 2;
    playerSurfaceState.height = contacts.length
      ? contacts.reduce((sum, contact) => sum + contact.height, 0) / contacts.length
      : physics.playerBody.translation().y - playerVehicleSpec().visualGroundOffset;
    playerSurfaceState.pitch = euler.x;
    playerSurfaceState.roll = euler.z;
    playerSurfaceState.surfaceId = [...surfaceCounts.entries()]
      .sort((left, right) => right[1] - left[1])[0]?.[0] ?? "air";
    playerSurfaceState.contacts = contacts;
    freeDriveJumpState.airborne = contacts.length === 0;
    if (isShowcase && showcaseEvent.phase === "running" && !presentationState.suppressJumpTransitions) {
      const planarSpeed = Math.hypot(velocity?.x ?? 0, velocity?.z ?? 0);
      if (!presentationState.landingArmed && contacts.length === 0 && freeDriveJumpState.wasGrounded
        && planarSpeed > 8 && (velocity?.y ?? 0) > 0.35) {
        presentationState.landingArmed = true;
        presentationState.maximumAirborneDownwardSpeed = 0;
        presentationState.jumpFovPulse = Math.max(presentationState.jumpFovPulse, 1);
        presentationState.jumpLiftPulse = Math.max(presentationState.jumpLiftPulse, 1);
      }
      if (presentationState.landingArmed) {
        presentationState.maximumAirborneDownwardSpeed = Math.max(
          presentationState.maximumAirborneDownwardSpeed,
          downwardSpeed
        );
      }
      if (presentationState.landingArmed && contacts.length >= 2) {
        const impactSpeed = presentationState.maximumAirborneDownwardSpeed;
        const impact = clamp((impactSpeed - 1.5) / 9, 0, 1);
        presentationState.lastLandingImpactSpeed = impactSpeed;
        presentationState.landingKick = Math.max(presentationState.landingKick, impact);
        if (impact > 0) racingHaptics.pulseImpact(0.18 + impact * 0.7);
        presentationState.landingArmed = false;
        presentationState.maximumAirborneDownwardSpeed = 0;
      }
    }
    freeDriveJumpState.wasGrounded = playerSurfaceState.grounded;
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

    const support = resolveSurfaceSupport(position, heading);
    if (support.grounded) applyPlayerSurfaceState(support);
    physics.playerBody.setTranslation({
      x: position.x,
      y: (support.height ?? 0) + playerVehicleSpec().spawnHeight,
      z: position.y
    }, true);
    physics.playerBody.setRotation(rapierRotationFromYaw(heading), true);
    physics.playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    physics.playerBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    resetPhysicalVehicleControls(physics.playerVehicle);
    freeDriveJumpState.airborne = false;
  }

  function setOpponentBodyPose(position, heading) {
    if (!physics?.opponentBody) {
      return;
    }

    const support = resolveSurfaceSupport(position, heading, Math.round(opponentState.progress * trackConfig.samples));
    physics.opponentBody.setTranslation({
      x: position.x,
      y: (support.height ?? 0) + physicsConfig.fixedHeight,
      z: position.y
    }, true);
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

  function rapierRotationFromEuler(pitch = 0, yaw = 0, roll = 0) {
    tempQuaternion.setFromEuler(new THREE.Euler(pitch, yaw, roll, "YXZ"));
    return {
      w: tempQuaternion.w,
      x: tempQuaternion.x,
      y: tempQuaternion.y,
      z: tempQuaternion.z
    };
  }

  function createRoadMesh() {
    const positions = [];
    const collisionPositions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const roadTextures = isFreeDrive ? createFreeDriveRoadTextures() : createRoadTextures(trackSurface);

    trackSamples.forEach((sample, sampleIndex) => {
      const roadHeight = 0.06 + freeDriveElevationAtProgress(sampleProgressForIndex(sampleIndex, trackSamples.length));
      const left = sample.center.clone().add(sample.normal.clone().multiplyScalar(sample.halfWidth));
      const right = sample.center.clone().add(sample.normal.clone().multiplyScalar(-sample.halfWidth));
      const supportHalfWidth = physicalRoadSupportHalfWidth({
        halfWidth: sample.halfWidth,
        centerX: sample.center.x,
        isFreeDrive: isIslandWorld
      });
      const collisionLeft = sample.center.clone().add(sample.normal.clone().multiplyScalar(supportHalfWidth));
      const collisionRight = sample.center.clone().add(sample.normal.clone().multiplyScalar(-supportHalfWidth));

      positions.push(left.x, roadHeight, left.y);
      positions.push(right.x, roadHeight, right.y);
      collisionPositions.push(collisionLeft.x, roadHeight, collisionLeft.y);
      collisionPositions.push(collisionRight.x, roadHeight, collisionRight.y);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, sample.distance / 7.5, 1, sample.distance / 7.5);
    });

    for (let index = 0; index < trackModel.segmentCount; index += 1) {
      const next = trackModel.closed ? (index + 1) % trackConfig.samples : index + 1;
      if (isIslandWorld && isFreeDriveJumpGapSegment(trackSamples[index].center, trackSamples[next].center)) continue;
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
    geometry.computeVertexNormals();
    roadCollisionMeshData = {
      vertices: new Float32Array(collisionPositions),
      indices: new Uint32Array(indices)
    };
    surfaceRibbonReports.push(validateDrivableRibbon({
      id: "road-ribbon",
      vertices: roadCollisionMeshData.vertices,
      closed: trackModel.closed
    }));

    return new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: isFreeDrive ? 0xa3a9ad : 0xffffff,
        map: roadTextures.color,
        bumpMap: roadTextures.bump ?? null,
        normalMap: roadTextures.normal ?? null,
        bumpScale: isGravelSurface ? 0.085 : 0.035,
        roughnessMap: roadTextures.roughness,
        roughness: isGravelSurface ? 0.96 : 0.84,
        metalness: 0.03
      })
    );
  }

  function createFreeDriveRoadTextures() {
    const loader = new THREE.TextureLoader();
    const load = (name, colorSpace = null) => {
      const texture = loader.load(new URL(`./assets/freedrive/textures/${name}`, import.meta.url).href);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(2.4, 1);
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      if (colorSpace) texture.colorSpace = colorSpace;
      return texture;
    };
    return {
      color: load("clean_asphalt_diff_1k.jpg", THREE.SRGBColorSpace),
      normal: load("clean_asphalt_nor_gl_1k.jpg"),
      roughness: load("clean_asphalt_rough_1k.jpg")
    };
  }

  function createTrackBandMesh({ side, innerOffset, outerOffset, height, color, texture, segmentFilter = null }) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    trackSamples.forEach((sample, sampleIndex) => {
      const bandHeight = height + freeDriveElevationAtProgress(sampleProgressForIndex(sampleIndex, trackSamples.length));
      const inner = sample.center.clone().add(sample.normal.clone().multiplyScalar((sample.halfWidth + innerOffset) * side));
      const outer = sample.center.clone().add(sample.normal.clone().multiplyScalar((sample.halfWidth + outerOffset) * side));
      positions.push(inner.x, bandHeight, inner.y);
      positions.push(outer.x, bandHeight, outer.y);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, sample.distance / 5.5, 1, sample.distance / 5.5);
    });

    for (let index = 0; index < trackModel.segmentCount; index += 1) {
      const next = trackModel.closed ? (index + 1) % trackConfig.samples : index + 1;
      if (segmentFilter && (!segmentFilter(trackSamples[index]) || !segmentFilter(trackSamples[next]))) continue;
      if (isIslandWorld && isFreeDriveJumpGapSegment(trackSamples[index].center, trackSamples[next].center)) continue;
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
      addTrackLine(raceConfig.startProgress, 0xd64545, 0xd64545, true);
      return;
    }

    addTrackLine(0, 0x27ae60, 0x27ae60, true);
    addTrackLine(raceConfig.finishProgress, 0xd64545, 0xd64545);
  }

  function addTrackLine(progress, lineColor, accentColor, isStartGate = false) {
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

    if (isStartGate) {
      const lampHousing = new THREE.Mesh(
        new THREE.BoxGeometry(3.1, 0.62, 0.42),
        new THREE.MeshStandardMaterial({ color: 0x171b20, roughness: 0.5, metalness: 0.32 })
      );
      lampHousing.position.set(0, 2.72, 0);
      lampHousing.castShadow = true;
      group.add(lampHousing);

      const lamps = [];
      for (let index = 0; index < 3; index += 1) {
        const material = new THREE.MeshStandardMaterial({
          color: 0x3a1717,
          emissive: 0x180000,
          emissiveIntensity: 0.15,
          roughness: 0.28
        });
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), material);
        lamp.position.set((index - 1) * 0.72, 2.72, -0.23);
        lamps.push(lamp);
        group.add(lamp);
      }
      startGateLights.push(lamps);
    }

    group.add(line, accent, leftPost, rightPost);
    scene.add(group);
  }

  function updateStartGateLights() {
    if (startGateLights.length === 0) return;
    const phase = raceState.elapsedSeconds;
    for (const lamps of startGateLights) {
      lamps.forEach((lamp, index) => {
        const green = phase >= 1.8;
        const redActive = !green && phase >= index * 0.48;
        lamp.material.color.setHex(green ? 0x38d96b : redActive ? 0xff3d32 : 0x3a1717);
        lamp.material.emissive.setHex(green ? 0x16b84c : redActive ? 0xe31b12 : 0x180000);
        lamp.material.emissiveIntensity = green ? 2.8 : redActive ? 2.3 : 0.15;
      });
    }
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

  function createRoadTextures(surface) {
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
        const warm = 128 + Math.floor(random() * 48);
        const cool = 102 + Math.floor(random() * 34);
        context.fillStyle = `rgba(${warm}, ${cool}, ${74 + Math.floor(random() * 24)}, ${0.12 + random() * 0.16})`;
        const size = 1 + random() * 4.4;
        context.beginPath();
        context.arc(random() * canvas.width, random() * canvas.height, size, 0, Math.PI * 2);
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
      return finalizeRoadTextureSet(canvas, surface);
    }

    const asphaltGradient = context.createLinearGradient(0, 0, canvas.width, 0);
    asphaltGradient.addColorStop(0, "#303238");
    asphaltGradient.addColorStop(0.15, "#25282d");
    asphaltGradient.addColorStop(0.5, "#2b2d31");
    asphaltGradient.addColorStop(0.85, "#24272b");
    asphaltGradient.addColorStop(1, "#32343a");
    context.fillStyle = asphaltGradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let index = 0; index < 1900; index += 1) {
      const shade = 42 + Math.floor(random() * 20);
      context.fillStyle = `rgba(${shade}, ${shade}, ${shade + 2}, ${0.1 + random() * 0.1})`;
      const size = 1 + random() * 3;
      context.fillRect(random() * canvas.width, random() * canvas.height, size, size);
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
    return finalizeRoadTextureSet(canvas, surface);
  }

  function finalizeRoadTextureSet(colorCanvas, surface) {
    const bumpCanvas = document.createElement("canvas");
    bumpCanvas.width = colorCanvas.width;
    bumpCanvas.height = colorCanvas.height;
    const bumpContext = bumpCanvas.getContext("2d");
    if (bumpContext) {
      bumpContext.fillStyle = surface === TRACK_SURFACES.GRAVEL ? "#777777" : "#858585";
      bumpContext.fillRect(0, 0, bumpCanvas.width, bumpCanvas.height);
      const count = surface === TRACK_SURFACES.GRAVEL ? 4200 : 3200;
      for (let index = 0; index < count; index += 1) {
        const shade = 75 + Math.floor(random() * 105);
        bumpContext.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
        const size = surface === TRACK_SURFACES.GRAVEL ? 1 + random() * 3.2 : 0.6 + random() * 1.8;
        bumpContext.fillRect(random() * bumpCanvas.width, random() * bumpCanvas.height, size, size);
      }
    }

    const roughnessCanvas = document.createElement("canvas");
    roughnessCanvas.width = colorCanvas.width;
    roughnessCanvas.height = colorCanvas.height;
    const roughnessContext = roughnessCanvas.getContext("2d");
    if (roughnessContext) {
      roughnessContext.fillStyle = surface === TRACK_SURFACES.GRAVEL ? "#f1f1f1" : "#d0d0d0";
      roughnessContext.fillRect(0, 0, roughnessCanvas.width, roughnessCanvas.height);
      if (surface !== TRACK_SURFACES.GRAVEL) {
        const wornBand = roughnessContext.createLinearGradient(0, 0, roughnessCanvas.width, 0);
        wornBand.addColorStop(0, "#e4e4e4");
        wornBand.addColorStop(0.22, "#b0b0b0");
        wornBand.addColorStop(0.42, "#d2d2d2");
        wornBand.addColorStop(0.62, "#ababab");
        wornBand.addColorStop(1, "#e5e5e5");
        roughnessContext.globalAlpha = 0.62;
        roughnessContext.fillStyle = wornBand;
        roughnessContext.fillRect(0, 0, roughnessCanvas.width, roughnessCanvas.height);
        roughnessContext.globalAlpha = 1;
      }
    }

    return {
      color: finalizeCanvasTexture(colorCanvas),
      bump: finalizeCanvasTexture(bumpCanvas),
      roughness: finalizeCanvasTexture(roughnessCanvas)
    };
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
        const tone = 104 + Math.floor(random() * 46);
        context.fillStyle = `rgba(${tone}, ${tone - 8}, ${76 + Math.floor(random() * 16)}, ${0.08 + random() * 0.1})`;
        const size = 1 + random() * 3;
        context.fillRect(random() * canvas.width, random() * canvas.height, size, size);
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
      context.fillStyle = `rgba(${76 + Math.floor(random() * 28)}, ${112 + Math.floor(random() * 40)}, ${56 + Math.floor(random() * 24)}, ${0.05 + random() * 0.08})`;
      const width = 6 + random() * 22;
      const height = 2 + random() * 7;
      context.fillRect(random() * canvas.width, random() * canvas.height, width, height);
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
      context.fillStyle = `rgba(${92 + Math.floor(random() * 42)}, ${112 + Math.floor(random() * 48)}, ${68 + Math.floor(random() * 28)}, ${0.04 + random() * 0.05})`;
      const radius = 4 + random() * 18;
      context.beginPath();
      context.ellipse(
        random() * canvas.width,
        random() * canvas.height,
        radius,
        radius * (0.32 + random() * 0.55),
        random() * Math.PI,
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
      context.globalAlpha = 0.05 + random() * 0.08;
      const width = 10 + random() * 26;
      const height = 4 + random() * 12;
      context.fillRect(random() * canvas.width, random() * canvas.height, width, height);
    }

    for (let index = 0; index < 280; index += 1) {
      context.fillStyle = soil;
      context.globalAlpha = 0.04 + random() * 0.05;
      const radius = 5 + random() * 14;
      context.beginPath();
      context.ellipse(
        random() * canvas.width,
        random() * canvas.height,
        radius,
        radius * (0.5 + random() * 0.8),
        random() * Math.PI,
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
      const tone = 132 + Math.floor(random() * 50);
      context.fillStyle = `rgba(${tone}, ${tone - 8}, ${tone - 22}, ${0.08 + random() * 0.1})`;
      const size = 1 + random() * 2.8;
      context.fillRect(random() * canvas.width, random() * canvas.height, size, size);
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
      const size = 1 + random() * 3;
      context.fillRect(random() * canvas.width, random() * canvas.height, size, size);
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

  function addFreeDriveLaneMarks() {
    const centerMaterial = new THREE.MeshStandardMaterial({ color: 0xf3d15b, roughness: 0.58 });
    const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.62 });
    const dashGeometry = new THREE.BoxGeometry(0.16, 0.025, 3.6);
    const edgeGeometry = new THREE.BoxGeometry(0.14, 0.025, 4.8);
    for (let index = 0; index < 140; index += 1) {
      const sample = trackProfileAtProgress(sampleProgressForIndex(index, 140));
      if (isIslandWorld && isFreeDriveJumpGap(sample.center)) continue;
      const markHeight = 0.105 + freeDriveElevationAtProgress(sampleProgressForIndex(index, 140));
      if (index % 2 === 0) {
        const dash = new THREE.Mesh(dashGeometry, centerMaterial);
        dash.position.set(sample.center.x, markHeight, sample.center.y);
        dash.rotation.y = sample.heading;
        dash.receiveShadow = true;
        scene.add(dash);
      }
      for (const side of [-1, 1]) {
        const point = sample.center.clone().add(sample.normal.clone().multiplyScalar((sample.halfWidth - 0.55) * side));
        const edge = new THREE.Mesh(edgeGeometry, edgeMaterial);
        edge.position.set(point.x, markHeight - 0.003, point.y);
        edge.rotation.y = sample.heading;
        edge.receiveShadow = true;
        scene.add(edge);
      }
    }
  }

  function freeDriveElevationAtProgress(progress) {
    if (!isIslandWorld) return 0;
    const sample = trackProfileAtProgress(progress);
    return freeDriveElevationAtPosition(sample.center, progress);
  }

  function freeDriveElevationAtPosition(position, progress = 0) {
    if (!isIslandWorld) return 0;
    const islandElevation = freeDriveIslandElevation(progress);
    const stuntRampRise = freeDriveJumpRampRise(position);
    if (position.x >= 238) return 1.15 + stuntRampRise;
    if (position.x > 116) {
      const bridgeProgress = clamp((position.x - 116) / 122, 0, 1);
      const bridgeElevation = 4.8 + Math.sin(bridgeProgress * Math.PI) * 3.2;
      const entryBlend = smoothstep(116, 140, position.x);
      const exitBlend = smoothstep(214, 238, position.x);
      const entryElevation = THREE.MathUtils.lerp(islandElevation, bridgeElevation, entryBlend);
      return THREE.MathUtils.lerp(entryElevation, 1.15, exitBlend) + stuntRampRise;
    }
    return islandElevation;
  }

  function freeDriveIslandElevation(progress) {
    const phase = wrapProgress(progress) * Math.PI * 2;
    return 2.8 + Math.sin(phase - 0.4) * 2.6 + Math.sin(phase * 2 + 0.8) * 1.15;
  }

  function freeDriveGroundElevationAt(position, progress) {
    if (!isIslandWorld) return 0;
    const stuntRampRise = freeDriveStuntRampRise(position);
    if (position.x > 238) return stuntRampRise;
    if (position.x > 116) return -1.2 + stuntRampRise;
    const sample = trackProfileAtProgress(progress);
    const distance = position.distanceTo(sample.center);
    return Math.max(0, freeDriveElevationAtProgress(progress) - smoothstep(8, 30, distance) * 3.8);
  }

  function resolveSurfaceSupport(position, heading, preferredIndex = state.trackIndex) {
    const centerProjection = closestTrackSample(position, preferredIndex);
    const centerInJumpGap = isIslandWorld && isFreeDriveJumpGap(position);
    const roadSupportHalfWidth = physicalRoadSupportHalfWidth({
      halfWidth: centerProjection.sample.halfWidth,
      centerX: centerProjection.sample.center.x,
      isFreeDrive: isIslandWorld
    });
    const preferRoadLayer = centerProjection.distance <= roadSupportHalfWidth && !centerInJumpGap;
    const contactPoints = createVehicleContactPoints({
      position: { x: position.x, z: position.y },
      heading,
      halfWidth: physicsConfig.carHalfWidth * 0.78,
      halfLength: physicsConfig.carHalfLength * 0.82
    });

    return resolveVehicleSupport({
      contactPoints,
      sampleSurface: (point) => sampleVehicleSurface(point, preferRoadLayer, centerProjection.index)
    });
  }

  function sampleVehicleSurface(point, preferRoadLayer, preferredIndex) {
    const position = new THREE.Vector2(point.x, point.z);
    const projection = closestTrackSample(position, preferredIndex);
    const inJumpGap = isIslandWorld && isFreeDriveJumpGap(position);

    if (preferRoadLayer) {
      const roadSupportHalfWidth = physicalRoadSupportHalfWidth({
        halfWidth: projection.sample.halfWidth,
        centerX: projection.sample.center.x,
        isFreeDrive: isIslandWorld
      });
      if (projection.distance > roadSupportHalfWidth || inJumpGap) return null;
      const bridge = isIslandWorld && position.x > 116 && position.x < 240;
      return {
        height: 0.06 + freeDriveElevationAtProgress(projection.progress),
        surfaceId: bridge ? "bridge" : "road"
      };
    }

    const stuntRise = isIslandWorld ? freeDriveStuntRampRise(position) : 0;
    return {
      height: freeDriveGroundElevationAt(position, projection.progress),
      surfaceId: stuntRise > 0 ? "stunt-ramp" : "ground"
    };
  }

  function applyPlayerSurfaceState(support) {
    playerSurfaceState.grounded = support.grounded;
    playerSurfaceState.height = support.height ?? playerSurfaceState.height;
    playerSurfaceState.pitch = support.pitch;
    playerSurfaceState.roll = support.roll;
    playerSurfaceState.surfaceId = support.surfaceId;
    playerSurfaceState.contacts = support.contacts;
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
      const progress = random();
      const sample = trackProfileAtProgress(progress);
      const side = random() < 0.5 ? 1 : -1;
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
    const grassTufts = buildTracksidePlacements(scaleEnvironmentCount(foliageConfig.grassTuftCount ?? 220, 0.65), {
      minOffset: 3.2,
      maxOffset: 14,
      minSpacing: foliageConfig.grassTuftMinSpacing ?? 1.8,
      maxAttempts: (foliageConfig.maxAttempts ?? 1400) * 2
    }).map((placement) => ({
      ...placement,
      width: randomBetween(0.45, 1.05),
      height: randomBetween(0.32, 0.8)
    }));
    const rocks = buildTracksidePlacements(scaleEnvironmentCount(foliageConfig.rockCount ?? 42, 0.72), {
      minOffset: 7,
      maxOffset: 25,
      minSpacing: foliageConfig.rockMinSpacing ?? 6.5,
      maxAttempts: foliageConfig.maxAttempts ?? 1400
    }).map((placement) => ({
      ...placement,
      size: randomBetween(0.45, 1.5)
    }));

    addNearTreeInstances(nearTrees);
    addBillboardTreeInstances(farTrees, 0x90a98e);
    addShrubInstances(shrubs);
    addGrassTuftInstances(grassTufts);
    addRockInstances(rocks);
  }

  function scaleEnvironmentCount(baseCount, capMultiplier = 1) {
    const scale = Math.min(capMultiplier + 2, environmentScale * capMultiplier);
    return Math.max(8, Math.round(baseCount * scale * environmentDensity));
  }

  function addNearTreeInstances(placements) {
    const slender = placements.filter((placement) => placement.variant === 0);
    const layered = placements.filter((placement) => placement.variant === 1);
    const castTreeShadows = !isGravelSurface;
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x745336, roughness: 0.92 });
    const foliageMaterial = new THREE.MeshStandardMaterial({
      color: 0x2f6b3f,
      roughness: 0.88,
      flatShading: true
    });
    const foliageHighlightMaterial = new THREE.MeshStandardMaterial({
      color: 0x4f8750,
      roughness: 0.9,
      flatShading: true
    });
    const dummy = new THREE.Object3D();

    const slenderTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.3, 1, 6), trunkMaterial, slender.length);
    const slenderCrowns = new THREE.InstancedMesh(new THREE.ConeGeometry(0.92, 1.9, 9), foliageMaterial, slender.length);
    const slenderCrownHighlights = new THREE.InstancedMesh(new THREE.ConeGeometry(0.7, 1.45, 9), foliageHighlightMaterial, slender.length);
    slenderTrunks.castShadow = castTreeShadows;
    slenderCrowns.castShadow = castTreeShadows;
    slenderCrownHighlights.castShadow = castTreeShadows;

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

      dummy.position.set(tree.position.x, tree.height * 0.98, tree.position.y);
      dummy.scale.set(tree.height * 0.25, tree.height * 0.38, tree.height * 0.25);
      dummy.updateMatrix();
      slenderCrownHighlights.setMatrixAt(index, dummy.matrix);
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
    slenderCrownHighlights.instanceMatrix.needsUpdate = true;
    layeredTrunks.instanceMatrix.needsUpdate = true;
    layeredLower.instanceMatrix.needsUpdate = true;
    layeredUpper.instanceMatrix.needsUpdate = true;

    scene.add(slenderTrunks, slenderCrowns, slenderCrownHighlights, layeredTrunks, layeredLower, layeredUpper);
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

  function addGrassTuftInstances(placements) {
    if (placements.length === 0) return;

    const geometry = new THREE.ConeGeometry(0.5, 1, 5);
    geometry.translate(0, 0.5, 0);
    const material = new THREE.MeshStandardMaterial({
      color: isGravelSurface ? 0x8f8b55 : 0x6f963f,
      roughness: 0.96,
      flatShading: true
    });
    const tufts = new THREE.InstancedMesh(geometry, material, placements.length);
    const dummy = new THREE.Object3D();

    placements.forEach((tuft, index) => {
      dummy.position.set(tuft.position.x, 0.04, tuft.position.y);
      dummy.rotation.set(randomBetween(-0.08, 0.08), randomBetween(0, Math.PI * 2), randomBetween(-0.08, 0.08));
      dummy.scale.set(tuft.width, tuft.height, tuft.width * randomBetween(0.72, 1.18));
      dummy.updateMatrix();
      tufts.setMatrixAt(index, dummy.matrix);
    });

    tufts.instanceMatrix.needsUpdate = true;
    tufts.receiveShadow = true;
    scene.add(tufts);
  }

  function addRockInstances(placements) {
    if (placements.length === 0) return;

    const geometry = new THREE.DodecahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({
      color: isGravelSurface ? 0x8b7a62 : 0x69756b,
      roughness: 0.93,
      flatShading: true
    });
    const rocks = new THREE.InstancedMesh(geometry, material, placements.length);
    const dummy = new THREE.Object3D();

    placements.forEach((rock, index) => {
      dummy.position.set(rock.position.x, rock.size * 0.32, rock.position.y);
      dummy.rotation.set(randomBetween(-0.3, 0.3), randomBetween(0, Math.PI * 2), randomBetween(-0.22, 0.22));
      dummy.scale.set(rock.size, rock.size * randomBetween(0.42, 0.72), rock.size * randomBetween(0.75, 1.35));
      dummy.updateMatrix();
      rocks.setMatrixAt(index, dummy.matrix);
    });

    rocks.instanceMatrix.needsUpdate = true;
    rocks.castShadow = !isGravelSurface;
    rocks.receiveShadow = true;
    scene.add(rocks);
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
        color: 0x71868a
      }),
      createBackdropRidge({
        bounds: expandBounds(ridgeBounds, 18),
        depth: 48,
        segments: Math.max(20, Math.floor((backdropConfig.ridgeSegments ?? 36) * 0.7)),
        minHeight: 22,
        maxHeight: 46,
        color: 0x637981
      }),
      createBackdropRidge({
        bounds: expandBounds(ridgeBounds, 42),
        depth: 58,
        segments: Math.max(18, Math.floor((backdropConfig.ridgeSegments ?? 36) * 0.58)),
        minHeight: 30,
        maxHeight: 58,
        color: 0x708691
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
    if (!isFreeDrive) addBillboardTreeInstances(innerBackdropTrees, 0x738572);
  }

  function createBackdropRidge({ bounds, depth, segments, minHeight, maxHeight, color }) {
    const positions = [];
    const uvs = [];
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
      const u = index / Math.max(1, outline.length - 1) * 10;
      uvs.push(u, 0, u, 1, u + 0.35, 0, u + 0.35, 0.78);
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
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: isFreeDrive ? 0x9b9b8b : color,
      map: isFreeDrive ? loadFreeDriveTiledTexture("rocks_ground_03_diff_1k.jpg", THREE.SRGBColorSpace, 1, 1) : null,
      normalMap: isFreeDrive ? loadFreeDriveTiledTexture("rocks_ground_03_nor_gl_1k.jpg") : null,
      roughnessMap: isFreeDrive ? loadFreeDriveTiledTexture("rocks_ground_03_rough_1k.jpg") : null,
      roughness: 0.98,
      metalness: 0,
      flatShading: !isFreeDrive,
      fog: true,
      side: THREE.DoubleSide
    });
    return new THREE.Mesh(geometry, material);
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
    const lease = await loadCarTemplate(carSpec);
    try {
      const template = lease.value;
      if (!template) return createFallbackCar(carSpec, tint ?? 0xa81f34);
      const group = new THREE.Group();
      const visualRoot = new THREE.Group();
      const model = template.clone(true);
      cloneCarMaterials(model);
      markMaterialsOnlyDispose(model);
      configureCarMaterials(model);
      applyConfiguredCarTint(model, carSpec, tint);
      visualRoot.add(model);
      const wheelVisuals = configureModelWheelAnimation(model, visualRoot, carSpec);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const boostGroup = createBoostGroup(carSpec, size, box.min.z);
      visualRoot.position.y = racingSceneConfig.groundOffset;
      group.userData.visualRoot = visualRoot;
      group.userData.model = model;
      group.userData.cameraMetrics = { width: size.x, height: size.y, length: size.z };
      group.userData.boostFlames = boostGroup.userData.flames;
      group.userData.boostGroup = boostGroup;
      group.userData.wheelShaderBindings = wheelVisuals.bindings;
      group.userData.wheelCount = wheelVisuals.logicalWheelCount;
      visualRoot.add(boostGroup);
      group.add(visualRoot);
      return group;
    } finally {
      lease.release();
    }
  }

  async function initializeFreeDriveTraffic() {
    if (!physics?.world || freeDriveTraffic.length > 0) return;
    const trafficCount = 3;
    const palette = [0x2f5e8d, 0xd8d6ce, 0x9b2533, 0x33383c, 0xc18b2e, 0x58705a];
    const specs = Array.from({ length: trafficCount }, (_, index) =>
      racingCarCatalog[(index + 1) % racingCarCatalog.length]
    );
    const trafficSpecs = specs.map((spec) => ({
      ...spec,
      id: `traffic-lod:${spec.id}`,
      modelUrl: spec.previewModelUrl ?? spec.modelUrl
    }));
    const visuals = await Promise.all(
      trafficSpecs.map((spec, index) => createCar(spec, palette[index % palette.length]))
    );
    visuals.forEach((visual, index) => {
      const direction = index % 3 === 2 ? -1 : 1;
      const traffic = {
        index,
        visual,
        body: null,
        collider: null,
        initialProgress: wrapProgress(0.13 + index / trafficCount),
        progress: 0,
        direction,
        laneOffset: direction > 0 ? -3.15 : 3.15,
        cruiseSpeed: physicalDrivingConfig.maxForwardSpeed * (
          trafficCount > 1 ? 0.55 + (index / (trafficCount - 1)) * 0.45 : 1
        ),
        currentSpeed: 0,
        boostSeconds: 0,
        boostCharges: opponentBoostConfig.charges,
        boostActivationTimesSeconds: opponentBoostConfig.activationTimesSeconds.map(
          (activationTime) => activationTime + index * 0.65
        ),
        collisionHoldSeconds: 0,
        contactCooldownSeconds: 0,
        wheelSpin: 0,
        jumpOffset: 0,
        jumpVelocity: 0,
        jumpCooldownSeconds: 0,
        airborne: false,
        position: new THREE.Vector2(),
        heading: 0,
        eventOpponent: isShowcase,
        name: isShowcase ? ["RAVEN", "APEX", "VOLT"][index] : null,
        eventDistance: 0,
        finishTimeSeconds: null
      };
      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(0, physicsConfig.fixedHeight, 0)
          .enabledRotations(false, true, false)
          .setCanSleep(false)
      );
      const collider = physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(
          physicsConfig.carHalfWidth,
          physicsConfig.carHalfHeight,
          physicsConfig.carHalfLength
        )
          .setFriction(0.18)
          .setRestitution(0.02)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body
      );
      traffic.body = body;
      traffic.collider = collider;
      physics.colliderTags.set(collider.handle, { type: "traffic", index });
      freeDriveTraffic.push(traffic);
      if (isShowcase) {
        traffic.nameplate = createOpponentNameplate(traffic.name, ["#ff647c", "#62ddff", "#ffd45a"][index]);
        visual.add(traffic.nameplate);
      }
      scene.add(visual);
    });
    resetFreeDriveTraffic();
  }

  function createOpponentNameplate(name, accent) {
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 256;
    labelCanvas.height = 64;
    const context = labelCanvas.getContext("2d");
    context.fillStyle = "rgba(4, 10, 16, .78)";
    context.fillRect(8, 8, 240, 48);
    context.strokeStyle = accent;
    context.lineWidth = 4;
    context.strokeRect(8, 8, 240, 48);
    context.fillStyle = "#ffffff";
    context.font = "900 30px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(name, 128, 33);
    const texture = new THREE.CanvasTexture(labelCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.name = `showcase-opponent-${name}`;
    sprite.position.set(0, 3.1, 0);
    sprite.scale.set(4, 1, 1);
    sprite.renderOrder = 4;
    return sprite;
  }

  function resetFreeDriveTraffic() {
    for (const traffic of freeDriveTraffic) {
      if (isShowcase) {
        const gridDistances = [-9, -16, -23];
        const gridLanes = [-2.4, 0, 2.4];
        traffic.direction = 1;
        traffic.laneOffset = gridLanes[traffic.index];
        traffic.eventDistance = gridDistances[traffic.index];
        traffic.finishTimeSeconds = null;
        traffic.currentSpeed = 0;
        traffic.collisionHoldSeconds = 0;
        syncShowcaseOpponentPose(traffic, true);
        continue;
      }
      traffic.progress = traffic.initialProgress;
      traffic.currentSpeed = traffic.cruiseSpeed;
      traffic.boostSeconds = 0;
      traffic.boostCharges = opponentBoostConfig.charges;
      traffic.collisionHoldSeconds = 0;
      traffic.contactCooldownSeconds = 0;
      traffic.wheelSpin = 0;
      traffic.jumpOffset = 0;
      traffic.jumpVelocity = 0;
      traffic.jumpCooldownSeconds = 0;
      traffic.airborne = false;
      syncFreeDriveTrafficPose(traffic, true);
    }
  }

  function syncFreeDriveTrafficPose(traffic, immediate = false) {
    const sample = trackProfileAtProgress(traffic.progress);
    traffic.position.copy(sample.center).add(sample.normal.clone().multiplyScalar(traffic.laneOffset));
    traffic.heading = sample.heading + (traffic.direction < 0 ? Math.PI : 0);
    const support = resolveSurfaceSupport(
      traffic.position,
      traffic.heading,
      Math.round(traffic.progress * trackConfig.samples)
    );
    const surfaceHeight = support.height ?? freeDriveElevationAtProgress(traffic.progress);
    const translation = {
      x: traffic.position.x,
      y: surfaceHeight + physicsConfig.fixedHeight + traffic.jumpOffset,
      z: traffic.position.y
    };
    const rotation = rapierRotationFromYaw(traffic.heading);
    if (immediate) {
      traffic.body.setTranslation(translation, true);
      traffic.body.setRotation(rotation, true);
    } else {
      traffic.body.setNextKinematicTranslation(translation);
      traffic.body.setNextKinematicRotation(rotation);
    }
    traffic.visual.position.set(
      traffic.position.x,
      surfaceHeight + traffic.jumpOffset,
      traffic.position.y
    );
    traffic.visual.rotation.set(0, traffic.heading, 0);
  }

  function updateFreeDriveTraffic(deltaSeconds) {
    if (!isFreeDrive || freeDriveTraffic.length === 0) return;
    if (isShowcase) {
      updateShowcaseOpponents(deltaSeconds);
      return;
    }
    for (const traffic of freeDriveTraffic) {
      traffic.collisionHoldSeconds = Math.max(0, traffic.collisionHoldSeconds - deltaSeconds);
      traffic.boostSeconds = Math.max(0, traffic.boostSeconds - deltaSeconds);
      traffic.contactCooldownSeconds = Math.max(0, traffic.contactCooldownSeconds - deltaSeconds);
      traffic.jumpCooldownSeconds = Math.max(0, traffic.jumpCooldownSeconds - deltaSeconds);
      let targetSpeed = traffic.collisionHoldSeconds > 0 ? 1.5 : traffic.cruiseSpeed;
      let nearestAhead = Infinity;
      for (const other of freeDriveTraffic) {
        if (other === traffic || other.direction !== traffic.direction) continue;
        const progressGap = traffic.direction > 0
          ? wrapProgress(other.progress - traffic.progress)
          : wrapProgress(traffic.progress - other.progress);
        const laneGap = Math.abs(other.laneOffset - traffic.laneOffset);
        if (laneGap < 1.2) nearestAhead = Math.min(nearestAhead, progressGap * trackLength);
      }
      if (nearestAhead < 24) {
        targetSpeed *= clamp((nearestAhead - 7) / 17, 0, 1);
      }
      const playerGap = traffic.direction > 0
        ? wrapProgress(state.trackProgress - traffic.progress)
        : wrapProgress(traffic.progress - state.trackProgress);
      if (state.onRoad && playerGap * trackLength < 18 && Math.abs(state.position.distanceTo(traffic.position)) < 22) {
        targetSpeed = Math.min(targetSpeed, Math.max(0, state.velocity.length() - 1));
      }
      const safeToBoost = traffic.collisionHoldSeconds <= 0
        && nearestAhead >= 32
        && (!state.onRoad || state.position.distanceTo(traffic.position) >= 26);
      if (shouldActivateComputerBoost({
        elapsedSeconds: raceState.elapsedSeconds,
        boostSeconds: traffic.boostSeconds,
        boostCharges: traffic.boostCharges,
        totalCharges: opponentBoostConfig.charges,
        activationTimesSeconds: traffic.boostActivationTimesSeconds,
        eligible: safeToBoost
      })) {
        traffic.boostCharges -= 1;
        traffic.boostSeconds = boostConfig.durationSeconds;
      }
      if (traffic.boostSeconds > 0 && traffic.collisionHoldSeconds <= 0 && nearestAhead >= 24) {
        targetSpeed = Math.max(targetSpeed, traffic.cruiseSpeed * boostConfig.topSpeedMultiplier);
      }
      const speedRecovery = traffic.boostSeconds > 0 ? 16 : 5.5;
      traffic.currentSpeed = moveToward(traffic.currentSpeed, targetSpeed, deltaSeconds * speedRecovery);
      if (isIslandWorld && !traffic.airborne && traffic.jumpCooldownSeconds <= 0) {
        const launch = resolveFreeDriveJumpLaunch(traffic.position, {
          x: Math.sin(traffic.heading) * traffic.currentSpeed,
          y: Math.cos(traffic.heading) * traffic.currentSpeed
        });
        if (launch) {
          traffic.airborne = true;
          traffic.jumpVelocity = launch.verticalSpeed;
        }
      }
      if (traffic.airborne) {
        traffic.jumpVelocity -= FREE_DRIVE_JUMP.gravity * deltaSeconds;
        traffic.jumpOffset += traffic.jumpVelocity * deltaSeconds;
        if (traffic.jumpOffset <= 0 && traffic.jumpVelocity < 0) {
          traffic.jumpOffset = 0;
          traffic.jumpVelocity = 0;
          traffic.airborne = false;
          traffic.jumpCooldownSeconds = 0.8;
        }
      }
      traffic.progress = wrapProgress(
        traffic.progress + traffic.direction * traffic.currentSpeed * deltaSeconds / Math.max(trackLength, 0.001)
      );
      traffic.wheelSpin += traffic.direction * traffic.currentSpeed * deltaSeconds / 0.36;
      syncFreeDriveTrafficPose(traffic);
      animateWheelVisuals(traffic.visual, traffic.wheelSpin, 0);
    }
  }

  function syncShowcaseOpponentPose(traffic, immediate = false) {
    const sample = sampleFreeDriveShowcaseDrivingLine(freeDriveShowcaseDrivingLine, traffic.eventDistance);
    if (!sample) return;
    traffic.position.set(sample.x + sample.normalX * traffic.laneOffset, sample.z + sample.normalZ * traffic.laneOffset);
    traffic.heading = sample.heading;
    const translation = { x: traffic.position.x, y: sample.y + physicsConfig.fixedHeight, z: traffic.position.y };
    const rotation = rapierRotationFromYaw(traffic.heading);
    if (immediate) {
      traffic.body.setTranslation(translation, true);
      traffic.body.setRotation(rotation, true);
    } else {
      traffic.body.setNextKinematicTranslation(translation);
      traffic.body.setNextKinematicRotation(rotation);
    }
    traffic.visual.position.set(traffic.position.x, sample.y, traffic.position.y);
    traffic.visual.rotation.set(0, traffic.heading, 0);
  }

  function updateShowcaseOpponents(deltaSeconds) {
    const advancing = showcaseEvent.phase === "running" || showcaseEvent.phase === "settling";
    const total = freeDriveShowcaseDrivingLine.at(-1)?.distance ?? 0;
    for (const traffic of freeDriveTraffic) {
      if (advancing && traffic.finishTimeSeconds == null) {
        const sample = sampleFreeDriveShowcaseDrivingLine(freeDriveShowcaseDrivingLine, traffic.eventDistance);
        let targetSpeed = traffic.cruiseSpeed * (sample?.section === "rally" ? 0.62 : 0.82);
        const lookAhead = sampleFreeDriveShowcaseDrivingLine(freeDriveShowcaseDrivingLine, traffic.eventDistance + 14);
        const headingChange = sample && lookAhead
          ? Math.abs(shortestAngleDelta(sample.heading, lookAhead.heading))
          : 0;
        targetSpeed *= clamp(1 - headingChange / 2.2, 0.28, 1);
        const ahead = freeDriveTraffic
          .filter((other) => other !== traffic && other.eventDistance > traffic.eventDistance)
          .reduce((gap, other) => Math.min(gap, other.eventDistance - traffic.eventDistance), Infinity);
        if (ahead < 16) targetSpeed *= clamp((ahead - 6) / 10, 0, 1);
        const playerAhead = showcaseEvent.playerDistance - traffic.eventDistance;
        if (playerAhead > 0 && playerAhead < 12) targetSpeed = Math.min(targetSpeed, state.velocity.length());
        traffic.currentSpeed = moveToward(traffic.currentSpeed, targetSpeed, deltaSeconds * 7);
        traffic.eventDistance = Math.min(total, traffic.eventDistance + traffic.currentSpeed * deltaSeconds);
        if (traffic.eventDistance >= total) {
          traffic.finishTimeSeconds = showcaseEvent.elapsedSeconds;
          traffic.currentSpeed = 0;
        }
        traffic.wheelSpin += traffic.currentSpeed * deltaSeconds / 0.36;
      } else if (!advancing) {
        traffic.currentSpeed = 0;
      }
      syncShowcaseOpponentPose(traffic);
      animateWheelVisuals(traffic.visual, traffic.wheelSpin, 0);
    }
  }

  function loadCarTemplate(carSpec) {
    return carTemplateLeases.acquire(carSpec.id, { carSpec, prepare: prepareCarTemplate });
  }

  async function prepareCarTemplate(carSpec) {
    return carModelLoader.loadAsync(carSpec.modelUrl)
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

  function createBoostGroup(carSpec, carSize, rearZ) {
    const boostGroup = new THREE.Group();
    boostGroup.visible = false;
    const exhausts = Array.isArray(carSpec?.boostExhausts)
      ? carSpec.boostExhausts
      : [
          { x: -carSize.x * 0.24, y: carSize.y * 0.42, z: rearZ - 0.02 },
          { x: carSize.x * 0.24, y: carSize.y * 0.42, z: rearZ - 0.02 }
        ];

    const flameMaterial = new THREE.MeshBasicMaterial({
      color: 0x168cff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xd9fbff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x2f6bff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const flameGeometry = new THREE.SphereGeometry(1, 12, 12);
    const glowGeometry = new THREE.SphereGeometry(1, 14, 14);
    const rearward = new THREE.Vector3(0, 0, -1);
    const flames = [];

    for (const exhaust of exhausts) {
      const radius = exhaust.radius ?? Math.max(0.11, carSize.x * 0.035);
      const outlet = new THREE.Group();
      outlet.position.set(exhaust.x, exhaust.y, exhaust.z);
      const [directionX, directionY, directionZ] = exhaust.direction ?? [0, 0, -1];
      const direction = new THREE.Vector3(directionX, directionY, directionZ);
      if (direction.lengthSq() < 0.0001) direction.copy(rearward);
      direction.normalize();
      outlet.quaternion.setFromUnitVectors(rearward, direction);

      const outer = new THREE.Mesh(flameGeometry, flameMaterial.clone());
      outer.position.set(0, 0, -radius * 3.8);
      outer.scale.set(radius * 1.18, radius * 1.18, radius * 5.4);
      outer.userData.boostLayer = "outer";
      outer.userData.baseScale = outer.scale.clone();

      const core = new THREE.Mesh(flameGeometry, coreMaterial.clone());
      core.position.set(0, 0, -radius * 2.45);
      core.scale.set(radius * 0.62, radius * 0.62, radius * 3.5);
      core.userData.boostLayer = "core";
      core.userData.baseScale = core.scale.clone();

      const glow = new THREE.Mesh(glowGeometry, glowMaterial.clone());
      glow.position.set(0, 0, -radius * 1.2);
      glow.scale.set(radius * 1.8, radius * 1.35, radius * 2.3);
      glow.userData.boostLayer = "glow";
      glow.userData.baseScale = glow.scale.clone();

      for (const flame of [outer, core, glow]) {
        flame.userData.exhaustPosition = [exhaust.x, exhaust.y, exhaust.z];
      }
      flames.push(outer, core, glow);
      outlet.add(outer, core, glow);
      boostGroup.add(outlet);
    }

    boostGroup.userData.flames = flames;
    boostGroup.userData.outletCount = exhausts.length;
    return boostGroup;
  }

  function createFallbackCar(carSpec, color = 0xa81f34) {
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
    const fallbackWheelNodes = [];
    for (const [index, [x, y, z]] of wheelPositions.entries()) {
      const wheel = new THREE.Mesh(wheelGeometry, darkMaterial);
      wheel.position.set(x, y, z);
      wheel.rotation.z = Math.PI / 2;
      wheel.castShadow = true;
      visualRoot.add(wheel);
      fallbackWheelNodes.push({
        node: wheel,
        baseQuaternion: wheel.quaternion.clone(),
        front: index < 2
      });
    }

    const fallbackExhausts = carSpec?.boostExhausts?.length === 0
      ? []
      : [
          { x: -0.54, y: 0.7, z: -2.14, radius: 0.16 },
          { x: 0.54, y: 0.7, z: -2.14, radius: 0.16 }
        ];
    const boostGroup = createBoostGroup(
      { boostExhausts: fallbackExhausts },
      { x: 2.3, y: 1.56, z: 4.25 },
      -2.125
    );
    const flames = boostGroup.userData.flames;

    visualRoot.position.y = racingSceneConfig.groundOffset;
    group.userData.boostFlames = flames;
    group.userData.boostGroup = boostGroup;
    group.userData.wheelNodes = fallbackWheelNodes;
    group.userData.wheelShaderBindings = [];
    group.userData.wheelCount = fallbackWheelNodes.length;
    group.userData.visualRoot = visualRoot;
    visualRoot.add(body, hood, cabin, rear, frontLightLeft, frontLightRight);
    visualRoot.add(boostGroup);
    group.add(visualRoot);
    const fallbackSize = new THREE.Box3().setFromObject(visualRoot).getSize(new THREE.Vector3());
    group.userData.cameraMetrics = {
      width: fallbackSize.x,
      height: fallbackSize.y,
      length: fallbackSize.z
    };
    return group;
  }

  function loop(timestamp) {
    if (!active) return;

    const frameStartedAt = clock.now();
    const frameDeltaSeconds = Math.max(0, (timestamp - lastFrameTime) / 1000);
    const deltaSeconds = Math.min(frameDeltaSeconds, 0.04);
    lastFrameTime = timestamp;
    let physicsMs = 0;
    let physicsSteps = 0;
    input.pollGamepad();
    if (!raceState.paused) {
      const sprintGlide = raceConfig.mode === "sprint" && raceState.finished && !raceState.resultVisible;

      if (!raceState.finished || sprintGlide) {
        updateControls();
        const physicsStartedAt = clock.now();
        physicsSteps = updatePhysics(deltaSeconds);
        physicsMs = clock.now() - physicsStartedAt;
        updateRaceState(deltaSeconds);
      } else {
        state.throttle = 0;
        state.brake = 0;
        state.steering += (0 - state.steering) * 0.18;
      }

      updateCarTransform(deltaSeconds);
      updateBoostEffect(timestamp);
      updateStartGateLights();
      updateDrivingDust(deltaSeconds);
      updateFreeDriveWater(deltaSeconds);
      updateOpponentTransform();
      updateCamera(deltaSeconds);
      updateShowcaseAtmosphere(deltaSeconds);
      updateCollisionDebugVisuals();
      updateCollisionDebugHud();
    }

    updateRacingAudio();
    updateRacingHaptics();
    updateHud();
    const renderStartedAt = clock.now();
    renderer.render(scene, camera);
    const renderMs = clock.now() - renderStartedAt;
    racingTelemetry.recordFrame({
      deltaSeconds: frameDeltaSeconds,
      cpuMs: clock.now() - frameStartedAt,
      physicsMs,
      renderMs,
      physicsSteps,
      simulationActive: !raceState.paused,
      render: renderer.info.render
    });

    animationFrameId = clock.requestFrame(loop);
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
    sessionControls?.transition(nextPaused ? "paused" : "running");
    keyState.clear();
    pauseOverlay.hidden = !nextPaused;

    if (nextPaused) {
      resumeButton.focus({ preventScroll: true });
    } else if (document.activeElement instanceof HTMLElement && pauseOverlay.contains(document.activeElement)) {
      document.activeElement.blur();
    }

    updateHud();
    updateCollisionDebugHud();
    return raceState.paused;
  }

  function updateControls() {
    if (isShowcase && ["countdown", "settling", "result"].includes(showcaseEvent.phase)) {
      state.throttle = 0;
      state.brake = 0;
      state.steering *= physicalDrivingConfig.steeringReleaseResponse;
      return;
    }
    if (provingGroundRunner.snapshot().status === "running") {
      const controls = provingGroundRunner.controls();
      state.throttle = controls.throttle;
      state.brake = controls.brake;
      state.steering = controls.steering;
      return;
    }
    const throttlePressed = keyState.has("KeyW") || keyState.has("ArrowUp");
    const brakePressed = keyState.has("KeyS") || keyState.has("ArrowDown");
    const leftPressed = keyState.has("KeyA") || keyState.has("ArrowLeft");
    const rightPressed = keyState.has("KeyD") || keyState.has("ArrowRight");
    const sprintGlide = raceConfig.mode === "sprint" && raceState.finished && !raceState.resultVisible;

    state.throttle = sprintGlide ? 0 : Math.max(throttlePressed ? 1 : 0, gamepadDrive.throttle);
    state.brake = sprintGlide ? 0 : Math.max(brakePressed ? 1 : 0, gamepadDrive.brake);

    const keyboardSteer = (leftPressed ? 1 : 0) - (rightPressed ? 1 : 0);
    const targetSteer = keyboardSteer || gamepadDrive.steering;
    const steeringResponse = targetSteer === 0
      ? physicalDrivingConfig.steeringReleaseResponse
      : physicalDrivingConfig.steeringResponse;
    state.steering += (targetSteer - state.steering) * steeringResponse;
  }

  function updateRacingAudio() {
    const drivetrain = physics?.playerVehicle?.drivetrain;
    const tireDynamics = physics?.playerVehicle?.tireDynamics;
    const vehicleSpec = playerVehicleSpec();
    racingAudio.update({
      signedSpeed: physics?.playerVehicle?.speed ?? state.velocity.length(),
      throttle: state.throttle,
      boostActive: state.boostSeconds > 0,
      enabled: active && !raceState.paused && !raceState.resultVisible,
      maxForwardSpeed: playerMaxForwardSpeed(),
      engineRpm: drivetrain?.engineRpm,
      idleRpm: vehicleSpec.idleRpm,
      maximumRpm: vehicleSpec.redlineRpm,
      tireSlip: tireDynamics?.squeal ?? 0,
      environment: isShowcase ? presentationState.environment : "road"
    });
  }

  function updateShowcaseAtmosphere(deltaSeconds) {
    if (!isShowcase || !renderer || raceState.resultVisible) return;
    const onRally = playerSurfaceState.surfaceId === FREE_DRIVE_RALLY.surfaceId
      || (freeDriveJumpState.airborne && presentationState.environment === "rally");
    const inTunnel = state.onRoad
      && state.trackProgress >= FREE_DRIVE_TUNNEL.startProgress
      && state.trackProgress <= FREE_DRIVE_TUNNEL.endProgress;
    presentationState.environment = showcaseEvent.phase !== "running"
      ? "road" : onRally ? "rally" : inTunnel ? "tunnel" : "road";
    const targetExposure = presentationState.baselineExposure
      * (presentationState.environment === "tunnel" ? 0.82 : 1);
    const follow = 1 - Math.exp(-deltaSeconds * 3.4);
    presentationState.exposure += (targetExposure - presentationState.exposure) * follow;
    renderer.toneMappingExposure = presentationState.exposure;
  }

  function updateRacingHaptics() {
    const tireDynamics = physics?.playerVehicle?.tireDynamics;
    racingHaptics.update({
      gamepadIndex: gamepadDrive.index ?? -1,
      signedSpeed: physics?.playerVehicle?.speed ?? state.velocity.length(),
      maxForwardSpeed: playerMaxForwardSpeed(),
      throttle: state.throttle,
      brake: state.brake,
      boostActive: state.boostSeconds > 0,
      grounded: playerSurfaceState.grounded,
      surfaceId: playerSurfaceState.surfaceId,
      enabled: active && !raceState.paused && !raceState.resultVisible,
      tireSlip: tireDynamics?.maximumSlip ?? 0,
      absActive: tireDynamics?.absActive ?? false,
      tractionControlActive: tireDynamics?.tractionControlActive ?? false
    });
  }

  function updateBoostEffect(timestamp) {
    const playerActive = state.boostSeconds > 0
      && !(raceState.finished && raceConfig.mode === "sprint")
      && state.velocity.length() > 2;
    const opponentActive = raceState.opponentEnabled
      && !raceState.finished
      && opponentState.boostSeconds > 0
      && opponentState.currentSpeed > 2;
    updateCarBoostEffect(car, playerActive, timestamp);
    updateCarBoostEffect(opponentCar, opponentActive, timestamp + 73);
    for (const traffic of freeDriveTraffic) {
      const trafficActive = isFreeDrive && traffic.boostSeconds > 0 && traffic.currentSpeed > 2;
      updateCarBoostEffect(traffic.visual, trafficActive, timestamp + 137 + traffic.index * 97);
    }
  }

  function updateCarBoostEffect(targetCar, active, timestamp) {
    const flames = targetCar?.userData.boostFlames;
    const boostGroup = targetCar?.userData.boostGroup;
    if (!flames) return;

    if (boostGroup) {
      boostGroup.visible = active;
    }
    const pulse = 0.84 + Math.sin(timestamp * 0.022) * 0.16;

    for (const flame of flames) {
      flame.visible = active;

      if (!active) {
        flame.material.opacity = 0;
        continue;
      }

      const layer = flame.userData.boostLayer;
      const baseScale = flame.userData.baseScale;
      flame.material.opacity = (layer === "glow" ? 0.58 : layer === "outer" ? 0.88 : 1) * pulse;
      if (!baseScale) continue;

      const widthPulse = 1 + pulse * (layer === "glow" ? 0.18 : 0.08);
      const heightPulse = 1 + pulse * (layer === "glow" ? 0.12 : 0.08);
      const lengthPulse = 1 + pulse * (layer === "outer" ? 0.42 : layer === "core" ? 0.3 : 0.28);
      flame.scale.set(
        baseScale.x * widthPulse,
        baseScale.y * heightPulse,
        baseScale.z * lengthPulse
      );
    }
  }

  function updatePhysics(deltaSeconds) {
    let stepCount = 0;
    physicsAccumulator = Math.min(
      physicsAccumulator + deltaSeconds,
      physicsConfig.stepSeconds * 4
    );
    while (physicsAccumulator >= physicsConfig.stepSeconds) {
      stepPhysics(physicsConfig.stepSeconds);
      physicsAccumulator -= physicsConfig.stepSeconds;
      stepCount += 1;
    }
    return stepCount;
  }

  function stepPhysics(deltaSeconds) {
    if (!physics?.playerBody) {
      return;
    }

    physics.world.timestep = deltaSeconds;
    syncPlayerPhysicsState();
    state.previousPosition.copy(state.position);
    state.previousTrackIndex = state.trackIndex;
    state.boostSeconds = Math.max(0, state.boostSeconds - deltaSeconds);
    if (state.stoppedByImpactSeconds > 0) {
      state.stoppedByImpactSeconds = Math.max(0, state.stoppedByImpactSeconds - deltaSeconds);
    }

    if (provingGroundRunner.snapshot().status === "running") {
      const controls = provingGroundRunner.controls();
      state.throttle = controls.throttle;
      state.brake = controls.brake;
      state.steering = controls.steering;
    }
    const anchorShowcase = isShowcase && showcaseEvent.phase === "countdown";
    if (anchorShowcase) anchorShowcaseStartPose();
    else drivePhysicalVehicle(deltaSeconds);

    updateOpponent(deltaSeconds);
    updateFreeDriveTraffic(deltaSeconds);
    physics.world.step(physics.eventQueue);
    drainPhysicsEvents();
    if (anchorShowcase) anchorShowcaseStartPose();
    syncPlayerPhysicsState(state.previousTrackIndex);
    syncPhysicalVehicleState();
    syncOpponentPhysicsState();
    provingGroundRunner.update(provingGroundObservation(), deltaSeconds);
  }

  function drivePhysicalVehicle(deltaSeconds) {
    const vehicle = physics?.playerVehicle;
    if (!vehicle || !physics?.playerBody) return;
    updatePhysicalVehicle({
      vehicle,
      chassis: physics.playerBody,
      deltaSeconds,
      throttle: state.throttle,
      brake: state.brake,
      steering: state.steering,
      boostActive: state.boostSeconds > 0,
      maxForwardSpeed: playerMaxForwardSpeed(),
      acceptsGroundCollider: (collider) => {
        const tag = physics.colliderTags.get(collider.handle);
        return isPhysicalVehicleSurface(tag);
      },
      surfaceId: playerSurfaceState.surfaceId,
      grounded: playerSurfaceState.grounded
    });
    syncPhysicalVehicleState();
  }

  function updateOpponent(deltaSeconds) {
    if (!physics?.opponentBody || !physics?.opponentCollider) {
      return;
    }

    opponentState.collisionHoldSeconds = Math.max(0, opponentState.collisionHoldSeconds - deltaSeconds);
    opponentState.boostSeconds = Math.max(0, opponentState.boostSeconds - deltaSeconds);
    opponentState.collisionLaneOffset = moveToward(
      opponentState.collisionLaneOffset,
      0,
      deltaSeconds * physicalDrivingConfig.opponentLaneRecovery
    );
    opponentState.collisionYawOffset = moveToward(
      opponentState.collisionYawOffset,
      0,
      deltaSeconds * physicalDrivingConfig.opponentYawRecovery
    );
    physics.opponentCollider.setEnabled(raceState.opponentEnabled);

    if (!raceState.opponentEnabled) {
      return;
    }

    if (!raceState.finished) {
      if (shouldActivateComputerBoost({
        elapsedSeconds: raceState.elapsedSeconds,
        boostSeconds: opponentState.boostSeconds,
        boostCharges: opponentState.boostCharges,
        totalCharges: opponentBoostConfig.charges,
        activationTimesSeconds: opponentBoostConfig.activationTimesSeconds,
        eligible: opponentState.collisionHoldSeconds <= 0
      })) {
        opponentState.boostCharges -= 1;
        opponentState.boostSeconds = boostConfig.durationSeconds;
      }
      const boostMultiplier = opponentState.boostSeconds > 0 ? boostConfig.topSpeedMultiplier : 1;
      const targetSpeed = opponentConfig.speed * boostMultiplier * (
        opponentState.collisionHoldSeconds > 0
          ? physicalDrivingConfig.opponentImpactSpeedMultiplier
          : 1
      );
      const speedRecovery = opponentState.collisionHoldSeconds > 0
        ? 8.4
        : opponentState.boostSeconds > 0 ? 18 : 6;
      opponentState.currentSpeed = moveToward(opponentState.currentSpeed, targetSpeed, deltaSeconds * speedRecovery);
    } else if (raceConfig.mode === "sprint") {
      opponentState.boostSeconds = 0;
      opponentState.currentSpeed = Math.max(0, opponentState.currentSpeed - deltaSeconds * 6.5);
    } else {
      opponentState.boostSeconds = 0;
      opponentState.currentSpeed = 0;
    }

    const deltaProgress = (opponentState.currentSpeed * deltaSeconds) / Math.max(trackLength, 0.0001);
    opponentState.progress = raceConfig.mode === "lap"
      ? wrapProgress(opponentState.progress + deltaProgress)
      : clamp(opponentState.progress + deltaProgress, 0, 1);

    syncOpponentPose();
    const support = resolveSurfaceSupport(
      opponentState.position,
      opponentState.heading,
      Math.round(opponentState.progress * trackConfig.samples)
    );
    physics.opponentBody.setNextKinematicTranslation({
      x: opponentState.position.x,
      y: (support.height ?? 0) + physicsConfig.fixedHeight,
      z: opponentState.position.y
    });
    physics.opponentBody.setNextKinematicRotation(rapierRotationFromYaw(opponentState.heading));
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
      const velocity = new THREE.Vector2(current.x, current.z);
      if (velocity.length() > 1) {
        racingHaptics.pulseImpact(clamp(velocity.length() / 24, 0.12, 1));
      }
      const impactNormal = velocity.lengthSq() > 0.0001
        ? velocity.clone().normalize().multiplyScalar(-1)
        : forwardVector().multiplyScalar(-1);
      recordCollisionDebug({
        tag: tag?.type === "traffic" ? "traffic" : tag ?? "unknown",
        handle: otherHandle,
        currentVelocity: velocity,
        responseVelocity: velocity,
        impactNormal,
        headingBefore: state.heading,
        headingAfter: state.heading
      });
    });
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

  function updateRaceState(deltaSeconds) {
    raceState.elapsedSeconds += deltaSeconds;
    if (isFreeDrive) {
      state.maxForwardDistance += state.velocity.length() * deltaSeconds;
      raceState.playerPlace = 1;
      updateFreeDriveChallenges(deltaSeconds);
      return;
    }

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

  function updateFreeDriveRallyChallenge(deltaSeconds) {
    if (!freeDriveRallyChallenge) return;
    const challengeState = freeDriveRallyChallenge.update({
      x: state.position.x,
      z: state.position.y,
      heading: state.heading,
      deltaSeconds
    });
    updateFreeDriveRallyGhost(challengeState);
    return challengeState;
  }

  function updateFreeDriveShowcaseChallenge(deltaSeconds) {
    if (!freeDriveShowcaseChallenge) return;
    return freeDriveShowcaseChallenge.update({
      x: state.position.x,
      z: state.position.y,
      heading: state.heading,
      deltaSeconds
    });
  }

  function updateFreeDriveChallenges(deltaSeconds) {
    if (isShowcase) {
      updateShowcaseEvent(deltaSeconds);
      return;
    }
    if (activeFreeDriveChallenge === "showcase") {
      const challenge = updateFreeDriveShowcaseChallenge(deltaSeconds);
      if (challenge?.phase === "finished") {
        activeFreeDriveChallenge = null;
        displayedFreeDriveChallenge = "showcase";
      }
      return;
    }
    if (activeFreeDriveChallenge === "rally") {
      const challenge = updateFreeDriveRallyChallenge(deltaSeconds);
      if (challenge?.phase === "finished") {
        activeFreeDriveChallenge = null;
        displayedFreeDriveChallenge = "rally";
      }
      return;
    }

    const showcase = updateFreeDriveShowcaseChallenge(0);
    if (showcase?.phase === "running") {
      activeFreeDriveChallenge = "showcase";
      displayedFreeDriveChallenge = "showcase";
      return;
    }
    const rally = updateFreeDriveRallyChallenge(0);
    if (rally?.phase === "running") {
      activeFreeDriveChallenge = "rally";
      displayedFreeDriveChallenge = "rally";
    }
  }

  function startShowcaseCountdown() {
    if (!isShowcase || !freeDriveShowcaseChallenge) return false;
    freeDriveShowcaseChallenge.reset();
    activeFreeDriveChallenge = "showcase";
    displayedFreeDriveChallenge = "showcase";
    showcaseEvent.phase = "countdown";
    showcaseEvent.countdownSeconds = showcaseCountdownSeconds;
    showcaseEvent.bannerSeconds = 0;
    showcaseEvent.finishHoldSeconds = 0;
    showcaseEvent.startX = state.position.x;
    showcaseEvent.startZ = state.position.y;
    showcaseEvent.startHeading = state.heading;
    showcaseEvent.playerDistance = 0;
    showcaseEvent.playerPlace = 1;
    showcaseEvent.finalPlace = null;
    showcaseEvent.elapsedSeconds = 0;
    showcaseEvent.currentSection = "road";
    showcaseEvent.lastAnnouncedSection = null;
    showcaseEvent.announcedSections.clear();
    showcaseEvent.pendingSectionCue = null;
    resetShowcaseRecoveryState();
    resetFreeDriveTraffic();
    anchorShowcaseStartPose();
    showEventBanner({ value: String(showcaseCountdownSeconds), detail: "ISLAND TOUR" });
    return true;
  }

  function anchorShowcaseStartPose() {
    if (!physics?.playerBody) return;
    state.position.set(showcaseEvent.startX, showcaseEvent.startZ);
    state.previousPosition.copy(state.position);
    state.velocity.set(0, 0);
    state.heading = showcaseEvent.startHeading;
    state.throttle = 0;
    state.brake = 0;
    state.steering = 0;
    setPlayerBodyPose(state.position, state.heading);
  }

  function updateShowcaseEvent(deltaSeconds) {
    if (!freeDriveShowcaseChallenge) return;
    if (showcaseEvent.phase === "countdown") {
      showcaseEvent.countdownSeconds = Math.max(0, showcaseEvent.countdownSeconds - deltaSeconds);
      if (showcaseEvent.countdownSeconds > 0) {
        eventBannerValue.textContent = String(Math.ceil(showcaseEvent.countdownSeconds));
        return;
      }
      freeDriveShowcaseChallenge.start({
        x: state.position.x,
        z: state.position.y,
        heading: state.heading
      });
      showcaseEvent.phase = "running";
      showcaseEvent.bannerSeconds = showcaseGoBannerSeconds;
      showEventBanner({ value: "GO!", detail: "COAST · TUNNEL · RALLY", mode: "go" });
      return;
    }

    if (showcaseEvent.phase === "running") {
      showcaseEvent.elapsedSeconds += deltaSeconds;
      if (showcaseEvent.bannerSeconds > 0) {
        showcaseEvent.bannerSeconds = Math.max(0, showcaseEvent.bannerSeconds - deltaSeconds);
        if (showcaseEvent.bannerSeconds === 0) hideEventBanner();
      }
      updateShowcasePlayerProgress();
      updateShowcaseRecovery(deltaSeconds);
      const previousChallenge = freeDriveShowcaseChallenge.getState();
      const challenge = updateFreeDriveShowcaseChallenge(deltaSeconds);
      if (challenge?.nextCheckpoint > previousChallenge.nextCheckpoint) {
        announceShowcaseSectionProgress(challenge.nextCheckpoint);
      }
      if (showcaseEvent.bannerSeconds === 0 && showcaseEvent.pendingSectionCue) {
        showPendingShowcaseSectionCue();
      }
      if (challenge?.phase !== "finished") return;
      showcaseEvent.playerDistance = freeDriveShowcaseDrivingLine.at(-1)?.distance ?? showcaseEvent.playerDistance;
      updateShowcasePlace();
      showcaseEvent.finalPlace = showcaseEvent.playerPlace;
      showcaseEvent.phase = "settling";
      showcaseEvent.finishHoldSeconds = showcaseFinishHoldSeconds;
      showEventBanner({ value: "FINISH", detail: formatTime(challenge.elapsedSeconds), mode: "finish" });
      return;
    }

    if (showcaseEvent.phase === "settling") {
      showcaseEvent.elapsedSeconds += deltaSeconds;
      showcaseEvent.finishHoldSeconds = Math.max(0, showcaseEvent.finishHoldSeconds - deltaSeconds);
      if (showcaseEvent.finishHoldSeconds === 0) showShowcaseResult();
    }
  }

  function announceShowcaseSectionProgress(nextCheckpoint) {
    const enteredCheckpoint = freeDriveShowcaseCheckpoints[Math.max(0, nextCheckpoint - 1)];
    const next = freeDriveShowcaseCheckpoints[nextCheckpoint];
    if (enteredCheckpoint?.section === "tunnel" || enteredCheckpoint?.section === "rally") {
      showcaseEvent.currentSection = enteredCheckpoint.section;
      queueShowcaseSectionCue(enteredCheckpoint.section);
    } else if (enteredCheckpoint?.section === "road") {
      showcaseEvent.currentSection = "road";
    }
    if (nextCheckpoint === freeDriveShowcaseCheckpoints.length - 1 && next?.section === "finish") {
      queueShowcaseSectionCue("final");
    }
  }

  function queueShowcaseSectionCue(section) {
    if (showcaseEvent.announcedSections.has(section) || showcaseEvent.pendingSectionCue === section) return;
    showcaseEvent.pendingSectionCue = section;
    if (showcaseEvent.bannerSeconds === 0 && showcaseEvent.recoveryNoticeSeconds === 0) {
      showPendingShowcaseSectionCue();
    }
  }

  function showPendingShowcaseSectionCue() {
    const section = showcaseEvent.pendingSectionCue;
    if (!section || showcaseEvent.phase !== "running" || showcaseEvent.recoveryNoticeSeconds > 0) return;
    const labels = {
      tunnel: ["TUNNEL RUN", "LIGHTS ON · HOLD THE LINE"],
      rally: ["RALLY STAGE", "LOOSE SURFACE"],
      final: ["FINAL PUSH", "FINISH AHEAD"]
    };
    showcaseEvent.pendingSectionCue = null;
    showcaseEvent.announcedSections.add(section);
    showcaseEvent.lastAnnouncedSection = section;
    showcaseEvent.bannerSeconds = 1.2;
    showEventBanner({ value: labels[section][0], detail: labels[section][1], mode: "go" });
  }

  function resetShowcaseRecoveryState() {
    showcaseEvent.upsideDownSeconds = 0;
    showcaseEvent.offRouteSeconds = 0;
    showcaseEvent.recoveryCooldownSeconds = 0;
    showcaseEvent.recoveryNoticeSeconds = 0;
    showcaseEvent.recoveryCount = 0;
  }

  function updateShowcaseRecovery(deltaSeconds) {
    if (!physics?.playerBody || showcaseEvent.phase !== "running") return;
    showcaseEvent.recoveryCooldownSeconds = Math.max(0, showcaseEvent.recoveryCooldownSeconds - deltaSeconds);
    showcaseEvent.recoveryNoticeSeconds = Math.max(0, showcaseEvent.recoveryNoticeSeconds - deltaSeconds);
    if (physics.playerBody.translation().y < -12) {
      recoverShowcasePlayer();
      return;
    }

    const grounded = playerSurfaceState.grounded && !freeDriveJumpState.airborne;
    const rotation = physics.playerBody.rotation();
    tempQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    const upright = new THREE.Vector3(0, 1, 0).applyQuaternion(tempQuaternion).y;
    const support = upright < 0.45 ? resolveSurfaceSupport(state.position, state.heading, state.trackIndex) : null;
    const body = physics.playerBody.translation();
    const nearGround = support?.grounded
      && body.y - support.height < playerVehicleSpec().spawnHeight + 1.6
      && Math.abs(physics.playerBody.linvel().y) < 2;
    showcaseEvent.upsideDownSeconds = upright < 0.45 && (grounded || nearGround)
      ? showcaseEvent.upsideDownSeconds + deltaSeconds : 0;
    const nearestDistance = freeDriveShowcaseDrivingLine.reduce((nearest, sample) =>
      Math.min(nearest, Math.hypot(sample.x - state.position.x, sample.z - state.position.y)), Infinity);
    showcaseEvent.offRouteSeconds = grounded && nearestDistance > 35
      ? showcaseEvent.offRouteSeconds + deltaSeconds : 0;
    if (showcaseEvent.recoveryCooldownSeconds <= 0
      && (showcaseEvent.upsideDownSeconds >= 2 || showcaseEvent.offRouteSeconds >= 3)) recoverShowcasePlayer();
  }

  function recoverShowcasePlayer() {
    if (showcaseEvent.phase !== "running" || showcaseEvent.recoveryCooldownSeconds > 0) return false;
    const challenge = freeDriveShowcaseChallenge.getState();
    const checkpointIndex = Math.max(0, Math.min(challenge.nextCheckpoint - 1, freeDriveShowcaseCheckpoints.length - 1));
    const checkpoint = freeDriveShowcaseCheckpoints[checkpointIndex];
    presentationState.suppressJumpTransitions = true;
    const placed = checkpoint && placeWorldScenario(checkpoint.x, checkpoint.z, checkpoint.heading);
    presentationState.suppressJumpTransitions = false;
    if (!placed) return false;
    freeDriveShowcaseChallenge.addPenalty(showcaseRecoveryPenaltySeconds);
    showcaseEvent.playerDistance = freeDriveShowcaseCheckpointDistances[checkpointIndex] ?? 0;
    updateShowcasePlace();
    showcaseEvent.upsideDownSeconds = 0;
    showcaseEvent.offRouteSeconds = 0;
    showcaseEvent.recoveryCooldownSeconds = 2;
    showcaseEvent.recoveryNoticeSeconds = 2.2;
    showcaseEvent.recoveryCount += 1;
    updateRouteGuide();
    return true;
  }

  function updateShowcasePlayerProgress() {
    let nearest = null;
    let nearestDistance = Infinity;
    const minimum = Math.max(0, showcaseEvent.playerDistance - 18);
    const maximum = showcaseEvent.playerDistance + 90;
    for (const sample of freeDriveShowcaseDrivingLine) {
      if (sample.distance < minimum || sample.distance > maximum) continue;
      const distance = Math.hypot(sample.x - state.position.x, sample.z - state.position.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = sample;
      }
    }
    if (nearest && nearestDistance < 24) showcaseEvent.playerDistance = Math.max(showcaseEvent.playerDistance, nearest.distance);
    updateShowcasePlace();
  }

  function updateShowcasePlace() {
    showcaseEvent.playerPlace = 1 + freeDriveTraffic.filter((traffic) =>
      traffic.finishTimeSeconds != null || traffic.eventDistance > showcaseEvent.playerDistance + 0.5
    ).length;
    raceState.playerPlace = showcaseEvent.playerPlace;
  }

  function showEventBanner({ value, detail, mode = "countdown" }) {
    eventBannerKicker.textContent = "COASTAL FESTIVAL";
    eventBannerValue.textContent = value;
    eventBannerDetail.textContent = detail;
    eventBanner.classList.toggle("is-go", mode === "go");
    eventBanner.classList.toggle("is-finish", mode === "finish");
    eventBanner.hidden = false;
  }

  function hideEventBanner() {
    eventBanner.hidden = true;
    eventBanner.classList.remove("is-go", "is-finish");
  }

  function updateFreeDriveRallyGhost(challengeState) {
    if (!freeDriveRallyGhost) return;
    const samples = challengeState.bestGhost;
    const pose = challengeState.phase === "running" && samples.length >= 2
      ? sampleGhostPose(samples, challengeState.elapsedSeconds)
      : null;
    freeDriveRallyGhost.visible = Boolean(pose);
    if (!pose) return;
    const routeSample = nearestRallyRouteSample(pose.x, pose.z);
    freeDriveRallyGhost.position.set(
      pose.x,
      (routeSample?.y ?? 0) + 0.12,
      pose.z
    );
    freeDriveRallyGhost.rotation.y = pose.heading;
  }

  function formatRallyChallengeDebugState() {
    return {
      ...formatChallengeDebugState(freeDriveRallyChallenge),
      ghostVisible: Boolean(freeDriveRallyGhost?.visible)
    };
  }

  function formatChallengeDebugState(challengeRuntime) {
    const challenge = challengeRuntime.getState();
    return {
      phase: challenge.phase,
      elapsedSeconds: Number(challenge.elapsedSeconds.toFixed(2)),
      nextCheckpoint: challenge.nextCheckpoint,
      checkpointCount: challenge.checkpointCount,
      bestTimeSeconds: challenge.bestTimeSeconds === null
        ? null
        : Number(challenge.bestTimeSeconds.toFixed(2)),
      ghostSampleCount: challenge.bestGhost.length,
      newBest: challenge.newBest
    };
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
    sessionControls?.transition("finishing");
    raceState.winner = winner;
    raceState.playerPlace = winner === "player" ? 1 : 2;
    raceState.settleSeconds = 0;
    state.boostSeconds = 0;
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
    keyState.clear();
    physics?.playerBody?.setLinvel({ x: 0, y: 0, z: 0 }, true);
    physics?.playerBody?.setAngvel({ x: 0, y: 0, z: 0 }, true);
    showResultOverlay(winner);
    updateHud();
  }

  function updateCarTransform(deltaSeconds = 0) {
    if (!physics?.playerBody) return;
    const translation = physics.playerBody.translation();
    const rotation = physics.playerBody.rotation();
    tempQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    const chassisUp = new THREE.Vector3(0, 1, 0).applyQuaternion(tempQuaternion);
    car.position
      .set(translation.x, translation.y, translation.z)
      .addScaledVector(chassisUp, -playerVehicleSpec().visualGroundOffset);
    car.quaternion.copy(tempQuaternion);
    playerVisualElevation = car.position.y;

    const visualRoot = car.userData.visualRoot;
    if (visualRoot) {
      visualRoot.rotation.set(0, 0, 0);
      visualRoot.position.y = racingSceneConfig.groundOffset ?? 0;
    }

    wheelSpinAngle = advanceWheelSpin({
      spinAngle: wheelSpinAngle,
      signedSpeed: physics.playerVehicle?.speed ?? 0,
      deltaSeconds,
      wheelRadius: playerVehicleSpec().wheelRadius
    });
    animateWheelVisuals(
      car,
      wheelSpinAngle,
      physics?.playerVehicle?.steeringAngle ?? 0
    );
  }

  function animateWheelVisuals(targetCar, spinAngle, steeringAngle = 0) {
    if (!targetCar) return;
    const motion = createWheelAnimationState({ spinAngle, steeringAngle });
    targetCar.userData.wheelAnimationState = motion;

    for (const binding of targetCar.userData.wheelShaderBindings ?? []) {
      binding.spin.value = motion.spinAngle;
      binding.steering.value = motion.steeringAngle;
    }

    const wheelNodes = targetCar.userData.wheelNodes;
    if (!wheelNodes?.length) return;
    const rollingRotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      motion.spinAngle
    );
    const steeringRotation = new THREE.Quaternion();
    for (const { node, baseQuaternion, front = false } of wheelNodes) {
      steeringRotation.setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        front ? motion.steeringAngle : 0
      );
      node.quaternion.copy(steeringRotation).multiply(baseQuaternion).multiply(rollingRotation);
    }
  }

  function configureModelWheelAnimation(model, visualRoot, carSpec) {
    const bindings = [];
    const logicalCenters = new Set();
    const frontDirection = Math.cos(THREE.MathUtils.degToRad(carSpec?.modelRotationDegrees || 0)) >= 0 ? 1 : -1;
    visualRoot.updateMatrixWorld(true);

    model.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.geometry?.attributes?.position || !mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const label = materials.map((material) => materialLabelFor(mesh, material)).join(" ");
      if (!isWheelVisualLabel(label)) return;

      const positionAttribute = mesh.geometry.attributes.position;
      const layout = findWheelGeometryLayout(positionAttribute.array, positionAttribute.itemSize);
      if (!layout) return;
      const localCenters = layout.centers.map(({ x, y, z }) => new THREE.Vector3(x, y, z));
      const carSpaceCenters = localCenters.map((center) => {
        const worldCenter = center.clone().applyMatrix4(mesh.matrixWorld);
        return visualRoot.worldToLocal(worldCenter);
      });
      for (const center of carSpaceCenters) {
        logicalCenters.add(`${Math.round(center.x * 10)}:${Math.round(center.z * 10)}`);
      }

      const singleIsFront = !layout.combined && (carSpaceCenters[0]?.z ?? 0) >= 0;
      for (const material of materials) {
        bindings.push(installWheelMaterialAnimation(material, layout, localCenters, {
          frontDirection,
          singleIsFront
        }));
      }
    });

    return {
      bindings,
      logicalWheelCount: Math.min(4, logicalCenters.size)
    };
  }

  function installWheelMaterialAnimation(material, layout, centers, { frontDirection, singleIsFront }) {
    const spin = { value: 0 };
    const steering = { value: 0 };
    const originalCompile = material.onBeforeCompile;
    const wheelUniforms = layout.combined
      ? {
          uWheelCenters: { value: centers },
          uWheelSplit: { value: new THREE.Vector2(layout.splitX, layout.splitZ) },
          uWheelFrontDirection: { value: frontDirection }
        }
      : {
          uWheelCenter: { value: centers[0] },
          uWheelIsFront: { value: singleIsFront ? 1 : 0 }
        };
    const declarations = layout.combined
      ? `
uniform vec3 uWheelCenters[4];
uniform vec2 uWheelSplit;
uniform float uWheelFrontDirection;
vec3 wheelCenterFor(vec3 point) {
  if (point.z >= uWheelSplit.y) {
    return point.x >= uWheelSplit.x ? uWheelCenters[1] : uWheelCenters[0];
  }
  return point.x >= uWheelSplit.x ? uWheelCenters[3] : uWheelCenters[2];
}
float wheelFrontFor(vec3 point) {
  return ((point.z - uWheelSplit.y) * uWheelFrontDirection >= 0.0) ? 1.0 : 0.0;
}`
      : `
uniform vec3 uWheelCenter;
uniform float uWheelIsFront;
vec3 wheelCenterFor(vec3 point) { return uWheelCenter; }
float wheelFrontFor(vec3 point) { return uWheelIsFront; }
`;
    material.onBeforeCompile = (shader, renderer) => {
      originalCompile?.(shader, renderer);
      shader.uniforms.uWheelSpin = spin;
      shader.uniforms.uWheelSteering = steering;
      Object.assign(shader.uniforms, wheelUniforms);
      shader.vertexShader = `
uniform float uWheelSpin;
uniform float uWheelSteering;
${declarations}
vec3 rotateWheelX(vec3 value, float angle) {
  float cosine = cos(angle);
  float sine = sin(angle);
  return vec3(value.x, cosine * value.y - sine * value.z, sine * value.y + cosine * value.z);
}
vec3 rotateWheelY(vec3 value, float angle) {
  float cosine = cos(angle);
  float sine = sin(angle);
  return vec3(cosine * value.x + sine * value.z, value.y, -sine * value.x + cosine * value.z);
}
${shader.vertexShader}`
        .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>
  objectNormal = rotateWheelX(objectNormal, uWheelSpin);
  objectNormal = rotateWheelY(objectNormal, uWheelSteering * wheelFrontFor(position));`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>
  vec3 wheelCenter = wheelCenterFor(position);
  vec3 wheelOffset = rotateWheelX(transformed - wheelCenter, uWheelSpin);
  transformed = wheelCenter + rotateWheelY(wheelOffset, uWheelSteering * wheelFrontFor(position));`);
    };
    material.customProgramCacheKey = () => `racing-wheel-${layout.combined ? "combined" : "single"}-${singleIsFront ? "front" : "rear"}`;
    material.needsUpdate = true;
    return { spin, steering };
  }

  function updateOpponentTransform() {
    opponentCar.visible = raceState.opponentEnabled;
    if (!raceState.opponentEnabled) {
      return;
    }

    const support = resolveSurfaceSupport(
      opponentState.position,
      opponentState.heading,
      Math.round(opponentState.progress * trackConfig.samples)
    );
    opponentCar.position.set(
      opponentState.position.x,
      support.height ?? 0,
      opponentState.position.y
    );
    opponentCar.rotation.set(0, opponentState.heading, 0);

    const visualRoot = opponentCar.userData.visualRoot;
    if (visualRoot) {
      visualRoot.rotation.x = support.pitch - Math.abs(opponentState.collisionYawOffset) * 0.08;
      visualRoot.rotation.z = support.roll - opponentState.collisionYawOffset * 0.55;
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

    const playerBodyHeight = physics?.playerBody?.translation().y ?? physicsConfig.fixedHeight;
    collisionDebug.playerWire.position.set(state.position.x, playerBodyHeight, state.position.y);
    if (physics?.playerBody) {
      const rotation = physics.playerBody.rotation();
      collisionDebug.playerWire.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }

    collisionDebug.opponentWire.visible = raceState.opponentEnabled;
    if (raceState.opponentEnabled) {
      collisionDebug.opponentWire.position.set(
        opponentState.position.x,
        physics?.opponentBody?.translation().y ?? playerBodyHeight,
        opponentState.position.y
      );
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
    const physicalVehicleLines = [
      "PHYSICAL VEHICLE",
      `wheel contact ${physics?.playerVehicle?.contactCount ?? 0}/4`,
      `suspension ${(physics?.playerVehicle?.suspensionLengths ?? [])
        .map((length) => length.toFixed(2))
        .join(" / ")}`,
      `steer ${THREE.MathUtils.radToDeg(
        physics?.playerVehicle?.steeringAngle ?? 0
      ).toFixed(1)} deg`
    ];
    const drivetrain = physics?.playerVehicle?.drivetrain;
    const tires = physics?.playerVehicle?.tireDynamics;
    const telemetry = racingTelemetry.snapshot();
    const benchmark = telemetry.benchmark;
    const telemetryLines = [
      "PERFORMANCE",
      `fps ${telemetry.live.averageFps.toFixed(1)}  1% ${telemetry.live.onePercentLowFps.toFixed(1)}`,
      `cpu ${telemetry.live.averageCpuMs.toFixed(2)} ms  physics p95 ${telemetry.live.p95PhysicsMs.toFixed(2)} ms`,
      `render p95 ${telemetry.live.p95RenderMs.toFixed(2)} ms  calls ${telemetry.live.maximumRenderCalls}`,
      benchmark.status === "running"
        ? `benchmark ${benchmark.label} ${(benchmark.progress * 100).toFixed(0)}%`
        : benchmark.status === "completed"
          ? `benchmark ${benchmark.label} ${benchmark.averageFps.toFixed(1)} fps / 1% ${benchmark.onePercentLowFps.toFixed(1)}`
          : "benchmark idle"
    ];
    const provingGround = provingGroundRunner.snapshot();
    const provingGroundLines = [
      "PROVING GROUND",
      provingGround.status === "idle"
        ? "test idle"
        : provingGround.status === "running"
          ? `${provingGround.testId} ${provingGround.phase} ${provingGround.elapsedSeconds.toFixed(2)} s`
          : `${provingGround.testId} completed`,
      provingGround.status === "completed"
        ? Object.entries(provingGround)
            .filter(([key]) => !["testId", "status", "drivetrainTrace"].includes(key))
            .map(([key, value]) => `${key}=${value}`)
            .join("  ")
        : ""
    ];
    const dynamicsLines = [
      "DRIVETRAIN / TIRES",
      `gear ${drivetrain?.gear ?? "--"}  rpm ${Math.round(drivetrain?.engineRpm ?? 0)}`,
      `grip ${(tires?.grip ?? 0).toFixed(2)}  max slip ${(tires?.maximumSlip ?? 0).toFixed(3)}`,
      `wheel slip ${(tires?.wheels ?? []).map((wheel) => wheel.combinedSlip.toFixed(2)).join(" / ") || "--"}`,
      `wheel load ${(tires?.wheels ?? []).map((wheel) => Math.round(wheel.normalLoad)).join(" / ") || "--"} N`,
      `brake pressure ${(tires?.wheels ?? []).map((wheel) => wheel.brakeScale.toFixed(2)).join(" / ") || "--"}`,
      `ABS ${tires?.absActive ? "ON" : "off"}  TCS ${tires?.tractionControlActive ? "ON" : "off"}`
    ];
    const vehicleSpec = playerVehicleSpec();
    const playerHalfWidth = vehicleSpec.chassisHalfWidth;
    const playerHalfHeight = vehicleSpec.chassisHalfHeight;
    const playerHalfLength = vehicleSpec.chassisHalfLength;

    hud.textContent = [
      "Physics Telemetry  [F2]",
      ...physicalVehicleLines,
      ...dynamicsLines,
      ...telemetryLines,
      ...provingGroundLines,
      `onRoad ${state.onRoad ? "yes" : "no"}  paused ${raceState.paused ? "yes" : "no"}`,
      `surface ${playerSurfaceState.surfaceId ?? "none"}  contacts ${playerSurfaceState.contacts.length}/4`,
      `height ${playerSurfaceState.height.toFixed(2)}  pitch ${THREE.MathUtils.radToDeg(playerSurfaceState.pitch).toFixed(1)}  roll ${THREE.MathUtils.radToDeg(playerSurfaceState.roll).toFixed(1)}`,
      `speed ${(state.velocity.length() * 3.6).toFixed(0)} km/h`,
      `heading ${headingDegrees.toFixed(1)} deg`,
      `velocity ${velocityHeading === null ? "--" : velocityHeading.toFixed(1)} deg`,
      `player box ${(playerHalfWidth * 2).toFixed(2)} x ${(playerHalfHeight * 2).toFixed(2)} x ${(playerHalfLength * 2).toFixed(2)}`,
      ...lastCollisionLines
    ].join("\n");
    updateCollisionDebugVisibility();
  }

  function updateCamera(deltaSeconds) {
    boostCameraKick = Math.max(0, boostCameraKick - deltaSeconds * 1.85);
    presentationState.jumpFovPulse = Math.max(0, presentationState.jumpFovPulse - deltaSeconds * 2.7);
    presentationState.jumpLiftPulse = Math.max(0, presentationState.jumpLiftPulse - deltaSeconds * 2.2);
    presentationState.landingKick = Math.max(0, presentationState.landingKick - deltaSeconds * 5.2);
    if (cameraMode === RACING_CAMERA_MODES.HOOD) {
      updateHoodCamera(deltaSeconds);
      return;
    }

    updateChaseCamera(deltaSeconds);
  }

  function updateChaseCamera(deltaSeconds) {
    const speedRatio = clamp(state.velocity.length() / Math.max(playerMaxForwardSpeed(), 0.0001), 0, 1);
    const dynamicLookAhead = cameraConfig.lookAhead + cameraConfig.speedLookAheadBoost * speedRatio;
    const headingFollow = 1 - Math.exp(-deltaSeconds * cameraConfig.headingFollowTightness);
    cameraHeading = normalizeAngle(
      cameraHeading + shortestAngleDelta(cameraHeading, state.heading) * headingFollow
    );
    const forward = new THREE.Vector3(Math.sin(cameraHeading), 0, Math.cos(cameraHeading));
    const right = new THREE.Vector3(Math.cos(cameraHeading), 0, -Math.sin(cameraHeading));
    const elevation = playerVisualElevation;
    const target = new THREE.Vector3(state.position.x, cameraConfig.targetHeight + elevation, state.position.y)
      .addScaledVector(forward, dynamicLookAhead)
      .addScaledVector(right, state.steering * speedRatio * 0.3);
    const desired = new THREE.Vector3(state.position.x, elevation, state.position.y)
      .addScaledVector(forward, -cameraConfig.followDistance)
      .addScaledVector(forward, -boostCameraKick * 0.9)
      .addScaledVector(right, -state.steering * speedRatio * 0.42)
      .add(new THREE.Vector3(0, cameraConfig.height + presentationState.jumpLiftPulse * 0.34
        - presentationState.landingKick * 0.18 + Math.sin(wheelSpinAngle * 0.16) * speedRatio * 0.035, 0));

    const follow = 1 - Math.exp(-deltaSeconds * cameraConfig.followTightness);
    camera.position.lerp(desired, follow);
    const targetFov = cameraConfig.fov + cameraConfig.speedFovBoost * speedRatio + boostCameraKick * 6
      + presentationState.jumpFovPulse * 2.4 + presentationState.landingKick * 1.2;
    const fovFollow = 1 - Math.exp(-deltaSeconds * cameraConfig.speedFovResponse);
    camera.fov += (targetFov - camera.fov) * fovFollow;
    if (camera.near !== 0.1) camera.near = 0.1;
    camera.updateProjectionMatrix();
    camera.lookAt(target);
  }

  function updateHoodCamera(deltaSeconds) {
    const metrics = car?.userData.cameraMetrics;
    const hoodConfig = metrics
      ? {
          position: [0, Math.max(metrics.height * .78, 1.45), metrics.length * .43],
          lookAhead: Math.max(15, metrics.length * 1.4),
          fov: 70
        }
      : fallbackHoodCameraConfig;
    const [localX, localY, localZ] = hoodConfig.position;
    const forward = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
    const right = new THREE.Vector3(Math.cos(state.heading), 0, -Math.sin(state.heading));
    const speedRatio = clamp(state.velocity.length() / Math.max(playerMaxForwardSpeed(), 0.0001), 0, 1);
    const desired = new THREE.Vector3(state.position.x, playerVisualElevation, state.position.y)
      .addScaledVector(right, localX)
      .addScaledVector(forward, localZ)
      .add(new THREE.Vector3(0, localY + presentationState.jumpLiftPulse * 0.16
        - presentationState.landingKick * 0.1 + Math.sin(wheelSpinAngle * 0.18) * speedRatio * 0.018, 0));
    camera.position.copy(desired);

    const targetFov = hoodConfig.fov + speedRatio * 2.5 + boostCameraKick * 4
      + presentationState.jumpFovPulse * 1.6 + presentationState.landingKick * 0.8;
    const fovFollow = 1 - Math.exp(-deltaSeconds * 8);
    camera.fov += (targetFov - camera.fov) * fovFollow;
    camera.near = 0.03;
    camera.updateProjectionMatrix();
    camera.lookAt(
      desired.clone()
        .addScaledVector(forward, hoodConfig.lookAhead)
        .add(new THREE.Vector3(0, 0.12, 0))
    );
  }

  function toggleCameraMode() {
    cameraMode = cameraMode === RACING_CAMERA_MODES.CHASE
      ? RACING_CAMERA_MODES.HOOD
      : RACING_CAMERA_MODES.CHASE;
    saveActiveRacingStartConfig({ playerCarId: selectedCarId, cameraMode });
    if (camera) {
      camera.fov = cameraMode === RACING_CAMERA_MODES.HOOD
        ? fallbackHoodCameraConfig.fov
        : cameraConfig.fov;
    }
    updateHud();
    return cameraMode;
  }

  function updateHud() {
    updateRouteGuide();
    const rallyChallenge = freeDriveRallyChallenge?.getState();
    const showcaseChallenge = freeDriveShowcaseChallenge?.getState();
    const visibleChallenge = activeFreeDriveChallenge ?? displayedFreeDriveChallenge;
    if (isShowcase && showcaseEvent.phase === "countdown") {
      progressLabel.textContent = "ISLAND TOUR";
      progressValue.textContent = "STARTING";
      placeValue.textContent = `${Math.ceil(showcaseEvent.countdownSeconds)} · READY`;
    } else if (isFreeDrive && visibleChallenge === "showcase" && showcaseChallenge?.phase === "running") {
      progressLabel.textContent = "ISLAND TOUR";
      progressValue.textContent = `${showcaseChallenge.elapsedSeconds.toFixed(2)} S`;
      placeValue.textContent = `POS ${showcaseEvent.playerPlace} / 4 · GATE ${Math.min(showcaseChallenge.nextCheckpoint, showcaseChallenge.checkpointCount - 1)} / ${showcaseChallenge.checkpointCount - 1}`;
    } else if (isFreeDrive && visibleChallenge === "rally" && rallyChallenge?.phase === "running") {
      progressLabel.textContent = "RALLY";
      progressValue.textContent = `${rallyChallenge.elapsedSeconds.toFixed(2)} S`;
      placeValue.textContent = `CP ${Math.min(rallyChallenge.nextCheckpoint, rallyChallenge.checkpointCount - 1)} / ${rallyChallenge.checkpointCount - 1}`;
    } else if (isFreeDrive && visibleChallenge === "rally" && rallyChallenge?.phase === "finished") {
      progressLabel.textContent = rallyChallenge.newBest ? "NEW BEST" : "RALLY";
      progressValue.textContent = `${rallyChallenge.elapsedSeconds.toFixed(2)} S`;
      placeValue.textContent = rallyChallenge.bestTimeSeconds === null
        ? "FREE"
        : `BEST ${rallyChallenge.bestTimeSeconds.toFixed(2)}`;
    } else if (isFreeDrive && visibleChallenge === "showcase" && showcaseChallenge?.phase === "finished") {
      progressLabel.textContent = showcaseChallenge.newBest ? "TOUR BEST" : "ISLAND TOUR";
      progressValue.textContent = `${showcaseChallenge.elapsedSeconds.toFixed(2)} S`;
      placeValue.textContent = showcaseChallenge.bestTimeSeconds === null
        ? "FREE"
        : `BEST ${showcaseChallenge.bestTimeSeconds.toFixed(2)}`;
    } else {
      progressLabel.textContent = isFreeDrive ? "ROAM" : raceConfig.mode === "lap" ? "LAP" : "LEFT";
      progressValue.textContent = isFreeDrive
        ? `${Math.round(state.maxForwardDistance)} M`
        : raceConfig.mode === "lap"
        ? formatLapDisplay(state.completedLaps)
        : formatDistanceHud(sprintRemainingDistance(state));
      placeValue.textContent = isFreeDrive ? "FREE" : `${raceState.playerPlace} / ${raceState.opponentEnabled ? 2 : 1}`;
    }
    speedValue.textContent = `${Math.round(state.velocity.length() * 3.6)}`;
    boostValue.textContent = state.boostSeconds > 0
      ? `${state.boostSeconds.toFixed(1)}S`
      : boostConfig.unlimited ? "∞" : `x${state.boostCharges}`;
    cameraValue.textContent = cameraMode === RACING_CAMERA_MODES.CHASE
      ? "跟车"
      : "引擎盖";
  }

  function updateRouteGuide() {
    const visible = isShowcase
      && (showcaseEvent.phase === "countdown" || showcaseEvent.phase === "running")
      && freeDriveShowcaseCheckpoints.length > 1;
    routeGuide.hidden = !visible;
    if (!visible) return;
    const challenge = freeDriveShowcaseChallenge?.getState();
    const index = Math.min(challenge?.nextCheckpoint ?? 1, freeDriveShowcaseCheckpoints.length - 1);
    const checkpoint = freeDriveShowcaseCheckpoints[index];
    const bearing = Math.atan2(checkpoint.x - state.position.x, checkpoint.z - state.position.y) - state.heading;
    routeArrow.style.setProperty("--route-bearing", `${THREE.MathUtils.radToDeg(bearing)}deg`);
    routeDistance.textContent = `${Math.round(Math.hypot(checkpoint.x - state.position.x, checkpoint.z - state.position.y))} M`;
    routeSection.textContent = index === freeDriveShowcaseCheckpoints.length - 1
      ? "FINISH" : (checkpoint.section ?? "road").toUpperCase();
    routeNotice.hidden = showcaseEvent.recoveryNoticeSeconds <= 0;
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
    hideEventBanner();
    resetShowcasePresentation();
    pauseOverlay.hidden = true;
    collisionDebug.lastCollision = null;
    physicsAccumulator = 0;
    provingGroundRunner.reset();
    freeDriveRallyChallenge?.reset();
    freeDriveShowcaseChallenge?.reset();
    activeFreeDriveChallenge = null;
    displayedFreeDriveChallenge = null;

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
    state.trackProgress = raceMode === "lap" || isFreeDrive ? raceConfig.startProgress : 0;
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
    playerVisualElevation = 0;

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
    opponentState.boostSeconds = 0;
    opponentState.boostCharges = opponentBoostConfig.charges;

    raceState.finished = false;
    raceState.resultVisible = false;
    raceState.winner = "";
    raceState.playerPlace = 1;
    raceState.paused = false;
    raceState.elapsedSeconds = 0;
    raceState.settleSeconds = 0;

    syncPlayerTrackMetrics();
    syncOpponentPose();
    resetFreeDriveTraffic();
    setPlayerBodyPose(startPosition, start.heading);
    playerVisualElevation = playerSurfaceState.height;
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

      if (cameraMode === RACING_CAMERA_MODES.HOOD) {
        updateHoodCamera(1);
      } else {
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
    }

    if (isShowcase) startShowcaseCountdown();
    updateHud();
  }

  function restartShowcaseEvent() {
    if (!isShowcase) return false;
    lockedResult = null;
    sessionControls?.transition("running");
    resetRace();
    return true;
  }

  function resetShowcasePresentation() {
    presentationState.environment = "road";
    presentationState.exposure = presentationState.baselineExposure;
    presentationState.jumpFovPulse = 0;
    presentationState.jumpLiftPulse = 0;
    presentationState.landingKick = 0;
    presentationState.lastLandingImpactSpeed = 0;
    presentationState.landingArmed = false;
    presentationState.maximumAirborneDownwardSpeed = 0;
    presentationState.suppressJumpTransitions = false;
    freeDriveJumpState.wasGrounded = true;
    if (renderer) renderer.toneMappingExposure = presentationState.baselineExposure;
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
    const playerPlace = winner === "player" ? 1 : 2;
    lockedResult ??= createRacingResult({
      snapshot: activeSnapshot,
      winner,
      playerPlace,
      elapsedSeconds: raceState.elapsedSeconds,
      details: {
        mode: raceConfig.mode,
        playerFinishTimeSeconds: state.finishTimeSeconds,
        opponentFinishTimeSeconds: opponentState.finishTimeSeconds
      }
    });
    sessionControls?.transition("cinematic", { result: lockedResult });
    resultTag.textContent = "FINAL POSITION";
    resultTitle.textContent = playerPlace === 1 ? "冠军" : "第 2 名";
    finishPlaceNumber.textContent = String(playerPlace);
    finishPlaceSuffix.textContent = playerPlace === 1 ? "ST" : "ND";
    finishTrack.textContent = `${mapData.name} · ${raceConfig.mode === "lap" ? "闭环赛" : "冲刺赛"}`;

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

    hudOverlay.hidden = true;
    resultOverlay.hidden = false;
    void finishCinematic.start({ carConfig: selectedCar(), result: lockedResult });
  }

  function showShowcaseResult() {
    if (showcaseEvent.phase === "result") return;
    const challenge = freeDriveShowcaseChallenge.getState();
    showcaseEvent.phase = "result";
    hideEventBanner();
    raceState.finished = true;
    raceState.resultVisible = true;
    resetShowcasePresentation();
    const playerPlace = showcaseEvent.finalPlace ?? showcaseEvent.playerPlace;
    const winner = playerPlace === 1 ? "player" : "opponent";
    raceState.winner = winner;
    resultCard.classList.toggle("is-win", winner === "player");
    resultCard.classList.toggle("is-loss", winner !== "player");
    lockedResult = createRacingResult({
      snapshot: activeSnapshot,
      winner,
      playerPlace,
      elapsedSeconds: challenge.elapsedSeconds,
      details: {
        mode: "coastal-showcase",
        checkpointCount: challenge.checkpointCount,
        newBest: challenge.newBest,
        bestTimeSeconds: challenge.bestTimeSeconds
      }
    });
    sessionControls?.transition("cinematic", { result: lockedResult });
    resultTag.textContent = challenge.newBest ? "NEW FESTIVAL RECORD" : "FESTIVAL SHOWCASE";
    resultTitle.textContent = playerPlace === 1 ? "ISLAND TOUR 冠军" : `ISLAND TOUR 第 ${playerPlace} 名`;
    finishPlaceNumber.textContent = String(playerPlace);
    finishPlaceSuffix.textContent = ["TH", "ST", "ND", "RD", "TH"][playerPlace];
    finishTrack.textContent = `${mapData.name} · ISLAND TOUR`;
    resultSummary.textContent = challenge.newBest
      ? "海岸公路、隧道和拉力赛段全部完成，新的最快纪录已经保存。"
      : "海岸公路、隧道和拉力赛段全部完成。再跑一次，挑战你的最佳成绩。";
    resultPlayerLabel.textContent = "本次成绩";
    resultPlayerValue.textContent = formatTime(challenge.elapsedSeconds);
    resultOpponentLabel.textContent = "FINAL POSITION";
    resultOpponentValue.textContent = `${playerPlace} / 4`;
    playAgainButton.textContent = "再次挑战";
    hudOverlay.hidden = true;
    resultOverlay.hidden = false;
    void finishCinematic.start({ carConfig: selectedCar(), result: lockedResult });
  }

  function hideResultOverlay() {
    finishCinematic.stop();
    resultOverlay.hidden = true;
    hudOverlay.hidden = false;
    resultCard.classList.remove("is-win", "is-loss");
    playAgainButton.textContent = "再跑一场";
    raceState.resultVisible = false;
  }

  function activateBoost() {
    if (isShowcase && showcaseEvent.phase !== "running") {
      return false;
    }
    if (raceState.finished || state.stoppedByImpactSeconds > 0) {
      return false;
    }

    if (state.boostSeconds > 0 || (!boostConfig.unlimited && state.boostCharges <= 0)) {
      return false;
    }

    if (!boostConfig.unlimited) state.boostCharges -= 1;
    state.boostSeconds = boostConfig.durationSeconds;
    boostCameraKick = 1;
    return true;
  }

  function toggleOpponent() {
    if (isShowcase) return false;
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
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, qualityPreset.maxPixelRatio));
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

    input.start();
    window.addEventListener("resize", resizeRenderer);
    selectedCarPreviewCanvas.addEventListener("pointerdown", handleSelectedCarPreviewPointerDown);
    selectedCarPreviewCanvas.addEventListener("pointermove", handleSelectedCarPreviewPointerMove);
    selectedCarPreviewCanvas.addEventListener("pointerup", handleSelectedCarPreviewPointerUp);
    selectedCarPreviewCanvas.addEventListener("pointercancel", handleSelectedCarPreviewPointerUp);
    listening = true;
  }

  function removeListeners() {
    if (!listening) return;

    input.stop();
    window.removeEventListener("resize", resizeRenderer);
    selectedCarPreviewCanvas.removeEventListener("pointerdown", handleSelectedCarPreviewPointerDown);
    selectedCarPreviewCanvas.removeEventListener("pointermove", handleSelectedCarPreviewPointerMove);
    selectedCarPreviewCanvas.removeEventListener("pointerup", handleSelectedCarPreviewPointerUp);
    selectedCarPreviewCanvas.removeEventListener("pointercancel", handleSelectedCarPreviewPointerUp);
    listening = false;
  }

  function handleBlur() {
    keyState.clear();
    endSelectedCarPreviewDrag();
  }

  function handleVisibilityChange() {
    if (document.hidden && active && !isStartOverlayVisible() && !raceState.resultVisible) {
      setPaused(true);
    }
  }

  function handleSelectedCarPreviewPointerDown(event) {
    if (!isStartOverlayVisible() || !selectedCarPreviewCar) {
      return;
    }

    selectedCarPreviewPointerId = event.pointerId;
    selectedCarPreviewLastPointerX = event.clientX;
    selectedCarPreviewLastPointerTime = clock.now();
    selectedCarPreviewSpinVelocity = 0;
    selectedCarPanel.querySelector(".race-car-feature-stage")?.classList.add("is-dragging");
    selectedCarPreviewCanvas.setPointerCapture(event.pointerId);
  }

  function handleSelectedCarPreviewPointerMove(event) {
    if (event.pointerId !== selectedCarPreviewPointerId || !selectedCarPreviewCar) {
      return;
    }

    const now = clock.now();
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
    return trackRuntime.sample(progress);
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
    const projection = trackRuntime.project(position, preferredIndex);
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
    return playerVehicleSpec().topSpeedKmh / 3.6
      * (state.boostSeconds > 0 ? boostConfig.topSpeedMultiplier : 1);
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
    return min + random() * (max - min);
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

  function placeCollisionScenario(progress = 0.12, requestedLaneOffset = 0, progressGap = 0.0065) {
    const opponentProgress = wrapProgress(Number.isFinite(progress) ? progress : 0.12);
    const laneOffset = clamp(Number.isFinite(requestedLaneOffset) ? requestedLaneOffset : 0, -4.5, 4.5);
    const playerProgress = wrapProgress(opponentProgress + (Number.isFinite(progressGap) ? progressGap : 0.0065));
    const playerSample = trackProfileAtProgress(playerProgress);

    opponentState.progress = opponentProgress;
    opponentState.laneOffset = laneOffset;
    opponentState.collisionLaneOffset = 0;
    opponentState.collisionYawOffset = 0;
    opponentState.collisionHoldSeconds = 0;
    opponentState.boostSeconds = 0;
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

  function placeStuntJumpScenario(requestedDirection = 1) {
    if (!isIslandWorld || !physics?.playerBody) return false;
    const direction = requestedDirection < 0 ? -1 : 1;
    const x = direction > 0
      ? FREE_DRIVE_STUNT_JUMP.leftRampStartX - 4
      : FREE_DRIVE_STUNT_JUMP.rightRampEndX + 4;
    const position = new THREE.Vector2(x, FREE_DRIVE_STUNT_JUMP.centerY);
    const heading = direction > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
    state.position.copy(position);
    state.previousPosition.copy(position);
    state.heading = heading;
    cameraHeading = heading;
    state.steering = 0;
    state.throttle = 0;
    state.brake = 0;
    state.stoppedByImpactSeconds = 0;
    state.boostSeconds = 0;
    syncPlayerTrackMetrics();
    setPlayerBodyPose(position, heading);
    state.velocity.set(direction * 12, 0);
    physics.playerBody.setLinvel({ x: direction * 12, y: 0, z: 0 }, true);
    updateCarTransform();
    updateCamera(1);
    renderer.render(scene, camera);
    return true;
  }

  function placeTunnelScenario() {
    if (!isIslandWorld) return false;
    const progress = (FREE_DRIVE_TUNNEL.startProgress + FREE_DRIVE_TUNNEL.endProgress) * 0.5;
    const sample = trackProfileAtProgress(progress);
    return placeWorldScenario(sample.center.x, sample.center.y, sample.heading);
  }

  function placeRallyScenario() {
    if (!isFreeDrive || !freeDriveRallyRoute.length) return false;
    const sample = freeDriveRallyRoute[Math.floor(freeDriveRallyRoute.length * 0.42)];
    return placeWorldScenario(
      sample.x,
      sample.z,
      Math.atan2(sample.tangentX, sample.tangentZ)
    );
  }

  function placeTestScenario(scenarioId) {
    if (!testScenarios.some(({ id }) => id === scenarioId)) return false;
    if (scenarioId === "asphalt") return placeTrackScenario(0.03);
    if (scenarioId === "rally") return placeRallyScenario();
    if (scenarioId === "tunnel") return placeTunnelScenario();
    return placeStuntJumpScenario();
  }

  function provingGroundObservation() {
    const vehicle = physics?.playerVehicle;
    const drivetrain = vehicle?.drivetrain;
    const tireDynamics = vehicle?.tireDynamics;
    return {
      x: state.position.x,
      z: state.position.y,
      heading: state.heading,
      speedKmh: state.velocity.length() * 3.6,
      steeringAngle: vehicle?.steeringAngle ?? 0,
      maximumTireSlip: tireDynamics?.maximumSlip ?? 0,
      absActive: tireDynamics?.absActive ?? false,
      tractionControlActive: tireDynamics?.tractionControlActive ?? false,
      shiftCount: drivetrain?.shiftCount ?? 0,
      gear: drivetrain?.gear ?? 0,
      engineRpm: drivetrain?.engineRpm ?? 0,
      torqueRatio: drivetrain?.torqueRatio ?? 0,
      drivetrainScale: drivetrain?.driveScale ?? 0,
      tcsEngineScale: tireDynamics?.engineScale ?? 1,
      engineForcePerWheel: vehicle?.engineForce ?? 0,
      surfaceId: playerSurfaceState.surfaceId
    };
  }

  function startProvingGroundTest(testId) {
    if (!isProvingGround || !physics?.playerBody) return false;
    const test = PROVING_GROUND_TESTS.find(({ id }) => id === testId);
    if (!test) return false;
    provingGroundRunner.reset();
    if (!placeWorldScenario(test.setup.x, test.setup.z, test.setup.heading)) return false;
    return provingGroundRunner.start(testId, provingGroundObservation());
  }

  function startRallyChallengeScenario() {
    if (!isFreeDrive || !freeDriveRallyChallenge || !freeDriveRallyCheckpoints.length) return false;
    freeDriveRallyChallenge.reset();
    activeFreeDriveChallenge = null;
    displayedFreeDriveChallenge = "rally";
    const checkpoint = freeDriveRallyCheckpoints[0];
    if (!placeWorldScenario(checkpoint.x, checkpoint.z, checkpoint.heading)) return false;
    const challenge = updateFreeDriveRallyChallenge(0);
    if (challenge?.phase === "running") activeFreeDriveChallenge = "rally";
    updateHud();
    renderer.render(scene, camera);
    return true;
  }

  function completeRallyChallengeScenario() {
    if (!isFreeDrive || !freeDriveRallyChallenge || freeDriveRallyCheckpoints.length < 2) return false;
    if (freeDriveRallyChallenge.getState().phase !== "running" && !startRallyChallengeScenario()) return false;
    for (const checkpoint of freeDriveRallyCheckpoints.slice(1)) {
      placeWorldScenario(checkpoint.x, checkpoint.z, checkpoint.heading);
      updateFreeDriveRallyChallenge(1.25);
    }
    updateHud();
    renderer.render(scene, camera);
    return freeDriveRallyChallenge.getState().phase === "finished";
  }

  function completeShowcaseEventScenario() {
    if (!isShowcase || showcaseEvent.phase !== "running" || freeDriveShowcaseCheckpoints.length < 2) return false;
    for (const checkpoint of freeDriveShowcaseCheckpoints.slice(1)) {
      showcaseEvent.bannerSeconds = 0;
      hideEventBanner();
      if (showcaseEvent.pendingSectionCue) showPendingShowcaseSectionCue();
      placeWorldScenario(checkpoint.x, checkpoint.z, checkpoint.heading);
      updateShowcaseEvent(1.25);
    }
    updateHud();
    renderer.render(scene, camera);
    return showcaseEvent.phase === "settling";
  }

  function advanceShowcaseCheckpointScenario() {
    if (!isShowcase || showcaseEvent.phase !== "running") return false;
    const challenge = freeDriveShowcaseChallenge.getState();
    const checkpoint = freeDriveShowcaseCheckpoints[challenge.nextCheckpoint];
    if (!checkpoint) return false;
    if (!placeWorldScenario(checkpoint.x, checkpoint.z, checkpoint.heading)) return false;
    updateShowcaseEvent(0.05);
    updateShowcaseAtmosphere(0.25);
    updateHud();
    renderer.render(scene, camera);
    return freeDriveShowcaseChallenge.getState().nextCheckpoint > challenge.nextCheckpoint;
  }

  function recoverShowcaseScenario() {
    if (!isShowcase || showcaseEvent.phase !== "running" || !physics?.playerBody) return false;
    const translation = physics.playerBody.translation();
    physics.playerBody.setTranslation({ x: translation.x, y: -13, z: translation.z }, true);
    updateShowcaseRecovery(0.016);
    updateHud();
    renderer.render(scene, camera);
    return showcaseEvent.recoveryCount > 0;
  }

  function rollShowcaseScenario() {
    if (!isShowcase || showcaseEvent.phase !== "running" || !physics?.playerBody) return false;
    const yaw = new THREE.Quaternion().setFromAxisAngle(upAxis, state.heading);
    const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
    const rotation = yaw.multiply(roll);
    physics.playerBody.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }, true);
    physics.playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    physics.playerBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    return true;
  }

  function placeTrackScenario(requestedProgress = 0) {
    if (!physics?.playerBody) return false;
    const progress = Number(requestedProgress);
    if (!Number.isFinite(progress)) return false;
    const sample = trackProfileAtProgress(wrapProgress(progress));
    return placeWorldScenario(sample.center.x, sample.center.y, sample.heading);
  }

  function placeWorldScenario(requestedX, requestedZ, requestedHeading = 0) {
    if (!isFreeDrive || !physics?.playerBody) return false;
    const x = Number(requestedX);
    const z = Number(requestedZ);
    const heading = Number(requestedHeading);
    if (![x, z, heading].every(Number.isFinite)) return false;

    const position = new THREE.Vector2(x, z);
    state.position.copy(position);
    state.previousPosition.copy(position);
    state.velocity.set(0, 0);
    state.heading = heading;
    cameraHeading = heading;
    state.steering = 0;
    state.throttle = 0;
    state.brake = 0;
    state.stoppedByImpactSeconds = 0;
    state.boostSeconds = 0;
    syncPlayerTrackMetrics();
    setPlayerBodyPose(position, heading);
    syncPlayerPhysicsState(state.trackIndex);
    updateCarTransform();
    updateCamera(1);
    updateCollisionDebugVisuals();
    updateCollisionDebugHud();
    renderer.render(scene, camera);
    return true;
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

function resolveRacingQualityPreset() {
  const presets = {
    low: {
      id: "low",
      maxPixelRatio: 1,
      shadowMapSize: 1024,
      shadows: false,
      environmentDensity: 0.48,
      particleCount: 36
    },
    balanced: {
      id: "balanced",
      maxPixelRatio: 1.5,
      shadowMapSize: 1536,
      shadows: true,
      environmentDensity: 0.76,
      particleCount: 60
    },
    high: {
      id: "high",
      maxPixelRatio: 2,
      shadowMapSize: 2048,
      shadows: true,
      environmentDensity: 1,
      particleCount: 84
    }
  };
  const requested = new URLSearchParams(window.location.search).get("quality")?.toLowerCase();
  if (requested && presets[requested]) return presets[requested];

  const memory = Number(navigator.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 4);
  if ((memory > 0 && memory <= 4) || cores <= 4) return presets.low;
  if ((memory > 0 && memory >= 8) && cores >= 8) return presets.high;
  return presets.balanced;
}

export function createGame(context) {
  return createRacingGame({
    initialSnapshot: context.payload,
    onHome: context.home,
    onEditMap: () => context.open("racing-editor"),
    onReplaceSession: context.replaceSelf
  });
}
