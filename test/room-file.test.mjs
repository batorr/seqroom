import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ROOM_FILE_FORMAT,
    ROOM_FILE_VERSION,
    createRoomFile,
    readRoomFile,
} from '../public/src/shared/room-file.js';
import { createDrumLayers } from '../public/src/shared/drum-kit.js';
import { createFxLayers } from '../public/src/shared/fx.js';

function drumStep(voices = []) {
    const layers = createDrumLayers();
    voices.forEach((id) => { layers[id] = true; });
    return { active: voices.length > 0, layers };
}

function fxStep(lanes = []) {
    const layers = createFxLayers();
    lanes.forEach((id) => { layers[id] = true; });
    return { active: lanes.length > 0, layers };
}

function noteStep(overrides = {}) {
    return { active: false, pitch: 'C2', velocity: 1, accent: false, slide: false, ...overrides };
}

const bass = {
    id: 'bass-id',
    type: 'tb-303',
    name: 'Squelch',
    muted: false,
    stepCount: 4,
    params: { volume: 0.7, cutoff: 0.3, waveform: 'square' },
    creatorDisplayName: 'Ada',
    steps: [
        noteStep({ active: true, pitch: 'A1', accent: true }),
        noteStep({ pitch: 'D#2' }),
        noteStep({ active: true, pitch: 'C3', velocity: 0.5, slide: true }),
        noteStep(),
        // Kept beyond the shortened pattern; not part of what is playing.
        noteStep({ active: true, pitch: 'G2' }),
    ],
};

const kit = {
    id: 'kit-id',
    type: 'drum-kit',
    name: 'Rave Kit',
    muted: true,
    stepCount: 2,
    params: { volume: 0.9, kickTune: 0.4 },
    steps: [drumStep(['kick', 'hat']), drumStep()],
};

const fx = {
    id: 'fx-id',
    type: 'fx',
    name: 'FX',
    muted: false,
    stepCount: 1,
    params: { volume: 0.5 },
    steps: [fxStep(['riser'])],
};

const lfo = {
    id: 'lfo-id',
    waveform: 'square',
    shape: 0.2,
    steps: 4,
    jitter: 0,
    smooth: 0.1,
    division: 2,
    depth: 0.8,
    offset: 0,
    phase: 0.25,
    targets: [
        { instrumentId: 'kit-id', paramKey: 'kickTune', paramMin: 0, paramMax: 1, label: 'Kick tune' },
        { instrumentId: 'gone-id', paramKey: 'cutoff', paramMin: 0, paramMax: 1, label: 'Cutoff' },
    ],
};

function saveSample() {
    return createRoomFile({
        name: 'friday-jam',
        bpm: 138,
        instruments: [bass, kit, fx],
        lfos: [lfo],
        savedAt: new Date('2026-11-16T20:30:00Z'),
    });
}

test('a saved room says what it is and keeps the room order', () => {
    const file = saveSample();
    assert.equal(file.format, ROOM_FILE_FORMAT);
    assert.equal(file.version, ROOM_FILE_VERSION);
    assert.equal(file.savedAt, '2026-11-16T20:30:00.000Z');
    assert.equal(file.name, 'friday-jam');
    assert.equal(file.bpm, 138);
    assert.deepEqual(file.instruments.map((instrument) => instrument.type), ['tb-303', 'drum-kit', 'fx']);
    assert.ok(!JSON.stringify(file).includes('bass-id'), 'instrument ids are not saved');
});

test('only the steps in play are saved, note steps without their defaults', () => {
    const [savedBass, savedKit, savedFx] = saveSample().instruments;
    assert.deepEqual(savedBass.steps, [
        { pitch: 'A1', active: true, accent: true },
        { pitch: 'D#2' },
        { pitch: 'C3', active: true, velocity: 0.5, slide: true },
        { pitch: 'C2' },
    ]);
    assert.deepEqual(savedKit.steps, [['kick', 'hat'], []]);
    assert.deepEqual(savedFx.steps, [['riser']]);
    assert.equal(savedBass.creator, 'Ada');
    assert.equal(savedKit.creator, undefined);
});

test('LFO targets point at instruments by position; targets on missing instruments are dropped', () => {
    const [savedLfo] = saveSample().lfos;
    assert.deepEqual(savedLfo.targets, [
        { instrument: 1, paramKey: 'kickTune', paramMin: 0, paramMax: 1, label: 'Kick tune' },
    ]);
    assert.equal(savedLfo.division, 2);
    assert.equal(savedLfo.id, undefined);
});

