// Audio State Management Module
// Manages audio context, recording state, and sampler buffers

// Audio context and scheduling state
export const audioState = {
    context: null,
    masterGain: null,
    schedulerId: null,
    nextStepIndex: 0,
    lastStepDurationMs: null,
    isRecording: false,
    recordingNode: null,
    recordingChunks: [],
    recordingSampleRate: null,
    recordingContextSampleRate: null,
    recordingChannelCount: 0,
    recordingTotalSamples: 0,
    recordingFrameCount: 0,
    recordingByteLength: 0,
    recordingStatsLastUpdate: 0,
    recordingModuleLoaded: false,
    samplerBuffers: new Map(),
    pendingSamplerLoads: new Map(),
    mutedInstruments: new Set(),
};

// Socket-related state
export const socketState = {
    instrumentElements: new Map(),
    pendingRoomRequest: false,
    roomRequestTimeoutId: null,
    pendingRoomRequestMeta: null,
    pendingPings: new Map(),
    clockOffsetMs: 0,
    latencyEstimateMs: 0,
    hasSyncSample: false,
    suppressedInstrumentUpdates: new Map(),
    pendingInstrumentCreatorLabels: new Map(),
    pendingDefaultInstrumentLabel: null,
};

// Audio state mutations
export function setAudioContext(context) {
    audioState.context = context;
}

export function setMasterGain(gain) {
    audioState.masterGain = gain;
}

export function setSchedulerId(id) {
    audioState.schedulerId = id;
}

export function setNextStepIndex(index) {
    audioState.nextStepIndex = index;
}

export function setRecordingState(isRecording) {
    audioState.isRecording = Boolean(isRecording);
}

export function addRecordingChunk(chunk) {
    audioState.recordingChunks.push(chunk);
}

export function clearRecordingChunks() {
    audioState.recordingChunks = [];
}

export function setSamplerBuffer(key, buffer) {
    audioState.samplerBuffers.set(key, buffer);
}

export function deleteSamplerBuffer(key) {
    audioState.samplerBuffers.delete(key);
}

export function clearSamplerBuffers() {
    audioState.samplerBuffers.clear();
}

// Socket state mutations
export function setClockOffset(offsetMs) {
    socketState.clockOffsetMs = offsetMs;
}

export function setLatencyEstimate(latencyMs) {
    socketState.latencyEstimateMs = latencyMs;
}

export function setHasSyncSample(hasSample) {
    socketState.hasSyncSample = Boolean(hasSample);
}

export function clearPendingPings() {
    socketState.pendingPings.clear();
}

export function setPendingRoomRequest(pending) {
    socketState.pendingRoomRequest = Boolean(pending);
}
