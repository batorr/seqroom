// Instrument Card Module
// Handles rendering and management of instrument cards

import { state, setInstrumentStepCountLocal, ensureLocalInstrumentCapacity, normalizeSamplerStep, updateInstrumentName, sanitizeInstrumentName } from '../state/main.js';
import { audioState, socketState } from '../state/audio.js';

export function isInstrumentMuted(instrumentId) {
    return audioState.mutedInstruments.has(instrumentId);
}

export function setInstrumentMuted(instrumentId, muted) {
    if (muted) {
        audioState.mutedInstruments.add(instrumentId);
    } else {
        audioState.mutedInstruments.delete(instrumentId);
    }
}
import { NOTE_OPTIONS } from '../constants/audio.js';
import { STEP_COUNT, STEP_GRID_COLUMNS } from '../constants/ui.js';
import { computeSlurs } from '../shared/slurs.js';
import { randomAcidLine } from '../shared/acid-line.js';
import { randomRumbleLine, dominantPitchClass, RUMBLE_DEFAULT_PITCH } from '../shared/rumble.js';
import { randomStabLine, STAB_DEFAULT_PITCH } from '../shared/rave-stab.js';
import { randomHooverLine, HOOVER_DEFAULT_PITCH } from '../shared/hoover.js';
import { randomFxLine, FX_DEFAULT_LANE } from '../shared/fx.js';
import { SynthTypes, DRUM_VOICES, FX_VOICES, DRUM_VOICE_PARAM_DEFS, SAMPLER_SLOT_IDS, SAMPLER_SLOT_CONFIG, SAMPLER_MAX_SAMPLE_BYTES, SAMPLER_ALLOWED_MIME_TYPES } from '../constants/instruments.js';
import { INSTRUMENT_LIBRARY } from '../constants/instruments.js';
import {
    clampStepCount,
    clampValue,
    formatStepCountLabel,
    formatParamDisplay,
    formatBytes,
    createPitchSelect,
    createEmptyMelodicStep,
    createEmptyDrumStep,
    createEmptyFxStep,
    createEmptySamplerStep,
    createDefaultSamplerSlot
} from '../utils/helpers.js';
import {
    instrumentTemplate,
    instrumentEmptyEl,
    inspectorTemplate,
    instrumentInspectorEl,
    inspectorEmptyEl,
    scoreMetaEl,
    scoreRulerCells,
    positionBarEl,
    positionBeatEl,
    positionStepEl,
} from './main.js';

const PITCH_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// The score only holds NOTE_OPTIONS (C1–B5); anything outside is reset to C3.
const PITCH_OCTAVE_MIN = 1;
const PITCH_OCTAVE_MAX = 5;
let activePitchPopup = null;

const COLLAPSE_STORAGE_PREFIX = 'seqroom:collapsed:';

function getCollapseStorageKey(instrumentId) {
    if (instrumentId === null || instrumentId === undefined) {
        return null;
    }
    return `${COLLAPSE_STORAGE_PREFIX}${instrumentId}`;
}

export function loadCollapsedState(instrumentId) {
    const key = getCollapseStorageKey(instrumentId);
    if (!key) {
        return false;
    }
    if (typeof window === 'undefined' || !window.localStorage) {
        return false;
    }
    try {
        const value = window.localStorage.getItem(key);
        return value === 'true';
    } catch (error) {
        return false;
    }
}

export function saveCollapsedState(instrumentId, collapsed) {
    const key = getCollapseStorageKey(instrumentId);
    if (!key) {
        return;
    }
    if (typeof window === 'undefined' || !window.localStorage) {
        return;
    }
    try {
        window.localStorage.setItem(key, collapsed ? 'true' : 'false');
    } catch (error) {
        // Ignore storage access issues
    }
}

function removeCollapsedState(instrumentId) {
    const key = getCollapseStorageKey(instrumentId);
    if (!key) {
        return;
    }
    if (typeof window === 'undefined' || !window.localStorage) {
        return;
    }
    try {
        window.localStorage.removeItem(key);
    } catch (error) {
        // Ignore storage access issues
    }
}

function sanitizeForDomId(value) {
    return String(value ?? '')
        .replace(/[^A-Za-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}

function hashForDom(value) {
    const text = String(value ?? '');
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
        hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
}

function getSynthBodyId(instrumentId) {
    const sanitized = sanitizeForDomId(instrumentId);
    const hash = hashForDom(instrumentId);
    const base = sanitized || 'body';
    return `synth-body-${base}-${hash}`;
}

function ensureCollapseBindings(entry, instrumentId) {
    if (!entry) {
        return;
    }

    const body = entry.bodyContainer || entry.root?.querySelector('.synth-body');
    if (body && !entry.bodyContainer) {
        entry.bodyContainer = body;
    }
    if (entry.bodyContainer) {
        const storedInstrument = entry.bodyContainer.dataset.instrumentBodyId;
        const expectedInstrument = String(instrumentId ?? '');
        if (!entry.bodyContainer.id || storedInstrument !== expectedInstrument) {
            const domId = getSynthBodyId(instrumentId);
            entry.bodyContainer.id = domId;
            entry.bodyContainer.dataset.instrumentBodyId = expectedInstrument;
        }
    }

    const toggle = entry.collapseButton || entry.root?.querySelector('.collapse-toggle');
    if (toggle && !entry.collapseButton) {
        entry.collapseButton = toggle;
    }

    if (entry.collapseButton && entry.bodyContainer?.id) {
        entry.collapseButton.setAttribute('aria-controls', entry.bodyContainer.id);
    }
}

function applyCollapseState(entry, instrumentId, collapsed, { persist = false } = {}) {
    if (!entry?.root) {
        return;
    }

    ensureCollapseBindings(entry, instrumentId);
    const isCollapsed = Boolean(collapsed);
    entry.root.classList.toggle('collapsed', isCollapsed);

    if (entry.bodyContainer) {
        entry.bodyContainer.setAttribute('aria-hidden', isCollapsed ? 'true' : 'false');
    }
    if (entry.collapseButton) {
        entry.collapseButton.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        entry.collapseButton.setAttribute('aria-label', isCollapsed ? 'Expand instrument' : 'Collapse instrument');
    }

    entry.isCollapsed = isCollapsed;

    if (persist) {
        saveCollapsedState(instrumentId, isCollapsed);
    }
}

function bindCollapseToggle(entry, instrumentId) {
    if (!entry?.collapseButton) {
        return;
    }
    if (entry.collapseButton.dataset.collapseBound === 'true') {
        return;
    }
    entry.collapseButton.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        const currentEntry = socketState.instrumentElements.get(instrumentId) || entry;
        const nextCollapsed = !(currentEntry.root?.classList.contains('collapsed'));
        applyCollapseState(currentEntry, instrumentId, nextCollapsed, { persist: true });
    });
    entry.collapseButton.dataset.collapseBound = 'true';
}

// Helper functions
export function getVisibleStepSlots(stepCount) {
    const effective = clampStepCount(stepCount ?? STEP_COUNT);
    const rows = Math.max(1, Math.ceil(effective / STEP_GRID_COLUMNS));
    return rows * STEP_GRID_COLUMNS;
}

