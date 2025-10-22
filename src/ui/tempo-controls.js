// Tempo Controls Module
// Handles tempo slider and input controls

import { state } from '../state/main.js';
import { TEMPO_MIN, TEMPO_MAX } from '../constants/audio.js';
import { clampTempo } from '../utils/helpers.js';
import { tempoSlider, tempoInputField, tempoValueEl } from './main.js';

// Tempo input state
export const tempoInputState = { manualEditing: false };

// Update tempo display
export function updateTempoDisplay(value) {
    const bpm = clampTempo(value);
    tempoSlider.value = String(bpm);
    tempoInputField.value = String(bpm);
    tempoValueEl.textContent = `${bpm} BPM`;
}

// Commit tempo changes (emits socket event)
export function commitTempo(bpm, socket) {
    const tempo = clampTempo(bpm);
    updateTempoDisplay(tempo);
    state.transport.bpm = tempo;
    if (state.isInRoom && socket) {
        socket.emit('transport:set-tempo', { bpm: tempo });
    }
    // Sync audio scheduler
    import('../audio/scheduler.js').then(({ syncAudioScheduler }) => {
        syncAudioScheduler();
    });
}

// Setup tempo controls event listeners
export function setupTempoControls(socket) {
    tempoSlider.addEventListener('input', (event) => {
        const preview = clampTempo(event.target.value);
        state.tempoPreview = preview;
        updateTempoDisplay(preview);
    });

    tempoSlider.addEventListener('change', (event) => {
        const nextTempo = clampTempo(event.target.value);
        state.tempoPreview = nextTempo;
        commitTempo(nextTempo, socket);
    });

    if (tempoInputField) {
        tempoInputField.type = 'number';
        tempoInputField.min = String(TEMPO_MIN);
        tempoInputField.max = String(TEMPO_MAX);
        tempoInputField.step = '1';

        const handleTempoCommit = (rawValue, { enforceClamp = false } = {}) => {
            if (rawValue === '') {
                return;
            }
            const numeric = Number(rawValue);
            if (!Number.isFinite(numeric)) {
                return;
            }
            if (numeric >= TEMPO_MIN && numeric <= TEMPO_MAX) {
                commitTempo(numeric, socket);
            } else if (enforceClamp) {
                commitTempo(numeric, socket);
            }
        };

        tempoInputField.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                if (tempoInputState.manualEditing) {
                    handleTempoCommit(event.target.value, { enforceClamp: true });
                    tempoInputState.manualEditing = false;
                    updateTempoDisplay(state.transport.bpm);
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
            if (!tempoInputState.manualEditing) {
                handleTempoCommit(event.target.value, { enforceClamp: true });
            }
            updateTempoDisplay(state.transport.bpm);
        });

        tempoInputField.addEventListener('blur', () => {
            tempoInputState.manualEditing = false;
            updateTempoDisplay(state.transport.bpm);
        });
    }
}
