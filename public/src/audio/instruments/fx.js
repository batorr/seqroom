// FX: build-ups and drops.
//
// - riser: stereo noise through a band-pass sweeping up, plus a pair of
//   detuned saws climbing two octaves, swelling over Length steps and cut
//   dead on the step it lands on (the drop);
// - downlifter: noise through a low-pass sweeping down and a falling saw,
//   fading out over half the Length;
// - impact: a sub boom falling from 120 to 30 Hz through a soft clip, a
//   short noise burst, and extra reverb;
// - zap: a square diving from a high pitch through a resonant low-pass that
//   follows it, the laser of 90s rave, with extra delay.
//
// Every voice passes a "kill" gain of its own before the mix, so stopping
// the transport (silenceFx) can fade a four-bar riser out instead of letting
// it run on.

import { FX_PARAMS, fxLengthSteps } from '../../shared/fx.js';
import { createNoiseBuffer } from '../../utils/audio.js';
import { getModulatedParam } from '../lfo.js';
import { getAudioGraph, getDriveCurve, routeVoice, releaseWhenEnded } from '../graph.js';

// Voice levels, set on K-weighted momentary loudness (400 ms windows,
// through the mix bus): the impact about level with the Rave Kit's kick, the
// end of a 16-step riser about level with a default acid line, a
// downlifter's start and a zap 3-5 LU under it.
const LEVELS = { riser: 1.3, downlifter: 1.1, impact: 0.9, zap: 0.36 };

// Voices that may still be sounding: { ctx, kill, end }.
const liveVoices = new Set();

function readParam(instrument, key) {
    const schema = FX_PARAMS[key];
    const base = Number(instrument.params?.[key]);
    const value = Number.isFinite(base) ? base : schema.default;
    const modulated = getModulatedParam(instrument.id, key, value, schema.min, schema.max);
    return Math.min(Math.max(modulated, schema.min), schema.max);
}

// Fades out everything still sounding (the transport stopped).
export function silenceFx() {
    liveVoices.forEach(({ ctx, kill, end }) => {
        if (ctx.state !== 'closed' && end > ctx.currentTime) {
            kill.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
        }
    });
    liveVoices.clear();
}

// Returns the voice's kill gain and a function that unplugs the voice from
// the mix once the given sources have all ended.
function openVoice(ctx, end, sends) {
    const now = ctx.currentTime;
    liveVoices.forEach((voice) => {
        if (voice.ctx !== ctx || voice.end <= now) liveVoices.delete(voice);
    });
    const kill = ctx.createGain();
    const wired = routeVoice(ctx, kill, sends);
    liveVoices.add({ ctx, kill, end });
    return { out: kill, releaseAfter: (sources) => releaseWhenEnded(sources, wired) };
}

// Looping noise, started at a random point so two layers never line up.
function noise(ctx, when, end) {
    const source = ctx.createBufferSource();
    source.buffer = createNoiseBuffer(ctx);
    source.loop = true;
    source.start(when, Math.random() * 0.9);
    source.stop(end);
    return source;
}

// Returns the two noise sources.
function stereoNoise(ctx, when, end, into) {
    return [-0.6, 0.6].map((pan) => {
        const panner = ctx.createStereoPanner();
        panner.pan.value = pan;
        const source = noise(ctx, when, end);
        source.connect(panner);
        panner.connect(into);
        return source;
    });
}

function playRiser(ctx, when, duration, level, tone, sends) {
    const end = when + duration;
    const { out, releaseAfter } = openVoice(ctx, end + 0.05, sends);
    // Swell on a square-law curve: audible from the first beat, 12 dB under
    // full at the halfway point, then cut dead on the landing step.
    const amp = ctx.createGain();
    const swell = new Float32Array(64).map((_, i) => level * (i / 63) ** 2);
    amp.gain.setValueCurveAtTime(swell, when, Math.max(0.02, duration - 0.01));
    amp.gain.linearRampToValueAtTime(0, end + 0.01);
    amp.connect(out);

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.2;
    band.frequency.setValueAtTime(250, when);
    band.frequency.exponentialRampToValueAtTime(3000 + tone * 9000, end);
    band.connect(amp);
    const noises = stereoNoise(ctx, when, end + 0.05, band);

    const climb = ctx.createGain();
    climb.gain.value = 0.35;
    climb.connect(amp);
    const startHz = 110 * (1 + tone);
    const saws = [-12, 12].map((detune) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.detune.value = detune;
        osc.frequency.setValueAtTime(startHz, when);
        osc.frequency.exponentialRampToValueAtTime(startHz * 4, end);
        osc.connect(climb);
        osc.start(when);
        osc.stop(end + 0.05);
        return osc;
    });
    releaseAfter([...noises, ...saws]);
}

