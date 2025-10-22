// Sampler Module
// Sample playback and management

import { audioState } from '../../state/audio.js';
import { SAMPLER_SLOT_IDS, SynthTypes } from '../../constants/instruments.js';
import { clampValue } from '../../utils/helpers.js';
import { ensureAudioContext } from '../main.js';

// Generate sampler slot cache key
export function samplerSlotKey(instrumentId, slotId) {
    return `${instrumentId}:${slotId}`;
}

// Schedule sampler playback
export function scheduleSampler(instrument, step, when, ctx) {
    const slotParamsMap = instrument.params?.slots || {};
    const stepSlots = step.slots || {};

    SAMPLER_SLOT_IDS.forEach((slotId) => {
        if (!stepSlots[slotId]) {
            return;
        }

        const slotParams = slotParamsMap[slotId];
        if (!slotParams || slotParams.mute) {
            return;
        }

        const cacheEntry = audioState.samplerBuffers.get(samplerSlotKey(instrument.id, slotId));
        if (!cacheEntry || !cacheEntry.buffer) {
            return;
        }

        const buffer = slotParams.reverse && cacheEntry.reversedBuffer ? cacheEntry.reversedBuffer : cacheEntry.buffer;
        const sampleDuration = buffer.duration;
        if (!Number.isFinite(sampleDuration) || sampleDuration <= 0) {
            return;
        }

        const startOffset = clampValue(slotParams.startOffset ?? 0, 0, 0.99);
        const endOffset = clampValue(slotParams.endOffset ?? 1, 0.01, 1);
        if (endOffset <= startOffset) {
            return;
        }

        const segmentLength = Math.max(0.01, sampleDuration * (endOffset - startOffset));
        const offsetSeconds = slotParams.reverse && cacheEntry.reversedBuffer
            ? Math.max(0, sampleDuration * (1 - endOffset))
            : sampleDuration * startOffset;
        const availableDuration = Math.max(0.01, sampleDuration - offsetSeconds);
        const playbackDuration = Math.min(segmentLength, availableDuration);
        if (!Number.isFinite(playbackDuration) || playbackDuration <= 0) {
            return;
        }

        const playbackRate = Math.pow(2, clampValue(slotParams.pitch ?? 0, -24, 24) / 12);
        const volume = clampValue(slotParams.volume ?? 1, 0, 1);
        const panValue = clampValue(slotParams.pan ?? 0, -1, 1);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.setValueAtTime(playbackRate, when);

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(volume, when);

        source.connect(gainNode);

        if (typeof ctx.createStereoPanner === 'function') {
            const panner = ctx.createStereoPanner();
            panner.pan.setValueAtTime(panValue, when);
            gainNode.connect(panner);
            panner.connect(audioState.masterGain);
        } else {
            gainNode.connect(audioState.masterGain);
        }

        const startTime = Math.max(0, offsetSeconds);
        const duration = Math.max(0.01, playbackDuration);
        source.start(when, startTime, duration);
    });
}

// Prepare sampler audio for an instrument
export function prepareSamplerAudio(instrument) {
    if (!instrument || instrument.type !== SynthTypes.SAMPLER) {
        return;
    }
    const ctx = ensureAudioContext();
    if (!ctx) {
        return;
    }
    const slots = instrument.params?.slots || {};
    SAMPLER_SLOT_IDS.forEach((slotId) => {
        const slot = slots[slotId];
        const key = samplerSlotKey(instrument.id, slotId);
        if (!slot || !slot.sample) {
            audioState.samplerBuffers.delete(key);
            audioState.pendingSamplerLoads.delete(key);
            return;
        }
        const cached = audioState.samplerBuffers.get(key);
        if (cached && cached.meta && cached.meta.data === slot.sample.data && cached.meta.updatedAt === slot.sample.updatedAt) {
            return;
        }
        loadSamplerSlotSample(ctx, instrument.id, slotId, slot.sample);
    });
}

// Load a sampler slot sample
export function loadSamplerSlotSample(ctx, instrumentId, slotId, sample) {
    if (!sample || typeof sample !== 'object' || typeof sample.data !== 'string') {
        return;
    }
    const arrayBuffer = base64ToArrayBuffer(sample.data);
    if (!arrayBuffer) {
        console.warn('Sampler: unable to decode audio data.');
        return;
    }
    const key = samplerSlotKey(instrumentId, slotId);
    const version = `${sample.updatedAt || Date.now()}:${sample.data.length}`;
    audioState.pendingSamplerLoads.set(key, version);

    ctx.decodeAudioData(arrayBuffer.slice(0)).then((audioBuffer) => {
        if (audioState.pendingSamplerLoads.get(key) !== version) {
            return;
        }
        const reversedBuffer = createReversedAudioBuffer(ctx, audioBuffer);
        audioState.samplerBuffers.set(key, {
            buffer: audioBuffer,
            reversedBuffer,
            meta: { ...sample },
        });
        audioState.pendingSamplerLoads.delete(key);
    }).catch((error) => {
        if (audioState.pendingSamplerLoads.get(key) === version) {
            audioState.pendingSamplerLoads.delete(key);
        }
        console.error('Sampler: failed to decode sample', error);
    });
}

// Convert base64 to ArrayBuffer
function base64ToArrayBuffer(base64) {
    if (typeof base64 !== 'string' || !base64.length) {
        return null;
    }
    try {
        const binary = window.atob(base64);
        const length = binary.length;
        const bytes = new Uint8Array(length);
        for (let index = 0; index < length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes.buffer;
    } catch (error) {
        console.error('Sampler: invalid base64 audio data', error);
        return null;
    }
}

// Create reversed audio buffer
function createReversedAudioBuffer(ctx, buffer) {
    const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const source = buffer.getChannelData(channel);
        const target = reversed.getChannelData(channel);
        const lastIndex = source.length - 1;
        for (let i = 0; i < source.length; i += 1) {
            target[i] = source[lastIndex - i];
        }
    }
    return reversed;
}

// Cleanup sampler buffers for an instrument
export function cleanupSamplerBuffers(instrumentId) {
    const prefix = `${instrumentId}:`;
    Array.from(audioState.samplerBuffers.keys()).forEach((key) => {
        if (key.startsWith(prefix)) {
            audioState.samplerBuffers.delete(key);
        }
    });
    Array.from(audioState.pendingSamplerLoads.keys()).forEach((key) => {
        if (key.startsWith(prefix)) {
            audioState.pendingSamplerLoads.delete(key);
        }
    });
}
