// Recording Module
// Audio recording and WAV export functionality

import { audioState } from '../state/audio.js';
import { RECORDING_STATS_UPDATE_INTERVAL_MS } from '../constants/audio.js';
import { ensureAudioContext } from './main.js';
import { recordingStatusEl } from '../ui/main.js';

// Check if recording is supported
export function isRecordingSupported() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    return typeof window.AudioWorkletNode === 'function' && typeof AudioContextCtor === 'function';
}

// Toggle recording on/off
export async function toggleRecording() {
    if (audioState.isRecording) {
        stopRecording();
        return;
    }
    await startRecording();
}

// Start recording
export async function startRecording() {
    if (audioState.isRecording) {
        return;
    }

    if (!isRecordingSupported()) {
        window.alert('Recording is not supported in this browser.');
        return;
    }

    const ctx = ensureAudioContext();
    if (!ctx || !audioState.masterGain) {
        window.alert('Audio engine is not ready yet.');
        return;
    }

    try {
        await ensureRecordingWorklet(ctx);
    } catch (error) {
        console.error('Failed to load recording module:', error);
        window.alert('Unable to initialize recording.');
        return;
    }

    audioState.recordingChunks = [];
    audioState.recordingChannelCount = 0;
    audioState.recordingSampleRate = null;
    audioState.recordingContextSampleRate = ctx.sampleRate;
    audioState.recordingTotalSamples = 0;
    audioState.recordingFrameCount = 0;
    audioState.recordingByteLength = 0;
    audioState.recordingStatsLastUpdate = 0;

    let recorderNode;
    const channelCount = ctx.destination?.channelCount || 2;

    try {
        recorderNode = new AudioWorkletNode(ctx, 'seqroom-recorder', {
            numberOfInputs: 1,
            numberOfOutputs: 0,
            channelCount,
            channelCountMode: 'explicit',
            channelInterpretation: 'speakers',
        });
    } catch (error) {
        console.error('Failed to create recording node:', error);
        window.alert('Unable to start recording.');
        return;
    }

    recorderNode.port.onmessage = handleRecordingMessage;
    recorderNode.port.onmessageerror = (event) => {
        console.error('Recording port error:', event);
    };
    recorderNode.onprocessorerror = (error) => {
        console.error('Recording processor error:', error);
        stopRecording();
    };

    try {
        audioState.masterGain.connect(recorderNode);
    } catch (error) {
        console.error('Failed to connect recording node:', error);
        recorderNode.port.onmessage = null;
        recorderNode.port.onmessageerror = null;
        recorderNode.onprocessorerror = null;
        window.alert('Unable to start recording.');
        return;
    }

    audioState.recordingNode = recorderNode;
    audioState.isRecording = true;
    updateRecordButton(true);
    updateRecordingStatsDisplay();
}

// Stop recording
export function stopRecording(options = {}) {
    const { download = true } = options;
    const recorderNode = audioState.recordingNode;
    const wasRecording = audioState.isRecording;

    if (recorderNode) {
        try {
            audioState.masterGain?.disconnect(recorderNode);
        } catch (error) {
            console.warn('Failed to disconnect recording node:', error);
        }
        recorderNode.port.onmessage = null;
        recorderNode.port.onmessageerror = null;
        recorderNode.onprocessorerror = null;
    }

    audioState.recordingNode = null;
    audioState.isRecording = false;
    updateRecordButton(false);

    if (!wasRecording) {
        clearRecordingData();
        return;
    }

    const chunks = audioState.recordingChunks.slice();
    const totalSamples = audioState.recordingTotalSamples;
    const channelCount = Math.max(1, audioState.recordingChannelCount || 1);
    const sampleRate = audioState.recordingSampleRate
        ?? audioState.recordingContextSampleRate
        ?? 48000;

    clearRecordingData();

    if (!download) {
        return;
    }

    if (!chunks.length || !Number.isFinite(totalSamples) || totalSamples <= 0) {
        return;
    }

    const interleaved = mergeRecordingChunks(chunks, totalSamples);
    const wavBuffer = encodeWavFromInterleaved(interleaved, channelCount, sampleRate);
    const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
    downloadBlob(wavBlob, 'seqroom_recording.wav');
}

// Ensure recording worklet is loaded
async function ensureRecordingWorklet(ctx) {
    if (audioState.recordingModuleLoaded) {
        return;
    }
    if (!ctx.audioWorklet) {
        throw new Error('AudioWorklet not available on this AudioContext.');
    }
    await ctx.audioWorklet.addModule('/recording-processor.js');
    audioState.recordingModuleLoaded = true;
}

