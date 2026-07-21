export const RACING_ENGINE_AUDIO = Object.freeze({
  idleRpm: 900,
  maximumRpm: 7800,
  ignitionPulsesPerRevolution: 2
});

/** Default race BGM — Hot Roadway (MintoDog), CC0. See assets/racing/music/CREDITS.md */
export const RACING_BGM = Object.freeze({
  id: "hot-roadway",
  url: "./assets/racing/music/hot-roadway-bpm160.ogg",
  /** Keep well below engine/nitro so SFX stay readable (M2). */
  playingGain: 0.065,
  duckedGain: 0.01
});

const NITRO_AUDIO_STORAGE_KEY = "ack-games:racing-nitro-audio:v1";

export const RACING_NITRO_AUDIO_PRESETS = Object.freeze([
  Object.freeze({ id: "current", label: "经典氮气 (Current)" }),
  Object.freeze({ id: "jet-whoosh", label: "喷气呼啸 (Jet Whoosh)" }),
  Object.freeze({ id: "deep-rumble", label: "深沉轰鸣 (Deep Rumble)" }),
  Object.freeze({ id: "clean-electric", label: "纯净电流 (Clean Electric)" })
]);

export const DEFAULT_NITRO_AUDIO_PRESET_ID = "jet-whoosh";

const NITRO_AUDIO_PRESET_IDS = RACING_NITRO_AUDIO_PRESETS.map((preset) => preset.id);

// Only boost-related synthesis parameters vary per preset. Engine/tire/environment
// bus behavior is untouched, and these values are only heard while boost is active.
const NITRO_AUDIO_PRESET_PARAMS = Object.freeze({
  current: Object.freeze({
    boostGainAmount: 0.13,
    boostFrequencyBase: 72,
    boostFrequencyScale: 68,
    boostFilterType: "bandpass",
    boostFilterFrequencyBase: 760,
    boostFilterFrequencyScale: 980,
    boostFilterQ: 0.62,
    boostOscillatorType: "sawtooth"
  }),
  "jet-whoosh": Object.freeze({
    boostGainAmount: 0.15,
    boostFrequencyBase: 220,
    boostFrequencyScale: 140,
    boostFilterType: "highpass",
    boostFilterFrequencyBase: 1400,
    boostFilterFrequencyScale: 1600,
    boostFilterQ: 0.3,
    boostOscillatorType: "sine"
  }),
  "deep-rumble": Object.freeze({
    boostGainAmount: 0.17,
    boostFrequencyBase: 45,
    boostFrequencyScale: 30,
    boostFilterType: "lowpass",
    boostFilterFrequencyBase: 220,
    boostFilterFrequencyScale: 260,
    boostFilterQ: 1.4,
    boostOscillatorType: "triangle"
  }),
  "clean-electric": Object.freeze({
    boostGainAmount: 0.11,
    boostFrequencyBase: 300,
    boostFrequencyScale: 220,
    boostFilterType: "bandpass",
    boostFilterFrequencyBase: 1800,
    boostFilterFrequencyScale: 900,
    boostFilterQ: 4.5,
    boostOscillatorType: "square"
  })
});

export function normalizeNitroAudioPresetId(presetId) {
  return NITRO_AUDIO_PRESET_IDS.includes(presetId) ? presetId : DEFAULT_NITRO_AUDIO_PRESET_ID;
}

export function listNitroAudioPresets() {
  return RACING_NITRO_AUDIO_PRESETS.map(({ id, label }) => ({ id, label }));
}

function resolveNitroAudioPresetParams(presetId) {
  return NITRO_AUDIO_PRESET_PARAMS[normalizeNitroAudioPresetId(presetId)];
}

export function loadStoredNitroAudioPresetId() {
  if (typeof localStorage === "undefined") {
    return DEFAULT_NITRO_AUDIO_PRESET_ID;
  }
  try {
    return normalizeNitroAudioPresetId(localStorage.getItem(NITRO_AUDIO_STORAGE_KEY));
  } catch (error) {
    console.warn("Failed to load nitro audio preset from storage.", error);
    return DEFAULT_NITRO_AUDIO_PRESET_ID;
  }
}

