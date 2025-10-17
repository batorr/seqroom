const STEP_COUNT = 16;
const STEP_COUNT_MIN = 1;
const STEP_COUNT_MAX = 128;
const STEP_GRID_COLUMNS = 16;
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{4,16}$/;
const TEMPO_MIN = 30;
const TEMPO_MAX = 300;
const DEFAULT_BPM = 120;

const OFFSET_SMOOTHING = 0.2;
const LATENCY_SMOOTHING = 0.25;

const SynthTypes = Object.freeze({
  TB303: 'tb-303',
  TR808: 'tr-808',
  POLY: 'poly-synth',
  SAMPLER: 'sampler',
});

const TR808_DRUMS = [
  { id: 'kick', label: 'Kick', color: '#f97316' },
  { id: 'snare', label: 'Snare', color: '#facc15' },
  { id: 'hat', label: 'Hat', color: '#38bdf8' },
  { id: 'clap', label: 'Clap', color: '#c084fc' },
];

const SAMPLER_SLOT_CONFIG = [
  { id: 'A', label: 'Slot A', color: '#f97316' },
  { id: 'B', label: 'Slot B', color: '#facc15' },
  { id: 'C', label: 'Slot C', color: '#38bdf8' },
  { id: 'D', label: 'Slot D', color: '#22c55e' },
  { id: 'E', label: 'Slot E', color: '#a855f7' },
  { id: 'F', label: 'Slot F', color: '#f472b6' },
];

const SAMPLER_SLOT_IDS = SAMPLER_SLOT_CONFIG.map((slot) => slot.id);
const SAMPLER_MAX_SAMPLE_BYTES = 5 * 1024 * 1024;
const SAMPLER_ALLOWED_MIME_TYPES = ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3'];

function hexToRgba(hex, alpha = 1) {
  if (typeof hex !== 'string') {
    return '';
  }

  const normalized = hex.trim().replace(/^#/, '');
  const safeAlpha = Math.min(Math.max(Number(alpha), 0), 1);

  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16);
    const g = parseInt(normalized[1] + normalized[1], 16);
    const b = parseInt(normalized[2] + normalized[2], 16);
    if ([r, g, b].some((value) => Number.isNaN(value))) {
      return '';
    }
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }

  if (normalized.length === 6) {
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    if ([r, g, b].some((value) => Number.isNaN(value))) {
      return '';
    }
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }

  return '';
}

function clampStepCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return STEP_COUNT;
  }
  return Math.min(Math.max(Math.round(numeric), STEP_COUNT_MIN), STEP_COUNT_MAX);
}

function formatStepCountLabel(count) {
  const normalized = clampStepCount(count);
  return `${normalized} ${normalized === 1 ? 'step' : 'steps'}`;
}

function ensureLocalInstrumentCapacity(instrument, stepCount) {
  if (!instrument) {
    return;
  }
  const desired = clampStepCount(stepCount);
  if (!Array.isArray(instrument.steps)) {
    instrument.steps = [];
  }
  while (instrument.steps.length < desired) {
    let template;
    if (instrument.type === SynthTypes.TR808) {
      template = createEmptyDrumStep();
    } else if (instrument.type === SynthTypes.SAMPLER) {
      template = createEmptySamplerStep();
    } else {
      template = createEmptyMelodicStep();
    }
    instrument.steps.push(template);
  }
}

function setInstrumentStepCountLocal(instrumentId, stepCount) {
  const instrument = state.instruments.get(instrumentId);
  if (!instrument) {
    return;
  }
  const desired = clampStepCount(stepCount);
  instrument.stepCount = desired;
  ensureLocalInstrumentCapacity(instrument, desired);
}

const INSTRUMENT_LIBRARY = {
  [SynthTypes.TB303]: {
    label: 'Acid Bass',
    typeLabel: 'TB-303',
    toneClass: 'tone-acid',
    params: [
      sliderParam('volume', 'Volume', 0, 1, 0.01),
      sliderParam('cutoff', 'Cutoff', 0, 1, 0.01),
      sliderParam('resonance', 'Resonance', 0, 1, 0.01),
      sliderParam('envelopeMod', 'Env Mod', 0, 1, 0.01),
      sliderParam('decay', 'Decay', 0, 1, 0.01),
      selectParam('waveform', 'Waveform', [
        { value: 'saw', label: 'Saw' },
        { value: 'square', label: 'Square' },
      ]),
    ],
  },
  [SynthTypes.TR808]: {
    label: '808 Drums',
    typeLabel: 'TR-808',
    toneClass: 'tone-808',
    params: [
      sliderParam('volume', 'Volume', 0, 1, 0.01),
      sliderParam('kickLevel', 'Kick', 0, 1, 0.01),
      sliderParam('snareLevel', 'Snare', 0, 1, 0.01),
      sliderParam('hatLevel', 'Hats', 0, 1, 0.01),
      sliderParam('clapLevel', 'Clap', 0, 1, 0.01),
      sliderParam('tone', 'Tone', 0, 1, 0.01),
    ],
  },
  [SynthTypes.POLY]: {
    label: 'Poly Synth',
    typeLabel: 'Poly',
    toneClass: 'tone-poly',
    params: [
      sliderParam('volume', 'Volume', 0, 1, 0.01),
      sliderParam('attack', 'Attack', 0, 2, 0.01),
      sliderParam('decay', 'Decay', 0, 2, 0.01),
      sliderParam('release', 'Release', 0, 3, 0.01),
      sliderParam('cutoff', 'Cutoff', 0, 1, 0.01),
      sliderParam('resonance', 'Resonance', 0, 1, 0.01),
      selectParam('waveform', 'Waveform', [
        { value: 'sine', label: 'Sine' },
        { value: 'triangle', label: 'Triangle' },
        { value: 'saw', label: 'Saw' },
        { value: 'square', label: 'Square' },
      ]),
    ],
  },
  [SynthTypes.SAMPLER]: {
    label: 'Sampler',
    typeLabel: 'Sampler',
    toneClass: 'tone-sampler',
    params: [],
  },
};

const NOTE_OPTIONS = [
  'C1', 'C#1', 'D1', 'D#1', 'E1', 'F1', 'F#1', 'G1', 'G#1', 'A1', 'A#1', 'B1',
  'C2', 'C#2', 'D2', 'D#2', 'E2', 'F2', 'F#2', 'G2', 'G#2', 'A2', 'A#2', 'B2',
  'C3', 'C#3', 'D3', 'D#3', 'E3', 'F3', 'F#3', 'G3', 'G#3', 'A3', 'A#3', 'B3',
  'C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4',
  'C5', 'C#5', 'D5', 'D#5', 'E5', 'F5', 'F#5', 'G5', 'G#5', 'A5', 'A#5', 'B5',
];

const state = {
  isInRoom: false,
  roomId: null,
  transport: {
    bpm: DEFAULT_BPM,
    playing: false,
    sessionStartTime: null,
    lastScheduledStart: null,
  },
  instruments: new Map(),
  instrumentOrder: [],
  activeInstrumentId: null,
  tempoPreview: DEFAULT_BPM,
};

const landingEl = document.getElementById('landing');
const sequencerEl = document.getElementById('sequencer');
const roomCodeDisplayEl = document.getElementById('room-code-display');
const createRoomBtn = document.getElementById('create-room');
const joinRoomBtn = document.getElementById('join-room');
const leaveRoomBtn = document.getElementById('leave-room');
const transportToggleBtn = document.getElementById('transport-toggle');
const recordToggleBtn = document.getElementById('record-toggle');
const addSynthBtn = document.getElementById('add-synth');
const roomDisplayEl = document.getElementById('room-display');
const syncStatusEl = document.getElementById('sync-status');
const connectionsEl = document.getElementById('connections');
const tempoSlider = document.getElementById('tempo');
const tempoInputField = document.getElementById('tempo-input');
const tempoValueEl = document.getElementById('tempo-value');
const instrumentListEl = document.getElementById('instrument-list');
const instrumentEmptyEl = document.getElementById('instrument-empty');
const addSynthModal = document.getElementById('add-synth-modal');
const closeSynthModalBtn = document.getElementById('close-synth-modal');
const instrumentTemplate = document.getElementById('instrument-card-template');
const recordingStatusEl = document.getElementById('recording-status');

const socket = io({ autoConnect: false });

const instrumentElements = new Map();
let pendingRoomRequest = false;
const pendingPings = new Map();
let clockOffsetMs = 0;
let latencyEstimateMs = 0;
let hasSyncSample = false;

const audioState = {
  context: null,
  masterGain: null,
  schedulerId: null,
  nextStepIndex: 0,
  lastStepDurationMs: null,
  isRecording: false,
  recordingNode: null,
  recordingChunks: [],
  recordingSampleRate: null,
  recordingContextSampleRate: null,
  recordingChannelCount: 0,
  recordingTotalSamples: 0,
  recordingFrameCount: 0,
  recordingByteLength: 0,
  recordingStatsLastUpdate: 0,
  recordingModuleLoaded: false,
  samplerBuffers: new Map(),
  pendingSamplerLoads: new Map(),
};

const AUDIO_LOOKAHEAD_MS = 25;
const AUDIO_SCHEDULE_AHEAD_SECONDS = 0.18;
const RECORDING_STATS_UPDATE_INTERVAL_MS = 200;
const tempoInputState = { manualEditing: false };

initialize();

function initialize() {
  setupTempoControls();
  setupTransportControls();
  setupRecordingControls();
  setupRoomControls();
  setupSynthModal();
  primeAudioUnlock();
  setupSocketEvents();
  showLanding();
  updateTempoDisplay(state.transport.bpm);
}

function setupRoomControls() {
  createRoomBtn.addEventListener('click', () => {
    ensureAudioContext();
    const roomId = generateRoomId();
    showRoomCodeHint(roomId);
    connectToRoom(roomId, { mode: 'create' });
  });

  joinRoomBtn.addEventListener('click', () => {
    ensureAudioContext();
    const input = window.prompt('Enter room code:');
    if (!input) {
      return;
    }

    const normalized = normalizeRoomId(input);
    if (!normalized) {
      window.alert('Room codes use letters, numbers, - or _. Try again.');
      return;
    }

    connectToRoom(normalized, { mode: 'join' });
  });

  leaveRoomBtn.addEventListener('click', () => leaveRoom());
}

function setupTempoControls() {
  tempoSlider.addEventListener('input', (event) => {
    const preview = clampTempo(event.target.value);
    state.tempoPreview = preview;
    updateTempoDisplay(preview);
  });

  tempoSlider.addEventListener('change', (event) => {
    const nextTempo = clampTempo(event.target.value);
    state.tempoPreview = nextTempo;
    commitTempo(nextTempo);
  });

  if (tempoInputField) {
    tempoInputField.type = 'number';
    tempoInputField.min = String(TEMPO_MIN);
    tempoInputField.max = String(TEMPO_MAX);
    tempoInputField.step = '1';

    const handleTempoCommit = (rawValue, { enforceClamp = false } = {}) => {
      if (rawValue === '') {
        return;
      }
      const numeric = Number(rawValue);
      if (!Number.isFinite(numeric)) {
        return;
      }
      if (numeric >= TEMPO_MIN && numeric <= TEMPO_MAX) {
        commitTempo(numeric);
      } else if (enforceClamp) {
        commitTempo(numeric);
      }
    };

    tempoInputField.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        if (tempoInputState.manualEditing) {
          handleTempoCommit(event.target.value, { enforceClamp: true });
          tempoInputState.manualEditing = false;
          updateTempoDisplay(state.transport.bpm);
        }
        return;
      }

      if (event.key === 'Escape') {
        tempoInputState.manualEditing = false;
        updateTempoDisplay(state.transport.bpm);
        return;
      }

      const printable = event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
      const editingKeys = ['Backspace', 'Delete'];
      if (printable || editingKeys.includes(event.key)) {
        tempoInputState.manualEditing = true;
      }
    });

    tempoInputField.addEventListener('input', (event) => {
      event.stopPropagation();
      if (!tempoInputState.manualEditing) {
        handleTempoCommit(event.target.value, { enforceClamp: true });
      }
    });

    tempoInputField.addEventListener('change', (event) => {
      event.stopPropagation();
      if (!tempoInputState.manualEditing) {
        handleTempoCommit(event.target.value, { enforceClamp: true });
      }
      updateTempoDisplay(state.transport.bpm);
    });

    tempoInputField.addEventListener('blur', () => {
      tempoInputState.manualEditing = false;
      updateTempoDisplay(state.transport.bpm);
    });
  }
}

