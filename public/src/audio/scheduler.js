// Audio Scheduler Module
// Manages step sequencing and audio event scheduling

import { state, ensureLocalInstrumentCapacity, getStepDurationMs } from '../state/main.js';
import { audioState } from '../state/audio.js';
import { AUDIO_LOOKAHEAD_MS, AUDIO_SCHEDULE_AHEAD_SECONDS } from '../constants/audio.js';
import { STEP_COUNT } from '../constants/ui.js';
import { SynthTypes } from '../constants/instruments.js';
import { clampStepCount } from '../utils/helpers.js';
import { ensureAudioContext, getServerSyncedTime, getClientAbsoluteTime } from './main.js';
import { scheduleTB303 } from './instruments/tb303.js';
import { scheduleTR808 } from './instruments/tr808.js';
import { scheduleSampler } from './instruments/sampler.js';
import { schedulePolySynth } from './instruments/poly-synth.js';

// Get current step index based on transport state
export function getCurrentStepIndex() {
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

// Sync and start audio scheduler
export function syncAudioScheduler() {
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

    import('../ui/instrument-card.js').then(({ updatePlaybackIndicators }) => {
        updatePlaybackIndicators(currentStep);
    }).catch(console.error);

    if (!audioState.schedulerId) {
        audioState.schedulerId = setInterval(runAudioScheduler, AUDIO_LOOKAHEAD_MS);
    }

    runAudioScheduler();
}

// Stop audio scheduler
export function stopAudioScheduler() {
    if (audioState.schedulerId) {
        clearInterval(audioState.schedulerId);
        audioState.schedulerId = null;
    }
    audioState.nextStepIndex = 0;
    audioState.lastStepDurationMs = null;
    import('../ui/instrument-card.js').then(({ updatePlaybackIndicators }) => {
        updatePlaybackIndicators(-1);
    }).catch(console.error);
}

// Run audio scheduler loop
export function runAudioScheduler() {
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
    import('../ui/instrument-card.js').then(({ updatePlaybackIndicators }) => {
        updatePlaybackIndicators(getCurrentStepIndex());
    }).catch(console.error);

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

// Schedule a single step across all instruments
export function scheduleStep(stepNumber, when) {
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

// Schedule individual instrument step
export function scheduleInstrumentStep(instrument, step, when) {
    if (audioState.mutedInstruments.has(instrument.id)) {
        return;
    }
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
