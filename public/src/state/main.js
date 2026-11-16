// State Management Module
// Centralized application state and mutations

import { DEFAULT_BPM } from '../constants/audio.js';
import { STEP_COUNT } from '../constants/ui.js';
import { SynthTypes, DRUM_VOICES, FX_VOICES, INSTRUMENT_LIBRARY } from '../constants/instruments.js';
import {
    clampStepCount,
    clampTempo,
    clampValue,
    createEmptyMelodicStep,
    createEmptyDrumStep,
    createEmptyFxStep,
} from '../utils/helpers.js';
import { normalizeTransport } from '../shared/timeline.js';

const DISPLAY_NAME_MAX_LENGTH = 32;

export function normalizeServerTransport(rawTransport) {
    return normalizeTransport(rawTransport || {}, { defaultBpm: DEFAULT_BPM, clampBpm: clampTempo });
}
export const DEFAULT_DISPLAY_NAME = 'Guest';

// Main application state
export const state = {
    isInRoom: false,
    roomId: null,
    roomSlug: null,
    // See shared/timeline.js for the shape and semantics.
    transport: {
        bpm: DEFAULT_BPM,
        playing: false,
        playId: null,
        segments: [],
    },
    instruments: new Map(),
    instrumentOrder: [],
    activeInstrumentId: null,
    tempoPreview: DEFAULT_BPM,
    membershipRole: 'guest',
    user: {
        displayName: DEFAULT_DISPLAY_NAME,
    },
};

function normalizeWaveform(value) {
    if (typeof value === 'string' && value.toLowerCase() === 'saw') {
        return 'sawtooth';
    }
    return value;
}

function normalizeSynthParams(params = {}) {
    const normalized = { ...(params || {}) };
    if (Object.prototype.hasOwnProperty.call(normalized, 'waveform')) {
        normalized.waveform = normalizeWaveform(normalized.waveform);
    }
    return normalized;
}

const INSTRUMENT_NAME_MAX_LENGTH = 48;

export function sanitizeInstrumentName(rawName, type) {
    const definition = INSTRUMENT_LIBRARY[type] || {};
    const fallback = definition.label || 'Instrument';
    if (typeof rawName !== 'string') {
        return fallback;
    }
    const trimmed = rawName.trim();
    if (!trimmed.length) {
        return fallback;
    }
    return trimmed.slice(0, INSTRUMENT_NAME_MAX_LENGTH);
}

function sanitizeDisplayName(rawName) {
    if (typeof rawName !== 'string') {
        return '';
    }
    const trimmed = rawName.trim();
    if (!trimmed.length) {
        return '';
    }
    return trimmed.slice(0, DISPLAY_NAME_MAX_LENGTH);
}

export function setDisplayName(rawName) {
    const normalized = sanitizeDisplayName(rawName);
    state.user.displayName = normalized || '';
    return state.user.displayName;
}

export function getDisplayName() {
    return state.user.displayName || '';
}

export function getDisplayNameOrDefault() {
    const normalized = sanitizeDisplayName(state.user.displayName || '');
    return normalized || DEFAULT_DISPLAY_NAME;
}

// State mutation functions
export function setRoomId(roomId) {
    state.roomId = roomId;
    state.isInRoom = !!roomId;
}

export function setTransportPlaying(playing) {
    state.transport.playing = Boolean(playing);
}

export function setTempo(bpm) {
    state.transport.bpm = clampTempo(bpm);
}

export function addInstrument(instrument) {
    const normalized = normalizeInstrument(instrument);
    state.instruments.set(normalized.id, normalized);
    if (!state.instrumentOrder.includes(normalized.id)) {
        state.instrumentOrder.push(normalized.id);
    }
}

export function removeInstrument(instrumentId) {
    state.instruments.delete(instrumentId);
    state.instrumentOrder = state.instrumentOrder.filter(id => id !== instrumentId);
    if (state.activeInstrumentId === instrumentId) {
        state.activeInstrumentId = state.instrumentOrder[0] || null;
    }
}

export function setActiveInstrument(instrumentId) {
    if (instrumentId && !state.instruments.has(instrumentId)) {
        instrumentId = null;
    }
    state.activeInstrumentId = instrumentId;
}

export function updateInstrumentParams(instrumentId, params) {
    const instrument = state.instruments.get(instrumentId);
    if (instrument) {
        const merged = { ...instrument.params, ...params };
        if ('waveform' in merged) {
            merged.waveform = normalizeWaveform(merged.waveform);
        }
        instrument.params = merged;
    }
}

export function updateInstrumentName(instrumentId, name) {
    const instrument = state.instruments.get(instrumentId);
    if (!instrument) {
        return;
    }
    instrument.name = sanitizeInstrumentName(name, instrument.type);
}

