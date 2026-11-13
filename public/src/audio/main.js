// Main Audio Module
// Core audio context management and clock synchronization

import { state } from '../state/main.js';
import { audioState, socketState } from '../state/audio.js';
import { LATENCY_SMOOTHING } from '../constants/audio.js';
import { SynthTypes } from '../constants/instruments.js';
import { createOffsetEstimator, createRollingMedian } from '../shared/clock-sync.js';
import { createAudioGraph } from './graph.js';

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
        // Mix bus with glue compression, limiter and the delay/reverb sends.
        const graph = createAudioGraph(ctx);

        audioState.context = ctx;
        audioState.masterGain = graph.input;
        audioState.masterOutput = graph.output;

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
//
// Three clocks are involved:
// - server time (ms): what the transport timeline is expressed in,
// - client time: performance.timeOrigin + performance.now(),
// - AudioContext time (s): what Web Audio schedules in.
// server = client + clockOffsetMs, and the client <-> audio mapping is
// measured from the audio output itself, so a note scheduled for server time
// T is *heard* at T on every device, whatever its output latency.

const serverOffsetEstimator = createOffsetEstimator();
const audioOffsetMedian = createRollingMedian(31);
let audioOffsetMs = null; // contextTime * 1000 - performance.now() for audible output
let lastContextState = null;

export function getServerSyncedTime() {
    return getClientAbsoluteTime() + socketState.clockOffsetMs;
}

export function getClientAbsoluteTime() {
    return performance.timeOrigin + performance.now();
}

// Samples which AudioContext time is audible at which performance.now() and
// keeps a de-jittered offset. Call regularly (the scheduler does, every tick).
export function updateAudioClockMapping(ctx) {
    if (!ctx) {
        return;
    }
    // A suspended context's clock stands still while performance.now() runs
    // on, so samples from before a suspension are useless afterwards.
    if (ctx.state !== 'running') {
        lastContextState = ctx.state;
        return;
    }
    if (lastContextState !== 'running') {
        audioOffsetMedian.reset();
        lastContextState = 'running';
    }
    let contextTime = null;
    let performanceTime = null;
    if (typeof ctx.getOutputTimestamp === 'function') {
        const stamp = ctx.getOutputTimestamp();
        if (stamp && stamp.performanceTime > 0 && Number.isFinite(stamp.contextTime) && stamp.contextTime > 0) {
            contextTime = stamp.contextTime;
            performanceTime = stamp.performanceTime;
        }
    }
    if (contextTime === null) {
        // Fallback: currentTime is the render position; subtract the reported
        // latencies to approximate what is audible right now.
        const latency = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
        contextTime = ctx.currentTime - latency;
        performanceTime = performance.now();
    }
    audioOffsetMs = audioOffsetMedian.push(contextTime * 1000 - performanceTime);
}

// Server time (ms) -> AudioContext time (s) at which a sound must start to be
// heard at that server time.
export function serverTimeToContextTime(ctx, serverTimeMs) {
    if (audioOffsetMs === null) {
        updateAudioClockMapping(ctx);
    }
    const performanceTime = serverTimeMs - socketState.clockOffsetMs - performance.timeOrigin;
    return (performanceTime + audioOffsetMs) / 1000;
}

// Inverse of serverTimeToContextTime.
export function contextTimeToServerTime(ctx, contextTimeSec) {
    if (audioOffsetMs === null) {
        updateAudioClockMapping(ctx);
    }
    const performanceTime = contextTimeSec * 1000 - audioOffsetMs;
    return performanceTime + performance.timeOrigin + socketState.clockOffsetMs;
}

export function applyClockCorrection(offsetSample, latencySample) {
    if (!Number.isFinite(offsetSample) || !Number.isFinite(latencySample)) {
        return;
    }

    if (!socketState.hasSyncSample) {
        // First sample after joining (or after leaveRoom() reset the state).
        serverOffsetEstimator.reset();
        socketState.latencyEstimateMs = latencySample;
        socketState.hasSyncSample = true;
    } else {
        socketState.latencyEstimateMs += LATENCY_SMOOTHING * (latencySample - socketState.latencyEstimateMs);
    }
    socketState.clockOffsetMs = serverOffsetEstimator.addSample(offsetSample, latencySample, {
        playing: Boolean(state.transport.playing),
    });

    import('../ui/main.js').then(({ updateSyncStatus }) => {
        updateSyncStatus();
    }).catch(console.error);
}
