// Instrument Card Module
// Handles rendering and management of instrument cards

import { state, setInstrumentStepCountLocal, ensureLocalInstrumentCapacity, normalizeSamplerStep, updateInstrumentName, sanitizeInstrumentName } from '../state/main.js';
import { audioState, socketState } from '../state/audio.js';
import { NOTE_OPTIONS } from '../constants/audio.js';
import { STEP_COUNT, STEP_GRID_COLUMNS } from '../constants/ui.js';
import { SynthTypes, TR808_DRUMS, SAMPLER_SLOT_IDS, SAMPLER_SLOT_CONFIG, SAMPLER_MAX_SAMPLE_BYTES, SAMPLER_ALLOWED_MIME_TYPES } from '../constants/instruments.js';
import { INSTRUMENT_LIBRARY } from '../constants/instruments.js';
import {
    clampStepCount,
    clampValue,
    hexToRgba,
    formatStepCountLabel,
    formatParamDisplay,
    formatBytes,
    createPitchSelect,
    createEmptyMelodicStep,
    createEmptyDrumStep,
    createEmptySamplerStep,
    createDefaultSamplerSlot
} from '../utils/helpers.js';
import { instrumentTemplate, instrumentListEl, instrumentEmptyEl } from './main.js';
import { updateSidebarEntry, removeInstrumentSidebarEntry, updateSidebarSelection } from './sidebar.js';

const PITCH_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PITCH_OCTAVE_MIN = 0;
const PITCH_OCTAVE_MAX = 7;
let activePitchPopup = null;
let pitchPopupStylesInjected = false;

// Helper functions
export function getVisibleStepSlots(stepCount) {
    const effective = clampStepCount(stepCount ?? STEP_COUNT);
    const rows = Math.max(1, Math.ceil(effective / STEP_GRID_COLUMNS));
    return rows * STEP_GRID_COLUMNS;
}

export function formatStepIndex(index, visibleTotal) {
    const padWidth = visibleTotal >= 100 ? 3 : 2;
    return String(index + 1).padStart(padWidth, '0');
}

