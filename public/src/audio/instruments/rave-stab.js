// Rave Stab: one step, one chord.
//
// per chord note: two saws detuned apart, panned left and right
// -> 160 Hz high-pass -> resonant low-pass that snaps shut (Env Mod) -> amp
// (Decay) -> mix, plus delay and reverb sends
//
// The high-pass keeps the stab clear of the acid bass and the rumble; the
// filter starts bright and closes fast, which gives the stab its "zap"; the
// dotted-eighth delay of the mix bus does the rest.

import { STAB_PARAMS, STAB_DEFAULT_PITCH, chordIntervals } from '../../shared/rave-stab.js';
import { noteToFrequency } from '../../utils/audio.js';
import { getModulatedParam } from '../lfo.js';
import { getAudioGraph, routeVoice, releaseWhenEnded } from '../graph.js';

// Per-saw level (divided by the square root of the chord size), set on a
// K-weighted meter: a default offbeat stab measures about 4.5 LU under a
// default acid line, peaking around -1.6 dBFS through the mix bus.
const SAW_LEVEL = 0.6;

function readParam(instrument, key) {
    const schema = STAB_PARAMS[key];
    const base = Number(instrument.params?.[key]);
    const value = Number.isFinite(base) ? base : schema.default;
    const modulated = getModulatedParam(instrument.id, key, value, schema.min, schema.max);
    return Math.min(Math.max(modulated, schema.min), schema.max);
}

export function scheduleRaveStab(instrument, step, when, ctx) {
    if (!getAudioGraph(ctx)) {
        return;
    }
    const p = (key) => readParam(instrument, key);
    const intervals = chordIntervals(instrument.params?.chord);
    const rootHz = noteToFrequency(step.pitch || STAB_DEFAULT_PITCH);
    const cutoff = 300 * Math.pow(2, p('cutoff') * 5); // 300 Hz – 9.6 kHz
    const envelope = p('envelope');
    const decay = 0.04 + p('decay') * 0.5; // amp time constant, s
    const detune = p('detune') * 25; // cents either side
    // Sources stop at about -48 dB; the echo carries the tail from there.
    const length = 0.01 + decay * 5.5;

    // Two saws per note, one each side; wider detune, wider stab.
    const sources = [];
    const sides = [-1, 1].map((side) => {
        const bus = ctx.createGain();
        bus.gain.value = SAW_LEVEL / Math.sqrt(intervals.length);
        const pan = ctx.createStereoPanner();
        pan.pan.value = side * 0.6;
        bus.connect(pan);
        intervals.forEach((interval) => {
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = rootHz * Math.pow(2, interval / 12);
            osc.detune.value = side * detune;
            osc.connect(bus);
            osc.start(when);
            osc.stop(when + length);
            sources.push(osc);
        });
        return pan;
    });

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 160;
    highpass.Q.value = 0.7;
    sides.forEach((pan) => pan.connect(highpass));

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2.5;
    filter.frequency.setValueAtTime(Math.min(cutoff * (1 + envelope * 7), 18000), when);
    filter.frequency.setTargetAtTime(cutoff, when + 0.002, 0.03 + decay * 0.25);
    highpass.connect(filter);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(p('volume'), when + 0.003);
    amp.gain.setTargetAtTime(0, when + 0.012, decay);
    filter.connect(amp);

    releaseWhenEnded(sources, routeVoice(ctx, amp, { delay: p('delay') * 0.6, reverb: p('reverb') }));
}
