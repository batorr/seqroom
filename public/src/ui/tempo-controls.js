// Tempo Controls Module
// Handles tempo slider and input controls

import { state } from '../state/main.js';
import { TEMPO_MIN, TEMPO_MAX } from '../constants/audio.js';
import { clampTempo } from '../utils/helpers.js';
import { tempoSlider, tempoInputField, tempoValueEl } from './main.js';

// Tempo input state
// sliderActive: the user is dragging the slider; holdUntil: just released,
// still waiting for the server's echo. Either way, transport updates from the
// server must not yank the slider back to an older value.
export const tempoInputState = { manualEditing: false, sliderActive: false, holdUntil: 0 };

// At most this many tempo messages per second while dragging (plus the final value).
const TEMPO_SEND_INTERVAL_MS = 100;
const RELEASE_HOLD_MS = 600;

let lastTempoSentAt = -Infinity;
let lastTempoSent = null;
let pendingTempo = null;
let tempoSendTimer = null;

// Update tempo display. `force` is for the user's own edits.
export function updateTempoDisplay(value, { force = false } = {}) {
    const bpm = clampTempo(value);
    const sliderBusy = tempoInputState.sliderActive || performance.now() < tempoInputState.holdUntil;
    if (force || !sliderBusy) {
        tempoSlider.value = String(bpm);
        tempoValueEl.textContent = `${bpm} BPM`;
    }
    if (force || !tempoInputState.manualEditing) {
        tempoInputField.value = String(bpm);
    }
}

function flushTempo(socket) {
    if (tempoSendTimer) {
        clearTimeout(tempoSendTimer);
        tempoSendTimer = null;
    }
    if (pendingTempo === null) {
        return;
    }
    const tempo = pendingTempo;
    pendingTempo = null;
    lastTempoSentAt = performance.now();
    if (tempo === lastTempoSent && tempo === state.transport.bpm) {
        return;
    }
    lastTempoSent = tempo;
    socket.emit('transport:set-tempo', { bpm: tempo });
}

// Commit a tempo edit. In a room the server owns the tempo: it schedules the
// change on a future step shared by every client and echoes it back in
// `transport:update`, so the local transport is not touched here.
export function commitTempo(bpm, socket, { final = false } = {}) {
    const tempo = clampTempo(bpm);
    state.tempoPreview = tempo;
    updateTempoDisplay(tempo, { force: true });

    if (!state.isInRoom || !socket) {
        state.transport.bpm = tempo;
        return;
    }

    pendingTempo = tempo;
    const wait = final ? 0 : lastTempoSentAt + TEMPO_SEND_INTERVAL_MS - performance.now();
    if (wait <= 0) {
        flushTempo(socket);
    } else if (!tempoSendTimer) {
        tempoSendTimer = setTimeout(() => flushTempo(socket), wait);
    }
}

// Setup tempo controls event listeners
export function setupTempoControls(socket) {
    const finishSliderEdit = () => {
        tempoInputState.sliderActive = false;
        tempoInputState.holdUntil = performance.now() + RELEASE_HOLD_MS;
        commitTempo(tempoSlider.value, socket, { final: true });
        // Show whatever the server settled on once its echo had time to arrive.
        setTimeout(() => updateTempoDisplay(state.transport.bpm), RELEASE_HOLD_MS + 50);
    };

    tempoSlider.addEventListener('pointerdown', () => {
        tempoInputState.sliderActive = true;
    });
    tempoSlider.addEventListener('input', (event) => {
        commitTempo(event.target.value, socket);
    });
    tempoSlider.addEventListener('change', finishSliderEdit);
    window.addEventListener('pointerup', () => {
        if (tempoInputState.sliderActive) {
            finishSliderEdit();
        }
    });
    window.addEventListener('pointercancel', () => {
        if (tempoInputState.sliderActive) {
            finishSliderEdit();
        }
    });

    if (tempoInputField) {
        tempoInputField.type = 'number';
        tempoInputField.min = String(TEMPO_MIN);
        tempoInputField.max = String(TEMPO_MAX);
        tempoInputField.step = '1';

        // Returns true when a tempo was sent (its display is already updated).
        const handleTempoCommit = (rawValue, { enforceClamp = false } = {}) => {
            if (rawValue === '') {
                return false;
            }
            const numeric = Number(rawValue);
            if (!Number.isFinite(numeric)) {
                return false;
            }
            if ((numeric >= TEMPO_MIN && numeric <= TEMPO_MAX) || enforceClamp) {
                commitTempo(numeric, socket, { final: true });
                return true;
            }
            return false;
        };

        tempoInputField.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                if (tempoInputState.manualEditing) {
                    const committed = handleTempoCommit(event.target.value, { enforceClamp: true });
                    tempoInputState.manualEditing = false;
                    if (!committed) {
                        updateTempoDisplay(state.transport.bpm);
                    }
                }
                return;
            }

            if (event.key === 'Escape') {
                tempoInputState.manualEditing = false;
                updateTempoDisplay(state.transport.bpm);
                return;
            }

            const printable = event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
            const editingKeys = ['Backspace', 'Delete'];
            if (printable || editingKeys.includes(event.key)) {
                tempoInputState.manualEditing = true;
            }
        });

        tempoInputField.addEventListener('input', (event) => {
            event.stopPropagation();
            if (!tempoInputState.manualEditing) {
                handleTempoCommit(event.target.value, { enforceClamp: true });
            }
        });

        tempoInputField.addEventListener('change', (event) => {
            event.stopPropagation();
            const committed = !tempoInputState.manualEditing
                && handleTempoCommit(event.target.value, { enforceClamp: true });
            if (!committed) {
                updateTempoDisplay(state.transport.bpm);
            }
        });

        tempoInputField.addEventListener('blur', () => {
            tempoInputState.manualEditing = false;
            updateTempoDisplay(state.transport.bpm);
        });
    }
}