function arrayBufferToBase64(buffer) {
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

function ensurePitchPopupStyles() {
    if (pitchPopupStylesInjected) {
        return;
    }
    const style = document.createElement('style');
    style.id = 'pitch-popup-styles';
    style.textContent = `
        .pitch-popup {
            position: absolute;
            z-index: 1200;
            background: linear-gradient(160deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.88));
            border: 1px solid rgba(148, 163, 184, 0.25);
            backdrop-filter: blur(12px);
            border-radius: 18px;
            padding: 18px 22px;
            color: #e2e8f0;
            display: flex;
            flex-direction: column;
            gap: 14px;
            box-shadow: 0 28px 65px rgba(15, 23, 42, 0.5);
            opacity: 0;
            transform: translateY(12px) scale(0.94);
            transition: opacity 160ms ease, transform 160ms ease;
        }

        .pitch-popup--visible {
            opacity: 1;
            transform: translateY(0) scale(1);
        }

        .pitch-popup__columns {
            display: flex;
            gap: 18px;
            align-items: stretch;
        }

        .pitch-popup__column {
            flex: 1 1 50%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            padding: 14px 20px;
            background: rgba(15, 23, 42, 0.55);
            border: 1px solid rgba(148, 163, 184, 0.18);
            cursor: ns-resize;
            user-select: none;
            transition: background 140ms ease, border 140ms ease, box-shadow 140ms ease;
        }

        .pitch-popup__column--active {
            background: rgba(56, 189, 248, 0.22);
            border-color: rgba(125, 211, 252, 0.55);
            box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.35);
        }

        .pitch-popup__value {
            font-family: 'JetBrains Mono', 'SFMono-Regular', 'Roboto Mono', 'Fira Code', monospace;
            font-size: 38px;
            letter-spacing: 0.08em;
            color: #f8fafc;
        }

        .pitch-popup__label {
            margin-top: 8px;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.34em;
            opacity: 0.72;
        }

        .pitch-popup__hint {
            font-size: 11px;
            text-align: center;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            opacity: 0.65;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
    pitchPopupStylesInjected = true;
}

function normalizeNoteIndex(index) {
    const total = PITCH_NOTE_NAMES.length;
    return ((index % total) + total) % total;
}

function clampOctave(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.min(PITCH_OCTAVE_MAX, Math.max(PITCH_OCTAVE_MIN, Math.round(value)));
}

function setLockedDisabled(element, locked) {
    if (!element) {
        return;
    }
    if (!Object.prototype.hasOwnProperty.call(element.dataset || {}, 'lockInitialDisabled')) {
        element.dataset.lockInitialDisabled = element.disabled ? 'true' : 'false';
    }
    if (locked) {
        element.disabled = true;
    } else {
        element.disabled = element.dataset.lockInitialDisabled === 'true';
    }
}

function parsePitchValue(pitch) {
    const fallback = { noteIndex: 0, octave: 3 };
    if (typeof pitch !== 'string' || !pitch.length) {
        return fallback;
    }
    const trimmed = pitch.trim();
    const match = trimmed.match(/^([A-G])(#?)(-?\d)$/i);
    if (!match) {
        return fallback;
    }
    const [, letter, accidental, octaveStr] = match;
    const noteName = `${letter.toUpperCase()}${accidental || ''}`;
    const idx = PITCH_NOTE_NAMES.indexOf(noteName);
    const noteIndex = idx >= 0 ? idx : fallback.noteIndex;
    const octave = clampOctave(Number(octaveStr));
    return { noteIndex, octave };
}

function formatPitchValue(noteIndex, octave) {
    const safeIndex = normalizeNoteIndex(noteIndex);
    const safeOctave = clampOctave(octave);
    return `${PITCH_NOTE_NAMES[safeIndex]}${safeOctave}`;
}

function closePitchPopup({ commit = false } = {}) {
    if (!activePitchPopup) {
        return;
    }
    const { container, onDocumentClick, onKeyDown, onScroll, onResize, commitSelection } = activePitchPopup;
    document.removeEventListener('click', onDocumentClick, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
    if (container) {
        container.classList.remove('pitch-popup--visible');
        const removeNode = () => {
            container.remove();
        };
        container.addEventListener('transitionend', removeNode, { once: true });
        setTimeout(removeNode, 180);
    }
    const shouldCommit = commit;
    const commitFn = commitSelection;
    activePitchPopup = null;
    if (shouldCommit && typeof commitFn === 'function') {
        commitFn();
    }
}

function openPitchPopup({ anchorEl, noteEl, selectEl, step, instrumentId, stepIndex }) {
    if (!anchorEl || !noteEl || !step) {
        return;
    }
    if (activePitchPopup && activePitchPopup.instrumentId === instrumentId && activePitchPopup.stepIndex === stepIndex) {
        closePitchPopup({ commit: true });
        return;
    }
    closePitchPopup({ commit: false });
    ensurePitchPopupStyles();

    const initialPitch = step.pitch || selectEl?.dataset?.pitch || 'C3';
    const parsed = parsePitchValue(initialPitch);
    let noteIndex = parsed.noteIndex;
    let octave = parsed.octave;
    let activeField = 'note';

    const container = document.createElement('div');
    container.className = 'pitch-popup';
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'true');

    const columns = document.createElement('div');
    columns.className = 'pitch-popup__columns';

    const noteColumn = document.createElement('div');
    noteColumn.className = 'pitch-popup__column pitch-popup__column--note pitch-popup__column--active';
    const noteValueEl = document.createElement('div');
    noteValueEl.className = 'pitch-popup__value';
    noteValueEl.textContent = PITCH_NOTE_NAMES[noteIndex];
    const noteLabelEl = document.createElement('div');
    noteLabelEl.className = 'pitch-popup__label';
    noteLabelEl.textContent = 'NOTE';
    noteColumn.append(noteValueEl, noteLabelEl);

    const octaveColumn = document.createElement('div');
    octaveColumn.className = 'pitch-popup__column pitch-popup__column--octave';
    const octaveValueEl = document.createElement('div');
    octaveValueEl.className = 'pitch-popup__value';
    octaveValueEl.textContent = String(octave);
    const octaveLabelEl = document.createElement('div');
    octaveLabelEl.className = 'pitch-popup__label';
    octaveLabelEl.textContent = 'OCTAVE';
    octaveColumn.append(octaveValueEl, octaveLabelEl);

    columns.append(noteColumn, octaveColumn);
    container.appendChild(columns);

    const hint = document.createElement('div');
    hint.className = 'pitch-popup__hint';
    hint.textContent = 'Scroll or arrow keys · click outside to apply';
    container.appendChild(hint);

    document.body.appendChild(container);

    const positionPopup = () => {
        const rect = anchorEl.getBoundingClientRect();
        const popupRect = container.getBoundingClientRect();
        let top = rect.top + window.scrollY - popupRect.height - 12;
        let fromBelow = false;
        if (top < window.scrollY + 8) {
            top = rect.bottom + window.scrollY + 12;
            fromBelow = true;
        }
        let left = rect.left + window.scrollX + rect.width / 2 - popupRect.width / 2;
        const minLeft = window.scrollX + 8;
        const maxLeft = window.scrollX + window.innerWidth - popupRect.width - 8;
        left = Math.min(Math.max(left, minLeft), Math.max(minLeft, maxLeft));
        container.style.top = `${top}px`;
        container.style.left = `${left}px`;
        if (fromBelow) {
            container.style.transformOrigin = '50% 0%';
        } else {
            container.style.transformOrigin = '50% 100%';
        }
    };

    positionPopup();
    requestAnimationFrame(() => {
        container.classList.add('pitch-popup--visible');
    });

    const setActiveField = (field) => {
        activeField = field;
        if (field === 'note') {
            noteColumn.classList.add('pitch-popup__column--active');
            octaveColumn.classList.remove('pitch-popup__column--active');
        } else {
            octaveColumn.classList.add('pitch-popup__column--active');
            noteColumn.classList.remove('pitch-popup__column--active');
        }
    };

    const updateDisplay = () => {
        noteValueEl.textContent = PITCH_NOTE_NAMES[normalizeNoteIndex(noteIndex)];
        octaveValueEl.textContent = String(clampOctave(octave));
    };

    const adjustNote = (delta) => {
        noteIndex = normalizeNoteIndex(noteIndex + delta);
        updateDisplay();
    };

    const adjustOctave = (delta) => {
        const next = clampOctave(octave + delta);
        if (next !== octave) {
            octave = next;
            updateDisplay();
        }
    };

    const WHEEL_THROTTLE_MS = 180;
    let lastNoteWheelTime = 0;
    let lastOctaveWheelTime = 0;

    const handleNoteWheel = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const now = Date.now();
        if (now - lastNoteWheelTime < WHEEL_THROTTLE_MS) {
            return;
        }
        lastNoteWheelTime = now;
        const delta = event.deltaY > 0 ? -1 : 1;
        adjustNote(delta);
    };

    const handleOctaveWheel = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const now = Date.now();
        if (now - lastOctaveWheelTime < WHEEL_THROTTLE_MS) {
            return;
        }
        lastOctaveWheelTime = now;
        const delta = event.deltaY > 0 ? -1 : 1;
        adjustOctave(delta);
    };

    setActiveField('note');

    noteColumn.addEventListener('mouseenter', () => setActiveField('note'));
    octaveColumn.addEventListener('mouseenter', () => setActiveField('octave'));
    noteColumn.addEventListener('wheel', handleNoteWheel, { passive: false });
    octaveColumn.addEventListener('wheel', handleOctaveWheel, { passive: false });
    container.addEventListener('wheel', (event) => {
        if (event.target === container || event.target === columns || event.target === hint) {
            event.preventDefault();
        }
    }, { passive: false });

    const handleKeyDown = (event) => {
        if (!activePitchPopup) {
            return;
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const delta = event.key === 'ArrowUp' ? 1 : -1;
            if (activeField === 'note') {
                adjustNote(delta);
            } else {
                adjustOctave(delta);
            }
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            setActiveField(activeField === 'note' ? 'octave' : 'note');
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closePitchPopup({ commit: false });
        } else if (event.key === 'Enter') {
            event.preventDefault();
            closePitchPopup({ commit: true });
        }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    const handleScroll = () => positionPopup();
    const handleResize = () => positionPopup();

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    let ignoreNextClick = true;
    setTimeout(() => {
        ignoreNextClick = false;
    }, 120);

    const handleDocumentClick = (event) => {
        if (ignoreNextClick) {
            return;
        }
        if (container.contains(event.target)) {
            return;
        }
        closePitchPopup({ commit: true });
    };

    document.addEventListener('click', handleDocumentClick, true);

    const commitSelection = () => {
        const pitchValue = formatPitchValue(noteIndex, octave);
        if (selectEl) {
            selectEl.dataset.pitch = pitchValue;
            selectEl.textContent = pitchValue;
        }
        noteEl.textContent = pitchValue;
        const previousPitch = step.pitch;
        step.pitch = pitchValue;
        if (previousPitch === pitchValue) {
            return;
        }
        socketState.suppressedInstrumentUpdates.set(instrumentId, Date.now() + 250);
        if (socket) {
            socket.emit('instrument:step', {
                instrumentId,
                stepIndex,
                step: { pitch: pitchValue },
            });
        }
    };

    activePitchPopup = {
        container,
        onDocumentClick: handleDocumentClick,
        onKeyDown: handleKeyDown,
        onScroll: handleScroll,
        onResize: handleResize,
        commitSelection,
        instrumentId,
        stepIndex,
    };

    anchorEl.blur();
}

// Import socket dynamically
let socket = null;
import('../socket/main.js').then((module) => {
    socket = module.socket;
});

function getCurrentSocketId() {
    return socket && typeof socket.id === 'string' ? socket.id : null;
}

function handleLockToggle(instrumentId) {
    if (!socket) {
        return;
    }
    const latest = state.instruments.get(instrumentId);
    if (!latest) {
        return;
    }
    const lockOwner = typeof latest.lockedBy === 'string' && latest.lockedBy.length ? latest.lockedBy : null;
    const socketId = getCurrentSocketId();
    if (lockOwner && lockOwner === socketId) {
        socket.emit('unlockSynth', { instrumentId });
        return;
    }
    socket.emit('lockSynth', { instrumentId });
}

// Render functions
export function renderInstrument(instrumentId) {
    if (activePitchPopup) {
        closePitchPopup({ commit: false });
    }
    const instrument = state.instruments.get(instrumentId);
    if (!instrument) {
        removeInstrumentCard(instrumentId);
        return;
    }

    const card = ensureInstrumentCard(instrument);
    updateInstrumentCard(card, instrument);
    renderEmptyState();
    updateActiveInstrumentHighlight();
    updateSidebarEntry(instrument.id);

    import('../audio/scheduler.js').then(({ getCurrentStepIndex }) => {
        updatePlaybackIndicators(getCurrentStepIndex());
    });
}

export function setActiveInstrument(instrumentId, options = {}) {
    const { scrollIntoView = false, focus = false } = options;
    if (instrumentId && !state.instruments.has(instrumentId)) {
        instrumentId = null;
    }
    state.activeInstrumentId = instrumentId;
    updateActiveInstrumentHighlight();
    if (instrumentId) {
        focusInstrumentCard(instrumentId, { scrollIntoView, focus });
    }
}

export function updateActiveInstrumentHighlight() {
    socketState.instrumentElements.forEach(({ root }, instrumentId) => {
        root.classList.toggle('active', instrumentId === state.activeInstrumentId);
    });
    updateSidebarSelection();
}

function focusInstrumentCard(instrumentId, { scrollIntoView, focus }) {
    const entry = socketState.instrumentElements.get(instrumentId);
    if (!entry?.root) {
        return;
    }

    const schedule = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (callback) => callback();

    if (scrollIntoView && typeof entry.root.scrollIntoView === 'function') {
        schedule(() => {
            entry.root.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
            });
        });
    }

    if (focus) {
        if (!entry.root.hasAttribute('tabindex')) {
            entry.root.tabIndex = -1;
        }
        schedule(() => {
            entry.root.focus({ preventScroll: true });
        });
    }
}

function updateStepControlDisplay(entry, stepCount) {
    if (!entry || !entry.stepControl) {
        return;
    }
    const control = entry.stepControl;
    if (control.manualEditing) {
        control.manualEditing.editing = false;
    }
    if (control.slider) {
        control.slider.value = String(stepCount);
    }
    if (control.input) {
        control.input.value = String(stepCount);
    }
    if (control.value) {
        control.value.textContent = formatStepCountLabel(stepCount);
    }
    if (Array.isArray(control.presets)) {
        control.presets.forEach((button) => {
            const presetValue = Number(button.textContent);
            button.classList.toggle('selected', presetValue === stepCount);
        });
    }
}

function refreshPlaybackIndicatorsView() {
    import('../audio/scheduler.js').then(({ getCurrentStepIndex }) => {
        updatePlaybackIndicators(getCurrentStepIndex());
    });
}

function refreshInstrumentStepUI(instrumentId) {
    const entry = socketState.instrumentElements.get(instrumentId);
    const instrument = state.instruments.get(instrumentId);
    if (!entry || !instrument) {
        return;
    }
    renderStepGrid(entry.stepGrid, instrument);
    updateInstrumentLockState(entry, instrument);
    refreshPlaybackIndicatorsView();
}

function getInstrumentFallbackName(instrument) {
    const definition = INSTRUMENT_LIBRARY[instrument.type] || {};
    return instrument.name || definition.label || 'Instrument';
}

function beginInstrumentRename(instrumentId) {
    const instrument = state.instruments.get(instrumentId);
    if (!instrument) {
        return;
    }
    const entry = socketState.instrumentElements.get(instrumentId);
    if (!entry || !entry.nameEl) {
        return;
    }
    if (entry.renameInput) {
        entry.renameInput.focus();
        entry.renameInput.select();
        return;
    }

    const currentName = getInstrumentFallbackName(instrument);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'instrument-name-input';
    input.value = currentName;
    input.maxLength = 48;

    const nameEl = entry.nameEl;
    nameEl.textContent = '';
    nameEl.appendChild(input);
    entry.renameInput = input;
    input.focus();
    input.select();

    const finish = (commit) => {
        if (entry.renameInput !== input) {
            return;
        }
        input.removeEventListener('keydown', handleKeyDown);
        input.removeEventListener('blur', handleBlur);
        entry.renameInput = null;
        input.remove();
        if (!commit) {
            nameEl.textContent = currentName;
        }
    };

    const commitRename = () => {
        if (entry.renameInput !== input) {
            return;
        }
        const nextName = sanitizeInstrumentName(input.value, instrument.type);
        finish(true);
        const previousName = instrument.name;
        if (nextName === previousName) {
            nameEl.textContent = nextName;
            return;
        }
        updateInstrumentName(instrumentId, nextName);
        nameEl.textContent = nextName;
        const suppressionExpiry = Date.now() + 400;
        socketState.suppressedInstrumentUpdates.set(instrumentId, suppressionExpiry);
        setTimeout(() => {
            if (socketState.suppressedInstrumentUpdates.get(instrumentId) === suppressionExpiry) {
                socketState.suppressedInstrumentUpdates.delete(instrumentId);
            }
        }, 600);
        renderInstrument(instrumentId);
        if (socket) {
            socket.emit('instrument:rename', { instrumentId, name: nextName }, (response = {}) => {
                if (!response.ok) {
                    const fallback = previousName || getInstrumentFallbackName(instrument);
                    socketState.suppressedInstrumentUpdates.delete(instrumentId);
                    updateInstrumentName(instrumentId, fallback);
                    renderInstrument(instrumentId);
                    if (response.error) {
                        console.error('Failed to rename instrument:', response.error);
                        window.alert('Unable to rename instrument. Please try again.');
                    }
                }
            });
        }
    };

    const handleBlur = () => commitRename();
    const handleKeyDown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            commitRename();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            finish(false);
        }
    };

    input.addEventListener('keydown', handleKeyDown);
    input.addEventListener('blur', handleBlur);
}

export function requestInstrumentStepCountChange(instrumentId, nextStepCount, options = {}) {
    const { skipFullRender = false } = options;
    if (state.activeInstrumentId !== instrumentId) {
        setActiveInstrument(instrumentId);
    }

    const instrument = state.instruments.get(instrumentId);
    if (!instrument) {
        return;
    }

    const previous = clampStepCount(instrument.stepCount ?? (Array.isArray(instrument.steps) ? instrument.steps.length : STEP_COUNT));
    const desired = clampStepCount(nextStepCount);

    if (desired === previous) {
        if (!skipFullRender) {
            setInstrumentStepCountLocal(instrumentId, desired);
            renderInstrument(instrumentId);
        } else {
            setInstrumentStepCountLocal(instrumentId, desired);
            refreshInstrumentStepUI(instrumentId);
            const entry = socketState.instrumentElements.get(instrumentId);
            updateStepControlDisplay(entry, desired);
        }
        return;
    }

    setInstrumentStepCountLocal(instrumentId, desired);
    if (!skipFullRender) {
        renderInstrument(instrumentId);
    } else {
        refreshInstrumentStepUI(instrumentId);
        const entry = socketState.instrumentElements.get(instrumentId);
        updateStepControlDisplay(entry, desired);
    }

    if (!state.isInRoom) {
        return;
    }

    if (!socket) {
        console.warn('Socket not available yet');
        return;
    }

    socket.emit('instrument:set-length', { instrumentId, stepCount: desired }, (response = {}) => {
        if (!response.ok) {
            if (response.error) {
                console.error('Failed to update instrument length:', response.error);
            }
            setInstrumentStepCountLocal(instrumentId, previous);
            if (!skipFullRender) {
                renderInstrument(instrumentId);
            } else {
                refreshInstrumentStepUI(instrumentId);
                const entry = socketState.instrumentElements.get(instrumentId);
                updateStepControlDisplay(entry, previous);
            }
            return;
        }

        if (typeof response.stepCount === 'number') {
            const acknowledged = clampStepCount(response.stepCount);
            if (acknowledged !== desired) {
                setInstrumentStepCountLocal(instrumentId, acknowledged);
                if (!skipFullRender) {
                    renderInstrument(instrumentId);
                } else {
                    refreshInstrumentStepUI(instrumentId);
                    const entry = socketState.instrumentElements.get(instrumentId);
                    updateStepControlDisplay(entry, acknowledged);
                }
            }
        }
    });
}

export function ensureInstrumentCard(instrument) {
    let wrapper = socketState.instrumentElements.get(instrument.id)?.root;
    if (wrapper) {
        if (!wrapper.hasAttribute('tabindex')) {
            wrapper.tabIndex = -1;
        }
        updateInstrumentCard(wrapper, instrument);
        return wrapper;
    }

    const node = instrumentTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.instrumentId = instrument.id;
    node.tabIndex = -1;

    const removeBtn = node.querySelector('.remove-instrument');
    removeBtn.addEventListener('click', () => {
        if (!socket) return;
        socket.emit('instrument:remove', { instrumentId: instrument.id });
    });

    node.addEventListener('click', (event) => {
        if (event.target.closest('.remove-instrument')) {
            return;
        }
        const targetId = node.dataset.instrumentId;
        if (targetId) {
            setActiveInstrument(targetId);
        }
    });

    const cardEntry = {
        root: node,
        paramsContainer: node.querySelector('.synth-params'),
        stepGrid: node.querySelector('.step-grid'),
        stepRefs: [],
        drumSelector: null,
        activeDrum: 'kick',
        activeSamplerSlot: SAMPLER_SLOT_IDS[0],
        stepControl: null,
        nameEl: node.querySelector('.instrument-name'),
        renameButton: node.querySelector('.rename-instrument'),
        renameInput: null,
        removeButton: removeBtn,
        lockButton: null,
    };

    if (cardEntry.renameButton) {
        cardEntry.renameButton.addEventListener('click', (event) => {
            event.stopPropagation();
            beginInstrumentRename(instrument.id);
        });
    }
    if (cardEntry.nameEl) {
        cardEntry.nameEl.addEventListener('dblclick', (event) => {
            event.stopPropagation();
            beginInstrumentRename(instrument.id);
        });
    }

    // Create step controls
    const controlsRow = document.createElement('div');
    controlsRow.className = 'instrument-controls';

    const stepControl = document.createElement('div');
    stepControl.className = 'step-length-control';

    const stepLabel = document.createElement('span');
    stepLabel.textContent = 'Steps';

    const stepSlider = document.createElement('input');
    stepSlider.type = 'range';
    stepSlider.min = String(1);
    stepSlider.max = String(128);
    stepSlider.step = '1';

    const stepNumberInput = document.createElement('input');
    stepNumberInput.type = 'number';
    stepNumberInput.min = String(1);
    stepNumberInput.max = String(128);
    stepNumberInput.step = '1';
    stepNumberInput.className = 'numeric-input step-count-input';

    const stepValue = document.createElement('span');

    const presetContainer = document.createElement('div');
    presetContainer.className = 'step-presets';
    const presetValues = [16, 32, 64, 128];
    const presetButtons = presetValues.map((preset) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'step-preset-button';
        button.textContent = String(preset);
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            if (state.activeInstrumentId !== instrument.id) {
                setActiveInstrument(instrument.id);
            }
            if (cardEntry.stepControl?.manualEditing) {
                cardEntry.stepControl.manualEditing.editing = false;
            }
            requestInstrumentStepCountChange(instrument.id, preset);
        });
        presetContainer.appendChild(button);
        return button;
    });

    stepControl.append(stepLabel, stepSlider, stepNumberInput, stepValue, presetContainer);
    controlsRow.appendChild(stepControl);

    node.insertBefore(controlsRow, cardEntry.paramsContainer);

    const lockButton = document.createElement('button');
    lockButton.type = 'button';
    lockButton.className = 'instrument-lock-button';
    lockButton.textContent = 'Lock';
    lockButton.setAttribute('aria-label', 'Lock instrument');
    lockButton.addEventListener('click', (event) => {
        event.stopPropagation();
        if (state.activeInstrumentId !== instrument.id) {
            setActiveInstrument(instrument.id);
        }
        handleLockToggle(instrument.id);
    });

    const nameGroup = node.querySelector('.synth-name-group');
    if (nameGroup) {
        nameGroup.appendChild(lockButton);
    }
    cardEntry.lockButton = lockButton;

    const instrumentId = instrument.id;
    const getCurrentStepCount = () => {
        const latest = state.instruments.get(instrumentId);
        if (!latest) {
            return STEP_COUNT;
        }
        const latestSteps = Array.isArray(latest.steps) ? latest.steps.length : STEP_COUNT;
        return clampStepCount(latest.stepCount ?? latestSteps ?? STEP_COUNT);
    };

    const manualStepState = { editing: false };
    stepSlider.addEventListener('input', (event) => {
        event.stopPropagation();
        if (state.activeInstrumentId !== instrument.id) {
            setActiveInstrument(instrument.id);
        }
        manualStepState.editing = false;
        const desired = clampStepCount(stepSlider.value);
        socketState.suppressedInstrumentUpdates.set(instrumentId, Date.now() + 250);
        requestInstrumentStepCountChange(instrumentId, desired, { skipFullRender: true });
    });

    stepNumberInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            if (manualStepState.editing) {
                event.preventDefault();
                if (stepNumberInput.value !== '') {
                    const desired = clampStepCount(stepNumberInput.value);
                    stepNumberInput.value = String(desired);
                    socketState.suppressedInstrumentUpdates.set(instrumentId, Date.now() + 250);
                    requestInstrumentStepCountChange(instrumentId, desired, { skipFullRender: true });
                }
                manualStepState.editing = false;
                return;
            }
        }

        if (event.key === 'Escape') {
            manualStepState.editing = false;
            const current = getCurrentStepCount();
            stepNumberInput.value = String(current);
            stepValue.textContent = formatStepCountLabel(current);
            presetButtons.forEach((button) => {
                const presetValue = Number(button.textContent);
                button.classList.toggle('selected', presetValue === current);
            });
            return;
        }

        const printable = event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
        const editingKeys = ['Backspace', 'Delete'];
        if (printable || editingKeys.includes(event.key)) {
            manualStepState.editing = true;
        }
    });

    stepNumberInput.addEventListener('input', (event) => {
        event.stopPropagation();
        if (state.activeInstrumentId !== instrument.id) {
            setActiveInstrument(instrument.id);
        }
        if (!manualStepState.editing && stepNumberInput.value !== '') {
            const desired = clampStepCount(stepNumberInput.value);
            stepNumberInput.value = String(desired);
            socketState.suppressedInstrumentUpdates.set(instrumentId, Date.now() + 250);
            requestInstrumentStepCountChange(instrumentId, desired, { skipFullRender: true });
        }
    });

    stepNumberInput.addEventListener('change', (event) => {
        event.stopPropagation();
        if (state.activeInstrumentId !== instrument.id) {
            setActiveInstrument(instrument.id);
        }
        if (manualStepState.editing) {
            manualStepState.editing = false;
            const current = getCurrentStepCount();
            stepNumberInput.value = String(current);
            stepValue.textContent = formatStepCountLabel(current);
            presetButtons.forEach((button) => {
                const presetValue = Number(button.textContent);
                button.classList.toggle('selected', presetValue === current);
            });
            return;
        }
        if (stepNumberInput.value === '') {
            const current = getCurrentStepCount();
            stepNumberInput.value = String(current);
            return;
        }
        const desired = clampStepCount(stepNumberInput.value);
        stepNumberInput.value = String(desired);
        socketState.suppressedInstrumentUpdates.set(instrumentId, Date.now() + 250);
        requestInstrumentStepCountChange(instrumentId, desired, { skipFullRender: true });
    });

    stepNumberInput.addEventListener('blur', () => {
        manualStepState.editing = false;
        const current = getCurrentStepCount();
        stepNumberInput.value = String(current);
        stepValue.textContent = formatStepCountLabel(current);
        presetButtons.forEach((button) => {
            const presetValue = Number(button.textContent);
            button.classList.toggle('selected', presetValue === current);
        });
    });

    cardEntry.stepControl = {
        container: controlsRow,
        slider: stepSlider,
        input: stepNumberInput,
        value: stepValue,
        presets: presetButtons,
        manualEditing: manualStepState,
    };

    const drumSelector = document.createElement('div');
    drumSelector.className = 'drum-selector hidden';
    cardEntry.drumSelector = drumSelector;
    node.insertBefore(drumSelector, cardEntry.stepGrid);

    socketState.instrumentElements.set(instrument.id, cardEntry);
    updateInstrumentCard(node, instrument);
    return node;
}

function updateInstrumentLockState(entry, instrument) {
    if (!entry || !instrument) {
        return;
    }

    const lockOwner = typeof instrument.lockedBy === 'string' && instrument.lockedBy.length
        ? instrument.lockedBy
        : null;
    const socketId = getCurrentSocketId();
    const isLocked = Boolean(lockOwner);
    const isOwner = isLocked && socketId === lockOwner;
    const lockedByOther = isLocked && !isOwner;

    if (entry.lockButton) {
        let label = 'Lock';
        let ariaLabel = 'Lock instrument';
        if (isOwner) {
            label = 'Unlock';
        } else if (lockedByOther) {
            label = 'Locked';
        }
        entry.lockButton.textContent = label;
        entry.lockButton.disabled = lockedByOther;
        entry.lockButton.classList.toggle('is-locked', isLocked);
        entry.lockButton.classList.toggle('is-owned', isOwner);
        entry.lockButton.title = lockedByOther && lockOwner
            ? `Locked by ${lockOwner}`
            : isOwner ? 'You currently control this synth' : 'Request exclusive control of this synth';
        if (isOwner) {
            ariaLabel = 'Unlock instrument';
        } else if (lockedByOther && lockOwner) {
            ariaLabel = `Instrument locked by ${lockOwner}`;
        }
        entry.lockButton.setAttribute('aria-label', ariaLabel);
    }

    if (entry.root) {
        entry.root.classList.toggle('is-locked', isLocked);
        entry.root.classList.toggle('is-locked-by-self', isOwner);
        entry.root.classList.toggle('is-locked-by-other', lockedByOther);
        if (isLocked) {
            entry.root.dataset.lockedBy = lockOwner;
        } else {
            delete entry.root.dataset.lockedBy;
        }
    }

    const disableControls = lockedByOther;

    setLockedDisabled(entry.removeButton, disableControls);
    setLockedDisabled(entry.renameButton, disableControls);
    if (entry.renameInput) {
        setLockedDisabled(entry.renameInput, disableControls);
    }

    if (entry.stepControl) {
        setLockedDisabled(entry.stepControl.slider, disableControls);
        setLockedDisabled(entry.stepControl.input, disableControls);
        if (Array.isArray(entry.stepControl.presets)) {
            entry.stepControl.presets.forEach((button) => setLockedDisabled(button, disableControls));
        }
    }

    if (entry.paramsContainer) {
        entry.paramsContainer.querySelectorAll('input, select, textarea, button').forEach((control) => {
            setLockedDisabled(control, disableControls);
        });
    }

    if (entry.stepRefs) {
        entry.stepRefs.forEach((ref) => {
            if (ref.toggleBtn) {
                setLockedDisabled(ref.toggleBtn, disableControls);
                ref.disabled = ref.toggleBtn.disabled;
            } else if (typeof ref.disabled !== 'boolean') {
                ref.disabled = disableControls;
            }
            if (ref.pitchSelect) {
                setLockedDisabled(ref.pitchSelect, disableControls);
                if (!ref.baseDisabled) {
                    ref.pitchSelect.classList.toggle('step-select-disabled', ref.pitchSelect.disabled);
                }
            }
        });
    }

    if (entry.stepGrid) {
        entry.stepGrid.classList.toggle('locked', disableControls);
    }
}

export function updateInstrumentCard(card, instrument) {
    const entry = socketState.instrumentElements.get(instrument.id);
    const definition = INSTRUMENT_LIBRARY[instrument.type] || INSTRUMENT_LIBRARY[SynthTypes.POLY];
    card.dataset.instrumentId = instrument.id;
    card.classList.remove('tone-acid', 'tone-808', 'tone-poly', 'tone-sampler');
    if (definition.toneClass) {
        card.classList.add(definition.toneClass);
    }

    if (entry) {
        entry.nameEl = card.querySelector('.instrument-name');
        if (!entry.lockButton) {
            entry.lockButton = card.querySelector('.instrument-lock-button');
        }
    }
    const titleEl = entry?.nameEl || card.querySelector('.instrument-name');
    const typeEl = card.querySelector('.synth-meta span');
    const displayName = instrument.name || definition.label;
    if (entry && entry.renameInput) {
        entry.renameInput.value = displayName;
    } else if (titleEl) {
        titleEl.textContent = displayName;
    }
    typeEl.textContent = definition.typeLabel || instrument.type;

    const paramsContainer = entry.paramsContainer;
    renderParamControls(paramsContainer, instrument, definition);

    if (entry.stepControl) {
        const stepCount = clampStepCount(instrument.stepCount ?? (Array.isArray(instrument.steps) ? instrument.steps.length : STEP_COUNT));
        entry.stepControl.slider.value = String(stepCount);
        entry.stepControl.value.textContent = formatStepCountLabel(stepCount);
        if (entry.stepControl.input) {
            entry.stepControl.input.value = String(stepCount);
        }
        if (Array.isArray(entry.stepControl.presets)) {
            entry.stepControl.presets.forEach((button) => {
                const presetValue = Number(button.textContent);
                button.classList.toggle('selected', presetValue === stepCount);
            });
        }
        if (entry.stepControl.manualEditing) {
            entry.stepControl.manualEditing.editing = false;
        }
    }

    if (entry.drumSelector) {
        if (instrument.type === SynthTypes.TR808) {
            entry.drumSelector.classList.remove('hidden');
            if (!entry.activeDrum || !TR808_DRUMS.some((drum) => drum.id === entry.activeDrum)) {
                entry.activeDrum = TR808_DRUMS[0].id;
            }
            renderDrumSelector(entry, instrument);
        } else if (instrument.type === SynthTypes.SAMPLER) {
            entry.drumSelector.classList.remove('hidden');
            if (!entry.activeSamplerSlot || !SAMPLER_SLOT_IDS.includes(entry.activeSamplerSlot)) {
                entry.activeSamplerSlot = SAMPLER_SLOT_IDS[0];
            }
            renderSamplerSelector(entry, instrument, definition);
        } else {
            entry.drumSelector.classList.add('hidden');
        }
    }

    const stepGrid = entry.stepGrid;
    renderStepGrid(stepGrid, instrument);

    updateInstrumentLockState(entry, instrument);
}

export function removeInstrumentCard(instrumentId) {
    if (activePitchPopup) {
        closePitchPopup({ commit: false });
    }
    const entry = socketState.instrumentElements.get(instrumentId);
    if (!entry) {
        return;
    }
    if (entry.renameInput) {
        entry.renameInput.remove();
        entry.renameInput = null;
    }
    entry.root.remove();
    socketState.instrumentElements.delete(instrumentId);
    removeInstrumentSidebarEntry(instrumentId);
    import('../audio/scheduler.js').then(({ getCurrentStepIndex }) => {
        updatePlaybackIndicators(getCurrentStepIndex());
    });
}

export function renderEmptyState() {
    if (!state.instrumentOrder.length) {
        instrumentEmptyEl.classList.remove('hidden');
    } else {
        instrumentEmptyEl.classList.add('hidden');
    }
}

export function updatePlaybackIndicators(stepIndex) {
    socketState.instrumentElements.forEach(({ stepRefs }, instrumentId) => {
        if (!stepRefs || !stepRefs.length) {
            return;
        }

        const instrument = state.instruments.get(instrumentId);
        if (!instrument) {
            stepRefs.forEach((ref) => ref.cell.classList.remove('playing'));
            return;
        }

        const instrumentStepCount = clampStepCount(instrument.stepCount ?? (Array.isArray(instrument.steps) ? instrument.steps.length : STEP_COUNT));
        const normalizedIndex = stepIndex >= 0 && instrumentStepCount > 0 ? stepIndex % instrumentStepCount : -1;

        stepRefs.forEach((ref, index) => {
            const canPlay = index < instrumentStepCount && !ref?.disabled;
            const isPlaying = state.transport.playing && canPlay && normalizedIndex === index;
            ref.cell.classList.toggle('playing', isPlaying);
        });
    });
}

// Drum selector
function renderDrumSelector(entry, instrument) {
    const container = entry.drumSelector;
    container.innerHTML = '';

    TR808_DRUMS.forEach((drum) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'drum-button';
        button.dataset.drum = drum.id;
        button.textContent = drum.label;
        button.style.setProperty('--drum-color', drum.color);
        if (entry.activeDrum === drum.id) {
            button.classList.add('active');
        }

        button.addEventListener('click', () => {
            if (entry.activeDrum === drum.id) {
                return;
            }
            entry.activeDrum = drum.id;
            renderDrumSelector(entry, instrument);
            renderStepGrid(entry.stepGrid, instrument);
            updateInstrumentLockState(entry, instrument);
            import('../audio/scheduler.js').then(({ getCurrentStepIndex }) => {
                updatePlaybackIndicators(getCurrentStepIndex());
            });
        });

        container.appendChild(button);
    });
}

// Sampler selector and controls
function renderSamplerSelector(entry, instrument, definition) {
    const container = entry.drumSelector;
    container.innerHTML = '';
    const slots = instrument.params?.slots || {};
    const activeSlot = entry.activeSamplerSlot && SAMPLER_SLOT_IDS.includes(entry.activeSamplerSlot)
        ? entry.activeSamplerSlot
        : SAMPLER_SLOT_IDS[0];
    entry.activeSamplerSlot = activeSlot;

    SAMPLER_SLOT_CONFIG.forEach((slotConfig) => {
        const slotId = slotConfig.id;
        const slotState = slots[slotId] || createDefaultSamplerSlot(slotId);
        const wrapper = document.createElement('div');
        wrapper.className = 'sampler-slot';
        wrapper.dataset.slotId = slotId;
        wrapper.style.setProperty('--sampler-color', slotConfig.color);
        if (slotId === activeSlot) {
            wrapper.classList.add('active');
        }

        const selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'drum-button sampler-slot-button';
        selectBtn.textContent = slotId;
        if (slotId === activeSlot) {
            selectBtn.classList.add('active');
        }
        selectBtn.addEventListener('click', () => {
            if (entry.activeSamplerSlot === slotId) {
                return;
            }
            entry.activeSamplerSlot = slotId;
            renderSamplerSelector(entry, instrument, definition);
            renderParamControls(entry.paramsContainer, instrument, definition);
            renderStepGrid(entry.stepGrid, instrument);
            updateInstrumentLockState(entry, instrument);
            import('../audio/scheduler.js').then(({ getCurrentStepIndex }) => {
                updatePlaybackIndicators(getCurrentStepIndex());
            });
        });

        const infoLabel = document.createElement('span');
        infoLabel.className = 'sampler-slot-info';
        infoLabel.textContent = slotState.sample?.name || 'Drop WAV/MP3';

        const actions = document.createElement('div');
        actions.className = 'sampler-slot-actions';

        const uploadBtn = document.createElement('button');
        uploadBtn.type = 'button';
        uploadBtn.className = 'subtle sampler-upload-button';
        uploadBtn.textContent = slotState.sample ? 'Replace' : 'Upload';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = SAMPLER_ALLOWED_MIME_TYPES.join(',');
        fileInput.className = 'sampler-slot-file-input';
        fileInput.addEventListener('change', () => {
            const [file] = fileInput.files || [];
            if (file) {
                handleSamplerFileUpload(instrument.id, slotId, file);
            }
            fileInput.value = '';
        });

        uploadBtn.addEventListener('click', () => {
            fileInput.click();
        });

        actions.appendChild(uploadBtn);

        if (slotState.sample) {
            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'subtle sampler-clear-button';
            clearBtn.textContent = 'Clear';
            clearBtn.addEventListener('click', () => {
                handleSamplerSampleClear(instrument.id, slotId);
            });
            actions.appendChild(clearBtn);
        }

        wrapper.appendChild(selectBtn);
        wrapper.appendChild(infoLabel);
        wrapper.appendChild(actions);
        wrapper.appendChild(fileInput);

        enableSamplerSlotDrop(wrapper, instrument.id, slotId, infoLabel);

        container.appendChild(wrapper);
    });
}

function renderSamplerParamControls(container, instrument) {
    const entry = socketState.instrumentElements.get(instrument.id);
    if (!entry) {
        container.textContent = 'Sampler unavailable.';
        return;
    }

    const slotId = entry.activeSamplerSlot && SAMPLER_SLOT_IDS.includes(entry.activeSamplerSlot)
        ? entry.activeSamplerSlot
        : SAMPLER_SLOT_IDS[0];
    entry.activeSamplerSlot = slotId;
    const slot = instrument.params?.slots?.[slotId] || createDefaultSamplerSlot(slotId);

    const header = document.createElement('div');
    header.className = 'sampler-params-header';
    header.textContent = `Slot ${slotId}`;
    container.appendChild(header);

    const sampleStatus = document.createElement('div');
    sampleStatus.className = 'sampler-sample-status';
    if (slot.sample) {
        const sizeLabel = typeof slot.sample.bytesLength === 'number' ? ` · ${formatBytes(slot.sample.bytesLength)}` : '';
        sampleStatus.textContent = `Sample: ${slot.sample.name}${sizeLabel}`;
    } else {
        sampleStatus.textContent = 'No sample loaded.';
    }
    container.appendChild(sampleStatus);

    appendSamplerRangeControl(container, instrument.id, slotId, {
        key: 'volume',
        label: 'Volume',
        min: 0,
        max: 1,
        step: 0.01,
        value: clampValue(slot.volume ?? 1, 0, 1),
        format: (value) => value.toFixed(2),
    });

    appendSamplerRangeControl(container, instrument.id, slotId, {
        key: 'pan',
        label: 'Pan',
        min: -1,
        max: 1,
        step: 0.01,
        value: clampValue(slot.pan ?? 0, -1, 1),
        format: (value) => value.toFixed(2),
    });

    appendSamplerRangeControl(container, instrument.id, slotId, {
        key: 'pitch',
        label: 'Pitch (semitones)',
        min: -24,
        max: 24,
        step: 0.1,
        value: clampValue(slot.pitch ?? 0, -24, 24),
        format: (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`,
    });

    const startControl = appendSamplerRangeControl(container, instrument.id, slotId, {
        key: 'startOffset',
        label: 'Start Offset',
        min: 0,
        max: 0.99,
        step: 0.01,
        value: clampValue(slot.startOffset ?? 0, 0, 0.99),
        format: (value) => `${Math.round(value * 100)}%`,
    });

    const endControl = appendSamplerRangeControl(container, instrument.id, slotId, {
        key: 'endOffset',
        label: 'End Offset',
        min: 0.01,
        max: 1,
        step: 0.01,
        value: clampValue(slot.endOffset ?? 1, 0.01, 1),
        format: (value) => `${Math.round(value * 100)}%`,
    });

    startControl.onCommit = (rawValue) => {
        let value = clampValue(rawValue, 0, 0.99);
        const endValue = clampValue(Number(endControl.input.value), 0.01, 1);
        if (value >= endValue - 0.01) {
            value = clampValue(endValue - 0.01, 0, 0.99);
            startControl.input.value = value.toFixed(2);
            startControl.badge.textContent = `${Math.round(value * 100)}%`;
        }
        updateSamplerSlotLocal(instrument.id, slotId, { startOffset: value });
        emitSamplerParamUpdate(instrument.id, slotId, { startOffset: value });
    };

    endControl.onCommit = (rawValue) => {
        let value = clampValue(rawValue, 0.01, 1);
        const startValue = clampValue(Number(startControl.input.value), 0, 0.99);
        if (value <= startValue + 0.01) {
            value = clampValue(startValue + 0.01, 0.01, 1);
            endControl.input.value = value.toFixed(2);
            endControl.badge.textContent = `${Math.round(value * 100)}%`;
        }
        updateSamplerSlotLocal(instrument.id, slotId, { endOffset: value });
        emitSamplerParamUpdate(instrument.id, slotId, { endOffset: value });
    };

    appendSamplerToggleControl(container, instrument.id, slotId, {
        key: 'reverse',
        label: 'Reverse Playback',
        value: Boolean(slot.reverse),
    });

    appendSamplerToggleControl(container, instrument.id, slotId, {
        key: 'mute',
        label: 'Mute Slot',
        value: Boolean(slot.mute),
    });
}

