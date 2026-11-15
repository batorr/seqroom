// Hoover: the thick, swooping rave lead (pure: no DOM, so it runs under
// node --test and on the server).
//
// A mono voice of detuned saws, a slowly sweeping pulse and a sub octave;
// every fresh note falls into its pitch from a few semitones above, and a
// note that starts while the previous one still holds glides over from it.
// This module holds the parameter schema shared by browser and server and
// the Random line.

const param = (label, defaultValue) => ({ label, min: 0, max: 1, default: defaultValue });

export const HOOVER_PARAMS = {
    volume: param('Volume', 0.7),
    length: param('Length', 0.3),
    bend: param('Bend', 0.5),
    glide: param('Glide', 0.4),
    width: param('Width', 0.6),
    cutoff: param('Cutoff', 0.7),
    delay: param('Delay', 0.15),
    reverb: param('Reverb', 0.35),
};

export const HOOVER_PARAM_KEYS = Object.keys(HOOVER_PARAMS);

// Same key as the other rave voices' defaults (A), an octave under the stab.
export const HOOVER_DEFAULT_PITCH = 'A3';

function clampParam(key, value) {
    const schema = HOOVER_PARAMS[key];
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return schema.default;
    }
    return Math.min(Math.max(numeric, schema.min), schema.max);
}

// A complete, clamped parameter set; unknown keys are dropped and missing
// ones take their defaults.
export function normalizeHooverParams(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const params = {};
    for (const key of HOOVER_PARAM_KEYS) {
        params[key] = key in source ? clampParam(key, source[key]) : HOOVER_PARAMS[key].default;
    }
    return params;
}

// Applies an update in place; returns true when anything changed.
export function applyHooverParamUpdates(params, updates = {}) {
    if (!updates || typeof updates !== 'object') {
        return false;
    }
    let changed = false;
    for (const [key, value] of Object.entries(updates)) {
        if (!(key in HOOVER_PARAMS) || typeof value !== 'number' || !Number.isFinite(value)) {
            continue;
        }
        const next = clampParam(key, value);
        if (params[key] !== next) {
            params[key] = next;
            changed = true;
        }
    }
    return changed;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Steps are named in semitones from C1, so octaves carry across B-C.
const C1 = 0;
const noteName = (semitones) => `${NOTE_NAMES[semitones % 12]}${Math.floor(semitones / 12) + 1}`;

// The key's root in octave 3 (131–247 Hz); its sub octave stays above the
// acid bass's usual range.
export function hooverPitch(pitchClass) {
    const pc = ((Math.round(pitchClass) % 12) + 12) % 12;
    return noteName(C1 + 24 + pc);
}

// Sparse riffs over a 16-step bar: hoovers hold, they do not chatter.
export const HOOVER_RHYTHMS = [
    { name: 'hold', hits: [0, 8] },
    { name: 'call', hits: [0, 3, 6] },
    { name: 'riff', hits: [0, 3, 6, 10, 12] },
    { name: 'answer', hits: [0, 6, 8, 14] },
];

// Notes after the first, in semitones from the root: mostly the root and its
// octave, then the fifth, the minor third, the flat seventh, the fourth and
// the fifth below.
const MOVES = [
    { interval: 0, weight: 0.3 },
    { interval: 12, weight: 0.15 },
    { interval: 7, weight: 0.15 },
    { interval: 3, weight: 0.13 },
    { interval: 10, weight: 0.1 },
    { interval: 5, weight: 0.1 },
    { interval: -5, weight: 0.07 },
];

const DROP_CHANCE = 0.1;

function pickMove(rng) {
    let r = rng();
    for (const move of MOVES) {
        r -= move.weight;
        if (r < 0) return move.interval;
    }
    return 0;
}

// One rhythm per roll; each bar starts on the root, the rest of its notes
// move around the minor key. Rests keep the root, so a step switched on later
// is in key.
export function randomHooverLine(count, { rootClass = null } = {}, rng = Math.random) {
    const key = Number.isInteger(rootClass) ? ((rootClass % 12) + 12) % 12 : Math.floor(rng() * 12);
    const rhythm = HOOVER_RHYTHMS[Math.floor(rng() * HOOVER_RHYTHMS.length)];
    const hits = new Set(rhythm.hits);
    const root = C1 + 24 + key;
    const steps = [];
    for (let i = 0; i < count; i += 1) {
        const pos = i % 16;
        if (!hits.has(pos)) {
            steps.push({ active: false, pitch: noteName(root) });
            continue;
        }
        const first = pos === rhythm.hits[0];
        const active = first || rng() >= DROP_CHANCE;
        steps.push({ active, pitch: noteName(root + (active && !first ? pickMove(rng) : 0)) });
    }
    if (count > 0 && !steps.some((step) => step.active)) {
        steps[0].active = true;
        steps[0].pitch = noteName(root);
    }
    return { root: NOTE_NAMES[key], rhythm: rhythm.name, steps };
}
