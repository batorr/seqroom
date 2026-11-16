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
    randomDrumHits,
} from '../public/src/shared/drum-kit.js';

// Scrambled seed so nearby seeds start the LCG apart.
function seeded(seed) {
    let s = Math.imul(seed, 2654435761) >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

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

test('the kit has toms, cowbell, shaker and crash after the original seven voices', () => {
    assert.deepEqual(DRUM_VOICE_IDS, ['kick', 'snare', 'clap', 'rim', 'hat', 'openhat', 'ride', 'tomlow', 'tommid', 'tomhigh', 'cowbell', 'shaker', 'crash']);
});

test('an old kit without the new voices picks up their defaults', () => {
    const params = normalizeDrumParams({ kickLevel: 0.4 });
    assert.equal(params.kickLevel, 0.4);
    assert.equal(params.tomlowTune, DRUM_PARAMS.tomlowTune.default);
    assert.equal(params.crashDecay, DRUM_PARAMS.crashDecay.default);
});

test('random drums keep the four on the floor and put every voice where it belongs', () => {
    const seen = Object.fromEntries(DRUM_VOICE_IDS.map((id) => [id, 0]));
    for (let seed = 1; seed <= 300; seed += 1) {
        const rng = seeded(seed);
        for (let i = 0; i < 32; i += 1) {
            const hits = randomDrumHits(i, rng);
            const pos = i % 16;
            assert.deepEqual(Object.keys(hits).sort(), [...DRUM_VOICE_IDS].sort());
            assert.equal(hits.kick, pos % 4 === 0, `step ${i}`);
            if (hits.openhat) assert.equal(pos % 4, 2);
            if (hits.openhat) assert.equal(hits.hat, false);
            if (hits.tomhigh) assert.ok(pos === 13 || pos === 7, `high tom on ${pos}`);
            if (hits.tommid) assert.equal(pos, 14);
            if (hits.tomlow) assert.ok(pos === 15 || pos === 10, `low tom on ${pos}`);
            if (hits.cowbell) assert.ok(pos % 4 === 3 || pos === 6, `cowbell on ${pos}`);
            if (hits.crash) assert.equal(i, 0, `crash on ${i}`);
            DRUM_VOICE_IDS.forEach((id) => { if (hits[id]) seen[id] += 1; });
        }
    }
    // Every voice turns up somewhere across the rolls.
    DRUM_VOICE_IDS.forEach((id) => assert.ok(seen[id] > 0, `${id} never rolled`));
    assert.ok(seen.shaker > seen.cowbell);
});