function appendSamplerRangeControl(container, instrumentId, slotId, options) {
    const { key, label, min, max, step, value, format } = options;

    const control = document.createElement('div');
    control.className = 'param-control sampler-param-control';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    control.appendChild(labelEl);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    control.appendChild(input);

    const badge = document.createElement('span');
    badge.className = 'param-value';
    badge.textContent = format(value);
    control.appendChild(badge);

    const api = { input, badge, onCommit: null };

    input.addEventListener('input', () => {
        const parsed = clampValue(Number(input.value), min, max);
        input.value = String(parsed);
        badge.textContent = format(parsed);
        socketState.suppressedInstrumentUpdates.set(instrumentId, Date.now() + 250);
        if (typeof api.onCommit === 'function') {
            api.onCommit(parsed);
        } else {
            updateSamplerSlotLocal(instrumentId, slotId, { [key]: parsed });
            emitSamplerParamUpdate(instrumentId, slotId, { [key]: parsed });
        }
    });

    container.appendChild(control);
    return api;
}

function appendSamplerToggleControl(container, instrumentId, slotId, options) {
    const { key, label, value } = options;
    const control = document.createElement('div');
    control.className = 'param-control sampler-toggle-control';

    const labelEl = document.createElement('label');
    labelEl.className = 'sampler-toggle-label';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(value);
    checkbox.addEventListener('change', () => {
        const next = Boolean(checkbox.checked);
        socketState.suppressedInstrumentUpdates.set(instrumentId, Date.now() + 250);
        updateSamplerSlotLocal(instrumentId, slotId, { [key]: next });
        emitSamplerParamUpdate(instrumentId, slotId, { [key]: next });
    });

    labelEl.appendChild(checkbox);
    const text = document.createElement('span');
    text.textContent = ` ${label}`;
    labelEl.appendChild(text);

    control.appendChild(labelEl);
    container.appendChild(control);
}

