import test from 'node:test';
import assert from 'node:assert/strict';
import { ACID_SCALES, randomAcidLine } from '../public/src/shared/acid-line.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Deterministic generator so failures reproduce.
function seeded(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

const pitchClass = (pitch) => NOTE_NAMES.indexOf(pitch.replace(/\d+$/, ''));

test('slides and accents are only rolled on notes that play', () => {
    for (let seed = 1; seed <= 500; seed += 1) {
        randomAcidLine(16, seeded(seed)).steps.forEach((step, i) => {
            if (step.slide) assert.ok(step.active, `seed ${seed}: slide on a rest at step ${i}`);
            if (step.accent) assert.ok(step.active, `seed ${seed}: accent on a rest at step ${i}`);
        });
    }
});

test('a short pattern always gets a note; an all-rest roll plays the root on step 1', () => {
    for (const count of [1, 2, 3, 4]) {
        for (let seed = 1; seed <= 500; seed += 1) {
            const { steps } = randomAcidLine(count, seeded(seed));
            assert.equal(steps.length, count);
            assert.ok(steps.some((step) => step.active), `count ${count}, seed ${seed}: no note`);
        }
    }
    // Force the fallback: a generator that rolls every step as a rest.
    let call = 0;
    const restsOnly = () => (call++ < 2 ? 0 : 0.99);
    const { root, steps } = randomAcidLine(4, restsOnly);
    assert.deepEqual(steps.map((step) => step.active), [true, false, false, false]);
    assert.equal(pitchClass(steps[0].pitch), NOTE_NAMES.indexOf(root));
    assert.equal(steps[0].pitch.slice(-1), '2');
});

test('a slide may lead into a rest', () => {
    const intoRest = Array.from({ length: 100 }, (_, seed) => randomAcidLine(16, seeded(seed + 1)).steps)
        .some((steps) => steps.some((step, i) => step.slide && !steps[(i + 1) % steps.length].active));
    assert.ok(intoRest);
});

test('every pitch, active or not, is in the rolled root and scale', () => {
    for (let seed = 1; seed <= 500; seed += 1) {
        const { root, scale, steps } = randomAcidLine(16, seeded(seed));
        const { intervals } = ACID_SCALES.find((s) => s.name === scale);
        const allowed = new Set(intervals.map((i) => (NOTE_NAMES.indexOf(root) + i) % 12));
        steps.forEach((step) => assert.ok(allowed.has(pitchClass(step.pitch)), `seed ${seed}: ${step.pitch} not in ${root} ${scale}`));
    }
});

test('the root is the most common note and every scale gets rolled', () => {
    const scales = new Set();
    let rootHits = 0;
    let total = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
        const { root, scale, steps } = randomAcidLine(16, seeded(seed));
        scales.add(scale);
        steps.forEach((step) => {
            total += 1;
            if (pitchClass(step.pitch) === NOTE_NAMES.indexOf(root)) rootHits += 1;
        });
    }
    assert.equal(scales.size, ACID_SCALES.length);
    assert.ok(rootHits / total > 0.3);
});

test('pitches stay in a bass register', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
        randomAcidLine(16, seeded(seed)).steps.forEach((step) => {
            const octave = Number(step.pitch.match(/\d+$/)[0]);
            assert.ok(octave >= 2 && octave <= 4, step.pitch);
        });
    }
});
