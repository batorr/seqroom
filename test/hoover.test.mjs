import test from 'node:test';
import assert from 'node:assert/strict';
import {
    HOOVER_PARAMS,
    HOOVER_DEFAULT_PITCH,
    HOOVER_RHYTHMS,
    normalizeHooverParams,
    applyHooverParamUpdates,
    hooverPitch,
    randomHooverLine,
} from '../public/src/shared/hoover.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// The seed is scrambled first: nearby seeds would otherwise start this LCG
// on almost the same value, and the key is the very first draw.
function seeded(seed) {
    let s = Math.imul(seed, 2654435761) >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

// Semitones from C1.
const semitones = (pitch) => {
    const [, name, octave] = pitch.match(/^([A-G]#?)(\d)$/);
    return (Number(octave) - 1) * 12 + NOTE_NAMES.indexOf(name);
};

test('normalizing fills defaults, clamps values and drops unknown keys', () => {
    const params = normalizeHooverParams({ bend: 4, glide: -2, width: 'x', bogus: 1 });
    assert.deepEqual(Object.keys(params).sort(), Object.keys(HOOVER_PARAMS).sort());
    assert.equal(params.bend, 1);
    assert.equal(params.glide, 0);
    assert.equal(params.width, HOOVER_PARAMS.width.default);
});

test('updates only touch known numeric keys and report changes', () => {
    const params = normalizeHooverParams({});
    assert.equal(applyHooverParamUpdates(params, { length: 0.9, bogus: 1, cutoff: 'bright' }), true);
    assert.equal(params.length, 0.9);
    assert.equal(params.cutoff, HOOVER_PARAMS.cutoff.default);
    assert.equal('bogus' in params, false);
    assert.equal(applyHooverParamUpdates(params, { length: 0.9 }), false);
});

test('every key maps to a root in octave 3', () => {
    for (let pc = 0; pc < 12; pc += 1) {
        const pitch = hooverPitch(pc);
        assert.equal(pitch.slice(-1), '3', pitch);
        assert.equal(NOTE_NAMES.indexOf(pitch.slice(0, -1)), pc);
    }
    assert.equal(hooverPitch(9), HOOVER_DEFAULT_PITCH);
});

test('each bar starts on the root and the other notes stay within a fifth below and an octave above', () => {
    const allowed = new Set([0, 12, 7, 3, 10, 5, -5]);
    for (let seed = 1; seed <= 300; seed += 1) {
        const { root, rhythm, steps } = randomHooverLine(32, { rootClass: 2 }, seeded(seed));
        assert.equal(root, 'D');
        const hits = new Set(HOOVER_RHYTHMS.find((r) => r.name === rhythm).hits);
        const rootSemis = semitones(hooverPitch(2));
        steps.forEach((step, i) => {
            if (i % 16 === 0) {
                assert.ok(step.active, `seed ${seed}: bar start ${i} is silent`);
                assert.equal(step.pitch, hooverPitch(2));
            }
            if (step.active) {
                assert.ok(hits.has(i % 16), `seed ${seed}: hit off the rhythm at ${i}`);
                assert.ok(allowed.has(semitones(step.pitch) - rootSemis), `seed ${seed}: ${step.pitch}`);
            } else {
                assert.equal(step.pitch, hooverPitch(2), `seed ${seed}: rest ${i} out of key`);
            }
        });
    }
});

test('a random key is used without rootClass, and short patterns still play', () => {
    const keys = new Set();
    for (let seed = 1; seed <= 200; seed += 1) {
        keys.add(randomHooverLine(16, {}, seeded(seed)).root);
        for (const count of [1, 2, 3]) {
            const { steps } = randomHooverLine(count, {}, seeded(seed));
            assert.equal(steps.length, count);
            assert.ok(steps[0].active);
        }
    }
    assert.ok(keys.size > 6);
});