// Instruments whose steps hold one boolean per lane: the Rave Kit's voices
// and the FX lanes. The lane picked in the score is entry.activeDrum.
const LANE_VOICES = { [SynthTypes.DRUMS]: DRUM_VOICES, [SynthTypes.FX]: FX_VOICES };
const LANE_EMPTY_STEP = { [SynthTypes.DRUMS]: createEmptyDrumStep, [SynthTypes.FX]: createEmptyFxStep };
const LANE_DEFAULT = { [SynthTypes.DRUMS]: DRUM_VOICES[0].id, [SynthTypes.FX]: FX_DEFAULT_LANE };

function laneFor(type, activeDrum) {
    const voices = LANE_VOICES[type] || [];
    return voices.some((voice) => voice.id === activeDrum) ? activeDrum : LANE_DEFAULT[type];
}

function _areAllStepsFilled(instrument, stepCount, activeDrum, activeSamplerSlot) {
    const steps = instrument.steps;
    if (!Array.isArray(steps)) return false;
    if (LANE_VOICES[instrument.type]) {
        const drum = laneFor(instrument.type, activeDrum);
        for (let i = 0; i < stepCount; i++) {
            if (!steps[i]?.layers?.[drum]) return false;
        }
    } else if (instrument.type === SynthTypes.SAMPLER) {
        const slot = activeSamplerSlot || SAMPLER_SLOT_IDS[0];
        for (let i = 0; i < stepCount; i++) {
            if (!steps[i]?.slots?.[slot]) return false;
        }
    } else {
        for (let i = 0; i < stepCount; i++) {
            if (!steps[i]?.active) return false;
        }
    }
    return true;
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

    // Each column shows its value with the next value up above it and the
    // next value down below it; on touch screens those neighbours are visible
    // and tappable, and a vertical swipe walks through the values.
    const createPitchColumn = (field, label) => {
        const column = document.createElement('div');
        column.className = `pitch-popup__column pitch-popup__column--${field}`;
        const up = document.createElement('div');
        up.className = 'pitch-popup__neighbor';
        up.dataset.step = '1';
        const value = document.createElement('div');
        value.className = 'pitch-popup__value';
        const down = document.createElement('div');
        down.className = 'pitch-popup__neighbor';
        down.dataset.step = '-1';
        const labelEl = document.createElement('div');
        labelEl.className = 'pitch-popup__label';
        labelEl.textContent = label;
        column.append(up, value, down, labelEl);
        return { column, up, value, down };
    };

    const noteParts = createPitchColumn('note', 'NOTE');
    const octaveParts = createPitchColumn('octave', 'OCTAVE');
    const noteColumn = noteParts.column;
    const octaveColumn = octaveParts.column;

    columns.append(noteColumn, octaveColumn);
    container.appendChild(columns);

    const isTouch = window.matchMedia?.('(pointer: coarse)').matches;
    const hint = document.createElement('div');
    hint.className = 'pitch-popup__hint';
    hint.textContent = isTouch
        ? 'Swipe up or down · tap outside to apply'
        : 'Scroll, drag or arrow keys · click outside to apply';
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
        noteParts.value.textContent = PITCH_NOTE_NAMES[normalizeNoteIndex(noteIndex)];
        noteParts.up.textContent = PITCH_NOTE_NAMES[normalizeNoteIndex(noteIndex + 1)];
        noteParts.down.textContent = PITCH_NOTE_NAMES[normalizeNoteIndex(noteIndex - 1)];
        octaveParts.value.textContent = String(clampOctave(octave));
        octaveParts.up.textContent = octave < PITCH_OCTAVE_MAX ? String(octave + 1) : '';
        octaveParts.down.textContent = octave > PITCH_OCTAVE_MIN ? String(octave - 1) : '';
    };
    updateDisplay();

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

    // Swipe (or drag with a mouse) up to raise, down to lower: one step per
    // stretch of travel, so a long swipe runs through several values. A tap
    // on a neighbour value moves one step towards it.
    const SWIPE_STEP_PX = { note: 22, octave: 36 };
    const TAP_SLOP_PX = 6;
    const attachSwipe = (column, field, adjust) => {
        let drag = null;
        column.addEventListener('pointerdown', (event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) {
                return;
            }
            event.preventDefault();
            setActiveField(field);
            try {
                column.setPointerCapture(event.pointerId);
            } catch {
                // Pointer already gone; the drag still works while over the column.
            }
            const neighbor = event.target.closest?.('[data-step]');
            drag = {
                id: event.pointerId,
                startY: event.clientY,
                anchorY: event.clientY,
                moved: false,
                tapStep: neighbor && neighbor.textContent ? Number(neighbor.dataset.step) : 0,
            };
        });
        column.addEventListener('pointermove', (event) => {
            if (!drag || event.pointerId !== drag.id) {
                return;
            }
            if (Math.abs(event.clientY - drag.startY) > TAP_SLOP_PX) {
                drag.moved = true;
            }
            const stepPx = SWIPE_STEP_PX[field];
            const steps = Math.trunc((drag.anchorY - event.clientY) / stepPx);
            if (steps !== 0) {
                adjust(steps);
                drag.anchorY -= steps * stepPx;
            }
        });
        const endDrag = (event) => {
            if (!drag || event.pointerId !== drag.id) {
                return;
            }
            if (event.type === 'pointerup' && !drag.moved && drag.tapStep) {
                adjust(drag.tapStep);
            }
            drag = null;
        };
        column.addEventListener('pointerup', endDrag);
        column.addEventListener('pointercancel', endDrag);
    };
    attachSwipe(noteColumn, 'note', adjustNote);
    attachSwipe(octaveColumn, 'octave', adjustOctave);

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
            setPitchButtonLabel(selectEl, stepIndex, pitchValue);
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
}).catch(console.error);

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

// Parameter changes are sent at most every 50 ms per instrument (plus the
// final value), so sweeping a knob live stays within the server's limits.
const PARAM_SEND_INTERVAL_MS = 50;
const pendingParamSends = new Map();

function emitInstrumentParams(instrumentId, params) {
    let pending = pendingParamSends.get(instrumentId);
    if (!pending) {
        pending = { params: {}, timer: null, lastSent: -Infinity };
        pendingParamSends.set(instrumentId, pending);
    }
    Object.assign(pending.params, params);
    const flush = () => {
        pending.timer = null;
        pending.lastSent = performance.now();
        const payload = pending.params;
        pending.params = {};
        if (socket && Object.keys(payload).length) {
            socket.emit('instrument:param', { instrumentId, params: payload });
        }
    };
    if (pending.timer) {
        return;
    }
    const wait = pending.lastSent + PARAM_SEND_INTERVAL_MS - performance.now();
    if (wait <= 0) {
        flush();
    } else {
        pending.timer = setTimeout(flush, wait);
    }
}

