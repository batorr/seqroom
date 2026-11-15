import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FX_VOICES,
    FX_VOICE_IDS,
    FX_DEFAULT_LANE,
    FX_PARAMS,
    fxLengthSteps,
    normalizeFxParams,
    applyFxParamUpdates,
    createFxLayers,
    randomFxLine,
} from '../public/src/shared/fx.js';

// Scrambled seed so nearby seeds start the LCG apart.
function seeded(seed) {
    let s = Math.imul(seed, 2654435761) >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

test('the lanes are riser, downlifter, impact and zap, and Fill starts on impact', () => {
    assert.deepEqual(FX_VOICE_IDS, ['riser', 'downlifter', 'impact', 'zap']);
    assert.equal(FX_VOICES.length, 4);
    assert.ok(FX_VOICE_IDS.includes(FX_DEFAULT_LANE));
    assert.deepEqual(createFxLayers(), { riser: false, downlifter: false, impact: false, zap: false });
});

test('Length snaps to 4, 8, 16, 32 or 64 steps, defaulting to half a bar', () => {
    assert.equal(fxLengthSteps(0), 4);
    assert.equal(fxLengthSteps(0.25), 8);
    assert.equal(fxLengthSteps(0.5), 16);
    assert.equal(fxLengthSteps(0.75), 32);
    assert.equal(fxLengthSteps(1), 64);
    assert.equal(fxLengthSteps(0.3), 8);
    assert.equal(fxLengthSteps(7), 64);
    assert.equal(fxLengthSteps('x'), fxLengthSteps(FX_PARAMS.length.default));
    assert.equal(fxLengthSteps(FX_PARAMS.length.default), 8);
});

test('normalizing fills defaults, clamps values and drops unknown keys', () => {
    const params = normalizeFxParams({ tone: 9, reverb: -1, length: 'x', bogus: 1 });
    assert.deepEqual(Object.keys(params).sort(), Object.keys(FX_PARAMS).sort());
    assert.equal(params.tone, 1);
    assert.equal(params.reverb, 0);
    assert.equal(params.length, FX_PARAMS.length.default);
});

test('updates only touch known numeric keys and report changes', () => {
    const params = normalizeFxParams({});
    assert.equal(applyFxParamUpdates(params, { length: 0.75, bogus: 1, tone: 'dark' }), true);
    assert.equal(params.length, 0.75);
    assert.equal(params.tone, FX_PARAMS.tone.default);
    assert.equal('bogus' in params, false);
    assert.equal(applyFxParamUpdates(params, { length: 0.75 }), false);
});

test('a roll drops an impact on step 1 and lands the riser on the loop point when it fits', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
        const { steps, riserAt } = randomFxLine(32, { length: 0.5 }, seeded(seed));
        assert.ok(steps[0].layers.impact);
        assert.equal(riserAt, 16);
        assert.ok(steps[16].layers.riser);
        assert.equal(steps.filter((step) => step.layers.riser).length, 1);
        steps.forEach((step, i) => {
            if (step.layers.zap) assert.equal(i % 4, 2, `seed ${seed}: zap on ${i}`);
            if (step.layers.downlifter) assert.equal(i, 0);
            assert.equal(step.active, FX_VOICE_IDS.some((id) => step.layers[id]));
        });
        assert.ok(steps.filter((step) => step.layers.zap).length <= 2);
    }
});

test('a riser as long as the pattern or longer is left out', () => {
    const { steps, riserAt } = randomFxLine(16, { length: 0.5 }, seeded(1));
    assert.equal(riserAt, null);
    assert.ok(!steps.some((step) => step.layers.riser));
    assert.ok(steps[0].layers.impact);
});

test('downlifters and zaps both show up across rolls, and empty patterns are safe', () => {
    let downlifters = 0;
    let zaps = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
        const { steps } = randomFxLine(16, {}, seeded(seed));
        if (steps[0].layers.downlifter) downlifters += 1;
        zaps += steps.filter((step) => step.layers.zap).length;
    }
    assert.ok(downlifters > 50 && downlifters < 150, `downlifters ${downlifters}`);
    assert.ok(zaps > 50, `zaps ${zaps}`);
    assert.deepEqual(randomFxLine(0, {}, seeded(1)).steps, []);
});