function setupTransportControls() {
  transportToggleBtn.addEventListener('click', () => {
    if (!state.isInRoom) {
      return;
    }

    ensureAudioContext();
    if (state.transport.playing) {
      socket.emit('transport:stop');
    } else {
      socket.emit('transport:play');
    }
  });

  addSynthBtn.addEventListener('click', () => {
    if (!state.isInRoom) {
      window.alert('Join a room before adding instruments.');
      return;
    }

    openSynthModal();
  });
}

function setupRecordingControls() {
  if (!recordToggleBtn) {
    return;
  }

  updateRecordingStatsDisplay();

  if (!isRecordingSupported()) {
    recordToggleBtn.disabled = true;
    recordToggleBtn.title = 'Recording is not supported in this browser.';
    return;
  }

  recordToggleBtn.addEventListener('click', () => {
    toggleRecording().catch((error) => {
      console.error('Failed to toggle recording:', error);
      audioState.isRecording = false;
      updateRecordButton(false);
      window.alert('Unable to control recording. Check the console for details.');
    });
  });

  updateRecordButton(false);
}

function setupSynthModal() {
  closeSynthModalBtn.addEventListener('click', closeSynthModal);
  addSynthModal.addEventListener('click', (event) => {
    if (event.target === addSynthModal) {
      closeSynthModal();
    }
  });

  addSynthModal.querySelectorAll('.synth-option').forEach((option) => {
    option.addEventListener('click', () => {
      const type = option.dataset.synthType;
      if (!type) {
        return;
      }

      socket.emit('instrument:add', { type }, (response = {}) => {
        if (!response.ok && response.error) {
          console.error('Failed to add instrument:', response.error);
        }
      });
      closeSynthModal();
    });
  });
}

function primeAudioUnlock() {
  ['pointerdown', 'keydown'].forEach((eventName) => {
    document.addEventListener(eventName, () => ensureAudioContext(), {
      once: true,
      passive: true,
    });
  });
}

function setupSocketEvents() {
  socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error);
  });

  socket.on('state:init', (payload) => {
    hydrateState(payload);
    renderTransport();
    renderInstruments();
    updateConnectionsDisplay(payload.connections ?? 0);
    syncAudioScheduler();
  });

  socket.on('transport:update', (transport) => {
    state.transport = {
      bpm: clampTempo(transport.bpm ?? state.transport.bpm),
      playing: Boolean(transport.playing),
      sessionStartTime: transport.sessionStartTime ?? null,
      lastScheduledStart: transport.lastScheduledStart ?? null,
    };
    renderTransport();
    syncAudioScheduler();
  });

  socket.on('tempo:update', (tempo) => {
    // Legacy clients still rely on this event. Keep transport in sync.
    state.transport.bpm = clampTempo(tempo);
    renderTransport();
    syncAudioScheduler();
  });

  socket.on('instrument:added', (instrument) => {
    const normalized = normalizeInstrument(instrument);
    state.instruments.set(normalized.id, normalized);
    prepareSamplerAudio(normalized);
    if (!state.instrumentOrder.includes(normalized.id)) {
      state.instrumentOrder.push(normalized.id);
    }
    renderInstruments();
    setActiveInstrument(normalized.id);
  });

  socket.on('instrument:update', (instrument) => {
    const normalized = normalizeInstrument(instrument);
    state.instruments.set(normalized.id, normalized);
    prepareSamplerAudio(normalized);
    renderInstrument(normalized.id);
  });

  socket.on('instrument:removed', ({ instrumentId }) => {
    cleanupSamplerBuffers(instrumentId);
    state.instruments.delete(instrumentId);
    state.instrumentOrder = state.instrumentOrder.filter((id) => id !== instrumentId);
    const wasActive = state.activeInstrumentId === instrumentId;
    removeInstrumentCard(instrumentId);
    renderEmptyState();
    if (wasActive) {
      const nextActive = state.instrumentOrder[0] || null;
      setActiveInstrument(nextActive);
    } else {
      updateActiveInstrumentHighlight();
    }
  });

  socket.on('instrument:order', (order = []) => {
    state.instrumentOrder = order.filter((id) => state.instruments.has(id));
    if (state.activeInstrumentId && !state.instrumentOrder.includes(state.activeInstrumentId)) {
      const nextActive = state.instrumentOrder[0] || null;
      state.activeInstrumentId = nextActive;
    }
    renderInstruments();
  });

  socket.on('time:ping', ({ id }) => {
    if (typeof id !== 'number') {
      return;
    }

    const clientNow = getClientAbsoluteTime();
    pendingPings.set(id, { clientSendTime: clientNow });

    if (pendingPings.size > 32) {
      const [oldest] = pendingPings.keys();
      pendingPings.delete(oldest);
    }

    socket.emit('time:pong', {
      id,
      clientSendTime: clientNow,
    });
  });

  socket.on('time:sync', ({ id, serverReceiveTime, serverResponseTime }) => {
    if (!pendingPings.has(id)) {
      return;
    }

    const pending = pendingPings.get(id);
    pendingPings.delete(id);

    const clientSendTime = pending.clientSendTime;
    const clientReceiveTime = getClientAbsoluteTime();

    if (!Number.isFinite(serverReceiveTime) || !Number.isFinite(serverResponseTime)) {
      return;
    }

    const offsetSample = ((serverReceiveTime - clientSendTime) + (serverResponseTime - clientReceiveTime)) / 2;
    const delaySample = Math.max(0, (clientReceiveTime - clientSendTime) - (serverResponseTime - serverReceiveTime));

    applyClockCorrection(offsetSample, delaySample);
  });

  socket.on('connections:update', (count) => updateConnectionsDisplay(count));

  socket.on('step:update', ({ index, active }) => {
    // Legacy support: map to active instrument if available.
    const targetInstrumentId = state.activeInstrumentId || state.instrumentOrder[0];
    if (!targetInstrumentId) {
      return;
    }
    const instrument = state.instruments.get(targetInstrumentId);
    if (!instrument || instrument.type === SynthTypes.TR808 || index < 0 || index >= instrument.steps.length) {
      return;
    }
    instrument.steps[index].active = Boolean(active);
    renderInstrument(targetInstrumentId);
  });
}
function getVisibleStepSlots(stepCount) {
  const effective = clampStepCount(stepCount ?? STEP_COUNT);
  const rows = Math.max(1, Math.ceil(effective / STEP_GRID_COLUMNS));
  return rows * STEP_GRID_COLUMNS;
}

function formatStepIndex(index, visibleTotal) {
  const padWidth = visibleTotal >= 100 ? 3 : 2;
  return String(index + 1).padStart(padWidth, '0');
}

function hydrateState(payload) {
  state.isInRoom = true;
  state.roomId = payload.roomId || null;

  const transport = payload.transport || {};
  state.transport = {
    bpm: clampTempo(transport.bpm ?? DEFAULT_BPM),
    playing: Boolean(transport.playing),
    sessionStartTime: transport.sessionStartTime ?? null,
    lastScheduledStart: transport.lastScheduledStart ?? null,
  };

  pendingPings.clear();
  clockOffsetMs = 0;
  latencyEstimateMs = 0;
  hasSyncSample = false;
  updateSyncStatus();

  state.instruments.clear();
  (payload.instruments || []).forEach((instrument) => {
    const normalized = normalizeInstrument(instrument);
    state.instruments.set(normalized.id, normalized);
    prepareSamplerAudio(normalized);
  });
  state.instrumentOrder = (payload.instrumentOrder || []).filter((id) => state.instruments.has(id));
  if (!state.instrumentOrder.length && state.instruments.size) {
    state.instrumentOrder = Array.from(state.instruments.keys());
  }
  const nextActiveInstrumentId = state.instrumentOrder[0] || null;
  state.activeInstrumentId = nextActiveInstrumentId && state.instruments.has(nextActiveInstrumentId)
    ? nextActiveInstrumentId
    : null;

  roomDisplayEl.textContent = `Room: ${state.roomId ?? '—'}`;
}

function renderTransport() {
  updateTempoDisplay(state.transport.bpm);
  transportToggleBtn.textContent = state.transport.playing ? 'Stop' : 'Play';
  transportToggleBtn.classList.toggle('playing', state.transport.playing);
  transportToggleBtn.disabled = !state.isInRoom;
  updateRecordButton(audioState.isRecording);
  if (state.transport.playing) {
    updatePlaybackIndicators(getCurrentStepIndex());
  } else {
    updatePlaybackIndicators(-1);
  }
}

function updateRecordButton(isRecording) {
  if (!recordToggleBtn) {
    return;
  }

  recordToggleBtn.classList.toggle('recording', Boolean(isRecording));
  recordToggleBtn.textContent = Boolean(isRecording) ? '● REC' : 'REC';
  if (typeof recordToggleBtn.disabled === 'boolean') {
    recordToggleBtn.disabled = !isRecordingSupported();
  }
}

function isRecordingSupported() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  return typeof window.AudioWorkletNode === 'function' && typeof AudioContextCtor === 'function';
}

function updateTempoDisplay(value) {
  const bpm = clampTempo(value);
  tempoSlider.value = String(bpm);
  tempoInputField.value = String(bpm);
  tempoValueEl.textContent = `${bpm} BPM`;
}

function commitTempo(bpm) {
  const tempo = clampTempo(bpm);
  updateTempoDisplay(tempo);
  state.transport.bpm = tempo;
  if (state.isInRoom) {
    socket.emit('transport:set-tempo', { bpm: tempo });
  }
  syncAudioScheduler();
}

function renderInstruments() {
  // Remove cards that no longer exist.
  instrumentElements.forEach((_value, instrumentId) => {
    if (!state.instruments.has(instrumentId)) {
      removeInstrumentCard(instrumentId);
    }
  });

  if (!state.instrumentOrder.length) {
    state.activeInstrumentId = null;
  } else if (!state.activeInstrumentId || !state.instruments.has(state.activeInstrumentId)) {
    state.activeInstrumentId = state.instrumentOrder[0];
  }

  const fragment = document.createDocumentFragment();
  state.instrumentOrder.forEach((instrumentId) => {
    const instrument = state.instruments.get(instrumentId);
    if (!instrument) {
      return;
    }

    const card = ensureInstrumentCard(instrument);
    fragment.appendChild(card);
  });

  instrumentListEl.innerHTML = '';
  instrumentListEl.appendChild(fragment);
  renderEmptyState();
  updateActiveInstrumentHighlight();
  updatePlaybackIndicators(getCurrentStepIndex());
}

function renderInstrument(instrumentId) {
  const instrument = state.instruments.get(instrumentId);
  if (!instrument) {
    removeInstrumentCard(instrumentId);
    return;
  }

  const card = ensureInstrumentCard(instrument);
  updateInstrumentCard(card, instrument);
  renderEmptyState();
  updateActiveInstrumentHighlight();
  updatePlaybackIndicators(getCurrentStepIndex());
}

function setActiveInstrument(instrumentId) {
  if (instrumentId && !state.instruments.has(instrumentId)) {
    instrumentId = null;
  }
  if (state.activeInstrumentId === instrumentId) {
    updateActiveInstrumentHighlight();
    return;
  }
  state.activeInstrumentId = instrumentId;
  updateActiveInstrumentHighlight();
}

function updateActiveInstrumentHighlight() {
  instrumentElements.forEach(({ root }, instrumentId) => {
    root.classList.toggle('active', instrumentId === state.activeInstrumentId);
  });
}

function requestInstrumentStepCountChange(instrumentId, nextStepCount) {
  if (state.activeInstrumentId !== instrumentId) {
    setActiveInstrument(instrumentId);
  }

  const instrument = state.instruments.get(instrumentId);
  if (!instrument) {
    return;
  }

  const previous = clampStepCount(instrument.stepCount ?? (Array.isArray(instrument.steps) ? instrument.steps.length : STEP_COUNT));
  const desired = clampStepCount(nextStepCount);

  if (desired === previous) {
    setInstrumentStepCountLocal(instrumentId, desired);
    renderInstrument(instrumentId);
    updatePlaybackIndicators(getCurrentStepIndex());
    return;
  }

  setInstrumentStepCountLocal(instrumentId, desired);
  renderInstrument(instrumentId);
  updatePlaybackIndicators(getCurrentStepIndex());

  if (!state.isInRoom) {
    return;
  }

  socket.emit('instrument:set-length', { instrumentId, stepCount: desired }, (response = {}) => {
    if (!response.ok) {
      if (response.error) {
        console.error('Failed to update instrument length:', response.error);
      }
      setInstrumentStepCountLocal(instrumentId, previous);
      renderInstrument(instrumentId);
      updatePlaybackIndicators(getCurrentStepIndex());
      return;
    }

    if (typeof response.stepCount === 'number') {
      const acknowledged = clampStepCount(response.stepCount);
      if (acknowledged !== desired) {
        setInstrumentStepCountLocal(instrumentId, acknowledged);
        renderInstrument(instrumentId);
      }
      updatePlaybackIndicators(getCurrentStepIndex());
    }
  });
}

