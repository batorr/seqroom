// Audio Scheduler Module
// Manages step sequencing and audio event scheduling
//
// Step times come from the shared transport timeline (server time). Each tick
// hands every step that falls inside the look-ahead window to Web Audio,
// converted to AudioContext time so it is heard at its server time. The
// scheduler only ever moves forward: tempo changes are scheduled by the server
// beyond every client's look-ahead, so nothing already queued has to move.

import { state, ensureLocalInstrumentCapacity } from '../state/main.js';
import { audioState } from '../state/audio.js';
import { AUDIO_LOOKAHEAD_MS, AUDIO_SCHEDULE_AHEAD_SECONDS } from '../constants/audio.js';
import { STEP_COUNT } from '../constants/ui.js';
import { SynthTypes } from '../constants/instruments.js';
import { clampStepCount } from '../utils/helpers.js';
import { stepPositionAt, stepTime, collectDueSteps } from '../shared/timeline.js';
import {
    ensureAudioContext,
    getServerSyncedTime,
    updateAudioClockMapping,
    serverTimeToContextTime,
    contextTimeToServerTime,
} from './main.js';
import { scheduleTB303 } from './instruments/tb303.js';
import { scheduleDrums } from './instruments/drums.js';
import { getAudioGraph } from './graph.js';
import { scheduleSampler } from './instruments/sampler.js';
import { schedulePolySynth } from './instruments/poly-synth.js';

// A step that is due less than this far in the past is still played (a few
// ms late beats silence); anything later is dropped.
const LATE_TOLERANCE_SECONDS = 0.015;

// Step that is audible right now (-1 when stopped or before the start).
export function getCurrentStepIndex() {
    if (!state.transport.playing) {
        return -1;
    }
    const position = stepPositionAt(state.transport, getServerSyncedTime());
    return position >= 0 ? Math.floor(position) : -1;
}

// Called whenever the transport changes (state:init, transport:update).
export function syncAudioScheduler() {
    if (!state.transport.playing || !state.isInRoom || !state.transport.segments.length) {
        stopAudioScheduler();
        return;
    }

    const ctx = ensureAudioContext();
    if (!ctx) {
        return;
    }

    if (audioState.scheduledPlayId !== state.transport.playId) {
        // A new playback run (or the first time this client sees it): start at
        // the current position. Tempo changes within a run keep nextStepIndex.
        audioState.scheduledPlayId = state.transport.playId;
        const position = stepPositionAt(state.transport, getServerSyncedTime());
        audioState.nextStepIndex = Math.max(0, Math.ceil(position));
        audioState.lastScheduledTime = -Infinity;
        audioState.droppedSteps = 0;
    }

    if (!audioState.schedulerId) {
        audioState.schedulerId = setInterval(runAudioScheduler, AUDIO_LOOKAHEAD_MS);
    }
    startPlayheadLoop();
    runAudioScheduler();
}

export function stopAudioScheduler() {
    if (audioState.schedulerId) {
        clearInterval(audioState.schedulerId);
        audioState.schedulerId = null;
    }
    audioState.nextStepIndex = 0;
    audioState.lastScheduledTime = -Infinity;
    audioState.scheduledPlayId = null;
    stopPlayheadLoop();
    withPlaybackIndicators((updatePlaybackIndicators) => updatePlaybackIndicators(-1));
}

export function runAudioScheduler() {
    if (!state.transport.playing || !state.transport.segments.length) {
        return;
    }

    const ctx = ensureAudioContext();
    // Nothing can be heard until the browser lets the context run (user
    // gesture); steps that pass meanwhile are dropped as late afterwards.
    if (!ctx || ctx.state !== 'running') {
        return;
    }

    updateAudioClockMapping(ctx);
    getAudioGraph(ctx)?.setTempo(state.transport.bpm);
    // Everything that has to start before currentTime + look-ahead is queued
    // now; in server time that window also covers the output latency.
    const horizonTime = contextTimeToServerTime(ctx, ctx.currentTime + AUDIO_SCHEDULE_AHEAD_SECONDS);
    const result = collectDueSteps(state.transport, {
        nextStep: audioState.nextStepIndex,
        lastTime: audioState.lastScheduledTime,
        horizonTime,
    });
    audioState.nextStepIndex = result.nextStep;
    audioState.lastScheduledTime = result.lastTime;

    result.due.forEach(({ step, time }) => {
        const when = serverTimeToContextTime(ctx, time);
        if (when < ctx.currentTime - LATE_TOLERANCE_SECONDS) {
            audioState.droppedSteps += 1;
            return;
        }
        const stepDuration = (stepTime(state.transport, step + 1) - time) / 1000;
        scheduleStep(step, Math.max(when, ctx.currentTime), stepDuration);
    });
}

// Playhead: driven by animation frames from the audible position, and only
// touches the DOM when the step actually changes.
let playheadFrameId = null;
let lastPlayheadStep = null;
let playbackIndicatorsFn = null;

function withPlaybackIndicators(callback) {
    if (playbackIndicatorsFn) {
        callback(playbackIndicatorsFn);
        return;
    }
    // Dynamic import avoids a circular dependency with the UI module.
    import('../ui/instrument-card.js').then(({ updatePlaybackIndicators }) => {
        playbackIndicatorsFn = updatePlaybackIndicators;
        callback(playbackIndicatorsFn);
    }).catch(console.error);
}

function playheadFrame() {
    playheadFrameId = requestAnimationFrame(playheadFrame);
    const step = getCurrentStepIndex();
    if (step !== lastPlayheadStep && playbackIndicatorsFn) {
        lastPlayheadStep = step;
        playbackIndicatorsFn(step);
    }
}

function startPlayheadLoop() {
    if (playheadFrameId !== null) {
        return;
    }
    lastPlayheadStep = null;
    withPlaybackIndicators(() => {});
    playheadFrameId = requestAnimationFrame(playheadFrame);
}

function stopPlayheadLoop() {
    if (playheadFrameId !== null) {
        cancelAnimationFrame(playheadFrameId);
        playheadFrameId = null;
    }
    lastPlayheadStep = null;
}

// Schedule a single step across all instruments
// stepDuration: seconds until the next step (lets a sliding note hold until then).
export function scheduleStep(stepNumber, when, stepDuration) {
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
        const prevIndex = (localIndex - 1 + instrumentStepCount) % instrumentStepCount;
        const step = steps[localIndex] || steps[localIndex % steps.length];
        if (!step || !step.active) {
            return;
        }
        const prevStep = steps[prevIndex] || null;

        // One instrument failing must not abort the loop: runAudioScheduler()
        // would then never advance nextStepIndex, stalling every instrument and
        // re-triggering the ones scheduled before the failure on each tick.
        try {
            scheduleInstrumentStep(instrument, step, prevStep, when, stepDuration);
        } catch (error) {
            console.error(`Scheduler: failed to schedule ${instrument.type} "${instrument.name}"`, error);
        }
    });
}

// Schedule individual instrument step
export function scheduleInstrumentStep(instrument, step, prevStep, when, stepDuration) {
    if (audioState.mutedInstruments.has(instrument.id)) {
        return;
    }
    const ctx = ensureAudioContext();
    if (!ctx || !audioState.masterGain) {
        return;
    }

    switch (instrument.type) {
        case SynthTypes.TB303:
            scheduleTB303(instrument, step, prevStep, when, ctx, stepDuration);
            break;
        case SynthTypes.DRUMS:
            scheduleDrums(instrument, step, when, ctx);
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
