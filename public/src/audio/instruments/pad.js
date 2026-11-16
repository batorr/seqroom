// Pad: slow, wide chords behind the acid line.
//
// per chord note: two saws detuned apart (Detune), panned left and right,
// a slow drift moving the two sides against each other
// -> 150 Hz high-pass -> low-pass that opens with the swell (Env Mod) and
// settles back to Cutoff over the hold -> amp (Attack, held for Length
// steps, Release) -> mix, plus delay and reverb sends
//
// The high-pass leaves the low end to the acid bass and the rumble. A chord
// that starts while the one before still sounds takes over: the old chord
// fades as the new one swells, and anything older is cut, so at most three
// chords' oscillators run at once whatever the pattern. The same chord
// again while it still holds just holds on (a filled lane is one chord).

import { PAD_PARAMS, PAD_DEFAULT_PITCH, padChordIntervals, padLengthSteps } from '../../shared/pad.js';
import { noteToFrequency } from '../../utils/audio.js';
import { getModulatedParam } from '../lfo.js';
import { getAudioGraph, routeVoice, releaseWhenEnded } from '../graph.js';

// Per-saw level (divided by the square root of the chord size).
const SAW_LEVEL = 0.2;
const HIGHPASS_HZ = 150;
const DRIFT_RATE = 0.2; // Hz, plus a little per chord so pads never lock
const CUT = 0.008; // time constant for chords cut short, s

// instrumentId -> chords still sounding, oldest first:
// [{ ctx, amp, sources, chord, start, holdEnd, stopAt }]
const voices = new Map();

function readParam(instrument, key) {
    const schema = PAD_PARAMS[key];
    const base = Number(instrument.params?.[key]);
    const value = Number.isFinite(base) ? base : schema.default;
    const modulated = getModulatedParam(instrument.id, key, value, schema.min, schema.max);
    return Math.min(Math.max(modulated, schema.min), schema.max);
}

// Fades a chord out from `at` (time constant in seconds) and stops its
// oscillators once it is inaudible; a chord that has not started yet never
// starts.
function fadeOut(voice, at, timeConstant) {
    if (voice.ctx.state === 'closed' || voice.stopAt <= at) {
        return;
    }
    let stopAt = at + timeConstant * 6;
    if (at <= voice.start) {
        stopAt = voice.start;
    } else {
        voice.amp.gain.cancelScheduledValues(at);
        voice.amp.gain.setTargetAtTime(0, at, timeConstant);
    }
    if (stopAt < voice.stopAt) {
        // stop() again only moves the stop time.
        voice.sources.forEach((node) => node.stop(stopAt));
        voice.stopAt = stopAt;
    }
}

// Fades out an instrument's chords (muted or removed).
export function releasePad(instrumentId) {
    (voices.get(instrumentId) || []).forEach((voice) => fadeOut(voice, voice.ctx.currentTime, 0.05));
    voices.delete(instrumentId);
}

// Fades out every chord still sounding (the transport stopped).
export function silencePads() {
    [...voices.keys()].forEach(releasePad);
}

export function schedulePad(instrument, step, when, ctx, stepDuration = 0.125) {
    if (!getAudioGraph(ctx)) {
        return;
    }
    const p = (key) => readParam(instrument, key);
    const intervals = padChordIntervals(instrument.params?.chord);
    const rootHz = noteToFrequency(step.pitch || PAD_DEFAULT_PITCH);
    const hold = stepDuration * padLengthSteps(p('length'));
    const holdEnd = when + hold;
    // s to 95%; never more than half the hold, so short chords still arrive.
    const attack = Math.min(0.01 + p('attack') * p('attack') * 2.5, hold / 2);
    const release = 0.05 + p('release') * p('release') * 3; // s to 95% down
    const stopAt = holdEnd + release * 2;
    const chord = `${step.pitch || PAD_DEFAULT_PITCH}:${intervals.join(',')}`;

    // Steps arrive in time order: the last chord stored is the one before.
    const sounding = (voices.get(instrument.id) || []).filter((voice) => voice.ctx === ctx && voice.stopAt > when);
    const previous = sounding.pop();

    // The same chord again while it still holds is tied on, not started
    // over: a filled lane holds one chord instead of restarting its swell on
    // every step. One that lands where the hold ends plays again (the
    // margin keeps rounding from deciding that).
    if (previous && previous.chord === chord && previous.holdEnd > when + 0.001) {
        previous.amp.gain.cancelScheduledValues(when);
        previous.amp.gain.setTargetAtTime(0, holdEnd, release / 3);
        previous.sources.forEach((node) => node.stop(stopAt));
        previous.holdEnd = holdEnd;
        previous.stopAt = stopAt;
        voices.set(instrument.id, [...sounding, previous]);
        return;
    }

    sounding.forEach((voice) => fadeOut(voice, when, CUT));
    if (previous) {
        fadeOut(previous, when, Math.min(Math.max(Math.min(attack, release) / 3, 0.015), 0.3));
    }

    // Two saws per note, one each side; the drift bends the sides apart.
    const detune = 3 + p('detune') * 22; // cents either side
    const drift = ctx.createOscillator();
    drift.frequency.value = DRIFT_RATE * (0.85 + Math.random() * 0.3);
    const sources = [drift];
    const sides = [-1, 1].map((side) => {
        const bus = ctx.createGain();
        bus.gain.value = SAW_LEVEL / Math.sqrt(intervals.length);
        const pan = ctx.createStereoPanner();
        pan.pan.value = side * 0.75;
        bus.connect(pan);
        const depth = ctx.createGain();
        depth.gain.value = side * (2 + p('detune') * 6); // cents
        drift.connect(depth);
        intervals.forEach((interval) => {
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = rootHz * Math.pow(2, interval / 12);
            osc.detune.value = side * detune;
            depth.connect(osc.detune);
            osc.connect(bus);
            sources.push(osc);
        });
        return pan;
    });

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = HIGHPASS_HZ;
    highpass.Q.value = 0.7;
    sides.forEach((pan) => pan.connect(highpass));

    // The filter blooms open with the swell, then settles back over the hold.
    const cutoff = 200 * Math.pow(2, p('cutoff') * 6); // 200 Hz – 12.8 kHz
    const peak = Math.min(cutoff * (1 + p('envelope') * 6), 16000);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(cutoff, when);
    filter.frequency.setTargetAtTime(peak, when, attack / 3);
    filter.frequency.setTargetAtTime(cutoff, when + attack, Math.max(0.15, (holdEnd - when) / 2));
    highpass.connect(filter);

    const amp = ctx.createGain();
    amp.gain.value = 0;
    amp.gain.setValueAtTime(0, when);
    amp.gain.setTargetAtTime(p('volume'), when, attack / 3);
    amp.gain.setTargetAtTime(0, holdEnd, release / 3);
    filter.connect(amp);

    releaseWhenEnded(sources, routeVoice(ctx, amp, { delay: p('delay') * 0.6, reverb: p('reverb') }));
    sources.forEach((node) => {
        node.start(when);
        node.stop(stopAt);
    });

    voices.set(instrument.id, [...sounding, previous, { ctx, amp, sources, chord, start: when, holdEnd, stopAt }].filter(Boolean));
}