function ensureInstrumentCard(instrument) {
  let wrapper = instrumentElements.get(instrument.id)?.root;
  if (wrapper) {
    updateInstrumentCard(wrapper, instrument);
    return wrapper;
  }

  const node = instrumentTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.instrumentId = instrument.id;

  const removeBtn = node.querySelector('.remove-instrument');
  removeBtn.addEventListener('click', () => {
    socket.emit('instrument:remove', { instrumentId: instrument.id });
  });

  node.addEventListener('click', (event) => {
    if (event.target.closest('.remove-instrument')) {
      return;
    }
    const targetId = node.dataset.instrumentId;
    if (targetId) {
      setActiveInstrument(targetId);
    }
  });

  const cardEntry = {
    root: node,
    paramsContainer: node.querySelector('.synth-params'),
    stepGrid: node.querySelector('.step-grid'),
  stepRefs: [],
  drumSelector: null,
  activeDrum: 'kick',
  activeSamplerSlot: SAMPLER_SLOT_IDS[0],
  stepControl: null,
};

  const controlsRow = document.createElement('div');
  controlsRow.className = 'instrument-controls';

  const stepControl = document.createElement('div');
  stepControl.className = 'step-length-control';

  const stepLabel = document.createElement('span');
  stepLabel.textContent = 'Steps';

  const stepSlider = document.createElement('input');
  stepSlider.type = 'range';
  stepSlider.min = String(STEP_COUNT_MIN);
  stepSlider.max = String(STEP_COUNT_MAX);
  stepSlider.step = '1';

  const stepNumberInput = document.createElement('input');
  stepNumberInput.type = 'number';
  stepNumberInput.min = String(STEP_COUNT_MIN);
  stepNumberInput.max = String(STEP_COUNT_MAX);
  stepNumberInput.step = '1';
  stepNumberInput.className = 'numeric-input step-count-input';

  const stepValue = document.createElement('span');

  const presetContainer = document.createElement('div');
  presetContainer.className = 'step-presets';
  const presetValues = [16, 32, 64, 128];
  const presetButtons = presetValues.map((preset) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'step-preset-button';
    button.textContent = String(preset);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (state.activeInstrumentId !== instrument.id) {
        setActiveInstrument(instrument.id);
      }
      if (cardEntry.stepControl?.manualEditing) {
        cardEntry.stepControl.manualEditing.editing = false;
      }
      requestInstrumentStepCountChange(instrument.id, preset);
    });
    presetContainer.appendChild(button);
    return button;
  });

  stepControl.append(stepLabel, stepSlider, stepNumberInput, stepValue, presetContainer);
  controlsRow.appendChild(stepControl);
  node.insertBefore(controlsRow, cardEntry.paramsContainer);

  const instrumentId = instrument.id;
  const getCurrentStepCount = () => {
    const latest = state.instruments.get(instrumentId);
    if (!latest) {
      return STEP_COUNT;
    }
    const latestSteps = Array.isArray(latest.steps) ? latest.steps.length : STEP_COUNT;
    return clampStepCount(latest.stepCount ?? latestSteps ?? STEP_COUNT);
  };
  const manualStepState = { editing: false };
  stepSlider.addEventListener('input', (event) => {
    event.stopPropagation();
    if (state.activeInstrumentId !== instrument.id) {
      setActiveInstrument(instrument.id);
    }
    manualStepState.editing = false;
    const preview = clampStepCount(stepSlider.value);
    stepNumberInput.value = String(preview);
    stepValue.textContent = formatStepCountLabel(preview);
    presetButtons.forEach((button) => {
      const presetValue = Number(button.textContent);
      button.classList.toggle('selected', presetValue === preview);
    });
  });

  stepSlider.addEventListener('change', (event) => {
    event.stopPropagation();
    if (state.activeInstrumentId !== instrument.id) {
      setActiveInstrument(instrument.id);
    }
    manualStepState.editing = false;
    const desired = clampStepCount(stepSlider.value);
    requestInstrumentStepCountChange(instrumentId, desired);
  });

  stepNumberInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      if (manualStepState.editing) {
        event.preventDefault();
        if (stepNumberInput.value !== '') {
          const desired = clampStepCount(stepNumberInput.value);
          stepNumberInput.value = String(desired);
          requestInstrumentStepCountChange(instrumentId, desired);
        }
        manualStepState.editing = false;
        return;
      }
    }

    if (event.key === 'Escape') {
      manualStepState.editing = false;
      const current = getCurrentStepCount();
      stepNumberInput.value = String(current);
      stepValue.textContent = formatStepCountLabel(current);
      presetButtons.forEach((button) => {
        const presetValue = Number(button.textContent);
        button.classList.toggle('selected', presetValue === current);
      });
      return;
    }

    const printable = event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
    const editingKeys = ['Backspace', 'Delete'];
    if (printable || editingKeys.includes(event.key)) {
      manualStepState.editing = true;
    }
  });

  stepNumberInput.addEventListener('input', (event) => {
    event.stopPropagation();
    if (state.activeInstrumentId !== instrument.id) {
      setActiveInstrument(instrument.id);
    }
    if (!manualStepState.editing && stepNumberInput.value !== '') {
      const desired = clampStepCount(stepNumberInput.value);
      stepNumberInput.value = String(desired);
      requestInstrumentStepCountChange(instrumentId, desired);
    }
  });

  stepNumberInput.addEventListener('change', (event) => {
    event.stopPropagation();
    if (state.activeInstrumentId !== instrument.id) {
      setActiveInstrument(instrument.id);
    }
    if (manualStepState.editing) {
      manualStepState.editing = false;
      const current = getCurrentStepCount();
      stepNumberInput.value = String(current);
      stepValue.textContent = formatStepCountLabel(current);
      presetButtons.forEach((button) => {
        const presetValue = Number(button.textContent);
        button.classList.toggle('selected', presetValue === current);
      });
      return;
    }
    if (stepNumberInput.value === '') {
      const current = getCurrentStepCount();
      stepNumberInput.value = String(current);
      return;
    }
    const desired = clampStepCount(stepNumberInput.value);
    stepNumberInput.value = String(desired);
    requestInstrumentStepCountChange(instrumentId, desired);
  });

  stepNumberInput.addEventListener('blur', () => {
    manualStepState.editing = false;
    const current = getCurrentStepCount();
    stepNumberInput.value = String(current);
    stepValue.textContent = formatStepCountLabel(current);
    presetButtons.forEach((button) => {
      const presetValue = Number(button.textContent);
      button.classList.toggle('selected', presetValue === current);
    });
  });

  cardEntry.stepControl = {
    container: controlsRow,
    slider: stepSlider,
    input: stepNumberInput,
    value: stepValue,
    presets: presetButtons,
    manualEditing: manualStepState,
  };

  const drumSelector = document.createElement('div');
  drumSelector.className = 'drum-selector hidden';
  cardEntry.drumSelector = drumSelector;
  node.insertBefore(drumSelector, cardEntry.stepGrid);

  instrumentElements.set(instrument.id, cardEntry);
  updateInstrumentCard(node, instrument);
  return node;
}

function updateInstrumentCard(card, instrument) {
  const entry = instrumentElements.get(instrument.id);
  const definition = INSTRUMENT_LIBRARY[instrument.type] || INSTRUMENT_LIBRARY[SynthTypes.POLY];
  card.dataset.instrumentId = instrument.id;
  card.classList.remove('tone-acid', 'tone-808', 'tone-poly', 'tone-sampler');
  if (definition.toneClass) {
    card.classList.add(definition.toneClass);
  }

  const titleEl = card.querySelector('.synth-meta h3');
  const typeEl = card.querySelector('.synth-meta span');
  titleEl.textContent = instrument.name || definition.label;
  typeEl.textContent = definition.typeLabel || instrument.type;

  const paramsContainer = entry.paramsContainer;
  renderParamControls(paramsContainer, instrument, definition);

  if (entry.stepControl) {
    const stepCount = clampStepCount(instrument.stepCount ?? (Array.isArray(instrument.steps) ? instrument.steps.length : STEP_COUNT));
    entry.stepControl.slider.value = String(stepCount);
    entry.stepControl.value.textContent = formatStepCountLabel(stepCount);
    if (entry.stepControl.input) {
      entry.stepControl.input.value = String(stepCount);
    }
    if (Array.isArray(entry.stepControl.presets)) {
      entry.stepControl.presets.forEach((button) => {
        const presetValue = Number(button.textContent);
        button.classList.toggle('selected', presetValue === stepCount);
      });
    }
    if (entry.stepControl.manualEditing) {
      entry.stepControl.manualEditing.editing = false;
    }
  }

  if (entry.drumSelector) {
    if (instrument.type === SynthTypes.TR808) {
      entry.drumSelector.classList.remove('hidden');
      if (!entry.activeDrum || !TR808_DRUMS.some((drum) => drum.id === entry.activeDrum)) {
        entry.activeDrum = TR808_DRUMS[0].id;
      }
      renderDrumSelector(entry, instrument);
    } else if (instrument.type === SynthTypes.SAMPLER) {
      entry.drumSelector.classList.remove('hidden');
      if (!entry.activeSamplerSlot || !SAMPLER_SLOT_IDS.includes(entry.activeSamplerSlot)) {
        entry.activeSamplerSlot = SAMPLER_SLOT_IDS[0];
      }
      renderSamplerSelector(entry, instrument, definition);
    } else {
      entry.drumSelector.classList.add('hidden');
    }
  }

  const stepGrid = entry.stepGrid;
  renderStepGrid(stepGrid, instrument);
}

function renderDrumSelector(entry, instrument) {
  const container = entry.drumSelector;
  container.innerHTML = '';

  TR808_DRUMS.forEach((drum) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'drum-button';
    button.dataset.drum = drum.id;
    button.textContent = drum.label;
    button.style.setProperty('--drum-color', drum.color);
    if (entry.activeDrum === drum.id) {
      button.classList.add('active');
    }

    button.addEventListener('click', () => {
      if (entry.activeDrum === drum.id) {
        return;
      }
      entry.activeDrum = drum.id;
      renderDrumSelector(entry, instrument);
      renderStepGrid(entry.stepGrid, instrument);
      updatePlaybackIndicators(getCurrentStepIndex());
    });

    container.appendChild(button);
  });
}

function renderSamplerSelector(entry, instrument, definition) {
  const container = entry.drumSelector;
  container.innerHTML = '';
  const slots = instrument.params?.slots || {};
  const activeSlot = entry.activeSamplerSlot && SAMPLER_SLOT_IDS.includes(entry.activeSamplerSlot)
    ? entry.activeSamplerSlot
    : SAMPLER_SLOT_IDS[0];
  entry.activeSamplerSlot = activeSlot;

  SAMPLER_SLOT_CONFIG.forEach((slotConfig) => {
    const slotId = slotConfig.id;
    const slotState = slots[slotId] || createDefaultSamplerSlot(slotId);
    const wrapper = document.createElement('div');
    wrapper.className = 'sampler-slot';
    wrapper.dataset.slotId = slotId;
    wrapper.style.setProperty('--sampler-color', slotConfig.color);
    if (slotId === activeSlot) {
      wrapper.classList.add('active');
    }

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'drum-button sampler-slot-button';
    selectBtn.textContent = slotId;
    if (slotId === activeSlot) {
      selectBtn.classList.add('active');
    }
    selectBtn.addEventListener('click', () => {
      if (entry.activeSamplerSlot === slotId) {
        return;
      }
      entry.activeSamplerSlot = slotId;
      renderSamplerSelector(entry, instrument, definition);
      renderParamControls(entry.paramsContainer, instrument, definition);
      renderStepGrid(entry.stepGrid, instrument);
      updatePlaybackIndicators(getCurrentStepIndex());
    });

    const infoLabel = document.createElement('span');
    infoLabel.className = 'sampler-slot-info';
    infoLabel.textContent = slotState.sample?.name || 'Drop WAV/MP3';

    const actions = document.createElement('div');
    actions.className = 'sampler-slot-actions';

    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'subtle sampler-upload-button';
    uploadBtn.textContent = slotState.sample ? 'Replace' : 'Upload';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = SAMPLER_ALLOWED_MIME_TYPES.join(',');
    fileInput.className = 'sampler-slot-file-input';
    fileInput.addEventListener('change', () => {
      const [file] = fileInput.files || [];
      if (file) {
        handleSamplerFileUpload(instrument.id, slotId, file);
      }
      fileInput.value = '';
    });

    uploadBtn.addEventListener('click', () => {
      fileInput.click();
    });

    actions.appendChild(uploadBtn);

    if (slotState.sample) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'subtle sampler-clear-button';
      clearBtn.textContent = 'Clear';
      clearBtn.addEventListener('click', () => {
        handleSamplerSampleClear(instrument.id, slotId);
      });
      actions.appendChild(clearBtn);
    }

    wrapper.appendChild(selectBtn);
    wrapper.appendChild(infoLabel);
    wrapper.appendChild(actions);
    wrapper.appendChild(fileInput);

    enableSamplerSlotDrop(wrapper, instrument.id, slotId, infoLabel);

    container.appendChild(wrapper);
  });
}

