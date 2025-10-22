// Socket.IO Communication Module
// WebSocket event handling and room management

import { state, hydrateState, normalizeInstrument } from '../state/main.js';
import { socketState } from '../state/audio.js';
import { SynthTypes } from '../constants/instruments.js';
import { clampTempo, generateRoomId, normalizeRoomId } from '../utils/helpers.js';
import { renderTransport, renderInstruments, updateConnectionsDisplay, showSequencer, showLanding, showRoomCodeHint, roomDisplayEl } from '../ui/main.js';
import { renderInstrument, removeInstrumentCard, renderEmptyState, setActiveInstrument, updateActiveInstrumentHighlight } from '../ui/instrument-card.js';
import { updateTempoDisplay } from '../ui/tempo-controls.js';
import { syncAudioScheduler, stopAudioScheduler } from '../audio/scheduler.js';
import { ensureAudioContext, applyClockCorrection, getClientAbsoluteTime } from '../audio/main.js';
import { prepareSamplerAudio, cleanupSamplerBuffers } from '../audio/instruments/sampler.js';

// Initialize Socket.IO
export const socket = io({ autoConnect: false });

// Setup socket event listeners
export function setupSocketEvents() {
    socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
    });

    socket.on('state:init', (payload) => {
        hydrateState(payload);
        renderTransport();
        renderInstruments();
        updateConnectionsDisplay(payload.connections ?? 0);
        syncAudioScheduler();
        roomDisplayEl.textContent = `Room: ${state.roomId ?? '—'}`;
    });

    socket.on('transport:update', (transport) => {
        state.transport = {
            bpm: clampTempo(transport.bpm ?? state.transport.bpm),
            playing: Boolean(transport.playing),
            sessionStartTime: transport.sessionStartTime ?? null,
            lastScheduledStart: transport.lastScheduledStart ?? null,
        };
        renderTransport();
        syncAudioScheduler();
    });

    socket.on('tempo:update', (tempo) => {
        // Legacy clients still rely on this event. Keep transport in sync.
        state.transport.bpm = clampTempo(tempo);
        renderTransport();
        syncAudioScheduler();
    });

    socket.on('instrument:added', (instrument) => {
        const normalized = normalizeInstrument(instrument);
        state.instruments.set(normalized.id, normalized);
        prepareSamplerAudio(normalized);
        if (!state.instrumentOrder.includes(normalized.id)) {
            state.instrumentOrder.push(normalized.id);
        }
        renderInstruments();
        setActiveInstrument(normalized.id);
    });

    socket.on('instrument:update', (instrument) => {
        const normalized = normalizeInstrument(instrument);
        state.instruments.set(normalized.id, normalized);
        prepareSamplerAudio(normalized);
        renderInstrument(normalized.id);
    });

    socket.on('instrument:removed', ({ instrumentId }) => {
        cleanupSamplerBuffers(instrumentId);
        state.instruments.delete(instrumentId);
        state.instrumentOrder = state.instrumentOrder.filter((id) => id !== instrumentId);
        const wasActive = state.activeInstrumentId === instrumentId;
        removeInstrumentCard(instrumentId);
        renderEmptyState();
        if (wasActive) {
            const nextActive = state.instrumentOrder[0] || null;
            setActiveInstrument(nextActive);
        } else {
            updateActiveInstrumentHighlight();
        }
    });

    socket.on('instrument:order', (order = []) => {
        state.instrumentOrder = order.filter((id) => state.instruments.has(id));
        if (state.activeInstrumentId && !state.instrumentOrder.includes(state.activeInstrumentId)) {
            const nextActive = state.instrumentOrder[0] || null;
            state.activeInstrumentId = nextActive;
        }
        renderInstruments();
    });

    socket.on('time:ping', ({ id }) => {
        if (typeof id !== 'number') {
            return;
        }

        const clientNow = getClientAbsoluteTime();
        socketState.pendingPings.set(id, { clientSendTime: clientNow });

        if (socketState.pendingPings.size > 32) {
            const [oldest] = socketState.pendingPings.keys();
            socketState.pendingPings.delete(oldest);
        }

        socket.emit('time:pong', {
            id,
            clientSendTime: clientNow,
        });
    });

    socket.on('time:sync', ({ id, serverReceiveTime, serverResponseTime }) => {
        if (!socketState.pendingPings.has(id)) {
            return;
        }

        const pending = socketState.pendingPings.get(id);
        socketState.pendingPings.delete(id);

        const clientSendTime = pending.clientSendTime;
        const clientReceiveTime = getClientAbsoluteTime();

        if (!Number.isFinite(serverReceiveTime) || !Number.isFinite(serverResponseTime)) {
            return;
        }

        const offsetSample = ((serverReceiveTime - clientSendTime) + (serverResponseTime - clientReceiveTime)) / 2;
        const delaySample = Math.max(0, (clientReceiveTime - clientSendTime) - (serverResponseTime - serverReceiveTime));

        applyClockCorrection(offsetSample, delaySample);
    });

    socket.on('connections:update', (count) => updateConnectionsDisplay(count));

    socket.on('step:update', ({ index, active }) => {
        // Legacy support: map to active instrument if available.
        const targetInstrumentId = state.activeInstrumentId || state.instrumentOrder[0];
        if (!targetInstrumentId) {
            return;
        }
        const instrument = state.instruments.get(targetInstrumentId);
        if (!instrument || instrument.type === SynthTypes.TR808 || index < 0 || index >= instrument.steps.length) {
            return;
        }
        instrument.steps[index].active = Boolean(active);
        renderInstrument(targetInstrumentId);
    });
}