export function updateSamplerSlotLocal(instrumentId, slotId, updates) {
    const instrument = state.instruments.get(instrumentId);
    if (!instrument || instrument.type !== SynthTypes.SAMPLER) {
        return null;
    }
    if (!instrument.params || typeof instrument.params !== 'object') {
        instrument.params = { slots: {} };
    }
    if (!instrument.params.slots) {
        instrument.params.slots = {};
    }
    if (!instrument.params.slots[slotId]) {
        instrument.params.slots[slotId] = createDefaultSamplerSlot(slotId);
    }
    const slot = instrument.params.slots[slotId];
    Object.entries(updates || {}).forEach(([key, value]) => {
        if (key === 'sample') {
            slot.sample = value ? { ...value } : null;
        } else {
            slot[key] = value;
        }
    });
    return slot;
}

export function emitSamplerParamUpdate(instrumentId, slotId, updates) {
    if (!instrumentId || !slotId || !updates || typeof updates !== 'object') {
        return;
    }
    if (!state.isInRoom) {
        return;
    }
    if (!socket) return;

    socket.emit('instrument:param', {
        instrumentId,
        params: {
            slots: {
                [slotId]: updates,
            },
        },
    });
}

export function handleSamplerFileUpload(instrumentId, slotId, file) {
    if (!validateSamplerFile(file)) {
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        const result = reader.result;
        if (!(result instanceof ArrayBuffer)) {
            window.alert('Unable to read the selected audio file.');
            return;
        }
        const base64 = arrayBufferToBase64(result);
        const sampleMeta = {
            name: file.name,
            mimeType: file.type || 'audio/wav',
            data: base64,
            bytesLength: file.size,
            updatedAt: Date.now(),
        };
        updateSamplerSlotLocal(instrumentId, slotId, { sample: sampleMeta });
        const instrument = state.instruments.get(instrumentId);
        if (instrument) {
            import('../audio/instruments/sampler.js').then(({ prepareSamplerAudio }) => {
                prepareSamplerAudio(instrument);
            });
            renderInstrument(instrumentId);
        }
        emitSamplerParamUpdate(instrumentId, slotId, { sample: sampleMeta });
    };
    reader.onerror = () => {
        window.alert('Failed to read the selected audio file.');
    };
    reader.readAsArrayBuffer(file);
}

