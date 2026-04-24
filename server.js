const path = require('path');
const os = require('os');
const express = require('express');
const http = require('http');
const { randomUUID, randomBytes, createHmac, timingSafeEqual } = require('crypto');
const { Server } = require('socket.io');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const PORT = process.env.PORT || 3000;
const STEP_COUNT = 16;
const STEP_COUNT_MIN = 1;
const STEP_COUNT_MAX = 128;
const DEFAULT_TEMPO = 120;
const SESSION_START_DELAY_MS = 2000;
const SYNC_INTERVAL_MS = 2000;
const TEMPO_MIN = 30;
const TEMPO_MAX = 300;
const ROOM_NAME_MAX_LENGTH = 64;
const ROOM_SLUG_MAX_LENGTH = 64;
const ROOM_ID_BYTES = 6; // 12 hex chars
const INVITE_TOKEN_TTL_SECONDS = 60 * 60;
const INVITE_TOKEN_HEADER = {
  alg: 'HS256',
  typ: 'JWT',
};
const INVITE_TOKEN_HEADER_SEGMENT = base64UrlEncode(Buffer.from(JSON.stringify(INVITE_TOKEN_HEADER)));

const SynthTypes = Object.freeze({
  TB303: 'tb-303',
  TR808: 'tr-808',
  SIMPLE: 'poly-synth',
  SAMPLER: 'sampler',
});

const SAMPLER_SLOT_IDS = ['A', 'B', 'C', 'D', 'E', 'F'];
const SAMPLER_MAX_SAMPLE_BYTES = 5 * 1024 * 1024;
const INSTRUMENT_NAME_MAX_LENGTH = 48;
const DISPLAY_NAME_MAX_LENGTH = 32;

const TR808_PARAM_SCHEMA = {
  master: {
    volume: { min: 0, max: 1 },
    accentLevel: { min: 0, max: 1 },
    swing: { min: 0, max: 1 },
    drive: { min: 0, max: 1 },
  },
  kick: {
    level: { min: 0, max: 1 },
    decay: { min: 0.1, max: 2 },
    tone: { min: 30, max: 100 },
    drive: { min: 0, max: 1 },
  },
  snare: {
    level: { min: 0, max: 1 },
    tone: { min: 0, max: 1 },
    snappy: { min: 0, max: 1 },
    decay: { min: 0.1, max: 1.5 },
  },
  hat: {
    level: { min: 0, max: 1 },
    decay: { min: 0.05, max: 1 },
    tone: { min: 0, max: 1 },
    tuning: { min: 0.8, max: 1.2 },
  },
  openhat: {
    level: { min: 0, max: 1 },
    decay: { min: 0.1, max: 2 },
    tone: { min: 0, max: 1 },
    tuning: { min: 0.8, max: 1.2 },
  },
  clap: {
    level: { min: 0, max: 1 },
    spread: { min: 0, max: 1 },
    reverb: { min: 0, max: 1 },
    decay: { min: 0.1, max: 1.5 },
  },
};

const TR808_LEGACY_PARAM_MAP = {
  volume: ['master', 'volume'],
  accentLevel: ['master', 'accentLevel'],
  swing: ['master', 'swing'],
  masterDrive: ['master', 'drive'],
  kickLevel: ['kick', 'level'],
  kickDecay: ['kick', 'decay'],
  kickTone: ['kick', 'tone'],
  kickDrive: ['kick', 'drive'],
  snareLevel: ['snare', 'level'],
  snareTone: ['snare', 'tone'],
  snareSnappy: ['snare', 'snappy'],
  snareDecay: ['snare', 'decay'],
  hatLevel: ['hat', 'level'],
  hatDecay: ['hat', 'decay'],
  hatTone: ['hat', 'tone'],
  hatTuning: ['hat', 'tuning'],
  tone: ['hat', 'tone'],
  openhatLevel: ['openhat', 'level'],
  openhatDecay: ['openhat', 'decay'],
  openhatTone: ['openhat', 'tone'],
  openhatTuning: ['openhat', 'tuning'],
  clapLevel: ['clap', 'level'],
  clapSpread: ['clap', 'spread'],
  clapReverb: ['clap', 'reverb'],
  clapDecay: ['clap', 'decay'],
};

function clampStepCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return STEP_COUNT;
  }
  return clamp(Math.round(numeric), STEP_COUNT_MIN, STEP_COUNT_MAX);
}

function computeStepDurationMs(bpm) {
  const numeric = Number(bpm);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return 60000 / (numeric * 4);
}

function normalizeWaveform(value) {
  if (typeof value === 'string' && value.toLowerCase() === 'saw') {
    return 'sawtooth';
  }
  return value;
}

function defaultInstrumentName(type) {
  switch (type) {
    case SynthTypes.TB303:
      return 'Acid Bass';
    case SynthTypes.TR808:
      return '808 Drums';
    case SynthTypes.SIMPLE:
      return 'Poly Synth';
    case SynthTypes.SAMPLER:
      return 'Sampler';
    default:
      return 'Instrument';
  }
}

function sanitizeInstrumentName(name, type) {
  const fallback = defaultInstrumentName(type);
  if (typeof name !== 'string') {
    return fallback;
  }
  const trimmed = name.trim();
  if (!trimmed.length) {
    return fallback;
  }
  return trimmed.slice(0, INSTRUMENT_NAME_MAX_LENGTH);
}

function sanitizeDisplayName(name) {
  if (typeof name !== 'string') {
    return '';
  }
  const trimmed = name.trim();
  if (!trimmed.length) {
    return '';
  }
  return trimmed.slice(0, DISPLAY_NAME_MAX_LENGTH);
}

function normalizeUserId(userId) {
  if (typeof userId !== 'string') {
    return null;
  }
  const trimmed = userId.trim();
  return trimmed.length ? trimmed : null;
}

function createDefaultParams(type) {
  switch (type) {
    case SynthTypes.TB303:
      return {
        volume: 0.8,
        cutoff: 0.5,
        resonance: 0.7,
        envelopeMod: 0.6,
        decay: 0.4,
        waveform: 'sawtooth',
      };
    case SynthTypes.TR808:
      return {
        master: {
          volume: 0.9,
          accentLevel: 0.6,
          swing: 0,
          drive: 0.15,
        },
        kick: {
          level: 0.9,
          decay: 0.8,
          tone: 60,
          drive: 0.2,
        },
        snare: {
          level: 0.7,
          snappy: 0.6,
          tone: 0.5,
          decay: 0.7,
        },
        hat: {
          level: 0.6,
          decay: 0.4,
          tone: 0.5,
          tuning: 1,
        },
        openhat: {
          level: 0.6,
          decay: 0.6,
          tone: 0.5,
          tuning: 1,
        },
        clap: {
          level: 0.6,
          spread: 0.4,
          reverb: 0.35,
          decay: 0.8,
        },
      };
    case SynthTypes.SAMPLER:
      return {
        slots: SAMPLER_SLOT_IDS.reduce((acc, slotId) => {
          acc[slotId] = createDefaultSamplerSlot(slotId);
          return acc;
        }, {}),
      };
    case SynthTypes.SIMPLE:
    default:
      return {
        volume: 0.8,
        attack: 0.05,
        decay: 0.3,
        release: 0.4,
        cutoff: 0.6,
        resonance: 0.3,
        waveform: 'sine',
      };
  }
}

function createDefaultSamplerSlot(slotId) {
  return {
    id: slotId,
    name: `Slot ${slotId}`,
    volume: 1,
    pan: 0,
    pitch: 0,
    startOffset: 0,
    endOffset: 1,
    reverse: false,
    mute: false,
    sample: null,
  };
}

