// Rave Kit: voices and parameter schema of the drum machine (acid techno).
//
// Shared by the server (validates and clamps updates) and the browser (UI and
// synthesis), so both always agree on which voices and parameters exist.
// Every parameter is normalised to 0..1; drums.js maps it to Hz and seconds.

export const DRUM_VOICES = [
    { id: 'kick', label: 'Kick' },
    { id: 'snare', label: 'Snare' },
    { id: 'clap', label: 'Clap' },
    { id: 'rim', label: 'Rim' },
    { id: 'hat', label: 'Closed hat' },
    { id: 'openhat', label: 'Open hat' },
    { id: 'ride', label: 'Ride' },
];

export const DRUM_VOICE_IDS = DRUM_VOICES.map((voice) => voice.id);

const param = (label, defaultValue) => ({ label, min: 0, max: 1, default: defaultValue });

export const DRUM_PARAMS = {
    // Defaults are voiced for acid techno: a short, nearly clean kick, crisp
    // bright hats, a hard clap, and the whole kit pushed into the drive.

    // Whole kit
    volume: param('Volume', 0.85),
    drive: param('Drive', 0.35),
    room: param('Room', 0.15),

    kickLevel: param('Level', 0.95),
    kickTune: param('Tune', 0.5),
    kickDecay: param('Decay', 0.35),
    kickAttack: param('Click', 0.6),
    kickDrive: param('Drive', 0.05),

    snareLevel: param('Level', 0.6),
    snareTune: param('Tune', 0.55),
    snareTone: param('Tone', 0.6),
    snareSnappy: param('Snappy', 0.7),
    snareDecay: param('Decay', 0.35),

    clapLevel: param('Level', 0.75),
    clapTone: param('Tone', 0.55),
    clapDecay: param('Decay', 0.35),

    rimLevel: param('Level', 0.45),
    rimTune: param('Tune', 0.5),
    rimDecay: param('Decay', 0.3),

    hatLevel: param('Level', 0.6),
    hatTone: param('Tone', 0.6),
    hatDecay: param('Decay', 0.25),

    openhatLevel: param('Level', 0.55),
    openhatTone: param('Tone', 0.6),
    openhatDecay: param('Decay', 0.35),

    rideLevel: param('Level', 0.5),
    rideTone: param('Tone', 0.55),
    rideDecay: param('Decay', 0.5),
};

// Parameters shown for the whole kit, then for the voice picked in the score.
export const DRUM_KIT_PARAM_KEYS = ['volume', 'drive', 'room'];

export const DRUM_VOICE_PARAM_KEYS = {
    kick: ['kickLevel', 'kickTune', 'kickDecay', 'kickAttack', 'kickDrive'],
    snare: ['snareLevel', 'snareTune', 'snareTone', 'snareSnappy', 'snareDecay'],
    clap: ['clapLevel', 'clapTone', 'clapDecay'],
    rim: ['rimLevel', 'rimTune', 'rimDecay'],
    hat: ['hatLevel', 'hatTone', 'hatDecay'],
    openhat: ['openhatLevel', 'openhatTone', 'openhatDecay'],
    ride: ['rideLevel', 'rideTone', 'rideDecay'],
};

function clampParam(key, value) {
    const schema = DRUM_PARAMS[key];
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return schema.default;
    }
    return Math.min(Math.max(numeric, schema.min), schema.max);
}

// A complete, clamped parameter set; unknown keys are dropped and missing
// ones take their defaults.
export function normalizeDrumParams(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const params = {};
    for (const key of Object.keys(DRUM_PARAMS)) {
        params[key] = key in source ? clampParam(key, source[key]) : DRUM_PARAMS[key].default;
    }
    return params;
}

// Applies an update in place; returns true when anything changed.
export function applyDrumParamUpdates(params, updates = {}) {
    if (!updates || typeof updates !== 'object') {
        return false;
    }
    let changed = false;
    for (const [key, value] of Object.entries(updates)) {
        if (!(key in DRUM_PARAMS) || typeof value !== 'number' || !Number.isFinite(value)) {
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

export function createDrumLayers() {
    return DRUM_VOICE_IDS.reduce((layers, id) => {
        layers[id] = false;
        return layers;
    }, {});
}
