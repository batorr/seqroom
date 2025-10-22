// Audio-specific utility functions

// Noise buffer cache
let noiseBuffer = null;

// Note to frequency conversion
export function noteToFrequency(note) {
    if (typeof note !== 'string' || note.length < 2) {
        return 440;
    }

    const match = note.match(/^([A-G])(#|b)?(\d)$/i);
    if (!match) {
        return 440;
    }

    const [, letter, accidental, octaveStr] = match;
    const semitoneMap = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
    let semitone = semitoneMap[letter.toUpperCase()] ?? 0;
    if (accidental === '#') {
        semitone += 1;
    } else if (accidental === 'b') {
        semitone -= 1;
    }

    const octave = Number(octaveStr);
    const midiNote = 69 + semitone + (octave - 4) * 12;
    return 440 * Math.pow(2, (midiNote - 69) / 12);
}

// Create noise buffer for drum sounds
export function createNoiseBuffer(ctx) {
    if (noiseBuffer) {
        return noiseBuffer;
    }

    const buffer = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
        data[i] = Math.random() * 2 - 1;
    }
    noiseBuffer = buffer;
    return buffer;
}

// Base64 encoding/decoding for audio samples
export function base64ToArrayBuffer(base64) {
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

export function arrayBufferToBase64(buffer) {
    if (!(buffer instanceof ArrayBuffer)) {
        return '';
    }
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return window.btoa(binary);
}

// Create reversed audio buffer
export function createReversedAudioBuffer(ctx, buffer) {
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

// Recording utilities
export function mergeRecordingChunks(chunks, totalLength) {
    if (!Array.isArray(chunks) || !chunks.length) {
        return new Float32Array(0);
    }

    const finalLength = Number.isFinite(totalLength) && totalLength > 0
        ? Math.max(0, Math.floor(totalLength))
        : chunks.reduce((sum, chunk) => sum + chunk.length, 0);

    const result = new Float32Array(finalLength);
    let offset = 0;
    chunks.forEach((chunk) => {
        result.set(chunk, offset);
        offset += chunk.length;
    });
    return result;
}

export function encodeWavFromInterleaved(interleaved, channelCount, sampleRate) {
    const samples = interleaved.length;
    const bytesPerSample = 4;
    const safeChannelCount = Math.max(1, Math.floor(channelCount) || 1);
    const normalizedSampleRate = Math.max(1, Math.round(sampleRate));
    const blockAlign = safeChannelCount * bytesPerSample;
    const dataLength = samples * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 3, true);
    view.setUint16(22, safeChannelCount, true);
    view.setUint32(24, normalizedSampleRate, true);
    view.setUint32(28, normalizedSampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    let offset = 44;
    for (let i = 0; i < samples; i += 1) {
        const sample = Math.max(-1, Math.min(1, interleaved[i]));
        view.setFloat32(offset, sample, true);
        offset += bytesPerSample;
    }

    return buffer;
}

export function writeString(view, offset, text) {
    for (let i = 0; i < text.length; i += 1) {
        view.setUint8(offset + i, text.charCodeAt(i));
    }
}