function createStepTemplate(type) {
  if (type === SynthTypes.TR808) {
    return {
      active: false,
      layers: {
        kick: false,
        snare: false,
        hat: false,
        openhat: false,
        clap: false,
      },
    };
  }

  const defaultPitchByType = {
    [SynthTypes.TB303]: 'C2',
    [SynthTypes.SIMPLE]: 'C4',
  };

  if (type === SynthTypes.SAMPLER) {
    return {
      active: false,
      slots: SAMPLER_SLOT_IDS.reduce((acc, slotId) => {
        acc[slotId] = false;
        return acc;
      }, {}),
    };
  }

  return {
    active: false,
    pitch: defaultPitchByType[type] || 'C4',
    velocity: 1,
    accent: false,
    slide: false,
  };
}

function createInstrument(type, options = {}) {
  if (!Object.values(SynthTypes).includes(type)) {
    throw new Error('unsupported-instrument');
  }

  const initialStepCount = clampStepCount(options.stepCount ?? STEP_COUNT);
  const normalizedCreatorDisplayName = sanitizeDisplayName(options.creatorDisplayName || '');
  const normalizedCreatorUserId = normalizeUserId(options.creatorUserId);

  const instrument = {
    id: randomUUID(),
    type,
    name: sanitizeInstrumentName(options.name, type),
    createdAt: Date.now(),
    lockedBy: null,
    muted: false,
    params: createDefaultParams(type),
    stepCount: initialStepCount,
    steps: createStepSequence(type, initialStepCount),
    creatorUserId: normalizedCreatorUserId,
    creatorDisplayName: normalizedCreatorDisplayName || null,
  };

  if (type === SynthTypes.TR808) {
    instrument.params = deepCloneTR808Params(instrument.params);
  }
  if (type === SynthTypes.SAMPLER) {
    ensureSamplerParamStructure(instrument);
  }

  return instrument;
}

const VALID_LFO_WAVEFORMS = new Set(['sine', 'saw', 'square', 'sah']);
const VALID_LFO_DIVISIONS = new Set([0.125, 0.25, 0.5, 1, 2, 4, 8, 16]);
const VALID_LFO_STEPS = new Set([0, 2, 4, 8, 16, 32]);

function createLFOState() {
  return {
    id: randomUUID(),
    waveform: 'sine',
    shape: 0, steps: 0, jitter: 0, smooth: 0,
    division: 1, depth: 1, offset: 0, phase: 0,
    targets: [],
  };
}

function applyLFOParams(lfo, params) {
  if (typeof params.waveform === 'string' && VALID_LFO_WAVEFORMS.has(params.waveform)) {
    lfo.waveform = params.waveform;
  }
  if (typeof params.division === 'number' && VALID_LFO_DIVISIONS.has(params.division)) {
    lfo.division = params.division;
  }
  if (typeof params.steps === 'number' && VALID_LFO_STEPS.has(params.steps)) {
    lfo.steps = params.steps;
  }
  ['shape', 'jitter', 'smooth', 'depth', 'offset', 'phase'].forEach(key => {
    if (params[key] !== undefined) {
      const v = Number(params[key]);
      if (Number.isFinite(v)) lfo[key] = Math.max(-2, Math.min(2, v));
    }
  });
  if (Array.isArray(params.targets)) {
    lfo.targets = params.targets
      .filter(t => typeof t.instrumentId === 'string' && typeof t.paramKey === 'string'
                && Number.isFinite(t.paramMin) && Number.isFinite(t.paramMax))
      .slice(0, 32)
      .map(t => ({
        instrumentId: t.instrumentId,
        paramKey: String(t.paramKey).slice(0, 64),
        paramMin: Number(t.paramMin),
        paramMax: Number(t.paramMax),
        label: typeof t.label === 'string' ? t.label.slice(0, 64) : String(t.paramKey),
      }));
  }
}

function createStepSequence(type, length) {
  const targetLength = clampStepCount(length);
  return Array.from({ length: targetLength }, () => createStepTemplate(type));
}

function deepCloneTR808Params(params = {}) {
  const defaults = createDefaultParams(SynthTypes.TR808);
  const clone = {};
  for (const group of Object.keys(TR808_PARAM_SCHEMA)) {
    const sourceGroup = params[group] || defaults[group] || {};
    clone[group] = {};
    for (const [key, range] of Object.entries(TR808_PARAM_SCHEMA[group])) {
      const fallback = defaults[group]?.[key];
      const value = sourceGroup[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        clone[group][key] = clamp(value, range.min, range.max);
      } else {
        clone[group][key] = clamp(typeof fallback === 'number' ? fallback : (range.min + range.max) / 2, range.min, range.max);
      }
    }
  }
  applyTR808LegacyAliases(clone);
  return clone;
}

function deepCloneSamplerParams(params = {}) {
  const clone = { slots: {} };
  for (const slotId of SAMPLER_SLOT_IDS) {
    const source = params?.slots?.[slotId];
    if (source && typeof source === 'object') {
      clone.slots[slotId] = {
        id: slotId,
        name: typeof source.name === 'string' ? source.name : `Slot ${slotId}`,
        volume: typeof source.volume === 'number' ? source.volume : 1,
        pan: typeof source.pan === 'number' ? source.pan : 0,
        pitch: typeof source.pitch === 'number' ? source.pitch : 0,
        startOffset: typeof source.startOffset === 'number' ? source.startOffset : 0,
        endOffset: typeof source.endOffset === 'number' ? source.endOffset : 1,
        reverse: Boolean(source.reverse),
        mute: Boolean(source.mute),
        sample: source.sample && typeof source.sample === 'object'
          ? { ...source.sample }
          : null,
      };
    } else {
      clone.slots[slotId] = createDefaultSamplerSlot(slotId);
    }
  }
  return clone;
}

function cloneInstrument(instrument) {
  if (instrument.type === SynthTypes.TR808) {
    instrument.params = deepCloneTR808Params(instrument.params);
  }
  if (instrument.type === SynthTypes.SAMPLER) {
    ensureSamplerParamStructure(instrument);
  }
  if (
    instrument.params
    && typeof instrument.params === 'object'
    && Object.prototype.hasOwnProperty.call(instrument.params, 'waveform')
  ) {
    instrument.params.waveform = normalizeWaveform(instrument.params.waveform);
  }

  instrument.name = sanitizeInstrumentName(instrument.name, instrument.type);
  const normalizedLockOwner = typeof instrument.lockedBy === 'string' && instrument.lockedBy.trim().length
    ? instrument.lockedBy
    : null;
  if (instrument.lockedBy !== normalizedLockOwner) {
    instrument.lockedBy = normalizedLockOwner;
  }

  const normalizedStepCount = clampStepCount(instrument.stepCount ?? (Array.isArray(instrument.steps) ? instrument.steps.length : STEP_COUNT) ?? STEP_COUNT);
  instrument.stepCount = normalizedStepCount;

  const normalizedCreatorDisplayName = sanitizeDisplayName(instrument.creatorDisplayName || '');
  const normalizedCreatorUserId = normalizeUserId(instrument.creatorUserId);
  instrument.creatorDisplayName = normalizedCreatorDisplayName || null;
  instrument.creatorUserId = normalizedCreatorUserId;

  const base = {
    id: instrument.id,
    type: instrument.type,
    name: instrument.name,
    createdAt: instrument.createdAt,
    lockedBy: normalizedLockOwner,
    muted: Boolean(instrument.muted),
    params: instrument.params,
    stepCount: normalizedStepCount,
    creatorUserId: normalizedCreatorUserId,
    creatorDisplayName: normalizedCreatorDisplayName || null,
    steps: instrument.steps.map((step) => {
      const clonedStep = {
        ...step,
        layers: step.layers ? { ...step.layers } : undefined,
        slots: step.slots ? { ...step.slots } : undefined,
      };

      if (instrument.type === SynthTypes.TR808) {
        ensureDrumLayers(clonedStep);
      }

      if (instrument.type === SynthTypes.SAMPLER) {
        const normalizedSlots = {};
        for (const slotId of SAMPLER_SLOT_IDS) {
          normalizedSlots[slotId] = Boolean(clonedStep.slots && clonedStep.slots[slotId]);
        }
        clonedStep.slots = normalizedSlots;
        clonedStep.active = Object.values(normalizedSlots).some(Boolean);
      }

      return clonedStep;
    }),
  };

  if (instrument.type === SynthTypes.TR808) {
    base.params = deepCloneTR808Params(instrument.params);
  } else if (instrument.type === SynthTypes.SAMPLER) {
    base.params = deepCloneSamplerParams(instrument.params);
  } else {
    base.params = { ...instrument.params };
    if (
      base.params
      && typeof base.params === 'object'
      && Object.prototype.hasOwnProperty.call(base.params, 'waveform')
    ) {
      base.params.waveform = normalizeWaveform(base.params.waveform);
    }
  }

  return base;
}

