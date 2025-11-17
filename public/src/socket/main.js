// Socket.IO Communication Module
// WebSocket event handling and room management

import {
    state,
    hydrateState,
    normalizeInstrument,
    setInstrumentLockedBy,
    getDisplayNameOrDefault
} from '../state/main.js';
import { socketState } from '../state/audio.js';
import { SynthTypes } from '../constants/instruments.js';
import { clampTempo } from '../utils/helpers.js';
import {
    renderTransport,
    renderInstruments,
    updateConnectionsDisplay,
    showSequencer,
    showLanding,
    showRoomCodeHint,
    updateRoomDisplay,
    inviteRoomBtn,
    showInviteLink,
} from '../ui/main.js';
import { renderInstrument, removeInstrumentCard, renderEmptyState, setActiveInstrument, updateActiveInstrumentHighlight } from '../ui/instrument-card.js';
import { updateTempoDisplay } from '../ui/tempo-controls.js';
import { syncAudioScheduler, stopAudioScheduler } from '../audio/scheduler.js';
import { ensureAudioContext, applyClockCorrection, getClientAbsoluteTime } from '../audio/main.js';
import { prepareSamplerAudio, cleanupSamplerBuffers } from '../audio/instruments/sampler.js';

// Initialize Socket.IO
export const socket = io({ autoConnect: false });

const ROOM_REQUEST_TIMEOUT_MS = 8000;
let inviteLinkAutoJoinAttempted = false;

function clearRoomRequestTimer() {
    if (socketState.roomRequestTimeoutId) {
        clearTimeout(socketState.roomRequestTimeoutId);
        socketState.roomRequestTimeoutId = null;
    }
}

function resetPendingRoomRequestState() {
    clearRoomRequestTimer();
    socketState.pendingRoomRequest = false;
    socketState.pendingRoomRequestMeta = null;
}

function failPendingRoomRequest(errorCode) {
    const metadata = socketState.pendingRoomRequestMeta;
    resetPendingRoomRequestState();
    socketState.pendingInstrumentCreatorLabels.clear();
    socketState.pendingDefaultInstrumentLabel = null;
    if (metadata && metadata.mode) {
        handleRoomError(metadata.mode, errorCode);
    } else if (errorCode) {
        window.alert(`Unable to connect: ${errorCode}`);
        showLanding();
        showRoomCodeHint('');
    }
}

