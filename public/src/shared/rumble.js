// Rumble: the reverb-drenched, low-passed, saturated sub tail of modern acid
// and hard techno (pure: no DOM, so it runs under node --test and on the
// server).
//
// Each step plays a short kick-like thump at its pitch into a dark reverb;
// the reverb is low-passed, driven and ducked on every hit, so it swells up
// between the hits instead of doubling the kick. This module holds the
// parameter schema shared by browser and server, and the Random line.

const param = (label, defaultValue) => ({ label, min: 0, max: 1, default: defaultValue });

export const RUMBLE_PARAMS = {
    volume: param('Volume', 0.8),
    decay: param('Decay', 0.6),
    tone: param('Tone', 0.35),
    drive: param('Drive', 0.5),
    pump: param('Pump', 0.6),
};

export const RUMBLE_PARAM_KEYS = Object.keys(RUMBLE_PARAMS);

// Kick-drum fundamental at the Rave Kit's default tuning, so a fresh rumble
// sits on the kick.
export const RUMBLE_DEFAULT_PITCH = 'A1';

function clampParam(key, value) {
    const schema = RUMBLE_PARAMS[key];
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return schema.default;
    }
    return Math.min(Math.max(numeric, schema.min), schema.max);
}

// A complete, clamped parameter set; unknown keys are dropped and missing
// ones take their defaults.
export function normalizeRumbleParams(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const params = {};
    for (const key of RUMBLE_PARAM_KEYS) {
        params[key] = key in source ? clampParam(key, source[key]) : RUMBLE_PARAMS[key].default;
    }
    return params;
}

// Applies an update in place; returns true when anything changed.
export function applyRumbleParamUpdates(params, updates = {}) {
    if (!updates || typeof updates !== 'object') {
        return false;
    }
    let changed = false;
    for (const [key, value] of Object.entries(updates)) {
        if (!(key in RUMBLE_PARAMS) || typeof value !== 'number' || !Number.isFinite(value)) {
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

// The pitch class as a rumble note between E1 (41 Hz) and D#2 (78 Hz): low
// enough to rumble, high enough for small speakers to show it.
export function rumblePitch(pitchClass) {
    const pc = ((Math.round(pitchClass) % 12) + 12) % 12;
    return `${NOTE_NAMES[pc]}${pc >= 4 ? 1 : 2}`;
}

// Most common pitch class among the notes that play in the given lines
// (e.g. the room's acid basslines), or null when none play.
export function dominantPitchClass(lines = []) {
    const counts = new Array(12).fill(0);
    lines.forEach(({ steps = [], stepCount } = {}) => {
        const count = Number.isFinite(stepCount) ? stepCount : steps.length;
        steps.slice(0, count).forEach((step) => {
            const match = step?.active && typeof step.pitch === 'string' ? step.pitch.match(/^([A-G]#?)/) : null;
            const pc = match ? NOTE_NAMES.indexOf(match[1]) : -1;
            if (pc >= 0) {
                counts[pc] += 1;
            }
        });
    });
    const best = Math.max(...counts);
    return best > 0 ? counts.indexOf(best) : null;
}

const EXTRA_HIT_CHANCE = 0.12;

// Hits land with the kick (a kick lane, e.g. the room's Rave Kit, repeated
// over the pattern; four on the floor without one) plus the odd push on an
// off-kick eighth, all on one root so the rumble stays in key.
export function randomRumbleLine(count, { rootClass = null, kicks = null } = {}, rng = Math.random) {
    const root = Number.isInteger(rootClass) ? rootClass : Math.floor(rng() * 12);
    const pitch = rumblePitch(root);
    const kickLane = Array.isArray(kicks) && kicks.some(Boolean) ? kicks : null;
    const steps = [];
    for (let i = 0; i < count; i += 1) {
        const onKick = kickLane ? Boolean(kickLane[i % kickLane.length]) : i % 4 === 0;
        const active = onKick || (i % 2 === 0 && rng() < EXTRA_HIT_CHANCE);
        steps.push({ active, pitch });
    }
    if (count > 0 && !steps.some((step) => step.active)) {
        steps[0].active = true;
    }
    return { root: NOTE_NAMES[((root % 12) + 12) % 12], pitch, steps };
}
