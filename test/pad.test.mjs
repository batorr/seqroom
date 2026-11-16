import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PAD_PARAMS,
    PAD_CHORDS,
    PAD_DEFAULT_CHORD,
    PAD_DEFAULT_PITCH,
    PAD_PROGRESSIONS,
    normalizePadParams,
    applyPadParamUpdates,
    padChordIntervals,
    padLengthSteps,
    padPitch,
    padSpan,
    randomPadLine,
} from '../public/src/shared/pad.js';

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
const pitchClass = (pitch) => semitones(pitch) % 12;

test('normalizing fills defaults, clamps values and drops unknown keys', () => {
    const params = normalizePadParams({ attack: 4, release: -2, cutoff: 'x', chord: 'major', bogus: 1 });
    assert.deepEqual(Object.keys(params).sort(), [...Object.keys(PAD_PARAMS), 'chord'].sort());
    assert.equal(params.attack, 1);
    assert.equal(params.release, 0);
    assert.equal(params.cutoff, PAD_PARAMS.cutoff.default);
    assert.equal(params.chord, PAD_DEFAULT_CHORD);
});

test('a saved Poly Synth keeps the settings the Pad shares with it', () => {
    const params = normalizePadParams({
        volume: 0.5, attack: 0.05, decay: 0.3, release: 2.5, cutoff: 0.6, resonance: 0.3, delay: 0, reverb: 0.2, waveform: 'sine',
    });
    assert.equal(params.volume, 0.5);
    assert.equal(params.attack, 0.05);
    assert.equal(params.release, 1);
    assert.equal(params.cutoff, 0.6);
    assert.equal(params.delay, 0);
    assert.equal(params.reverb, 0.2);
    assert.equal(params.length, PAD_PARAMS.length.default);
    assert.equal('decay' in params || 'resonance' in params || 'waveform' in params, false);
});

test('updates only touch known keys and chord shapes, and report changes', () => {
    const params = normalizePadParams({});
    assert.equal(applyPadParamUpdates(params, { length: 1, chord: 'fifth', bogus: 1, cutoff: 'bright' }), true);
    assert.equal(params.length, 1);
    assert.equal(params.chord, 'fifth');
    assert.equal(params.cutoff, PAD_PARAMS.cutoff.default);
    assert.equal('bogus' in params, false);
    assert.equal(applyPadParamUpdates(params, { length: 1, chord: 'major' }), false);
    assert.equal(params.chord, 'fifth');
});

test('Length snaps to 2, 4, 8, 16 or 32 steps', () => {
    assert.deepEqual([0, 0.25, 0.5, 0.75, 1].map(padLengthSteps), [2, 4, 8, 16, 32]);
    assert.equal(padLengthSteps(0.6), 8);
    assert.equal(padLengthSteps(-1), 2);
    assert.equal(padLengthSteps(7), 32);
    assert.equal(padLengthSteps('long'), 16);
    assert.equal(padLengthSteps(PAD_PARAMS.length.default), 16);
});

test('chord shapes fall back to the default one', () => {
    for (const { value, intervals } of PAD_CHORDS) {
        assert.deepEqual(padChordIntervals(value), intervals);
    }
    const fallback = PAD_CHORDS.find((entry) => entry.value === PAD_DEFAULT_CHORD).intervals;
    assert.deepEqual(padChordIntervals('major'), fallback);
    assert.deepEqual(padChordIntervals(undefined), fallback);
});

test('every key maps to a root between F3 and E4', () => {
    for (let pc = -12; pc < 24; pc += 1) {
        const pitch = padPitch(pc);
        assert.ok(semitones(pitch) >= semitones('F3') && semitones(pitch) <= semitones('E4'), pitch);
        assert.equal(pitchClass(pitch), ((pc % 12) + 12) % 12);
    }
    assert.equal(padPitch(9), PAD_DEFAULT_PITCH);
});

test('random lines change chord once per span, in key, and fill each span', () => {
    const allowed = new Set(PAD_PROGRESSIONS.flatMap(({ roots }) => roots));
    for (const length of [0, 0.25, 0.5, 0.75, 1]) {
        const span = padSpan(padLengthSteps(length));
        const every = Math.min(padLengthSteps(length), span);
        for (let seed = 1; seed <= 200; seed += 1) {
            const { root, progression, steps } = randomPadLine(48, { rootClass: 2, length }, seeded(seed));
            assert.equal(root, 'D');
            assert.ok(PAD_PROGRESSIONS.some(({ name }) => name === progression));
            assert.equal(steps.length, 48);
            assert.equal(pitchClass(steps[0].pitch), 2);
            steps.forEach((step, i) => {
                assert.equal(step.active, (i % span) % every === 0, `step ${i}, length ${length}`);
                assert.ok(allowed.has((pitchClass(step.pitch) - 2 + 12) % 12), step.pitch);
                assert.ok(semitones(step.pitch) >= semitones('F3') && semitones(step.pitch) <= semitones('E4'), step.pitch);
                // One chord root for the whole span, rests included.
                assert.equal(step.pitch, steps[i - (i % span)].pitch);
            });
        }
    }
});

test('a short pattern still starts a chord, and an unknown key is rolled', () => {
    const { steps } = randomPadLine(3, {}, seeded(7));
    assert.deepEqual(steps.map((step) => step.active), [true, false, false]);
    const keys = new Set();
    for (let seed = 1; seed <= 200; seed += 1) {
        keys.add(randomPadLine(16, {}, seeded(seed)).root);
    }
    assert.equal(keys.size, 12);
});
