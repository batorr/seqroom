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
    { id: 'hat', label: 'Hat', color: '#38bdf8' },
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
                    { value: 'saw', label: 'Saw' },
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
                sliderParam('kickLevel', 'Kick', 0, 1, 0.01),
                sliderParam('snareLevel', 'Snare', 0, 1, 0.01),
                sliderParam('hatLevel', 'Hats', 0, 1, 0.01),
                sliderParam('clapLevel', 'Clap', 0, 1, 0.01),
                sliderParam('tone', 'Tone', 0, 1, 0.01),
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
                    { value: 'saw', label: 'Saw' },
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