// Random drums for acid techno: a relentless four-on-the-floor kick, claps on
// the backbeat, open hats on the offbeat, driving 16th hats, a running ride,
// and the odd syncopated rim or snare.
function randomDrumHits(stepIndex) {
    const pos = stepIndex % 16;
    const chance = (p) => Math.random() < p;
    const onBeat = pos % 4 === 0;
    const offBeat = pos % 4 === 2;
    const backbeat = pos === 4 || pos === 12;
    const openhat = offBeat && chance(0.85);
    return {
        kick: onBeat,
        snare: backbeat ? chance(0.35) : chance(pos >= 13 ? 0.15 : 0.03),
        clap: backbeat ? chance(0.85) : chance(0.02),
        rim: !onBeat && chance(0.12),
        hat: !openhat && chance(0.75),
        openhat,
        ride: chance(pos % 2 === 0 ? 0.45 : 0.15),
    };
}

// The pitch Fill's Clear resets a melodic step to, per instrument type.
const FILL_CLEAR_PITCH = {
    [SynthTypes.TB303]: 'C2',
    [SynthTypes.POLY]: 'C4',
    [SynthTypes.RUMBLE]: RUMBLE_DEFAULT_PITCH,
    [SynthTypes.STAB]: STAB_DEFAULT_PITCH,
    [SynthTypes.HOOVER]: HOOVER_DEFAULT_PITCH,
};

// What Random follows in the room: the first Rave Kit's kick lane (so every
// rumble hit ducks with a kick) and the acid basslines' most common note
// (the key for the rumble, the stabs and the hoover).
function roomRollContext() {
    const instruments = state.instrumentOrder.map((id) => state.instruments.get(id)).filter(Boolean);
    const kit = instruments.find((instrument) => instrument.type === SynthTypes.DRUMS);
    const kicks = kit
        ? (kit.steps || []).slice(0, clampStepCount(kit.stepCount ?? STEP_COUNT)).map((step) => Boolean(step?.layers?.kick))
        : null;
    const rootClass = dominantPitchClass(instruments.filter((instrument) => instrument.type === SynthTypes.TB303));
    return { kicks, rootClass };
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

    import('../audio/scheduler.js').then(({ getCurrentStepIndex }) => {
        updatePlaybackIndicators(getCurrentStepIndex());
    }).catch(console.error);
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

// The selected instrument is marked in the score and its settings fill the
// inspector below it; with nothing selected the first instrument is shown.
export function updateActiveInstrumentHighlight() {
    if (!state.activeInstrumentId || !state.instruments.has(state.activeInstrumentId)) {
        state.activeInstrumentId = state.instrumentOrder.find((id) => state.instruments.has(id)) || null;
    }
    socketState.instrumentElements.forEach((entry, instrumentId) => {
        const isActive = instrumentId === state.activeInstrumentId;
        entry.root.classList.toggle('active', isActive);
        if (entry.inspector) {
            entry.inspector.hidden = !isActive;
        }
    });
    if (inspectorEmptyEl) {
        inspectorEmptyEl.classList.toggle('hidden', Boolean(state.activeInstrumentId));
    }
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
    }).catch(console.error);
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

    const bodyContainer = node.querySelector('.synth-body');
    const collapseToggle = node.querySelector('.collapse-toggle');

    // The score row holds the steps; the inspector panel (shown while this
    // instrument is selected) holds its name, step controls and parameters.
    const inspector = inspectorTemplate.content.firstElementChild.cloneNode(true);
    inspector.dataset.instrumentId = instrument.id;
    inspector.hidden = true;
    instrumentInspectorEl.appendChild(inspector);

    const removeBtn = inspector.querySelector('.remove-instrument');
    removeBtn.addEventListener('click', () => {
        if (!socket) return;
        socket.emit('instrument:remove', { instrumentId: instrument.id });
    });

    node.addEventListener('click', () => {
        const targetId = node.dataset.instrumentId;
        if (targetId && state.activeInstrumentId !== targetId) {
            setActiveInstrument(targetId);
        }
    });

    const cardEntry = {
        root: node,
        inspector,
        bodyContainer,
        collapseButton: collapseToggle,
        paramsContainer: inspector.querySelector('.synth-params'),
        stepGrid: node.querySelector('.step-grid'),
        stepRefs: [],
        playingIndex: -1,
        drumSelector: null,
        activeDrum: 'kick',
        activeSamplerSlot: SAMPLER_SLOT_IDS[0],
        stepControl: null,
        rowNameEl: node.querySelector('.instrument-name'),
        nameEl: inspector.querySelector('.inspector-name'),
        typeEl: node.querySelector('.synth-type'),
        inspectorTypeEl: inspector.querySelector('.inspector-type'),
        renameButton: inspector.querySelector('.rename-instrument'),
        renameInput: null,
        removeButton: removeBtn,
        lockButton: null,
        fillButton: null,
        isCollapsed: false,
    };

    if (cardEntry.renameButton) {
        cardEntry.renameButton.addEventListener('click', (event) => {
            event.stopPropagation();
            beginInstrumentRename(instrument.id);
        });
    }
    [cardEntry.nameEl, cardEntry.rowNameEl].forEach((nameEl) => {
        nameEl?.addEventListener('dblclick', (event) => {
            event.stopPropagation();
            setActiveInstrument(instrument.id);
            beginInstrumentRename(instrument.id);
        });
    });

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

    const stepActionButtons = document.createElement('div');
    stepActionButtons.className = 'step-action-buttons';

    const fillBtn = document.createElement('button');
    fillBtn.type = 'button';
    fillBtn.className = 'step-action-button';
    fillBtn.textContent = 'Fill';
    fillBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const instr = state.instruments.get(instrumentId);
        if (!instr || !socket) return;
        const count = getCurrentStepCount();
        const clearing = _areAllStepsFilled(instr, count, cardEntry.activeDrum, cardEntry.activeSamplerSlot);
        if (LANE_VOICES[instr.type]) {
            const drum = laneFor(instr.type, cardEntry.activeDrum);
            for (let i = 0; i < count; i++) {
                socket.emit('instrument:step', { instrumentId, stepIndex: i, drum, value: !clearing });
            }
        } else if (instr.type === SynthTypes.SAMPLER) {
            const slot = cardEntry.activeSamplerSlot || SAMPLER_SLOT_IDS[0];
            for (let i = 0; i < count; i++) {
                socket.emit('instrument:step', { instrumentId, stepIndex: i, slot, value: !clearing });
            }
        } else {
            const defaultPitch = FILL_CLEAR_PITCH[instr.type] || 'C3';
            for (let i = 0; i < count; i++) {
                const step = clearing ? { active: false, pitch: defaultPitch } : { active: true };
                if (clearing && instr.type === SynthTypes.TB303) {
                    step.accent = false;
                    step.slide = false;
                }
                socket.emit('instrument:step', { instrumentId, stepIndex: i, step });
            }
        }
        fillBtn.textContent = clearing ? 'Fill' : 'Clear';
    });
    cardEntry.fillButton = fillBtn;

    const randomBtn = document.createElement('button');
    randomBtn.type = 'button';
    randomBtn.className = 'step-action-button';
    randomBtn.textContent = 'Random';
    randomBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const instr = state.instruments.get(instrumentId);
        if (!instr || !socket) return;
        const count = getCurrentStepCount();
        const randomNotes = instr.type === SynthTypes.POLY ? NOTE_OPTIONS.slice(12, 48) : NOTE_OPTIONS.slice(12, 36); // Poly: C2-B4, others: C2-B3
        if (instr.type === SynthTypes.DRUMS) {
            for (let i = 0; i < count; i++) {
                const hits = randomDrumHits(i);
                DRUM_VOICES.forEach(({ id: drum }) => {
                    const current = Boolean(instr.steps?.[i]?.layers?.[drum]);
                    if (current !== hits[drum]) {
                        socket.emit('instrument:step', { instrumentId, stepIndex: i, drum, value: hits[drum] });
                    }
                });
            }
        } else if (instr.type === SynthTypes.FX) {
            const line = randomFxLine(count, { length: instr.params?.length });
            line.steps.forEach((step, i) => {
                FX_VOICES.forEach(({ id: drum }) => {
                    const current = Boolean(instr.steps?.[i]?.layers?.[drum]);
                    if (current !== step.layers[drum]) {
                        socket.emit('instrument:step', { instrumentId, stepIndex: i, drum, value: step.layers[drum] });
                    }
                });
            });
            randomBtn.title = line.riserAt === null
                ? 'Last roll: drop on step 1 (riser longer than the pattern)'
                : `Last roll: drop on step 1, riser from step ${line.riserAt + 1}`;
        } else if (instr.type === SynthTypes.SAMPLER) {
            for (let i = 0; i < count; i++) {
                SAMPLER_SLOT_IDS.forEach(slot => {
                    socket.emit('instrument:step', { instrumentId, stepIndex: i, slot, value: Math.random() < 0.3 });
                });
            }
        } else if (instr.type === SynthTypes.TB303) {
            const line = randomAcidLine(count);
            line.steps.forEach((step, i) => {
                socket.emit('instrument:step', { instrumentId, stepIndex: i, step });
            });
            randomBtn.title = `Last roll: ${line.root} ${line.scale}`;
        } else if (instr.type === SynthTypes.RUMBLE) {
            const line = randomRumbleLine(count, roomRollContext());
            line.steps.forEach((step, i) => {
                socket.emit('instrument:step', { instrumentId, stepIndex: i, step });
            });
            randomBtn.title = `Last roll: ${line.pitch}`;
        } else if (instr.type === SynthTypes.STAB) {
            const line = randomStabLine(count, { rootClass: roomRollContext().rootClass });
            line.steps.forEach((step, i) => {
                socket.emit('instrument:step', { instrumentId, stepIndex: i, step });
            });
            randomBtn.title = `Last roll: ${line.root}, ${line.rhythm}`;
        } else if (instr.type === SynthTypes.HOOVER) {
            const line = randomHooverLine(count, { rootClass: roomRollContext().rootClass });
            line.steps.forEach((step, i) => {
                socket.emit('instrument:step', { instrumentId, stepIndex: i, step });
            });
            randomBtn.title = `Last roll: ${line.root}, ${line.rhythm}`;
        } else {
            const steps = Array.from({ length: count }, () => ({
                active: Math.random() < 0.5,
                pitch: randomNotes[Math.floor(Math.random() * randomNotes.length)],
            }));
            // Never leave a short pattern without a single note.
            if (count > 0 && !steps.some((step) => step.active)) {
                steps[0].active = true;
            }
            steps.forEach((step, i) => {
                socket.emit('instrument:step', { instrumentId, stepIndex: i, step });
            });
        }
    });

    stepActionButtons.append(fillBtn, randomBtn);
    controlsRow.appendChild(stepActionButtons);

    if (cardEntry.paramsContainer) {
        const parent = cardEntry.paramsContainer.parentElement || node;
        parent.insertBefore(controlsRow, cardEntry.paramsContainer);
    } else if (cardEntry.bodyContainer) {
        cardEntry.bodyContainer.insertBefore(controlsRow, cardEntry.bodyContainer.firstChild);
    } else {
        node.appendChild(controlsRow);
    }

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

    const muteButton = document.createElement('button');
    muteButton.type = 'button';
    muteButton.className = 'instrument-mute-button';
    muteButton.textContent = 'Mute';
    muteButton.setAttribute('aria-label', 'Mute instrument');
    muteButton.setAttribute('aria-pressed', 'false');
    muteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const next = !isInstrumentMuted(instrument.id);
        setInstrumentMuted(instrument.id, next);
        muteButton.classList.toggle('is-muted', next);
        muteButton.setAttribute('aria-pressed', String(next));
        node.classList.toggle('is-muted', next);
        if (socket) {
            socket.emit('instrument:mute', { instrumentId: instrument.id, muted: next });
        }
    });

    const actions = node.querySelector('.synth-actions') || node.querySelector('.synth-header');
    actions.append(muteButton, lockButton);
    cardEntry.lockButton = lockButton;
    cardEntry.muteButton = muteButton;

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

    // Sampler slot strip (upload, replace, clear) sits above the parameters.
    const drumSelector = document.createElement('div');
    drumSelector.className = 'drum-selector hidden';
    cardEntry.drumSelector = drumSelector;
    inspector.insertBefore(drumSelector, cardEntry.paramsContainer);

    socketState.instrumentElements.set(instrument.id, cardEntry);

    ensureCollapseBindings(cardEntry, instrument.id);
    bindCollapseToggle(cardEntry, instrument.id);

    const initialCollapsed = loadCollapsedState(instrument.id);
    applyCollapseState(cardEntry, instrument.id, initialCollapsed, { persist: false });

    updateInstrumentCard(node, instrument);
    return node;
}