// Handle recording messages
export function handleRecordingMessage(event) {
    const message = event.data;
    if (!message || typeof message !== 'object') {
        return;
    }

    if (message.type === 'ready' && typeof message.sampleRate === 'number') {
        audioState.recordingSampleRate = message.sampleRate;
        updateRecordingStatsDisplay();
        return;
    }

    if (message.type === 'data' && message.buffer instanceof ArrayBuffer) {
        const chunk = new Float32Array(message.buffer);

        if (message.channelCount && message.channelCount > 0) {
            if (!audioState.recordingChannelCount) {
                audioState.recordingChannelCount = message.channelCount;
            } else if (audioState.recordingChannelCount !== message.channelCount) {
                console.warn(
                    'Recording channel count changed:',
                    audioState.recordingChannelCount,
                    '→',
                    message.channelCount,
                );
                audioState.recordingChannelCount = message.channelCount;
            }
        }

        audioState.recordingChunks.push(chunk);
        audioState.recordingTotalSamples += chunk.length;
        audioState.recordingByteLength += chunk.byteLength;

        const channelCount = Math.max(1, audioState.recordingChannelCount || message.channelCount || 1);
        if (channelCount > 0) {
            audioState.recordingFrameCount += chunk.length / channelCount;
        }

        maybeUpdateRecordingStatsDisplay();
    }
}

// Clear recording data
export function clearRecordingData() {
    audioState.recordingChunks = [];
    audioState.recordingTotalSamples = 0;
    audioState.recordingByteLength = 0;
    audioState.recordingFrameCount = 0;
    audioState.recordingChannelCount = 0;
    audioState.recordingSampleRate = null;
    audioState.recordingContextSampleRate = null;
    audioState.recordingStatsLastUpdate = 0;
    updateRecordingStatsDisplay();
}

// Update recording stats display
export function updateRecordingStatsDisplay() {
    if (!recordingStatusEl) {
        return;
    }

    if (!audioState.isRecording) {
        recordingStatusEl.textContent = '';
        recordingStatusEl.classList.add('hidden');
        return;
    }

    const channelCount = Math.max(1, audioState.recordingChannelCount || 1);
    const sampleRate = audioState.recordingSampleRate
        ?? audioState.recordingContextSampleRate
        ?? audioState.context?.sampleRate
        ?? 48000;
    const frames = audioState.recordingFrameCount
        || (channelCount > 0 ? audioState.recordingTotalSamples / channelCount : 0);
    const durationSeconds = frames / sampleRate;
    const totalBytes = audioState.recordingByteLength + 44;

    recordingStatusEl.textContent = `Recording ${formatDuration(durationSeconds)} • ${formatBytes(totalBytes)}`;
    recordingStatusEl.classList.remove('hidden');
}

// Maybe update recording stats display (throttled)
export function maybeUpdateRecordingStatsDisplay() {
    if (!audioState.isRecording) {
        return;
    }
    const now = performance.now();
    if (!audioState.recordingStatsLastUpdate || now - audioState.recordingStatsLastUpdate >= RECORDING_STATS_UPDATE_INTERVAL_MS) {
        audioState.recordingStatsLastUpdate = now;
        updateRecordingStatsDisplay();
    }
}

// Update record button state
export function updateRecordButton(isRecording) {
    import('../ui/main.js').then(({ recordToggleBtn }) => {
        if (!recordToggleBtn) {
            return;
        }

        recordToggleBtn.classList.toggle('recording', Boolean(isRecording));
        recordToggleBtn.textContent = Boolean(isRecording) ? '● REC' : 'REC';
        if (typeof recordToggleBtn.disabled === 'boolean') {
            recordToggleBtn.disabled = !isRecordingSupported();
        }
    });
}

// Format duration as MM:SS
function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return '00:00';
    }
    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Format bytes
function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    const precision = unitIndex === 0 ? 0 : 1;
    return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

// Merge recording chunks
function mergeRecordingChunks(chunks, totalLength) {
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

// Encode WAV from interleaved data
function encodeWavFromInterleaved(interleaved, channelCount, sampleRate) {
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

// Write string to DataView
function writeString(view, offset, text) {
    for (let i = 0; i < text.length; i += 1) {
        view.setUint8(offset + i, text.charCodeAt(i));
    }
}

// Download blob
export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
