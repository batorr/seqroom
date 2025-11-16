// Application Entry Point
// Main orchestration and initialization

// Import state modules
import { state } from './state/main.js';

// Import UI modules
import {
    setupSynthModal,
    primeAudioUnlock,
    createRoomBtn,
    joinRoomBtn,
    leaveRoomBtn,
    transportToggleBtn,
    recordToggleBtn,
    addSynthBtn,
    showLanding,
    setupInviteModal
} from './ui/main.js';

// Import tempo controls
import { setupTempoControls, updateTempoDisplay } from './ui/tempo-controls.js';

// Import socket module
import { socket, setupSocketEvents, setupRoomControls, setupTransportControls, setupRecordingControls, attemptAutoJoinFromInvite } from './socket/main.js';
import { setupDisplayNameControls } from './ui/display-name.js';

// Initialize application
export function initialize() {
    // Setup UI controls
    setupTempoControls(socket);
    setupTransportControls(transportToggleBtn, addSynthBtn);
    setupRecordingControls(recordToggleBtn);
    setupRoomControls(createRoomBtn, joinRoomBtn, leaveRoomBtn);
    setupSynthModal(socket);
    setupInviteModal();
    setupDisplayNameControls();
    primeAudioUnlock();

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
