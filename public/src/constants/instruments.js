// Instrument-related constants

import { sliderParam, selectParam } from '../utils/helpers.js';
import { DRUM_PARAMS, DRUM_KIT_PARAM_KEYS, DRUM_VOICE_PARAM_KEYS } from '../shared/drum-kit.js';
import { RUMBLE_PARAMS, RUMBLE_PARAM_KEYS } from '../shared/rumble.js';
import { STAB_PARAMS, STAB_PARAM_KEYS, STAB_CHORDS } from '../shared/rave-stab.js';
import { HOOVER_PARAMS, HOOVER_PARAM_KEYS } from '../shared/hoover.js';
import { FX_PARAMS, FX_PARAM_KEYS, fxLengthSteps } from '../shared/fx.js';
import { PAD_PARAMS, PAD_PARAM_KEYS, PAD_CHORDS, padLengthSteps } from '../shared/pad.js';

// Instrument types enum
export const SynthTypes = Object.freeze({
    TB303: 'tb-303',
    DRUMS: 'drum-kit',
    // The old Poly Synth's id, kept so saved rooms open with a Pad.
    PAD: 'poly-synth',
    RUMBLE: 'rumble',
    STAB: 'rave-stab',
    HOOVER: 'hoover',
    FX: 'fx',
});

// Rave Kit voices and FX lanes (shared with the server).
export { DRUM_VOICES } from '../shared/drum-kit.js';
export { FX_VOICES } from '../shared/fx.js';

// Rave Kit parameter sliders: the whole kit, then one set per voice.
const drumSlider = (key) => sliderParam(key, DRUM_PARAMS[key].label, DRUM_PARAMS[key].min, DRUM_PARAMS[key].max, 0.01);

export const DRUM_KIT_PARAM_DEFS = DRUM_KIT_PARAM_KEYS.map(drumSlider);

export const DRUM_VOICE_PARAM_DEFS = Object.fromEntries(
    Object.entries(DRUM_VOICE_PARAM_KEYS).map(([voice, keys]) => [voice, keys.map(drumSlider)]),
);

// Rumble sliders, from the schema shared with the server.
const RUMBLE_PARAM_DEFS = RUMBLE_PARAM_KEYS.map((key) => sliderParam(key, RUMBLE_PARAMS[key].label, RUMBLE_PARAMS[key].min, RUMBLE_PARAMS[key].max, 0.01));

// Rave Stab sliders plus the chord shape, from the schema shared with the server.
const STAB_PARAM_DEFS = [
    ...STAB_PARAM_KEYS.map((key) => sliderParam(key, STAB_PARAMS[key].label, STAB_PARAMS[key].min, STAB_PARAMS[key].max, 0.01)),
    selectParam('chord', 'Chord', STAB_CHORDS.map(({ value, label }) => ({ value, label }))),
];

// Hoover sliders, from the schema shared with the server.
const HOOVER_PARAM_DEFS = HOOVER_PARAM_KEYS.map((key) => sliderParam(key, HOOVER_PARAMS[key].label, HOOVER_PARAMS[key].min, HOOVER_PARAMS[key].max, 0.01));

// FX sliders; Length snaps to 4, 8, 16, 32 or 64 steps and says so.
const FX_PARAM_DEFS = FX_PARAM_KEYS.map((key) => (key === 'length'
    ? { ...sliderParam(key, FX_PARAMS[key].label, 0, 1, 0.25), format: (value) => `${fxLengthSteps(value)} steps` }
    : sliderParam(key, FX_PARAMS[key].label, FX_PARAMS[key].min, FX_PARAMS[key].max, 0.01)));

// Pad sliders plus the chord shape; Length snaps to 2, 4, 8, 16 or 32
// steps and says so.
const PAD_PARAM_DEFS = [
    ...PAD_PARAM_KEYS.map((key) => (key === 'length'
        ? { ...sliderParam(key, PAD_PARAMS[key].label, 0, 1, 0.25), format: (value) => `${padLengthSteps(value)} steps` }
        : sliderParam(key, PAD_PARAMS[key].label, PAD_PARAMS[key].min, PAD_PARAMS[key].max, 0.01))),
    selectParam('chord', 'Chord', PAD_CHORDS.map(({ value, label }) => ({ value, label }))),
];

// Instrument library - initialized at module load
export const INSTRUMENT_LIBRARY = createInstrumentLibrary(sliderParam, selectParam);

// Factory function for creating instrument library
function createInstrumentLibrary(sliderParam, selectParam) {
    return {
        [SynthTypes.TB303]: {
            label: 'Acid Bass',
            typeLabel: 'TB-303',
            toneClass: 'tone-acid',
            params: [
                sliderParam('volume', 'Volume', 0, 1, 0.01),
                sliderParam('cutoff', 'Cutoff', 0, 1, 0.01),
                sliderParam('resonance', 'Resonance', 0, 1, 0.01),
                sliderParam('envelopeMod', 'Env Mod', 0, 1, 0.01),
                sliderParam('decay', 'Decay', 0, 1, 0.01),
                sliderParam('drive', 'Drive', 0, 1, 0.01),
                sliderParam('delay', 'Delay', 0, 1, 0.01),
                sliderParam('reverb', 'Reverb', 0, 1, 0.01),
                selectParam('waveform', 'Waveform', [
                    { value: 'sawtooth', label: 'Saw' },
                    { value: 'square', label: 'Square' },
                ]),
            ],
        },
        [SynthTypes.DRUMS]: {
            label: 'Rave Kit',
            typeLabel: 'Drum kit',
            toneClass: 'tone-drums',
            params: DRUM_KIT_PARAM_DEFS,
        },
        [SynthTypes.PAD]: {
            label: 'Pad',
            typeLabel: 'Pad',
            toneClass: 'tone-pad',
            params: PAD_PARAM_DEFS,
        },
        [SynthTypes.RUMBLE]: {
            label: 'Rumble',
            typeLabel: 'Rumble',
            toneClass: 'tone-rumble',
            params: RUMBLE_PARAM_DEFS,
        },
        [SynthTypes.STAB]: {
            label: 'Rave Stab',
            typeLabel: 'Stab',
            toneClass: 'tone-stab',
            params: STAB_PARAM_DEFS,
        },
        [SynthTypes.HOOVER]: {
            label: 'Hoover',
            typeLabel: 'Hoover',
            toneClass: 'tone-hoover',
            params: HOOVER_PARAM_DEFS,
        },
        [SynthTypes.FX]: {
            label: 'FX',
            typeLabel: 'FX',
            toneClass: 'tone-fx',
            params: FX_PARAM_DEFS,
        },
    };
}
