# SeqRoom Module Documentation

## Overview
SeqRoom is a collaborative step sequencer built with a lightweight Node/Express server and a modular browser client. The server maintains room membership, instrument state (including creator metadata), and transport timing, relays Socket.IO events, and issues periodic clock-sync samples. Each client runs its own Web Audio engine, schedules notes locally, and can capture audio through an AudioWorklet. The client code lives under `public/src` and is grouped into constants, utilities, shared state, UI, audio, and socket layers.

## Current Layout
```
.
├── package.json
├── package-lock.json
├── server.js
├── public/
│   ├── index.html
│   ├── recording-processor.js
│   └── src/
│       ├── app.js
│       ├── audio/
│       │   ├── main.js
│       │   ├── recording.js
│       │   ├── scheduler.js
│       │   └── instruments/
│       │       ├── poly-synth.js
│       │       ├── sampler.js
│       │       ├── tb303.js
│       │       └── tr808.js
│       ├── constants/
│       │   ├── audio.js
│       │   ├── instruments.js
│       │   └── ui.js
│       ├── socket/
│       │   └── main.js
│       ├── state/
│       │   ├── audio.js
│       │   └── main.js
│       ├── ui/
│       │   ├── instrument-card.js
│       │   ├── main.js
│       │   ├── display-name.js
│       │   ├── sidebar.js
│       │   └── tempo-controls.js
│       └── utils/
│           ├── audio.js
│           └── helpers.js
├── MODULE_DOCUMENTATION.md
├── README.md
└── SETUP_AND_RUN.md
```
(`node_modules/` omitted)

## Architecture Summary
- `server.js` runs Express and Socket.IO, serves `public/`, keeps per-room transport/instrument state (including every instrument’s creator metadata), clamps tempo and step counts, validates sampler uploads (5 MB cap, whitelisted mime types), slugs user-provided room names, generates signed invite tokens, and emits events such as `state:init`, `transport:update`, `instrument:*`, `tempo:update`, `connections:update`, `requestInviteToken`, `joinWithInvite`, and `time:ping/time:sync`.
- `public/index.html` defines the landing view, sequencer layout, sidebar overlay, synth modal, and display-name input along with all DOM ids that the UI layer queries. It loads `/socket.io/socket.io.js` followed by `src/app.js` as the ES module entry point.
- `public/src/app.js` composes tempo, transport, room, recording, display-name, and synth-modal controls, triggers the audio unlock, registers socket listeners, and synchronizes the initial UI by calling `initialize()` as soon as the module loads.
- `public/src/state/main.js` is the single source of truth for transport data, instrument definitions, ordering, UI flags, and the locally chosen display name. All UI, audio, and socket modules mutate state through its exported helpers so that derived values (e.g., sampler slots, drum layers, creator labels) stay normalized.
- `public/src/state/audio.js` tracks the Web Audio context, master gain, scheduler counters, recording metadata, sampler buffers, and socket-level timing info (pending pings, clock offsets, room-request state). Audio and socket modules read and mutate this structure directly, and the socket layer uses it to cache pending creator labels for optimistic UI updates.
- Constants under `public/src/constants/` capture every limit (tempo range, step counts, sampler slot metadata) and are imported across the codebase to avoid magic numbers.
- Utilities under `public/src/utils/` centralize clamping, formatting, sampler slot creation, note-to-frequency conversion, noise buffer creation, base64 conversion, and WAV encoding.
- The UI layer (`ui/main.js`, `ui/instrument-card.js`, `ui/sidebar.js`, `ui/tempo-controls.js`, `ui/display-name.js`) renders DOM, binds user interactions (including the landing display-name field), coordinates with the socket layer, and keeps `state` plus `socketState.instrumentElements` in sync.
- The audio layer (`audio/main.js`, `audio/scheduler.js`, `audio/recording.js`, and `audio/instruments/*`) creates and schedules Web Audio nodes, caches decoded samples, calculates playback positions from the server clock, and streams recording data back to the UI.
- `public/src/socket/main.js` owns the Socket.IO client, room connect/disconnect flows, tempo/transport commands, instrument locking and editing events, sampler preparation hooks, and the wiring between socket payloads, shared state, and UI renders. It also tracks pending instrument creator labels so that UI tags stay consistent until server echoes arrive.
- `public/recording-processor.js` implements the `seqroom-recorder` AudioWorklet that `audio/recording.js` instantiates so that recording runs off the main thread.