// Setup socket event listeners
export function setupSocketEvents() {
    socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        if (socketState.pendingRoomRequest) {
            failPendingRoomRequest('connection-error');
        }
    });

    socket.on('disconnect', () => {
        resetPendingRoomRequestState();
        socketState.pendingInstrumentCreatorLabels.clear();
        socketState.pendingDefaultInstrumentLabel = null;
    });

    socket.on('state:init', (payload) => {
        hydrateState(payload);
        state.roomSlug = payload.roomSlug || payload.slug || state.roomSlug || null;
        state.membershipRole = payload.role || state.membershipRole || 'guest';
        if (socketState.pendingDefaultInstrumentLabel) {
            const firstInstrumentId = state.instrumentOrder[0];
            if (firstInstrumentId) {
                const initialInstrument = state.instruments.get(firstInstrumentId);
                if (initialInstrument && !initialInstrument.creatorDisplayName) {
                    initialInstrument.creatorDisplayName = socketState.pendingDefaultInstrumentLabel;
                }
            }
        }
        socketState.pendingDefaultInstrumentLabel = null;
        renderTransport();
        renderInstruments();
        updateConnectionsDisplay(payload.connections ?? 0);
        syncAudioScheduler();
        showRoomCodeHint(state.roomSlug || '');
        updateRoomDisplay();
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
        if (!normalized.creatorDisplayName && socketState.pendingInstrumentCreatorLabels.has(normalized.id)) {
            normalized.creatorDisplayName = socketState.pendingInstrumentCreatorLabels.get(normalized.id);
        }
        socketState.pendingInstrumentCreatorLabels.delete(normalized.id);
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
        const suppressionExpiry = socketState.suppressedInstrumentUpdates.get(normalized.id);
        if (suppressionExpiry && suppressionExpiry > Date.now()) {
            return;
        }
        if (suppressionExpiry) {
            socketState.suppressedInstrumentUpdates.delete(normalized.id);
        }
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

    socket.on('synthLocked', ({ instrumentId, synthName, lockedBy }) => {
        const targetId = resolveInstrumentId({ instrumentId, synthName });
        if (!targetId) {
            return;
        }
        setInstrumentLockedBy(targetId, lockedBy);
        renderInstrument(targetId);
    });

    socket.on('synthUnlocked', ({ instrumentId, synthName }) => {
        const targetId = resolveInstrumentId({ instrumentId, synthName });
        if (!targetId) {
            return;
        }
        setInstrumentLockedBy(targetId, null);
        renderInstrument(targetId);
    });

    socket.on('lockFailed', ({ instrumentId, synthName, lockedBy, reason }) => {
        const targetId = resolveInstrumentId({ instrumentId, synthName });
        if (targetId) {
            if (lockedBy) {
                setInstrumentLockedBy(targetId, lockedBy);
            }
            renderInstrument(targetId);
        }
        if (reason === 'locked') {
            console.warn(`Lock rejected: ${synthName || instrumentId || 'instrument'} is controlled by another user.`);
        } else {
            console.warn(`Lock request failed${reason ? `: ${reason}` : ''}.`);
        }
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

function resolveInstrumentId({ instrumentId, synthName }) {
    if (instrumentId && state.instruments.has(instrumentId)) {
        return instrumentId;
    }
    if (typeof synthName === 'string' && synthName.trim().length) {
        const match = Array.from(state.instruments.values()).find((instrument) => instrument.name === synthName.trim());
        if (match) {
            return match.id;
        }
    }
    return null;
}

// Setup room control event listeners
export function setupRoomControls(createRoomBtn, joinRoomBtn, leaveRoomBtn) {
    const createRoomModal = document.getElementById('create-room-modal');
    const createRoomForm = document.getElementById('create-room-form');
    const createRoomInput = document.getElementById('create-room-input');
    const createRoomError = document.getElementById('create-room-error');
    const cancelCreateRoomBtn = document.getElementById('cancel-create-room');
    const dismissCreateRoomBtn = document.getElementById('dismiss-create-room');
    const confirmCreateRoomBtn = document.getElementById('confirm-create-room');
    const modalBackdrop = createRoomModal?.querySelector('.modal-backdrop') || null;
    const roomNamePattern = /^[A-Za-z0-9]+$/;

    const escapeHtml = (value = '') => value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const showInvalidCharacters = (chars) => {
        if (!createRoomError) {
            return;
        }
        if (!chars.length) {
            createRoomError.textContent = '';
            createRoomError.classList.add('hidden');
            return;
        }
        const chips = chars.map((char) => `<span class="invalid-char">${escapeHtml(char)}</span>`).join('');
        createRoomError.innerHTML = `Only English letters and numbers are allowed. Invalid: ${chips}`;
        createRoomError.classList.remove('hidden');
    };

    const updateCreateRoomValidation = () => {
        if (!createRoomInput || !confirmCreateRoomBtn) {
            return false;
        }
        const trimmed = createRoomInput.value.trim();
        const invalidMatches = trimmed.match(/[^A-Za-z0-9]/g) || [];
        const uniqueInvalid = Array.from(new Set(invalidMatches));
        const isValid = Boolean(trimmed) && uniqueInvalid.length === 0;
        confirmCreateRoomBtn.disabled = !isValid;
        showInvalidCharacters(uniqueInvalid);
        return isValid;
    };

    const closeCreateRoomModal = () => {
        if (!createRoomModal) {
            return;
        }
        createRoomModal.classList.add('hidden');
        if (createRoomForm) {
            createRoomForm.reset();
        }
        showInvalidCharacters([]);
        if (confirmCreateRoomBtn) {
            confirmCreateRoomBtn.disabled = true;
        }
    };

    const openCreateRoomModal = () => {
        if (!createRoomModal || !createRoomForm || !createRoomInput || !confirmCreateRoomBtn) {
            fallbackCreateRoomPrompt();
            return;
        }
        const suggestion = sanitizeRoomName(state.roomSlug || state.roomId || '');
        createRoomInput.value = suggestion;
        createRoomModal.classList.remove('hidden');
        updateCreateRoomValidation();
        window.setTimeout(() => {
            createRoomInput.focus();
            createRoomInput.select();
        }, 0);
    };

    const fallbackCreateRoomPrompt = () => {
        const suggestedName = sanitizeRoomName(state.roomSlug || state.roomId || '');
        const input = window.prompt('Name your room:', suggestedName);
        if (input === null) {
            return;
        }
        const desiredName = input.trim();
        if (!desiredName) {
            window.alert('Room name cannot be empty.');
            return;
        }
        if (!roomNamePattern.test(desiredName)) {
            window.alert('Use only letters or numbers for room names.');
            return;
        }
        connectToRoom({ mode: 'create', roomName: desiredName });
    };

    const handleCreateSubmit = (event) => {
        event.preventDefault();
        if (!createRoomInput) {
            return;
        }
        const desiredName = createRoomInput.value.trim();
        if (!roomNamePattern.test(desiredName)) {
            updateCreateRoomValidation();
            return;
        }
        closeCreateRoomModal();
        connectToRoom({ mode: 'create', roomName: desiredName });
    };

    if (createRoomBtn) {
        createRoomBtn.addEventListener('click', openCreateRoomModal);
    }

    if (createRoomForm) {
        createRoomForm.addEventListener('submit', handleCreateSubmit);
    }

    if (createRoomInput) {
        createRoomInput.addEventListener('input', updateCreateRoomValidation);
    }

    if (cancelCreateRoomBtn) {
        cancelCreateRoomBtn.addEventListener('click', (event) => {
            event.preventDefault();
            closeCreateRoomModal();
        });
    }

    if (dismissCreateRoomBtn) {
        dismissCreateRoomBtn.addEventListener('click', (event) => {
            event.preventDefault();
            closeCreateRoomModal();
        });
    }

    if (createRoomModal) {
        createRoomModal.addEventListener('click', (event) => {
            if (event.target === createRoomModal || event.target === modalBackdrop) {
                closeCreateRoomModal();
            }
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && createRoomModal && !createRoomModal.classList.contains('hidden')) {
            closeCreateRoomModal();
        }
    });

    joinRoomBtn.addEventListener('click', () => {
        const input = window.prompt('Paste an invite link or token:');
        if (!input) {
            return;
        }

        const token = extractInviteToken(input);
        if (!token) {
            window.alert('Invite tokens look like random strings or invite URLs. Double-check and try again.');
            return;
        }

        connectToRoom({ mode: 'join', token });
    });

    leaveRoomBtn.addEventListener('click', () => leaveRoom());

    if (inviteRoomBtn) {
        inviteRoomBtn.addEventListener('click', () => {
            requestInviteToken();
        });
    }
}

function sanitizeRoomName(value = '') {
    return value.replace(/[^A-Za-z0-9]/g, '');
}

function requestInviteToken() {
    if (!state.isInRoom) {
        window.alert('Join a room before creating invites.');
        return;
    }
    if (!state.roomId) {
        window.alert('Join a room before creating invites.');
        return;
    }

    socket.emit('requestInviteToken', { roomId: state.roomId }, (response = {}) => {
        if (!response.ok || !response.token) {
            if (response.error === 'not-in-room') {
                window.alert('Reconnect to your room before inviting.');
            } else if (response.error) {
                window.alert(`Unable to create invite token: ${response.error}`);
            } else {
                window.alert('Unable to create invite token.');
            }
            return;
        }
        const slug = response.slug || state.roomSlug || '';
        const url = buildInviteLink(slug, response.token);
        showInviteLink(url);
    });
}

function buildInviteLink(slug, token) {
    const origin = window.location.origin;
    const safeSlug = encodeURIComponent(slug || 'session');
    return `${origin}/r/${safeSlug}?inv=${encodeURIComponent(token)}`;
}

function extractInviteToken(rawValue) {
    if (typeof rawValue !== 'string') {
        return null;
    }
    const trimmed = rawValue.trim();
    if (!trimmed) {
        return null;
    }

    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) {
        try {
            const url = new URL(trimmed, window.location.origin);
            const tokenFromQuery = url.searchParams.get('inv');
            if (tokenFromQuery && tokenFromQuery.trim()) {
                return tokenFromQuery.trim();
            }
        } catch (error) {
            return null;
        }
    }

    if (trimmed.includes('inv=')) {
        const queryIndex = trimmed.indexOf('inv=');
        const segment = trimmed.slice(queryIndex + 4);
        const tokenSegment = segment.split(/[&\s]/)[0];
        if (tokenSegment && tokenSegment.trim()) {
            return tokenSegment.trim();
        }
        return null;
    }

    return trimmed;
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
export function connectToRoom({ mode, roomName = '', token = '' }) {
    if (socketState.pendingRoomRequest) {
        return;
    }

    if (mode !== 'create' && mode !== 'join') {
        return;
    }

    ensureAudioContext();
    resetPendingRoomRequestState();
    socketState.pendingRoomRequest = true;
    socketState.pendingRoomRequestMeta = { mode };
    socketState.pendingDefaultInstrumentLabel = mode === 'create' ? getDisplayNameOrDefault() : null;
    socketState.pendingInstrumentCreatorLabels.clear();

    state.isInRoom = false;
    state.roomId = null;
    state.roomSlug = null;
    state.membershipRole = 'guest';
    state.instruments.clear();
    state.instrumentOrder = [];
    state.activeInstrumentId = null;
    renderInstruments();
    updateConnectionsDisplay(0);
    showRoomCodeHint('');

    if (!socket.connected) {
        socket.connect();
    }

    const eventName = mode === 'create' ? 'room:create' : 'joinWithInvite';
    clearRoomRequestTimer();
    socketState.roomRequestTimeoutId = window.setTimeout(() => {
        if (!socketState.pendingRoomRequest) {
            return;
        }
        failPendingRoomRequest('request-timeout');
    }, ROOM_REQUEST_TIMEOUT_MS);
    const eventPayload = mode === 'create'
        ? { roomName, displayName: getDisplayNameOrDefault() }
        : { token };
    socket.emit(eventName, eventPayload, (response = {}) => {
        const wasPending = socketState.pendingRoomRequest;
        resetPendingRoomRequestState();

        if (!wasPending) {
            return;
        }

        if (!response.ok) {
            handleRoomError(mode, response.error);
            return;
        }

        state.isInRoom = true;
        state.roomId = response.roomId || null;
        state.roomSlug = response.slug || state.roomSlug || null;
        if (mode === 'create') {
            state.membershipRole = 'owner';
        }
        showSequencer();
        showRoomCodeHint(state.roomSlug || '');
        updateRoomUrl(state.roomSlug || '');
        updateRoomDisplay();
        if (inviteRoomBtn) {
            inviteRoomBtn.disabled = false;
        }
        import('../ui/main.js').then(({ transportToggleBtn }) => {
            transportToggleBtn.disabled = false;
        });
        updateTempoDisplay(state.transport.bpm);
    });
}

export function attemptAutoJoinFromInvite() {
    if (inviteLinkAutoJoinAttempted) {
        return;
    }
    const details = getInviteDetailsFromLocation();
    if (!details) {
        return;
    }
    inviteLinkAutoJoinAttempted = true;
    showRoomCodeHint(details.slug);
    connectToRoom({ mode: 'join', token: details.token });
    updateRoomUrl(details.slug);
}

function getInviteDetailsFromLocation() {
    if (typeof window === 'undefined') {
        return null;
    }
    const { pathname, search } = window.location;
    if (!pathname.startsWith('/r/')) {
        return null;
    }
    const slugSegment = pathname.slice(3).split('/')[0] || '';
    const slug = decodeURIComponent(slugSegment).trim();
    if (!slug) {
        return null;
    }
    const params = new URLSearchParams(search);
    const token = params.get('inv');
    if (!token || !token.trim()) {
        return null;
    }
    return { slug, token: token.trim() };
}

// Handle room connection errors
export function handleRoomError(mode, errorCode) {
    if (mode === 'create' && errorCode === 'invalid-room-name') {
        window.alert('Choose a room name with letters or numbers.');
    } else if (mode === 'create' && errorCode === 'room-already-exists') {
        window.alert('Room slug already exists. Try a different name.');
    } else if (mode === 'join' && errorCode === 'token-invalid') {
        window.alert('Invite token is invalid. Ask the owner for a new link.');
    } else if (mode === 'join' && errorCode === 'token-expired') {
        window.alert('Invite token has expired. Request a new invite.');
    } else if (errorCode === 'room-not-found') {
        window.alert('Could not find that room. It may have expired.');
    } else if (errorCode === 'invalid-room-id') {
        window.alert('Room code is invalid.');
    } else if (errorCode === 'connection-error') {
        window.alert('Unable to connect to the server. Check your connection and try again.');
    } else if (errorCode === 'request-timeout') {
        window.alert('Connection attempt timed out. Please try again.');
    } else if (errorCode) {
        window.alert(`Unable to connect: ${errorCode}`);
    } else {
        window.alert('Unable to connect to that room.');
    }
    showLanding();
    showRoomCodeHint('');
    updateRoomUrl('');
}

// Leave current room
export function leaveRoom() {
    if (!state.isInRoom) {
        showLanding();
        return;
    }

    socket.emit('room:leave');
    socket.disconnect();
    resetPendingRoomRequestState();
    socketState.pendingInstrumentCreatorLabels.clear();
    socketState.pendingDefaultInstrumentLabel = null;

    state.isInRoom = false;
    state.roomId = null;
    state.roomSlug = null;
    state.membershipRole = 'guest';
    state.instruments.clear();
    state.instrumentOrder = [];
    state.activeInstrumentId = null;

    socketState.pendingPings.clear();
    socketState.clockOffsetMs = 0;
    socketState.latencyEstimateMs = 0;
    socketState.hasSyncSample = false;
    socketState.suppressedInstrumentUpdates.clear();

    stopAudioScheduler();
    renderInstruments();
    showLanding();
    showRoomCodeHint('');
    updateRoomDisplay();
    updateRoomUrl('');
}

function updateRoomUrl(slug) {
    if (typeof window === 'undefined' || !window.history || !window.history.replaceState) {
        return;
    }
    const path = slug ? `/r/${encodeURIComponent(slug)}` : '/';
    window.history.replaceState({}, document.title, path);
}