function syncInstrumentMuteState(entry, instrument) {
    if (!entry || !instrument) return;
    const muted = Boolean(instrument.muted);
    setInstrumentMuted(instrument.id, muted);
    if (entry.muteButton) {
        entry.muteButton.classList.toggle('is-muted', muted);
        entry.muteButton.setAttribute('aria-pressed', String(muted));
    }
    if (entry.root) {
        entry.root.classList.toggle('is-muted', muted);
    }
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
            (ref.buttons || []).forEach((button) => setLockedDisabled(button, disableControls));
            if (ref.pitchSelect && !ref.baseDisabled) {
                ref.pitchSelect.classList.toggle('step-select-disabled', ref.pitchSelect.disabled);
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
    card.classList.remove('tone-acid', 'tone-drums', 'tone-poly', 'tone-sampler', 'tone-rumble', 'tone-stab', 'tone-hoover', 'tone-fx');
    if (definition.toneClass) {
        card.classList.add(definition.toneClass);
    }
    if (!entry) {
        return;
    }

    ensureCollapseBindings(entry, instrument.id);
    bindCollapseToggle(entry, instrument.id);
    const currentCollapsed = entry.isCollapsed ?? entry.root.classList.contains('collapsed');
    applyCollapseState(entry, instrument.id, currentCollapsed, { persist: false });

    const displayName = instrument.name || definition.label;
    if (entry.rowNameEl) {
        entry.rowNameEl.textContent = displayName;
        entry.rowNameEl.title = displayName;
    }
    if (entry.renameInput) {
        entry.renameInput.value = displayName;
    } else if (entry.nameEl) {
        entry.nameEl.textContent = displayName;
    }
    const typeLabel = definition.typeLabel || instrument.type;
    const creatorName = instrument.creatorDisplayName;
    const typeText = creatorName ? `${typeLabel} · ${creatorName}` : typeLabel;
    if (entry.typeEl) {
        entry.typeEl.textContent = typeText;
    }
    if (entry.inspectorTypeEl) {
        entry.inspectorTypeEl.textContent = typeText;
    }
    if (entry.inspector) {
        entry.inspector.setAttribute('aria-label', `${displayName} settings`);
    }

    renderParamControls(entry.paramsContainer, instrument, definition);

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

    updateFillButtonLabel(entry, instrument);

    if (LANE_VOICES[instrument.type]) {
        entry.activeDrum = laneFor(instrument.type, entry.activeDrum);
    }

    // Drum voices are picked from the score's row labels; only the sampler
    // needs its slot strip in the inspector.
    if (entry.drumSelector) {
        if (instrument.type === SynthTypes.SAMPLER) {
            entry.drumSelector.classList.remove('hidden');
            if (!entry.activeSamplerSlot || !SAMPLER_SLOT_IDS.includes(entry.activeSamplerSlot)) {
                entry.activeSamplerSlot = SAMPLER_SLOT_IDS[0];
            }
            renderSamplerSelector(entry, instrument, definition);
        } else {
            entry.drumSelector.classList.add('hidden');
            entry.drumSelector.innerHTML = '';
        }
    }

    renderStepGrid(entry.stepGrid, instrument);

    updateInstrumentLockState(entry, instrument);
    syncInstrumentMuteState(entry, instrument);
}

function updateFillButtonLabel(entry, instrument) {
    if (!entry?.fillButton) {
        return;
    }
    const stepCount = clampStepCount(instrument.stepCount ?? (Array.isArray(instrument.steps) ? instrument.steps.length : STEP_COUNT));
    const allFilled = _areAllStepsFilled(instrument, stepCount, entry.activeDrum, entry.activeSamplerSlot);
    entry.fillButton.textContent = allFilled ? 'Clear' : 'Fill';
}

export function removeInstrumentCard(instrumentId) {
    if (activePitchPopup) {
        closePitchPopup({ commit: false });
    }
    removeCollapsedState(instrumentId);
    audioState.mutedInstruments.delete(instrumentId);
    const entry = socketState.instrumentElements.get(instrumentId);
    if (!entry) {
        return;
    }
    if (entry.renameInput) {
        entry.renameInput.remove();
        entry.renameInput = null;
    }
    entry.root.remove();
    entry.inspector?.remove();
    socketState.instrumentElements.delete(instrumentId);
    import('../audio/instruments/sampler.js').then(({ cleanupSamplerBuffers }) => {
        cleanupSamplerBuffers(instrumentId);
    }).catch(console.error);
    import('../audio/instruments/drums.js').then(({ releaseDrumKit }) => {
        releaseDrumKit(instrumentId);
    }).catch(console.error);
    import('../audio/instruments/rumble.js').then(({ releaseRumble }) => {
        releaseRumble(instrumentId);
    }).catch(console.error);
    import('../audio/instruments/hoover.js').then(({ releaseHoover }) => {
        releaseHoover(instrumentId);
    }).catch(console.error);
    import('../audio/scheduler.js').then(({ getCurrentStepIndex }) => {
        updatePlaybackIndicators(getCurrentStepIndex());
    }).catch(console.error);
}

export function renderEmptyState() {
    const count = state.instrumentOrder.length;
    instrumentEmptyEl.classList.toggle('hidden', count > 0);
    if (scoreMetaEl) {
        scoreMetaEl.textContent = count === 1 ? '1 instrument, 4/4' : `${count} instruments, 4/4`;
    }
}

// Highlights the audible step in every instrument's lanes, the score ruler
// and the bar/beat/step readout. Only cells whose state changes are touched.
export function updatePlaybackIndicators(stepIndex) {
    const playing = Boolean(state.transport.playing) && stepIndex >= 0;

    socketState.instrumentElements.forEach((entry, instrumentId) => {
        const { stepRefs } = entry;
        if (!stepRefs || !stepRefs.length) {
            return;
        }
        const instrument = state.instruments.get(instrumentId);
        let nextIndex = -1;
        if (instrument && playing) {
            const instrumentStepCount = clampStepCount(instrument.stepCount ?? (Array.isArray(instrument.steps) ? instrument.steps.length : STEP_COUNT));
            const normalizedIndex = instrumentStepCount > 0 ? stepIndex % instrumentStepCount : -1;
            const ref = stepRefs[normalizedIndex];
            if (ref && normalizedIndex < instrumentStepCount && !ref.disabled) {
                nextIndex = normalizedIndex;
            }
        }
        if (nextIndex === entry.playingIndex) {
            return;
        }
        setStepPlaying(stepRefs[entry.playingIndex], false);
        setStepPlaying(stepRefs[nextIndex], true);
        entry.playingIndex = nextIndex;
    });

    const column = playing ? stepIndex % STEP_GRID_COLUMNS : -1;
    scoreRulerCells.forEach((cell, index) => {
        cell.classList.toggle('playing', index === column);
    });
    if (positionBarEl && positionBeatEl && positionStepEl) {
        positionBarEl.textContent = playing ? String(Math.floor(stepIndex / STEP_GRID_COLUMNS) + 1) : '–';
        positionBeatEl.textContent = playing ? String(Math.floor((stepIndex % STEP_GRID_COLUMNS) / 4) + 1) : '–';
        positionStepEl.textContent = playing ? String((stepIndex % STEP_GRID_COLUMNS) + 1) : '–';
    }
}

function setStepPlaying(ref, isPlaying) {
    if (!ref) {
        return;
    }
    (ref.cells || [ref.cell]).forEach((cell) => cell?.classList.toggle('playing', isPlaying));
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
        selectBtn.setAttribute('aria-label', `Edit slot ${slotId}`);
        selectBtn.setAttribute('aria-pressed', String(slotId === activeSlot));
        selectBtn.addEventListener('click', () => selectSamplerSlot(entry, instrument.id, slotId));

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
            }).catch(console.error);
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
    }).catch(console.error);
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

    let paramDefs = definition.params || [];
    let groupTitleBefore = null;
    if (instrument.type === SynthTypes.DRUMS) {
        // Instrument-wide params first, then the voice picked in the score.
        const entry = socketState.instrumentElements.get(instrument.id);
        const activeDrum = entry?.activeDrum || 'kick';
        const drumParams = DRUM_VOICE_PARAM_DEFS[activeDrum] || [];
        if (drumParams.length) {
            const drumLabel = DRUM_VOICES.find((drum) => drum.id === activeDrum)?.label || activeDrum;
            groupTitleBefore = { key: drumParams[0].key, title: drumLabel };
        }
        paramDefs = [...paramDefs, ...drumParams];
    }

    paramDefs.forEach((paramDef) => {
        if (groupTitleBefore && groupTitleBefore.key === paramDef.key) {
            const title = document.createElement('h4');
            title.className = 'param-group-title';
            title.textContent = groupTitleBefore.title;
            container.appendChild(title);
        }
        const control = document.createElement('div');
        control.className = 'param-control';
        control.dataset.instrumentId = instrument.id;
        control.dataset.paramKey = paramDef.key;
        if (paramDef.type === 'range') {
            control.dataset.paramMin = String(paramDef.min);
            control.dataset.paramMax = String(paramDef.max);
            control.dataset.paramLabel = paramDef.label;
        }

        const controlId = `${instrument.id}-${paramDef.key}`;
        const label = document.createElement(paramDef.type === 'select' ? 'span' : 'label');
        label.className = 'param-label';
        label.textContent = paramDef.label;
        if (paramDef.type === 'select') {
            label.id = `${controlId}-label`;
        } else {
            label.htmlFor = controlId;
        }

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
            valueBadge.className = 'param-value';

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

                instrument.params[paramDef.key] = numericValue;

                const paramsPayload = createInstrumentParamUpdate(instrument, paramDef, numericValue);
                if (!paramsPayload) {
                    return;
                }

                socketState.suppressedInstrumentUpdates.set(instrument.id, Date.now() + 250);
                emitInstrumentParams(instrument.id, paramsPayload);
            });

            control.appendChild(input);
            control.appendChild(valueBadge);
        } else if (paramDef.type === 'select') {
            // A handful of options: shown as a segmented control.
            control.classList.add('is-choice');
            const group = document.createElement('div');
            group.className = 'segmented';
            group.setAttribute('role', 'group');
            group.setAttribute('aria-labelledby', label.id);
            const options = paramDef.options || [];
            const current = instrument.params?.[paramDef.key] ?? options[0]?.value ?? '';
            const buttons = options.map((option) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = option.label;
                button.dataset.value = option.value;
                button.setAttribute('aria-pressed', String(option.value === current));
                button.addEventListener('click', () => {
                    buttons.forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
                    if (!instrument.params || typeof instrument.params !== 'object') {
                        instrument.params = {};
                    }
                    instrument.params[paramDef.key] = option.value;
                    if (!socket) return;
                    socket.emit('instrument:param', {
                        instrumentId: instrument.id,
                        params: { [paramDef.key]: option.value },
                    });
                });
                group.appendChild(button);
                return button;
            });
            control.appendChild(group);
        }

        container.appendChild(control);
    });
}