## Module Reference

### Entry, Platform, and Server
#### `server.js`
Express + Socket.IO server. Serves static assets, manages rooms, and keeps authoritative transport/instrument state per room, attaching `creatorUserId` / `creatorDisplayName` to every instrument so all clients render the same label. Sanitizes user-provided room names, generates unique slugs and 12-character room ids, stores a per-room HMAC secret, and allows any connected member to request invite tokens. Invite tokens are compact JWT-like strings signed server-side; `joinWithInvite` verifies their nonce, lifetime, and signature before calling `joinRoom`. The server also clamps BPM (30–300) and step counts (1–128), creates normalized instruments (`TB-303`, `TR-808`, `poly-synth`, `sampler`), deep-clones TR-808 and sampler parameters, and enforces sampler upload limits. Handles events such as `room:create`, `joinWithInvite`, `requestInviteToken`, `room:leave`, `transport:play`, `transport:stop`, `transport:set-tempo`, `tempo:set` (legacy), `instrument:add`, `instrument:remove`, `instrument:set-length`, `instrument:param`, `instrument:rename`, `instrument:step`, `lockSynth`, `unlockSynth`, and `time:pong`. Broadcasts `state:init` (now including `roomSlug` and `role`), `transport:update`, `tempo:update`, `instrument:added`, `instrument:update`, `instrument:removed`, `instrument:order`, `synthLocked`, `synthUnlocked`, `lockFailed`, `connections:update`, and `time:ping/time:sync`. Calculates `sessionStartTime`/`lastScheduledStart` so clients can align playback.

#### `public/index.html`
Static HTML shell containing the landing screen, display-name input, sequencer, sidebar overlay, synth modal, invite modal, sidebar toggle, tempo controls, instrument list, empty state, and recording status label. Provides every element id used by `ui/main.js`, `ui/instrument-card.js`, and `ui/sidebar.js`. Loads the Socket.IO client bundle and then `src/app.js` with `type="module"`.

#### `public/src/app.js`
Entry module that imports shared state, UI helpers, tempo controls, and the socket integration. `initialize()` wires tempo controls to the socket, binds transport, recording, room, and invite buttons, opens both the synth and invite modals, primes the audio context unlock, registers socket event handlers, shows the landing view, updates the on-screen tempo, and triggers `attemptAutoJoinFromInvite()` so `/r/:slug?inv=token` links automatically connect. The module invokes `initialize()` immediately so the UI is ready as soon as the script loads.

#### `public/src/ui/display-name.js`
Handles the landing-page display-name field. Reads the persisted value, sanitizes user input, keeps `state.user.displayName` updated in real time, and restores a default (“Guest”) whenever the input is cleared so newly created instruments always have a label available.

#### `public/recording-processor.js`
AudioWorklet processor registered as `seqroom-recorder`. Receives Float32 audio input from the connected node, interleaves multi-channel data into a transferable `ArrayBuffer`, posts each chunk back to the main thread with channel-count metadata, and sends an initial `ready` message with the worklet sample rate.

### Constants
#### `public/src/constants/audio.js`
Defines tempo bounds (30–300 BPM), the default BPM (120), lookahead/schedule windows (`AUDIO_LOOKAHEAD_MS`, `AUDIO_SCHEDULE_AHEAD_SECONDS`), recording stat throttling, and the list of selectable note names. Imported by state normalization, tempo controls, audio scheduling, and recording components.

#### `public/src/constants/instruments.js`
Declares `SynthTypes`, TR-808 drum layer metadata, sampler slot descriptors, `SAMPLER_SLOT_IDS`, `SAMPLER_MAX_SAMPLE_BYTES`, `SAMPLER_ALLOWED_MIME_TYPES`, and `INSTRUMENT_LIBRARY` (label, tone class, and parameter sliders/selectors for each synth type). Used by state normalization, sampler helpers, UI rendering (instrument cards, sidebar), and audio scheduling.

