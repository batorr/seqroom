// Pad: long, slow chords that fill the space behind the acid line (pure: no
// DOM, so it runs under node --test and on the server).
//
// Every step starts a whole chord on its pitch, in the chord shapes of the
// Rave Stab, from detuned saws that drift against each other. The chord
// swells in (Attack), holds for Length steps, so it follows the tempo, and
// dies away (Release); a chord that starts while the previous one still
// sounds takes over from it. This module holds the parameter schema shared
// by browser and server (sliders plus the chord shape) and the Random line.
//
// The type id is still 'poly-synth', the instrument this one replaced, so
// rooms saved with a Poly Synth open with a Pad in its place.

import { STAB_CHORDS } from './rave-stab.js';

const param = (label, defaultValue) => ({ label, min: 0, max: 1, default: defaultValue });

export const PAD_PARAMS = {
    volume: param('Volume', 0.7),
    length: param('Length', 0.75),
    attack: param('Attack', 0.45),
    release: param('Release', 0.45),
    cutoff: param('Cutoff', 0.45),
    envelope: param('Env Mod', 0.35),
    detune: param('Detune', 0.5),
    delay: param('Delay', 0.1),
    reverb: param('Reverb', 0.45),
};

export const PAD_PARAM_KEYS = Object.keys(PAD_PARAMS);

// The Rave Stab's dark chord shapes; a pad holds them instead of stabbing.
export const PAD_CHORDS = STAB_CHORDS;

export const PAD_DEFAULT_CHORD = 'min9';

// Same key as the other rave voices' defaults (A).
export const PAD_DEFAULT_PITCH = 'A3';

export function padChordIntervals(chord) {
    const shape = PAD_CHORDS.find((entry) => entry.value === chord)
        || PAD_CHORDS.find((entry) => entry.value === PAD_DEFAULT_CHORD);
    return shape.intervals;
}

// Length 0..1 as steps on a doubling scale: 2, 4, 8, 16 or 32 (an eighth
// note to two bars); the default holds a chord for a bar.
export function padLengthSteps(length) {
    const numeric = Number(length);
    const value = Number.isFinite(numeric) ? Math.min(Math.max(numeric, 0), 1) : PAD_PARAMS.length.default;
    return 2 * Math.pow(2, Math.round(value * 4));
}

function clampParam(key, value) {
    const schema = PAD_PARAMS[key];
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return schema.default;
    }
    return Math.min(Math.max(numeric, schema.min), schema.max);
}

const isChord = (value) => PAD_CHORDS.some((entry) => entry.value === value);

// A complete, clamped parameter set; unknown keys are dropped and missing
// ones take their defaults. A Poly Synth's Volume, Attack, Release, Cutoff,
// Delay and Reverb carry over (clamped to 0..1); the rest is dropped.
export function normalizePadParams(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const params = {};
    for (const key of PAD_PARAM_KEYS) {
        params[key] = key in source ? clampParam(key, source[key]) : PAD_PARAMS[key].default;
    }
    params.chord = isChord(source.chord) ? source.chord : PAD_DEFAULT_CHORD;
    return params;
}

// Applies an update in place; returns true when anything changed.
export function applyPadParamUpdates(params, updates = {}) {
    if (!updates || typeof updates !== 'object') {
        return false;
    }
    let changed = false;
    for (const [key, value] of Object.entries(updates)) {
        let next;
        if (key === 'chord') {
            if (!isChord(value)) continue;
            next = value;
        } else if (key in PAD_PARAMS && typeof value === 'number' && Number.isFinite(value)) {
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

// The pitch class as a chord root between F3 (175 Hz) and E4 (330 Hz): the
// chord sits above the acid bass and the rumble, under most of the hats.
export function padPitch(pitchClass) {
    const pc = ((Math.round(pitchClass) % 12) + 12) % 12;
    return `${NOTE_NAMES[pc]}${pc >= 5 ? 3 : 4}`;
}

// Slow minor progressions, as semitones above the key, one root per span.
export const PAD_PROGRESSIONS = [
    { name: 'drone', roots: [0] },
    { name: 'fall', roots: [0, 10, 8, 10] },
    { name: 'rise', roots: [0, 8, 10, 0] },
    { name: 'sway', roots: [0, 5] },
    { name: 'shadow', roots: [0, 8] },
];

// How many steps one root of the progression lasts: a bar for chords held
// a bar or longer, else half a bar.
export function padSpan(lengthSteps) {
    return lengthSteps >= 16 ? 16 : 8;
}

// One progression per roll. Every span starts a chord on its root; chords
// shorter than the span repeat on it, so a short Length pulses instead of
// leaving gaps. Rests keep their span's root, so a step switched on later is
// in key.
export function randomPadLine(count, { rootClass = null, length = PAD_PARAMS.length.default } = {}, rng = Math.random) {
    const key = Number.isInteger(rootClass) ? ((rootClass % 12) + 12) % 12 : Math.floor(rng() * 12);
    const progression = PAD_PROGRESSIONS[Math.floor(rng() * PAD_PROGRESSIONS.length)];
    const hold = padLengthSteps(length);
    const span = padSpan(hold);
    const every = Math.min(hold, span);
    const steps = [];
    for (let i = 0; i < count; i += 1) {
        const root = progression.roots[Math.floor(i / span) % progression.roots.length];
        steps.push({ active: (i % span) % every === 0, pitch: padPitch(key + root) });
    }
    return { root: NOTE_NAMES[key], progression: progression.name, steps };
}