function findInstrumentByIdentifier(room, identifier) {
  if (!room || !identifier) {
    return null;
  }

  let lookup = identifier;
  if (typeof lookup === 'object' && lookup !== null) {
    lookup = lookup.instrumentId || lookup.synthName || lookup.name || null;
  }

  if (typeof lookup !== 'string') {
    return null;
  }

  const trimmed = lookup.trim();
  if (!trimmed) {
    return null;
  }

  if (room.instruments.has(trimmed)) {
    return room.instruments.get(trimmed);
  }

  for (const instrument of room.instruments.values()) {
    if (instrument.name === trimmed) {
      return instrument;
    }
  }

  return null;
}

function isInstrumentLockedByOther(instrument, socketId) {
  if (!instrument || !instrument.lockedBy) {
    return false;
  }
  return instrument.lockedBy !== socketId;
}

function releaseInstrumentLocks(room, socketId) {
  if (!room || !socketId) {
    return [];
  }

  const released = [];
  for (const instrument of room.instruments.values()) {
    if (instrument.lockedBy === socketId) {
      instrument.lockedBy = null;
      released.push(instrument);
    }
  }
  return released;
}

function ensureInstrumentStepCapacity(instrument, stepCount) {
  if (!instrument) {
    return false;
  }

  const targetLength = clampStepCount(stepCount);
  const currentLength = Array.isArray(instrument.steps) ? instrument.steps.length : 0;
  if (!Array.isArray(instrument.steps)) {
    instrument.steps = [];
  }

  if (currentLength >= targetLength) {
    if (instrument.type === SynthTypes.SAMPLER) {
      for (let index = 0; index < instrument.steps.length; index += 1) {
        ensureSamplerStepSlots(instrument.steps[index]);
      }
    }
    return false;
  }

  let mutated = false;
  for (let index = currentLength; index < targetLength; index += 1) {
    instrument.steps.push(createStepTemplate(instrument.type));
    mutated = true;
  }
  if (instrument.type === SynthTypes.SAMPLER) {
    for (let index = 0; index < instrument.steps.length; index += 1) {
      ensureSamplerStepSlots(instrument.steps[index]);
    }
  }
  return mutated;
}

function cloneTransport(transport) {
  return {
    bpm: transport.bpm,
    playing: transport.playing,
    sessionStartTime: transport.sessionStartTime,
    lastScheduledStart: transport.lastScheduledStart,
  };
}

function updateRoomTempo(room, nextTempo) {
  if (!room || !room.transport) {
    return false;
  }

  const numericTempo = Number(nextTempo);
  if (!Number.isFinite(numericTempo)) {
    return false;
  }

  const clampedTempo = Math.round(clamp(numericTempo, TEMPO_MIN, TEMPO_MAX));
  const newStepDuration = computeStepDurationMs(clampedTempo);
  if (newStepDuration <= 0) {
    return false;
  }

  if (
    room.transport.playing
    && typeof room.transport.sessionStartTime === 'number'
    && Number.isFinite(room.transport.sessionStartTime)
  ) {
    const now = Date.now();
    const elapsed = now - room.transport.sessionStartTime;
    const oldStepDuration = computeStepDurationMs(room.transport.bpm || DEFAULT_TEMPO);
    if (elapsed > 0 && oldStepDuration > 0) {
      const stepProgress = elapsed / oldStepDuration;
      const newSessionStart = now - stepProgress * newStepDuration;
      room.transport.sessionStartTime = Math.round(newSessionStart);
      room.transport.lastScheduledStart = room.transport.sessionStartTime;
    }
  }

  room.transport.bpm = clampedTempo;
  return true;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function applyInstrumentParams(instrument, params = {}) {
  if (instrument.type === SynthTypes.TR808) {
    ensureTR808ParamStructure(instrument);
    const changed = applyTR808ParamUpdates(instrument.params, params);
    if (changed) {
      instrument.params = deepCloneTR808Params(instrument.params);
    }
    return;
  }

  if (instrument.type === SynthTypes.SAMPLER) {
    const changed = applySamplerParamUpdates(instrument, params);
    if (changed) {
      ensureSamplerParamStructure(instrument);
    }
    return;
  }

  if (!params || typeof params !== 'object') {
    return;
  }

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      instrument.params[key] = value;
    } else if (typeof value === 'string') {
      let nextValue = value;
      if (key === 'waveform') {
        nextValue = normalizeWaveform(value);
        if (!['sine', 'triangle', 'sawtooth', 'square'].includes(nextValue)) {
          continue;
        }
      }
      instrument.params[key] = nextValue;
    } else if (typeof value === 'boolean') {
      instrument.params[key] = value;
    }
  }
}

function ensureDrumLayers(step) {
  step.layers = step.layers || {};
  if (typeof step.layers.kick !== 'boolean') step.layers.kick = false;
  if (typeof step.layers.snare !== 'boolean') step.layers.snare = false;
  if (typeof step.layers.hat !== 'boolean') step.layers.hat = false;
  if (typeof step.layers.openhat !== 'boolean') step.layers.openhat = false;
  if (typeof step.layers.clap !== 'boolean') step.layers.clap = false;
  return step.layers;
}

function ensureSamplerStepSlots(step) {
  step.slots = step.slots || {};
  let hasActive = false;
  for (const slotId of SAMPLER_SLOT_IDS) {
    if (typeof step.slots[slotId] !== 'boolean') {
      step.slots[slotId] = false;
    }
    if (step.slots[slotId]) {
      hasActive = true;
    }
  }
  if (typeof step.active !== 'boolean' || step.active !== hasActive) {
    step.active = hasActive;
  }
  return step.slots;
}

function ensureTR808ParamStructure(instrument) {
  if (instrument.type !== SynthTypes.TR808) {
    return;
  }
  instrument.params = deepCloneTR808Params(instrument.params || {});
}

