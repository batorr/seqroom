// End-to-end simulation of a tempo-slider drag: one client drags, the server
// applies each change, every client receives the new transport after its own
// network delay and keeps scheduling with its own look-ahead. The schedule each
// client produces must be gap-free, never doubled, and identical across clients.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTransport, changeTempo, collectDueSteps, stepDurationMs } from '../public/src/shared/timeline.js';

const TICK_MS = 25;
const SLIDER_EVENT_MS = 35; // pointermove rate while dragging
const SEND_INTERVAL_MS = 100; // client-side tempo throttle

function simulate({ from, to, clients }) {
    let serverTransport = startTransport({ bpm: from, playing: false, playId: 0, segments: [] }, 2000);
    const updates = []; // { at (server time), transport }

    // Slider drag starting at t=5000, throttled sends with a trailing value.
    const direction = Math.sign(to - from);
    const sliderEvents = [];
    for (let bpm = from + 2 * direction, t = 5000; direction > 0 ? bpm <= to : bpm >= to; bpm += 2 * direction, t += SLIDER_EVENT_MS) {
        sliderEvents.push({ t, bpm });
    }
    const sends = [];
    let lastSent = -Infinity;
    sliderEvents.forEach(({ t, bpm }, index) => {
        const isLast = index === sliderEvents.length - 1;
        if (t - lastSent >= SEND_INTERVAL_MS || isLast) {
            sends.push({ t: Math.max(t, lastSent + (isLast ? 0 : SEND_INTERVAL_MS)), bpm });
            lastSent = t;
        }
    });

    const dragger = clients[0];
    sends.forEach(({ t, bpm }) => {
        const arrival = t + dragger.latencyMs;
        serverTransport = changeTempo(serverTransport, bpm, arrival);
        updates.push({ at: arrival, transport: serverTransport });
    });

    return clients.map((client) => {
        let transport = startTransport({ bpm: from, playing: false, playId: 0, segments: [] }, 2000);
        let nextStep = 0;
        let lastTime = -Infinity;
        const scheduled = [];
        for (let now = 1500; now <= 9000; now += TICK_MS) {
            const latest = updates.filter((u) => u.at + client.latencyMs <= now).at(-1);
            if (latest) {
                transport = latest.transport;
            }
            const result = collectDueSteps(transport, { nextStep, lastTime, horizonTime: now + client.horizonMs });
            result.due.forEach((d) => {
                // A note whose time already passed cannot be played on time.
                if (d.time >= now) {
                    scheduled.push(d);
                }
            });
            nextStep = result.nextStep;
            lastTime = result.lastTime;
        }
        return scheduled;
    });
}

function assertCleanSchedule(scheduled, from, to) {
    const minStep = stepDurationMs(Math.max(from, to));
    const maxStep = stepDurationMs(Math.min(from, to));
    for (let i = 1; i < scheduled.length; i += 1) {
        assert.equal(scheduled[i].step, scheduled[i - 1].step + 1, `missing or repeated step near ${scheduled[i].step}`);
        const gap = scheduled[i].time - scheduled[i - 1].time;
        assert.ok(gap >= minStep - 1e-6, `flam: ${gap.toFixed(2)} ms between steps ${scheduled[i - 1].step} and ${scheduled[i].step}`);
        assert.ok(gap <= maxStep + 1e-6, `gap: ${gap.toFixed(2)} ms between steps ${scheduled[i - 1].step} and ${scheduled[i].step}`);
    }
}

const CLIENTS = [
    { name: 'dragger, wired', latencyMs: 40, horizonMs: 180 + 30 },
    { name: 'LAN listener', latencyMs: 5, horizonMs: 180 + 10 },
    { name: 'remote listener, Bluetooth', latencyMs: 70, horizonMs: 180 + 250 },
];

for (const [from, to] of [[201, 141], [141, 201], [300, 30]]) {
    test(`dragging ${from} -> ${to} BPM stays clean and identical on every client`, () => {
        const schedules = simulate({ from, to, clients: CLIENTS });
        schedules.forEach((scheduled, index) => {
            assert.ok(scheduled.length > 20, `${CLIENTS[index].name}: too few notes`);
            assertCleanSchedule(scheduled, from, to);
        });
        // Same step -> same server time on every client.
        const [reference, ...others] = schedules;
        const referenceTimes = new Map(reference.map((d) => [d.step, d.time]));
        others.forEach((scheduled, index) => {
            scheduled.forEach((d) => {
                if (referenceTimes.has(d.step)) {
                    assert.equal(d.time, referenceTimes.get(d.step), `${CLIENTS[index + 1].name}: step ${d.step} differs`);
                }
            });
        });
    });
}
