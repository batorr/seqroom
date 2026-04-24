// Polyphonic Synthesizer Module
// Multi-waveform polyphonic synthesizer

import { audioState } from '../../state/audio.js';
import { clampValue } from '../../utils/helpers.js';
import { noteToFrequency } from '../../utils/audio.js';
import { getModulatedParam } from '../lfo.js';

export function schedulePolySynth(instrument, step, when, ctx) {
    const params = instrument.params || {};
    const id = instrument.id;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    const waveform = typeof params.waveform === 'string' && params.waveform.toLowerCase() === 'saw'
        ? 'sawtooth'
        : params.waveform;
    osc.type = ['sine', 'triangle', 'sawtooth', 'square'].includes(waveform) ? waveform : 'sine';
    osc.frequency.value = noteToFrequency(step.pitch || 'C4');

    filter.type = 'lowpass';
    filter.frequency.value = 400 + getModulatedParam(id, 'cutoff', params.cutoff ?? 0.6, 0, 1) * 6000;
    filter.Q.value = 0.5 + getModulatedParam(id, 'resonance', params.resonance ?? 0.3, 0, 1) * 6;

    const volume = clampValue(getModulatedParam(id, 'volume', params.volume ?? 0.8, 0, 1), 0, 1);
    const attack = clampValue(getModulatedParam(id, 'attack', params.attack ?? 0.05, 0, 2), 0, 2);
    const decay = clampValue(getModulatedParam(id, 'decay', params.decay ?? 0.3, 0, 2), 0, 2);
    const release = clampValue(getModulatedParam(id, 'release', params.release ?? 0.4, 0, 3), 0, 3);

    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(volume, when + attack);
    gain.gain.linearRampToValueAtTime(volume * 0.5, when + attack + decay);
    gain.gain.linearRampToValueAtTime(0.0001, when + attack + decay + release);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioState.masterGain);

    osc.start(when);
    osc.stop(when + attack + decay + release + 0.1);
}