// Setup room control event listeners
export function setupRoomControls(createRoomBtn, joinRoomBtn, leaveRoomBtn) {
    createRoomBtn.addEventListener('click', () => {
        ensureAudioContext();
        const roomId = generateRoomId();
        showRoomCodeHint(roomId);
        connectToRoom(roomId, { mode: 'create' });
    });

    joinRoomBtn.addEventListener('click', () => {
        ensureAudioContext();
        const input = window.prompt('Enter room code:');
        if (!input) {
            return;
        }

        const normalized = normalizeRoomId(input);
        if (!normalized) {
            window.alert('Room codes use letters, numbers, - or _. Try again.');
            return;
        }

        connectToRoom(normalized, { mode: 'join' });
    });

    leaveRoomBtn.addEventListener('click', () => leaveRoom());
}

// Setup transport control event listeners
export function setupTransportControls(transportToggleBtn, addSynthBtn) {
    transportToggleBtn.addEventListener('click', () => {
        if (!state.isInRoom) {
            return;
        }

        ensureAudioContext();
        if (state.transport.playing) {
            socket.emit('transport:stop');
        } else {
            socket.emit('transport:play');
        }
    });

    addSynthBtn.addEventListener('click', () => {
        if (!state.isInRoom) {
            window.alert('Join a room before adding instruments.');
            return;
        }

        import('../ui/main.js').then(({ openSynthModal }) => {
            openSynthModal();
        });
    });
}

// Setup recording controls
export function setupRecordingControls(recordToggleBtn) {
    if (!recordToggleBtn) {
        return;
    }

    import('../audio/recording.js').then(({ isRecordingSupported, toggleRecording, updateRecordButton, updateRecordingStatsDisplay }) => {
        updateRecordingStatsDisplay();

        if (!isRecordingSupported()) {
            recordToggleBtn.disabled = true;
            recordToggleBtn.title = 'Recording is not supported in this browser.';
            return;
        }

        recordToggleBtn.addEventListener('click', () => {
            toggleRecording().catch((error) => {
                console.error('Failed to toggle recording:', error);
                import('../state/audio.js').then(({ audioState }) => {
                    audioState.isRecording = false;
                    updateRecordButton(false);
                });
                window.alert('Unable to control recording. Check the console for details.');
            });
        });

        updateRecordButton(false);
    });
}

// Connect to a room
export function connectToRoom(roomId, { mode }) {
    if (socketState.pendingRoomRequest) {
        return;
    }
    socketState.pendingRoomRequest = true;

    state.isInRoom = false;
    state.roomId = null;
    state.instruments.clear();
    state.instrumentOrder = [];
    state.activeInstrumentId = null;
    renderInstruments();
    updateConnectionsDisplay(0);

    if (!socket.connected) {
        socket.connect();
    }

    const eventName = mode === 'create' ? 'room:create' : 'room:join';
    socket.emit(eventName, { roomId }, (response = {}) => {
        socketState.pendingRoomRequest = false;

        if (!response.ok) {
            handleRoomError(mode, response.error);
            return;
        }

        state.isInRoom = true;
        state.roomId = response.roomId || roomId;
        showSequencer();
        roomDisplayEl.textContent = `Room: ${state.roomId}`;
        import('../ui/main.js').then(({ transportToggleBtn }) => {
            transportToggleBtn.disabled = false;
        });
        updateTempoDisplay(state.transport.bpm);
    });
}

// Handle room connection errors
export function handleRoomError(mode, errorCode) {
    if (mode === 'create' && errorCode === 'room-already-exists') {
        window.alert('Room already exists. Try generating a new code.');
    } else if (mode === 'join' && errorCode === 'room-not-found') {
        window.alert('Could not find that room. Check the code and try again.');
    } else if (errorCode === 'invalid-room-id') {
        window.alert('Room code is invalid.');
    } else if (errorCode) {
        window.alert(`Unable to connect: ${errorCode}`);
    } else {
        window.alert('Unable to connect to that room.');
    }
    showLanding();
    showRoomCodeHint('');
}

// Leave current room
export function leaveRoom() {
    if (!state.isInRoom) {
        showLanding();
        return;
    }

    socket.emit('room:leave');
    socket.disconnect();

    state.isInRoom = false;
    state.roomId = null;
    state.instruments.clear();
    state.instrumentOrder = [];
    state.activeInstrumentId = null;

    socketState.pendingPings.clear();
    socketState.clockOffsetMs = 0;
    socketState.latencyEstimateMs = 0;
    socketState.hasSyncSample = false;

    stopAudioScheduler();
    renderInstruments();
    showLanding();
}