export function saveStoredNitroAudioPresetId(presetId) {
  const normalized = normalizeNitroAudioPresetId(presetId);
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(NITRO_AUDIO_STORAGE_KEY, normalized);
    } catch (error) {
      console.warn("Failed to save nitro audio preset to storage.", error);
    }
  }
  return normalized;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function calculateRacingAudioState({
  signedSpeed = 0,
  throttle = 0,
  boostActive = false,
  enabled = true,
  maxForwardSpeed = 50,
  engineRpm = null,
  idleRpm = RACING_ENGINE_AUDIO.idleRpm,
  maximumRpm = RACING_ENGINE_AUDIO.maximumRpm,
  tireSlip = 0,
  environment = "road",
  nitroAudioPreset = DEFAULT_NITRO_AUDIO_PRESET_ID
} = {}) {
  const resolvedEnvironment = ["tunnel", "rally"].includes(environment) ? environment : "road";
  const resolvedNitroAudioPreset = normalizeNitroAudioPresetId(nitroAudioPreset);
  const nitroPresetParams = resolveNitroAudioPresetParams(resolvedNitroAudioPreset);
  const speedRatio = clamp(Math.abs(signedSpeed) / Math.max(maxForwardSpeed, 0.001), 0, 1);
  const throttleAmount = clamp(throttle, 0, 1);
  const rpmRatio = clamp(
    0.04 + speedRatio * 0.76 + throttleAmount * 0.18 + (boostActive ? 0.12 : 0),
    0,
    1
  );
  const rpm = Number.isFinite(engineRpm)
    ? clamp(engineRpm, idleRpm, maximumRpm)
    : RACING_ENGINE_AUDIO.idleRpm
      + (RACING_ENGINE_AUDIO.maximumRpm - RACING_ENGINE_AUDIO.idleRpm) * rpmRatio;
  const resolvedRpmRatio = clamp((rpm - idleRpm) / Math.max(maximumRpm - idleRpm, 1), 0, 1);
  const ignitionFrequency = rpm / 60 * RACING_ENGINE_AUDIO.ignitionPulsesPerRevolution;

  return Object.freeze({
    rpm: Math.round(rpm),
    rpmRatio: resolvedRpmRatio,
    ignitionFrequency,
    engineGain: enabled ? 0.045 + throttleAmount * 0.055 + speedRatio * 0.025 : 0,
    harmonicGain: enabled ? 0.018 + resolvedRpmRatio * 0.035 : 0,
    filterFrequency: 420 + resolvedRpmRatio * 2200,
    boostGain: enabled && boostActive ? nitroPresetParams.boostGainAmount : 0,
    boostFrequency: nitroPresetParams.boostFrequencyBase + resolvedRpmRatio * nitroPresetParams.boostFrequencyScale,
    boostFilterType: nitroPresetParams.boostFilterType,
    boostFilterFrequency: nitroPresetParams.boostFilterFrequencyBase + resolvedRpmRatio * nitroPresetParams.boostFilterFrequencyScale,
    boostFilterQ: nitroPresetParams.boostFilterQ,
    boostOscillatorType: nitroPresetParams.boostOscillatorType,
    boostActive: Boolean(enabled && boostActive),
    tireGain: enabled ? clamp((tireSlip - 0.08) * 0.18, 0, 0.12) : 0,
    environment: resolvedEnvironment,
    environmentGain: enabled ? (resolvedEnvironment === "tunnel" ? 0.88 : 1) : 0,
    environmentFilterFrequency: resolvedEnvironment === "tunnel" ? 1650 : resolvedEnvironment === "rally" ? 3100 : 5200,
    environmentResonance: resolvedEnvironment === "tunnel" ? 4.1 : 1.2,
    environmentNoiseGain: enabled && resolvedEnvironment === "rally" ? 0.014 : 0,
    enabled: Boolean(enabled),
    nitroAudioPreset: resolvedNitroAudioPreset
  });
}

