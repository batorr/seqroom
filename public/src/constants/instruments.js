// Instrument-related constants

import { sliderParam, selectParam } from '../utils/helpers.js';
import { DRUM_PARAMS, DRUM_KIT_PARAM_KEYS, DRUM_VOICE_PARAM_KEYS } from '../shared/drum-kit.js';

// Instrument types enum
export const SynthTypes = Object.freeze({
    TB303: 'tb-303',
    DRUMS: 'drum-kit',
    POLY: 'poly-synth',
    SAMPLER: 'sampler',
});

// Rave Kit voices (shared with the server).
export { DRUM_VOICES } from '../shared/drum-kit.js';

// Sampler slot configuration
export const SAMPLER_SLOT_CONFIG = [
    { id: 'A', label: 'Slot A', color: '#f97316' },
    { id: 'B', label: 'Slot B', color: '#facc15' },
    { id: 'C', label: 'Slot C', color: '#38bdf8' },
    { id: 'D', label: 'Slot D', color: '#22c55e' },
    { id: 'E', label: 'Slot E', color: '#a855f7' },
    { id: 'F', label: 'Slot F', color: '#f472b6' },
];

export const SAMPLER_SLOT_IDS = SAMPLER_SLOT_CONFIG.map((slot) => slot.id);
export const SAMPLER_MAX_SAMPLE_BYTES = 5 * 1024 * 1024;
export const SAMPLER_ALLOWED_MIME_TYPES = ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3'];

// Rave Kit parameter sliders: the whole kit, then one set per voice.
const drumSlider = (key) => sliderParam(key, DRUM_PARAMS[key].label, DRUM_PARAMS[key].min, DRUM_PARAMS[key].max, 0.01);

export const DRUM_KIT_PARAM_DEFS = DRUM_KIT_PARAM_KEYS.map(drumSlider);

export const DRUM_VOICE_PARAM_DEFS = Object.fromEntries(
    Object.entries(DRUM_VOICE_PARAM_KEYS).map(([voice, keys]) => [voice, keys.map(drumSlider)]),
);

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
        [SynthTypes.POLY]: {
            label: 'Poly Synth',
            typeLabel: 'Poly',
            toneClass: 'tone-poly',
            params: [
                sliderParam('volume', 'Volume', 0, 1, 0.01),
                sliderParam('attack', 'Attack', 0, 2, 0.01),
                sliderParam('decay', 'Decay', 0, 2, 0.01),
                sliderParam('release', 'Release', 0, 3, 0.01),
                sliderParam('cutoff', 'Cutoff', 0, 1, 0.01),
                sliderParam('resonance', 'Resonance', 0, 1, 0.01),
                sliderParam('delay', 'Delay', 0, 1, 0.01),
                sliderParam('reverb', 'Reverb', 0, 1, 0.01),
                selectParam('waveform', 'Waveform', [
                    { value: 'sine', label: 'Sine' },
                    { value: 'triangle', label: 'Triangle' },
                    { value: 'sawtooth', label: 'Saw' },
                    { value: 'square', label: 'Square' },
                ]),
            ],
        },
        [SynthTypes.SAMPLER]: {
            label: 'Sampler',
            typeLabel: 'Sampler',
            toneClass: 'tone-sampler',
            params: [],
        },
    };
}