// Hydrate state from server payload
export function hydrateState(payload) {
    state.isInRoom = true;
    state.roomId = payload.roomId || null;
    state.roomSlug = payload.roomSlug || payload.slug || null;
    state.membershipRole = payload.role || 'guest';

    state.transport = normalizeServerTransport(payload.transport);

    state.instruments.clear();
    (payload.instruments || []).forEach((instrument) => {
        const normalized = normalizeInstrument(instrument);
        state.instruments.set(normalized.id, normalized);
    });

    state.instrumentOrder = (payload.instrumentOrder || []).filter((id) => state.instruments.has(id));
    if (!state.instrumentOrder.length && state.instruments.size) {
        state.instrumentOrder = Array.from(state.instruments.keys());
    }

    const nextActiveInstrumentId = state.instrumentOrder[0] || null;
    state.activeInstrumentId = nextActiveInstrumentId && state.instruments.has(nextActiveInstrumentId)
        ? nextActiveInstrumentId
        : null;
}

// Normalize instrument data
export function normalizeInstrument(instrument) {
    const rawSteps = Array.isArray(instrument.steps) ? instrument.steps : [];
    const normalizedStepCount = clampStepCount(instrument.stepCount ?? rawSteps.length ?? STEP_COUNT);

    const normalizedSteps = rawSteps.map((step) => {
        if (instrument.type === SynthTypes.DRUMS) {
            const base = createEmptyDrumStep();
            const layers = { ...base.layers, ...(step?.layers || {}) };
            return {
                ...base,
                ...step,
                layers,
                active: DRUM_VOICES.some((drum) => layers[drum.id]),
            };
        }
        if (instrument.type === SynthTypes.FX) {
            const base = createEmptyFxStep();
            const layers = { ...base.layers, ...(step?.layers || {}) };
            return {
                ...base,
                ...step,
                layers,
                active: FX_VOICES.some((lane) => layers[lane.id]),
            };
        }
        return {
            ...step,
        };
    });

    while (normalizedSteps.length < normalizedStepCount) {
        const template = instrument.type === SynthTypes.DRUMS
            ? createEmptyDrumStep()
            : instrument.type === SynthTypes.FX
                ? createEmptyFxStep()
                : createEmptyMelodicStep();
        normalizedSteps.push({ ...template });
    }

    const normalizedParams = normalizeSynthParams(instrument.params);

    const normalizedName = sanitizeInstrumentName(instrument.name, instrument.type);

    const normalizedLockOwner = typeof instrument.lockedBy === 'string' && instrument.lockedBy.trim().length
        ? instrument.lockedBy.trim()
        : null;

    const normalizedCreatorDisplayName = sanitizeDisplayName(instrument.creatorDisplayName || '');
    const normalizedCreatorUserId = typeof instrument.creatorUserId === 'string' && instrument.creatorUserId.trim().length
        ? instrument.creatorUserId.trim()
        : null;

    return {
        id: instrument.id,
        type: instrument.type,
        name: normalizedName,
        createdAt: instrument.createdAt,
        lockedBy: normalizedLockOwner,
        muted: Boolean(instrument.muted),
        params: normalizedParams,
        stepCount: normalizedStepCount,
        steps: normalizedSteps,
        creatorDisplayName: normalizedCreatorDisplayName || undefined,
        creatorUserId: normalizedCreatorUserId || undefined,
    };
}

export function setInstrumentLockedBy(instrumentId, lockedBy) {
    const instrument = state.instruments.get(instrumentId);
    if (!instrument) {
        return;
    }
    const normalized = typeof lockedBy === 'string' && lockedBy.trim().length ? lockedBy.trim() : null;
    instrument.lockedBy = normalized;
}

// Helper functions for instrument capacity
export function ensureLocalInstrumentCapacity(instrument, stepCount) {
    if (!instrument) {
        return;
    }
    const desired = clampStepCount(stepCount);
    if (!Array.isArray(instrument.steps)) {
        instrument.steps = [];
    }
    while (instrument.steps.length < desired) {
        let template;
        if (instrument.type === SynthTypes.DRUMS) {
            template = createEmptyDrumStep();
        } else if (instrument.type === SynthTypes.FX) {
            template = createEmptyFxStep();
        } else {
            template = createEmptyMelodicStep();
        }
        instrument.steps.push(template);
    }
}

export function setInstrumentStepCountLocal(instrumentId, stepCount) {
    const instrument = state.instruments.get(instrumentId);
    if (!instrument) {
        return;
    }
    const desired = clampStepCount(stepCount);
    instrument.stepCount = desired;
    ensureLocalInstrumentCapacity(instrument, desired);
}

