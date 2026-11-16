// Rave Kit: synthesised drums for acid techno.
//
// Every voice is built from oscillators, noise and filters, voiced after the
// analogue drum machines acid techno was made on, but with its own tuning:
// - kick: sine with a hard two-stage pitch drop, a noise click and overdrive,
// - snare: two detuned triangle "heads" plus bright filtered noise,
// - clap: four bursts of band-passed noise, the last one with a tail,
// - rim: a short tuned click,
// - hats and ride: six square waves at inharmonic ratios ("metal"), band-passed
//   and mixed with a little noise; a closed hat chokes a ringing open hat,
// - toms: a sine dropping onto its pitch, a triangle skin partial and a stick
//   click, tuned low/mid/high,
// - cowbell: two detuned squares through a band-pass with a two-stage decay,
// - shaker: high, band-passed noise with a soft bead attack,
// - crash: brighter metal with a big wash of noise and a long fade.
// Each kit has a bus with optional drive and a send to the shared room reverb.

import { DRUM_PARAMS } from '../../shared/drum-kit.js';
import { createNoiseBuffer } from '../../utils/audio.js';
import { getModulatedParam } from '../lfo.js';
import { getAudioGraph, getDriveCurve, releaseWhenEnded } from '../graph.js';

// Inharmonic partials of a metal plate (ratios of 205.3, 304.4, 369.6, 522.7,
// 540 and 800 Hz): the basis of analogue hi-hats.
const HAT_RATIOS = [1, 1.4827, 1.8003, 2.546, 2.6303, 3.8967];
const RIDE_RATIOS = [1, 1.3427, 1.7915, 2.1702, 2.5313, 3.1241];
const CRASH_RATIOS = [1, 1.483, 1.932, 2.546, 2.895, 3.718];

// Gains of the newer voices, set on K-weighted momentary loudness against
// the other voices at their defaults: toms between the clap and the snare
// (low loudest), the cowbell about 4 LU under the clap, a 16th shaker about
// 1.5 LU under 16th closed hats, a crash about 3 LU over a ride hit.
const TOM_LEVEL = 0.25;
const COWBELL_LEVEL = 1;
const SHAKER_LEVEL = 0.45;
const CRASH_LEVEL = 0.9;

// Tom fundamentals before tuning (Tune spans 0.75x to 1.35x).
const TOM_BASE_HZ = { tomlow: 95, tommid: 135, tomhigh: 190 };

const kits = new Map();

function readParam(instrument, key) {
    const schema = DRUM_PARAMS[key];
    const base = Number(instrument.params?.[key]);
    const value = Number.isFinite(base) ? base : schema.default;
    const modulated = getModulatedParam(instrument.id, key, value, schema.min, schema.max);
    return Math.min(Math.max(modulated, schema.min), schema.max);
}

// Per-instrument bus: voices -> drive -> mix, plus a room send.
function ensureKit(instrument, ctx, when) {
    prepareMetalLoops(ctx.sampleRate);
    const graph = getAudioGraph(ctx);
    let kit = kits.get(instrument.id);
    if (!kit || kit.ctx !== ctx) {
        kit?.dispose();
        // The input sits 6 dB down so loud hits never reach the shaper's
        // hard limit; the output makes it back up.
        const input = ctx.createGain();
        input.gain.value = 0.5;
        const shaper = ctx.createWaveShaper();
        shaper.oversample = '4x';
        const output = ctx.createGain();
        const roomSend = ctx.createGain();
        input.connect(shaper);
        shaper.connect(output);
        output.connect(graph.input);
        output.connect(roomSend);
        roomSend.connect(graph.reverbSend);
        kit = {
            ctx,
            input,
            shaper,
            output,
            roomSend,
            drive: -1,
            openHats: [],
            dispose() {
                output.disconnect();
                roomSend.disconnect();
            },
        };
        kits.set(instrument.id, kit);
    }

    const drive = readParam(instrument, 'drive');
    if (Math.abs(drive - kit.drive) >= 0.01) {
        kit.drive = drive;
        kit.shaper.curve = getDriveCurve(drive * 0.8);
        // Driving harder adds loudness; take some back.
        kit.output.gain.setValueAtTime(2 * (1 - drive * 0.3), when);
    }
    kit.roomSend.gain.setValueAtTime(readParam(instrument, 'room') * 0.8, when);
    return kit;
}

