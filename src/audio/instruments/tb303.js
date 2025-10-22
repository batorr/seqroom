// TB-303 Synthesizer Module
// Acid bass synthesizer sound generation

import { audioState } from '../../state/audio.js';
import { clampValue } from '../../utils/helpers.js';
import { noteToFrequency } from '../../utils/audio.js';

export function scheduleTB303(instrument, step, when, ctx) {
    const params = instrument.params || {};
    const osc = ctx.createOscillator();
    osc.type = params.waveform === 'square' ? 'square' : 'sawtooth';
    osc.frequency.value = noteToFrequency(step.pitch || 'C2');

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const cutoff = 200 + (params.cutoff ?? 0.5) * 6000;
    filter.frequency.setValueAtTime(cutoff, when);
    filter.Q.setValueAtTime(0.5 + (params.resonance ?? 0.5) * 12, when);

    const env = ctx.createGain();
    const volume = clampValue(params.volume ?? 0.8, 0, 1);
    const decay = 0.1 + (params.decay ?? 0.5) * 0.5;
    const peakTime = when + 0.01;
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(volume, peakTime);
    env.gain.exponentialRampToValueAtTime(0.0001, when + decay);

    osc.connect(filter);
    filter.connect(env);
    env.connect(audioState.masterGain);

    osc.start(when);
    osc.stop(when + decay + 0.1);
}
