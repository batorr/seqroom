// Polyphonic Synthesizer Module
// Multi-waveform polyphonic synthesizer

import { audioState } from '../../state/audio.js';
import { clampValue } from '../../utils/helpers.js';
import { noteToFrequency } from '../../utils/audio.js';

export function schedulePolySynth(instrument, step, when, ctx) {
    const params = instrument.params || {};
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    const waveform = params.waveform;
    osc.type = ['sine', 'triangle', 'sawtooth', 'square'].includes(waveform) ? waveform : 'sine';
    osc.frequency.value = noteToFrequency(step.pitch || 'C4');

    filter.type = 'lowpass';
    filter.frequency.value = 400 + (params.cutoff ?? 0.6) * 6000;
    filter.Q.value = 0.5 + (params.resonance ?? 0.3) * 6;

    const volume = clampValue(params.volume ?? 0.8, 0, 1);
    const attack = clampValue(params.attack ?? 0.05, 0, 2);
    const decay = clampValue(params.decay ?? 0.3, 0, 2);
    const release = clampValue(params.release ?? 0.4, 0, 3);

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