export function releaseDrumKit(instrumentId) {
    kits.get(instrumentId)?.dispose();
    kits.delete(instrumentId);
}

export function scheduleDrums(instrument, step, when, ctx) {
    if (!getAudioGraph(ctx)) {
        return;
    }
    const layers = step.layers || {};
    const kit = ensureKit(instrument, ctx, when);
    const p = (key) => readParam(instrument, key);
    const volume = p('volume');

    if (layers.kick) playKick(ctx, kit, when, volume, p);
    if (layers.snare) playSnare(ctx, kit, when, volume, p);
    if (layers.clap) playClap(ctx, kit, when, volume, p);
    if (layers.rim) playRim(ctx, kit, when, volume, p);
    // Open before closed: a closed hat on the same step cuts the open one,
    // as both share one voice on the machines this kit is modelled on.
    if (layers.openhat) playOpenHat(ctx, kit, when, volume, p);
    if (layers.hat) playClosedHat(ctx, kit, when, volume, p);
    if (layers.ride) playRide(ctx, kit, when, volume, p);
    ['tomlow', 'tommid', 'tomhigh'].forEach((tom) => {
        if (layers[tom]) playTom(ctx, kit, when, volume, p, tom);
    });
    if (layers.cowbell) playCowbell(ctx, kit, when, volume, p);
    if (layers.shaker) playShaker(ctx, kit, when, volume, p);
    if (layers.crash) playCrash(ctx, kit, when, volume, p);
}

// ── Building blocks ──────────────────────────────────────────────────────

function noiseSource(ctx, when, duration) {
    const source = ctx.createBufferSource();
    source.buffer = createNoiseBuffer(ctx);
    source.loop = true;
    // Start somewhere random in the buffer so hits do not sound identical.
    source.start(when, Math.random() * 0.5);
    source.stop(when + duration);
    return source;
}

function filter(ctx, type, frequency, q = 0.707) {
    const node = ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
}

// Gain node with an instant attack and an exponential-style decay.
function decayingGain(ctx, when, peak, tau) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.0008);
    gain.gain.setTargetAtTime(0, when + 0.0008, tau);
    return gain;
}

const isSource = (node) => typeof node?.stop === 'function' && 'onended' in node;

// Connects the nodes in a row. A chain that starts with a sound source is a
// voice ending on a shared node (the kit or a metal bus): it is unplugged
// from there when the source ends (see releaseWhenEnded in graph.js).
function chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i += 1) {
        nodes[i].connect(nodes[i + 1]);
    }
    if (nodes.length > 1 && isSource(nodes[0])) {
        releaseWhenEnded([nodes[0]], [nodes[nodes.length - 2]]);
    }
    return nodes[nodes.length - 1];
}

// The metal of hats, ride and crash: six square waves at inharmonic ratios.
// Running six oscillators for every hit (a ride rings for seconds, so ten
// can overlap) was most of the kit's CPU, too much for a phone. Each metal
// is rendered once into a seamless loop and played back as one source; Tone
// is the playback rate. The loop is rendered at the top Tone so playback
// only ever slows down (no aliasing), and every partial is rounded to a whole
// number of cycles per loop (under 0.25% off) so the loop point is clean.
const METALS = {
    hat: { ratios: HAT_RATIOS, baseHz: 205, maxFactor: 1.35 },
    ride: { ratios: RIDE_RATIOS, baseHz: 330, maxFactor: 1.25 },
    crash: { ratios: CRASH_RATIOS, baseHz: 460, maxFactor: 1.25 },
};
const METAL_LOOP_SECONDS = 2;
const metalLoops = new Map(); // `${name}:${sampleRate}` -> AudioBuffer, or 'pending'

