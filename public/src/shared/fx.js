// FX: the build-up and drop effects of a rave set (pure: no DOM, so it runs
// under node --test and on the server).
//
// Like the Rave Kit, every effect has its own lane and a step holds one
// boolean per lane. A riser or downlifter started on a step runs for Length
// steps, so it can span bars. This module holds the lanes, the parameter
// schema shared by browser and server, and the Random line.

export const FX_VOICES = [
    { id: 'riser', label: 'Riser' },
    { id: 'downlifter', label: 'Downlifter' },
    { id: 'impact', label: 'Impact' },
    { id: 'zap', label: 'Zap' },
];

export const FX_VOICE_IDS = FX_VOICES.map((voice) => voice.id);

// The lane Fill acts on before one is picked in the score.
export const FX_DEFAULT_LANE = 'impact';

const param = (label, defaultValue) => ({ label, min: 0, max: 1, default: defaultValue });

export const FX_PARAMS = {
    volume: param('Volume', 0.8),
    length: param('Length', 0.25),
    tone: param('Tone', 0.5),
    delay: param('Delay', 0.3),
    reverb: param('Reverb', 0.4),
};

export const FX_PARAM_KEYS = Object.keys(FX_PARAMS);

// Length 0..1 as steps on a doubling scale: 4, 8, 16, 32 or 64 (a beat to
// four bars); the default is half a bar.
export function fxLengthSteps(length) {
    const numeric = Number(length);
    const value = Number.isFinite(numeric) ? Math.min(Math.max(numeric, 0), 1) : FX_PARAMS.length.default;
    return 4 * Math.pow(2, Math.round(value * 4));
}

function clampParam(key, value) {
    const schema = FX_PARAMS[key];
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return schema.default;
    }
    return Math.min(Math.max(numeric, schema.min), schema.max);
}

// A complete, clamped parameter set; unknown keys are dropped and missing
// ones take their defaults.
export function normalizeFxParams(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const params = {};
    for (const key of FX_PARAM_KEYS) {
        params[key] = key in source ? clampParam(key, source[key]) : FX_PARAMS[key].default;
    }
    return params;
}

// Applies an update in place; returns true when anything changed.
export function applyFxParamUpdates(params, updates = {}) {
    if (!updates || typeof updates !== 'object') {
        return false;
    }
    let changed = false;
    for (const [key, value] of Object.entries(updates)) {
        if (!(key in FX_PARAMS) || typeof value !== 'number' || !Number.isFinite(value)) {
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

export function createFxLayers() {
    return FX_VOICE_IDS.reduce((layers, id) => {
        layers[id] = false;
        return layers;
    }, {});
}

const DOWNLIFTER_CHANCE = 0.5;
const ZAP_CHANCE = 0.25;
const MAX_ZAPS = 2;

// A drop on a loop: an impact on step 1, a riser timed to end exactly as the
// pattern comes round to it (when it fits inside the pattern), sometimes a
// downlifter out of the drop, and a zap or two on off-beat eighths.
export function randomFxLine(count, { length = FX_PARAMS.length.default } = {}, rng = Math.random) {
    const steps = Array.from({ length: count }, () => ({ active: false, layers: createFxLayers() }));
    if (count <= 0) {
        return { steps, riserAt: null };
    }
    steps[0].layers.impact = true;
    const riserSteps = fxLengthSteps(length);
    const riserAt = riserSteps < count ? count - riserSteps : null;
    if (riserAt !== null) {
        steps[riserAt].layers.riser = true;
    }
    if (rng() < DOWNLIFTER_CHANCE) {
        steps[0].layers.downlifter = true;
    }
    let zaps = 0;
    for (let i = 2; i < count && zaps < MAX_ZAPS; i += 4) {
        if (rng() < ZAP_CHANCE) {
            steps[i].layers.zap = true;
            zaps += 1;
        }
    }
    steps.forEach((step) => {
        step.active = FX_VOICE_IDS.some((id) => step.layers[id]);
    });
    return { steps, riserAt };
}
