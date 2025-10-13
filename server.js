const path = require('path');
const os = require('os');
const express = require('express');
const http = require('http');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const STEP_COUNT = 16;
const STEP_COUNT_MIN = 1;
const STEP_COUNT_MAX = 128;
const DEFAULT_TEMPO = 120;
const SESSION_START_DELAY_MS = 2000;
const SYNC_INTERVAL_MS = 2000;
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{4,16}$/;
const TEMPO_MIN = 30;
const TEMPO_MAX = 300;

const SynthTypes = Object.freeze({
  TB303: 'tb-303',
  TR808: 'tr-808',
  SIMPLE: 'poly-synth',
});

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

function defaultInstrumentName(type) {
  switch (type) {
    case SynthTypes.TB303:
      return 'Acid Bass';
    case SynthTypes.TR808:
      return '808 Drums';
    case SynthTypes.SIMPLE:
      return 'Poly Synth';
    default:
      return 'Instrument';
  }
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
        waveform: 'saw',
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
        clap: {
          level: 0.6,
          spread: 0.4,
          reverb: 0.35,
          decay: 0.8,
        },
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

function createStepTemplate(type) {
  if (type === SynthTypes.TR808) {
    return {
      active: false,
      layers: {
        kick: false,
        snare: false,
        hat: false,
        clap: false,
      },
    };
  }

  const defaultPitchByType = {
    [SynthTypes.TB303]: 'C2',
    [SynthTypes.SIMPLE]: 'C4',
  };

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

  const instrument = {
    id: randomUUID(),
    type,
    name: options.name || defaultInstrumentName(type),
    createdAt: Date.now(),
    params: createDefaultParams(type),
    stepCount: initialStepCount,
    steps: createStepSequence(type, initialStepCount),
  };

  if (type === SynthTypes.TR808) {
    instrument.params = deepCloneTR808Params(instrument.params);
  }

  return instrument;
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

function cloneInstrument(instrument) {
  if (instrument.type === SynthTypes.TR808) {
    instrument.params = deepCloneTR808Params(instrument.params);
  }

  const normalizedStepCount = clampStepCount(instrument.stepCount ?? (Array.isArray(instrument.steps) ? instrument.steps.length : STEP_COUNT) ?? STEP_COUNT);
  instrument.stepCount = normalizedStepCount;

  const base = {
    id: instrument.id,
    type: instrument.type,
    name: instrument.name,
    createdAt: instrument.createdAt,
    params: instrument.params,
    stepCount: normalizedStepCount,
    steps: instrument.steps.map((step) => ({
      ...step,
      layers: step.layers ? { ...step.layers } : undefined,
    })),
  };

  if (instrument.type === SynthTypes.TR808) {
    base.params = deepCloneTR808Params(instrument.params);
  } else {
    base.params = { ...instrument.params };
  }

  return base;
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
    return false;
  }

  let mutated = false;
  for (let index = currentLength; index < targetLength; index += 1) {
    instrument.steps.push(createStepTemplate(instrument.type));
    mutated = true;
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

  if (!params || typeof params !== 'object') {
    return;
  }

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      instrument.params[key] = value;
    } else if (typeof value === 'string') {
      instrument.params[key] = value;
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
  if (typeof step.layers.clap !== 'boolean') step.layers.clap = false;
  return step.layers;
}

function ensureTR808ParamStructure(instrument) {
  if (instrument.type !== SynthTypes.TR808) {
    return;
  }
  instrument.params = deepCloneTR808Params(instrument.params || {});
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

  target.clapLevel = target.clap.level;
  target.clapSpread = target.clap.spread;
  target.clapReverb = target.clap.reverb;
  target.clapDecay = target.clap.decay;
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
    transport: cloneTransport(room.transport),
    instruments: room.instrumentOrder
      .map((instrumentId) => room.instruments.get(instrumentId))
      .filter(Boolean)
      .map(cloneInstrument),
    instrumentOrder: [...room.instrumentOrder],
    legacyPattern: [...room.legacyPattern],
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
let lastPingId = 0;

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => {
  socket.on('room:create', async ({ roomId } = {}, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    const normalized = normalizeRoomId(roomId);
    if (!normalized) {
      respond({ ok: false, error: 'invalid-room-id' });
      return;
    }

    if (rooms.has(normalized)) {
      respond({ ok: false, error: 'room-already-exists' });
      return;
    }

    createRoomState(normalized);

    try {
      await joinRoom(socket, normalized);
      respond({ ok: true, roomId: normalized });
    } catch (error) {
      respond({ ok: false, error: error.message });
    }
  });

  socket.on('room:join', async ({ roomId } = {}, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    const normalized = normalizeRoomId(roomId);
    if (!normalized) {
      respond({ ok: false, error: 'invalid-room-id' });
      return;
    }

    if (!rooms.has(normalized)) {
      respond({ ok: false, error: 'room-not-found' });
      return;
    }

    try {
      await joinRoom(socket, normalized);
      respond({ ok: true, roomId: normalized });
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

    const numericTempo = Number(nextTempo);
    if (!Number.isFinite(numericTempo) || numericTempo < TEMPO_MIN || numericTempo > TEMPO_MAX) {
      return;
    }

    room.transport.bpm = Math.round(clamp(numericTempo, TEMPO_MIN, TEMPO_MAX));
    broadcastTransportState(roomId);
  });

  socket.on('transport:set-tempo', ({ bpm } = {}) => {
    const room = getRoomForSocket(socket);
    if (!room) {
      return;
    }

    const numericTempo = Number(bpm);
    if (!Number.isFinite(numericTempo)) {
      return;
    }

    room.transport.bpm = Math.round(clamp(numericTempo, TEMPO_MIN, TEMPO_MAX));
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

  socket.on('instrument:add', ({ type, name } = {}, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    const room = getRoomForSocket(socket);
    if (!room) {
      respond({ ok: false, error: 'not-in-room' });
      return;
    }

    const instrumentType = type && Object.values(SynthTypes).includes(type) ? type : SynthTypes.SIMPLE;

    try {
      const instrument = createInstrument(instrumentType, { name });
      room.instruments.set(instrument.id, instrument);
      room.instrumentOrder.push(instrument.id);

      const payload = cloneInstrument(instrument);
      io.to(room.id).emit('instrument:added', payload);
      broadcastInstrumentOrder(room.id);
      respond({ ok: true, instrument: payload });
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

    if (typeof instrumentId !== 'string' || !room.instruments.has(instrumentId)) {
      respond({ ok: false, error: 'instrument-not-found' });
      return;
    }

    room.instruments.delete(instrumentId);
    room.instrumentOrder = room.instrumentOrder.filter((id) => id !== instrumentId);
    broadcastInstrumentRemoval(room.id, instrumentId);
    broadcastInstrumentOrder(room.id);
    respond({ ok: true });
  });

  socket.on('instrument:param', ({ instrumentId, params } = {}) => {
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

    applyInstrumentParams(instrument, params);
    broadcastInstrumentState(room.id, instrumentId);
  });

  socket.on('instrument:step', ({ instrumentId, stepIndex, step, drum, value } = {}) => {
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

    applyStepChanges(targetStep, step);
    broadcastInstrumentState(room.id, instrumentId);
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

  socket.on('disconnect', () => {
    const { roomId } = socket.data;
    if (!roomId) {
      return;
    }

    socket.data.roomId = undefined;
    broadcastConnections(roomId);
  });
});

function normalizeRoomId(roomId) {
  if (typeof roomId !== 'string') {
    return null;
  }

  const trimmed = roomId.trim();
  if (!ROOM_ID_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function createRoomState(roomId) {
  const now = Date.now();
  const state = {
    id: roomId,
    legacyPattern: Array(STEP_COUNT).fill(false),
    transport: {
      bpm: DEFAULT_TEMPO,
      playing: false,
      sessionStartTime: now + SESSION_START_DELAY_MS,
      lastScheduledStart: null,
    },
    instruments: new Map(),
    instrumentOrder: [],
  };

  const defaultInstrument = createInstrument(SynthTypes.SIMPLE);
  state.instruments.set(defaultInstrument.id, defaultInstrument);
  state.instrumentOrder.push(defaultInstrument.id);

  rooms.set(roomId, state);
  return state;
}

async function joinRoom(socket, roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error('room-not-found');
  }

  await leaveCurrentRoom(socket);
  await socket.join(roomId);
  socket.data.roomId = roomId;

  const state = serializeRoomState(room);
  socket.emit('state:init', {
    roomId,
    transport: state.transport,
    instruments: state.instruments,
    instrumentOrder: state.instrumentOrder,
    // Legacy fields for backward compatibility.
    pattern: state.legacyPattern,
    legacyPattern: state.legacyPattern,
    tempo: state.transport.bpm,
    sessionStartTime: state.transport.sessionStartTime,
  });

  broadcastConnections(roomId);
  emitImmediatePing(socket);
}

async function leaveCurrentRoom(socket) {
  const { roomId } = socket.data;
  if (!roomId) {
    return;
  }

  try {
    await socket.leave(roomId);
  } catch (error) {
    // The socket might already be gone; ignore.
  }

  socket.data.roomId = undefined;
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