function playDownlifter(ctx, when, duration, level, tone, sends) {
    const length = Math.max(0.25, duration / 2);
    const end = when + length;
    const { out, releaseAfter } = openVoice(ctx, end, sends);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(level, when + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);
    amp.connect(out);

    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.Q.value = 0.8;
    low.frequency.setValueAtTime(6000 + tone * 8000, when);
    low.frequency.exponentialRampToValueAtTime(150, end);
    low.connect(amp);
    const noises = stereoNoise(ctx, when, end, low);

    const fall = ctx.createOscillator();
    fall.type = 'sawtooth';
    const fallHz = 880 * (1 + tone);
    fall.frequency.setValueAtTime(fallHz, when);
    fall.frequency.exponentialRampToValueAtTime(55, end);
    const fallGain = ctx.createGain();
    fallGain.gain.value = 0.3;
    fall.connect(fallGain);
    fallGain.connect(low);
    fall.start(when);
    fall.stop(end);
    releaseAfter([...noises, fall]);
}

function playImpact(ctx, when, level, tone, sends) {
    const end = when + 3;
    const { out, releaseAfter } = openVoice(ctx, end, { ...sends, reverb: Math.min(1, sends.reverb + 0.3) });

    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(120, when);
    boom.frequency.exponentialRampToValueAtTime(30, when + 1.5);
    const shaper = ctx.createWaveShaper();
    shaper.curve = getDriveCurve(0.35);
    shaper.oversample = '2x';
    const boomAmp = ctx.createGain();
    boomAmp.gain.setValueAtTime(0, when);
    boomAmp.gain.linearRampToValueAtTime(level, when + 0.003);
    boomAmp.gain.setTargetAtTime(0, when + 0.05, 0.45);
    boom.connect(shaper);
    shaper.connect(boomAmp);
    boomAmp.connect(out);
    boom.start(when);
    boom.stop(end);

    const burstFilter = ctx.createBiquadFilter();
    burstFilter.type = 'lowpass';
    burstFilter.frequency.value = 2500 + tone * 4000;
    const burstAmp = ctx.createGain();
    burstAmp.gain.setValueAtTime(level * 0.6, when);
    burstAmp.gain.setTargetAtTime(0, when + 0.005, 0.06);
    burstFilter.connect(burstAmp);
    burstAmp.connect(out);
    releaseAfter([boom, ...stereoNoise(ctx, when, when + 0.6, burstFilter)]);
}

function playZap(ctx, when, level, tone, sends) {
    const end = when + 0.6;
    const { out, releaseAfter } = openVoice(ctx, end, { ...sends, delay: Math.min(1, sends.delay + 0.25) });
    const startHz = 1500 + tone * 3500;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(startHz, when);
    osc.frequency.exponentialRampToValueAtTime(70, when + 0.22);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 8;
    filter.frequency.setValueAtTime(startHz * 1.5, when);
    filter.frequency.exponentialRampToValueAtTime(200, when + 0.22);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(level, when + 0.002);
    amp.gain.setTargetAtTime(0, when + 0.02, 0.09);
    osc.connect(filter);
    filter.connect(amp);
    amp.connect(out);
    osc.start(when);
    osc.stop(end);
    releaseAfter([osc]);
}

// stepDuration: seconds per step, so risers and downlifters follow the tempo.
export function scheduleFx(instrument, step, when, ctx, stepDuration = 0.125) {
    if (!getAudioGraph(ctx)) {
        return;
    }
    const layers = step.layers || {};
    const p = (key) => readParam(instrument, key);
    const volume = p('volume');
    const tone = p('tone');
    const sends = { delay: p('delay') * 0.6, reverb: p('reverb') };
    const duration = stepDuration * fxLengthSteps(p('length'));

    if (layers.riser) playRiser(ctx, when, duration, volume * LEVELS.riser, tone, sends);
    if (layers.downlifter) playDownlifter(ctx, when, duration, volume * LEVELS.downlifter, tone, sends);
    if (layers.impact) playImpact(ctx, when, volume * LEVELS.impact, tone, sends);
    if (layers.zap) playZap(ctx, when, volume * LEVELS.zap, tone, sends);
}