function prepareMetalLoops(sampleRate) {
    const Offline = typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
    if (!Offline) {
        return;
    }
    Object.entries(METALS).forEach(([name, { ratios, baseHz, maxFactor }]) => {
        const key = `${name}:${sampleRate}`;
        if (metalLoops.has(key)) {
            return;
        }
        metalLoops.set(key, 'pending');
        try {
            const offline = new Offline(1, Math.round(sampleRate * METAL_LOOP_SECONDS), sampleRate);
            const sum = offline.createGain();
            sum.gain.value = 1 / ratios.length;
            sum.connect(offline.destination);
            ratios.forEach((ratio) => {
                const osc = offline.createOscillator();
                osc.type = 'square';
                osc.frequency.value = Math.round(baseHz * maxFactor * ratio * METAL_LOOP_SECONDS) / METAL_LOOP_SECONDS;
                osc.connect(sum);
                osc.start(0);
            });
            offline.startRendering()
                .then((buffer) => metalLoops.set(key, buffer))
                .catch(() => metalLoops.delete(key));
        } catch {
            metalLoops.delete(key);
        }
    });
}

// factor: the Tone's multiple of the metal's base pitch.
function metal(ctx, when, duration, name, factor) {
    const { ratios, baseHz, maxFactor } = METALS[name];
    const loop = metalLoops.get(`${name}:${ctx.sampleRate}`);
    if (loop && loop !== 'pending') {
        const source = ctx.createBufferSource();
        source.buffer = loop;
        source.loop = true;
        source.playbackRate.value = factor / maxFactor;
        source.start(when);
        source.stop(when + duration);
        return source;
    }
    // The first moments of a new kit, before its loops are rendered.
    const sum = ctx.createGain();
    sum.gain.value = 1 / ratios.length;
    const oscillators = ratios.map((ratio) => {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = baseHz * factor * ratio;
        osc.connect(sum);
        osc.start(when);
        osc.stop(when + duration);
        return osc;
    });
    releaseWhenEnded(oscillators, [sum]);
    return sum;
}

// ── Voices ───────────────────────────────────────────────────────────────

function playKick(ctx, kit, when, volume, p) {
    const level = p('kickLevel') * volume;
    const base = 45 + p('kickTune') * 20; // 45–65 Hz
    const tau = 0.04 + p('kickDecay') * 0.22;
    const drive = p('kickDrive');
    const click = p('kickAttack');
    const length = 0.012 + tau * 7;

    // Body: a very fast drop for the hit, a slower settle into the fundamental.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(base * 9, when);
    osc.frequency.exponentialRampToValueAtTime(base * 2.5, when + 0.008);
    osc.frequency.exponentialRampToValueAtTime(base * 1.1, when + 0.06);
    osc.frequency.exponentialRampToValueAtTime(base, when + 0.25);
    osc.start(when);
    osc.stop(when + length);

    const shaper = ctx.createWaveShaper();
    shaper.curve = getDriveCurve(0.1 + drive * 0.8);
    shaper.oversample = '4x';

    const amp = ctx.createGain();
    const peak = level * 0.95 * (1 - drive * 0.2);
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(peak, when + 0.0015);
    amp.gain.setValueAtTime(peak, when + 0.012);
    amp.gain.setTargetAtTime(0, when + 0.012, tau);
    chain(osc, shaper, amp, kit.input);

    // Click: a few milliseconds of bright noise on the attack.
    if (click > 0.01) {
        chain(
            noiseSource(ctx, when, 0.03),
            filter(ctx, 'highpass', 1400),
            filter(ctx, 'lowpass', 9000),
            decayingGain(ctx, when, level * click * 0.55, 0.0025),
            kit.input,
        );
    }
}

