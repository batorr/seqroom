// Display Name Controls
// Handles landing page input for storing the local display name

import { setDisplayName, getDisplayName, getDisplayNameOrDefault, DEFAULT_DISPLAY_NAME } from '../state/main.js';

const landingDisplayNameInput = document.getElementById('display-name-input');
const displayNameModal = document.getElementById('display-name-modal');
const displayNameModalForm = document.getElementById('display-name-modal-form');
const displayNameModalInput = document.getElementById('display-name-modal-input');
const displayNameModalError = document.getElementById('display-name-modal-error');
const displayNameModalMessage = document.getElementById('display-name-modal-message');
const displayNameModalCancelBtn = document.getElementById('cancel-display-name-modal');
const displayNameModalCloseBtn = document.getElementById('close-display-name-modal');
const displayNameModalConfirmBtn = document.getElementById('confirm-display-name-modal');
const displayNameModalBackdrop = displayNameModal?.querySelector('.modal-backdrop') || null;

let displayNameModalInitialized = false;
let pendingDisplayNameRequest = null;
let resolveDisplayNameRequest = null;
let displayNameModalAttemptedSubmit = false;

export function setupDisplayNameControls() {
    setupDisplayNameModal();
    if (!landingDisplayNameInput) {
        return;
    }

    const storedValue = getDisplayName();
    if (storedValue) {
        landingDisplayNameInput.value = storedValue;
    } else if (landingDisplayNameInput.value) {
        setDisplayName(landingDisplayNameInput.value);
    } else {
        landingDisplayNameInput.value = DEFAULT_DISPLAY_NAME;
        setDisplayName(DEFAULT_DISPLAY_NAME);
    }

    landingDisplayNameInput.addEventListener('input', () => {
        setDisplayName(landingDisplayNameInput.value);
    });

    landingDisplayNameInput.addEventListener('blur', () => {
        if (!landingDisplayNameInput.value.trim()) {
            landingDisplayNameInput.value = DEFAULT_DISPLAY_NAME;
        }
        setDisplayName(landingDisplayNameInput.value);
    });
}

export function requestDisplayNameModal({ slug = '' } = {}) {
    setupDisplayNameModal();
    if (!displayNameModal || !displayNameModalForm || !displayNameModalInput || !displayNameModalConfirmBtn) {
        const promptLabel = slug
            ? `Enter your name to join ${slug}:`
            : 'Enter your name to join this room:';
        const response = typeof window !== 'undefined'
            ? window.prompt(promptLabel, getDisplayNameOrDefault() || DEFAULT_DISPLAY_NAME)
            : null;
        if (response === null || typeof response === 'undefined') {
            return Promise.resolve(null);
        }
        const trimmed = response.trim();
        if (!trimmed) {
            return Promise.resolve(null);
        }
        setDisplayName(trimmed);
        syncLandingInput();
        return Promise.resolve(getDisplayNameOrDefault());
    }

    if (pendingDisplayNameRequest) {
        return pendingDisplayNameRequest;
    }

    const storedValue = getDisplayName();
    const initialValue = storedValue || (landingDisplayNameInput?.value ?? DEFAULT_DISPLAY_NAME);
    displayNameModalInput.value = initialValue;
    displayNameModalAttemptedSubmit = false;
    updateDisplayNameModalValidation(false);
    if (displayNameModalMessage) {
        displayNameModalMessage.textContent = slug
            ? `Before joining ${slug}, choose a display name so others know who you are.`
            : 'Choose a display name so others know who you are.';
    }
    if (displayNameModalError) {
        displayNameModalError.textContent = '';
        displayNameModalError.classList.add('hidden');
    }
    displayNameModal.classList.remove('hidden');
    window.setTimeout(() => {
        displayNameModalInput.focus();
        displayNameModalInput.select();
    }, 0);

    pendingDisplayNameRequest = new Promise((resolve) => {
        resolveDisplayNameRequest = resolve;
    });
    return pendingDisplayNameRequest;
}

function setupDisplayNameModal() {
    if (displayNameModalInitialized) {
        return;
    }
    if (!displayNameModal || !displayNameModalForm || !displayNameModalInput) {
        return;
    }
    displayNameModalInitialized = true;

    displayNameModalForm.addEventListener('submit', handleDisplayNameModalSubmit);
    displayNameModalInput.addEventListener('input', () => {
        updateDisplayNameModalValidation(displayNameModalAttemptedSubmit);
    });

    if (displayNameModalCancelBtn) {
        displayNameModalCancelBtn.addEventListener('click', (event) => {
            event.preventDefault();
            closeDisplayNameModal(null);
        });
    }

    if (displayNameModalCloseBtn) {
        displayNameModalCloseBtn.addEventListener('click', (event) => {
            event.preventDefault();
            closeDisplayNameModal(null);
        });
    }

    displayNameModal.addEventListener('click', (event) => {
        if (event.target === displayNameModal || event.target === displayNameModalBackdrop) {
            closeDisplayNameModal(null);
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && displayNameModal && !displayNameModal.classList.contains('hidden')) {
            closeDisplayNameModal(null);
        }
    });
}

function handleDisplayNameModalSubmit(event) {
    event.preventDefault();
    displayNameModalAttemptedSubmit = true;
    if (!updateDisplayNameModalValidation(true)) {
        return;
    }
    const trimmedValue = displayNameModalInput.value.trim();
    setDisplayName(trimmedValue);
    syncLandingInput();
    closeDisplayNameModal(getDisplayNameOrDefault());
}

function closeDisplayNameModal(result) {
    if (displayNameModal) {
        displayNameModal.classList.add('hidden');
    }
    displayNameModalAttemptedSubmit = false;
    if (pendingDisplayNameRequest && typeof resolveDisplayNameRequest === 'function') {
        resolveDisplayNameRequest(result);
    }
    pendingDisplayNameRequest = null;
    resolveDisplayNameRequest = null;
}

function updateDisplayNameModalValidation(forceShowError = false) {
    if (!displayNameModalInput || !displayNameModalConfirmBtn) {
        return true;
    }
    const trimmed = displayNameModalInput.value.trim();
    const isValid = Boolean(trimmed);
    displayNameModalConfirmBtn.disabled = !isValid;
    if (displayNameModalError) {
        if (!isValid && (forceShowError || displayNameModalAttemptedSubmit)) {
            displayNameModalError.textContent = 'Display name cannot be empty.';
            displayNameModalError.classList.remove('hidden');
        } else {
            displayNameModalError.textContent = '';
            displayNameModalError.classList.add('hidden');
        }
    }
    return isValid;
}

function syncLandingInput() {
    if (!landingDisplayNameInput) {
        return;
    }
    landingDisplayNameInput.value = getDisplayNameOrDefault();
}
