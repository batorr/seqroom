// Audio graph: the mix bus every instrument plays into.
//
//   instruments ─┬───────────────────► input ─► glue ─► limiter ─► clipper ─► output ─► speakers
//                ├─► delay send ─► dotted-eighth delay ──┘ (filtered feedback)
//                └─► reverb send ─► convolution room ────┘
//
// The glue compressor gently ties drums and bass together, the limiter keeps
// a full mix down, and a soft clipper catches the few transients the limiter
// is too slow for, so nothing ever goes over full scale. The delay follows the tempo (3/16 = a dotted
// eighth, the classic acid echo). Built per AudioContext, so an
// OfflineAudioContext can render through exactly the same chain.

const graphs = new WeakMap();

const DELAY_BEATS = 0.75;
const REVERB_SECONDS = 1.9;

export function createAudioGraph(ctx, destination = ctx.destination) {
    const input = ctx.createGain();
    input.gain.value = 0.62;

    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    glue.knee.value = 6;
    glue.ratio.value = 3;
    glue.attack.value = 0.01;
    glue.release.value = 0.15;

    const makeup = ctx.createGain();
    makeup.gain.value = 1.3;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.06;

    // The shaper only accepts -1..1, so it works on half the signal level.
    const clipIn = ctx.createGain();
    clipIn.gain.value = 0.5;
    const clipper = ctx.createWaveShaper();
    clipper.curve = createCeilingCurve();
    // No oversampling here: its anti-alias filter rings, and that ringing
    // would poke above the ceiling this stage exists to enforce.
    clipper.oversample = 'none';

    const output = ctx.createGain();
    output.gain.value = 2;
    input.connect(glue);
    glue.connect(makeup);
    makeup.connect(limiter);
    limiter.connect(clipIn);
    clipIn.connect(clipper);
    clipper.connect(output);
    output.connect(destination);

    // Delay: each repeat gets darker and thinner, like a tape echo.
    const delaySend = ctx.createGain();
    const delayHighpass = ctx.createBiquadFilter();
    delayHighpass.type = 'highpass';
    delayHighpass.frequency.value = 250;
    const delay = ctx.createDelay(2);
    delay.delayTime.value = (60 / 120) * DELAY_BEATS;
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 3200;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.42;
    const delayReturn = ctx.createGain();
    delayReturn.gain.value = 0.6;
    delaySend.connect(delayHighpass);
    delayHighpass.connect(delay);
    delay.connect(delayTone);
    delayTone.connect(feedback);
    feedback.connect(delay);
    delayTone.connect(delayReturn);
    delayReturn.connect(input);

    // Reverb: a generated room; lows are kept out so the kick stays tight.
    const reverbSend = ctx.createGain();
    const reverbHighpass = ctx.createBiquadFilter();
    reverbHighpass.type = 'highpass';
    reverbHighpass.frequency.value = 220;
    const convolver = ctx.createConvolver();
    convolver.buffer = createRoomImpulse(ctx, REVERB_SECONDS);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.5;
    reverbSend.connect(reverbHighpass);
    reverbHighpass.connect(convolver);
    convolver.connect(reverbReturn);
    reverbReturn.connect(input);

    let delayBpm = 120;
    const graph = {
        ctx,
        input,
        output,
        delaySend,
        reverbSend,
        setTempo(bpm) {
            if (!Number.isFinite(bpm) || bpm <= 0 || Math.abs(bpm - delayBpm) < 0.01) {
                return;
            }
            delayBpm = bpm;
            delay.delayTime.setTargetAtTime((60 / bpm) * DELAY_BEATS, ctx.currentTime, 0.05);
        },
    };
    graphs.set(ctx, graph);
    return graph;
}

export function getAudioGraph(ctx) {
    return graphs.get(ctx) || null;
}

// Connects a voice's output to the mix, plus optional delay/reverb sends
// (0..1). The send gains are released with the voice once it stops.
export function routeVoice(ctx, node, { delay = 0, reverb = 0 } = {}) {
    const graph = graphs.get(ctx);
    if (!graph) {
        return;
    }
    node.connect(graph.input);
    if (delay > 0.001) {
        const send = ctx.createGain();
        send.gain.value = delay;
        node.connect(send);
        send.connect(graph.delaySend);
    }
    if (reverb > 0.001) {
        const send = ctx.createGain();
        send.gain.value = reverb;
        node.connect(send);
        send.connect(graph.reverbSend);
    }
}

// Exponentially decaying stereo noise, darkening as it decays, after a short
// pre-delay: a plain but smooth room.
function createRoomImpulse(ctx, seconds) {
    const rate = ctx.sampleRate;
    const preDelay = Math.round(rate * 0.012);
    const length = Math.round(rate * seconds) + preDelay;
    const impulse = ctx.createBuffer(2, length, rate);
    const decayRate = 6.9 / seconds; // -60 dB at the end
    for (let channel = 0; channel < 2; channel += 1) {
        const data = impulse.getChannelData(channel);
        let lowpassed = 0;
        for (let i = preDelay; i < length; i += 1) {
            const t = (i - preDelay) / rate;
            // One-pole lowpass whose cutoff falls from ~9 kHz to ~2 kHz.
            const cutoff = 9000 * Math.exp(-t * 0.8) + 2000;
            const coefficient = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
            lowpassed += coefficient * ((Math.random() * 2 - 1) - lowpassed);
            data[i] = lowpassed * Math.exp(-t * decayRate);
        }
    }
    return impulse;
}

// Linear up to -2 dBFS, then bends smoothly into a -0.2 dBFS ceiling. Built
// for half-level input (see clipIn/output above): u in -1..1 stands for 2u.
function createCeilingCurve() {
    const size = 4096;
    const knee = 0.8;
    const ceiling = 0.98;
    const curve = new Float32Array(size);
    for (let i = 0; i < size; i += 1) {
        const x = ((i / (size - 1)) * 2 - 1) * 2;
        const magnitude = Math.abs(x);
        const y = magnitude <= knee
            ? magnitude
            : knee + (ceiling - knee) * Math.tanh((magnitude - knee) / (ceiling - knee));
        curve[i] = (Math.sign(x) * y) / 2;
    }
    return curve;
}

// tanh soft clipping, normalised so a full-scale input stays at full scale.
const curveCache = new Map();

export function getDriveCurve(amount) {
    const k = Math.round(amount * 100) / 100;
    if (k <= 0) {
        return null;
    }
    if (curveCache.has(k)) {
        return curveCache.get(k);
    }
    const size = 2048;
    const curve = new Float32Array(size);
    const gain = 1 + k * 10;
    const norm = Math.tanh(gain);
    for (let i = 0; i < size; i += 1) {
        const x = (i / (size - 1)) * 2 - 1;
        curve[i] = Math.tanh(gain * x) / norm;
    }
    curveCache.set(k, curve);
    return curve;
}