function ensureSamplerParamStructure(instrument) {
  if (instrument.type !== SynthTypes.SAMPLER) {
    return;
  }
  const nextParams = { slots: {} };
  const currentSlots = instrument.params && typeof instrument.params === 'object' ? instrument.params.slots || {} : {};
  for (const slotId of SAMPLER_SLOT_IDS) {
    const base = createDefaultSamplerSlot(slotId);
    const existing = currentSlots[slotId];
    nextParams.slots[slotId] = mergeSamplerSlot(base, existing, { allowExistingSample: true });
  }
  instrument.params = nextParams;
}

function applyTR808ParamUpdates(current, updates = {}) {
  if (!updates || typeof updates !== 'object') {
    return false;
  }

  let changed = false;

  for (const [groupKey, value] of Object.entries(updates)) {
    if (TR808_PARAM_SCHEMA[groupKey] && value && typeof value === 'object') {
      const groupSchema = TR808_PARAM_SCHEMA[groupKey];
      const targetGroup = current[groupKey];
      for (const [paramKey, paramValue] of Object.entries(value)) {
        if (!groupSchema[paramKey] || typeof paramValue !== 'number' || !Number.isFinite(paramValue)) {
          continue;
        }
        const { min, max } = groupSchema[paramKey];
        const clamped = clamp(paramValue, min, max);
        if (targetGroup[paramKey] !== clamped) {
          targetGroup[paramKey] = clamped;
          changed = true;
        }
      }
      continue;
    }

    const legacyTarget = TR808_LEGACY_PARAM_MAP[groupKey];
    if (legacyTarget && typeof value === 'number' && Number.isFinite(value)) {
      const [group, param] = legacyTarget;
      const schema = TR808_PARAM_SCHEMA[group]?.[param];
      if (!schema) {
        continue;
      }
      const clamped = clamp(value, schema.min, schema.max);
      if (current[group][param] !== clamped) {
        current[group][param] = clamped;
        changed = true;
      }
    }
  }

  return changed;
}

function applySamplerParamUpdates(instrument, updates = {}) {
  if (instrument.type !== SynthTypes.SAMPLER) {
    return false;
  }
  if (!updates || typeof updates !== 'object') {
    return false;
  }

  ensureSamplerParamStructure(instrument);
  const params = instrument.params;
  let changed = false;

  if (updates.slots && typeof updates.slots === 'object') {
    for (const [rawSlotId, slotPayload] of Object.entries(updates.slots)) {
      const slotId = normalizeSamplerSlotId(rawSlotId);
      if (!slotId) {
        continue;
      }
      const currentSlot = params.slots[slotId];
      const nextSlot = mergeSamplerSlot(currentSlot, slotPayload || {});
      if (!samplerSlotsEqual(currentSlot, nextSlot)) {
        params.slots[slotId] = nextSlot;
        changed = true;
      }
    }
  }

  return changed;
}

function applyTR808LegacyAliases(target) {
  target.volume = target.master.volume;
  target.accentLevel = target.master.accentLevel;
  target.swing = target.master.swing;
  target.masterDrive = target.master.drive;

  target.kickLevel = target.kick.level;
  target.kickDecay = target.kick.decay;
  target.kickTone = target.kick.tone;
  target.kickDrive = target.kick.drive;

  target.snareLevel = target.snare.level;
  target.snareTone = target.snare.tone;
  target.snareSnappy = target.snare.snappy;
  target.snareDecay = target.snare.decay;

  target.hatLevel = target.hat.level;
  target.hatDecay = target.hat.decay;
  target.hatTone = target.hat.tone;
  target.hatTuning = target.hat.tuning;
  target.tone = target.hat.tone;

  target.openhatLevel = target.openhat.level;
  target.openhatDecay = target.openhat.decay;
  target.openhatTone = target.openhat.tone;
  target.openhatTuning = target.openhat.tuning;

  target.clapLevel = target.clap.level;
  target.clapSpread = target.clap.spread;
  target.clapReverb = target.clap.reverb;
  target.clapDecay = target.clap.decay;
}

function normalizeSamplerSlotId(slotId) {
  if (typeof slotId !== 'string') {
    return null;
  }
  const normalized = slotId.trim().toUpperCase();
  return SAMPLER_SLOT_IDS.includes(normalized) ? normalized : null;
}

function mergeSamplerSlot(base, overrides = {}, options = {}) {
  const slot = {
    ...base,
    sample: base.sample ? { ...base.sample } : null,
  };

  if (!overrides || typeof overrides !== 'object') {
    return finalizeSamplerSlot(slot);
  }

  if (typeof overrides.name === 'string' && overrides.name.trim()) {
    slot.name = overrides.name.trim().slice(0, 64);
  }

  if (typeof overrides.volume === 'number' && Number.isFinite(overrides.volume)) {
    slot.volume = clamp(overrides.volume, 0, 1);
  }

  if (typeof overrides.pan === 'number' && Number.isFinite(overrides.pan)) {
    slot.pan = clamp(overrides.pan, -1, 1);
  }

  if (typeof overrides.pitch === 'number' && Number.isFinite(overrides.pitch)) {
    slot.pitch = clamp(overrides.pitch, -24, 24);
  }

  if (typeof overrides.startOffset === 'number' && Number.isFinite(overrides.startOffset)) {
    slot.startOffset = clamp(overrides.startOffset, 0, 0.99);
  }

  if (typeof overrides.endOffset === 'number' && Number.isFinite(overrides.endOffset)) {
    slot.endOffset = clamp(overrides.endOffset, 0.01, 1);
  }

  if (typeof overrides.reverse === 'boolean') {
    slot.reverse = overrides.reverse;
  }

  if (typeof overrides.mute === 'boolean') {
    slot.mute = overrides.mute;
  }

  if (Object.prototype.hasOwnProperty.call(overrides, 'sample')) {
    if (overrides.sample === null) {
      slot.sample = null;
    } else if (overrides.sample && typeof overrides.sample === 'object') {
      const sanitized = sanitizeSampleDescriptor(overrides.sample, { allowExisting: options.allowExistingSample === true });
      if (sanitized) {
        slot.sample = sanitized;
      }
    }
  }

  return finalizeSamplerSlot(slot);
}

function finalizeSamplerSlot(slot) {
  const normalizedStart = clamp(Number(slot.startOffset) || 0, 0, 0.99);
  let normalizedEnd = clamp(Number(slot.endOffset) || 1, 0.01, 1);
  if (normalizedEnd <= normalizedStart) {
    normalizedEnd = clamp(normalizedStart + 0.05, 0.06, 1);
  }
  slot.startOffset = clamp(normalizedStart, 0, Math.max(0, normalizedEnd - 0.01));
  slot.endOffset = clamp(normalizedEnd, slot.startOffset + 0.01, 1);
  slot.volume = clamp(Number(slot.volume) || 0, 0, 1);
  slot.pan = clamp(Number(slot.pan) || 0, -1, 1);
  slot.pitch = clamp(Number(slot.pitch) || 0, -24, 24);
  slot.reverse = Boolean(slot.reverse);
  slot.mute = Boolean(slot.mute);
  slot.id = slot.id || createDefaultSamplerSlot('A').id;
  return slot;
}

