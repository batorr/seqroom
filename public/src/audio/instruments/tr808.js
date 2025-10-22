// TR-808 Drum Machine Module
// Classic drum machine sound generation

import { audioState } from '../../state/audio.js';
import { clampValue } from '../../utils/helpers.js';
import { createNoiseBuffer } from '../../utils/audio.js';

export function scheduleTR808(instrument, step, when, ctx) {
    const params = instrument.params || {};
    const layers = step.layers || {};

    if (layers.kick) {
        scheduleKick(params, when, ctx);
    }
    if (layers.snare) {
        scheduleSnare(params, when, ctx);
    }
    if (layers.hat) {
        scheduleHat(params, when, ctx);
    }
    if (layers.clap) {
        scheduleClap(params, when, ctx);
    }
}

export function scheduleKick(params, when, ctx) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const volume = clampValue(params.kickLevel ?? 0.9, 0, 1) * clampValue(params.volume ?? 0.8, 0, 1);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, when);
    osc.frequency.exponentialRampToValueAtTime(40, when + 0.22);

    gain.gain.setValueAtTime(volume, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.28);

    osc.connect(gain);
    gain.connect(audioState.masterGain);

    osc.start(when);
    osc.stop(when + 0.4);
}

export function scheduleSnare(params, when, ctx) {
    const noise = createNoiseBuffer(ctx);
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noise;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1000;

    const gain = ctx.createGain();
    const volume = clampValue(params.snareLevel ?? 0.7, 0, 1) * clampValue(params.volume ?? 0.8, 0, 1);
    gain.gain.setValueAtTime(volume, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.2);

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(gain);
    gain.connect(audioState.masterGain);

    noiseSource.start(when);
    noiseSource.stop(when + 0.25);
}

export function scheduleHat(params, when, ctx) {
    const buffer = createNoiseBuffer(ctx);
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const tone = clampValue(params.hatTone ?? params.tone ?? 0.5, 0, 1);
    const bandpassFrequency = 5000 + tone * 7000;
    const highpassFrequency = 2000 + tone * 4000;
    const resonance = 1 + tone * 6;

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(highpassFrequency, when);
    highpass.Q.setValueAtTime(0.8 + tone * 1.2, when);

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(bandpassFrequency, when);
    bandpass.Q.setValueAtTime(resonance, when);

    const gain = ctx.createGain();
    const volume = clampValue(params.hatLevel ?? 0.6, 0, 1) * clampValue(params.volume ?? 0.8, 0, 1);
    gain.gain.setValueAtTime(volume, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.15);

    source.connect(highpass);
    highpass.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(audioState.masterGain);

    source.start(when);
    source.stop(when + 0.18);
}

export function scheduleClap(params, when, ctx) {
    const noise = createNoiseBuffer(ctx);
    const source = ctx.createBufferSource();
    source.buffer = noise;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 2000;
    bandpass.Q.value = 1.5;

    const gain = ctx.createGain();
    const volume = clampValue(params.clapLevel ?? 0.6, 0, 1) * clampValue(params.volume ?? 0.8, 0, 1);
    gain.gain.setValueAtTime(volume, when);
    gain.gain.exponentialRampToValueAtTime(volume * 0.6, when + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.25);

    source.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(audioState.masterGain);

    source.start(when);
    source.stop(when + 0.3);
}