export function createRacingAudioController({
  AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  random = Math.random,
  bgmUrl = RACING_BGM.url,
  bgmPlayingGain = RACING_BGM.playingGain,
  bgmDuckedGain = RACING_BGM.duckedGain,
  fetchImpl = globalThis.fetch?.bind(globalThis)
} = {}) {
  let context = null;
  let graph = null;
  let destroyed = false;
  let state = calculateRacingAudioState({ enabled: false });
  let bgmBuffer = null;
  let bgmSource = null;
  let bgmLoadPromise = null;
  let bgmDesired = Object.freeze({ playing: false, ducked: false });

  function createGraph() {
    if (graph || destroyed || !AudioContextConstructor) return graph;
    context = new AudioContextConstructor();

    const masterGain = context.createGain();
    masterGain.gain.value = 0.42;
    masterGain.connect(context.destination);

    const bgmGain = context.createGain();
    bgmGain.gain.value = 0;
    bgmGain.connect(masterGain);

    const environmentFilter = context.createBiquadFilter();
    environmentFilter.type = "lowpass";
    environmentFilter.frequency.value = 5200;
    const environmentGain = context.createGain();
    environmentGain.gain.value = 1;
    environmentFilter.connect(environmentGain);
    environmentGain.connect(masterGain);

    const engineFilter = context.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.Q.value = 2.2;
    engineFilter.connect(environmentFilter);

    const engineGain = context.createGain();
    engineGain.gain.value = 0;
    engineGain.connect(engineFilter);

    const harmonicGain = context.createGain();
    harmonicGain.gain.value = 0;
    harmonicGain.connect(engineFilter);

    const engineOscillator = context.createOscillator();
    engineOscillator.type = "sawtooth";
    engineOscillator.connect(engineGain);
    engineOscillator.start();

    const harmonicOscillator = context.createOscillator();
    harmonicOscillator.type = "triangle";
    harmonicOscillator.connect(harmonicGain);
    harmonicOscillator.start();

    const boostFilter = context.createBiquadFilter();
    boostFilter.type = "bandpass";
    boostFilter.frequency.value = 980;
    boostFilter.Q.value = 0.62;

    const boostGain = context.createGain();
    boostGain.gain.value = 0;
    boostGain.connect(environmentFilter);
    boostFilter.connect(boostGain);

    const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noise.length; index += 1) {
      noise[index] = random() * 2 - 1;
    }
    const boostNoise = context.createBufferSource();
    boostNoise.buffer = noiseBuffer;
    boostNoise.loop = true;
    boostNoise.connect(boostFilter);

    const tireFilter = context.createBiquadFilter();
    tireFilter.type = "bandpass";
    tireFilter.frequency.value = 1450;
    tireFilter.Q.value = 1.8;
    const tireGain = context.createGain();
    tireGain.gain.value = 0;
    boostNoise.connect(tireFilter);
    tireFilter.connect(tireGain);
    tireGain.connect(environmentFilter);

    const environmentNoiseGain = context.createGain();
    environmentNoiseGain.gain.value = 0;
    boostNoise.connect(environmentNoiseGain);
    environmentNoiseGain.connect(environmentFilter);
    boostNoise.start();

    const boostToneGain = context.createGain();
    boostToneGain.gain.value = 0.22;
    boostToneGain.connect(boostGain);
    const boostOscillator = context.createOscillator();
    boostOscillator.type = "sawtooth";
    boostOscillator.connect(boostToneGain);
    boostOscillator.start();

    graph = {
      masterGain,
      bgmGain,
      environmentFilter,
      environmentGain,
      environmentNoiseGain,
      engineFilter,
      engineGain,
      harmonicGain,
      engineOscillator,
      harmonicOscillator,
      boostFilter,
      boostGain,
      boostNoise,
      boostOscillator,
      tireFilter,
      tireGain
    };
    applyState();
    applyBgmGain();
    return graph;
  }

  function setTarget(parameter, value, responseSeconds = 0.045) {
    if (!context || !parameter) return;
    parameter.setTargetAtTime(value, context.currentTime, responseSeconds);
  }

  function applyBgmGain() {
    if (!graph?.bgmGain) return;
    const target = !bgmDesired.playing
      ? 0
      : (bgmDesired.ducked ? bgmDuckedGain : bgmPlayingGain);
    setTarget(graph.bgmGain.gain, target, bgmDesired.playing ? 0.12 : 0.08);
  }

  async function ensureBgmBuffer() {
    if (bgmBuffer || destroyed || !fetchImpl) return bgmBuffer;
    if (bgmLoadPromise) return bgmLoadPromise;
    bgmLoadPromise = (async () => {
      createGraph();
      if (!context) return null;
      const response = await fetchImpl(bgmUrl);
      if (!response.ok) throw new Error(`Failed to load racing BGM: ${response.status}`);
      const bytes = await response.arrayBuffer();
      bgmBuffer = await context.decodeAudioData(bytes.slice(0));
      return bgmBuffer;
    })().catch((error) => {
      console.warn("Racing BGM failed to load.", error);
      bgmLoadPromise = null;
      return null;
    });
    return bgmLoadPromise;
  }

  function stopBgmSource() {
    if (!bgmSource) return;
    try { bgmSource.stop(); } catch {}
    try { bgmSource.disconnect(); } catch {}
    bgmSource = null;
  }

  async function syncBgmPlayback() {
    if (destroyed) return;
    if (!bgmDesired.playing) {
      stopBgmSource();
      applyBgmGain();
      return;
    }
    createGraph();
    const buffer = await ensureBgmBuffer();
    if (!buffer || destroyed || !graph || !context) return;
    if (context.state === "suspended") await context.resume();
    if (!bgmSource) {
      bgmSource = context.createBufferSource();
      bgmSource.buffer = buffer;
      bgmSource.loop = true;
      bgmSource.connect(graph.bgmGain);
      bgmSource.start(0);
    }
    applyBgmGain();
  }

  function applyState() {
    if (!graph || !context) return;
    setTarget(graph.engineOscillator.frequency, state.ignitionFrequency);
    setTarget(graph.harmonicOscillator.frequency, state.ignitionFrequency * 2.03);
    setTarget(graph.engineFilter.frequency, state.filterFrequency, 0.08);
    setTarget(graph.engineGain.gain, state.engineGain);
    setTarget(graph.harmonicGain.gain, state.harmonicGain);
    setTarget(graph.boostGain.gain, state.boostGain, state.boostActive ? 0.025 : 0.09);
    setTarget(graph.boostOscillator.frequency, state.boostFrequency, 0.06);
    setTarget(graph.boostFilter.frequency, state.boostFilterFrequency, 0.08);
    setTarget(graph.boostFilter.Q, state.boostFilterQ, 0.08);
    if (graph.boostFilter.type !== state.boostFilterType) {
      graph.boostFilter.type = state.boostFilterType;
    }
    if (graph.boostOscillator.type !== state.boostOscillatorType) {
      graph.boostOscillator.type = state.boostOscillatorType;
    }
    setTarget(graph.tireGain.gain, state.tireGain, 0.035);
    setTarget(graph.environmentGain.gain, state.environmentGain, 0.16);
    setTarget(graph.environmentFilter.frequency, state.environmentFilterFrequency, 0.18);
    setTarget(graph.environmentFilter.Q, state.environmentResonance, 0.18);
    setTarget(graph.environmentNoiseGain.gain, state.environmentNoiseGain, 0.12);
  }

  return Object.freeze({
    async resume() {
      createGraph();
      if (context?.state === "suspended") await context.resume();
      return context?.state ?? "unavailable";
    },
    update(nextState) {
      state = calculateRacingAudioState(nextState);
      applyState();
      return state;
    },
    setMusic({ playing = false, ducked = false } = {}) {
      bgmDesired = Object.freeze({
        playing: Boolean(playing),
        ducked: Boolean(ducked)
      });
      void syncBgmPlayback();
      return bgmDesired;
    },
    async suspend() {
      if (context?.state === "running") await context.suspend();
    },
    getState() {
      return Object.freeze({
        ...state,
        contextState: context?.state ?? (AudioContextConstructor ? "not-started" : "unavailable"),
        music: Object.freeze({
          id: RACING_BGM.id,
          playing: bgmDesired.playing,
          ducked: bgmDesired.ducked,
          playingGain: bgmPlayingGain,
          duckedGain: bgmDuckedGain,
          sourceActive: Boolean(bgmSource)
        })
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopBgmSource();
      for (const source of [graph?.engineOscillator, graph?.harmonicOscillator, graph?.boostNoise, graph?.boostOscillator]) {
        try { source?.stop(); } catch {}
      }
      void context?.close();
      graph = null;
      context = null;
      bgmBuffer = null;
    }
  });
}
