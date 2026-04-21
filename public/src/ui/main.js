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
export const inviteRoomBtn = document.getElementById('invite-room');
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
export const inviteModal = document.getElementById('invite-modal');
export const closeInviteModalBtn = document.getElementById('close-invite-modal');
export const inviteLinkInput = document.getElementById('invite-link-input');
export const copyInviteLinkBtn = document.getElementById('copy-invite-link');
export const aboutModal = document.getElementById('about-modal');
export const closeAboutModalBtn = document.getElementById('close-about-modal');
export const footerAboutLink = document.getElementById('footer-about-link');

initializeSidebar();
renderInstrumentSidebar();

// View management
export function showSequencer() {
    landingEl.classList.add('hidden');
    sequencerEl.classList.remove('hidden');
    transportToggleBtn.disabled = false;
    showRoomCodeHint('');
    updateRoomDisplay();
    if (inviteRoomBtn) {
        inviteRoomBtn.disabled = !state.isInRoom;
    }
}

export function showLanding() {
    landingEl.classList.remove('hidden');
    sequencerEl.classList.add('hidden');
    transportToggleBtn.disabled = true;
    if (inviteRoomBtn) {
        inviteRoomBtn.disabled = true;
    }
    updateRoomDisplay();
}

export function updateRoomDisplay() {
    if (!roomDisplayEl) {
        return;
    }
    const hasRoom = state.isInRoom && (state.roomSlug || state.roomId);
    const label = hasRoom ? (state.roomSlug || state.roomId) : '—';
    roomDisplayEl.textContent = `Room: ${label}`;
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
    }).catch(console.error);

    transportToggleBtn.textContent = state.transport.playing ? 'Stop' : 'Play';
    transportToggleBtn.classList.toggle('playing', state.transport.playing);
    transportToggleBtn.disabled = !state.isInRoom;
    updateRoomDisplay();
    if (inviteRoomBtn) {
        inviteRoomBtn.disabled = !state.isInRoom;
    }

    import('../audio/recording.js').then(({ updateRecordButton }) => {
        import('../state/audio.js').then(({ audioState }) => {
            updateRecordButton(audioState.isRecording);
        }).catch(console.error);
    }).catch(console.error);

    if (state.transport.playing) {
        import('./instrument-card.js').then(({ updatePlaybackIndicators }) => {
            import('../audio/scheduler.js').then(({ getCurrentStepIndex }) => {
                updatePlaybackIndicators(getCurrentStepIndex());
            }).catch(console.error);
        }).catch(console.error);
    } else {
        import('./instrument-card.js').then(({ updatePlaybackIndicators }) => {
            updatePlaybackIndicators(-1);
        }).catch(console.error);
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
        }).catch(console.error);
    }).catch(console.error);
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

export function showRoomCodeHint(slug) {
    if (!slug) {
        roomCodeDisplayEl.textContent = '';
        roomCodeDisplayEl.classList.add('hidden');
        return;
    }
    roomCodeDisplayEl.textContent = `Room slug: ${slug}`;
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

export function setupInviteModal() {
    if (!inviteModal) {
        return;
    }

    if (closeInviteModalBtn) {
        closeInviteModalBtn.addEventListener('click', closeInviteModal);
    }

    inviteModal.addEventListener('click', (event) => {
        if (event.target === inviteModal) {
            closeInviteModal();
        }
    });

    if (copyInviteLinkBtn && inviteLinkInput) {
        copyInviteLinkBtn.addEventListener('click', () => {
            const value = inviteLinkInput.value || '';
            if (!value) {
                return;
            }
            const copyPromise = navigator.clipboard
                ? navigator.clipboard.writeText(value)
                : Promise.reject(new Error('clipboard-unavailable'));
            copyPromise.then(() => {
                indicateCopied();
            }).catch(() => {
                fallbackCopy(inviteLinkInput);
                indicateCopied();
            });
        });
    }
}

export function setupAboutModal() {
    if (!aboutModal || !footerAboutLink) {
        return;
    }

    const openModal = (event) => {
        event.preventDefault();
        aboutModal.classList.remove('hidden');
    };

    const closeModal = () => {
        aboutModal.classList.add('hidden');
    };

    footerAboutLink.addEventListener('click', openModal);

    if (closeAboutModalBtn) {
        closeAboutModalBtn.addEventListener('click', (event) => {
            event.preventDefault();
            closeModal();
        });
    }

    aboutModal.addEventListener('click', (event) => {
        if (event.target === aboutModal) {
            closeModal();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !aboutModal.classList.contains('hidden')) {
            closeModal();
        }
    });
}

export function showInviteLink(link) {
    if (!inviteModal) {
        return;
    }
    if (inviteLinkInput) {
        inviteLinkInput.value = link || '';
        inviteLinkInput.focus();
        inviteLinkInput.select();
    }
    inviteModal.classList.remove('hidden');
}

export function closeInviteModal() {
    if (!inviteModal) {
        return;
    }
    inviteModal.classList.add('hidden');
}

function fallbackCopy(input) {
    if (!input) {
        return;
    }

    try {
        input.focus();
        input.select();
        document.execCommand('copy');
    } catch (error) {
        console.warn('Failed to copy invite link:', error);
    }
}

function indicateCopied() {
    if (!copyInviteLinkBtn) {
        return;
    }
    const originalLabel = copyInviteLinkBtn.textContent;
    copyInviteLinkBtn.textContent = 'Copied';
    window.setTimeout(() => {
        copyInviteLinkBtn.textContent = originalLabel || 'Copy';
    }, 1500);
}

export function primeAudioUnlock() {
    ['pointerdown', 'keydown'].forEach((eventName) => {
        document.addEventListener(eventName, () => {
            import('../audio/main.js').then(({ ensureAudioContext }) => {
                ensureAudioContext();
            }).catch(console.error);
        }, {
            once: true,
            passive: true,
        });
    });
}