export function handleSamplerSampleClear(instrumentId, slotId) {
    updateSamplerSlotLocal(instrumentId, slotId, { sample: null });
    import('../audio/instruments/sampler.js').then(({ samplerSlotKey }) => {
        const key = samplerSlotKey(instrumentId, slotId);
        audioState.samplerBuffers.delete(key);
        audioState.pendingSamplerLoads.delete(key);
    });
    renderInstrument(instrumentId);
    emitSamplerParamUpdate(instrumentId, slotId, { sample: null });
}

export function enableSamplerSlotDrop(target, instrumentId, slotId, infoLabel) {
    const highlight = () => target.classList.add('drag-over');
    const clearHighlight = () => target.classList.remove('drag-over');

    target.addEventListener('dragenter', (event) => {
        event.preventDefault();
        highlight();
    });
    target.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    });
    target.addEventListener('dragleave', () => {
        clearHighlight();
    });
    target.addEventListener('dragend', () => {
        clearHighlight();
    });
    target.addEventListener('drop', (event) => {
        event.preventDefault();
        clearHighlight();
        const files = event.dataTransfer?.files;
        if (!files || !files.length) {
            return;
        }
        const file = files[0];
        if (!file) {
            return;
        }
        if (!validateSamplerFile(file)) {
            return;
        }
        handleSamplerFileUpload(instrumentId, slotId, file);
    });

    if (infoLabel) {
        target.addEventListener('dragenter', () => {
            infoLabel.dataset.previousText = infoLabel.textContent || '';
            infoLabel.textContent = 'Release to upload';
        });
        target.addEventListener('dragleave', () => {
            if (infoLabel.dataset.previousText) {
                infoLabel.textContent = infoLabel.dataset.previousText;
                delete infoLabel.dataset.previousText;
            }
        });
        target.addEventListener('drop', () => {
            if (infoLabel.dataset.previousText) {
                infoLabel.textContent = infoLabel.dataset.previousText;
                delete infoLabel.dataset.previousText;
            }
        });
    }
}