function sanitizeSampleDescriptor(descriptor, { allowExisting = false } = {}) {
  if (!descriptor || typeof descriptor !== 'object') {
    return null;
  }

  if (descriptor.clear === true) {
    return null;
  }

  const data = typeof descriptor.data === 'string' ? descriptor.data : null;
  if (!data || !data.length) {
    return null;
  }

  let bytesLength = Number(descriptor.bytesLength);
  if (!allowExisting || !Number.isFinite(bytesLength) || bytesLength <= 0) {
    try {
      const buffer = Buffer.from(data, 'base64');
      bytesLength = buffer.length;
    } catch (error) {
      return null;
    }
  }

  if (!Number.isFinite(bytesLength) || bytesLength <= 0 || bytesLength > SAMPLER_MAX_SAMPLE_BYTES) {
    return null;
  }

  const name = typeof descriptor.name === 'string' && descriptor.name.trim() ? descriptor.name.trim().slice(0, 120) : 'Sample';
  const mimeType = typeof descriptor.mimeType === 'string' && descriptor.mimeType.trim() ? descriptor.mimeType.trim().slice(0, 64) : 'audio/wav';
  const updatedAt = Number.isFinite(descriptor.updatedAt) ? descriptor.updatedAt : Date.now();

  return {
    name,
    mimeType,
    data,
    bytesLength,
    updatedAt,
  };
}

function samplerSlotsEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  if (
    a.name !== b.name
    || a.volume !== b.volume
    || a.pan !== b.pan
    || a.pitch !== b.pitch
    || a.startOffset !== b.startOffset
    || a.endOffset !== b.endOffset
    || a.reverse !== b.reverse
    || a.mute !== b.mute
  ) {
    return false;
  }

  const sampleA = a.sample;
  const sampleB = b.sample;
  if (!sampleA && !sampleB) {
    return true;
  }
  if (!sampleA || !sampleB) {
    return false;
  }
  return (
    sampleA.name === sampleB.name
    && sampleA.mimeType === sampleB.mimeType
    && sampleA.data === sampleB.data
    && sampleA.bytesLength === sampleB.bytesLength
    && sampleA.updatedAt === sampleB.updatedAt
  );
}

function applyStepChanges(step, changes = {}) {
  if (typeof changes.active === 'boolean') {
    step.active = changes.active;
  }

  if (changes.layers && typeof changes.layers === 'object') {
    const layers = ensureDrumLayers(step);
    for (const [drum, flag] of Object.entries(changes.layers)) {
      if (typeof flag === 'boolean') {
        layers[drum] = flag;
      }
    }
    step.active = Object.values(step.layers).some(Boolean);
  }

  if (changes.slots && typeof changes.slots === 'object') {
    const slots = ensureSamplerStepSlots(step);
    let mutated = false;
    for (const [slotId, flag] of Object.entries(changes.slots)) {
      const normalized = normalizeSamplerSlotId(slotId);
      if (!normalized || typeof flag !== 'boolean') {
        continue;
      }
      if (slots[normalized] !== flag) {
        slots[normalized] = flag;
        mutated = true;
      }
    }
    if (mutated) {
      step.active = Object.values(slots).some(Boolean);
    }
  }

  if (typeof changes.pitch === 'string') {
    step.pitch = changes.pitch;
  }

  if (typeof changes.velocity === 'number' && Number.isFinite(changes.velocity)) {
    step.velocity = clamp(changes.velocity, 0, 1);
  }

  if (typeof changes.accent === 'boolean') {
    step.accent = changes.accent;
  }

  if (typeof changes.slide === 'boolean') {
    step.slide = changes.slide;
  }
}

function getRoomForSocket(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) {
    return null;
  }

  return rooms.get(roomId) || null;
}

function serializeRoomState(room) {
  return {
    roomId: room.id,
    slug: room.slug,
    transport: cloneTransport(room.transport),
    instruments: room.instrumentOrder
      .map((instrumentId) => room.instruments.get(instrumentId))
      .filter(Boolean)
      .map(cloneInstrument),
    instrumentOrder: [...room.instrumentOrder],
    legacyPattern: [...room.legacyPattern],
    lfos: [...(room.lfos || [])],
  };
}

function broadcastTransportState(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  io.to(roomId).emit('transport:update', cloneTransport(room.transport));
  // Legacy event for existing clients.
  io.to(roomId).emit('tempo:update', room.transport.bpm);
}

function broadcastInstrumentState(roomId, instrumentId) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  const instrument = room.instruments.get(instrumentId);
  if (!instrument) {
    return;
  }

  io.to(roomId).emit('instrument:update', cloneInstrument(instrument));
}

function broadcastInstrumentRemoval(roomId, instrumentId) {
  io.to(roomId).emit('instrument:removed', { instrumentId });
}

function broadcastInstrumentOrder(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  io.to(roomId).emit('instrument:order', [...room.instrumentOrder]);
}

const rooms = new Map();
const slugToRoomId = new Map();
const roomEmptyTimers = new Map();
let lastPingId = 0;

const ROOM_EMPTY_TIMEOUT_MS = 60 * 60 * 1000; // 1 óra

function scheduleRoomCleanup(roomId) {
  clearRoomCleanup(roomId);
  const timer = setTimeout(() => {
    const room = rooms.get(roomId);
    if (room && room.members.size === 0) {
      rooms.delete(roomId);
      if (room.slug) slugToRoomId.delete(room.slug);
    }
    roomEmptyTimers.delete(roomId);
  }, ROOM_EMPTY_TIMEOUT_MS);
  roomEmptyTimers.set(roomId, timer);
}

function clearRoomCleanup(roomId) {
  const existing = roomEmptyTimers.get(roomId);
  if (existing) {
    clearTimeout(existing);
    roomEmptyTimers.delete(roomId);
  }
}

const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/r/:slug', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server);

// Rate limiters: points = max calls, duration = time window in seconds
const rateLimiters = {
  roomCreate:      new RateLimiterMemory({ points: 5,   duration: 60 }),
  joinWithInvite:  new RateLimiterMemory({ points: 10,  duration: 60 }),
  instrumentAdd:   new RateLimiterMemory({ points: 10,  duration: 60 }),
  instrumentParam: new RateLimiterMemory({ points: 300, duration: 60 }),
  instrumentStep:  new RateLimiterMemory({ points: 300, duration: 60 }),
  tempoSet:        new RateLimiterMemory({ points: 300, duration: 60 }),
  lfoAdd:          new RateLimiterMemory({ points: 20,  duration: 60 }),
  lfoUpdate:       new RateLimiterMemory({ points: 300, duration: 60 }),
};

async function checkRateLimit(limiter, key, socket, callback) {
  try {
    await limiter.consume(key);
    return true;
  } catch {
    if (typeof callback === 'function') {
      callback({ ok: false, error: 'rate-limited' });
    } else {
      socket.emit('error', { error: 'rate-limited' });
    }
    return false;
  }
}

