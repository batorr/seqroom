// Rave Stab: short, filtered chord stabs of 90s rave (pure: no DOM, so it
// runs under node --test and on the server).
//
// One step plays a whole chord on its pitch, built from detuned saws, with
// a resonant low-pass that snaps shut and a dotted-eighth echo. This module
// holds the parameter schema shared by browser and server (sliders plus the
// chord type) and the Random line.

const param = (label, defaultValue) => ({ label, min: 0, max: 1, default: defaultValue });

export const STAB_PARAMS = {
    volume: param('Volume', 0.75),
    cutoff: param('Cutoff', 0.5),
    envelope: param('Env Mod', 0.55),
    decay: param('Decay', 0.3),
    detune: param('Detune', 0.4),
    delay: param('Delay', 0.3),
    reverb: param('Reverb', 0.2),
};

export const STAB_PARAM_KEYS = Object.keys(STAB_PARAMS);

// Dark chord shapes, as semitones above the step's pitch. Every step plays
// the same shape, so changing roots move it in parallel, the way the chord
// memory of the old rave synths did.
export const STAB_CHORDS = [
    { value: 'minor', label: 'Minor', intervals: [0, 3, 7, 12] },
    { value: 'min7', label: 'Min7', intervals: [0, 3, 7, 10] },
    { value: 'min9', label: 'Min9', intervals: [0, 3, 7, 10, 14] },
    { value: 'fifth', label: 'Fifth', intervals: [0, 7, 12] },
];

export const STAB_DEFAULT_CHORD = 'min7';

// Same key as the Rumble's default (A), two octaves above the bass.
export const STAB_DEFAULT_PITCH = 'A3';

export function chordIntervals(chord) {
    const shape = STAB_CHORDS.find((entry) => entry.value === chord)
        || STAB_CHORDS.find((entry) => entry.value === STAB_DEFAULT_CHORD);
    return shape.intervals;
}

function clampParam(key, value) {
    const schema = STAB_PARAMS[key];
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return schema.default;
    }
    return Math.min(Math.max(numeric, schema.min), schema.max);
}

const isChord = (value) => STAB_CHORDS.some((entry) => entry.value === value);

// A complete, clamped parameter set; unknown keys are dropped and missing
// ones take their defaults.
export function normalizeStabParams(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const params = {};
    for (const key of STAB_PARAM_KEYS) {
        params[key] = key in source ? clampParam(key, source[key]) : STAB_PARAMS[key].default;
    }
    params.chord = isChord(source.chord) ? source.chord : STAB_DEFAULT_CHORD;
    return params;
}

// Applies an update in place; returns true when anything changed.
export function applyStabParamUpdates(params, updates = {}) {
    if (!updates || typeof updates !== 'object') {
        return false;
    }
    let changed = false;
    for (const [key, value] of Object.entries(updates)) {
        let next;
        if (key === 'chord') {
            if (!isChord(value)) continue;
            next = value;
        } else if (key in STAB_PARAMS && typeof value === 'number' && Number.isFinite(value)) {
            next = clampParam(key, value);
        } else {
            continue;
        }
        if (params[key] !== next) {
            params[key] = next;
            changed = true;
        }
    }
    return changed;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// The pitch class as a chord root between G3 (196 Hz) and F#4 (370 Hz): above
// the acid bass, below the hats.
export function stabPitch(pitchClass) {
    const pc = ((Math.round(pitchClass) % 12) + 12) % 12;
    return `${NOTE_NAMES[pc]}${pc >= 7 ? 3 : 4}`;
}

// Rave stab rhythms over a 16-step bar.
export const STAB_RHYTHMS = [
    { name: 'offbeat', hits: [2, 6, 10, 14] },
    { name: 'tresillo', hits: [0, 3, 6, 8, 11, 14] },
    { name: 'push', hits: [3, 6, 10, 13] },
    { name: 'answer', hits: [0, 6, 10, 11] },
];

// Roots of later half bars, as semitones above the key: mostly the key
// itself, else the minor key's bVII, bVI or iv.
const ROOT_MOVES = [
    { interval: 0, weight: 0.5 },
    { interval: 10, weight: 0.2 },
    { interval: 8, weight: 0.2 },
    { interval: 5, weight: 0.1 },
];

const DROP_CHANCE = 0.1;
const EXTRA_HIT_CHANCE = 0.06;

function pickMove(rng) {
    let r = rng();
    for (const move of ROOT_MOVES) {
        r -= move.weight;
        if (r < 0) return move.interval;
    }
    return 0;
}

// One rhythm per roll, with the odd hit dropped or added; the first half bar
// sits on the key, every later half bar may move to another root.
export function randomStabLine(count, { rootClass = null } = {}, rng = Math.random) {
    const key = Number.isInteger(rootClass) ? ((rootClass % 12) + 12) % 12 : Math.floor(rng() * 12);
    const rhythm = STAB_RHYTHMS[Math.floor(rng() * STAB_RHYTHMS.length)];
    const hits = new Set(rhythm.hits);
    const halfRoots = [];
    const steps = [];
    for (let i = 0; i < count; i += 1) {
        const half = Math.floor(i / 8);
        if (halfRoots[half] === undefined) {
            halfRoots[half] = half === 0 ? 0 : pickMove(rng);
        }
        const pos = i % 16;
        const active = hits.has(pos) ? rng() >= DROP_CHANCE : (pos % 2 === 0 && rng() < EXTRA_HIT_CHANCE);
        steps.push({ active, pitch: stabPitch(key + halfRoots[half]) });
    }
    if (count > 0 && !steps.some((step) => step.active)) {
        steps[0].active = true;
    }
    return { root: NOTE_NAMES[key], rhythm: rhythm.name, steps };
}
