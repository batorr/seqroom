// Main UI Module
// Handles primary UI rendering and view management

import { state, getDisplayNameOrDefault } from '../state/main.js';
import { socketState } from '../state/audio.js';
import { initializeSidebar, renderInstrumentSidebar } from './sidebar.js';

// DOM Element References
export const landingEl = document.getElementById('landing');
export const sequencerEl = document.getElementById('sequencer');
export const roomCodeDisplayEl = document.getElementById('room-code-display');
export const createRoomBtn = document.getElementById('create-room');
export const joinRoomBtn = document.getElementById('join-room');
export const leaveRoomBtn = document.getElementById('leave-room');
export const transportToggleBtn = document.getElementById('transport-toggle');
export const recordToggleBtn = document.getElementById('record-toggle');
export const addSynthBtn = document.getElementById('add-synth');
export const roomDisplayEl = document.getElementById('room-display');
export const syncStatusEl = document.getElementById('sync-status');
export const connectionsEl = document.getElementById('connections');
export const tempoSlider = document.getElementById('tempo');
export const tempoInputField = document.getElementById('tempo-input');
export const tempoValueEl = document.getElementById('tempo-value');
export const instrumentListEl = document.getElementById('instrument-list');
export const instrumentEmptyEl = document.getElementById('instrument-empty');
export const addSynthModal = document.getElementById('add-synth-modal');
export const closeSynthModalBtn = document.getElementById('close-synth-modal');
export const instrumentTemplate = document.getElementById('instrument-card-template');
export const recordingStatusEl = document.getElementById('recording-status');

initializeSidebar();
renderInstrumentSidebar();

// View management
export function showSequencer() {
    landingEl.classList.add('hidden');
    sequencerEl.classList.remove('hidden');
    transportToggleBtn.disabled = false;
    showRoomCodeHint('');
}

export function showLanding() {
    landingEl.classList.remove('hidden');
    sequencerEl.classList.add('hidden');
    transportToggleBtn.disabled = true;
    roomDisplayEl.textContent = 'Room: —';
}

// Modal management
export function openSynthModal() {
    addSynthModal.classList.remove('hidden');
}

export function closeSynthModal() {
    addSynthModal.classList.add('hidden');
}

// Transport rendering
export function renderTransport() {
    import('./tempo-controls.js').then(({ updateTempoDisplay }) => {
        updateTempoDisplay(state.transport.bpm);
    });

    transportToggleBtn.textContent = state.transport.playing ? 'Stop' : 'Play';
    transportToggleBtn.classList.toggle('playing', state.transport.playing);
    transportToggleBtn.disabled = !state.isInRoom;

    import('../audio/recording.js').then(({ updateRecordButton }) => {
        import('../state/audio.js').then(({ audioState }) => {
            updateRecordButton(audioState.isRecording);
        });
    });

    if (state.transport.playing) {
        import('./instrument-card.js').then(({ updatePlaybackIndicators }) => {
            import('../audio/scheduler.js').then(({ getCurrentStepIndex }) => {
                updatePlaybackIndicators(getCurrentStepIndex());
            });
        });
    } else {
        import('./instrument-card.js').then(({ updatePlaybackIndicators }) => {
            updatePlaybackIndicators(-1);
        });
    }
}

// Instruments rendering
export function renderInstruments() {
    // Import instrument-card module dynamically
    import('./instrument-card.js').then(({
        removeInstrumentCard,
        ensureInstrumentCard,
        renderEmptyState,
        updateActiveInstrumentHighlight,
        updatePlaybackIndicators
    }) => {
        // Remove cards that no longer exist
        socketState.instrumentElements.forEach((_value, instrumentId) => {
            if (!state.instruments.has(instrumentId)) {
                removeInstrumentCard(instrumentId);
            }
        });

        if (!state.instrumentOrder.length) {
            state.activeInstrumentId = null;
        } else if (!state.activeInstrumentId || !state.instruments.has(state.activeInstrumentId)) {
            state.activeInstrumentId = state.instrumentOrder[0];
        }

        const fragment = document.createDocumentFragment();
        state.instrumentOrder.forEach((instrumentId) => {
            const instrument = state.instruments.get(instrumentId);
            if (!instrument) {
                return;
            }

            const card = ensureInstrumentCard(instrument);
            fragment.appendChild(card);
        });

        instrumentListEl.innerHTML = '';
        instrumentListEl.appendChild(fragment);
        renderEmptyState();
        renderInstrumentSidebar();
        updateActiveInstrumentHighlight();

        import('../audio/scheduler.js').then(({ getCurrentStepIndex }) => {
            updatePlaybackIndicators(getCurrentStepIndex());
        });
    });
}

// Connection and sync status
export function updateConnectionsDisplay(count) {
    if (!state.isInRoom) {
        connectionsEl.textContent = 'Not connected';
        return;
    }
    if (!Number.isFinite(count)) {
        return;
    }
    const label = count === 1 ? 'person' : 'people';
    connectionsEl.textContent = `${count} ${label} connected`;
}

export function updateSyncStatus() {
    if (!syncStatusEl) {
        return;
    }

    if (!state.isInRoom) {
        syncStatusEl.textContent = 'Join a room to sync';
        return;
    }

    if (!socketState.hasSyncSample) {
        syncStatusEl.textContent = 'Syncing clock…';
        return;
    }

    const offsetLabel = socketState.clockOffsetMs.toFixed(1);
    const latencyLabel = socketState.latencyEstimateMs.toFixed(1);
    syncStatusEl.textContent = `Offset ${offsetLabel} ms · RTT ${latencyLabel} ms`;
}

export function showRoomCodeHint(roomId) {
    if (!roomId) {
        roomCodeDisplayEl.textContent = '';
        roomCodeDisplayEl.classList.add('hidden');
        return;
    }
    roomCodeDisplayEl.textContent = `Share this code: ${roomId}`;
    roomCodeDisplayEl.classList.remove('hidden');
}

export function renderEmptyState() {
    if (!state.instrumentOrder.length) {
        instrumentEmptyEl.classList.remove('hidden');
    } else {
        instrumentEmptyEl.classList.add('hidden');
    }
}

// Setup functions
export function setupSynthModal(socket) {
    closeSynthModalBtn.addEventListener('click', closeSynthModal);
    addSynthModal.addEventListener('click', (event) => {
        if (event.target === addSynthModal) {
            closeSynthModal();
        }
    });

    addSynthModal.querySelectorAll('.synth-option').forEach((option) => {
        option.addEventListener('click', () => {
            const type = option.dataset.synthType;
            if (!type) {
                return;
            }

            const payload = {
                type,
                creatorDisplayName: getDisplayNameOrDefault(),
                creatorUserId: socket.id || null,
            };
            socket.emit('instrument:add', payload, (response = {}) => {
                if (!response.ok) {
                    if (response.error) {
                        console.error('Failed to add instrument:', response.error);
                    }
                    return;
                }
                if (response.instrument?.id) {
                    socketState.pendingInstrumentCreatorLabels.set(response.instrument.id, payload.creatorDisplayName);
                }
            });
            closeSynthModal();
        });
    });
}

export function primeAudioUnlock() {
    ['pointerdown', 'keydown'].forEach((eventName) => {
        document.addEventListener(eventName, () => {
            import('../audio/main.js').then(({ ensureAudioContext }) => {
                ensureAudioContext();
            });
        }, {
            once: true,
            passive: true,
        });
    });
}