io.on('connection', (socket) => {
  socket.on('room:create', async ({ roomName, displayName } = {}, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    if (!await checkRateLimit(rateLimiters.roomCreate, socket.handshake.address, socket, respond)) return;
    const sanitizedName = sanitizeRoomName(roomName);
    if (!sanitizedName) {
      respond({ ok: false, error: 'invalid-room-name' });
      return;
    }

    const slug = generateRoomSlug(sanitizedName);
    const room = createRoomState({
      roomName: sanitizedName,
      roomSlug: slug,
      creatorUserId: socket.id,
      creatorDisplayName: sanitizeDisplayName(displayName),
      ownerUserId: socket.id,
    });

    try {
      await joinRoom(socket, room.id, { role: 'owner' });
      respond({ ok: true, roomId: room.id, slug: room.slug });
    } catch (error) {
      respond({ ok: false, error: error.message });
    }
  });

  socket.on('joinWithInvite', async ({ token } = {}, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    if (!await checkRateLimit(rateLimiters.joinWithInvite, socket.handshake.address, socket, respond)) return;
    const validation = validateInviteToken(token);
    if (!validation.ok) {
      respond({ ok: false, error: validation.error });
      return;
    }

    const room = rooms.get(validation.roomId);
    if (!room) {
      respond({ ok: false, error: 'room-not-found' });
      return;
    }

    try {
      await joinRoom(socket, room.id, { role: validation.role });
      respond({ ok: true, roomId: room.id, slug: room.slug });
    } catch (error) {
      respond({ ok: false, error: error.message });
    }
  });

  socket.on('requestInviteToken', ({ roomId } = {}, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    const activeRoomId = socket.data.roomId;
    if (!activeRoomId) {
      respond({ ok: false, error: 'not-in-room' });
      return;
    }

    const targetRoomId = roomId || activeRoomId;
    if (targetRoomId !== activeRoomId) {
      respond({ ok: false, error: 'not-in-room' });
      return;
    }

    const room = rooms.get(activeRoomId);
    if (!room) {
      respond({ ok: false, error: 'room-not-found' });
      return;
    }

    try {
      const token = createInviteToken(room.id, 'guest');
      respond({ ok: true, token, slug: room.slug });
    } catch (error) {
      respond({ ok: false, error: error.message });
    }
  });

  socket.on('room:leave', async (_payload, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    try {
      await leaveCurrentRoom(socket);
      respond({ ok: true });
    } catch (error) {
      respond({ ok: false, error: error.message });
    }
  });

  socket.on('step:toggle', ({ index, active }) => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }

    const room = rooms.get(roomId);
    if (!room || typeof index !== 'number' || index < 0 || index >= STEP_COUNT) {
      return;
    }

    const coercedActive = Boolean(active);
    room.legacyPattern[index] = coercedActive;
    io.to(roomId).emit('step:update', { index, active: coercedActive });
  });

  socket.on('tempo:set', (nextTempo) => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      return;
    }

    if (!updateRoomTempo(room, nextTempo)) {
      return;
    }

    broadcastTransportState(roomId);
  });

  socket.on('transport:set-tempo', async ({ bpm } = {}) => {
    if (!await checkRateLimit(rateLimiters.tempoSet, socket.id, socket)) return;
    const room = getRoomForSocket(socket);
    if (!room) {
      return;
    }

    if (!updateRoomTempo(room, bpm)) {
      return;
    }

    broadcastTransportState(room.id);
  });

  socket.on('transport:play', () => {
    const room = getRoomForSocket(socket);
    if (!room) {
      return;
    }

    room.transport.playing = true;
    room.transport.sessionStartTime = Date.now() + SESSION_START_DELAY_MS;
    room.transport.lastScheduledStart = room.transport.sessionStartTime;
    broadcastTransportState(room.id);
  });

  socket.on('transport:stop', () => {
    const room = getRoomForSocket(socket);
    if (!room) {
      return;
    }

    room.transport.playing = false;
    room.transport.lastScheduledStart = null;
    broadcastTransportState(room.id);
  });

  socket.on('instrument:set-length', ({ instrumentId, stepCount } = {}, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    const room = getRoomForSocket(socket);
    if (!room) {
      respond({ ok: false, error: 'not-in-room' });
      return;
    }

    if (typeof instrumentId !== 'string') {
      respond({ ok: false, error: 'invalid-instrument' });
      return;
    }

    const instrument = room.instruments.get(instrumentId);
    if (!instrument) {
      respond({ ok: false, error: 'instrument-not-found' });
      return;
    }

    if (isInstrumentLockedByOther(instrument, socket.id)) {
      respond({ ok: false, error: 'instrument-locked', lockedBy: instrument.lockedBy });
      return;
    }

    const nextStepCount = clampStepCount(stepCount);
    if (instrument.stepCount === nextStepCount) {
      respond({ ok: true, stepCount: instrument.stepCount });
      return;
    }

    instrument.stepCount = nextStepCount;
    ensureInstrumentStepCapacity(instrument, instrument.stepCount);
    broadcastInstrumentState(room.id, instrumentId);
    respond({ ok: true, stepCount: instrument.stepCount });
  });

  socket.on('instrument:add', async ({ type, name, creatorDisplayName, creatorUserId } = {}, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    if (!await checkRateLimit(rateLimiters.instrumentAdd, socket.id, socket, respond)) return;
    const room = getRoomForSocket(socket);
    if (!room) {
      respond({ ok: false, error: 'not-in-room' });
      return;
    }

    const instrumentType = type && Object.values(SynthTypes).includes(type) ? type : SynthTypes.SIMPLE;

    try {
      const instrument = createInstrument(instrumentType, {
        name,
        creatorUserId: normalizeUserId(creatorUserId) || socket.id,
        creatorDisplayName,
      });
      room.instruments.set(instrument.id, instrument);
      room.instrumentOrder.push(instrument.id);

      const payload = cloneInstrument(instrument);
      respond({ ok: true, instrument: payload });
      io.to(room.id).emit('instrument:added', payload);
      broadcastInstrumentOrder(room.id);
    } catch (error) {
      respond({ ok: false, error: error.message });
    }
  });

  socket.on('instrument:remove', ({ instrumentId } = {}, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    const room = getRoomForSocket(socket);
    if (!room) {
      respond({ ok: false, error: 'not-in-room' });
      return;
    }

    if (typeof instrumentId !== 'string') {
      respond({ ok: false, error: 'instrument-not-found' });
      return;
    }

    const instrument = room.instruments.get(instrumentId);
    if (!instrument) {
      respond({ ok: false, error: 'instrument-not-found' });
      return;
    }

    if (isInstrumentLockedByOther(instrument, socket.id)) {
      respond({ ok: false, error: 'instrument-locked', lockedBy: instrument.lockedBy });
      return;
    }

    room.instruments.delete(instrumentId);
    room.instrumentOrder = room.instrumentOrder.filter((id) => id !== instrumentId);
    broadcastInstrumentRemoval(room.id, instrumentId);
    broadcastInstrumentOrder(room.id);
    respond({ ok: true });
  });

  socket.on('instrument:param', async ({ instrumentId, params } = {}) => {
    if (!await checkRateLimit(rateLimiters.instrumentParam, socket.id, socket)) return;
    const room = getRoomForSocket(socket);
    if (!room) {
      return;
    }

    if (typeof instrumentId !== 'string') {
      return;
    }

    const instrument = room.instruments.get(instrumentId);
    if (!instrument) {
      return;
    }

    if (isInstrumentLockedByOther(instrument, socket.id)) {
      socket.emit('lockFailed', { synthName: instrument.name, instrumentId: instrument.id, lockedBy: instrument.lockedBy, reason: 'locked' });
      return;
    }

    applyInstrumentParams(instrument, params);
    broadcastInstrumentState(room.id, instrumentId);
  });

  socket.on('instrument:mute', async ({ instrumentId, muted } = {}) => {
    if (!await checkRateLimit(rateLimiters.instrumentParam, socket.id, socket)) return;
    const room = getRoomForSocket(socket);
    if (!room || typeof instrumentId !== 'string') return;
    const instrument = room.instruments.get(instrumentId);
    if (!instrument) return;
    instrument.muted = Boolean(muted);
    broadcastInstrumentState(room.id, instrumentId);
  });

  socket.on('instrument:rename', ({ instrumentId, name } = {}, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    const room = getRoomForSocket(socket);
    if (!room) {
      respond({ ok: false, error: 'not-in-room' });
      return;
    }

    if (typeof instrumentId !== 'string') {
      respond({ ok: false, error: 'invalid-instrument' });
      return;
    }

    const instrument = room.instruments.get(instrumentId);
    if (!instrument) {
      respond({ ok: false, error: 'instrument-not-found' });
      return;
    }

    if (isInstrumentLockedByOther(instrument, socket.id)) {
      respond({ ok: false, error: 'instrument-locked', lockedBy: instrument.lockedBy });
      return;
    }

    const sanitizedName = sanitizeInstrumentName(name, instrument.type);
    if (instrument.name === sanitizedName) {
      respond({ ok: true, name: sanitizedName });
      return;
    }

    instrument.name = sanitizedName;
    broadcastInstrumentState(room.id, instrumentId);
    respond({ ok: true, name: sanitizedName });
  });

  socket.on('instrument:step', async ({ instrumentId, stepIndex, step, drum, value, slot } = {}) => {
    if (!await checkRateLimit(rateLimiters.instrumentStep, socket.id, socket)) return;
    const room = getRoomForSocket(socket);
    if (!room) {
      return;
    }

    if (typeof instrumentId !== 'string' || typeof stepIndex !== 'number') {
      return;
    }

    const instrument = room.instruments.get(instrumentId);
    if (!instrument) {
      return;
    }

    if (isInstrumentLockedByOther(instrument, socket.id)) {
      socket.emit('lockFailed', { synthName: instrument.name, instrumentId: instrument.id, lockedBy: instrument.lockedBy, reason: 'locked' });
      return;
    }

    const normalizedIndex = Math.floor(stepIndex);
    const activeStepCount = clampStepCount(instrument.stepCount ?? (Array.isArray(instrument.steps) ? instrument.steps.length : STEP_COUNT));
    if (normalizedIndex < 0 || normalizedIndex >= activeStepCount) {
      return;
    }

    ensureInstrumentStepCapacity(instrument, Math.max(activeStepCount, normalizedIndex + 1));
    const targetStep = instrument.steps[normalizedIndex];

    if (instrument.type === SynthTypes.TR808 && typeof drum === 'string') {
      const layers = ensureDrumLayers(targetStep);
      const normalizedDrum = drum.toLowerCase();
      if (!(normalizedDrum in layers)) {
        return;
      }

      const nextValue = typeof value === 'boolean' ? value : !layers[normalizedDrum];
      layers[normalizedDrum] = nextValue;
      targetStep.active = Object.values(layers).some(Boolean);
      broadcastInstrumentState(room.id, instrumentId);
      return;
    }

    if (instrument.type === SynthTypes.SAMPLER) {
      const slotId = normalizeSamplerSlotId(slot || drum);
      if (!slotId) {
        return;
      }
      const slots = ensureSamplerStepSlots(targetStep);
      const nextValue = typeof value === 'boolean' ? value : !slots[slotId];
      slots[slotId] = nextValue;
      targetStep.active = Object.values(slots).some(Boolean);
      broadcastInstrumentState(room.id, instrumentId);
      return;
    }

    applyStepChanges(targetStep, step);
    broadcastInstrumentState(room.id, instrumentId);
  });

  socket.on('lockSynth', (payload) => {
    const room = getRoomForSocket(socket);
    if (!room) {
      return;
    }

    const instrument = findInstrumentByIdentifier(room, payload);
    const requestedRaw = typeof payload === 'string'
      ? payload
      : (payload && (payload.synthName || payload.instrumentId || payload.name)) || null;
    const requested = typeof requestedRaw === 'string' ? requestedRaw.trim() : null;

    if (!instrument) {
      if (requested) {
        socket.emit('lockFailed', { synthName: requested, reason: 'not-found' });
      }
      return;
    }

    if (instrument.lockedBy && instrument.lockedBy !== socket.id) {
      socket.emit('lockFailed', { synthName: instrument.name, lockedBy: instrument.lockedBy, reason: 'locked' });
      return;
    }

    if (instrument.lockedBy === socket.id) {
      socket.emit('synthLocked', { synthName: instrument.name, instrumentId: instrument.id, lockedBy: socket.id });
      return;
    }

    instrument.lockedBy = socket.id;
    broadcastInstrumentState(room.id, instrument.id);
    io.to(room.id).emit('synthLocked', { synthName: instrument.name, instrumentId: instrument.id, lockedBy: socket.id });
  });

  socket.on('unlockSynth', (payload) => {
    const room = getRoomForSocket(socket);
    if (!room) {
      return;
    }

    const instrument = findInstrumentByIdentifier(room, payload);
    if (!instrument || instrument.lockedBy !== socket.id) {
      return;
    }

    instrument.lockedBy = null;
    broadcastInstrumentState(room.id, instrument.id);
    io.to(room.id).emit('synthUnlocked', { synthName: instrument.name, instrumentId: instrument.id });
  });

  socket.on('time:pong', ({ id, clientSendTime }) => {
    if (typeof id !== 'number' || !Number.isFinite(clientSendTime)) {
      return;
    }

    const serverReceiveTime = Date.now();

    /*
     * Respond with the server timestamps so the client can calculate latency and
     * relative clock offset. The client compares its send time with these
     * server-side moments to keep the Web Audio engine phase-aligned.
     */
    socket.emit('time:sync', {
      id,
      serverReceiveTime,
      serverResponseTime: Date.now(),
    });
  });

  socket.on('lfo:add', async (_payload, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    if (!await checkRateLimit(rateLimiters.lfoAdd, socket.id, socket, respond)) return;
    const room = getRoomForSocket(socket);
    if (!room) { respond({ ok: false, error: 'not-in-room' }); return; }
    if ((room.lfos || []).length >= 8) { respond({ ok: false, error: 'lfo-limit' }); return; }
    const lfo = createLFOState();
    room.lfos = room.lfos || [];
    room.lfos.push(lfo);
    io.to(room.id).emit('lfo:added', lfo);
    respond({ ok: true, lfo });
  });

  socket.on('lfo:remove', ({ lfoId } = {}) => {
    const room = getRoomForSocket(socket);
    if (!room || typeof lfoId !== 'string') return;
    room.lfos = (room.lfos || []).filter(l => l.id !== lfoId);
    io.to(room.id).emit('lfo:removed', { lfoId });
  });

  socket.on('lfo:update', async ({ lfoId, params } = {}) => {
    if (!await checkRateLimit(rateLimiters.lfoUpdate, socket.id, socket)) return;
    const room = getRoomForSocket(socket);
    if (!room || typeof lfoId !== 'string') return;
    const lfo = (room.lfos || []).find(l => l.id === lfoId);
    if (!lfo) return;
    applyLFOParams(lfo, params || {});
    io.to(room.id).emit('lfo:updated', lfo);
  });

  socket.on('disconnect', () => {
    const { roomId } = socket.data;
    if (!roomId) {
      return;
    }

    const room = rooms.get(roomId);
    if (room) {
      removeSocketFromRoom(room, socket.id);
    }

    socket.data.roomId = undefined;
    socket.data.roomRole = undefined;
    broadcastConnections(roomId);
  });
});