export function validateSamplerFile(file) {
    if (!file) {
        return false;
    }
    if (file.size > SAMPLER_MAX_SAMPLE_BYTES) {
        const limitMb = (SAMPLER_MAX_SAMPLE_BYTES / (1024 * 1024)).toFixed(1);
        window.alert(`Please choose a file smaller than ${limitMb} MB.`);
        return false;
    }
    if (file.type) {
        if (!SAMPLER_ALLOWED_MIME_TYPES.includes(file.type)) {
            window.alert('Unsupported audio format. Please use WAV or MP3 files.');
            return false;
        }
    } else {
        const extension = (file.name || '').toLowerCase().split('.').pop();
        if (!['wav', 'mp3'].includes(extension)) {
            window.alert('Unsupported audio format. Please use WAV or MP3 files.');
            return false;
        }
    }
    return true;
}

// Parameter controls
export function renderParamControls(container, instrument, definition) {
    container.innerHTML = '';
    if (instrument.type === SynthTypes.SAMPLER) {
        renderSamplerParamControls(container, instrument, definition);
        return;
    }
    (definition.params || []).forEach((paramDef) => {
        const control = document.createElement('div');
        control.className = 'param-control';

        const label = document.createElement('label');
        label.htmlFor = `${instrument.id}-${paramDef.key}`;
        label.textContent = paramDef.label;

        control.appendChild(label);

        if (paramDef.type === 'range') {
            const input = document.createElement('input');
            input.type = 'range';
            input.min = String(paramDef.min);
            input.max = String(paramDef.max);
            input.step = String(paramDef.step ?? 0.01);
            const initialValue = resolveInstrumentParamValue(instrument, paramDef);
            input.value = String(initialValue);
            input.id = `${instrument.id}-${paramDef.key}`;

            const valueBadge = document.createElement('span');
            valueBadge.textContent = formatParamDisplay(initialValue, paramDef);
            valueBadge.style.fontSize = '0.75rem';
            valueBadge.style.opacity = '0.8';

            input.addEventListener('input', () => {
                let numericValue = Number(input.value);
                if (!Number.isFinite(numericValue)) {
                    const resetValue = resolveInstrumentParamValue(instrument, paramDef);
                    input.value = String(resetValue);
                    valueBadge.textContent = formatParamDisplay(resetValue, paramDef);
                    return;
                }

                numericValue = clampValue(numericValue, paramDef.min, paramDef.max);
                input.value = String(numericValue);
                valueBadge.textContent = formatParamDisplay(numericValue, paramDef);

                if (!instrument.params || typeof instrument.params !== 'object') {
                    instrument.params = {};
                }

                if (instrument.type === SynthTypes.TR808) {
                    if (paramDef.key === 'tone') {
                        instrument.params.tone = numericValue;
                        instrument.params.hatTone = numericValue;
                        if (!instrument.params.hat || typeof instrument.params.hat !== 'object') {
                            instrument.params.hat = {};
                        }
                        instrument.params.hat.tone = numericValue;
                    } else if (paramDef.key === 'volume') {
                        instrument.params.volume = numericValue;
                        if (!instrument.params.master || typeof instrument.params.master !== 'object') {
                            instrument.params.master = {};
                        }
                        instrument.params.master.volume = numericValue;
                    } else if (paramDef.key === 'kickLevel' || paramDef.key === 'snareLevel' || paramDef.key === 'hatLevel' || paramDef.key === 'clapLevel') {
                        instrument.params[paramDef.key] = numericValue;
                        const groupMap = {
                            kickLevel: 'kick',
                            snareLevel: 'snare',
                            hatLevel: 'hat',
                            clapLevel: 'clap',
                        };
                        const groupKey = groupMap[paramDef.key];
                        if (groupKey) {
                            if (!instrument.params[groupKey] || typeof instrument.params[groupKey] !== 'object') {
                                instrument.params[groupKey] = {};
                            }
                            instrument.params[groupKey].level = numericValue;
                        }
                    } else {
                        instrument.params[paramDef.key] = numericValue;
                    }
                } else {
                    instrument.params[paramDef.key] = numericValue;
                }

                updateSidebarEntry(instrument.id);

                const paramsPayload = createInstrumentParamUpdate(instrument, paramDef, numericValue);
                if (!paramsPayload) {
                    return;
                }

                if (!socket) return;
                socketState.suppressedInstrumentUpdates.set(instrument.id, Date.now() + 250);
                socket.emit('instrument:param', {
                    instrumentId: instrument.id,
                    params: paramsPayload,
                });
            });

            control.appendChild(input);
            control.appendChild(valueBadge);
        } else if (paramDef.type === 'select') {
            const select = document.createElement('select');
            select.id = `${instrument.id}-${paramDef.key}`;
            (paramDef.options || []).forEach((option) => {
                const opt = document.createElement('option');
                opt.value = option.value;
                opt.textContent = option.label;
                select.appendChild(opt);
            });
            select.value = instrument.params[paramDef.key] ?? paramDef.options?.[0]?.value ?? '';
            select.addEventListener('change', () => {
                if (!socket) return;
                socket.emit('instrument:param', {
                    instrumentId: instrument.id,
                    params: { [paramDef.key]: select.value },
                });
            });
            control.appendChild(select);
        }

        container.appendChild(control);
    });
}