export function resolveInstrumentParamValue(instrument, paramDef) {
    const params = instrument.params || {};
    const rawValue = params[paramDef.key];
    return clampValue(rawValue, paramDef.min, paramDef.max);
}

export function createInstrumentParamUpdate(instrument, paramDef, value) {
    if (!Number.isFinite(value)) {
        return null;
    }
    return { [paramDef.key]: value };
}

// Step grid rendering
//
// Every instrument is drawn as lanes on the shared 16-column score: one lane
// label column, then 16 step cells. Patterns longer than 16 steps wrap onto
// further lines, so step N of every instrument sits in the same column.
// stepRefs[i] collects everything belonging to step i across the lanes.

const SVG_NS = 'http://www.w3.org/2000/svg';

function createIcon(viewBox, pathData, { fill = 'none', strokeWidth = '1.6' } = {}) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('fill', fill);
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', strokeWidth);
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
    return svg;
}

function setPitchButtonLabel(button, stepIndex, pitch) {
    button.setAttribute('aria-label', `Change pitch of step ${stepIndex + 1} (${pitch})`);
    button.title = `Pitch: ${pitch}`;
}

function createStepLane(laneClass, labelText) {
    const lane = document.createElement('div');
    lane.className = `step-lane ${laneClass}`;
    const label = document.createElement('span');
    label.className = 'lane-label';
    label.textContent = labelText;
    lane.appendChild(label);
    return lane;
}