function createRoomState({
  roomName = '',
  roomSlug = '',
  creatorUserId = null,
  creatorDisplayName = '',
  ownerUserId = null,
} = {}) {
  const roomId = generateRoomId();
  const now = Date.now();
  const state = {
    id: roomId,
    name: roomName,
    slug: roomSlug,
    secret: createRoomSecret(),
    ownerUserId: ownerUserId || creatorUserId || null,
    createdAt: now,
    members: new Map(),
    legacyPattern: Array(STEP_COUNT).fill(false),
    transport: {
      bpm: DEFAULT_TEMPO,
      playing: false,
      sessionStartTime: now + SESSION_START_DELAY_MS,
      lastScheduledStart: null,
    },
    instruments: new Map(),
    instrumentOrder: [],
    lfos: [],
    graceUsed: false,
  };

  const defaultInstrument = createInstrument(SynthTypes.SIMPLE, {
    creatorUserId,
    creatorDisplayName,
  });
  state.instruments.set(defaultInstrument.id, defaultInstrument);
  state.instrumentOrder.push(defaultInstrument.id);

  rooms.set(roomId, state);
  if (state.slug) {
    slugToRoomId.set(state.slug, roomId);
  }
  return state;
}

async function joinRoom(socket, roomId, { role = 'guest' } = {}) {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error('room-not-found');
  }

  await leaveCurrentRoom(socket);
  clearRoomCleanup(roomId);
  await socket.join(roomId);
  socket.data.roomId = roomId;
   socket.data.roomRole = role;
   room.members.set(socket.id, {
     role,
     joinedAt: Date.now(),
   });

  const state = serializeRoomState(room);
  socket.emit('state:init', {
    roomId,
    roomSlug: state.slug,
    role,
    transport: state.transport,
    instruments: state.instruments,
    instrumentOrder: state.instrumentOrder,
    lfos: state.lfos || [],
    // Legacy fields for backward compatibility.
    pattern: state.legacyPattern,
    legacyPattern: state.legacyPattern,
    tempo: state.transport.bpm,
    sessionStartTime: state.transport.sessionStartTime,
  });

  broadcastConnections(roomId);
  emitImmediatePing(socket);
}