#### `public/src/constants/ui.js`
Stores UI-related limits: default step count (16), min/max steps (1–128), and grid column count (16). Consumed by state normalization, helpers, UI rendering, and socket validation helpers.

### Utilities
#### `public/src/utils/helpers.js`
General helper library. Provides clamping (`clampTempo`, `clampStepCount`, `clampValue`), byte/duration formatting, slider/select param builders, melodic/drum/sampler step factories, sampler slot factory, sampler sample normalization helpers, and `createPitchSelect` for UI dropdown buttons. Used by state management, sampler handling, UI rendering, and socket workflows.

#### `public/src/utils/audio.js`
Audio-specific helpers: note-to-frequency conversion, white-noise buffer creation, base64 encoding/decoding for sampler uploads, reversed-buffer generation, recording chunk merging, WAV encoding, and DataView string writing. Used by the audio engine, sampler loader, TR-808 noise sources, and recording/export code.

### State Management
#### `public/src/state/main.js`
Holds the canonical `state` object (room info, transport, instruments map, ordering, selected instrument, UI flags, user display name) plus helpers to mutate it (`setRoomId`, `setTransportPlaying`, `setTempo`, `addInstrument`, `removeInstrument`, `setActiveInstrument`, `setSidebarOpen`, `updateInstrumentParams`, `updateInstrumentName`, `setDisplayName`, `getDisplayNameOrDefault`, `hydrateState`). Normalizes instruments received from the server, including sampler slot sanitization (`normalizeSamplerParams`, `normalizeSamplerSample`, `normalizeSamplerStep`), TR-808 drum layers, melodic steps, and creator metadata. Provides `sanitizeInstrumentName`, `ensureLocalInstrumentCapacity`, `setInstrumentStepCountLocal`, `setInstrumentLockedBy`, and `getStepDurationMs`.

#### `public/src/state/audio.js`
Defines `audioState` (AudioContext, master gain, scheduler counters, recording metadata, sampler buffer caches) and `socketState` (instrument DOM references, pending room requests, ping metadata, clock offset/latency estimates, suppressed update timers, pending creator-label caches). Exposes setters such as `setAudioContext`, `setMasterGain`, `setSchedulerId`, `setNextStepIndex`, `setRecordingState`, `setSamplerBuffer`, `deleteSamplerBuffer`, `clearSamplerBuffers`, and socket-related helpers (`setClockOffset`, `setLatencyEstimate`, `setHasSyncSample`, `clearPendingPings`, `setPendingRoomRequest`).

### Audio Engine
#### `public/src/audio/main.js`
Ensures a single AudioContext/master gain, resumes suspended contexts, seeds sampler instruments by calling `prepareSamplerAudio`, and exposes clock helpers (`getServerSyncedTime`, `getClientAbsoluteTime`) plus `applyClockCorrection` to smooth clock offset and latency estimates before updating the UI sync display.

#### `public/src/audio/scheduler.js`
Translates transport state into Web Audio scheduling. Provides `getCurrentStepIndex`, `syncAudioScheduler` (aligns `audioState.nextStepIndex` with the current server time, kicks off the scheduling interval, and updates playback indicators), `stopAudioScheduler`, `runAudioScheduler`, `scheduleStep` (iterates instruments, ensures local step capacity, skips inactive steps), and `scheduleInstrumentStep` (dispatches to the instrument-specific scheduler based on `SynthTypes`). Depends on `ensureAudioContext`, `state`, `audioState`, `SynthTypes`, UI playback indicator hooks, and instrument scheduler modules.

#### `public/src/audio/recording.js`
Controls recording. `isRecordingSupported` checks AudioWorklet availability, `toggleRecording` switches recording state, `startRecording` ensures the worklet module is loaded, creates the `seqroom-recorder` node, wires event handlers (`handleRecordingMessage`), and tracks stats in `audioState`. `stopRecording` disconnects the node, merges buffered Float32 chunks, encodes a WAV blob, and triggers a download via `downloadBlob`. Includes helpers to clear/reset recording data, update the on-screen status (`recordingStatusEl`), throttle stats updates, toggle the record button state, and format byte/duration labels.