export function resolveInstrumentParamValue(instrument, paramDef) {
    const params = instrument.params || {};
    let rawValue = params[paramDef.key];

    if (instrument.type === SynthTypes.TR808 && paramDef.key === 'tone') {
        rawValue = params.hatTone ?? params.tone ?? params?.hat?.tone ?? rawValue;
    }

    return clampValue(rawValue, paramDef.min, paramDef.max);
}

export function createInstrumentParamUpdate(instrument, paramDef, value) {
    if (instrument.type === SynthTypes.TR808 && paramDef.key === 'tone') {
        if (!Number.isFinite(value)) {
            return null;
        }
        return { hat: { tone: value }, tone: value };
    }

    if (!Number.isFinite(value)) {
        return null;
    }

    return { [paramDef.key]: value };
}

// Step grid rendering
export function renderStepGrid(container, instrument) {
    if (activePitchPopup) {
        closePitchPopup({ commit: false });
    }
    if (instrument.type === SynthTypes.TR808) {
        renderDrumStepGrid(container, instrument);
    } else if (instrument.type === SynthTypes.SAMPLER) {
        renderSamplerStepGrid(container, instrument);
    } else {
        renderMelodicStepGrid(container, instrument);
    }
}

export function renderMelodicStepGrid(container, instrument) {
    container.innerHTML = '';
    const steps = instrument.steps || [];
    const entry = socketState.instrumentElements.get(instrument.id);
    const instrumentStepCount = clampStepCount(instrument.stepCount ?? (Array.isArray(steps) ? steps.length : STEP_COUNT));
    const visibleSteps = getVisibleStepSlots(instrumentStepCount);
    const activeSteps = instrumentStepCount;
    const stepRefs = [];

    for (let i = 0; i < visibleSteps; i += 1) {
        const patternIndex = i;
        const withinPattern = patternIndex < activeSteps;

        let step = steps[patternIndex];
        if (!step && withinPattern) {
            step = createEmptyMelodicStep();
            steps[patternIndex] = step;
        } else if (!step) {
            step = createEmptyMelodicStep();
        }

        const cell = document.createElement('div');
        cell.className = 'step-cell';

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'step-toggle';
        toggleBtn.dataset.stepIndex = String(patternIndex);

        const note = document.createElement('span');
        note.className = 'step-note';
        note.textContent = step.pitch || '—';

        const indexLabel = document.createElement('span');
        indexLabel.className = 'step-index';
        indexLabel.textContent = formatStepIndex(i, visibleSteps);

        toggleBtn.appendChild(note);
        toggleBtn.appendChild(indexLabel);

        const isActive = withinPattern && Boolean(step.active);
        toggleBtn.classList.toggle('active', isActive);
        toggleBtn.disabled = !withinPattern;
        cell.classList.toggle('active', isActive);
        cell.classList.toggle('step-disabled', !withinPattern);

        if (withinPattern) {
            toggleBtn.addEventListener('click', () => {
                const nextActive = !step.active;
                step.active = nextActive;
                toggleBtn.classList.toggle('active', nextActive);
                cell.classList.toggle('active', nextActive);
                if (!socket) return;
                socket.emit('instrument:step', {
                    instrumentId: instrument.id,
                    stepIndex: patternIndex,
                    step: { active: nextActive },
                });
            });
        }

        const pitchSelect = createPitchSelect(step.pitch || 'C3');
        const initialPitch = step.pitch || pitchSelect.dataset.pitch || 'C3';
        pitchSelect.dataset.pitch = initialPitch;
        pitchSelect.textContent = initialPitch;
        if (withinPattern) {
            step.pitch = initialPitch;
            note.textContent = initialPitch;
            const handlePitchPopupTrigger = (event) => {
                event.preventDefault();
                event.stopPropagation();
                openPitchPopup({
                    anchorEl: pitchSelect,
                    noteEl: note,
                    selectEl: pitchSelect,
                    step,
                    instrumentId: instrument.id,
                    stepIndex: patternIndex,
                });
            };
            pitchSelect.addEventListener('click', handlePitchPopupTrigger);
            pitchSelect.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    handlePitchPopupTrigger(event);
                }
            });
        } else {
            pitchSelect.disabled = true;
            pitchSelect.classList.add('step-select-disabled');
        }

        cell.appendChild(toggleBtn);
        cell.appendChild(pitchSelect);
        container.appendChild(cell);

        const baseDisabled = !withinPattern;
        stepRefs.push({
            cell,
            toggleBtn,
            pitchSelect,
            disabled: baseDisabled,
            baseDisabled,
        });
    }

    if (entry) {
        entry.stepRefs = stepRefs;
    }
}

