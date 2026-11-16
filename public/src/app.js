// Application Entry Point
// Main orchestration and initialization

// Import state modules
import { state } from './state/main.js';

// Import UI modules
import {
    setupSynthModal,
    createRoomBtn,
    joinRoomBtn,
    leaveRoomBtn,
    transportToggleBtn,
    recordToggleBtn,
    addSynthBtn,
    showLanding,
    setupInviteModal,
    setupAboutModal
} from './ui/main.js';

// Import tempo controls
import { setupTempoControls, updateTempoDisplay } from './ui/tempo-controls.js';

// Import socket module
import { socket, setupSocketEvents, setupRoomControls, setupTransportControls, setupRecordingControls, attemptAutoJoinFromInvite, connectToRoom } from './socket/main.js';
import { setupRoomFileControls } from './ui/room-file.js';
import { setupDisplayNameControls } from './ui/display-name.js';
import { installAudioUnlock } from './audio/main.js';
import { initLFOPanel, setupLFOSocketEvents } from './ui/lfo-card.js';

// Initialize application
export function initialize() {
    // Setup UI controls
    setupTempoControls(socket);
    setupTransportControls(transportToggleBtn, addSynthBtn);
    setupRecordingControls(recordToggleBtn);
    setupRoomControls(createRoomBtn, joinRoomBtn, leaveRoomBtn);
    setupRoomFileControls({ socket, connectToRoom });
    setupSynthModal(socket);
    setupInviteModal();
    setupAboutModal();
    setupDisplayNameControls();
    installAudioUnlock();
    initLFOPanel();
    setupLFOSocketEvents(socket);

    // Setup socket events
    setupSocketEvents();

    // Show landing page
    showLanding();

    // Update tempo display
    updateTempoDisplay(state.transport.bpm);

    attemptAutoJoinFromInvite();
}

// Auto-initialize when module loads
initialize();

// ?debug=1 shows a live diagnostics readout (see ui/debug-overlay.js); it
// sticks across reloads and room changes until ?debug=0.
const debugParam = new URLSearchParams(window.location.search).get('debug');
let debugEnabled = debugParam === '1';
try {
    if (debugParam === '1') window.localStorage.setItem('seqroom-debug', '1');
    if (debugParam === '0') window.localStorage.removeItem('seqroom-debug');
    debugEnabled = debugEnabled || window.localStorage.getItem('seqroom-debug') === '1';
} catch {
    // Storage blocked: the flag only lasts for this load.
}
if (debugEnabled) {
    import('./ui/debug-overlay.js').then(({ showDebugOverlay }) => showDebugOverlay()).catch(console.error);
}
