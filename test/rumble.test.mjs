import test from 'node:test';
import assert from 'node:assert/strict';
import {
    RUMBLE_PARAMS,
    RUMBLE_DEFAULT_PITCH,
    normalizeRumbleParams,
    applyRumbleParamUpdates,
    rumblePitch,
    dominantPitchClass,
    randomRumbleLine,
} from '../public/src/shared/rumble.js';

function seeded(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

const frequency = (pitch) => {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const [, name, octave] = pitch.match(/^([A-G]#?)(\d)$/);
    const midi = 12 * (Number(octave) + 1) + names.indexOf(name);
    return 440 * 2 ** ((midi - 69) / 12);
};

test('normalizing fills defaults, clamps values and drops unknown keys', () => {
    const params = normalizeRumbleParams({ tone: 3, pump: -1, decay: 'x', bogus: 1 });
    assert.deepEqual(Object.keys(params).sort(), Object.keys(RUMBLE_PARAMS).sort());
    assert.equal(params.tone, 1);
    assert.equal(params.pump, 0);
    assert.equal(params.decay, RUMBLE_PARAMS.decay.default);
    assert.equal(params.volume, RUMBLE_PARAMS.volume.default);
});

test('updates only touch known numeric keys and report changes', () => {
    const params = normalizeRumbleParams({});
    assert.equal(applyRumbleParamUpdates(params, { drive: 0.9, bogus: 1, tone: 'loud' }), true);
    assert.equal(params.drive, 0.9);
    assert.equal(params.tone, RUMBLE_PARAMS.tone.default);
    assert.equal('bogus' in params, false);
    assert.equal(applyRumbleParamUpdates(params, { drive: 0.9 }), false);
});

test('every pitch class maps into the 40-80 Hz rumble range', () => {
    for (let pc = 0; pc < 12; pc += 1) {
        const hz = frequency(rumblePitch(pc));
        assert.ok(hz >= 40 && hz < 80, `${rumblePitch(pc)} is ${hz} Hz`);
    }
    assert.equal(rumblePitch(9), 'A1');
    assert.equal(rumblePitch(0), 'C2');
    assert.equal(RUMBLE_DEFAULT_PITCH, 'A1');
});

test('the dominant pitch class counts only notes that play within each pattern', () => {
    const line = (pitches, stepCount) => ({
        stepCount,
        steps: pitches.map((p) => (p === '.' ? { active: false, pitch: 'C#2' } : { active: true, pitch: p })),
    });
    assert.equal(dominantPitchClass([line(['F2', 'F3', '.', 'G#2', 'C#2', 'C#2', 'C#2'], 4)]), 5);
    assert.equal(dominantPitchClass([line(['A2', '.'], 2), line(['A#2', 'A3'], 2)]), 9);
    assert.equal(dominantPitchClass([line(['.', '.'], 2)]), null);
    assert.equal(dominantPitchClass([]), null);
});

test('without a kick lane the hits are four on the floor plus the odd eighth, all on one pitch', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
        const { pitch, steps } = randomRumbleLine(16, {}, seeded(seed));
        steps.forEach((step, i) => {
            assert.equal(step.pitch, pitch);
            if (i % 4 === 0) assert.ok(step.active, `seed ${seed}: beat ${i} missing`);
            if (i % 2 === 1) assert.ok(!step.active, `seed ${seed}: hit on a sixteenth (${i})`);
        });
    }
});

test('hits follow the kick lane, repeated over the pattern', () => {
    const kicks = [true, false, false, true, false, false, true, false];
    for (let seed = 1; seed <= 200; seed += 1) {
        const { steps } = randomRumbleLine(16, { kicks }, seeded(seed));
        steps.forEach((step, i) => {
            if (kicks[i % kicks.length]) assert.ok(step.active, `seed ${seed}: kick step ${i} missing`);
        });
    }
});

test('the root comes from rootClass when given', () => {
    const { root, pitch } = randomRumbleLine(16, { rootClass: 5 }, seeded(3));
    assert.equal(root, 'F');
    assert.equal(pitch, 'F1');
});

test('short patterns always get a hit', () => {
    for (const count of [1, 2, 3]) {
        for (let seed = 1; seed <= 200; seed += 1) {
            // A kick lane that never lands inside the pattern.
            const { steps } = randomRumbleLine(count, { kicks: [false, false, false, true] }, seeded(seed));
            assert.equal(steps.length, count);
            assert.ok(steps.some((step) => step.active), `count ${count}, seed ${seed}`);
        }
    }
});
