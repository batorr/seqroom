// Hoover: the swooping, chorused rave lead.
//
// pitch CV (ConstantSource, Hz) -> three saws (detuned -w/0/+w, panned
// left/centre/right), a pulse made of a saw minus a delayed copy of itself
// (an LFO sweeps the delay: pulse-width modulation), and a square an octave
// down -> 90 Hz high-pass -> low-pass (Cutoff) -> amp -> mix, plus delay and
// reverb sends.
//
// Mono: a new note fades out the one before it. A fresh note falls into its
// pitch from Bend semitones above; a note that starts while the previous one
// still holds glides over from that pitch instead (Glide), which is the
// hoover's signature move. Length holds a note for 1–8 steps, so it follows
// the tempo.

import { HOOVER_PARAMS, HOOVER_DEFAULT_PITCH } from '../../shared/hoover.js';
import { noteToFrequency } from '../../utils/audio.js';
import { getModulatedParam } from '../lfo.js';
import { getAudioGraph, routeVoice } from '../graph.js';

// Mix level of the voice, set on a K-weighted meter: a busy default riff (six
// notes a bar) measures about 1.3 LU under a default acid line, a three-note
// riff about 3.6 LU under; peaks stay around -3 dBFS.
const VOICE_LEVEL = 0.2;
const RELEASE = 0.12;
const PWM_RATE = 0.7; // Hz

// instrumentId -> the sounding voice: { ctx, amp, holdEnd, frequency }
const voices = new Map();

function readParam(instrument, key) {
    const schema = HOOVER_PARAMS[key];
    const base = Number(instrument.params?.[key]);
    const value = Number.isFinite(base) ? base : schema.default;
    const modulated = getModulatedParam(instrument.id, key, value, schema.min, schema.max);
    return Math.min(Math.max(modulated, schema.min), schema.max);
}

export function releaseHoover(instrumentId) {
    voices.delete(instrumentId);
}

export function scheduleHoover(instrument, step, when, ctx, stepDuration = 0.125) {
    if (!getAudioGraph(ctx)) {
        return;
    }
    const p = (key) => readParam(instrument, key);
    const target = noteToFrequency(step.pitch || HOOVER_DEFAULT_PITCH);
    const holdEnd = when + stepDuration * (1 + p('length') * 7);
    const stopAt = holdEnd + RELEASE * 5;
    const width = p('width');

    // Steps arrive in time order, so the stored voice is the one before.
    const previous = voices.get(instrument.id);
    const legato = previous && previous.ctx === ctx && previous.holdEnd > when;
    if (previous && previous.ctx === ctx && previous.holdEnd + RELEASE * 5 > when) {
        previous.amp.gain.cancelScheduledValues(when);
        previous.amp.gain.setTargetAtTime(0, when, 0.004);
    }

    // Pitch CV: glide from the previous note, or fall from above.
    const pitch = ctx.createConstantSource();
    const from = legato ? previous.frequency : target * Math.pow(2, p('bend'));
    const travel = legato ? 0.01 + p('glide') * 0.3 : 0.03 + p('bend') * 0.09;
    pitch.offset.setValueAtTime(from, when);
    pitch.offset.exponentialRampToValueAtTime(target, when + travel);

    const mix = ctx.createGain();
    const oscillators = [pitch];
    const addOsc = (type, { detune = 0, pan = 0, level = 1, cvScale = 1 } = {}) => {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = 0;
        osc.detune.value = detune;
        if (cvScale === 1) {
            pitch.connect(osc.frequency);
        } else {
            const scale = ctx.createGain();
            scale.gain.value = cvScale;
            pitch.connect(scale);
            scale.connect(osc.frequency);
        }
        const gain = ctx.createGain();
        gain.gain.value = level;
        osc.connect(gain);
        if (pan) {
            const panner = ctx.createStereoPanner();
            panner.pan.value = pan;
            gain.connect(panner);
            panner.connect(mix);
        } else {
            gain.connect(mix);
        }
        oscillators.push(osc);
        return osc;
    };

    // Three saws, spread wider with Width.
    const spread = 6 + width * 24; // cents
    addOsc('sawtooth', { detune: -spread, pan: -0.7, level: 0.8 });
    addOsc('sawtooth', { level: 0.8 });
    addOsc('sawtooth', { detune: spread, pan: 0.7, level: 0.8 });

    // Pulse: saw minus itself delayed by part of a period; sweeping the delay
    // sweeps the pulse width.
    const pulseSaw = addOsc('sawtooth', { level: 0.7 });
    const delayed = ctx.createDelay(0.05);
    delayed.delayTime.value = 0.5 / target;
    const invert = ctx.createGain();
    invert.gain.value = -0.7;
    pulseSaw.connect(delayed);
    delayed.connect(invert);
    invert.connect(mix);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = PWM_RATE;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = (0.1 + width * 0.3) / target;
    lfo.connect(lfoDepth);
    lfoDepth.connect(delayed.delayTime);
    oscillators.push(lfo);

    // Sub octave for weight.
    addOsc('square', { level: 0.45, cvScale: 0.5 });

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 90;
    highpass.Q.value = 0.7;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400 * Math.pow(2, p('cutoff') * 5); // 400 Hz – 12.8 kHz
    filter.Q.value = 1;
    mix.connect(highpass);
    highpass.connect(filter);

    const level = p('volume') * VOICE_LEVEL;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(level, when + 0.006);
    amp.gain.setValueAtTime(level, holdEnd);
    amp.gain.setTargetAtTime(0, holdEnd, RELEASE / 3);
    filter.connect(amp);
    routeVoice(ctx, amp, { delay: p('delay') * 0.6, reverb: p('reverb') });

    oscillators.forEach((node) => {
        node.start(when);
        node.stop(stopAt);
    });

    voices.set(instrument.id, { ctx, amp, holdEnd, frequency: target });
}