#### `public/src/audio/instruments/tb303.js`
Schedules an acid-style bass voice: configures an oscillator, low-pass filter, and exponential amplitude envelope based on instrument parameters, then routes the result through the shared master gain.

#### `public/src/audio/instruments/tr808.js`
Schedules TR-808 layers (kick, snare, hat, clap) according to per-step layer flags. Uses noise buffers plus filter/gain envelopes per drum, clamps parameter ranges, and routes each partial to the master gain.

#### `public/src/audio/instruments/poly-synth.js`
Schedules a polyphonic subtractive synth voice. Configures an oscillator (sine/triangle/saw/square), ADSR envelope, and resonant low-pass filter per step based on instrument parameters, then connects to the master gain.

#### `public/src/audio/instruments/sampler.js`
Handles sampler playback and decoding. Generates cache keys per instrument/slot, schedules slots whose steps are active (applying volume/pan/pitch/start/end/reverse settings), and keeps decoded buffers plus reversed variants in `audioState.samplerBuffers`. Includes `prepareSamplerAudio` (ensures every sampler instrument has decoded buffers), `loadSamplerSlotSample` (decodes base64 payloads, tracks pending loads), and `cleanupSamplerBuffers` (purges caches when instruments are removed).

### UI Layer
#### `public/src/ui/main.js`
Collects DOM references, initializes the sidebar, wires up the landing display-name field, and renders the main view. Provides view toggles (`showLanding`, `showSequencer`), modal controls (synth modal plus the invite modal with copy-to-clipboard helpers), transport rendering (tempo display, transport buttons, playback indicators, invite button state), instrument list rendering (via dynamic import of `ui/instrument-card.js`), recorder status updates, connection/sync banners, and utility helpers like `showRoomCodeHint` (now showing the room slug) and `updateRoomDisplay`. Also exports the DOM elements used by other modules (tempo inputs, buttons, instrument template, etc.) and passes the sanitized display name alongside instrument-add/socket payloads.

#### `public/src/ui/instrument-card.js`
Large module that renders individual instrument cards from a template, manages collapsed state via `localStorage`, and stores references in `socketState.instrumentElements`. Handles melodic/drum/sampler step grid interactions, pitch selection popovers, parameter sliders, instrument renaming, locking state, sampler uploads (size/mime validation, drag-and-drop, delete/reset interactions), labeling card headers as `type by creator` using the per-instrument metadata, and recording of local-only mutations before socket acknowledgements. Provides helpers for updating playback indicators, ensuring card existence (`ensureInstrumentCard`), rendering empty states, scrolling into view, and coordinating with the sidebar.

#### `public/src/ui/sidebar.js`
Manages the overlay sidebar listing all instruments. Controls the open/close state, keyboard interactions, overlay click handling, and DOM updates for each instrument entry. Uses `updateSidebarEntry`, `removeInstrumentSidebarEntry`, `updateSidebarSelection`, and notifies `ui/instrument-card.js` when the user activates an instrument from the sidebar.

#### `public/src/ui/tempo-controls.js`
Owns the BPM slider and numeric input. Exposes `tempoInputState`, `updateTempoDisplay`, `commitTempo`, and `setupTempoControls`. Clamps BPM to the allowed range, updates the shared state, emits `transport:set-tempo` when connected, and triggers `syncAudioScheduler` after each change.

### Socket Layer
#### `public/src/socket/main.js`
Creates the Socket.IO client, registers all event listeners, and exports control wiring helpers. `setupSocketEvents` hydrates state on `state:init`, updates transport and tempo, handles instrument add/update/remove/order events (normalizing instruments and triggering UI renders), propagates sampler updates, manages lock notifications, applies server-sent step toggles for legacy clients, updates connection counts, and drives clock sync via `time:ping`/`time:sync`. `setupRoomControls`, `setupTransportControls`, and `setupRecordingControls` bind DOM elements to socket commands; room controls now prompt for a room name when the create button is pressed, let any connected member request invite tokens, and parse pasted invite links/tokens. `connectToRoom` orchestrates room creation (`room:create` with `{ roomName }`) and invite joins (`joinWithInvite`), handles request timeouts, UI resets, slug display, and landing/sequencer transitions while tagging payloads with the local display name. `attemptAutoJoinFromInvite()` watches the current URL for `/r/:slug?inv=` links and automatically calls `connectToRoom`. `handleRoomError` and `leaveRoom` centralize room teardown. The module also caches pending creator labels (for newly added instruments and for the default instrument after room creation) so the UI can show `type by display-name` immediately, then clears the cache when the server echoes the authoritative payload. Finally, it exposes helper functions to resolve instrument ids by name, ensure the audio context is ready before sending commands, and keep suppression timers for optimistic UI updates.

