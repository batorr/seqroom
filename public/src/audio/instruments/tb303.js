// TB-303 Synthesizer Module
// Acid bass voice: saw/square oscillator -> resonant low-pass with its own
// envelope -> amplitude envelope, with 303-style accent and slide.
//
// Slide: a step with `slide` holds its note through the step and the next
// active step does not retrigger: the same oscillator glides to the new pitch
// (legato), with neither the amplitude nor the filter envelope restarting.
// Accent: louder, with a deeper and shorter filter sweep and a little more
// resonance.

import { audioState } from '../../state/audio.js';
import { clampValue } from '../../utils/helpers.js';
import { noteToFrequency } from '../../utils/audio.js';
import { getModulatedParam } from '../lfo.js';

const SLIDE_TIME = 0.06; // seconds, close to the original's fixed glide
const ATTACK_TIME = 0.003;
// Accent plays at the full volume setting, normal notes ~5 dB below it
// (the headroom an accent needs without clipping at max volume/resonance).
const NORMAL_LEVEL = 0.55;
const MAX_FILTER_HZ = 18000;
const FLOOR = 0.0001; // exponential ramps cannot target 0

// Voices left open by a sliding step, per instrument, waiting for the next step.
const openVoices = new Map();

function baseCutoffHz(cutoff) {
    return 60 * Math.pow(2, cutoff * 7.5); // 60 Hz .. ~10.9 kHz, even per octave
}

export function scheduleTB303(instrument, step, prevStep, when, ctx, stepDuration = 0.125) {
    const params = instrument.params || {};
    const id = instrument.id;

    const volume = clampValue(getModulatedParam(id, 'volume', params.volume ?? 0.8, 0, 1), 0, 1);
    const accent = Boolean(step.accent);
    const peak = Math.max(FLOOR, volume * (accent ? 1 : NORMAL_LEVEL));
    const decayParam = clampValue(params.decay ?? 0.5, 0, 1);
    const ampDecay = 0.1 + decayParam * 0.5;
    const frequency = noteToFrequency(step.pitch || 'C2');
    // A sliding step holds until the next step starts (plus a hair of overlap).
    const holdEnd = step.slide ? when + stepDuration : null;

    const open = openVoices.get(id);
    openVoices.delete(id);
    const slidInto = Boolean(prevStep?.active && prevStep?.slide)
        && open
        && open.ctx === ctx
        && Math.abs(open.holdEnd - when) < 0.02;

    let voice;
    if (slidInto) {
        voice = open;
        // Glide the running oscillator; no retrigger.
        voice.osc.frequency.cancelScheduledValues(when);
        voice.osc.frequency.setValueAtTime(voice.frequency, when);
        voice.osc.frequency.exponentialRampToValueAtTime(frequency, when + Math.min(SLIDE_TIME, stepDuration * 0.8));
        // Replace the held note's release with this note's level and shape.
        voice.amp.gain.cancelScheduledValues(when);
        voice.amp.gain.setValueAtTime(voice.peak, when);
        voice.amp.gain.linearRampToValueAtTime(peak, when + 0.01);
        if (holdEnd !== null) {
            voice.amp.gain.setValueAtTime(peak, holdEnd);
            voice.amp.gain.exponentialRampToValueAtTime(FLOOR, holdEnd + ampDecay);
        } else {
            voice.amp.gain.exponentialRampToValueAtTime(FLOOR, when + 0.01 + ampDecay);
        }
    } else {
        const osc = ctx.createOscillator();
        osc.type = params.waveform === 'square' ? 'square' : 'sawtooth';
        osc.frequency.setValueAtTime(frequency, when);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        const cutoff = getModulatedParam(id, 'cutoff', params.cutoff ?? 0.5, 0, 1);
        const resonance = getModulatedParam(id, 'resonance', params.resonance ?? 0.5, 0, 1);
        const envMod = clampValue(params.envelopeMod ?? 0.6, 0, 1);
        const base = baseCutoffHz(cutoff);
        // Accent: deeper and faster filter sweep, slightly more resonance.
        const envOctaves = accent ? Math.min(1, envMod + 0.3) * 5.5 : envMod * 4.5;
        const filterDecay = accent ? 0.2 : 0.15 + decayParam * 1.2;
        const sweepPeak = Math.min(MAX_FILTER_HZ, base * Math.pow(2, envOctaves));
        filter.frequency.setValueAtTime(sweepPeak, when);
        filter.frequency.setTargetAtTime(base, when + ATTACK_TIME, filterDecay / 4);
        filter.Q.setValueAtTime(0.5 + resonance * 12 + (accent ? 4 : 0), when);

        const amp = ctx.createGain();
        amp.gain.setValueAtTime(FLOOR, when);
        amp.gain.exponentialRampToValueAtTime(peak, when + ATTACK_TIME);
        if (holdEnd !== null) {
            amp.gain.setValueAtTime(peak, holdEnd);
            amp.gain.exponentialRampToValueAtTime(FLOOR, holdEnd + ampDecay);
        } else {
            amp.gain.exponentialRampToValueAtTime(FLOOR, when + ampDecay);
        }

        osc.connect(filter);
        filter.connect(amp);
        amp.connect(audioState.masterGain);
        osc.start(when);
        voice = { ctx, osc, amp };
    }

    voice.frequency = frequency;
    voice.peak = peak;
    // Calling stop() again moves the stop time.
    voice.osc.stop((holdEnd ?? when + 0.01) + ampDecay + 0.1);

    if (holdEnd !== null) {
        voice.holdEnd = holdEnd;
        openVoices.set(id, voice);
    }
}
