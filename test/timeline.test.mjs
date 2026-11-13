import test from 'node:test';
import assert from 'node:assert/strict';
import {
    TEMPO_CHANGE_LEAD_MS,
    stepDurationMs,
    stepTime,
    stepPositionAt,
    startTransport,
    stopTransport,
    changeTempo,
    collectDueSteps,
    legacySessionStartTime,
    normalizeTransport,
} from '../public/src/shared/timeline.js';

const EPS = 1e-6;

function started(bpm = 120, startTime = 2000) {
    return startTransport({ bpm, playing: false, playId: 0, segments: [] }, startTime);
}

function mulberry32(seed) {
    let a = seed;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test('steps are evenly spaced at a constant tempo', () => {
    const transport = started(120, 1000);
    assert.equal(stepDurationMs(120), 125);
    assert.equal(stepTime(transport, 0), 1000);
    assert.equal(stepTime(transport, 16), 3000);
    assert.ok(Math.abs(stepPositionAt(transport, 3000) - 16) < EPS);
    assert.ok(stepPositionAt(transport, 500) < 0);
});

test('start/stop bump the play id and clear the timeline', () => {
    const first = started(120, 1000);
    assert.equal(first.playId, 1);
    const stopped = stopTransport(first);
    assert.equal(stopped.playing, false);
    assert.deepEqual(stopped.segments, []);
    assert.equal(startTransport(stopped, 5000).playId, 2);
});

test('a tempo change never moves steps inside the lead window', () => {
    const before = started(120, 0);
    const now = 10_000;
    const after = changeTempo(before, 180, now);
    for (let step = 0; stepTime(before, step) < now + TEMPO_CHANGE_LEAD_MS; step += 1) {
        assert.equal(stepTime(after, step), stepTime(before, step), `step ${step} moved`);
    }
    const boundary = after.segments.at(-1).anchorStep;
    assert.ok(stepTime(after, boundary) >= now + TEMPO_CHANGE_LEAD_MS - EPS);
    assert.ok(Math.abs((stepTime(after, boundary + 1) - stepTime(after, boundary)) - stepDurationMs(180)) < EPS);
});

test('a tempo change before playback starts keeps the start time', () => {
    const before = started(120, 2000);
    const after = changeTempo(before, 90, 100);
    assert.equal(after.segments.length, 1);
    assert.equal(stepTime(after, 0), 2000);
    assert.ok(Math.abs(stepTime(after, 1) - 2000 - stepDurationMs(90)) < EPS);
});

test('a still-pending change is retuned in place instead of stacking', () => {
    const transport = started(120, 0);
    // 120 BPM -> 125 ms steps: a change at 10010 opens a segment at step 85 (10625 ms).
    const first = changeTempo(transport, 150, 10_010);
    // 40 ms later the earliest allowed boundary (10550) is still before 10625.
    const second = changeTempo(first, 160, 10_050);
    assert.equal(second.segments.length, first.segments.length);
    assert.equal(second.segments.at(-1).bpm, 160);
    assert.equal(second.segments.at(-1).anchorTime, first.segments.at(-1).anchorTime);
});

test('random tempo automation keeps the timeline monotonic and the near future fixed', () => {
    const random = mulberry32(42);
    let transport = started(120, 0);
    let now = 0;
    for (let change = 0; change < 400; change += 1) {
        now += random() * 300;
        const bpm = 30 + Math.round(random() * 270);
        const next = changeTempo(transport, bpm, now);
        const firstFutureStep = Math.max(0, Math.ceil(stepPositionAt(transport, now)));
        let step = firstFutureStep;
        for (; stepTime(transport, step) < now + TEMPO_CHANGE_LEAD_MS; step += 1) {
            assert.ok(Math.abs(stepTime(next, step) - stepTime(transport, step)) < EPS, `change ${change}: step ${step} moved`);
        }
        for (let s = firstFutureStep; s < step + 64; s += 1) {
            assert.ok(stepTime(next, s + 1) > stepTime(next, s), `change ${change}: not monotonic at ${s}`);
            assert.ok(Math.abs(stepPositionAt(next, stepTime(next, s)) - s) < 1e-6);
        }
        assert.ok(next.segments.length <= 32);
        transport = next;
    }
});

test('collectDueSteps never returns a step twice or out of order', () => {
    const transport = started(120, 0);
    const first = collectDueSteps(transport, { nextStep: 0, lastTime: -Infinity, horizonTime: 300 });
    assert.deepEqual(first.due.map((d) => d.step), [0, 1, 2]);
    const again = collectDueSteps(transport, { nextStep: 1, lastTime: first.lastTime, horizonTime: 500 });
    assert.deepEqual(again.due.map((d) => d.step), [3, 4]);
});

test('legacy session start matches the latest segment', () => {
    const transport = changeTempo(started(120, 0), 150, 10_000);
    const legacy = legacySessionStartTime(transport);
    const last = transport.segments.at(-1);
    assert.ok(Math.abs(legacy + last.anchorStep * stepDurationMs(150) - last.anchorTime) < EPS);
});

test('normalizeTransport accepts old payloads and drops bad segments', () => {
    const fromLegacy = normalizeTransport({ bpm: 128, playing: true, sessionStartTime: 5000 });
    assert.deepEqual(fromLegacy.segments, [{ anchorStep: 0, anchorTime: 5000, bpm: 128 }]);
    const cleaned = normalizeTransport({
        bpm: 128,
        playing: true,
        playId: 3,
        segments: [{ anchorStep: 0, anchorTime: 0, bpm: 128 }, { anchorStep: 'x', anchorTime: 1, bpm: 1 }],
    });
    assert.equal(cleaned.segments.length, 1);
    assert.equal(cleaned.playId, 3);
    assert.deepEqual(normalizeTransport({ bpm: 128, playing: false, segments: [{ anchorStep: 0, anchorTime: 0, bpm: 128 }] }).segments, []);
});