function createStepCell(index, withinPattern) {
    const cell = document.createElement('div');
    cell.className = 'step-cell';
    cell.classList.toggle('beat', index % 4 === 0);
    cell.classList.toggle('step-disabled', !withinPattern);
    return cell;
}

// Splits the visible steps into 16-step lines; returns the line containers.
function createStepLines(container, visibleSteps) {
    const lineCount = Math.max(1, Math.ceil(visibleSteps / STEP_GRID_COLUMNS));
    const lines = [];
    for (let line = 0; line < lineCount; line += 1) {
        const lineEl = document.createElement('div');
        lineEl.className = 'step-line';
        if (lineCount > 1) {
            const head = document.createElement('div');
            head.className = 'step-line-head';
            const first = line * STEP_GRID_COLUMNS + 1;
            const range = document.createElement('span');
            range.textContent = `${first}–${first + STEP_GRID_COLUMNS - 1}`;
            head.append(document.createElement('span'), range);
            lineEl.appendChild(head);
        }
        container.appendChild(lineEl);
        lines.push(lineEl);
    }
    return lines;
}

function assignStepRefs(entry, stepRefs) {
    if (!entry) {
        return;
    }
    entry.stepRefs = stepRefs;
    entry.playingIndex = -1;
}

export function renderStepGrid(container, instrument) {
    if (activePitchPopup) {
        closePitchPopup({ commit: false });
    }
    if (LANE_VOICES[instrument.type]) {
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
    const isAcid = instrument.type === SynthTypes.TB303;
    const stepRefs = [];
    const slideLanes = [];
    let refreshSlurs = () => {};

    createStepLines(container, visibleSteps).forEach((lineEl, line) => {
        const accentLane = isAcid ? createStepLane('lane-accent', 'Accent') : null;
        const noteLane = createStepLane('lane-note', 'Note');
        const pitchLane = createStepLane('lane-pitch', 'Pitch');
        const slideLane = isAcid ? createStepLane('lane-slide', 'Slide') : null;
        [accentLane, noteLane, pitchLane, slideLane].forEach((lane) => lane && lineEl.appendChild(lane));
        if (slideLane) {
            slideLanes.push(slideLane);
        }

        for (let column = 0; column < STEP_GRID_COLUMNS; column += 1) {
            const patternIndex = line * STEP_GRID_COLUMNS + column;
            const withinPattern = patternIndex < instrumentStepCount;

            let step = steps[patternIndex];
            if (!step && withinPattern) {
                step = createEmptyMelodicStep();
                steps[patternIndex] = step;
            } else if (!step) {
                step = createEmptyMelodicStep();
            }
            const pitch = NOTE_OPTIONS.includes(step.pitch) ? step.pitch : 'C3';
            if (withinPattern) {
                step.pitch = pitch;
            }

            const cells = [];
            const buttons = [];

            // Note: toggles the step, shows its pitch while active.
            const noteCell = createStepCell(column, withinPattern);
            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'step-toggle';
            toggleBtn.dataset.stepIndex = String(patternIndex);
            const note = document.createElement('span');
            note.className = 'step-note';
            note.textContent = pitch;
            toggleBtn.appendChild(note);
            const isActive = withinPattern && Boolean(step.active);
            toggleBtn.classList.toggle('active', isActive);
            toggleBtn.classList.toggle('accented', Boolean(step.accent));
            toggleBtn.setAttribute('aria-pressed', String(isActive));
            toggleBtn.setAttribute('aria-label', `Step ${patternIndex + 1}`);
            toggleBtn.disabled = !withinPattern;
            noteCell.classList.toggle('active', isActive);
            noteCell.appendChild(toggleBtn);
            noteLane.appendChild(noteCell);

            if (withinPattern) {
                toggleBtn.addEventListener('click', () => {
                    const nextActive = !step.active;
                    step.active = nextActive;
                    toggleBtn.classList.toggle('active', nextActive);
                    toggleBtn.setAttribute('aria-pressed', String(nextActive));
                    noteCell.classList.toggle('active', nextActive);
                    refreshSlurs();
                    if (!socket) return;
                    socket.emit('instrument:step', {
                        instrumentId: instrument.id,
                        stepIndex: patternIndex,
                        step: { active: nextActive },
                    });
                });
            }

            // Pitch: opens the note/octave popup.
            const pitchCell = createStepCell(column, withinPattern);
            const pitchSelect = createPitchSelect(pitch);
            pitchSelect.appendChild(createIcon('0 0 10 6', 'M1 1l4 4 4-4', { strokeWidth: '1.5' }));
            setPitchButtonLabel(pitchSelect, patternIndex, pitch);
            if (withinPattern) {
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
            } else {
                pitchSelect.disabled = true;
                pitchSelect.classList.add('step-select-disabled');
            }
            pitchCell.appendChild(pitchSelect);
            pitchLane.appendChild(pitchCell);

            let accentBtn = null;
            let slideBtn = null;
            if (isAcid) {
                const accentCell = createStepCell(column, withinPattern);
                accentBtn = document.createElement('button');
                accentBtn.type = 'button';
                accentBtn.className = 'step-mod-btn step-accent-btn';
                accentBtn.setAttribute('aria-label', `Accent, step ${patternIndex + 1}`);
                accentBtn.appendChild(createIcon('0 0 12 10', 'M1 1l10 4-10 4', { strokeWidth: '1.8' }));
                accentBtn.classList.toggle('active', Boolean(step.accent));
                accentBtn.setAttribute('aria-pressed', String(Boolean(step.accent)));
                accentBtn.disabled = !withinPattern;
                accentCell.appendChild(accentBtn);
                accentLane.appendChild(accentCell);

                const slideCell = createStepCell(column, withinPattern);
                slideBtn = document.createElement('button');
                slideBtn.type = 'button';
                slideBtn.className = 'step-mod-btn step-slide-btn';
                slideBtn.setAttribute('aria-label', `Slide from step ${patternIndex + 1} into the next`);
                slideBtn.classList.toggle('active', Boolean(step.slide));
                slideBtn.setAttribute('aria-pressed', String(Boolean(step.slide)));
                slideBtn.disabled = !withinPattern;
                slideCell.appendChild(slideBtn);
                slideLane.appendChild(slideCell);

                if (withinPattern) {
                    accentBtn.addEventListener('click', () => {
                        const next = !step.accent;
                        step.accent = next;
                        accentBtn.classList.toggle('active', next);
                        accentBtn.setAttribute('aria-pressed', String(next));
                        toggleBtn.classList.toggle('accented', next);
                        if (!socket) return;
                        socket.emit('instrument:step', {
                            instrumentId: instrument.id,
                            stepIndex: patternIndex,
                            step: { accent: next },
                        });
                    });
                    slideBtn.addEventListener('click', () => {
                        const next = !step.slide;
                        step.slide = next;
                        slideBtn.classList.toggle('active', next);
                        slideBtn.setAttribute('aria-pressed', String(next));
                        refreshSlurs();
                        if (!socket) return;
                        socket.emit('instrument:step', {
                            instrumentId: instrument.id,
                            stepIndex: patternIndex,
                            step: { slide: next },
                        });
                    });
                }
                cells.push(accentCell, noteCell, pitchCell, slideCell);
                buttons.push(accentBtn, toggleBtn, pitchSelect, slideBtn);
            } else {
                cells.push(noteCell, pitchCell);
                buttons.push(toggleBtn, pitchSelect);
            }

            stepRefs.push({
                cell: noteCell,
                cells,
                buttons,
                toggleBtn,
                pitchSelect,
                accentBtn,
                slideBtn,
                disabled: !withinPattern,
                baseDisabled: !withinPattern,
            });
        }
    });

    if (slideLanes.length) {
        const layers = slideLanes.map((lane) => {
            const layer = document.createElement('div');
            layer.className = 'slur-layer';
            layer.setAttribute('aria-hidden', 'true');
            lane.appendChild(layer);
            return layer;
        });
        refreshSlurs = () => drawSlurs(layers, steps, instrumentStepCount);
        refreshSlurs();
    }

    assignStepRefs(entry, stepRefs);
}

// Splits each slur over the 16-step lines; a part that continues on another
// line is left open at that side.
function drawSlurs(layers, steps, count) {
    layers.forEach((layer) => {
        layer.innerHTML = '';
    });
    computeSlurs(steps, count).forEach((slur) => {
        layers.forEach((layer, line) => {
            const lineStart = line * STEP_GRID_COLUMNS;
            const from = Math.max(slur.start, lineStart);
            const to = Math.min(slur.end, lineStart + STEP_GRID_COLUMNS);
            if (to <= from) {
                return;
            }
            const el = document.createElement('span');
            el.className = 'slur';
            el.classList.toggle('inert', slur.inert);
            el.classList.toggle('open-start', from > slur.start || slur.openStart);
            el.classList.toggle('open-end', to < slur.end || slur.openEnd);
            el.style.left = `${((from - lineStart) / STEP_GRID_COLUMNS) * 100}%`;
            el.style.width = `${((to - from) / STEP_GRID_COLUMNS) * 100}%`;
            layer.appendChild(el);
        });
    });
}

// Shared by the drum kit (one lane per drum voice) and the sampler (one lane per
// slot). Clicking a lane label picks the voice/slot the inspector edits and
// that Fill acts on; clicking a cell toggles that voice on that step.
function renderHitLanes(container, instrument, { voices, activeVoice, onSelectVoice, isOn, onToggle, indicatorClass, toggleClass }) {
    container.innerHTML = '';
    const steps = instrument.steps || [];
    const entry = socketState.instrumentElements.get(instrument.id);
    const instrumentStepCount = clampStepCount(instrument.stepCount ?? (Array.isArray(steps) ? steps.length : STEP_COUNT));
    const visibleSteps = getVisibleStepSlots(instrumentStepCount);
    const stepRefs = [];
    for (let i = 0; i < visibleSteps; i += 1) {
        const withinPattern = i < instrumentStepCount;
        stepRefs.push({ cell: null, cells: [], buttons: [], disabled: !withinPattern, baseDisabled: !withinPattern });
    }

    createStepLines(container, visibleSteps).forEach((lineEl, line) => {
        voices.forEach((voice) => {
            const lane = document.createElement('div');
            lane.className = 'step-lane lane-hit';
            const label = document.createElement('button');
            label.type = 'button';
            label.className = 'lane-label voice-select';
            label.dataset.voice = voice.id;
            label.classList.toggle('active', voice.id === activeVoice);
            label.setAttribute('aria-pressed', String(voice.id === activeVoice));
            label.title = voice.title || voice.label;
            const labelText = document.createElement('span');
            labelText.textContent = voice.label;
            label.appendChild(labelText);
            label.addEventListener('click', () => onSelectVoice(voice.id));
            lane.appendChild(label);

            for (let column = 0; column < STEP_GRID_COLUMNS; column += 1) {
                const patternIndex = line * STEP_GRID_COLUMNS + column;
                const withinPattern = patternIndex < instrumentStepCount;
                const cell = createStepCell(column, withinPattern);
                const active = withinPattern && isOn(patternIndex, voice.id);
                cell.classList.toggle('active', active);

                const toggleBtn = document.createElement('button');
                toggleBtn.type = 'button';
                toggleBtn.className = toggleClass;
                toggleBtn.dataset.stepIndex = String(patternIndex);
                toggleBtn.setAttribute('aria-label', `${voice.title || voice.label}, step ${patternIndex + 1}`);
                toggleBtn.setAttribute('aria-pressed', String(active));
                toggleBtn.disabled = !withinPattern;
                const indicator = document.createElement('span');
                indicator.className = indicatorClass;
                indicator.classList.toggle('active', active);
                toggleBtn.appendChild(indicator);

                if (withinPattern) {
                    toggleBtn.addEventListener('click', () => {
                        const next = onToggle(patternIndex, voice.id);
                        indicator.classList.toggle('active', next);
                        cell.classList.toggle('active', next);
                        toggleBtn.setAttribute('aria-pressed', String(next));
                    });
                }

                cell.appendChild(toggleBtn);
                lane.appendChild(cell);
                const ref = stepRefs[patternIndex];
                ref.cells.push(cell);
                ref.buttons.push(toggleBtn);
                if (!ref.cell) {
                    ref.cell = cell;
                    ref.toggleBtn = toggleBtn;
                }
            }
            lineEl.appendChild(lane);
        });
    });

    assignStepRefs(entry, stepRefs);
}

function refreshVoiceSelection(entry, voiceId) {
    entry.stepGrid?.querySelectorAll('.voice-select').forEach((label) => {
        const isActive = label.dataset.voice === voiceId;
        label.classList.toggle('active', isActive);
        label.setAttribute('aria-pressed', String(isActive));
    });
}

// Lane grid for the Rave Kit (one lane per voice) and FX (one per effect).
export function renderDrumStepGrid(container, instrument) {
    const entry = socketState.instrumentElements.get(instrument.id);
    if (!entry) {
        return;
    }
    const voices = LANE_VOICES[instrument.type] || DRUM_VOICES;
    const emptyStep = LANE_EMPTY_STEP[instrument.type] || createEmptyDrumStep;
    const steps = instrument.steps || (instrument.steps = []);
    const stepAt = (index) => {
        const existing = steps[index] || emptyStep();
        existing.layers = { ...emptyStep().layers, ...(existing.layers || {}) };
        existing.active = voices.some((drum) => existing.layers[drum.id]);
        steps[index] = existing;
        return existing;
    };

    renderHitLanes(container, instrument, {
        voices: voices.map((drum) => ({ id: drum.id, label: drum.label })),
        activeVoice: laneFor(instrument.type, entry.activeDrum),
        indicatorClass: 'drum-indicator',
        toggleClass: 'step-toggle drum-step-toggle',
        isOn: (index, drumId) => Boolean(stepAt(index).layers[drumId]),
        onToggle: (index, drumId) => {
            const step = stepAt(index);
            const next = !step.layers[drumId];
            step.layers[drumId] = next;
            step.active = voices.some((drum) => step.layers[drum.id]);
            if (socket) {
                socket.emit('instrument:step', {
                    instrumentId: instrument.id,
                    stepIndex: index,
                    drum: drumId,
                    value: next,
                });
            }
            return next;
        },
        onSelectVoice: (drumId) => {
            if (entry.activeDrum === drumId) {
                return;
            }
            entry.activeDrum = drumId;
            const latest = state.instruments.get(instrument.id) || instrument;
            refreshVoiceSelection(entry, drumId);
            renderParamControls(entry.paramsContainer, latest, INSTRUMENT_LIBRARY[latest.type]);
            updateFillButtonLabel(entry, latest);
            updateInstrumentLockState(entry, latest);
        },
    });
}

export function renderSamplerStepGrid(container, instrument) {
    const entry = socketState.instrumentElements.get(instrument.id);
    if (!entry) {
        return;
    }
    const steps = instrument.steps || (instrument.steps = []);
    const stepAt = (index) => {
        const existing = steps[index] ? normalizeSamplerStep(steps[index]) : createEmptySamplerStep();
        steps[index] = existing;
        return existing;
    };
    const slots = instrument.params?.slots || {};

    renderHitLanes(container, instrument, {
        voices: SAMPLER_SLOT_CONFIG.map((slot) => {
            const sampleName = slots[slot.id]?.sample?.name;
            return {
                id: slot.id,
                label: sampleName ? `${slot.id} · ${sampleName}` : slot.id,
                title: sampleName ? `Slot ${slot.id}: ${sampleName}` : `Slot ${slot.id}`,
            };
        }),
        activeVoice: entry.activeSamplerSlot && SAMPLER_SLOT_IDS.includes(entry.activeSamplerSlot)
            ? entry.activeSamplerSlot
            : SAMPLER_SLOT_IDS[0],
        indicatorClass: 'sampler-indicator',
        toggleClass: 'step-toggle sampler-step-toggle',
        isOn: (index, slotId) => Boolean(stepAt(index).slots[slotId]),
        onToggle: (index, slotId) => {
            const step = stepAt(index);
            const next = !step.slots[slotId];
            step.slots[slotId] = next;
            step.active = Object.values(step.slots).some(Boolean);
            if (socket) {
                socket.emit('instrument:step', {
                    instrumentId: instrument.id,
                    stepIndex: index,
                    slot: slotId,
                    value: next,
                });
            }
            return next;
        },
        onSelectVoice: (slotId) => selectSamplerSlot(entry, instrument.id, slotId),
    });
}

function selectSamplerSlot(entry, instrumentId, slotId) {
    if (entry.activeSamplerSlot === slotId) {
        return;
    }
    entry.activeSamplerSlot = slotId;
    const latest = state.instruments.get(instrumentId);
    if (!latest) {
        return;
    }
    const definition = INSTRUMENT_LIBRARY[latest.type];
    refreshVoiceSelection(entry, slotId);
    renderSamplerSelector(entry, latest, definition);
    renderParamControls(entry.paramsContainer, latest, definition);
    updateFillButtonLabel(entry, latest);
    updateInstrumentLockState(entry, latest);
}
