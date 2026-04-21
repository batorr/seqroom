// TR-808 Drum Machine Module
// Classic drum machine sound generation

import { audioState } from '../../state/audio.js';
import { clampValue } from '../../utils/helpers.js';
import { createNoiseBuffer } from '../../utils/audio.js';

export function scheduleTR808(instrument, step, when, ctx) {
    const params = instrument.params || {};
    const layers = step.layers || {};

    if (layers.kick) scheduleKick(params, when, ctx);
    if (layers.snare) scheduleSnare(params, when, ctx);
    if (layers.hat) scheduleHat(params, when, ctx);
    if (layers.openhat) scheduleOpenHat(params, when, ctx);
    if (layers.clap) scheduleClap(params, when, ctx);
}

export function scheduleKick(params, when, ctx) {
    const volume = clampValue(params.kickLevel ?? 0.9, 0, 1) * clampValue(params.volume ?? 0.8, 0, 1);
    const decay = clampValue(params.kickDecay ?? 0.8, 0.1, 2);
    const tone = clampValue(params.kickTone ?? 60, 30, 100);
    const drive = clampValue(params.kickDrive ?? 0.15, 0, 1);

    const toneNorm = (tone - 30) / 70;
    const startFreq = 100 + toneNorm * 120;  // 100–220 Hz
    const endFreq = 28 + toneNorm * 20;      // 28–48 Hz (sub-bass)
    const pitchTime = 0.025 + decay * 0.02;  // 25–65 ms — fast snap
    const gainTime = 0.15 + decay * 0.6;     // 0.27–1.35 s

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, when);
    osc.frequency.exponentialRampToValueAtTime(endFreq, when + pitchTime);
    gain.gain.setValueAtTime(0.001, when);
    gain.gain.linearRampToValueAtTime(volume, when + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + gainTime);

    if (drive > 0.05) {
        const shaper = ctx.createWaveShaper();
        const amount = 1 + drive * 60;
        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
            const x = (i * 2) / 256 - 1;
            curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
        }
        shaper.curve = curve;
        shaper.oversample = '2x';
        osc.connect(shaper);
        shaper.connect(gain);
    } else {
        osc.connect(gain);
    }

    gain.connect(audioState.masterGain);
    osc.start(when);
    osc.stop(when + gainTime + 0.1);
}

export function scheduleSnare(params, when, ctx) {
    const volume = clampValue(params.snareLevel ?? 0.7, 0, 1) * clampValue(params.volume ?? 0.8, 0, 1);
    const decay = clampValue(params.snareDecay ?? 0.7, 0.1, 1.5);
    const tone = clampValue(params.snareTone ?? 0.5, 0, 1);
    const snappy = clampValue(params.snareSnappy ?? 0.6, 0, 1);

    const gainTime = decay * 0.2;
    const noiseVolume = volume * snappy;
    const toneVolume = volume * (1 - snappy) * 0.5;

    // Noise component (snap/crack)
    if (noiseVolume > 0.001) {
        const noise = createNoiseBuffer(ctx);
        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noise;

        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.value = 800 + tone * 1200;

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(noiseVolume, when);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + gainTime);

        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(audioState.masterGain);
        noiseSource.start(when);
        noiseSource.stop(when + gainTime + 0.05);
    }

    // Tonal component (body)
    if (toneVolume > 0.001) {
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(180 + tone * 80, when);
        osc.frequency.exponentialRampToValueAtTime(80 + tone * 40, when + gainTime * 0.5);
        oscGain.gain.setValueAtTime(toneVolume, when);
        oscGain.gain.exponentialRampToValueAtTime(0.0001, when + gainTime * 0.6);
        osc.connect(oscGain);
        oscGain.connect(audioState.masterGain);
        osc.start(when);
        osc.stop(when + gainTime * 0.7);
    }
}

