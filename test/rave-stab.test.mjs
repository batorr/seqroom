import test from 'node:test';
import assert from 'node:assert/strict';
import {
    STAB_PARAMS,
    STAB_CHORDS,
    STAB_DEFAULT_CHORD,
    STAB_DEFAULT_PITCH,
    STAB_RHYTHMS,
    chordIntervals,
    normalizeStabParams,
    applyStabParamUpdates,
    stabPitch,
    randomStabLine,
} from '../public/src/shared/rave-stab.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function seeded(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

const pitchClass = (pitch) => NOTE_NAMES.indexOf(pitch.replace(/\d+$/, ''));
const frequency = (pitch) => {
    const [, name, octave] = pitch.match(/^([A-G]#?)(\d)$/);
    return 440 * 2 ** ((12 * (Number(octave) + 1) + NOTE_NAMES.indexOf(name) - 69) / 12);
};

test('normalizing fills defaults, clamps values, validates the chord and drops unknown keys', () => {
    const params = normalizeStabParams({ cutoff: 2, detune: -1, decay: 'x', chord: 'major', bogus: 1 });
    assert.deepEqual(Object.keys(params).sort(), [...Object.keys(STAB_PARAMS), 'chord'].sort());
    assert.equal(params.cutoff, 1);
    assert.equal(params.detune, 0);
    assert.equal(params.decay, STAB_PARAMS.decay.default);
    assert.equal(params.chord, STAB_DEFAULT_CHORD);
    assert.equal(normalizeStabParams({ chord: 'fifth' }).chord, 'fifth');
});

test('updates accept known chords and numeric keys only, and report changes', () => {
    const params = normalizeStabParams({});
    assert.equal(applyStabParamUpdates(params, { chord: 'min9', envelope: 0.9, bogus: 1 }), true);
    assert.equal(params.chord, 'min9');
    assert.equal(params.envelope, 0.9);
    assert.equal('bogus' in params, false);
    assert.equal(applyStabParamUpdates(params, { chord: 'diminished', volume: 'loud' }), false);
    assert.equal(params.chord, 'min9');
    assert.equal(applyStabParamUpdates(params, { chord: 'min9' }), false);
});

test('chord shapes are minor or open, and an unknown chord falls back to the default', () => {
    for (const { value, intervals } of STAB_CHORDS) {
        assert.equal(intervals[0], 0, value);
        assert.ok(!intervals.includes(4), `${value} has a major third`);
        assert.deepEqual(chordIntervals(value), intervals);
    }
    assert.deepEqual(chordIntervals('nonsense'), chordIntervals(STAB_DEFAULT_CHORD));
    assert.deepEqual(chordIntervals(undefined), chordIntervals(STAB_DEFAULT_CHORD));
});

test('every pitch class maps to a chord root between G3 and F#4', () => {
    for (let pc = 0; pc < 12; pc += 1) {
        const hz = frequency(stabPitch(pc));
        assert.ok(hz >= 195 && hz < 371, `${stabPitch(pc)} is ${hz} Hz`);
        assert.equal(pitchClass(stabPitch(pc)), pc);
    }
    assert.equal(stabPitch(9), STAB_DEFAULT_PITCH);
});

test('a roll keeps the key on the first half bar and moves only to bVII, bVI or iv after it', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
        const { root, steps } = randomStabLine(32, { rootClass: 9 }, seeded(seed));
        assert.equal(root, 'A');
        const allowed = new Set([0, 10, 8, 5].map((i) => (9 + i) % 12));
        steps.forEach((step, i) => {
            assert.ok(allowed.has(pitchClass(step.pitch)), `seed ${seed}: ${step.pitch}`);
            if (i < 8) assert.equal(pitchClass(step.pitch), 9, `seed ${seed}: step ${i} left the key`);
            // One root per half bar.
            assert.equal(step.pitch, steps[Math.floor(i / 8) * 8].pitch);
        });
    }
});

test('hits come from the rolled rhythm, give or take the odd one', () => {
    let fromRhythm = 0;
    let total = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
        const { rhythm, steps } = randomStabLine(16, {}, seeded(seed));
        const hits = new Set(STAB_RHYTHMS.find((r) => r.name === rhythm).hits);
        steps.forEach((step, i) => {
            if (!step.active) return;
            total += 1;
            if (hits.has(i)) fromRhythm += 1;
            else assert.equal(i % 2, 0, `seed ${seed}: extra hit on a sixteenth (${i})`);
        });
    }
    assert.ok(fromRhythm / total > 0.85);
});

test('short patterns always get a hit', () => {
    for (const count of [1, 2, 3]) {
        for (let seed = 1; seed <= 200; seed += 1) {
            const { steps } = randomStabLine(count, {}, seeded(seed));
            assert.equal(steps.length, count);
            assert.ok(steps.some((step) => step.active), `count ${count}, seed ${seed}`);
        }
    }
});