function renderSamplerParamControls(container, instrument) {
  const entry = instrumentElements.get(instrument.id);
  if (!entry) {
    container.textContent = 'Sampler unavailable.';
    return;
  }

  const slotId = entry.activeSamplerSlot && SAMPLER_SLOT_IDS.includes(entry.activeSamplerSlot)
    ? entry.activeSamplerSlot
    : SAMPLER_SLOT_IDS[0];
  entry.activeSamplerSlot = slotId;
  const slot = instrument.params?.slots?.[slotId] || createDefaultSamplerSlot(slotId);

  const header = document.createElement('div');
  header.className = 'sampler-params-header';
  header.textContent = `Slot ${slotId}`;
  container.appendChild(header);

  const sampleStatus = document.createElement('div');
  sampleStatus.className = 'sampler-sample-status';
  if (slot.sample) {
    const sizeLabel = typeof slot.sample.bytesLength === 'number' ? ` · ${formatBytes(slot.sample.bytesLength)}` : '';
    sampleStatus.textContent = `Sample: ${slot.sample.name}${sizeLabel}`;
  } else {
    sampleStatus.textContent = 'No sample loaded.';
  }
  container.appendChild(sampleStatus);

  appendSamplerRangeControl(container, instrument.id, slotId, {
    key: 'volume',
    label: 'Volume',
    min: 0,
    max: 1,
    step: 0.01,
    value: clampValue(slot.volume ?? 1, 0, 1),
    format: (value) => value.toFixed(2),
  });

  appendSamplerRangeControl(container, instrument.id, slotId, {
    key: 'pan',
    label: 'Pan',
    min: -1,
    max: 1,
    step: 0.01,
    value: clampValue(slot.pan ?? 0, -1, 1),
    format: (value) => value.toFixed(2),
  });

  appendSamplerRangeControl(container, instrument.id, slotId, {
    key: 'pitch',
    label: 'Pitch (semitones)',
    min: -24,
    max: 24,
    step: 0.1,
    value: clampValue(slot.pitch ?? 0, -24, 24),
    format: (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`,
  });

  const startControl = appendSamplerRangeControl(container, instrument.id, slotId, {
    key: 'startOffset',
    label: 'Start Offset',
    min: 0,
    max: 0.99,
    step: 0.01,
    value: clampValue(slot.startOffset ?? 0, 0, 0.99),
    format: (value) => `${Math.round(value * 100)}%`,
  });
  const endControl = appendSamplerRangeControl(container, instrument.id, slotId, {
    key: 'endOffset',
    label: 'End Offset',
    min: 0.01,
    max: 1,
    step: 0.01,
    value: clampValue(slot.endOffset ?? 1, 0.01, 1),
    format: (value) => `${Math.round(value * 100)}%`,
  });

  startControl.onCommit = (rawValue) => {
    let value = clampValue(rawValue, 0, 0.99);
    const endValue = clampValue(Number(endControl.input.value), 0.01, 1);
    if (value >= endValue - 0.01) {
      value = clampValue(endValue - 0.01, 0, 0.99);
      startControl.input.value = value.toFixed(2);
      startControl.badge.textContent = `${Math.round(value * 100)}%`;
    }
    updateSamplerSlotLocal(instrument.id, slotId, { startOffset: value });
    emitSamplerParamUpdate(instrument.id, slotId, { startOffset: value });
  };

  endControl.onCommit = (rawValue) => {
    let value = clampValue(rawValue, 0.01, 1);
    const startValue = clampValue(Number(startControl.input.value), 0, 0.99);
    if (value <= startValue + 0.01) {
      value = clampValue(startValue + 0.01, 0.01, 1);
      endControl.input.value = value.toFixed(2);
      endControl.badge.textContent = `${Math.round(value * 100)}%`;
    }
    updateSamplerSlotLocal(instrument.id, slotId, { endOffset: value });
    emitSamplerParamUpdate(instrument.id, slotId, { endOffset: value });
  };

  appendSamplerToggleControl(container, instrument.id, slotId, {
    key: 'reverse',
    label: 'Reverse Playback',
    value: Boolean(slot.reverse),
  });

  appendSamplerToggleControl(container, instrument.id, slotId, {
    key: 'mute',
    label: 'Mute Slot',
    value: Boolean(slot.mute),
  });
}

function renderSamplerStepGrid(container, instrument) {
  container.innerHTML = '';
  const steps = instrument.steps || [];
  const instrumentStepCount = clampStepCount(instrument.stepCount ?? (Array.isArray(steps) ? steps.length : STEP_COUNT));
  const visibleSteps = getVisibleStepSlots(instrumentStepCount);
  const entry = instrumentElements.get(instrument.id);
  if (!entry) {
    return;
  }
  const activeSlot = entry.activeSamplerSlot && SAMPLER_SLOT_IDS.includes(entry.activeSamplerSlot)
    ? entry.activeSamplerSlot
    : SAMPLER_SLOT_IDS[0];
  const slotMeta = SAMPLER_SLOT_CONFIG.find((slot) => slot.id === activeSlot) || SAMPLER_SLOT_CONFIG[0];
  const stepRefs = [];

  for (let i = 0; i < visibleSteps; i += 1) {
    const patternIndex = i;
    const withinPattern = patternIndex < instrumentStepCount;
    const base = createEmptySamplerStep();
    const existing = steps[patternIndex] ? normalizeSamplerStep(steps[patternIndex]) : base;
    if (!steps[patternIndex]) {
      steps[patternIndex] = existing;
    }

    const isActive = withinPattern && Boolean(existing.slots[activeSlot]);
    const cell = document.createElement('div');
    cell.className = 'step-cell sampler-cell';
    cell.classList.toggle('active', isActive);
    cell.classList.toggle('step-disabled', !withinPattern);
    cell.style.setProperty('--sampler-color', slotMeta.color);

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'step-toggle sampler-step-toggle';
    toggleBtn.dataset.stepIndex = String(patternIndex);
    toggleBtn.disabled = !withinPattern;

    const indicator = document.createElement('span');
    indicator.className = 'sampler-indicator';
    indicator.style.setProperty('--sampler-color', slotMeta.color);
    indicator.classList.toggle('active', isActive);

    const indexLabel = document.createElement('span');
    indexLabel.className = 'step-index';
    indexLabel.textContent = formatStepIndex(i, visibleSteps);

    toggleBtn.appendChild(indicator);
    toggleBtn.appendChild(indexLabel);

    toggleBtn.addEventListener('click', () => {
      if (!withinPattern) {
        return;
      }
      const nextValue = !existing.slots[activeSlot];
      existing.slots[activeSlot] = nextValue;
      existing.active = Object.values(existing.slots).some(Boolean);
      indicator.classList.toggle('active', nextValue);
      cell.classList.toggle('active', nextValue);
      socket.emit('instrument:step', {
        instrumentId: instrument.id,
        stepIndex: patternIndex,
        slot: activeSlot,
        value: nextValue,
      });
    });

    cell.appendChild(toggleBtn);
    container.appendChild(cell);
    stepRefs.push({ cell, toggleBtn, indicator, disabled: !withinPattern });
  }

  entry.stepRefs = stepRefs;
}

function appendSamplerRangeControl(container, instrumentId, slotId, options) {
  const {
    key,
    label,
    min,
    max,
    step,
    value,
    format,
  } = options;

  const control = document.createElement('div');
  control.className = 'param-control sampler-param-control';

  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  control.appendChild(labelEl);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  control.appendChild(input);

  const badge = document.createElement('span');
  badge.className = 'param-value';
  badge.textContent = format(value);
  control.appendChild(badge);

  const api = {
    input,
    badge,
    onCommit: null,
  };

  input.addEventListener('input', () => {
    const parsed = clampValue(Number(input.value), min, max);
    badge.textContent = format(parsed);
  });

  input.addEventListener('change', () => {
    const parsed = clampValue(Number(input.value), min, max);
    badge.textContent = format(parsed);
    if (typeof api.onCommit === 'function') {
      api.onCommit(parsed);
    } else {
      updateSamplerSlotLocal(instrumentId, slotId, { [key]: parsed });
      emitSamplerParamUpdate(instrumentId, slotId, { [key]: parsed });
    }
  });

  container.appendChild(control);
  return api;
}

function appendSamplerToggleControl(container, instrumentId, slotId, options) {
  const { key, label, value } = options;
  const control = document.createElement('div');
  control.className = 'param-control sampler-toggle-control';

  const labelEl = document.createElement('label');
  labelEl.className = 'sampler-toggle-label';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = Boolean(value);
  checkbox.addEventListener('change', () => {
    const next = Boolean(checkbox.checked);
    updateSamplerSlotLocal(instrumentId, slotId, { [key]: next });
    emitSamplerParamUpdate(instrumentId, slotId, { [key]: next });
  });

  labelEl.appendChild(checkbox);
  const text = document.createElement('span');
  text.textContent = ` ${label}`;
  labelEl.appendChild(text);

  control.appendChild(labelEl);
  container.appendChild(control);
}

function updateSamplerSlotLocal(instrumentId, slotId, updates) {
  const instrument = state.instruments.get(instrumentId);
  if (!instrument || instrument.type !== SynthTypes.SAMPLER) {
    return null;
  }
  if (!instrument.params || typeof instrument.params !== 'object') {
    instrument.params = { slots: {} };
  }
  if (!instrument.params.slots) {
    instrument.params.slots = {};
  }
  if (!instrument.params.slots[slotId]) {
    instrument.params.slots[slotId] = createDefaultSamplerSlot(slotId);
  }
  const slot = instrument.params.slots[slotId];
  Object.entries(updates || {}).forEach(([key, value]) => {
    if (key === 'sample') {
      slot.sample = value ? { ...value } : null;
    } else {
      slot[key] = value;
    }
  });
  return slot;
}

function emitSamplerParamUpdate(instrumentId, slotId, updates) {
  if (!instrumentId || !slotId || !updates || typeof updates !== 'object') {
    return;
  }
  if (!state.isInRoom) {
    return;
  }
  socket.emit('instrument:param', {
    instrumentId,
    params: {
      slots: {
        [slotId]: updates,
      },
    },
  });
}

function handleSamplerFileUpload(instrumentId, slotId, file) {
  if (!validateSamplerFile(file)) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const result = reader.result;
    if (!(result instanceof ArrayBuffer)) {
      window.alert('Unable to read the selected audio file.');
      return;
    }
    const base64 = arrayBufferToBase64(result);
    const sampleMeta = {
      name: file.name,
      mimeType: file.type || 'audio/wav',
      data: base64,
      bytesLength: file.size,
      updatedAt: Date.now(),
    };
    updateSamplerSlotLocal(instrumentId, slotId, { sample: sampleMeta });
    const instrument = state.instruments.get(instrumentId);
    if (instrument) {
      prepareSamplerAudio(instrument);
      renderInstrument(instrumentId);
    }
    emitSamplerParamUpdate(instrumentId, slotId, { sample: sampleMeta });
  };
  reader.onerror = () => {
    window.alert('Failed to read the selected audio file.');
  };
  reader.readAsArrayBuffer(file);
}

function handleSamplerSampleClear(instrumentId, slotId) {
  updateSamplerSlotLocal(instrumentId, slotId, { sample: null });
  const key = samplerSlotKey(instrumentId, slotId);
  audioState.samplerBuffers.delete(key);
  audioState.pendingSamplerLoads.delete(key);
  renderInstrument(instrumentId);
  emitSamplerParamUpdate(instrumentId, slotId, { sample: null });
}

function enableSamplerSlotDrop(target, instrumentId, slotId, infoLabel) {
  const highlight = () => target.classList.add('drag-over');
  const clearHighlight = () => target.classList.remove('drag-over');

  target.addEventListener('dragenter', (event) => {
    event.preventDefault();
    highlight();
  });
  target.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  target.addEventListener('dragleave', () => {
    clearHighlight();
  });
  target.addEventListener('dragend', () => {
    clearHighlight();
  });
  target.addEventListener('drop', (event) => {
    event.preventDefault();
    clearHighlight();
    const files = event.dataTransfer?.files;
    if (!files || !files.length) {
      return;
    }
    const file = files[0];
    if (!file) {
      return;
    }
    if (!validateSamplerFile(file)) {
      return;
    }
    handleSamplerFileUpload(instrumentId, slotId, file);
  });

  if (infoLabel) {
    target.addEventListener('dragenter', () => {
      infoLabel.dataset.previousText = infoLabel.textContent || '';
      infoLabel.textContent = 'Release to upload';
    });
    target.addEventListener('dragleave', () => {
      if (infoLabel.dataset.previousText) {
        infoLabel.textContent = infoLabel.dataset.previousText;
        delete infoLabel.dataset.previousText;
      }
    });
    target.addEventListener('drop', () => {
      if (infoLabel.dataset.previousText) {
        infoLabel.textContent = infoLabel.dataset.previousText;
        delete infoLabel.dataset.previousText;
      }
    });
  }
}

function validateSamplerFile(file) {
  if (!file) {
    return false;
  }
  if (file.size > SAMPLER_MAX_SAMPLE_BYTES) {
    const limitMb = (SAMPLER_MAX_SAMPLE_BYTES / (1024 * 1024)).toFixed(1);
    window.alert(`Please choose a file smaller than ${limitMb} MB.`);
    return false;
  }
  if (file.type) {
    if (!SAMPLER_ALLOWED_MIME_TYPES.includes(file.type)) {
      window.alert('Unsupported audio format. Please use WAV or MP3 files.');
      return false;
    }
  } else {
    const extension = (file.name || '').toLowerCase().split('.').pop();
    if (!['wav', 'mp3'].includes(extension)) {
      window.alert('Unsupported audio format. Please use WAV or MP3 files.');
      return false;
    }
  }
  return true;
}

function arrayBufferToBase64(buffer) {
  if (!(buffer instanceof ArrayBuffer)) {
    return '';
  }
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return window.btoa(binary);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderParamControls(container, instrument, definition) {
  container.innerHTML = '';
  if (instrument.type === SynthTypes.SAMPLER) {
    renderSamplerParamControls(container, instrument, definition);
    return;
  }
  (definition.params || []).forEach((paramDef) => {
    const control = document.createElement('div');
    control.className = 'param-control';

    const label = document.createElement('label');
    label.htmlFor = `${instrument.id}-${paramDef.key}`;
    label.textContent = paramDef.label;

    control.appendChild(label);

    if (paramDef.type === 'range') {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(paramDef.min);
      input.max = String(paramDef.max);
      input.step = String(paramDef.step ?? 0.01);
      const initialValue = resolveInstrumentParamValue(instrument, paramDef);
      input.value = String(initialValue);
      input.id = `${instrument.id}-${paramDef.key}`;

      const valueBadge = document.createElement('span');
      valueBadge.textContent = formatParamDisplay(initialValue, paramDef);
      valueBadge.style.fontSize = '0.75rem';
      valueBadge.style.opacity = '0.8';

      input.addEventListener('input', () => {
        valueBadge.textContent = formatParamDisplay(input.value, paramDef);
      });

      input.addEventListener('change', () => {
        let numericValue = Number(input.value);
        if (!Number.isFinite(numericValue)) {
          const resetValue = resolveInstrumentParamValue(instrument, paramDef);
          input.value = String(resetValue);
          valueBadge.textContent = formatParamDisplay(resetValue, paramDef);
          return;
        }

        numericValue = clampValue(numericValue, paramDef.min, paramDef.max);
        input.value = String(numericValue);
        valueBadge.textContent = formatParamDisplay(numericValue, paramDef);

        const paramsPayload = createInstrumentParamUpdate(instrument, paramDef, numericValue);
        if (!paramsPayload) {
          return;
        }

        socket.emit('instrument:param', {
          instrumentId: instrument.id,
          params: paramsPayload,
        });
      });

      control.appendChild(input);
      control.appendChild(valueBadge);
    } else if (paramDef.type === 'select') {
      const select = document.createElement('select');
      select.id = `${instrument.id}-${paramDef.key}`;
      (paramDef.options || []).forEach((option) => {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        select.appendChild(opt);
      });
      select.value = instrument.params[paramDef.key] ?? paramDef.options?.[0]?.value ?? '';
      select.addEventListener('change', () => {
        socket.emit('instrument:param', {
          instrumentId: instrument.id,
          params: { [paramDef.key]: select.value },
        });
      });
      control.appendChild(select);
    }

    container.appendChild(control);
  });
}

function resolveInstrumentParamValue(instrument, paramDef) {
  const params = instrument.params || {};
  let rawValue = params[paramDef.key];

  if (instrument.type === SynthTypes.TR808 && paramDef.key === 'tone') {
    rawValue = params.hatTone ?? params.tone ?? params?.hat?.tone ?? rawValue;
  }

  return clampValue(rawValue, paramDef.min, paramDef.max);
}

function createInstrumentParamUpdate(instrument, paramDef, value) {
  if (instrument.type === SynthTypes.TR808 && paramDef.key === 'tone') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return { hat: { tone: value }, tone: value };
  }

  if (!Number.isFinite(value)) {
    return null;
  }

  return { [paramDef.key]: value };
}

function renderStepGrid(container, instrument) {
  if (instrument.type === SynthTypes.TR808) {
    renderDrumStepGrid(container, instrument);
  } else if (instrument.type === SynthTypes.SAMPLER) {
    renderSamplerStepGrid(container, instrument);
  } else {
    renderMelodicStepGrid(container, instrument);
  }
}

function renderMelodicStepGrid(container, instrument) {
  container.innerHTML = '';
  const steps = instrument.steps || [];
  const entry = instrumentElements.get(instrument.id);
  const instrumentStepCount = clampStepCount(instrument.stepCount ?? (Array.isArray(steps) ? steps.length : STEP_COUNT));
  const visibleSteps = getVisibleStepSlots(instrumentStepCount);
  const activeSteps = instrumentStepCount;
  const stepRefs = [];

  for (let i = 0; i < visibleSteps; i += 1) {
    const patternIndex = i;
    const withinPattern = patternIndex < activeSteps;

    let step = steps[patternIndex];
    if (!step && withinPattern) {
      step = createEmptyMelodicStep();
      steps[patternIndex] = step;
    } else if (!step) {
      step = createEmptyMelodicStep();
    }

    const cell = document.createElement('div');
    cell.className = 'step-cell';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'step-toggle';
    toggleBtn.dataset.stepIndex = String(patternIndex);

    const note = document.createElement('span');
    note.className = 'step-note';
    note.textContent = step.pitch || '—';

    const indexLabel = document.createElement('span');
    indexLabel.className = 'step-index';
    indexLabel.textContent = formatStepIndex(i, visibleSteps);

    toggleBtn.appendChild(note);
    toggleBtn.appendChild(indexLabel);

    const isActive = withinPattern && Boolean(step.active);
    toggleBtn.classList.toggle('active', isActive);
    toggleBtn.disabled = !withinPattern;
    cell.classList.toggle('active', isActive);
    cell.classList.toggle('step-disabled', !withinPattern);

    if (withinPattern) {
      toggleBtn.addEventListener('click', () => {
        const nextActive = !step.active;
        step.active = nextActive;
        toggleBtn.classList.toggle('active', nextActive);
        cell.classList.toggle('active', nextActive);
        socket.emit('instrument:step', {
          instrumentId: instrument.id,
          stepIndex: patternIndex,
          step: { active: nextActive },
        });
      });
    }

    const pitchSelect = createPitchSelect(step.pitch || 'C3');
    if (withinPattern) {
      const resolvedInitial = pitchSelect.value;
      step.pitch = resolvedInitial;
      note.textContent = resolvedInitial;
      pitchSelect.addEventListener('change', (event) => {
        event.stopPropagation();
        const selectedNote = pitchSelect.value;
        step.pitch = selectedNote;
        note.textContent = selectedNote;
        socket.emit('instrument:step', {
          instrumentId: instrument.id,
          stepIndex: patternIndex,
          step: { pitch: selectedNote },
        });
      });
    } else {
      pitchSelect.disabled = true;
      pitchSelect.classList.add('step-select-disabled');
    }

    pitchSelect.addEventListener('click', (event) => event.stopPropagation());

    cell.appendChild(toggleBtn);
    cell.appendChild(pitchSelect);
    container.appendChild(cell);

    stepRefs.push({ cell, toggleBtn, pitchSelect, disabled: !withinPattern });
  }

  if (entry) {
    entry.stepRefs = stepRefs;
  }
}

function renderDrumStepGrid(container, instrument) {
  container.innerHTML = '';
  const steps = instrument.steps || [];
  const instrumentStepCount = clampStepCount(instrument.stepCount ?? (Array.isArray(steps) ? steps.length : STEP_COUNT));
  const visibleSteps = getVisibleStepSlots(instrumentStepCount);
  const activeSteps = instrumentStepCount;
  const entry = instrumentElements.get(instrument.id);
  if (!entry) {
    return;
  }
  const activeDrum = entry?.activeDrum || TR808_DRUMS[0].id;
  const stepRefs = [];

  for (let i = 0; i < visibleSteps; i += 1) {
    const patternIndex = i;
    const withinPattern = patternIndex < activeSteps;
    const baseStep = createEmptyDrumStep();
    const originalStep = steps[patternIndex] || createEmptyDrumStep();
    originalStep.layers = { ...baseStep.layers, ...(originalStep.layers || {}) };
    if (!steps[patternIndex] && withinPattern) {
      steps[patternIndex] = originalStep;
    }
    const step = originalStep;

    const cell = document.createElement('div');
    cell.className = 'step-cell drum-cell';
    const drumMeta = TR808_DRUMS.find((drum) => drum.id === activeDrum) || TR808_DRUMS[0];
    const isActive = withinPattern && Boolean(step.layers[activeDrum]);
    step.active = TR808_DRUMS.some((drum) => step.layers[drum.id]);
    const activeBackground = hexToRgba(drumMeta.color, 0.25) || 'rgba(56, 189, 248, 0.22)';
    cell.style.setProperty('--drum-color', drumMeta.color);
    cell.style.setProperty('--drum-active-bg', activeBackground);
    cell.classList.toggle('active', isActive);
    cell.classList.toggle('drum-active', isActive);
    cell.classList.toggle('step-disabled', !withinPattern);

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'step-toggle drum-step-toggle';
    toggleBtn.dataset.stepIndex = String(patternIndex);
    toggleBtn.disabled = !withinPattern;

    const indicator = document.createElement('span');
    indicator.className = 'drum-indicator';
    indicator.style.setProperty('--drum-color', drumMeta.color);
    indicator.classList.toggle('active', isActive);

    const indexLabel = document.createElement('span');
    indexLabel.className = 'step-index';
    indexLabel.textContent = formatStepIndex(i, visibleSteps);

    toggleBtn.appendChild(indicator);
    toggleBtn.appendChild(indexLabel);

    toggleBtn.addEventListener('click', () => {
      if (!withinPattern) {
        return;
      }
      const currentDrum = entry.activeDrum || TR808_DRUMS[0].id;
      const current = Boolean(step.layers[currentDrum]);
      const next = !current;
      step.layers[currentDrum] = next;

      const drumInfo = TR808_DRUMS.find((d) => d.id === currentDrum) || drumMeta;
      const selectedColor = drumInfo.color;
      indicator.style.setProperty('--drum-color', selectedColor);
      const selectedBackground = hexToRgba(selectedColor, 0.25) || activeBackground;

      const isActiveNow = Boolean(step.layers[currentDrum]);
      indicator.classList.toggle('active', isActiveNow && currentDrum === entry.activeDrum);
      cell.style.setProperty('--drum-color', selectedColor);
      cell.style.setProperty('--drum-active-bg', selectedBackground);
      cell.classList.toggle('drum-active', isActiveNow && currentDrum === entry.activeDrum);
      cell.classList.toggle('active', isActiveNow && currentDrum === entry.activeDrum);

      step.active = TR808_DRUMS.some((drum) => step.layers[drum.id]);

      socket.emit('instrument:step', {
        instrumentId: instrument.id,
        stepIndex: patternIndex,
        drum: currentDrum,
        value: next,
      });
    });

    cell.appendChild(toggleBtn);
    container.appendChild(cell);

    stepRefs.push({ cell, toggleBtn, indicator, disabled: !withinPattern });
  }

  if (entry) {
    entry.stepRefs = stepRefs;
  }
}

function removeInstrumentCard(instrumentId) {
  const entry = instrumentElements.get(instrumentId);
  if (!entry) {
    return;
  }
  entry.root.remove();
  instrumentElements.delete(instrumentId);
  updatePlaybackIndicators(getCurrentStepIndex());
}

function renderEmptyState() {
  if (!state.instrumentOrder.length) {
    instrumentEmptyEl.classList.remove('hidden');
  } else {
    instrumentEmptyEl.classList.add('hidden');
  }
}

function updatePlaybackIndicators(stepIndex) {
  instrumentElements.forEach(({ stepRefs }, instrumentId) => {
    if (!stepRefs || !stepRefs.length) {
      return;
    }

    const instrument = state.instruments.get(instrumentId);
    if (!instrument) {
      stepRefs.forEach((ref) => ref.cell.classList.remove('playing'));
      return;
    }

    const instrumentStepCount = clampStepCount(instrument.stepCount ?? (Array.isArray(instrument.steps) ? instrument.steps.length : STEP_COUNT));
    const normalizedIndex = stepIndex >= 0 && instrumentStepCount > 0 ? stepIndex % instrumentStepCount : -1;

    stepRefs.forEach((ref, index) => {
      const canPlay = index < instrumentStepCount && !ref?.disabled;
      const isPlaying = state.transport.playing && canPlay && normalizedIndex === index;
      ref.cell.classList.toggle('playing', isPlaying);
    });
  });
}

function getCurrentStepIndex() {
  if (!state.transport.playing || !state.transport.sessionStartTime) {
    return -1;
  }

  const stepDurationMs = getStepDurationMs();
  if (!Number.isFinite(stepDurationMs) || stepDurationMs <= 0) {
    return -1;
  }

  const elapsed = getServerSyncedTime() - state.transport.sessionStartTime;
  if (elapsed < 0) {
    return -1;
  }

  return Math.floor(elapsed / stepDurationMs);
}

function connectToRoom(roomId, { mode }) {
  if (pendingRoomRequest) {
    return;
  }
  pendingRoomRequest = true;

  state.isInRoom = false;
  state.roomId = null;
  state.instruments.clear();
  state.instrumentOrder = [];
  state.activeInstrumentId = null;
  renderInstruments();
  updateConnectionsDisplay(0);

  if (!socket.connected) {
    socket.connect();
  }

  const eventName = mode === 'create' ? 'room:create' : 'room:join';
  socket.emit(eventName, { roomId }, (response = {}) => {
    pendingRoomRequest = false;

    if (!response.ok) {
      handleRoomError(mode, response.error);
      return;
    }

    state.isInRoom = true;
    state.roomId = response.roomId || roomId;
    showSequencer();
    roomDisplayEl.textContent = `Room: ${state.roomId}`;
    transportToggleBtn.disabled = false;
    updateTempoDisplay(state.transport.bpm);
  });
}

function handleRoomError(mode, errorCode) {
  if (mode === 'create' && errorCode === 'room-already-exists') {
    window.alert('Room already exists. Try generating a new code.');
  } else if (mode === 'join' && errorCode === 'room-not-found') {
    window.alert('Could not find that room. Check the code and try again.');
  } else if (errorCode === 'invalid-room-id') {
    window.alert('Room code is invalid.');
  } else if (errorCode) {
    window.alert(`Unable to connect: ${errorCode}`);
  } else {
    window.alert('Unable to connect to that room.');
  }
  showLanding();
  showRoomCodeHint('');
}

function leaveRoom() {
  if (!state.isInRoom) {
    showLanding();
    return;
  }

  if (audioState.isRecording) {
    stopRecording({ download: false });
  }

  socket.emit('room:leave', {}, () => {});
  state.isInRoom = false;
  state.roomId = null;
  state.instruments.clear();
  state.instrumentOrder = [];
  state.activeInstrumentId = null;
  audioState.samplerBuffers.clear();
  audioState.pendingSamplerLoads.clear();
  renderInstruments();
  transportToggleBtn.disabled = true;
  transportToggleBtn.classList.remove('playing');
  transportToggleBtn.textContent = 'Play';
  updateConnectionsDisplay(0);
  pendingPings.clear();
  hasSyncSample = false;
  updateSyncStatus();
  stopAudioScheduler();
  showLanding();
}

socket.on('disconnect', () => {
  if (!state.isInRoom) {
    return;
  }
  if (audioState.isRecording) {
    stopRecording({ download: false });
  }
  state.isInRoom = false;
  state.roomId = null;
  state.instruments.clear();
  state.instrumentOrder = [];
  state.activeInstrumentId = null;
  audioState.samplerBuffers.clear();
  audioState.pendingSamplerLoads.clear();
  renderInstruments();
  transportToggleBtn.disabled = true;
  transportToggleBtn.classList.remove('playing');
  transportToggleBtn.textContent = 'Play';
  updateConnectionsDisplay(0);
  pendingPings.clear();
  hasSyncSample = false;
  updateSyncStatus();
  stopAudioScheduler();
  showLanding();
  window.alert('Connection lost. Please rejoin your room.');
});

function showSequencer() {
  landingEl.classList.add('hidden');
  sequencerEl.classList.remove('hidden');
  transportToggleBtn.disabled = false;
  showRoomCodeHint('');
}

function showLanding() {
  landingEl.classList.remove('hidden');
  sequencerEl.classList.add('hidden');
  transportToggleBtn.disabled = true;
  roomDisplayEl.textContent = 'Room: —';
  stopAudioScheduler();
}

function openSynthModal() {
  addSynthModal.classList.remove('hidden');
}

function closeSynthModal() {
  addSynthModal.classList.add('hidden');
}

function updateConnectionsDisplay(count) {
  if (!state.isInRoom) {
    connectionsEl.textContent = 'Not connected';
    return;
  }
  if (!Number.isFinite(count)) {
    return;
  }
  const label = count === 1 ? 'person' : 'people';
  connectionsEl.textContent = `${count} ${label} connected`;
}

function showRoomCodeHint(roomId) {
  if (!roomId) {
    roomCodeDisplayEl.textContent = '';
    roomCodeDisplayEl.classList.add('hidden');
    return;
  }
  roomCodeDisplayEl.textContent = `Share this code: ${roomId}`;
  roomCodeDisplayEl.classList.remove('hidden');
}

function ensureAudioContext() {
  if (audioState.context) {
    if (audioState.context.state === 'suspended') {
      audioState.context.resume().catch(() => {});
    }
    return audioState.context;
  }

  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      console.warn('Web Audio API is not supported in this browser.');
      return null;
    }

    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);

    audioState.context = ctx;
    audioState.masterGain = master;

    state.instruments.forEach((instrument) => {
      if (instrument.type === SynthTypes.SAMPLER) {
        prepareSamplerAudio(instrument);
      }
    });

    return ctx;
  } catch (error) {
    console.error('Failed to initialize audio context:', error);
    return null;
  }
}

async function toggleRecording() {
  if (audioState.isRecording) {
    stopRecording();
    return;
  }
  await startRecording();
}

async function startRecording() {
  if (audioState.isRecording) {
    return;
  }

  if (!isRecordingSupported()) {
    window.alert('Recording is not supported in this browser.');
    return;
  }

  const ctx = ensureAudioContext();
  if (!ctx || !audioState.masterGain) {
    window.alert('Audio engine is not ready yet.');
    return;
  }

  try {
    await ensureRecordingWorklet(ctx);
  } catch (error) {
    console.error('Failed to load recording module:', error);
    window.alert('Unable to initialize recording.');
    return;
  }

  audioState.recordingChunks = [];
  audioState.recordingChannelCount = 0;
  audioState.recordingSampleRate = null;
  audioState.recordingContextSampleRate = ctx.sampleRate;
  audioState.recordingTotalSamples = 0;
  audioState.recordingFrameCount = 0;
  audioState.recordingByteLength = 0;
  audioState.recordingStatsLastUpdate = 0;

  let recorderNode;
  const channelCount = ctx.destination?.channelCount || 2;

  try {
    recorderNode = new AudioWorkletNode(ctx, 'seqroom-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
  } catch (error) {
    console.error('Failed to create recording node:', error);
    window.alert('Unable to start recording.');
    return;
  }

  recorderNode.port.onmessage = handleRecordingMessage;
  recorderNode.port.onmessageerror = (event) => {
    console.error('Recording port error:', event);
  };
  recorderNode.onprocessorerror = (error) => {
    console.error('Recording processor error:', error);
    stopRecording();
  };

  try {
    audioState.masterGain.connect(recorderNode);
  } catch (error) {
    console.error('Failed to connect recording node:', error);
    recorderNode.port.onmessage = null;
    recorderNode.port.onmessageerror = null;
    recorderNode.onprocessorerror = null;
    window.alert('Unable to start recording.');
    return;
  }

  audioState.recordingNode = recorderNode;
  audioState.isRecording = true;
  updateRecordButton(true);
  updateRecordingStatsDisplay();
}

function stopRecording(options = {}) {
  const { download = true } = options;
  const recorderNode = audioState.recordingNode;
  const wasRecording = audioState.isRecording;

  if (recorderNode) {
    try {
      audioState.masterGain?.disconnect(recorderNode);
    } catch (error) {
      console.warn('Failed to disconnect recording node:', error);
    }
    recorderNode.port.onmessage = null;
    recorderNode.port.onmessageerror = null;
    recorderNode.onprocessorerror = null;
  }

  audioState.recordingNode = null;
  audioState.isRecording = false;
  updateRecordButton(false);

  if (!wasRecording) {
    clearRecordingData();
    return;
  }

  const chunks = audioState.recordingChunks.slice();
  const totalSamples = audioState.recordingTotalSamples;
  const channelCount = Math.max(1, audioState.recordingChannelCount || 1);
  const sampleRate = audioState.recordingSampleRate
    ?? audioState.recordingContextSampleRate
    ?? 48000;

  clearRecordingData();

  if (!download) {
    return;
  }

  if (!chunks.length || !Number.isFinite(totalSamples) || totalSamples <= 0) {
    return;
  }

  const interleaved = mergeRecordingChunks(chunks, totalSamples);
  const wavBuffer = encodeWavFromInterleaved(interleaved, channelCount, sampleRate);
  const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
  downloadBlob(wavBlob, 'seqroom_recording.wav');
}

async function ensureRecordingWorklet(ctx) {
  if (audioState.recordingModuleLoaded) {
    return;
  }
  if (!ctx.audioWorklet) {
    throw new Error('AudioWorklet not available on this AudioContext.');
  }
  await ctx.audioWorklet.addModule('recording-processor.js');
  audioState.recordingModuleLoaded = true;
}

function handleRecordingMessage(event) {
  const message = event.data;
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'ready' && typeof message.sampleRate === 'number') {
    audioState.recordingSampleRate = message.sampleRate;
    updateRecordingStatsDisplay();
    return;
  }

  if (message.type === 'data' && message.buffer instanceof ArrayBuffer) {
    const chunk = new Float32Array(message.buffer);

    if (message.channelCount && message.channelCount > 0) {
      if (!audioState.recordingChannelCount) {
        audioState.recordingChannelCount = message.channelCount;
      } else if (audioState.recordingChannelCount !== message.channelCount) {
        console.warn(
          'Recording channel count changed:',
          audioState.recordingChannelCount,
          '→',
          message.channelCount,
        );
        audioState.recordingChannelCount = message.channelCount;
      }
    }

    audioState.recordingChunks.push(chunk);
    audioState.recordingTotalSamples += chunk.length;
    audioState.recordingByteLength += chunk.byteLength;

    const channelCount = Math.max(1, audioState.recordingChannelCount || message.channelCount || 1);
    if (channelCount > 0) {
      audioState.recordingFrameCount += chunk.length / channelCount;
    }

    maybeUpdateRecordingStatsDisplay();
  }
}

function clearRecordingData() {
  audioState.recordingChunks = [];
  audioState.recordingTotalSamples = 0;
  audioState.recordingByteLength = 0;
  audioState.recordingFrameCount = 0;
  audioState.recordingChannelCount = 0;
  audioState.recordingSampleRate = null;
  audioState.recordingContextSampleRate = null;
  audioState.recordingStatsLastUpdate = 0;
  updateRecordingStatsDisplay();
}

function updateRecordingStatsDisplay() {
  if (!recordingStatusEl) {
    return;
  }

  if (!audioState.isRecording) {
    recordingStatusEl.textContent = '';
    recordingStatusEl.classList.add('hidden');
    return;
  }

  const channelCount = Math.max(1, audioState.recordingChannelCount || 1);
  const sampleRate = audioState.recordingSampleRate
    ?? audioState.recordingContextSampleRate
    ?? audioState.context?.sampleRate
    ?? 48000;
  const frames = audioState.recordingFrameCount
    || (channelCount > 0 ? audioState.recordingTotalSamples / channelCount : 0);
  const durationSeconds = frames / sampleRate;
  const totalBytes = audioState.recordingByteLength + 44;

  recordingStatusEl.textContent = `Recording ${formatDuration(durationSeconds)} • ${formatBytes(totalBytes)}`;
  recordingStatusEl.classList.remove('hidden');
}

function maybeUpdateRecordingStatsDisplay() {
  if (!audioState.isRecording) {
    return;
  }
  const now = performance.now();
  if (!audioState.recordingStatsLastUpdate || now - audioState.recordingStatsLastUpdate >= RECORDING_STATS_UPDATE_INTERVAL_MS) {
    audioState.recordingStatsLastUpdate = now;
    updateRecordingStatsDisplay();
  }
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '00:00';
  }
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function mergeRecordingChunks(chunks, totalLength) {
  if (!Array.isArray(chunks) || !chunks.length) {
    return new Float32Array(0);
  }

  const finalLength = Number.isFinite(totalLength) && totalLength > 0
    ? Math.max(0, Math.floor(totalLength))
    : chunks.reduce((sum, chunk) => sum + chunk.length, 0);

  const result = new Float32Array(finalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function encodeWavFromInterleaved(interleaved, channelCount, sampleRate) {
  const samples = interleaved.length;
  const bytesPerSample = 4;
  const safeChannelCount = Math.max(1, Math.floor(channelCount) || 1);
  const normalizedSampleRate = Math.max(1, Math.round(sampleRate));
  const blockAlign = safeChannelCount * bytesPerSample;
  const dataLength = samples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, safeChannelCount, true);
  view.setUint32(24, normalizedSampleRate, true);
  view.setUint32(28, normalizedSampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples; i += 1) {
    const sample = Math.max(-1, Math.min(1, interleaved[i]));
    view.setFloat32(offset, sample, true);
    offset += bytesPerSample;
  }

  return buffer;
}

function writeString(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function syncAudioScheduler() {
  if (!state.transport.playing || !state.isInRoom) {
    stopAudioScheduler();
    return;
  }

  const ctx = ensureAudioContext();
  if (!ctx) {
    return;
  }

  const stepDurationMs = getStepDurationMs();
  if (!Number.isFinite(stepDurationMs) || !state.transport.sessionStartTime) {
    return;
  }

  const previousStepDuration = audioState.lastStepDurationMs;
  audioState.lastStepDurationMs = stepDurationMs;
  const tempoSlowed = Number.isFinite(previousStepDuration) && stepDurationMs > previousStepDuration;

  const elapsed = getServerSyncedTime() - state.transport.sessionStartTime;
  const currentStep = elapsed >= 0 ? Math.floor(elapsed / stepDurationMs) : -1;
  const targetNextIndex = currentStep >= 0 ? currentStep + 1 : 0;
  const currentNextIndex = Number.isFinite(audioState.nextStepIndex) ? audioState.nextStepIndex : 0;

  if (tempoSlowed && targetNextIndex < currentNextIndex) {
    audioState.nextStepIndex = targetNextIndex;
  } else if (targetNextIndex > currentNextIndex) {
    audioState.nextStepIndex = targetNextIndex;
  } else {
    audioState.nextStepIndex = Math.max(currentNextIndex, 0);
  }

  updatePlaybackIndicators(currentStep);

  if (!audioState.schedulerId) {
    audioState.schedulerId = setInterval(runAudioScheduler, AUDIO_LOOKAHEAD_MS);
  }

  runAudioScheduler();
}

function stopAudioScheduler() {
  if (audioState.schedulerId) {
    clearInterval(audioState.schedulerId);
    audioState.schedulerId = null;
  }
  audioState.nextStepIndex = 0;
  audioState.lastStepDurationMs = null;
  updatePlaybackIndicators(-1);
}

function runAudioScheduler() {
  if (!state.transport.playing || !state.transport.sessionStartTime) {
    return;
  }

  const ctx = ensureAudioContext();
  if (!ctx) {
    return;
  }

  const stepDurationMs = getStepDurationMs();
  if (!Number.isFinite(stepDurationMs) || stepDurationMs <= 0) {
    return;
  }

  const serverNow = getServerSyncedTime();
  updatePlaybackIndicators(getCurrentStepIndex());
  const scheduleUntil = serverNow + AUDIO_SCHEDULE_AHEAD_SECONDS * 1000;
  const clientNow = getClientAbsoluteTime();

  while (true) {
    const stepStartMs = state.transport.sessionStartTime + audioState.nextStepIndex * stepDurationMs;
    if (stepStartMs > scheduleUntil) {
      break;
    }

    const deltaMs = stepStartMs - clientNow;
    const when = ctx.currentTime + deltaMs / 1000;

    if (when >= ctx.currentTime) {
      scheduleStep(audioState.nextStepIndex, when);
    }

    audioState.nextStepIndex += 1;
  }
}

function scheduleStep(stepNumber, when) {
  state.instrumentOrder.forEach((instrumentId) => {
    const instrument = state.instruments.get(instrumentId);
    if (!instrument) {
      return;
    }

    ensureLocalInstrumentCapacity(instrument, clampStepCount(instrument.stepCount ?? (Array.isArray(instrument.steps) ? instrument.steps.length : STEP_COUNT)));

    const steps = instrument.steps || [];
    if (!steps.length) {
      return;
    }

    const instrumentStepCount = clampStepCount(instrument.stepCount ?? steps.length ?? STEP_COUNT);
    if (instrumentStepCount <= 0) {
      return;
    }

    const localIndex = stepNumber % instrumentStepCount;
    const step = steps[localIndex] || steps[localIndex % steps.length];
    if (!step || !step.active) {
      return;
    }

    scheduleInstrumentStep(instrument, step, when);
  });
}

function scheduleInstrumentStep(instrument, step, when) {
  const ctx = ensureAudioContext();
  if (!ctx || !audioState.masterGain) {
    return;
  }

  switch (instrument.type) {
    case SynthTypes.TB303:
      scheduleTB303(instrument, step, when, ctx);
      break;
    case SynthTypes.TR808:
      scheduleTR808(instrument, step, when, ctx);
      break;
    case SynthTypes.SAMPLER:
      scheduleSampler(instrument, step, when, ctx);
      break;
    case SynthTypes.POLY:
    default:
      schedulePolySynth(instrument, step, when, ctx);
      break;
  }
}

function scheduleTB303(instrument, step, when, ctx) {
  const params = instrument.params || {};
  const osc = ctx.createOscillator();
  osc.type = params.waveform === 'square' ? 'square' : 'sawtooth';
  osc.frequency.value = noteToFrequency(step.pitch || 'C2');

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  const cutoff = 200 + (params.cutoff ?? 0.5) * 6000;
  filter.frequency.setValueAtTime(cutoff, when);
  filter.Q.setValueAtTime(0.5 + (params.resonance ?? 0.5) * 12, when);

  const env = ctx.createGain();
  const volume = clampValue(params.volume ?? 0.8, 0, 1);
  const decay = 0.1 + (params.decay ?? 0.5) * 0.5;
  const peakTime = when + 0.01;
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(volume, peakTime);
  env.gain.exponentialRampToValueAtTime(0.0001, when + decay);

  osc.connect(filter);
  filter.connect(env);
  env.connect(audioState.masterGain);

  osc.start(when);
  osc.stop(when + decay + 0.1);
}

function scheduleTR808(instrument, step, when, ctx) {
  const params = instrument.params || {};
  const layers = step.layers || {};

  if (layers.kick) {
    scheduleKick(params, when, ctx);
  }
  if (layers.snare) {
    scheduleSnare(params, when, ctx);
  }
  if (layers.hat) {
    scheduleHat(params, when, ctx);
  }
  if (layers.clap) {
    scheduleClap(params, when, ctx);
  }
}

function scheduleSampler(instrument, step, when, ctx) {
  const slotParamsMap = instrument.params?.slots || {};
  const stepSlots = step.slots || {};

  SAMPLER_SLOT_IDS.forEach((slotId) => {
    if (!stepSlots[slotId]) {
      return;
    }

    const slotParams = slotParamsMap[slotId];
    if (!slotParams || slotParams.mute) {
      return;
    }

    const cacheEntry = audioState.samplerBuffers.get(samplerSlotKey(instrument.id, slotId));
    if (!cacheEntry || !cacheEntry.buffer) {
      return;
    }

    const buffer = slotParams.reverse && cacheEntry.reversedBuffer ? cacheEntry.reversedBuffer : cacheEntry.buffer;
    const sampleDuration = buffer.duration;
    if (!Number.isFinite(sampleDuration) || sampleDuration <= 0) {
      return;
    }

    const startOffset = clampValue(slotParams.startOffset ?? 0, 0, 0.99);
    const endOffset = clampValue(slotParams.endOffset ?? 1, 0.01, 1);
    if (endOffset <= startOffset) {
      return;
    }

    const segmentLength = Math.max(0.01, sampleDuration * (endOffset - startOffset));
    const offsetSeconds = slotParams.reverse && cacheEntry.reversedBuffer
      ? Math.max(0, sampleDuration * (1 - endOffset))
      : sampleDuration * startOffset;
    const availableDuration = Math.max(0.01, sampleDuration - offsetSeconds);
    const playbackDuration = Math.min(segmentLength, availableDuration);
    if (!Number.isFinite(playbackDuration) || playbackDuration <= 0) {
      return;
    }

    const playbackRate = Math.pow(2, clampValue(slotParams.pitch ?? 0, -24, 24) / 12);
    const volume = clampValue(slotParams.volume ?? 1, 0, 1);
    const panValue = clampValue(slotParams.pan ?? 0, -1, 1);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(playbackRate, when);

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(volume, when);

    source.connect(gainNode);

    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(panValue, when);
      gainNode.connect(panner);
      panner.connect(audioState.masterGain);
    } else {
      gainNode.connect(audioState.masterGain);
    }

    const startTime = Math.max(0, offsetSeconds);
    const duration = Math.max(0.01, playbackDuration);
    source.start(when, startTime, duration);
  });
}

function scheduleKick(params, when, ctx) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const volume = clampValue(params.kickLevel ?? 0.9, 0, 1) * clampValue(params.volume ?? 0.8, 0, 1);

  osc.type = 'sine';
  osc.frequency.setValueAtTime(110, when);
  osc.frequency.exponentialRampToValueAtTime(40, when + 0.22);

  gain.gain.setValueAtTime(volume, when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.28);

  osc.connect(gain);
  gain.connect(audioState.masterGain);

  osc.start(when);
  osc.stop(when + 0.4);
}

function scheduleSnare(params, when, ctx) {
  const noise = createNoiseBuffer(ctx);
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noise;

  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = 1000;

  const gain = ctx.createGain();
  const volume = clampValue(params.snareLevel ?? 0.7, 0, 1) * clampValue(params.volume ?? 0.8, 0, 1);
  gain.gain.setValueAtTime(volume, when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.2);

  noiseSource.connect(noiseFilter);
  noiseFilter.connect(gain);
  gain.connect(audioState.masterGain);

  noiseSource.start(when);
  noiseSource.stop(when + 0.25);
}

function scheduleHat(params, when, ctx) {
  const buffer = createNoiseBuffer(ctx);
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const tone = clampValue(params.hatTone ?? params.tone ?? 0.5, 0, 1);
  const bandpassFrequency = 5000 + tone * 7000;
  const highpassFrequency = 2000 + tone * 4000;
  const resonance = 1 + tone * 6;

  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.setValueAtTime(highpassFrequency, when);
  highpass.Q.setValueAtTime(0.8 + tone * 1.2, when);

  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.setValueAtTime(bandpassFrequency, when);
  bandpass.Q.setValueAtTime(resonance, when);

  const gain = ctx.createGain();
  const volume = clampValue(params.hatLevel ?? 0.6, 0, 1) * clampValue(params.volume ?? 0.8, 0, 1);
  gain.gain.setValueAtTime(volume, when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.15);

  source.connect(highpass);
  highpass.connect(bandpass);
  bandpass.connect(gain);
  gain.connect(audioState.masterGain);

  source.start(when);
  source.stop(when + 0.18);
}

function scheduleClap(params, when, ctx) {
  const noise = createNoiseBuffer(ctx);
  const source = ctx.createBufferSource();
  source.buffer = noise;

  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = 2000;
  bandpass.Q.value = 1.5;

  const gain = ctx.createGain();
  const volume = clampValue(params.clapLevel ?? 0.6, 0, 1) * clampValue(params.volume ?? 0.8, 0, 1);
  gain.gain.setValueAtTime(volume, when);
  gain.gain.exponentialRampToValueAtTime(volume * 0.6, when + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.25);

  source.connect(bandpass);
  bandpass.connect(gain);
  gain.connect(audioState.masterGain);

  source.start(when);
  source.stop(when + 0.3);
}

function schedulePolySynth(instrument, step, when, ctx) {
  const params = instrument.params || {};
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  const waveform = params.waveform;
  osc.type = ['sine', 'triangle', 'saw', 'square'].includes(waveform) ? waveform : 'sine';
  osc.frequency.value = noteToFrequency(step.pitch || 'C4');

  filter.type = 'lowpass';
  filter.frequency.value = 400 + (params.cutoff ?? 0.6) * 6000;
  filter.Q.value = 0.5 + (params.resonance ?? 0.3) * 6;

  const volume = clampValue(params.volume ?? 0.8, 0, 1);
  const attack = clampValue(params.attack ?? 0.05, 0, 2);
  const decay = clampValue(params.decay ?? 0.3, 0, 2);
  const release = clampValue(params.release ?? 0.4, 0, 3);

  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(volume, when + attack);
  gain.gain.linearRampToValueAtTime(volume * 0.5, when + attack + decay);
  gain.gain.linearRampToValueAtTime(0.0001, when + attack + decay + release);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audioState.masterGain);

  osc.start(when);
  osc.stop(when + attack + decay + release + 0.1);
}

function samplerSlotKey(instrumentId, slotId) {
  return `${instrumentId}:${slotId}`;
}

function prepareSamplerAudio(instrument) {
  if (!instrument || instrument.type !== SynthTypes.SAMPLER) {
    return;
  }
  const ctx = ensureAudioContext();
  if (!ctx) {
    return;
  }
  const slots = instrument.params?.slots || {};
  SAMPLER_SLOT_IDS.forEach((slotId) => {
    const slot = slots[slotId];
    const key = samplerSlotKey(instrument.id, slotId);
    if (!slot || !slot.sample) {
      audioState.samplerBuffers.delete(key);
      audioState.pendingSamplerLoads.delete(key);
      return;
    }
    const cached = audioState.samplerBuffers.get(key);
    if (cached && cached.meta && cached.meta.data === slot.sample.data && cached.meta.updatedAt === slot.sample.updatedAt) {
      return;
    }
    loadSamplerSlotSample(ctx, instrument.id, slotId, slot.sample);
  });
}

function loadSamplerSlotSample(ctx, instrumentId, slotId, sample) {
  if (!sample || typeof sample !== 'object' || typeof sample.data !== 'string') {
    return;
  }
  const arrayBuffer = base64ToArrayBuffer(sample.data);
  if (!arrayBuffer) {
    console.warn('Sampler: unable to decode audio data.');
    return;
  }
  const key = samplerSlotKey(instrumentId, slotId);
  const version = `${sample.updatedAt || Date.now()}:${sample.data.length}`;
  audioState.pendingSamplerLoads.set(key, version);

  ctx.decodeAudioData(arrayBuffer.slice(0)).then((audioBuffer) => {
    if (audioState.pendingSamplerLoads.get(key) !== version) {
      return;
    }
    const reversedBuffer = createReversedAudioBuffer(ctx, audioBuffer);
    audioState.samplerBuffers.set(key, {
      buffer: audioBuffer,
      reversedBuffer,
      meta: { ...sample },
    });
    audioState.pendingSamplerLoads.delete(key);
  }).catch((error) => {
    if (audioState.pendingSamplerLoads.get(key) === version) {
      audioState.pendingSamplerLoads.delete(key);
    }
    console.error('Sampler: failed to decode sample', error);
  });
}

function base64ToArrayBuffer(base64) {
  if (typeof base64 !== 'string' || !base64.length) {
    return null;
  }
  try {
    const binary = window.atob(base64);
    const length = binary.length;
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  } catch (error) {
    console.error('Sampler: invalid base64 audio data', error);
    return null;
  }
}

function createReversedAudioBuffer(ctx, buffer) {
  const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const target = reversed.getChannelData(channel);
    const lastIndex = source.length - 1;
    for (let i = 0; i < source.length; i += 1) {
      target[i] = source[lastIndex - i];
    }
  }
  return reversed;
}

function cleanupSamplerBuffers(instrumentId) {
  const prefix = `${instrumentId}:`;
  Array.from(audioState.samplerBuffers.keys()).forEach((key) => {
    if (key.startsWith(prefix)) {
      audioState.samplerBuffers.delete(key);
    }
  });
  Array.from(audioState.pendingSamplerLoads.keys()).forEach((key) => {
    if (key.startsWith(prefix)) {
      audioState.pendingSamplerLoads.delete(key);
    }
  });
}

let noiseBuffer = null;

function createNoiseBuffer(ctx) {
  if (noiseBuffer) {
    return noiseBuffer;
  }

  const buffer = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  noiseBuffer = buffer;
  return buffer;
}

function noteToFrequency(note) {
  if (typeof note !== 'string' || note.length < 2) {
    return 440;
  }

  const match = note.match(/^([A-G])(#|b)?(\d)$/i);
  if (!match) {
    return 440;
  }

  const [, letter, accidental, octaveStr] = match;
  const semitoneMap = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  let semitone = semitoneMap[letter.toUpperCase()] ?? 0;
  if (accidental === '#') {
    semitone += 1;
  } else if (accidental === 'b') {
    semitone -= 1;
  }

  const octave = Number(octaveStr);
  const midiNote = 69 + semitone + (octave - 4) * 12;
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

function getServerSyncedTime() {
  return getClientAbsoluteTime() + clockOffsetMs;
}

function getClientAbsoluteTime() {
  return performance.timeOrigin + performance.now();
}

function applyClockCorrection(offsetSample, latencySample) {
  if (!Number.isFinite(offsetSample) || !Number.isFinite(latencySample)) {
    return;
  }

  if (!hasSyncSample) {
    clockOffsetMs = offsetSample;
    latencyEstimateMs = latencySample;
    hasSyncSample = true;
  } else {
    clockOffsetMs += OFFSET_SMOOTHING * (offsetSample - clockOffsetMs);
    latencyEstimateMs += LATENCY_SMOOTHING * (latencySample - latencyEstimateMs);
  }

  updateSyncStatus();
}

function updateSyncStatus() {
  if (!syncStatusEl) {
    return;
  }

  if (!state.isInRoom) {
    syncStatusEl.textContent = 'Join a room to sync';
    return;
  }

  if (!hasSyncSample) {
    syncStatusEl.textContent = 'Syncing clock…';
    return;
  }

  const offsetLabel = clockOffsetMs.toFixed(1);
  const latencyLabel = latencyEstimateMs.toFixed(1);
  syncStatusEl.textContent = `Offset ${offsetLabel} ms · RTT ${latencyLabel} ms`;
}

function sliderParam(key, label, min, max, step) {
  return { type: 'range', key, label, min, max, step };
}

function selectParam(key, label, options) {
  return { type: 'select', key, label, options };
}

function normalizeSamplerSample(sample) {
  if (!sample || typeof sample !== 'object') {
    return null;
  }
  if (typeof sample.data !== 'string' || !sample.data.length) {
    return null;
  }
  const normalized = {
    name: typeof sample.name === 'string' && sample.name.trim() ? sample.name.trim().slice(0, 120) : 'Sample',
    mimeType: typeof sample.mimeType === 'string' && sample.mimeType.trim() ? sample.mimeType.trim().slice(0, 64) : 'audio/wav',
    data: sample.data,
    bytesLength: Number.isFinite(sample.bytesLength) ? Number(sample.bytesLength) : undefined,
    updatedAt: Number.isFinite(sample.updatedAt) ? Number(sample.updatedAt) : Date.now(),
  };
  return normalized;
}

function normalizeSamplerParams(params = {}) {
  const slots = {};
  SAMPLER_SLOT_IDS.forEach((slotId) => {
    const defaults = createDefaultSamplerSlot(slotId);
    const source = params?.slots?.[slotId] || params[slotId] || {};
    const normalized = {
      id: slotId,
      name: typeof source.name === 'string' && source.name.trim() ? source.name.trim().slice(0, 64) : defaults.name,
      volume: clampValue(source.volume ?? defaults.volume, 0, 1),
      pan: clampValue(source.pan ?? defaults.pan, -1, 1),
      pitch: clampValue(source.pitch ?? defaults.pitch, -24, 24),
      startOffset: clampValue(source.startOffset ?? defaults.startOffset, 0, 0.99),
      endOffset: clampValue(source.endOffset ?? defaults.endOffset, 0.01, 1),
      reverse: Boolean(source.reverse),
      mute: Boolean(source.mute),
      sample: normalizeSamplerSample(source.sample),
    };
    if (normalized.endOffset <= normalized.startOffset) {
      normalized.endOffset = Math.min(1, normalized.startOffset + 0.05);
    }
    normalized.startOffset = clampValue(normalized.startOffset, 0, Math.max(0, normalized.endOffset - 0.01));
    normalized.endOffset = clampValue(normalized.endOffset, normalized.startOffset + 0.01, 1);
    slots[slotId] = normalized;
  });
  return { slots };
}

function normalizeSamplerStep(step) {
  const base = createEmptySamplerStep();
  const slots = { ...base.slots, ...(step?.slots || {}) };
  const normalized = {
    ...base,
    ...step,
    slots,
  };
  normalized.active = Object.values(slots).some(Boolean);
  return normalized;
}

function normalizeInstrument(instrument) {
  const rawSteps = Array.isArray(instrument.steps) ? instrument.steps : [];
  const normalizedStepCount = clampStepCount(instrument.stepCount ?? rawSteps.length ?? STEP_COUNT);

  const normalizedSteps = rawSteps.map((step) => {
    if (instrument.type === SynthTypes.TR808) {
      const base = createEmptyDrumStep();
      const layers = { ...base.layers, ...(step?.layers || {}) };
      return {
        ...base,
        ...step,
        layers,
        active: TR808_DRUMS.some((drum) => layers[drum.id]),
      };
    }
    if (instrument.type === SynthTypes.SAMPLER) {
      return normalizeSamplerStep(step);
    }
    return {
      ...step,
    };
  });

  while (normalizedSteps.length < normalizedStepCount) {
    const template = instrument.type === SynthTypes.TR808
      ? createEmptyDrumStep()
      : instrument.type === SynthTypes.SAMPLER
        ? createEmptySamplerStep()
        : createEmptyMelodicStep();
    normalizedSteps.push({ ...template });
  }

  const normalizedParams = instrument.type === SynthTypes.SAMPLER
    ? normalizeSamplerParams(instrument.params)
    : { ...instrument.params };

  return {
    id: instrument.id,
    type: instrument.type,
    name: instrument.name,
    createdAt: instrument.createdAt,
    params: normalizedParams,
    stepCount: normalizedStepCount,
    steps: normalizedSteps,
  };
}

function clampTempo(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return state.transport.bpm;
  }
  return Math.min(Math.max(Math.round(num), TEMPO_MIN), TEMPO_MAX);
}

function clampValue(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(Math.max(numeric, min), max);
}

function getStepDurationMs() {
  const bpm = clampTempo(state.transport.bpm || DEFAULT_BPM);
  return 60000 / (bpm * 4);
}

function formatParamDisplay(value, def) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  if (def.max <= 2) {
    return numeric.toFixed(2);
  }
  return numeric.toFixed(1);
}

function createPitchSelect(selected) {
  const select = document.createElement('select');
  select.className = 'step-pitch-select';
  NOTE_OPTIONS.forEach((note) => {
    const option = document.createElement('option');
    option.value = note;
    option.textContent = note;
    select.appendChild(option);
  });
  if (NOTE_OPTIONS.includes(selected)) {
    select.value = selected;
  }
  return select;
}

function createDefaultSamplerSlot(slotId) {
  const slotMeta = SAMPLER_SLOT_CONFIG.find((slot) => slot.id === slotId);
  return {
    id: slotId,
    name: slotMeta ? slotMeta.label : `Slot ${slotId}`,
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

function createEmptyMelodicStep() {
  return {
    active: false,
    pitch: 'C3',
    velocity: 1,
    accent: false,
    slide: false,
  };
}

function createEmptyDrumStep() {
  return {
    layers: TR808_DRUMS.reduce((acc, drum) => {
      acc[drum.id] = false;
      return acc;
    }, {}),
    active: false,
  };
}

function createEmptySamplerStep() {
  return {
    slots: SAMPLER_SLOT_IDS.reduce((acc, slotId) => {
      acc[slotId] = false;
      return acc;
    }, {}),
    active: false,
  };
}

function generateRoomId(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * alphabet.length);
    result += alphabet[index];
  }
  return result;
}

function normalizeRoomId(input) {
  if (typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim();
  if (!ROOM_ID_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.toUpperCase();
}