export function scheduleHat(params, when, ctx) {
    const buffer = createNoiseBuffer(ctx);
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const tone = clampValue(params.hatTone ?? params.tone ?? 0.5, 0, 1);
    const tuning = clampValue(params.hatTuning ?? 1, 0.8, 1.2);
    const decay = clampValue(params.hatDecay ?? 0.4, 0.05, 1);

    const bandpassFrequency = (5000 + tone * 7000) * tuning;
    const highpassFrequency = (2000 + tone * 4000) * tuning;
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
    gain.gain.exponentialRampToValueAtTime(0.0001, when + decay);

    source.connect(highpass);
    highpass.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(audioState.masterGain);

    source.start(when);
    source.stop(when + decay + 0.03);
}

export function scheduleClap(params, when, ctx) {
    const volume = clampValue(params.clapLevel ?? 0.6, 0, 1) * clampValue(params.volume ?? 0.8, 0, 1);
    const spread = clampValue(params.clapSpread ?? 0.4, 0, 1);
    const reverb = clampValue(params.clapReverb ?? 0.35, 0, 1);
    const decay = clampValue(params.clapDecay ?? 0.8, 0.1, 1.5);

    const gainTime = 0.05 + decay * 0.25;
    const spreadMs = spread * 0.018;
    const burstCount = spread < 0.1 ? 1 : spread < 0.5 ? 2 : 3;

    for (let i = 0; i < burstCount; i++) {
        const burstWhen = when + i * spreadMs;
        const burstVolume = volume * (i === 0 ? 1 : 0.65 - i * 0.1);

        const noise = createNoiseBuffer(ctx);
        const source = ctx.createBufferSource();
        source.buffer = noise;

        const bandpass = ctx.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 2000;
        bandpass.Q.value = 1.5;

        const burstGain = ctx.createGain();
        burstGain.gain.setValueAtTime(burstVolume, burstWhen);
        burstGain.gain.exponentialRampToValueAtTime(0.0001, burstWhen + gainTime);

        source.connect(bandpass);
        bandpass.connect(burstGain);
        burstGain.connect(audioState.masterGain);
        source.start(burstWhen);
        source.stop(burstWhen + gainTime + 0.05);
    }

    // Reverb tail
    if (reverb > 0.05) {
        const noise = createNoiseBuffer(ctx);
        const tailSource = ctx.createBufferSource();
        tailSource.buffer = noise;

        const tailFilter = ctx.createBiquadFilter();
        tailFilter.type = 'bandpass';
        tailFilter.frequency.value = 1500;
        tailFilter.Q.value = 0.8;

        const tailGain = ctx.createGain();
        const tailVolume = volume * reverb * 0.25;
        const tailDecay = 0.1 + reverb * 0.8;
        tailGain.gain.setValueAtTime(tailVolume, when);
        tailGain.gain.exponentialRampToValueAtTime(0.0001, when + tailDecay);

        tailSource.connect(tailFilter);
        tailFilter.connect(tailGain);
        tailGain.connect(audioState.masterGain);
        tailSource.start(when);
        tailSource.stop(when + tailDecay + 0.05);
    }
}

export function scheduleOpenHat(params, when, ctx) {
    const buffer = createNoiseBuffer(ctx);
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const tone = clampValue(params.openhatTone ?? params.hatTone ?? params.tone ?? 0.5, 0, 1);
    const tuning = clampValue(params.openhatTuning ?? params.hatTuning ?? 1, 0.8, 1.2);
    const decay = clampValue(params.openhatDecay ?? 0.6, 0.1, 2);

    const bandpassFrequency = (5000 + tone * 7000) * tuning;
    const highpassFrequency = (2000 + tone * 4000) * tuning;
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
    const volume = clampValue(params.openhatLevel ?? 0.6, 0, 1) * clampValue(params.volume ?? 0.8, 0, 1);
    gain.gain.setValueAtTime(volume, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + decay);

    source.connect(highpass);
    highpass.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(audioState.masterGain);

    source.start(when);
    source.stop(when + decay + 0.05);
}