test('a saved room reads back as the same music', () => {
    const result = readRoomFile(JSON.stringify(saveSample(), null, 2));
    assert.equal(result.ok, true);
    const { room } = result;
    assert.equal(room.name, 'friday-jam');
    assert.equal(room.bpm, 138);

    const [readBass, readKit, readFx] = room.instruments;
    assert.equal(readBass.type, 'tb-303');
    assert.equal(readBass.name, 'Squelch');
    assert.equal(readBass.creatorDisplayName, 'Ada');
    assert.equal(readBass.stepCount, 4);
    assert.deepEqual(readBass.params, bass.params);
    assert.deepEqual(readBass.steps, bass.steps.slice(0, 4).map(({ active, pitch, velocity, accent, slide }) => ({ active, pitch, velocity, accent, slide })));

    assert.equal(readKit.muted, true);
    assert.deepEqual(readKit.steps, [{ layers: { kick: true, hat: true } }, { layers: {} }]);
    assert.deepEqual(readFx.steps, [{ layers: { riser: true } }]);

    const [readLfo] = room.lfos;
    assert.deepEqual(readLfo.params, {
        waveform: 'square', shape: 0.2, steps: 4, jitter: 0, smooth: 0.1, division: 2, depth: 0.8, offset: 0, phase: 0.25,
    });
    assert.deepEqual(readLfo.targets, [
        { instrument: 1, paramKey: 'kickTune', paramMin: 0, paramMax: 1, label: 'Kick tune' },
    ]);
});

test('anything that is not a room file is turned away', () => {
    assert.deepEqual(readRoomFile('not json'), { ok: false, error: 'not-a-room-file' });
    assert.deepEqual(readRoomFile('[]'), { ok: false, error: 'not-a-room-file' });
    assert.deepEqual(readRoomFile({ format: 'something-else', version: 1 }), { ok: false, error: 'not-a-room-file' });
    assert.deepEqual(readRoomFile({ format: ROOM_FILE_FORMAT }), { ok: false, error: 'not-a-room-file' });
    assert.deepEqual(readRoomFile({ format: ROOM_FILE_FORMAT, version: ROOM_FILE_VERSION + 1 }), { ok: false, error: 'room-file-too-new' });
});

test('a bare room file reads as an empty room', () => {
    const result = readRoomFile({ format: ROOM_FILE_FORMAT, version: 1 });
    assert.deepEqual(result, { ok: true, room: { name: '', bpm: null, instruments: [], lfos: [] } });
});

test('unreadable values are dropped and LFO targets follow the instruments that remain', () => {
    const result = readRoomFile({
        format: ROOM_FILE_FORMAT,
        version: 1,
        name: '  ' + 'x'.repeat(100),
        bpm: 'fast',
        instruments: [
            'not an instrument',
            { name: 'no type' },
            {
                type: 'drum-kit',
                steps: [['kick', 'cymbal', 7], 'kick', null],
                params: { volume: 0.5, nested: { a: 1 }, long: 'y'.repeat(100), off: true, nan: null },
            },
            {
                type: 'poly-synth',
                steps: [
                    { active: true, pitch: 'H2', velocity: 4 },
                    { active: 'yes', pitch: 'C#4', velocity: -1, accent: 1 },
                    null,
                ],
                steps2: 'ignored',
            },
        ],
        lfos: [
            {
                waveform: 'sine',
                depth: Infinity,
                targets: [
                    { instrument: 3, paramKey: 'cutoff', paramMin: 0, paramMax: 1 },
                    { instrument: 1, paramKey: 'volume', paramMin: 0, paramMax: 1 },
                    { instrument: 2, paramKey: 'volume', paramMin: 0 },
                    { instrument: '2', paramKey: 'volume', paramMin: 0, paramMax: 1 },
                ],
            },
        ],
    });
    assert.equal(result.ok, true);
    const { room } = result;
    assert.equal(room.name.length, 64);
    assert.equal(room.bpm, null);
    assert.equal(room.instruments.length, 2);

    const [drums, poly] = room.instruments;
    assert.deepEqual(drums.steps, [{ layers: { kick: true } }, { layers: {} }, { layers: {} }]);
    assert.deepEqual(drums.params, { volume: 0.5, off: true });
    assert.equal(drums.stepCount, 3);
    assert.deepEqual(poly.steps, [
        { active: true, velocity: 1, accent: false, slide: false },
        { active: false, pitch: 'C#4', velocity: 0, accent: false, slide: false },
        { active: false },
    ]);

    const [readLfo] = room.lfos;
    assert.deepEqual(readLfo.params, { waveform: 'sine' });
    // File position 3 is the second instrument that remains.
    assert.deepEqual(readLfo.targets, [
        { instrument: 1, paramKey: 'cutoff', paramMin: 0, paramMax: 1, label: 'cutoff' },
    ]);
});

test('a file cannot make reading it expensive', () => {
    const result = readRoomFile({
        format: ROOM_FILE_FORMAT,
        version: 1,
        instruments: Array.from({ length: 1000 }, () => ({ type: 'fx', steps: Array.from({ length: 1000 }, () => ['zap']) })),
        lfos: Array.from({ length: 100 }, () => ({ targets: [] })),
    });
    assert.equal(result.room.instruments.length, 256);
    assert.equal(result.room.instruments[0].steps.length, 128);
    assert.equal(result.room.lfos.length, 32);
});

test('a parameter named __proto__ cannot reach the prototype', () => {
    const result = readRoomFile(`{"format":"${ROOM_FILE_FORMAT}","version":1,"instruments":[{"type":"tb-303","params":{"__proto__":"x","volume":0.5}}]}`);
    const { params } = result.room.instruments[0];
    assert.deepEqual(Object.keys(params), ['volume']);
    assert.equal(Object.getPrototypeOf(params), Object.prototype);
});