### Supporting Assets
#### `package.json`
Defines the `npm start` script (`node server.js`) and runtime dependencies (`express`, `socket.io`).

#### `SETUP_AND_RUN.md` and `README.md`
Provide operational guidance and high-level overview, respectively. Both describe the same modules listed here.

## Data Flow
1. **Initialization**
   - `public/index.html` loads `/socket.io/socket.io.js` and `src/app.js`.
   - `app.js` calls `setupTempoControls`, `setupTransportControls`, `setupRecordingControls`, `setupRoomControls`, `setupSynthModal`, `primeAudioUnlock`, `setupSocketEvents`, `showLanding`, and `updateTempoDisplay`.
2. **Room lifecycle**
   - UI buttons call `connectToRoom` in `socket/main.js`, which ensures the audio context is ready, starts the socket, and emits `room:create` with the landing room name or `joinWithInvite` with an invite token (or automatically if the URL already contains `/r/:slug?inv=...`).
   - `server.js` sanitizes the provided room name, generates a slug + secret, validates invite tokens, stores/updates room state, and emits `state:init` with both the internal room id and slug/role metadata. When a new room is created, the host’s display name is baked into the default instrument so everyone sees `type by Name`. The client hydrates state via `hydrateState`, renders instruments/transport, and shows the sequencer view. `leaveRoom` tears everything down, clears the slug, and returns to the landing screen.
   - The invite button calls `requestInviteToken`, which the server now permits for any connected member. The response token is turned into a `/r/:slug?inv=` share link and displayed inside the invite modal for copy-to-clipboard sharing.
3. **Transport and scheduling**
   - Tempo changes originate from `ui/tempo-controls.js`, update local state, and emit `transport:set-tempo`. The server clamps BPM and broadcasts `transport:update`.
   - Play/stop buttons emit `transport:play/stop`. When clients receive `transport:update`, `audio/scheduler.js` aligns `audioState.nextStepIndex`, updates playback indicators, and schedules upcoming steps through the instrument schedulers.
4. **Instrument editing and sampler uploads**
   - `ui/instrument-card.js` handles step toggles, parameter changes, renames, step count adjustments, and sampler file uploads. Events emit through Socket.IO (`instrument:step`, `instrument:param`, `instrument:rename`, `instrument:set-length`, etc.).
   - `server.js` normalizes payloads, updates room state, and rebroadcasts `instrument:update`. When clients add instruments they include their current display name and socket id so the server can stamp `creatorDisplayName` / `creatorUserId`. Clients normalize incoming instruments, refresh cards, and let `audio/instruments/sampler.js` decode new samples as needed.
5. **Clock synchronization**
   - `server.js` emits `time:ping` to each client at a fixed interval.
   - `socket/main.js` responds with `time:pong` timestamps. When `time:sync` arrives, `audio/main.js.applyClockCorrection` smooths the offset/latency in `socketState`, and `ui/main.js.updateSyncStatus` displays the current measurements.
6. **Recording pipeline**
   - `socket/main.js.setupRecordingControls` binds the record button to `audio/recording.js.toggleRecording`.
   - `audio/recording.js` loads `recording-processor.js`, connects it to `audioState.masterGain`, buffers Float32 chunks via `handleRecordingMessage`, and updates `recordingStatusEl`.
   - When stopped, the module merges chunks, encodes a WAV, and triggers a download. UI state is reset via `updateRecordButton` and `clearRecordingData`.

This documentation reflects the current project structure and module responsibilities; update it whenever files are added, renamed, or repurposed.
