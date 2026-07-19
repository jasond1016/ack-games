export const RACING_ENGINE_AUDIO = Object.freeze({
  idleRpm: 900,
  maximumRpm: 7800,
  ignitionPulsesPerRevolution: 2
});

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
  environment = "road"
} = {}) {
  const resolvedEnvironment = ["tunnel", "rally"].includes(environment) ? environment : "road";
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
    boostGain: enabled && boostActive ? 0.13 : 0,
    boostFrequency: 72 + resolvedRpmRatio * 68,
    boostActive: Boolean(enabled && boostActive),
    tireGain: enabled ? clamp((tireSlip - 0.08) * 0.18, 0, 0.12) : 0,
    environment: resolvedEnvironment,
    environmentGain: enabled ? (resolvedEnvironment === "tunnel" ? 0.88 : 1) : 0,
    environmentFilterFrequency: resolvedEnvironment === "tunnel" ? 1650 : resolvedEnvironment === "rally" ? 3100 : 5200,
    environmentResonance: resolvedEnvironment === "tunnel" ? 4.1 : 1.2,
    environmentNoiseGain: enabled && resolvedEnvironment === "rally" ? 0.014 : 0,
    enabled: Boolean(enabled)
  });
}

export function createRacingAudioController({
  AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  random = Math.random
} = {}) {
  let context = null;
  let graph = null;
  let destroyed = false;
  let state = calculateRacingAudioState({ enabled: false });

  function createGraph() {
    if (graph || destroyed || !AudioContextConstructor) return graph;
    context = new AudioContextConstructor();

    const masterGain = context.createGain();
    masterGain.gain.value = 0.42;
    masterGain.connect(context.destination);

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
    return graph;
  }

  function setTarget(parameter, value, responseSeconds = 0.045) {
    if (!context || !parameter) return;
    parameter.setTargetAtTime(value, context.currentTime, responseSeconds);
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
    setTarget(graph.boostFilter.frequency, 760 + state.rpmRatio * 980, 0.08);
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
    async suspend() {
      if (context?.state === "running") await context.suspend();
    },
    getState() {
      return Object.freeze({
        ...state,
        contextState: context?.state ?? (AudioContextConstructor ? "not-started" : "unavailable")
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const source of [graph?.engineOscillator, graph?.harmonicOscillator, graph?.boostNoise, graph?.boostOscillator]) {
        try { source?.stop(); } catch {}
      }
      void context?.close();
      graph = null;
      context = null;
    }
  });
}
