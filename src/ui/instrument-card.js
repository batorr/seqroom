// Instrument Card Module
// Handles rendering and management of instrument cards

import { state, setInstrumentStepCountLocal, ensureLocalInstrumentCapacity, normalizeSamplerStep } from '../state/main.js';
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

// Import socket dynamically
let socket = null;
import('../socket/main.js').then((module) => {
    socket = module.socket;
});

// Render functions
export function renderInstrument(instrumentId) {
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
    });
}

export function setActiveInstrument(instrumentId) {
    if (instrumentId && !state.instruments.has(instrumentId)) {
        instrumentId = null;
    }
    if (state.activeInstrumentId === instrumentId) {
        updateActiveInstrumentHighlight();
        return;
    }
    state.activeInstrumentId = instrumentId;
    updateActiveInstrumentHighlight();
}

export function updateActiveInstrumentHighlight() {
    socketState.instrumentElements.forEach(({ root }, instrumentId) => {
        root.classList.toggle('active', instrumentId === state.activeInstrumentId);
    });
}

export function requestInstrumentStepCountChange(instrumentId, nextStepCount) {
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
        setInstrumentStepCountLocal(instrumentId, desired);
        renderInstrument(instrumentId);
        import('../audio/scheduler.js').then(({ getCurrentStepIndex }) => {
            updatePlaybackIndicators(getCurrentStepIndex());
        });
        return;
    }

    setInstrumentStepCountLocal(instrumentId, desired);
    renderInstrument(instrumentId);
    import('../audio/scheduler.js').then(({ getCurrentStepIndex }) => {
        updatePlaybackIndicators(getCurrentStepIndex());
    });

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
            renderInstrument(instrumentId);
            import('../audio/scheduler.js').then(({ getCurrentStepIndex }) => {
                updatePlaybackIndicators(getCurrentStepIndex());
            });
            return;
        }

        if (typeof response.stepCount === 'number') {
            const acknowledged = clampStepCount(response.stepCount);
            if (acknowledged !== desired) {
                setInstrumentStepCountLocal(instrumentId, acknowledged);
                renderInstrument(instrumentId);
            }
            import('../audio/scheduler.js').then(({ getCurrentStepIndex }) => {
                updatePlaybackIndicators(getCurrentStepIndex());
            });
        }
    });
}

export function ensureInstrumentCard(instrument) {
    let wrapper = socketState.instrumentElements.get(instrument.id)?.root;
    if (wrapper) {
        updateInstrumentCard(wrapper, instrument);
        return wrapper;
    }

    const node = instrumentTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.instrumentId = instrument.id;

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
    };

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
        const preview = clampStepCount(stepSlider.value);
        stepNumberInput.value = String(preview);
        stepValue.textContent = formatStepCountLabel(preview);
        presetButtons.forEach((button) => {
            const presetValue = Number(button.textContent);
            button.classList.toggle('selected', presetValue === preview);
        });
    });

    stepSlider.addEventListener('change', (event) => {
        event.stopPropagation();
        if (state.activeInstrumentId !== instrument.id) {
            setActiveInstrument(instrument.id);
        }
        manualStepState.editing = false;
        const desired = clampStepCount(stepSlider.value);
        requestInstrumentStepCountChange(instrumentId, desired);
    });

    stepNumberInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            if (manualStepState.editing) {
                event.preventDefault();
                if (stepNumberInput.value !== '') {
                    const desired = clampStepCount(stepNumberInput.value);
                    stepNumberInput.value = String(desired);
                    requestInstrumentStepCountChange(instrumentId, desired);
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
            requestInstrumentStepCountChange(instrumentId, desired);
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
        requestInstrumentStepCountChange(instrumentId, desired);
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

export function updateInstrumentCard(card, instrument) {
    const entry = socketState.instrumentElements.get(instrument.id);
    const definition = INSTRUMENT_LIBRARY[instrument.type] || INSTRUMENT_LIBRARY[SynthTypes.POLY];
    card.dataset.instrumentId = instrument.id;
    card.classList.remove('tone-acid', 'tone-808', 'tone-poly', 'tone-sampler');
    if (definition.toneClass) {
        card.classList.add(definition.toneClass);
    }

    const titleEl = card.querySelector('.synth-meta h3');
    const typeEl = card.querySelector('.synth-meta span');
    titleEl.textContent = instrument.name || definition.label;
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
}

export function removeInstrumentCard(instrumentId) {
    const entry = socketState.instrumentElements.get(instrumentId);
    if (!entry) {
        return;
    }
    entry.root.remove();
    socketState.instrumentElements.delete(instrumentId);
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
        badge.textContent = format(parsed);
    });

    input.addEventListener('change', () => {
        const parsed = clampValue(Number(input.value), min, max);
        badge.textContent = format(parsed);
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
                valueBadge.textContent = formatParamDisplay(input.value, paramDef);
            });

            input.addEventListener('change', () => {
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

                const paramsPayload = createInstrumentParamUpdate(instrument, paramDef, numericValue);
                if (!paramsPayload) {
                    return;
                }

                if (!socket) return;
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
        if (withinPattern) {
            const resolvedInitial = pitchSelect.value;
            step.pitch = resolvedInitial;
            note.textContent = resolvedInitial;
            pitchSelect.addEventListener('change', (event) => {
                event.stopPropagation();
                const selectedNote = pitchSelect.value;
                step.pitch = selectedNote;
                note.textContent = selectedNote;
                if (!socket) return;
                socket.emit('instrument:step', {
                    instrumentId: instrument.id,
                    stepIndex: patternIndex,
                    step: { pitch: selectedNote },
                });
            });
        } else {
            pitchSelect.disabled = true;
            pitchSelect.classList.add('step-select-disabled');
        }

        pitchSelect.addEventListener('click', (event) => event.stopPropagation());

        cell.appendChild(toggleBtn);
        cell.appendChild(pitchSelect);
        container.appendChild(cell);

        stepRefs.push({ cell, toggleBtn, pitchSelect, disabled: !withinPattern });
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

        stepRefs.push({ cell, toggleBtn, indicator, disabled: !withinPattern });
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
        stepRefs.push({ cell, toggleBtn, indicator, disabled: !withinPattern });
    }

    entry.stepRefs = stepRefs;
}
