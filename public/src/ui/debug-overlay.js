// ?debug=1: a small live readout in the corner, for chasing glitches on
// devices without developer tools (phones). It shows whether the audio thread
// keeps up (audio clock vs wall clock), whether the scheduler queues steps in
// time (tick gaps, lead, late and dropped steps), main-thread stalls, how many
// sound sources are alive (a steady rise would be a leak) and whether the
// screen is kept awake. Enabled with ?debug=1, which sticks until ?debug=0.

import { audioState, socketState } from '../state/audio.js';
import { schedulerStats } from '../audio/scheduler.js';
import { isScreenKeptAwake } from '../audio/wake-lock.js';

const WINDOW_MS = 5000;

const counters = { started: 0, live: 0 };

// Count every sound source that starts and ends.
function countSources() {
    const proto = window.AudioScheduledSourceNode?.prototype;
    if (!proto || proto.__seqroomCounted) {
        return;
    }
    const start = proto.start;
    proto.start = function countedStart(...args) {
        counters.started += 1;
        counters.live += 1;
        this.addEventListener('ended', () => { counters.live -= 1; }, { once: true });
        return start.apply(this, args);
    };
    proto.__seqroomCounted = true;
}

export function showDebugOverlay() {
    if (document.getElementById('seqroom-debug')) {
        return;
    }
    countSources();

    const panel = document.createElement('pre');
    panel.id = 'seqroom-debug';
    Object.assign(panel.style, {
        position: 'fixed',
        left: '8px',
        bottom: '8px',
        zIndex: '9999',
        margin: '0',
        padding: '8px 10px',
        maxWidth: 'calc(100vw - 16px)',
        overflow: 'hidden',
        background: 'rgba(0, 0, 0, 0.8)',
        color: '#ffffff',
        font: '11px/1.4 ui-monospace, Menlo, monospace',
        whiteSpace: 'pre',
        pointerEvents: 'none',
        borderRadius: '4px',
    });
    document.body.appendChild(panel);

    // Main-thread stalls: how late a 50 ms timer fires.
    let maxLag = 0;
    let expected = performance.now() + 50;
    setInterval(() => {
        const now = performance.now();
        maxLag = Math.max(maxLag, now - expected);
        expected = now + 50;
    }, 50);

    // Audio clock against the wall clock over the window.
    const clockSamples = [];
    let windowStart = performance.now();
    let shownLag = 0;
    let shownGap = 0;
    let shownLead = Infinity;

    const ms = (seconds) => (Number.isFinite(seconds) ? `${Math.round(seconds * 1000)} ms` : '–');
    const render = () => {
        const ctx = audioState.context;
        const now = performance.now();
        if (ctx) {
            clockSamples.push({ wall: now, audio: ctx.currentTime });
            while (clockSamples.length > 2 && now - clockSamples[0].wall > WINDOW_MS) {
                clockSamples.shift();
            }
        }
        if (now - windowStart >= WINDOW_MS) {
            shownLag = maxLag;
            shownGap = schedulerStats.windowMaxTickGapMs;
            shownLead = schedulerStats.windowMinLeadMs;
            maxLag = 0;
            schedulerStats.windowMaxTickGapMs = 0;
            schedulerStats.windowMinLeadMs = Infinity;
            windowStart = now;
        }
        let rate = '–';
        if (clockSamples.length >= 2) {
            const first = clockSamples[0];
            const last = clockSamples[clockSamples.length - 1];
            const wall = (last.wall - first.wall) / 1000;
            if (wall > 0.5) {
                rate = ((last.audio - first.audio) / wall).toFixed(3);
            }
        }
        const lines = [
            'seqroom debug',
            ctx
                ? `audio   ${ctx.state} · ${ctx.sampleRate} Hz · base ${ms(ctx.baseLatency)} · out ${ms(ctx.outputLatency)} · ts ${typeof ctx.getOutputTimestamp === 'function' ? 'yes' : 'no'}`
                : 'audio   not started',
            `clock   audio/wall ${rate} · offset ${Math.round(socketState.clockOffsetMs)} ms · rtt ${Math.round(socketState.latencyEstimateMs)} ms`,
            `sched   ahead ${Math.round(schedulerStats.scheduleAheadMs)} ms · max tick gap ${Math.round(shownGap)} ms · min lead ${Number.isFinite(shownLead) ? `${Math.round(shownLead)} ms` : '–'}`,
            `steps   late ${schedulerStats.lateSteps} · dropped ${audioState.droppedSteps || 0}`,
            `thread  max lag ${Math.round(shownLag)} ms (5 s)`,
            `voices  live ${counters.live} · started ${counters.started}`,
            `page    ${document.visibilityState} · wake lock ${isScreenKeptAwake() ? 'on' : 'off'} · DOM ${document.getElementsByTagName('*').length}`,
        ];
        panel.textContent = lines.join('\n');
    };
    render();
    setInterval(render, 1000);
}
