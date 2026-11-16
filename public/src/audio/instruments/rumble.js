// Rumble: the reverb-drenched sub tail of modern acid and hard techno.
//
// thump (per step) -> dark reverb -> low-pass (Tone) -> drive -> smoothing
// low-pass -> 28 Hz high-pass -> duck -> mix
//
// A step plays a short kick-like thump at its pitch into a long, dark
// reverb; convolving a low sine burst with noise gives a tonal, grainy sub
// at that pitch. Every hit also ducks the bus (Pump), the way a sidechain
// from the kick would, so the tail swells up between the hits instead of
// smearing over them. The bus stays mono: sub frequencies belong in the
// middle.

import { RUMBLE_PARAMS, RUMBLE_DEFAULT_PITCH } from '../../shared/rumble.js';
import { noteToFrequency } from '../../utils/audio.js';
import { getModulatedParam } from '../lfo.js';
import { getAudioGraph, getDriveCurve, releaseWhenEnded } from '../graph.js';

const buses = new Map();

// Bus level that puts a default rumble about 6 dB (RMS) under the Rave Kit's
// four-on-the-floor kick, measured through the mix bus.
const RUMBLE_LEVEL = 0.4;

const decaySeconds = (decay) => 0.4 + decay * 2.6; // 0.4–3 s
const toneHz = (tone) => 45 * Math.pow(2, tone * 3.2); // 45–413 Hz

function readParam(instrument, key) {
    const schema = RUMBLE_PARAMS[key];
    const base = Number(instrument.params?.[key]);
    const value = Number.isFinite(base) ? base : schema.default;
    const modulated = getModulatedParam(instrument.id, key, value, schema.min, schema.max);
    return Math.min(Math.max(modulated, schema.min), schema.max);
}

// Mono noise, darkened by a one-pole low-pass, decaying to -60 dB over the
// given length, with a 4 ms fade-in so a hit never clicks.
function createRumbleImpulse(ctx, seconds) {
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.round(rate * seconds));
    const impulse = ctx.createBuffer(1, length, rate);
    const data = impulse.getChannelData(0);
    const decayRate = 6.9 / seconds;
    const fadeIn = Math.round(rate * 0.004);
    const coefficient = 1 - Math.exp((-2 * Math.PI * 900) / rate);
    let lowpassed = 0;
    for (let i = 0; i < length; i += 1) {
        lowpassed += coefficient * ((Math.random() * 2 - 1) - lowpassed);
        const fade = i < fadeIn ? i / fadeIn : 1;
        data[i] = lowpassed * Math.exp((-i / rate) * decayRate) * fade;
    }
    return impulse;
}

function ensureBus(instrument, ctx, when) {
    const graph = getAudioGraph(ctx);
    let bus = buses.get(instrument.id);
    if (!bus || bus.ctx !== ctx) {
        bus?.dispose();
        const input = ctx.createGain();
        const reverb = ctx.createConvolver();
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.Q.value = 0.9;
        const shaper = ctx.createWaveShaper();
        shaper.oversample = '2x';
        const smooth = ctx.createBiquadFilter();
        smooth.type = 'lowpass';
        smooth.Q.value = 0.5;
        const highpass = ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 28;
        highpass.Q.value = 0.7;
        const duck = ctx.createGain();
        const output = ctx.createGain();
        input.connect(reverb);
        reverb.connect(lowpass);
        lowpass.connect(shaper);
        shaper.connect(smooth);
        smooth.connect(highpass);
        highpass.connect(duck);
        duck.connect(output);
        output.connect(graph.input);
        bus = {
            ctx,
            input,
            reverb,
            lowpass,
            shaper,
            smooth,
            duck,
            output,
            decay: -1,
            drive: -1,
            dispose() {
                output.disconnect();
            },
        };
        buses.set(instrument.id, bus);
    }

    // Rebuilding the reverb restarts its tail, so only for real changes.
    const decay = readParam(instrument, 'decay');
    if (Math.abs(decay - bus.decay) >= 0.02) {
        bus.decay = decay;
        bus.reverb.buffer = createRumbleImpulse(ctx, decaySeconds(decay));
    }
    const drive = readParam(instrument, 'drive');
    if (Math.abs(drive - bus.drive) >= 0.01) {
        bus.drive = drive;
        bus.shaper.curve = getDriveCurve(0.1 + drive * 0.9);
    }
    const cutoff = toneHz(readParam(instrument, 'tone'));
    bus.lowpass.frequency.setTargetAtTime(cutoff, when, 0.02);
    // Drive adds harmonics; keep the growl, lose the fizz.
    bus.smooth.frequency.setTargetAtTime(Math.min(cutoff * 3, 1600), when, 0.02);
    // The shaper gains up to ~11x on quiet input; give most of it back
    // (measured: the bus stays within about 1.5 dB RMS across the Drive range).
    const driveMakeup = 1 / (1 + drive * (1.2 - 0.3 * drive));
    bus.output.gain.setTargetAtTime(readParam(instrument, 'volume') * RUMBLE_LEVEL * driveMakeup, when, 0.02);
    return bus;
}

export function releaseRumble(instrumentId) {
    buses.get(instrumentId)?.dispose();
    buses.delete(instrumentId);
}

// stepDuration: seconds until the next step (the duck recovers in steps, so
// the pump follows the tempo).
export function scheduleRumble(instrument, step, when, ctx, stepDuration = 0.125) {
    if (!getAudioGraph(ctx)) {
        return;
    }
    const bus = ensureBus(instrument, ctx, when);
    const frequency = noteToFrequency(step.pitch || RUMBLE_DEFAULT_PITCH);

    // Thump: a quick pitch drop onto the note, like a kick without its click.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency * 4, when);
    osc.frequency.exponentialRampToValueAtTime(frequency * 1.6, when + 0.015);
    osc.frequency.exponentialRampToValueAtTime(frequency, when + 0.09);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(1, when + 0.002);
    amp.gain.setTargetAtTime(0, when + 0.04, 0.07);
    osc.connect(amp);
    amp.connect(bus.input);
    osc.start(when);
    osc.stop(when + 0.6);
    releaseWhenEnded([osc], [amp]);

    // Pump: drop at the hit, hold, then swell back over the next steps, so
    // the tail peaks between the hits. Hits are at least a step apart and
    // arrive in time order, and the hold stays under a step, so the chained
    // setTargetAtTime events never overlap.
    const pump = readParam(instrument, 'pump');
    const floor = (1 - pump) ** 2;
    const hold = stepDuration * 0.6 * pump;
    const recovery = Math.max(0.01, stepDuration * (0.3 + 1.2 * pump));
    bus.duck.gain.setTargetAtTime(floor, when, 0.004);
    bus.duck.gain.setTargetAtTime(1, when + 0.012 + hold, recovery);
}
