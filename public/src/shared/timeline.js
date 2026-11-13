// Transport timeline, shared by the server (via dynamic import) and the browser.
//
// A playing transport maps step numbers (16th notes) to server time in ms as
// a list of tempo segments, ordered by anchorStep:
//
//   { playing, playId, bpm, segments: [{ anchorStep, anchorTime, bpm }, ...] }
//
// Step n uses the last segment whose anchorStep <= n. A tempo change never
// rewrites the past or the near future: it opens a new segment at the first
// step boundary at least TEMPO_CHANGE_LEAD_MS ahead of the moment the server
// applies it. Every client schedules audio less than that far ahead, so notes
// already queued in Web Audio never move and every client switches tempo on
// the same step.

export const STEPS_PER_BEAT = 4;

// Must exceed client schedule-ahead + output latency + one-way network delay.
export const TEMPO_CHANGE_LEAD_MS = 500;

// Segments that ended this long ago are dropped; nothing schedules that far back.
const SEGMENT_PRUNE_AGE_MS = 5000;
const MAX_SEGMENTS = 32;

export function stepDurationMs(bpm) {
    return 60000 / (bpm * STEPS_PER_BEAT);
}

function segmentForStep(segments, step) {
    for (let index = segments.length - 1; index > 0; index -= 1) {
        if (step >= segments[index].anchorStep) {
            return segments[index];
        }
    }
    return segments[0];
}

function segmentForTime(segments, timeMs) {
    for (let index = segments.length - 1; index > 0; index -= 1) {
        if (timeMs >= segments[index].anchorTime) {
            return segments[index];
        }
    }
    return segments[0];
}

function hasTimeline(transport) {
    return Boolean(transport && Array.isArray(transport.segments) && transport.segments.length);
}

// Server time (ms) at which `step` starts.
export function stepTime(transport, step) {
    const segment = segmentForStep(transport.segments, step);
    return segment.anchorTime + (step - segment.anchorStep) * stepDurationMs(segment.bpm);
}

// Fractional step position at server time `timeMs` (negative before the start).
export function stepPositionAt(transport, timeMs) {
    if (!hasTimeline(transport)) {
        return -1;
    }
    const segment = segmentForTime(transport.segments, timeMs);
    return segment.anchorStep + (timeMs - segment.anchorTime) / stepDurationMs(segment.bpm);
}

export function startTransport(transport, startTime) {
    return {
        bpm: transport.bpm,
        playing: true,
        playId: (Number.isFinite(transport.playId) ? transport.playId : 0) + 1,
        segments: [{ anchorStep: 0, anchorTime: startTime, bpm: transport.bpm }],
    };
}

export function stopTransport(transport) {
    return { ...transport, playing: false, segments: [] };
}

function pruneSegments(segments, nowMs) {
    let pruned = segments;
    while (pruned.length > 1 && pruned[1].anchorTime <= nowMs - SEGMENT_PRUNE_AGE_MS) {
        pruned = pruned.slice(1);
    }
    if (pruned.length > MAX_SEGMENTS) {
        pruned = pruned.slice(pruned.length - MAX_SEGMENTS);
    }
    return pruned;
}

export function changeTempo(transport, bpm, nowMs, leadMs = TEMPO_CHANGE_LEAD_MS) {
    if (!transport.playing || !hasTimeline(transport)) {
        return { ...transport, bpm };
    }

    const segments = transport.segments;
    const last = segments[segments.length - 1];
    const earliest = nowMs + leadMs;
    const boundary = Math.max(last.anchorStep, Math.ceil(stepPositionAt(transport, earliest) - 1e-9));

    let nextSegments;
    if (boundary === last.anchorStep) {
        // The latest segment starts at or after `earliest` (playback has not
        // started yet, or an earlier change is still pending): retune it in place.
        nextSegments = [...segments.slice(0, -1), { ...last, bpm }];
    } else {
        nextSegments = [...segments, { anchorStep: boundary, anchorTime: stepTime(transport, boundary), bpm }];
    }

    return { ...transport, bpm, segments: pruneSegments(nextSegments, nowMs) };
}

// Steps whose start time is <= horizonTime, beginning at nextStep. A step at
// or before lastTime is skipped rather than played twice or out of order.
export function collectDueSteps(transport, { nextStep, lastTime, horizonTime, maxSteps = 512 }) {
    const due = [];
    let step = nextStep;
    let latest = lastTime;
    while (due.length < maxSteps) {
        const time = stepTime(transport, step);
        if (time > horizonTime) {
            break;
        }
        if (time > latest) {
            due.push({ step, time });
            latest = time;
        }
        step += 1;
    }
    return { due, nextStep: step, lastTime: latest };
}

// The start time pre-timeline clients compute every step from.
export function legacySessionStartTime(transport) {
    if (!hasTimeline(transport)) {
        return null;
    }
    const last = transport.segments[transport.segments.length - 1];
    return last.anchorTime - last.anchorStep * stepDurationMs(last.bpm);
}

function isValidSegment(segment) {
    return Boolean(segment)
        && Number.isFinite(segment.anchorStep)
        && Number.isFinite(segment.anchorTime)
        && Number.isFinite(segment.bpm)
        && segment.bpm > 0;
}

export function normalizeTransport(raw = {}, { defaultBpm = 120, clampBpm = (value) => value } = {}) {
    const bpm = clampBpm(Number.isFinite(Number(raw.bpm)) && Number(raw.bpm) > 0 ? Number(raw.bpm) : defaultBpm);
    const playing = Boolean(raw.playing);
    let segments = Array.isArray(raw.segments)
        ? raw.segments.filter(isValidSegment).map((segment) => ({
            anchorStep: segment.anchorStep,
            anchorTime: segment.anchorTime,
            bpm: clampBpm(segment.bpm),
        }))
        : [];
    if (!segments.length && playing && Number.isFinite(raw.sessionStartTime)) {
        segments = [{ anchorStep: 0, anchorTime: raw.sessionStartTime, bpm }];
    }
    return {
        bpm,
        playing,
        playId: Number.isFinite(raw.playId) ? raw.playId : null,
        segments: playing ? segments : [],
    };
}
