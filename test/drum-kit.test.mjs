import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DRUM_VOICE_IDS,
    DRUM_PARAMS,
    DRUM_VOICE_PARAM_KEYS,
    DRUM_KIT_PARAM_KEYS,
    normalizeDrumParams,
    applyDrumParamUpdates,
    createDrumLayers,
} from '../public/src/shared/drum-kit.js';

test('every voice has parameters and every listed parameter exists', () => {
    assert.deepEqual(Object.keys(DRUM_VOICE_PARAM_KEYS), DRUM_VOICE_IDS);
    for (const key of [...DRUM_KIT_PARAM_KEYS, ...Object.values(DRUM_VOICE_PARAM_KEYS).flat()]) {
        assert.ok(DRUM_PARAMS[key], `missing schema for ${key}`);
    }
});

test('normalizing fills defaults, clamps values and drops unknown keys', () => {
    const params = normalizeDrumParams({ kickLevel: 3, hatDecay: -1, snareTune: 'x', kickLevelExtra: 1 });
    assert.equal(params.kickLevel, 1);
    assert.equal(params.hatDecay, 0);
    assert.equal(params.snareTune, DRUM_PARAMS.snareTune.default);
    assert.equal(params.volume, DRUM_PARAMS.volume.default);
    assert.equal('kickLevelExtra' in params, false);
    assert.deepEqual(Object.keys(params).sort(), Object.keys(DRUM_PARAMS).sort());
});

test('updates are clamped, ignore unknown or non-numeric values, and report changes', () => {
    const params = normalizeDrumParams({});
    assert.equal(applyDrumParamUpdates(params, { kickTune: 0.9, bogus: 1, rideDecay: 'long' }), true);
    assert.equal(params.kickTune, 0.9);
    assert.equal('bogus' in params, false);
    assert.equal(params.rideDecay, DRUM_PARAMS.rideDecay.default);
    assert.equal(applyDrumParamUpdates(params, { kickTune: 0.9 }), false);
    applyDrumParamUpdates(params, { clapDecay: 7 });
    assert.equal(params.clapDecay, 1);
});

test('a fresh step has one silent layer per voice', () => {
    const layers = createDrumLayers();
    assert.deepEqual(Object.keys(layers), DRUM_VOICE_IDS);
    assert.ok(Object.values(layers).every((on) => on === false));
});