function playSnare(ctx, kit, when, volume, p) {
    const level = p('snareLevel') * volume;
    const tune = 0.85 + p('snareTune') * 0.4;
    const snappy = p('snareSnappy');
    const decay = p('snareDecay');
    const tone = p('snareTone');

    [[185, 1], [330, 0.55]].forEach(([hz, mix]) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(hz * tune * 1.25, when);
        osc.frequency.setTargetAtTime(hz * tune, when, 0.012);
        osc.start(when);
        osc.stop(when + 0.4);
        chain(osc, decayingGain(ctx, when, level * mix * (0.75 - snappy * 0.3), 0.022 + decay * 0.05), kit.input);
    });

    const noiseTau = 0.035 + decay * 0.14;
    chain(
        noiseSource(ctx, when, noiseTau * 7),
        filter(ctx, 'highpass', 900),
        filter(ctx, 'lowpass', 3500 + tone * 9000),
        decayingGain(ctx, when, level * (0.3 + snappy * 0.6), noiseTau),
        kit.input,
    );
}

function playClap(ctx, kit, when, volume, p) {
    const level = p('clapLevel') * volume * 3.2;
    const tail = 0.03 + p('clapDecay') * 0.16;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    // Several hands, a hair apart, then the room.
    [0, 0.011, 0.022].forEach((offset) => {
        gain.gain.setValueAtTime(level, when + offset);
        gain.gain.setTargetAtTime(0, when + offset, 0.0035);
    });
    gain.gain.setValueAtTime(level, when + 0.033);
    gain.gain.setTargetAtTime(0, when + 0.033, tail);

    chain(
        noiseSource(ctx, when, 0.04 + tail * 7),
        filter(ctx, 'highpass', 500),
        filter(ctx, 'bandpass', 900 + p('clapTone') * 1100, 1.4),
        gain,
        kit.input,
    );
}

function playRim(ctx, kit, when, volume, p) {
    const level = p('rimLevel') * volume;
    const tune = 0.8 + p('rimTune') * 0.5;
    const tau = 0.008 + p('rimDecay') * 0.035;
    const out = filter(ctx, 'highpass', 300);
    out.connect(kit.input);

    const sources = [[480, 'triangle', 0.7], [1720, 'sine', 0.45]].map(([hz, type, mix]) => {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = hz * tune;
        osc.start(when);
        osc.stop(when + tau * 8);
        chain(osc, decayingGain(ctx, when, level * mix, tau), out);
        return osc;
    });
    const click = noiseSource(ctx, when, 0.02);
    chain(click, filter(ctx, 'bandpass', 4000, 1.2), decayingGain(ctx, when, level * 0.5, 0.002), out);
    releaseWhenEnded([...sources, click], [out]);
}

// One filter chain per metal voice and kit, shared by all its hits: the
// filters are linear, so filtering the sum sounds like filtering each hit,
// and a hit only adds its two sources and their envelopes. Per-hit filter
// chains (four for every hat, three ringing for seconds behind every ride)
// were most of what was left of the kit's CPU once the metal was a loop.
//   metal -> envelope -> band-pass ─┐
//   noise -> envelope -> high-pass -> level ─┴> bright high-pass (-> low-pass) -> kit
const METAL_BUS = {
    hat: { band: 10000, bandQ: 0.9, airHz: 8500, airLevel: 0.35, bright: 7000, lowpass: 15000 },
    openhat: { band: 10000, bandQ: 0.9, airHz: 8500, airLevel: 0.35, bright: 7000, lowpass: 15000 },
    ride: { band: 6500, bandQ: 1.6, airHz: 7500, airLevel: 0.35, bright: 4200 },
    crash: { band: 7500, bandQ: 0.7, airHz: 6000, airLevel: 0.6, bright: 3500 },
};

