// General utility functions

import { TEMPO_MIN, TEMPO_MAX, DEFAULT_BPM, NOTE_OPTIONS } from '../constants/audio.js';
import { STEP_COUNT, STEP_COUNT_MIN, STEP_COUNT_MAX } from '../constants/ui.js';
import { TR808_DRUMS, SAMPLER_SLOT_IDS, SAMPLER_SLOT_CONFIG } from '../constants/instruments.js';

// Color manipulation
export function hexToRgba(hex, alpha = 1) {
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

// Step count utilities
export function clampStepCount(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return STEP_COUNT;
    }
    return Math.min(Math.max(Math.round(numeric), STEP_COUNT_MIN), STEP_COUNT_MAX);
}

export function formatStepCountLabel(count) {
    const normalized = clampStepCount(count);
    return `${normalized} ${normalized === 1 ? 'step' : 'steps'}`;
}

// Value clamping
export function clampTempo(value, currentTempo = DEFAULT_BPM) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return currentTempo;
    }
    return Math.min(Math.max(Math.round(num), TEMPO_MIN), TEMPO_MAX);
}

export function clampValue(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return min;
    }
    return Math.min(Math.max(numeric, min), max);
}

// Formatting utilities
export function formatBytes(bytes) {
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

export function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return '00:00';
    }
    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatParamDisplay(value, def) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return '0';
    }
    if (def.max <= 2) {
        return numeric.toFixed(2);
    }
    return numeric.toFixed(1);
}

// Instrument parameter factories
export function sliderParam(key, label, min, max, step) {
    return { type: 'range', key, label, min, max, step };
}

export function selectParam(key, label, options) {
    return { type: 'select', key, label, options };
}

// Step factories
export function createEmptyMelodicStep() {
    return {
        active: false,
        pitch: 'C3',
        velocity: 1,
        accent: false,
        slide: false,
    };
}

export function createEmptyDrumStep() {
    return {
        layers: TR808_DRUMS.reduce((acc, drum) => {
            acc[drum.id] = false;
            return acc;
        }, {}),
        active: false,
    };
}

export function createEmptySamplerStep() {
    return {
        slots: SAMPLER_SLOT_IDS.reduce((acc, slotId) => {
            acc[slotId] = false;
            return acc;
        }, {}),
        active: false,
    };
}

// Sampler slot factory
export function createDefaultSamplerSlot(slotId) {
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

// UI helpers
export function createPitchSelect(selected) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'step-pitch-select';
    const initial = NOTE_OPTIONS.includes(selected) ? selected : 'C3';
    button.dataset.pitch = initial;
    button.textContent = initial;
    return button;
}