export function renderDrumStepGrid(container, instrument) {
    container.innerHTML = '';
    const steps = instrument.steps || [];
    const instrumentStepCount = clampStepCount(instrument.stepCount ?? (Array.isArray(steps) ? steps.length : STEP_COUNT));
    const visibleSteps = getVisibleStepSlots(instrumentStepCount);
    const activeSteps = instrumentStepCount;
    const entry = socketState.instrumentElements.get(instrument.id);
    if (!entry) {
        return;
    }
    const activeDrum = entry?.activeDrum || TR808_DRUMS[0].id;
    const stepRefs = [];

    for (let i = 0; i < visibleSteps; i += 1) {
        const patternIndex = i;
        const withinPattern = patternIndex < activeSteps;
        const baseStep = createEmptyDrumStep();
        const originalStep = steps[patternIndex] || createEmptyDrumStep();
        originalStep.layers = { ...baseStep.layers, ...(originalStep.layers || {}) };
        if (!steps[patternIndex] && withinPattern) {
            steps[patternIndex] = originalStep;
        }
        const step = originalStep;

        const cell = document.createElement('div');
        cell.className = 'step-cell drum-cell';
        const drumMeta = TR808_DRUMS.find((drum) => drum.id === activeDrum) || TR808_DRUMS[0];
        const isActive = withinPattern && Boolean(step.layers[activeDrum]);
        step.active = TR808_DRUMS.some((drum) => step.layers[drum.id]);
        const activeBackground = hexToRgba(drumMeta.color, 0.25) || 'rgba(56, 189, 248, 0.22)';
        cell.style.setProperty('--drum-color', drumMeta.color);
        cell.style.setProperty('--drum-active-bg', activeBackground);
        cell.classList.toggle('active', isActive);
        cell.classList.toggle('drum-active', isActive);
        cell.classList.toggle('step-disabled', !withinPattern);

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'step-toggle drum-step-toggle';
        toggleBtn.dataset.stepIndex = String(patternIndex);
        toggleBtn.disabled = !withinPattern;

        const indicator = document.createElement('span');
        indicator.className = 'drum-indicator';
        indicator.style.setProperty('--drum-color', drumMeta.color);
        indicator.classList.toggle('active', isActive);

        const indexLabel = document.createElement('span');
        indexLabel.className = 'step-index';
        indexLabel.textContent = formatStepIndex(i, visibleSteps);

        toggleBtn.appendChild(indicator);
        toggleBtn.appendChild(indexLabel);

        toggleBtn.addEventListener('click', () => {
            if (!withinPattern) {
                return;
            }
            const currentDrum = entry.activeDrum || TR808_DRUMS[0].id;
            const current = Boolean(step.layers[currentDrum]);
            const next = !current;
            step.layers[currentDrum] = next;

            const drumInfo = TR808_DRUMS.find((d) => d.id === currentDrum) || drumMeta;
            const selectedColor = drumInfo.color;
            indicator.style.setProperty('--drum-color', selectedColor);
            const selectedBackground = hexToRgba(selectedColor, 0.25) || activeBackground;

            const isActiveNow = Boolean(step.layers[currentDrum]);
            indicator.classList.toggle('active', isActiveNow && currentDrum === entry.activeDrum);
            cell.style.setProperty('--drum-color', selectedColor);
            cell.style.setProperty('--drum-active-bg', selectedBackground);
            cell.classList.toggle('drum-active', isActiveNow && currentDrum === entry.activeDrum);
            cell.classList.toggle('active', isActiveNow && currentDrum === entry.activeDrum);

            step.active = TR808_DRUMS.some((drum) => step.layers[drum.id]);

            if (!socket) return;
            socket.emit('instrument:step', {
                instrumentId: instrument.id,
                stepIndex: patternIndex,
                drum: currentDrum,
                value: next,
            });
        });

        cell.appendChild(toggleBtn);
        container.appendChild(cell);

        const baseDisabled = !withinPattern;
        stepRefs.push({
            cell,
            toggleBtn,
            indicator,
            disabled: baseDisabled,
            baseDisabled,
        });
    }

    if (entry) {
        entry.stepRefs = stepRefs;
    }
}

export function renderSamplerStepGrid(container, instrument) {
    container.innerHTML = '';
    const steps = instrument.steps || [];
    const instrumentStepCount = clampStepCount(instrument.stepCount ?? (Array.isArray(steps) ? steps.length : STEP_COUNT));
    const visibleSteps = getVisibleStepSlots(instrumentStepCount);
    const entry = socketState.instrumentElements.get(instrument.id);
    if (!entry) {
        return;
    }
    const activeSlot = entry.activeSamplerSlot && SAMPLER_SLOT_IDS.includes(entry.activeSamplerSlot)
        ? entry.activeSamplerSlot
        : SAMPLER_SLOT_IDS[0];
    const slotMeta = SAMPLER_SLOT_CONFIG.find((slot) => slot.id === activeSlot) || SAMPLER_SLOT_CONFIG[0];
    const stepRefs = [];

    for (let i = 0; i < visibleSteps; i += 1) {
        const patternIndex = i;
        const withinPattern = patternIndex < instrumentStepCount;
        const base = createEmptySamplerStep();
        const existing = steps[patternIndex] ? normalizeSamplerStep(steps[patternIndex]) : base;
        if (!steps[patternIndex]) {
            steps[patternIndex] = existing;
        }

        const isActive = withinPattern && Boolean(existing.slots[activeSlot]);
        const cell = document.createElement('div');
        cell.className = 'step-cell sampler-cell';
        cell.classList.toggle('active', isActive);
        cell.classList.toggle('step-disabled', !withinPattern);
        cell.style.setProperty('--sampler-color', slotMeta.color);

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'step-toggle sampler-step-toggle';
        toggleBtn.dataset.stepIndex = String(patternIndex);
        toggleBtn.disabled = !withinPattern;

        const indicator = document.createElement('span');
        indicator.className = 'sampler-indicator';
        indicator.style.setProperty('--sampler-color', slotMeta.color);
        indicator.classList.toggle('active', isActive);

        const indexLabel = document.createElement('span');
        indexLabel.className = 'step-index';
        indexLabel.textContent = formatStepIndex(i, visibleSteps);

        toggleBtn.appendChild(indicator);
        toggleBtn.appendChild(indexLabel);

        toggleBtn.addEventListener('click', () => {
            if (!withinPattern) {
                return;
            }
            const nextValue = !existing.slots[activeSlot];
            existing.slots[activeSlot] = nextValue;
            existing.active = Object.values(existing.slots).some(Boolean);
            indicator.classList.toggle('active', nextValue);
            cell.classList.toggle('active', nextValue);
            if (!socket) return;
            socket.emit('instrument:step', {
                instrumentId: instrument.id,
                stepIndex: patternIndex,
                slot: activeSlot,
                value: nextValue,
            });
        });

        cell.appendChild(toggleBtn);
        container.appendChild(cell);
        const baseDisabled = !withinPattern;
        stepRefs.push({
            cell,
            toggleBtn,
            indicator,
            disabled: baseDisabled,
            baseDisabled,
        });
    }

    entry.stepRefs = stepRefs;
}