function metalBus(ctx, kit, voice) {
    kit.metalBuses = kit.metalBuses || {};
    let bus = kit.metalBuses[voice];
    if (!bus) {
        const spec = METAL_BUS[voice];
        const metalIn = ctx.createGain();
        const airIn = ctx.createGain();
        const band = filter(ctx, 'bandpass', spec.band, spec.bandQ);
        const airLevel = ctx.createGain();
        airLevel.gain.value = spec.airLevel;
        const bright = filter(ctx, 'highpass', spec.bright);
        chain(metalIn, band, bright);
        chain(airIn, filter(ctx, 'highpass', spec.airHz), airLevel, bright);
        chain(bright, ...(spec.lowpass ? [filter(ctx, 'lowpass', spec.lowpass)] : []), kit.input);
        bus = { metalIn, airIn, band, bright, bandHz: spec.band, brightHz: spec.bright };
        kit.metalBuses[voice] = bus;
    }
    return bus;
}

// Follows the Tone without piling an automation event onto every hit.
function setBusFilter(bus, key, hz, when) {
    if (bus[`${key}Hz`] !== hz) {
        bus[`${key}Hz`] = hz;
        bus[key].frequency.setValueAtTime(hz, when);
    }
}

// Metal + air into the hat's bus; returns the envelopes so they can be choked.
function playHat(ctx, kit, when, level, tone, tau, voice) {
    const length = tau * 8 + 0.02;
    const bus = metalBus(ctx, kit, voice);
    setBusFilter(bus, 'bright', 7000 + tone * 1500, when);
    const envelope = () => {
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(level, when + 0.0008);
        gain.gain.setTargetAtTime(0, when + 0.0008, tau);
        return gain;
    };
    const metalAmp = envelope();
    const airAmp = envelope();
    chain(metal(ctx, when, length, 'hat', 0.85 + tone * 0.5), metalAmp, bus.metalIn);
    chain(noiseSource(ctx, when, length), airAmp, bus.airIn);
    return [metalAmp, airAmp];
}

function chokeOpenHats(kit, when) {
    kit.openHats = kit.openHats.filter((voice) => {
        if (voice.until <= when) {
            return false;
        }
        if (voice.start > when) {
            return true;
        }
        voice.amps.forEach((amp) => {
            amp.gain.cancelScheduledValues(when);
            amp.gain.setTargetAtTime(0, when, 0.005);
        });
        return false;
    });
}

function playClosedHat(ctx, kit, when, volume, p) {
    chokeOpenHats(kit, when);
    playHat(ctx, kit, when, p('hatLevel') * volume * 1.7, p('hatTone'), 0.009 + p('hatDecay') * 0.04, 'hat');
}

function playOpenHat(ctx, kit, when, volume, p) {
    chokeOpenHats(kit, when);
    const tau = 0.06 + p('openhatDecay') * 0.32;
    const amps = playHat(ctx, kit, when, p('openhatLevel') * volume * 1.25, p('openhatTone'), tau, 'openhat');
    kit.openHats.push({ amps, start: when, until: when + tau * 8 });
}

function playRide(ctx, kit, when, volume, p) {
    const level = p('rideLevel') * volume;
    const tone = p('rideTone');
    const tau = 0.25 + p('rideDecay') * 0.9;
    const length = tau * 7;

    const bus = metalBus(ctx, kit, 'ride');
    setBusFilter(bus, 'band', 6500 + tone * 2500, when);
    chain(metal(ctx, when, length, 'ride', 0.85 + tone * 0.4), decayingGain(ctx, when, level * 1.5, tau), bus.metalIn);
    // The stick's air fades with its own 120 ms on top of the ride's decay:
    // two exponentials in a row make one with the rates added.
    chain(noiseSource(ctx, when, 0.6), decayingGain(ctx, when, level * 1.5, 1 / (1 / 0.12 + 1 / tau)), bus.airIn);

    // Bell: the stick hitting near the cup.
    const bellTau = tau * 0.6;
    [2950, 4100].forEach((hz) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = hz * (0.9 + tone * 0.2);
        osc.start(when);
        osc.stop(when + bellTau * 7);
        chain(osc, decayingGain(ctx, when, level * 0.1, bellTau), kit.input);
    });
}

