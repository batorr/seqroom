// Sidebar UI Module
// Renders overlay-style overview of session instruments

import { state, setSidebarOpen } from '../state/main.js';
import { SynthTypes, INSTRUMENT_LIBRARY } from '../constants/instruments.js';

const sidebarOverlayEl = document.getElementById('sidebar-overlay');
const sidebarPanelEl = document.getElementById('sidebar-panel');
const sidebarListEl = document.getElementById('instrument-sidebar-list');
const sidebarEmptyEl = document.getElementById('instrument-sidebar-empty');
const sidebarCountEl = document.getElementById('instrument-sidebar-count');
const sidebarToggleBtn = document.getElementById('sidebar-toggle');

const sidebarRefs = new Map();

let initialized = false;
let isSidebarOpen = Boolean(state.ui?.sidebarOpen);

function getTypeLabel(instrument) {
    if (!instrument) {
        return 'Synth';
    }
    const definition = INSTRUMENT_LIBRARY[instrument.type];
    if (definition?.typeLabel) {
        return definition.typeLabel;
    }
    if (definition?.label) {
        return definition.label;
    }
    return 'Synth';
}

function getTypeDescription(instrument) {
    const typeLabel = getTypeLabel(instrument);
    const creatorName = instrument?.creatorDisplayName;
    return creatorName ? `${typeLabel} by ${creatorName}` : typeLabel;
}

function updateSidebarCount() {
    if (!sidebarCountEl) {
        return;
    }
    const count = state.instrumentOrder.length;
    const label = count === 1 ? '1 active' : `${count} active`;
    sidebarCountEl.textContent = label.toUpperCase();
}

function updateSidebarEmptyState() {
    if (!sidebarEmptyEl) {
        return;
    }
    if (!state.instrumentOrder.length) {
        sidebarEmptyEl.classList.remove('hidden');
    } else {
        sidebarEmptyEl.classList.add('hidden');
    }
}

function handleDocumentKeydown(event) {
    if (event.key === 'Escape' && isSidebarOpen) {
        closeSidebar({ focusToggle: true });
    }
}

function applySidebarState(open) {
    const nextOpen = Boolean(open);
    isSidebarOpen = nextOpen;
    setSidebarOpen(nextOpen);

    if (sidebarOverlayEl) {
        sidebarOverlayEl.classList.toggle('sidebar-overlay--visible', nextOpen);
        sidebarOverlayEl.setAttribute('aria-hidden', String(!nextOpen));
    }
    if (sidebarPanelEl) {
        sidebarPanelEl.setAttribute('aria-hidden', String(!nextOpen));
    }
    if (document?.body?.classList) {
        document.body.classList.toggle('sidebar-open', nextOpen);
    }
    if (sidebarToggleBtn) {
        sidebarToggleBtn.setAttribute('aria-expanded', String(nextOpen));
        sidebarToggleBtn.setAttribute('aria-label', nextOpen ? 'Hide synth sidebar' : 'Show synth sidebar');
        sidebarToggleBtn.textContent = nextOpen ? '×' : '☰';
    }
}

function getDefaultSidebarState() {
    return Boolean(state.ui?.sidebarOpen);
}

function toggleSidebar(forcedState, options = {}) {
    const { focusToggle = false } = options;
    const nextState = typeof forcedState === 'boolean' ? forcedState : !isSidebarOpen;
    if (nextState === isSidebarOpen) {
        if (focusToggle && sidebarToggleBtn) {
            sidebarToggleBtn.focus();
        }
        return;
    }
    applySidebarState(nextState);
    if (focusToggle && sidebarToggleBtn) {
        sidebarToggleBtn.focus();
    }
}

function handleInstrumentClick(instrumentId) {
    if (!instrumentId) {
        return;
    }
    import('./instrument-card.js').then((module) => {
        if (typeof module.setActiveInstrument === 'function') {
            module.setActiveInstrument(instrumentId, { scrollIntoView: true, focus: true });
        }
    }).catch((error) => {
        console.error('Failed to activate instrument from sidebar:', error);
    }).finally(() => {
        closeSidebar();
    });
}

function createSidebarItem(instrument) {
    const item = document.createElement('li');
    item.className = 'instrument-sidebar-item';
    item.dataset.instrumentId = instrument.id;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'instrument-sidebar-button';
    button.addEventListener('click', () => handleInstrumentClick(instrument.id));

    const nameEl = document.createElement('span');
    nameEl.className = 'instrument-sidebar-name';
    nameEl.textContent = instrument.name || getTypeLabel(instrument);

    const typeEl = document.createElement('span');
    typeEl.className = 'instrument-sidebar-type';
    typeEl.textContent = getTypeDescription(instrument);

    button.appendChild(nameEl);
    button.appendChild(typeEl);
    item.appendChild(button);

    sidebarRefs.set(instrument.id, {
        root: item,
        nameEl,
        typeEl,
    });

    updateSidebarEntry(instrument.id);

    return item;
}

export function initializeSidebar() {
    if (initialized) {
        return;
    }
    initialized = true;

    const defaultState = getDefaultSidebarState();
    applySidebarState(defaultState);

    if (sidebarToggleBtn) {
        sidebarToggleBtn.addEventListener('click', () => {
            toggleSidebar();
        });
    }

    if (sidebarOverlayEl) {
        sidebarOverlayEl.addEventListener('click', (event) => {
            if (event.target === sidebarOverlayEl) {
                closeSidebar({ focusToggle: true });
            }
        });
    }

    document.addEventListener('keydown', handleDocumentKeydown);
}

export function renderInstrumentSidebar() {
    if (!sidebarListEl) {
        return;
    }
    sidebarRefs.clear();
    sidebarListEl.innerHTML = '';
    const fragment = document.createDocumentFragment();
    state.instrumentOrder.forEach((instrumentId) => {
        const instrument = state.instruments.get(instrumentId);
        if (!instrument) {
            return;
        }
        fragment.appendChild(createSidebarItem(instrument));
    });
    sidebarListEl.appendChild(fragment);
    updateSidebarCount();
    updateSidebarEmptyState();
    updateSidebarSelection();
}

export function updateSidebarEntry(instrumentId) {
    const instrument = state.instruments.get(instrumentId);
    const ref = sidebarRefs.get(instrumentId);
    if (!instrument) {
        removeInstrumentSidebarEntry(instrumentId);
        return;
    }
    if (!ref) {
        renderInstrumentSidebar();
        return;
    }
    ref.nameEl.textContent = instrument.name || getTypeLabel(instrument);
    ref.typeEl.textContent = getTypeDescription(instrument);
}

export function removeInstrumentSidebarEntry(instrumentId) {
    const ref = sidebarRefs.get(instrumentId);
    if (ref?.root?.parentElement) {
        ref.root.parentElement.removeChild(ref.root);
    }
    sidebarRefs.delete(instrumentId);
    updateSidebarCount();
    updateSidebarEmptyState();
    updateSidebarSelection();
}

export function updateSidebarSelection() {
    const activeId = state.activeInstrumentId;
    sidebarRefs.forEach(({ root }, instrumentId) => {
        root.classList.toggle('active', instrumentId === activeId);
    });
}

export function openSidebar(options = {}) {
    toggleSidebar(true, options);
}

export function closeSidebar(options = {}) {
    toggleSidebar(false, options);
}
