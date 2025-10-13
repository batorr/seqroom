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
});

const TR808_DRUMS = [
  { id: 'kick', label: 'Kick', color: '#f97316' },
  { id: 'snare', label: 'Snare', color: '#facc15' },
  { id: 'hat', label: 'Hat', color: '#38bdf8' },
  { id: 'clap', label: 'Clap', color: '#c084fc' },
];

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
    const template = instrument.type === SynthTypes.TR808 ? createEmptyDrumStep() : createEmptyMelodicStep();
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
  recordingBuffers: [],
  recordingSampleRate: null,
  recordingChannelCount: 0,
  recordingModuleLoaded: false,
};

const AUDIO_LOOKAHEAD_MS = 25;
const AUDIO_SCHEDULE_AHEAD_SECONDS = 0.18;

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

  tempoInputField.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }

    const value = Number(event.target.value);
    if (!Number.isFinite(value)) {
      updateTempoDisplay(state.transport.bpm);
      return;
    }

    if (value < TEMPO_MIN || value > TEMPO_MAX) {
      updateTempoDisplay(state.transport.bpm);
      return;
    }

    commitTempo(value);
  });

  tempoInputField.addEventListener('blur', () => {
    updateTempoDisplay(state.transport.bpm);
  });
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
    state.instruments.set(instrument.id, normalizeInstrument(instrument));
    if (!state.instrumentOrder.includes(instrument.id)) {
      state.instrumentOrder.push(instrument.id);
    }
    renderInstruments();
    setActiveInstrument(instrument.id);
  });

  socket.on('instrument:update', (instrument) => {
    state.instruments.set(instrument.id, normalizeInstrument(instrument));
    renderInstrument(instrument.id);
  });

  socket.on('instrument:removed', ({ instrumentId }) => {
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
    state.instruments.set(instrument.id, normalizeInstrument(instrument));
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

  const stepValue = document.createElement('span');

  stepControl.append(stepLabel, stepSlider, stepValue);
  controlsRow.appendChild(stepControl);
  node.insertBefore(controlsRow, cardEntry.paramsContainer);

  const instrumentId = instrument.id;
  stepSlider.addEventListener('input', () => {
    const preview = clampStepCount(stepSlider.value);
    stepValue.textContent = formatStepCountLabel(preview);
  });

  stepSlider.addEventListener('change', () => {
    const desired = clampStepCount(stepSlider.value);
    requestInstrumentStepCountChange(instrumentId, desired);
  });

  cardEntry.stepControl = {
    container: controlsRow,
    slider: stepSlider,
    value: stepValue,
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
  card.classList.remove('tone-acid', 'tone-808', 'tone-poly');
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
  }

  if (entry.drumSelector) {
    if (instrument.type === SynthTypes.TR808) {
      entry.drumSelector.classList.remove('hidden');
      if (!entry.activeDrum || !TR808_DRUMS.some((drum) => drum.id === entry.activeDrum)) {
        entry.activeDrum = TR808_DRUMS[0].id;
      }
      renderDrumSelector(entry, instrument);
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

function renderParamControls(container, instrument, definition) {
  container.innerHTML = '';
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

  audioState.recordingBuffers = [];
  audioState.recordingChannelCount = 0;
  audioState.recordingSampleRate = ctx.sampleRate;

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
    audioState.recordingBuffers = [];
    audioState.recordingChannelCount = 0;
    audioState.recordingSampleRate = null;
    return;
  }

  if (!download) {
    audioState.recordingBuffers = [];
    audioState.recordingChannelCount = 0;
    audioState.recordingSampleRate = null;
    return;
  }

  const buffers = audioState.recordingBuffers;
  const channelCount = Math.max(1, audioState.recordingChannelCount || 1);
  const sampleRate = audioState.recordingSampleRate || audioState.context?.sampleRate || 44100;
  audioState.recordingBuffers = [];
  audioState.recordingChannelCount = 0;
  audioState.recordingSampleRate = null;

  if (!buffers.length) {
    return;
  }

  const interleaved = mergeRecordingChunks(buffers);
  const wavBuffer = encodeWavFromInterleaved(interleaved, channelCount, sampleRate);
  const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
  downloadBlob(wavBlob, createRecordingFilename('wav'));
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
    return;
  }

  if (message.type === 'data' && message.buffer instanceof ArrayBuffer) {
    const chunk = new Float32Array(message.buffer);
    if (!audioState.recordingChannelCount && message.channelCount) {
      audioState.recordingChannelCount = message.channelCount;
    }
    audioState.recordingBuffers.push(chunk);
  }
}

function mergeRecordingChunks(chunks) {
  if (!Array.isArray(chunks) || !chunks.length) {
    return new Float32Array(0);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(totalLength);
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
  const blockAlign = channelCount * bytesPerSample;
  const dataLength = samples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
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

function createRecordingFilename(extension = 'wav') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = extension.startsWith('.') ? extension.slice(1) : extension;
  return `seqroom-recording-${timestamp}.${ext}`;
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

function normalizeInstrument(instrument) {
  const rawSteps = Array.isArray(instrument.steps) ? instrument.steps : [];
  const normalizedStepCount = clampStepCount(instrument.stepCount ?? rawSteps.length ?? STEP_COUNT);

  const normalizedSteps = rawSteps.map((step) => {
    const cloned = {
      ...step,
      layers: step?.layers ? { ...step.layers } : undefined,
    };
    if (instrument.type === SynthTypes.TR808) {
      const base = createEmptyDrumStep();
      cloned.layers = { ...base.layers, ...(cloned.layers || {}) };
      cloned.active = TR808_DRUMS.some((drum) => cloned.layers[drum.id]);
    }
    return cloned;
  });

  while (normalizedSteps.length < normalizedStepCount) {
    const template = instrument.type === SynthTypes.TR808 ? createEmptyDrumStep() : createEmptyMelodicStep();
    normalizedSteps.push(template);
  }

  return {
    id: instrument.id,
    type: instrument.type,
    name: instrument.name,
    createdAt: instrument.createdAt,
    params: { ...instrument.params },
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
