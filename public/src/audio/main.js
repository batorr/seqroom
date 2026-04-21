// Main Audio Module
// Core audio context management and clock synchronization

import { state } from '../state/main.js';
import { audioState, socketState } from '../state/audio.js';
import { OFFSET_SMOOTHING, LATENCY_SMOOTHING } from '../constants/audio.js';
import { SynthTypes } from '../constants/instruments.js';

// Audio context initialization
export function ensureAudioContext() {
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

        // Prepare sampler audio for all existing sampler instruments
        state.instruments.forEach((instrument) => {
            if (instrument.type === SynthTypes.SAMPLER) {
                import('./instruments/sampler.js').then(({ prepareSamplerAudio }) => {
                    prepareSamplerAudio(instrument);
                }).catch(console.error);
            }
        });

        return ctx;
    } catch (error) {
        console.error('Failed to initialize audio context:', error);
        return null;
    }
}

// Clock synchronization functions
export function getServerSyncedTime() {
    return getClientAbsoluteTime() + socketState.clockOffsetMs;
}

export function getClientAbsoluteTime() {
    return performance.timeOrigin + performance.now();
}

export function applyClockCorrection(offsetSample, latencySample) {
    if (!Number.isFinite(offsetSample) || !Number.isFinite(latencySample)) {
        return;
    }

    if (!socketState.hasSyncSample) {
        socketState.clockOffsetMs = offsetSample;
        socketState.latencyEstimateMs = latencySample;
        socketState.hasSyncSample = true;
    } else {
        socketState.clockOffsetMs += OFFSET_SMOOTHING * (offsetSample - socketState.clockOffsetMs);
        socketState.latencyEstimateMs += LATENCY_SMOOTHING * (latencySample - socketState.latencyEstimateMs);
    }

    import('../ui/main.js').then(({ updateSyncStatus }) => {
        updateSyncStatus();
    }).catch(console.error);
}