function removeSocketFromRoom(room, socketId) {
  if (!room || !socketId) {
    return;
  }

  const released = releaseInstrumentLocks(room, socketId);
  for (const instrument of released) {
    broadcastInstrumentState(room.id, instrument.id);
    io.to(room.id).emit('synthUnlocked', { synthName: instrument.name, instrumentId: instrument.id });
  }

  room.members.delete(socketId);
  if (room.members.size === 0) {
    if (!room.graceUsed) {
      room.graceUsed = true;
      scheduleRoomCleanup(room.id);
    } else {
      rooms.delete(room.id);
      if (room.slug) slugToRoomId.delete(room.slug);
    }
  }
}

async function leaveCurrentRoom(socket) {
  const { roomId } = socket.data;
  if (!roomId) {
    return;
  }

  const room = rooms.get(roomId);
  if (room) {
    removeSocketFromRoom(room, socket.id);
  }

  try {
    await socket.leave(roomId);
  } catch (error) {
    // The socket might already be gone; ignore.
  }

  socket.data.roomId = undefined;
  socket.data.roomRole = undefined;
  broadcastConnections(roomId);
}

function broadcastConnections(roomId) {
  const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
  io.to(roomId).emit('connections:update', roomSize);
}

function emitImmediatePing(targetSocket) {
  const pingId = ++lastPingId;
  targetSocket.emit('time:ping', {
    id: pingId,
    serverTime: Date.now(),
  });
}

function broadcastTimePing() {
  const pingId = ++lastPingId;
  io.emit('time:ping', {
    id: pingId,
    serverTime: Date.now(),
  });
}

broadcastTimePing();
setInterval(broadcastTimePing, SYNC_INTERVAL_MS);

function sanitizeRoomName(roomName) {
  if (typeof roomName !== 'string') {
    return null;
  }

  const trimmed = roomName.trim();
  if (!trimmed.length) {
    return null;
  }
  return trimmed.slice(0, ROOM_NAME_MAX_LENGTH);
}

function slugifyRoomName(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, ROOM_SLUG_MAX_LENGTH);

  return normalized || '';
}

function generateRoomSlug(roomName) {
  const base = slugifyRoomName(roomName) || 'session';
  let candidate = base;
  let suffix = 1;
  while (slugToRoomId.has(candidate)) {
    suffix += 1;
    const availableLength = Math.max(0, ROOM_SLUG_MAX_LENGTH - (`-${suffix}`).length);
    const truncatedBase = base.slice(0, availableLength) || 'session';
    candidate = `${truncatedBase}-${suffix}`;
  }
  return candidate;
}

function generateRoomId() {
  return randomBytes(ROOM_ID_BYTES).toString('hex');
}

function createRoomSecret() {
  return randomBytes(32);
}

function base64UrlEncode(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return '';
  }
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(segment) {
  if (typeof segment !== 'string') {
    return null;
  }
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = normalized + (padding ? '='.repeat(4 - padding) : '');
  try {
    return Buffer.from(padded, 'base64');
  } catch (error) {
    return null;
  }
}

function signInviteToken(data, secret) {
  return createHmac('sha256', secret).update(data).digest();
}

function createInviteToken(roomId, role = 'guest') {
  const room = rooms.get(roomId);
  if (!room || !room.secret) {
    throw new Error('room-not-found');
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + INVITE_TOKEN_TTL_SECONDS;
  const payload = {
    roomId: room.id,
    role: role === 'owner' ? 'owner' : 'guest',
    nonce: randomBytes(8).toString('hex'),
    iat: issuedAt,
    exp: expiresAt,
  };
  const payloadSegment = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const unsigned = `${INVITE_TOKEN_HEADER_SEGMENT}.${payloadSegment}`;
  const signature = base64UrlEncode(signInviteToken(unsigned, room.secret));
  return `${unsigned}.${signature}`;
}

function validateInviteToken(token) {
  if (typeof token !== 'string') {
    return { ok: false, error: 'token-invalid' };
  }

  const segments = token.split('.');
  if (segments.length !== 3) {
    return { ok: false, error: 'token-invalid' };
  }

  const [headerSegment, payloadSegment, signatureSegment] = segments;
  if (headerSegment !== INVITE_TOKEN_HEADER_SEGMENT) {
    return { ok: false, error: 'token-invalid' };
  }

  const payloadBuffer = base64UrlDecode(payloadSegment);
  if (!payloadBuffer) {
    return { ok: false, error: 'token-invalid' };
  }

  let payload;
  try {
    payload = JSON.parse(payloadBuffer.toString('utf8'));
  } catch (error) {
    return { ok: false, error: 'token-invalid' };
  }

  if (!payload || typeof payload.roomId !== 'string' || typeof payload.nonce !== 'string') {
    return { ok: false, error: 'token-invalid' };
  }

  const issuedAt = Number(payload.iat);
  const expiresAt = Number(payload.exp);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
    return { ok: false, error: 'token-invalid' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (expiresAt <= now) {
    return { ok: false, error: 'token-expired' };
  }

  const room = rooms.get(payload.roomId);
  if (!room || !room.secret) {
    return { ok: false, error: 'room-not-found' };
  }

  const signatureBuffer = base64UrlDecode(signatureSegment);
  if (!signatureBuffer) {
    return { ok: false, error: 'token-invalid' };
  }

  const unsigned = `${headerSegment}.${payloadSegment}`;
  const expectedSignature = signInviteToken(unsigned, room.secret);
  if (signatureBuffer.length !== expectedSignature.length || !timingSafeEqual(signatureBuffer, expectedSignature)) {
    return { ok: false, error: 'token-invalid' };
  }

  return { ok: true, roomId: room.id, role: 'guest' };
}

function logLocalAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }

  if (addresses.length === 0) {
    console.log('No external IPv4 addresses detected.');
    return;
  }

  console.log('Seqroom available on your network:');
  addresses.forEach((addr) => {
    console.log(`  http://${addr}:${PORT}`);
  });
}

server.listen(PORT, () => {
  console.log(`Seqroom server running on http://localhost:${PORT}`);
  logLocalAddresses();
});