function playTom(ctx, kit, when, volume, p, tom) {
    const level = p(`${tom}Level`) * volume * TOM_LEVEL;
    const base = TOM_BASE_HZ[tom] * (0.75 + p(`${tom}Tune`) * 0.6);
    const tau = 0.06 + p(`${tom}Decay`) * 0.3;
    const length = 0.02 + tau * 7;

    // Body: a quick drop onto the pitch, like a small kick.
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(base * 1.7, when);
    body.frequency.exponentialRampToValueAtTime(base * 1.05, when + 0.05);
    body.frequency.exponentialRampToValueAtTime(base, when + 0.25);
    body.start(when);
    body.stop(when + length);
    chain(body, decayingGain(ctx, when, level, tau), kit.input);

    // Skin: a quieter, shorter partial a fifth up.
    const skin = ctx.createOscillator();
    skin.type = 'triangle';
    skin.frequency.value = base * 1.5;
    skin.start(when);
    skin.stop(when + length);
    chain(skin, decayingGain(ctx, when, level * 0.25, tau * 0.5), kit.input);

    // Stick.
    chain(
        noiseSource(ctx, when, 0.03),
        filter(ctx, 'bandpass', 2500, 1),
        decayingGain(ctx, when, level * 0.3, 0.004),
        kit.input,
    );
}

function playCowbell(ctx, kit, when, volume, p) {
    const level = p('cowbellLevel') * volume * COWBELL_LEVEL;
    const tune = 0.8 + p('cowbellTune') * 0.4;
    const tail = 0.05 + p('cowbellDecay') * 0.35;
    const length = 0.05 + tail * 7;

    // A sharp clank that settles into a ringing tail.
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(level, when + 0.001);
    amp.gain.setTargetAtTime(level * 0.35, when + 0.001, 0.012);
    amp.gain.setTargetAtTime(0, when + 0.04, tail);
    const sum = ctx.createGain();
    sum.gain.value = 0.5;
    chain(sum, filter(ctx, 'bandpass', 900 * tune, 1.5), filter(ctx, 'highpass', 400), amp, kit.input);
    const oscillators = [540, 800].map((hz) => {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = hz * tune;
        osc.start(when);
        osc.stop(when + length);
        osc.connect(sum);
        return osc;
    });
    releaseWhenEnded(oscillators, [amp]);
}

function playShaker(ctx, kit, when, volume, p) {
    const level = p('shakerLevel') * volume * SHAKER_LEVEL;
    const tone = p('shakerTone');
    const tau = 0.012 + p('shakerDecay') * 0.05;
    const length = 0.01 + tau * 8;

    // The beads take a few milliseconds to all hit the shell.
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(level, when + 0.006);
    amp.gain.setTargetAtTime(0, when + 0.006, tau);
    chain(
        noiseSource(ctx, when, length),
        filter(ctx, 'highpass', 4000 + tone * 3000),
        filter(ctx, 'bandpass', 7000 + tone * 4000, 0.8),
        amp,
        kit.input,
    );
}

function playCrash(ctx, kit, when, volume, p) {
    const level = p('crashLevel') * volume * CRASH_LEVEL;
    const tone = p('crashTone');
    const tau = 0.4 + p('crashDecay') * 1.4;
    const length = tau * 6;

    const bus = metalBus(ctx, kit, 'crash');
    setBusFilter(bus, 'band', 7500 + tone * 3000, when);
    setBusFilter(bus, 'bright', 3500 + tone * 1500, when);
    chain(metal(ctx, when, length, 'crash', 0.85 + tone * 0.4), decayingGain(ctx, when, level, tau), bus.metalIn);
    // The wash: far more noise than a ride, fading a little faster than the
    // metal (its own 0.7 tau on top of the crash's decay, rates added).
    chain(noiseSource(ctx, when, length), decayingGain(ctx, when, level, 1 / (1 / (tau * 0.7) + 1 / tau)), bus.airIn);
}
