// Display Name Controls
// Handles landing page input for storing the local display name

import { setDisplayName, getDisplayName, DEFAULT_DISPLAY_NAME } from '../state/main.js';

export function setupDisplayNameControls() {
    const input = document.getElementById('display-name-input');
    if (!input) {
        return;
    }

    const storedValue = getDisplayName();
    if (storedValue) {
        input.value = storedValue;
    } else if (input.value) {
        setDisplayName(input.value);
    } else {
        input.value = DEFAULT_DISPLAY_NAME;
        setDisplayName(DEFAULT_DISPLAY_NAME);
    }

    input.addEventListener('input', () => {
        setDisplayName(input.value);
    });

    input.addEventListener('blur', () => {
        if (!input.value.trim()) {
            input.value = DEFAULT_DISPLAY_NAME;
        }
        setDisplayName(input.value);
    });
}
