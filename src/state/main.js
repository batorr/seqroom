// State Management Module
// Centralized application state and mutations

import { DEFAULT_BPM } from '../constants/audio.js';
import { STEP_COUNT } from '../constants/ui.js';
import { SynthTypes, TR808_DRUMS, SAMPLER_SLOT_IDS, SAMPLER_SLOT_CONFIG } from '../constants/instruments.js';
import {
    clampStepCount,
    clampTempo,
    clampValue,
    createEmptyMelodicStep,
    createEmptyDrumStep,
    createEmptySamplerStep,
    createDefaultSamplerSlot
} from '../utils/helpers.js';

// Main application state
export const state = {
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
        instrument.params = { ...instrument.params, ...params };
    }
}

// Hydrate state from server payload
export function hydrateState(payload) {
    state.isInRoom = true;
    state.roomId = payload.roomId || null;

    const transport = payload.transport || {};
    state.transport = {
        bpm: clampTempo(transport.bpm ?? DEFAULT_BPM),
        playing: Boolean(transport.playing),
        sessionStartTime: transport.sessionStartTime ?? null,
        lastScheduledStart: transport.lastScheduledStart ?? null,
    };

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

// Normalize sampler-specific data
export function normalizeSamplerParams(params = {}) {
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

export function normalizeSamplerSample(sample) {
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

export function normalizeSamplerStep(step) {
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

export function setInstrumentStepCountLocal(instrumentId, stepCount) {
    const instrument = state.instruments.get(instrumentId);
    if (!instrument) {
        return;
    }
    const desired = clampStepCount(stepCount);
    instrument.stepCount = desired;
    ensureLocalInstrumentCapacity(instrument, desired);
}

// Helper to get step duration in milliseconds
export function getStepDurationMs() {
    const bpm = clampTempo(state.transport.bpm || DEFAULT_BPM);
    return 60000 / (bpm * 4);
}
