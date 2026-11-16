# SeqRoom Module Documentation

## Overview
SeqRoom is a collaborative step sequencer built with a lightweight Node/Express server and a modular browser client. The server maintains room membership, instrument state (including creator metadata), and transport timing, relays Socket.IO events, and issues periodic clock-sync samples. Each client runs its own Web Audio engine, schedules notes locally, and can capture audio through an AudioWorklet. The client code lives under `public/src` and is grouped into constants, utilities, shared state, UI, audio, and socket layers.

## Current Layout
```
.
├── package.json
├── package-lock.json
├── server.js
├── lib/
│   └── client-ip.js
├── public/
│   ├── index.html
│   ├── recording-processor.js
│   └── src/
│       ├── app.js
│       ├── audio/
│       │   ├── graph.js
│       │   ├── main.js
│       │   ├── recording.js
│       │   ├── scheduler.js
│       │   ├── wake-lock.js
│       │   └── instruments/
│       │       ├── drums.js
│       │       ├── fx.js
│       │       ├── hoover.js
│       │       ├── poly-synth.js
│       │       ├── rave-stab.js
│       │       ├── rumble.js
│       │       └── tb303.js
│       ├── constants/
│       │   ├── audio.js
│       │   ├── instruments.js
│       │   └── ui.js
│       ├── shared/
│       │   ├── acid-line.js
│       │   ├── clock-sync.js
│       │   ├── drum-kit.js
│       │   ├── fx.js
│       │   ├── hoover.js
│       │   ├── rave-stab.js
│       │   ├── room-file.js
│       │   ├── rumble.js
│       │   ├── slurs.js
│       │   └── timeline.js
│       ├── socket/
│       │   └── main.js
│       ├── state/
│       │   ├── audio.js
│       │   └── main.js
│       ├── ui/
│       │   ├── debug-overlay.js
│       │   ├── instrument-card.js
│       │   ├── main.js
│       │   ├── display-name.js
│       │   ├── lfo-card.js
│       │   ├── room-file.js
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
- `server.js` runs Express and Socket.IO, serves `public/`, keeps per-room transport/instrument state (including every instrument’s creator metadata), clamps tempo and step counts, slugs user-provided room names, generates signed invite tokens, and emits events such as `state:init`, `transport:update`, `instrument:*`, `tempo:update`, `connections:update`, `requestInviteToken`, `joinWithInvite`, and `time:ping/time:sync`.
- `public/index.html` defines the landing view, the sequencer (transport, score, inspector, modulation), the modals, and the display-name input along with all DOM ids that the UI layer queries. It loads `/socket.io/socket.io.js` followed by `src/app.js` as the ES module entry point.
- `public/src/app.js` composes tempo, transport, room, recording, display-name, and synth-modal controls, triggers the audio unlock, registers socket listeners, and synchronizes the initial UI by calling `initialize()` as soon as the module loads.
- `public/src/state/main.js` is the single source of truth for transport data, instrument definitions, ordering, UI flags, and the locally chosen display name. All UI, audio, and socket modules mutate state through its exported helpers so that derived values (e.g., drum and FX lanes, creator labels) stay normalized.
- `public/src/state/audio.js` tracks the Web Audio context, master gain, scheduler counters, recording metadata, muted instruments, and socket-level timing info (pending pings, clock offsets, room-request state). Audio and socket modules read and mutate this structure directly, and the socket layer uses it to cache pending creator labels for optimistic UI updates.
- Constants under `public/src/constants/` capture every limit (tempo range, step counts, instrument metadata) and are imported across the codebase to avoid magic numbers.
- Utilities under `public/src/utils/` centralize clamping, formatting, step factories, note-to-frequency conversion, noise buffer creation, and WAV encoding.
- The UI layer (`ui/main.js`, `ui/instrument-card.js`, `ui/lfo-card.js`, `ui/tempo-controls.js`, `ui/display-name.js`) renders DOM, binds user interactions (including the landing display-name field), coordinates with the socket layer, and keeps `state` plus `socketState.instrumentElements` in sync.
- The audio layer (`audio/main.js`, `audio/scheduler.js`, `audio/recording.js`, and `audio/instruments/*`) creates and schedules Web Audio nodes, calculates playback positions from the server clock, and streams recording data back to the UI.
- `public/src/socket/main.js` owns the Socket.IO client, room connect/disconnect flows, tempo/transport commands, instrument locking and editing events, and the wiring between socket payloads, shared state, and UI renders. It also tracks pending instrument creator labels so that UI tags stay consistent until server echoes arrive.
- `public/recording-processor.js` implements the `seqroom-recorder` AudioWorklet that `audio/recording.js` instantiates so that recording runs off the main thread.

## Module Reference

### Entry, Platform, and Server
#### `server.js`
Express + Socket.IO server. Serves static assets, manages rooms, and keeps authoritative transport/instrument state per room, attaching `creatorUserId` / `creatorDisplayName` to every instrument so all clients render the same label. Sanitizes user-provided room names, generates unique slugs and 12-character room ids, stores a per-room HMAC secret, and allows any connected member to request invite tokens. Invite tokens are compact JWT-like strings signed server-side; `joinWithInvite` verifies their nonce, lifetime, and signature before calling `joinRoom`. The server also clamps BPM (30–300) and step counts (1–128), creates normalized instruments (`tb-303`, `drum-kit`, `poly-synth`, `rumble`, `rave-stab`, `hoover`, `fx`), validates Rave Kit parameters and drum layers against `public/src/shared/drum-kit.js`, FX parameters and lane layers against `public/src/shared/fx.js` (an FX step is only edited lane by lane, with `drum`/`value` like a drum voice), Rumble parameters against `public/src/shared/rumble.js`, Rave Stab parameters (including the chord shape) against `public/src/shared/rave-stab.js` and Hoover parameters against `public/src/shared/hoover.js`. There is no file upload any more (the sampler was removed): every instrument is synthesised in the browser. Memory is bounded by `MAX_ROOMS` (500; at the cap `makeRoomForNewRoom` first drops rooms nobody is in, else `room:create` answers `server-full`) and `MAX_INSTRUMENTS_PER_ROOM` (24, else `instrument:add` answers `instrument-limit`), both overridable with `SEQROOM_MAX_ROOMS` / `SEQROOM_MAX_INSTRUMENTS_PER_ROOM`; LFOs are capped at 8 per room, and an emptied room waits 15 minutes (`ROOM_EMPTY_TIMEOUT_MS`) for reconnects. Room creation and joins are rate-limited per visitor address (`socket.data.clientIp`, from `lib/client-ip.js`). Client messages are small JSON commands or gzip-compressed room files, so Socket.IO's `maxHttpBufferSize` is capped at 100 KB. Room files (`public/src/shared/room-file.js`): `room:create` takes an optional `roomFile` to open a saved room instead of a fresh one, and `room:import` replaces every instrument, the tempo and the LFOs of the sender's room and sends each member a fresh `state:init` (which now also carries `connections`). `readRoomFilePayload` gunzips with a 2 MB output cap, `buildRoomContent` rebuilds the instruments (with new ids) through `createInstrument`, `applyInstrumentParams` and the step normalisers (Acid Bass and Poly Synth parameters limited to the keys and slider ranges they have), and remaps LFO targets; files over `MAX_INSTRUMENTS_PER_ROOM` answer `instrument-limit`, and `room:import` is rate-limited to 5 per minute per visitor address. Parameter updates are rate-limited at 1500 per minute per socket (clients throttle knob sweeps to ~20 per second). Handles events such as `room:create`, `room:import`, `joinWithInvite`, `requestInviteToken`, `room:leave`, `transport:play`, `transport:stop`, `transport:set-tempo`, `tempo:set` (legacy), `instrument:add`, `instrument:remove`, `instrument:set-length`, `instrument:param`, `instrument:rename`, `instrument:step`, `instrument:mute`, `lockSynth`, `unlockSynth`, `time:pong`, and `time:request` (client-initiated clock probe with an ack). The `instrument:mute` handler toggles `instrument.muted` on the server-side instrument and rebroadcasts via `broadcastInstrumentState` so all clients stay in sync. Broadcasts `state:init` (now including `roomSlug` and `role`), `transport:update`, `tempo:update`, `instrument:added`, `instrument:update`, `instrument:removed`, `instrument:order`, `synthLocked`, `synthUnlocked`, `lockFailed`, `connections:update`, and `time:ping/time:sync`. Keeps the room transport as a tempo-segment timeline (`public/src/shared/timeline.js`, loaded with a dynamic `import()` before the server listens): a tempo change opens a new segment on the first step boundary at least `TEMPO_CHANGE_LEAD_MS` (500 ms) ahead, so audio that clients have already queued never moves and every client switches tempo on the same step. `transport:update` carries `playId` and `segments`, plus a derived `sessionStartTime` for older clients.

#### `lib/client-ip.js`
The visitor's address for rate limits. Behind a trusted proxy (`RENDER` is set, or `TRUST_PROXY=1`) it takes the last `X-Forwarded-For` hop (the address that connected to Render's proxy, which a client cannot forge) and, when that hop is one of Cloudflare's published ranges, Cloudflare's `CF-Connecting-IP`; otherwise the connection's own address. A forged `CF-Connecting-IP` sent straight to the service's onrender.com address is therefore ignored. Covered by `test/client-ip.test.mjs`.

#### `public/index.html`
Static HTML shell: masthead (wordmark plus the room bar with room, head count, clock status, Invite/Leave), landing screen, and the sequencer, which is the transport (play/record, tempo number with -/+ steppers, a tempo ruler that is the `#tempo` range input, bar/beat/step readout), the **score** (a 16-column ruler plus `#instrument-list`, one row per instrument), and below it the **inspector** (`#instrument-inspector`, settings of the selected instrument) next to **modulation** (`#lfo-list`). Also holds the invite, create-room, display-name, add-instrument and about modals and two templates: `#instrument-card-template` (a score row) and `#instrument-inspector-template` (its inspector panel). Loads the Socket.IO client bundle and then `src/app.js` with `type="module"`.

The `<style>` block implements the "Score" look: a light paper ground (`--paper`), ink text and rules, one accent (`--accent`, cobalt) for selection and the playhead, and `--mark` (vermilion) for accent marks and recording. Inter Tight for text, IBM Plex Mono for codes. The score grid is driven by `--label-col` (instrument column), `--lane-col` (lane labels) and 16 equal step columns; both label columns stay pinned while the score scrolls sideways (only the lane labels on phones).

#### `public/src/app.js`
Entry module that imports shared state, UI helpers, tempo controls, and the socket integration. `initialize()` wires tempo controls to the socket, binds transport, recording, room, and invite buttons, opens both the synth and invite modals, primes the audio context unlock, registers socket event handlers, shows the landing view, updates the on-screen tempo, and triggers `attemptAutoJoinFromInvite()` so `/r/:slug?inv=token` links automatically connect. The module invokes `initialize()` immediately so the UI is ready as soon as the script loads. `?debug=1` in the URL (remembered in `localStorage` until `?debug=0`) loads `ui/debug-overlay.js`.

#### `public/src/ui/display-name.js`
Handles the landing-page display-name field. Reads the persisted value, sanitizes user input, keeps `state.user.displayName` updated in real time, and restores a default (“Guest”) whenever the input is cleared so newly created instruments always have a label available.

#### `public/recording-processor.js`
AudioWorklet processor registered as `seqroom-recorder`. Receives Float32 audio input from the connected node, interleaves multi-channel data into a transferable `ArrayBuffer`, posts each chunk back to the main thread with channel-count metadata, and sends an initial `ready` message with the worklet sample rate.

### Constants
#### `public/src/constants/audio.js`
Defines tempo bounds (30–300 BPM), the default BPM (120), lookahead/schedule windows (`AUDIO_LOOKAHEAD_MS`, `AUDIO_SCHEDULE_AHEAD_SECONDS`, and the longer `AUDIO_SCHEDULE_AHEAD_SECONDS_TOUCH` for phones and tablets, which must stay under the server's 500 ms tempo-change lead), recording stat throttling, and the list of selectable note names. Imported by state normalization, tempo controls, audio scheduling, and recording components.

#### `public/src/constants/instruments.js`
Declares `SynthTypes` (`tb-303`, `drum-kit`, `poly-synth`, `rumble`, `rave-stab`, `hoover`, `fx`), re-exports `FX_VOICES` from `shared/fx.js`, re-exports `DRUM_VOICES` from `shared/drum-kit.js`, and `INSTRUMENT_LIBRARY` (label, tone class, and parameter sliders/selectors for each synth type; the TB-303 has Drive/Delay/Reverb, the poly synth Delay/Reverb, the Rumble Volume/Decay/Tone/Drive/Pump from `shared/rumble.js`, the Rave Stab Volume/Cutoff/Env Mod/Decay/Detune/Delay/Reverb plus a Chord select from `shared/rave-stab.js`, the Hoover Volume/Length/Bend/Glide/Width/Cutoff/Delay/Reverb from `shared/hoover.js`, FX Volume/Length/Tone/Delay/Reverb from `shared/fx.js`, where Length snaps to 4–64 steps and shows them through the slider definition's optional `format`). For the Rave Kit it builds `DRUM_KIT_PARAM_DEFS` (Volume, Drive, Room) and `DRUM_VOICE_PARAM_DEFS` (one slider list per voice) from the shared schema; `ui/instrument-card.js` shows the kit sliders followed by those of the voice selected in the score. Used by state normalization, step factories, UI rendering (score rows and inspector), and audio scheduling.

#### `public/src/constants/ui.js`
Stores UI-related limits: default step count (16), min/max steps (1–128), and grid column count (16). Consumed by state normalization, helpers, UI rendering, and socket validation helpers.

### Utilities
#### `public/src/utils/helpers.js`
General helper library. Provides clamping (`clampTempo`, `clampStepCount`, `clampValue`), byte/duration formatting, slider/select param builders, melodic/drum/FX step factories and `createPitchSelect` for UI dropdown buttons. Used by state management, UI rendering, and socket workflows.

#### `public/src/utils/audio.js`
Audio-specific helpers: note-to-frequency conversion, white-noise buffer creation, recording chunk merging, WAV encoding, and DataView string writing. Used by the audio engine, drum and FX noise sources, and recording/export code.

### State Management
#### `public/src/state/main.js`
Holds the canonical `state` object (room info, transport, instruments map, ordering, selected instrument, UI flags, user display name) plus helpers to mutate it (`setRoomId`, `setTransportPlaying`, `setTempo`, `addInstrument`, `removeInstrument`, `setActiveInstrument`, `updateInstrumentParams`, `updateInstrumentName`, `setDisplayName`, `getDisplayNameOrDefault`, `hydrateState`). Normalizes instruments received from the server, including Rave Kit drum layers, FX lanes, melodic steps, creator metadata, and the `muted` boolean flag. Provides `sanitizeInstrumentName`, `ensureLocalInstrumentCapacity`, `setInstrumentStepCountLocal`, `setInstrumentLockedBy`, and `getStepDurationMs`.

#### `public/src/state/audio.js`
Defines `audioState` (AudioContext, master gain, scheduler counters, recording metadata, and `mutedInstruments: new Set()` tracking which instrument ids are currently muted) and `socketState` (instrument DOM references, pending room requests, ping metadata, clock offset/latency estimates, suppressed update timers, pending creator-label caches). Exposes setters such as `setAudioContext`, `setMasterGain`, `setSchedulerId`, `setNextStepIndex`, `setRecordingState`, and socket-related helpers (`setClockOffset`, `setLatencyEstimate`, `setHasSyncSample`, `clearPendingPings`, `setPendingRoomRequest`).

### Audio Engine
#### `public/src/audio/main.js`
Ensures a single AudioContext and builds its mix graph (`audio/graph.js`; `audioState.masterGain` is the graph input, `audioState.masterOutput` the limited output), starts or resumes the context from every user gesture until it runs (`installAudioUnlock`: Firefox and Safari only allow it inside the gesture's own handler, on touch at the end of the tap; iOS 17+ gets a `playback` audio session so the ringer switch does not mute it; `isAudioBlocked` lets the clock status read "Tap for sound" while playback runs unheard), and exposes clock helpers (`getServerSyncedTime`, `getClientAbsoluteTime`) plus `applyClockCorrection`, which feeds an NTP-style estimator (`shared/clock-sync.js`: lowest-RTT sample wins; while playing the offset only slews by 1 ms per sample) before updating the UI sync display. `updateAudioClockMapping`, `serverTimeToContextTime`, and `contextTimeToServerTime` map server time to AudioContext time through `getOutputTimestamp()` (median-filtered), so a note scheduled for server time T is heard at T regardless of the device's output latency.

#### `public/src/audio/scheduler.js`
Translates transport state into Web Audio scheduling. Step times come from the shared transport timeline (`shared/timeline.js`). Provides `getCurrentStepIndex` (audible step), `syncAudioScheduler` (starts from the current position only when a new `playId` begins; tempo changes never move `audioState.nextStepIndex`; keeps the screen awake while playing, see `wake-lock.js`), `stopAudioScheduler` (also releases the wake lock and fades out FX with `silenceFx`), `runAudioScheduler` (queues every step due within the look-ahead via `collectDueSteps`, never the same step twice, and drops steps more than 15 ms late; the look-ahead is 0.18 s, or 0.35 s on touch devices so a stalled timer on a phone does not starve the audio), `schedulerStats` (tick gaps, the smallest look-ahead lead and late steps, read by the debug overlay), a requestAnimationFrame playhead loop that touches the DOM only when the step changes, `scheduleStep` (iterates instruments, ensures local step capacity, skips inactive steps), and `scheduleInstrumentStep` (checks `audioState.mutedInstruments` first and returns early if the instrument is muted, then dispatches to the instrument-specific scheduler based on `SynthTypes`). Depends on `ensureAudioContext`, `state`, `audioState`, `SynthTypes`, UI playback indicator hooks, and instrument scheduler modules.

#### `public/src/audio/wake-lock.js`
`keepScreenAwake(on)` holds a Screen Wake Lock while the transport plays (iOS Safari throttles the timers of a page whose screen dims, which starves the scheduler) and re-acquires it when the page becomes visible again or on the next tap, since the browser drops it when the page is hidden. `isScreenKeptAwake()` reports the state. Does nothing where the API is missing.

#### `public/src/audio/graph.js`
The mix bus, built per AudioContext by `createAudioGraph(ctx)` (so an `OfflineAudioContext` renders through the same chain): input → glue compressor (-16 dB, 2.5:1) → makeup → limiter (-1.5 dB) → soft ceiling clipper (linear to -2 dBFS, ceiling -0.2 dBFS) → output. Two return effects feed the input: a dotted-eighth delay with filtered feedback (`setTempo(bpm)` follows the transport; the scheduler calls it every tick) and a generated convolution room behind a 220 Hz high-pass. `routeVoice(ctx, node, { delay, reverb })` connects a voice to the mix plus its sends and returns the nodes it wired; `releaseWhenEnded(sources, nodes)` disconnects those nodes once every given source has ended. Every per-step voice uses it: WebKit (Safari and every iOS browser) keeps a finished voice in the graph until garbage collection and processes it every render quantum, so without it the audio thread overloads after a minute or two of playing and the sound breaks up; `getDriveCurve(amount)` returns cached normalised tanh curves for drive stages.

#### `public/src/audio/recording.js`
Controls recording. It records `audioState.masterOutput`, i.e. exactly what is heard. `isRecordingSupported` checks AudioWorklet availability, `toggleRecording` switches recording state, `startRecording` ensures the worklet module is loaded, creates the `seqroom-recorder` node, wires event handlers (`handleRecordingMessage`), and tracks stats in `audioState`. `stopRecording` disconnects the node, merges buffered Float32 chunks, encodes a WAV blob, and triggers a download via `downloadBlob`. Includes helpers to clear/reset recording data, update the on-screen status (`recordingStatusEl`), throttle stats updates, toggle the record button state, and format byte/duration labels.

#### `public/src/audio/instruments/tb303.js`
Acid bass voice: saw/square oscillator → two cascaded low-passes (24 dB/oct, resonance on the second) with their own envelope → amplitude envelope → pedal-style drive (mid boost, tanh clipping after the VCA so accented notes break up more, then a fizz-taming low-pass) → output gain → `routeVoice` with the Delay and Reverb sends. Accent: full level, deeper/faster sweep, more resonance. Slide: a sliding step holds into the next step, which glides the same oscillator without retriggering the envelopes.

#### `public/src/audio/instruments/drums.js`
The Rave Kit, fully synthesised and voiced for acid techno (defaults: short overdriven kick, bright hats, kit drive on; new rooms start at 140 BPM): kick (sine with a two-stage pitch drop, noise click, soft clip), snare (two triangle heads plus filtered noise), clap (three short noise bursts and a tail), rim (short tuned click), closed/open hat and ride (six square waves at inharmonic ratios, band-passed, plus noise; the ride adds a bell), low/mid/high toms (a sine dropping onto its pitch, a triangle partial a fifth up, a stick click), cowbell (two detuned squares through a band-pass, a clank settling into a tail), shaker (high band-passed noise with a soft attack) and crash (brighter metal plus a wash of noise, long fade). A closed hat chokes a ringing open hat. The six-square metal of the hats, ride and crash is rendered once per sample rate into a two-second loop (`prepareMetalLoops`; every partial completes a whole number of cycles, so the loop is seamless) and a hit plays that loop with a pitch factor; until the loops are ready, hits fall back to live oscillators. Hats, ride and crash share one filter chain per kit and voice (`metalBus`) instead of building filters per hit; together this roughly halves the kit's CPU cost. Every one-shot source disconnects its voice when it ends (`releaseWhenEnded`). Each kit instrument gets a bus (`ensureKit`) with the kit Drive stage and a Room send to the shared reverb; `releaseDrumKit` frees it when the instrument is removed. Parameters come from `shared/drum-kit.js` and are LFO-modulatable.

#### `public/src/audio/instruments/rumble.js`
The Rumble: per step a short kick-like sine thump at the step's pitch goes into a per-instrument mono bus (`ensureBus`): a long, dark generated reverb (Decay, 0.4–3 s; rebuilt only when Decay moves by 0.02) → low-pass (Tone, 45–413 Hz) → drive → smoothing low-pass → 28 Hz high-pass → duck → mix. Each hit ducks the bus and lets it swell back over a few steps (Pump sets depth and recovery, in steps, so it follows the tempo), like a sidechain from the kick. `releaseRumble` frees the bus when the instrument is removed. Parameters are LFO-modulatable.

#### `public/src/audio/instruments/rave-stab.js`
The Rave Stab: a step plays the chord shape of the instrument's Chord parameter on the step's pitch. Every chord note gets two saws detuned apart (Detune, up to ±25 cents) and panned left and right, through a 160 Hz high-pass (clear of the bass and rumble) and a resonant low-pass that starts bright and closes fast (Cutoff, 300 Hz–9.6 kHz; Env Mod), into an amp with exponential Decay, routed to the mix with delay and reverb sends (`routeVoice`). No per-instrument bus, so nothing to release. Parameters are LFO-modulatable.

#### `public/src/audio/instruments/fx.js`
FX, one lane per effect: riser (stereo noise through a band-pass sweeping up plus two detuned saws climbing two octaves, swelling over Length steps and cut on the step it lands on), downlifter (noise through a low-pass sweeping down and a falling saw, fading over half the Length), impact (a sub boom falling from 120 to 30 Hz through a soft clip, a noise burst, extra reverb) and zap (a square diving through a resonant low-pass, extra delay). Length is in steps, so risers follow the tempo; Tone moves the sweep ranges and the zap's start pitch. Every voice passes its own "kill" gain before `routeVoice`, and `silenceFx` (called by `stopAudioScheduler`) fades those out, so a riser stops with the transport. Parameters are LFO-modulatable.

#### `public/src/audio/instruments/hoover.js`
The Hoover: a mono lead. A `ConstantSourceNode` carries the pitch in Hz into three saws (detuned apart by Width and panned left/centre/right), a pulse built from a saw minus a delayed copy of itself (an LFO on the delay sweeps the pulse width) and a square an octave down, then a 90 Hz high-pass, a low-pass (Cutoff, 400 Hz–12.8 kHz) and an amp held for 1–8 steps (Length, so it follows the tempo), routed to the mix with delay and reverb sends. A fresh note falls into its pitch from up to an octave above (Bend); a note that starts while the previous one still holds glides over from that pitch (Glide), and the previous voice is faded out. `releaseHoover` forgets the voice when the instrument is removed. Parameters are LFO-modulatable.

#### `public/src/audio/instruments/poly-synth.js`
Schedules a polyphonic subtractive synth voice. Configures an oscillator (sine/triangle/saw/square), ADSR envelope, and resonant low-pass filter per step based on instrument parameters, then routes it through `routeVoice` with Delay and Reverb sends.

### UI Layer
#### `public/src/ui/main.js`
Collects DOM references (including the score ruler cells, position readout, inspector container and templates), wires up the landing display-name field, and renders the main view. `showSequencer`/`showLanding` toggle the masthead room bar; `updateConnectionsDisplay` and `updateSyncStatus` fill it (the clock status shows the round trip, with offset and RTT in its tooltip). Provides view toggles (`showLanding`, `showSequencer`), modal controls (synth modal plus the invite modal with copy-to-clipboard helpers), transport rendering (tempo display, transport buttons, playback indicators, invite button state), instrument list rendering (via dynamic import of `ui/instrument-card.js`), recorder status updates, connection/sync banners, and utility helpers like `showRoomCodeHint` (now showing the room slug) and `updateRoomDisplay`. Also exports the DOM elements used by other modules (tempo inputs, buttons, instrument template, etc.) and passes the sanitized display name alongside instrument-add/socket payloads.

#### `public/src/ui/instrument-card.js`
Renders each instrument as a row of the score plus an inspector panel. The row (from `#instrument-card-template`) holds the name, type/creator, Mute/Lock and the step lanes; the inspector panel (from `#instrument-inspector-template`, appended to `#instrument-inspector`) holds rename/remove, step length, Fill/Random and the parameter controls. Only the selected instrument's panel is shown (`updateActiveInstrumentHighlight`, which falls back to the first instrument); clicking anywhere in a row selects it. Step lanes: TB-303 gets Accent / Note / Pitch / Slide lanes, the poly synth Note / Pitch, the Rave Kit one lane per drum voice and FX one lane per effect (`renderHitLanes`); the lane label of a drum voice or FX lane picks what the inspector edits and what Fill acts on. Patterns longer than 16 steps wrap onto further 16-step lines, so step N of every instrument stays in the same column. `stepRefs[i]` lists every cell and button of step i across lanes; `updatePlaybackIndicators` only touches the previous and the new playing step and also drives the score ruler and the bar/beat/step readout. Select-type parameters render as segmented buttons. Collapsed state lives in `localStorage`; references are kept in `socketState.instrumentElements`. Handles melodic/drum/FX step grid interactions, pitch selection popovers (styles defined in static CSS, no longer injected via JS), parameter sliders, instrument renaming, locking state, labeling card headers as `type by creator` using the per-instrument metadata, and recording of local-only mutations before socket acknowledgements. For the Rave Kit the param panel shows the kit sliders (Volume, Drive, Room) followed by the sliders of the voice picked in the score (`entry.activeDrum`, from `DRUM_VOICE_PARAM_DEFS`) under a heading with the voice name. Random fills drums with the weighted groove of `shared/drum-kit.js` (`randomDrumHits`) and only sends steps that change; parameter sends are throttled to one per 50 ms per instrument plus the final value. Each instrument card has a mute button that emits `instrument:mute` to the server; `syncInstrumentMuteState` keeps the button and `audioState.mutedInstruments` in sync with incoming `instrument:update` events. Provides helpers for updating playback indicators, ensuring card existence (`ensureInstrumentCard`), rendering the empty state and the score's instrument count, and scrolling into view.

#### `public/src/ui/lfo-card.js`
Renders the LFO cards in the modulation column (waveform preview canvas, waveform/shape/steps/jitter/smooth/rate/depth/offset/phase controls, targets) and handles the "Map" flow, in which clicking a parameter in the inspector assigns it to the LFO (`lfo-mapped` marks mapped parameters). LFOs have no name of their own, so cards are numbered in list order.

#### `public/src/ui/debug-overlay.js`
`showDebugOverlay()` draws a small fixed readout, refreshed every half second, for diagnosing playback on phones: AudioContext state, sample rate and latencies; the audio clock against the wall clock (`audio/wall` well under 1.000 means the audio thread cannot keep up); clock offset and round trip; the scheduler's look-ahead, largest tick gap and smallest lead; late and dropped steps; the main thread's largest lag; live and started sources (it counts `AudioScheduledSourceNode` starts and ends); page visibility, wake lock and DOM size. Loaded only with `?debug=1`.

#### `public/src/shared/timeline.js` and `public/src/shared/clock-sync.js`
Pure modules shared by the server and the browser (`public/src/shared/package.json` marks them as ES modules for Node). `timeline.js` models the transport as tempo segments (`stepTime`, `stepPositionAt`, `startTransport`, `stopTransport`, `changeTempo`, `collectDueSteps`, `normalizeTransport`); `clock-sync.js` holds `computeClockSample`, `createOffsetEstimator`, and `createRollingMedian`. Covered by `npm test` (`test/*.test.mjs`, including a simulated tempo-slider drag across clients with different latencies).

#### `public/src/shared/slurs.js`
Pure layout helper for the score (lives in `shared/` so `node --test` can load it). `computeSlurs(steps, count)` turns TB-303 slide flags into slurs: consecutive sliding notes share one arc from the first note to the note the last slide lands on; a slide on the last step is open at the pattern end and reappears, open, before step 1; a slide flag on a silent step becomes a faint dashed arc of its own. `ui/instrument-card.js` splits the slurs over the 16-step lines (`drawSlurs`, open at a line break) and redraws them whenever a note or slide is toggled. Covered by `test/slurs.test.mjs`.

#### `public/src/shared/drum-kit.js`
The Rave Kit definition shared by server and browser: `DRUM_VOICES` (kick, snare, clap, rim, hat, openhat, ride, tomlow, tommid, tomhigh, cowbell, shaker, crash), a flat 0..1 parameter schema `DRUM_PARAMS` with defaults, `DRUM_KIT_PARAM_KEYS` / `DRUM_VOICE_PARAM_KEYS` for the UI, `normalizeDrumParams` (complete, clamped set; a kit saved before a voice existed picks up its defaults), `applyDrumParamUpdates` (validated in-place update), `createDrumLayers`, and `randomDrumHits(stepIndex, rng)`, the per-step groove behind the kit's Random button (four on the floor, backbeat claps, offbeat open hats, 16th hats, ride, shaker on the in-between sixteenths, the odd rim, snare or cowbell, toms on the bar's last sixteenths, sometimes a crash on step 1). The server loads it with a dynamic `import()` before listening. Covered by `test/drum-kit.test.mjs`.

#### `public/src/shared/acid-line.js`
Random TB-303 lines: `randomAcidLine(count, rng)` picks a root in octave 2 and one of five acid scales (minor pentatonic, natural minor, Phrygian, Dorian, harmonic minor), weights the root, its octave and the fifth, rolls accents and slides only on notes that play, and never returns a pattern without a note (an all-rest roll plays the root on step 1). Covered by `test/acid-line.test.mjs`.

#### `public/src/shared/rumble.js`
The Rumble definition shared by server and browser: the 0..1 parameter schema `RUMBLE_PARAMS`, `normalizeRumbleParams` / `applyRumbleParamUpdates`, `RUMBLE_DEFAULT_PITCH` (A1, the Rave Kit kick's default fundamental), `rumblePitch` (a pitch class as a note between E1 and D#2), `dominantPitchClass` (most common playing pitch class of some lines) and `randomRumbleLine(count, { rootClass, kicks }, rng)`: hits on the kick lane (four on the floor without one) plus the odd off-kick eighth, all on one root. The Random button passes the first Rave Kit's kick lane and the acid basslines' dominant note. The server loads it with a dynamic `import()` before listening. Covered by `test/rumble.test.mjs`.

#### `public/src/shared/rave-stab.js`
The Rave Stab definition shared by server and browser: the 0..1 slider schema `STAB_PARAMS`, the chord shapes `STAB_CHORDS` (Minor, Min7, Min9, Fifth; default Min7) with `chordIntervals`, `normalizeStabParams` / `applyStabParamUpdates` (which also validate the chord), `STAB_DEFAULT_PITCH` (A3), `stabPitch` (a pitch class as a chord root between G3 and F#4) and `randomStabLine(count, { rootClass }, rng)`: one of four rave rhythms (offbeat, tresillo, push, answer) with the odd hit dropped or added, the key on the first half bar and bVII, bVI or iv as possible roots of later half bars. The Random button passes the acid basslines' dominant note as the key. Covered by `test/rave-stab.test.mjs`.

#### `public/src/shared/fx.js`
The FX definition shared by server and browser: the lanes `FX_VOICES` (riser, downlifter, impact, zap; `FX_DEFAULT_LANE` is impact), the 0..1 parameter schema `FX_PARAMS`, `fxLengthSteps` (Length as 4, 8, 16, 32 or 64 steps; default 8), `normalizeFxParams` / `applyFxParamUpdates`, `createFxLayers`, and `randomFxLine(count, { length }, rng)`: an impact on step 1, a riser starting `fxLengthSteps(length)` steps before the end when it fits inside the pattern (so it lands on the loop point), a downlifter with the impact half the time, and up to two zaps on off-beat eighths. In the card, the Rave Kit and FX share the lane grid (`LANE_VOICES`, `renderDrumStepGrid`), Fill and Random. Covered by `test/fx.test.mjs`.

#### `public/src/shared/hoover.js`
The Hoover definition shared by server and browser: the 0..1 parameter schema `HOOVER_PARAMS`, `normalizeHooverParams` / `applyHooverParamUpdates`, `HOOVER_DEFAULT_PITCH` (A3), `hooverPitch` (a key's root in octave 3) and `randomHooverLine(count, { rootClass }, rng)`: one of four sparse riffs (hold, call, riff, answer); every bar starts on the root, later notes move to the octave, fifth, minor third, flat seventh, fourth or fifth below, and rests keep the root. The Random button passes the acid basslines' dominant note as the key. Covered by `test/hoover.test.mjs`.

#### `public/src/shared/room-file.js`
The room file format shared by server and browser (`format: "seqroom-room"`, `version: 1`, saved as `<slug>-<date>.seqroom.json`). `createRoomFile({ name, bpm, instruments, lfos })` writes the room's music: each instrument's type, name, creator, mute, step count, parameters and only the steps in play (Rave Kit and FX steps as lists of voice ids, note steps as `{ pitch }` plus only what differs from an empty step), and the LFOs with targets naming instruments by position instead of id. `readRoomFile(textOrJson)` checks the structure and loosely bounds every value (at most 256 instruments, 128 steps each, 32 LFOs; valid pitches only), answers `not-a-room-file` or `room-file-too-new`, and returns steps in the shape the server's step updates take; types, parameter keys and ranges are left to the server. Covered by `test/room-file.test.mjs`.

#### `public/src/ui/room-file.js`
The Save, Load and Open saved room buttons. `saveRoomToFile` downloads the room from the browser's own state (so it still works after the server lost the room). `setupRoomFileControls` opens the file picker for Load (into the current room, after a confirm, via `room:import`) or Open saved room (a new room named after the saved one, via `connectToRoom` with `roomFile`). Files are checked with `readRoomFile` first, then minified and gzipped with `CompressionStream` (plain text where it is missing) and refused above 90 KB so a socket message never exceeds the server's cap. `roomFileErrorMessage` turns the file errors into the alerts.

#### `public/src/ui/tempo-controls.js`
Owns the tempo ruler (range input), the numeric tempo field and the -/+ steppers (1 BPM, 10 with Shift). Exposes `tempoInputState`, `updateTempoDisplay`, `commitTempo`, and `setupTempoControls`. Clamps BPM to the allowed range and, in a room, sends `transport:set-tempo` at most every 100 ms while dragging plus the final value on release; the local transport is only updated by the server's `transport:update` echo. Server echoes do not move the slider while it is being dragged (or for 600 ms after release) or the number field while it is being edited.

### Socket Layer
#### `public/src/socket/main.js`
Creates the Socket.IO client, registers all event listeners, and exports control wiring helpers. `setupSocketEvents` hydrates state on `state:init`, updates transport and tempo, handles instrument add/update/remove/order events (normalizing instruments and triggering UI renders), manages lock notifications, applies server-sent step toggles for legacy clients, updates connection counts, and drives clock sync via `time:ping`/`time:sync`. `setupRoomControls`, `setupTransportControls`, and `setupRecordingControls` bind DOM elements to socket commands; room controls now prompt for a room name when the create button is pressed, let any connected member request invite tokens, and parse pasted invite links/tokens. `connectToRoom` orchestrates room creation (`room:create` with `{ roomName }`) and invite joins (`joinWithInvite`), handles request timeouts, UI resets, slug display, and landing/sequencer transitions while tagging payloads with the local display name. With `roomFile`, `connectToRoom` opens a saved room in the new room instead. When a dropped connection cannot rejoin its room, the client offers to save what was in it to a file before returning to the start page. `attemptAutoJoinFromInvite()` watches the current URL for `/r/:slug?inv=` links and automatically calls `connectToRoom`. `handleRoomError` and `leaveRoom` centralize room teardown. The module also caches pending creator labels (for newly added instruments and for the default instrument after room creation) so the UI can show `type by display-name` immediately, then clears the cache when the server echoes the authoritative payload. Finally, it exposes helper functions to resolve instrument ids by name, ensure the audio context is ready before sending commands, and keep suppression timers for optimistic UI updates.

### Supporting Assets
#### `package.json`
Defines the `npm start` script (`node server.js`) and runtime dependencies (`express`, `socket.io`, `rate-limiter-flexible`).

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
4. **Instrument editing**
   - `ui/instrument-card.js` handles step toggles, parameter changes, renames, and step count adjustments. Events emit through Socket.IO (`instrument:step`, `instrument:param`, `instrument:rename`, `instrument:set-length`, etc.).
   - `server.js` normalizes payloads, updates room state, and rebroadcasts `instrument:update`. When clients add instruments they include their current display name and socket id so the server can stamp `creatorDisplayName` / `creatorUserId`. Clients normalize incoming instruments and refresh cards.
5. **Clock synchronization**
   - `server.js` emits `time:ping` to each client at a fixed interval.
   - `socket/main.js` responds with `time:pong` timestamps. When `time:sync` arrives, `audio/main.js.applyClockCorrection` smooths the offset/latency in `socketState`, and `ui/main.js.updateSyncStatus` displays the current measurements.
6. **Recording pipeline**
   - `socket/main.js.setupRecordingControls` binds the record button to `audio/recording.js.toggleRecording`.
   - `audio/recording.js` loads `recording-processor.js`, connects it to `audioState.masterOutput`, buffers Float32 chunks via `handleRecordingMessage`, and updates `recordingStatusEl`.
   - When stopped, the module merges chunks, encodes a WAV, and triggers a download. UI state is reset via `updateRecordButton` and `clearRecordingData`.

This documentation reflects the current project structure and module responsibilities; update it whenever files are added, renamed, or repurposed.
