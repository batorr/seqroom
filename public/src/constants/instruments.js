// Instrument-related constants

import { sliderParam, selectParam } from '../utils/helpers.js';

// Instrument types enum
export const SynthTypes = Object.freeze({
    TB303: 'tb-303',
    TR808: 'tr-808',
    POLY: 'poly-synth',
    SAMPLER: 'sampler',
});

// TR-808 drum machine configuration
export const TR808_DRUMS = [
    { id: 'kick', label: 'Kick', color: '#f97316' },
    { id: 'snare', label: 'Snare', color: '#facc15' },
    { id: 'hat', label: 'CHH', color: '#38bdf8' },
    { id: 'openhat', label: 'OHH', color: '#22c55e' },
    { id: 'clap', label: 'Clap', color: '#c084fc' },
];

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

// Per-drum parameter definitions for TR-808
export const TR808_DRUM_PARAMS = {
    kick: [
        sliderParam('kickLevel', 'Level', 0, 1, 0.01),
        sliderParam('kickDecay', 'Decay', 0.1, 2, 0.01),
        sliderParam('kickTone', 'Tone', 30, 100, 1),
        sliderParam('kickDrive', 'Drive', 0, 1, 0.01),
    ],
    snare: [
        sliderParam('snareLevel', 'Level', 0, 1, 0.01),
        sliderParam('snareDecay', 'Decay', 0.1, 1.5, 0.01),
        sliderParam('snareTone', 'Tone', 0, 1, 0.01),
        sliderParam('snareSnappy', 'Snappy', 0, 1, 0.01),
    ],
    hat: [
        sliderParam('hatLevel', 'Level', 0, 1, 0.01),
        sliderParam('hatDecay', 'Decay', 0.05, 1, 0.01),
        sliderParam('hatTone', 'Tone', 0, 1, 0.01),
        sliderParam('hatTuning', 'Tuning', 0.8, 1.2, 0.01),
    ],
    openhat: [
        sliderParam('openhatLevel', 'Level', 0, 1, 0.01),
        sliderParam('openhatDecay', 'Decay', 0.1, 2, 0.01),
        sliderParam('openhatTone', 'Tone', 0, 1, 0.01),
        sliderParam('openhatTuning', 'Tuning', 0.8, 1.2, 0.01),
    ],
    clap: [
        sliderParam('clapLevel', 'Level', 0, 1, 0.01),
        sliderParam('clapDecay', 'Decay', 0.1, 1.5, 0.01),
        sliderParam('clapSpread', 'Spread', 0, 1, 0.01),
        sliderParam('clapReverb', 'Reverb', 0, 1, 0.01),
    ],
};

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
                selectParam('waveform', 'Waveform', [
                    { value: 'sawtooth', label: 'Saw' },
                    { value: 'square', label: 'Square' },
                ]),
            ],
        },
        [SynthTypes.TR808]: {
            label: '808 Drums',
            typeLabel: 'TR-808',
            toneClass: 'tone-808',
            params: [
                sliderParam('volume', 'Volume', 0, 1, 0.01),
            ],
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
