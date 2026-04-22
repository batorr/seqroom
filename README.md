# Seqroom

Seqroom is a browser-based, collaborative 16-step sequencer. A Node/Express server serves static assets, relays control data with Socket.IO, and sends periodic clock-sync samples. Each browser builds its own instrument list, runs a Web Audio scheduler, and can record the summed mix to WAV through an AudioWorklet.

## Requirements
- Node.js 18+ and npm 8+
- Modern Chromium, Firefox, or Edge browser with Web Audio + AudioWorklet support
- Local network connectivity if you want multiple devices in the same room

## Install and Run
```bash
npm install
npm start
```
The server prints both `http://localhost:3000` and any discoverable LAN addresses. Open the URL in a browser; other devices on the same network can use the LAN address.

## Features
- Real-time collaboration through Socket.IO rooms
- TB-303, TR-808, Poly Synth, and Sampler instruments (sampler exposes six slots with per-slot gain/pan/pitch/start/end/reverse controls)
- Step counts per instrument from 1 to 128 (default 16) and per-step drum/sampler layers
- Tempo range 30–300 BPM with numeric input and slider, plus transport controls shared by every client
- Sidebar overview, synth modal, and locking state to keep collaborators coordinated
- Local recording pipeline using `public/recording-processor.js`, downloading 32-bit float WAV files

## Room Flow
1. Launch the server and open the UI.
2. Enter a display name (optional), then click **Create Room**. A modal prompts for a room name (letters, numbers, spaces, and hyphens). The server converts it to a URL slug and opens the sequencer.
3. Share an invite link with collaborators: click the **Invite** button inside the room to generate a signed token link (`/r/<slug>?inv=<token>`). Send that link to anyone you want to invite.
4. Recipients open the invite link directly in their browser, or click **Join Room** on the landing page and paste the link/token. They immediately receive the full room state (tempo, transport phase, instruments, sampler slots).
5. Invite tokens expire after 1 hour. Rooms persist on the server for up to 1 hour after the last member leaves, then are cleaned up automatically.
6. Use **Leave Room** to return to the landing page.

## Working With The Sequencer
- **Adding instruments**: Select TB-303, TR-808, Poly Synth, or Sampler from the synth modal. Instrument cards appear in the order they were created; drag ordering is handled server-side when card reorder buttons are used.
- **Editing steps**: Melodic instruments expose per-step note buttons and pitch pickers, TR-808 shows five drum layers per column (kick, snare, hat, open hat, clap), and the sampler shows six slot toggles. Every edit emits a Socket.IO event so the server can broadcast the normalized pattern.
- **Parameters**: Each card exposes sliders (volume, filter, envelopes, drum levels) plus sampler slot editors for gain/pan/pitch/start/end/reverse. Changes sync immediately after the server validates them.
- **Tempo & transport**: Use the slider or numeric input to set BPM (30–300). Play/Stop toggles transport for everyone in the room. The sync banner displays clock offset and round-trip time after the ping/pong handshake stabilizes.
- **Sampler uploads**: Drag audio files (<= 5 MB, WAV/MP3) onto a sampler slot. The client base64-encodes the file, the server validates and rebroadcasts it, and every client decodes the buffer for playback.
- **Recording**: Click **REC** to instantiate the AudioWorklet and capture the mixed output. Recording stats show elapsed time and bytes recorded. Clicking the button again stops capture and downloads `seqroom_recording.wav`.

## Sync Testing
1. Run `npm start`.
2. Open the local URL in a desktop browser and create a room.
3. On the first browser, click **Invite** to generate a share link and copy it. Open that link on a second device (phone, tablet, or another computer) to join the same room.
4. Wait for the sync banner to show a finite offset and RTT (typically under 20 ms on a LAN), then toggle steps or change tempo on either device. Both browsers should stay phase-aligned because each schedules locally using the server clock.

## Notes
- Browsers require a user gesture before audio can start; click once anywhere in the document when prompted to unlock audio playback.
- The server never generates sound; every participant’s browser is responsible for synthesis, which means CPU usage scales with the number of instruments per client.
- Use this on trusted networks only. There is no user authentication or data persistence. Rate limiting is applied server-side to room creation, joins, instrument operations, and tempo changes.
- Recording requires AudioWorklet support. If the button is disabled, the browser does not expose `AudioWorkletNode`.
- See `SETUP_AND_RUN.md` for in-depth setup, troubleshooting, and architecture notes, and `MODULE_DOCUMENTATION.md` for module-level details.
