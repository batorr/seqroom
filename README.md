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
- Acid Bass (TB-303 style, with accent, slide, drive, delay and reverb), Rave Kit (synthesised drums voiced for acid techno: kick, snare, clap, rim, closed/open hat, ride, low/mid/high tom, cowbell, shaker, crash), Rumble (a dark, driven sub tail that swells between the kicks, tuned per step), Rave Stab (filtered chord stabs: every step plays a whole minor chord), Hoover (a thick, swooping mono lead that glides between notes), FX (risers, downlifters, impacts and laser zaps, one lane each), and Poly Synth; everything is synthesised in the browser
- A mix bus with glue compression, a limiter, a tempo-synced delay and a room reverb
- Step counts per instrument from 1 to 128 (default 16) and per-step drum and FX lanes
- Tempo range 30–300 BPM with numeric input and slider, plus transport controls shared by every client
- A shared score: every instrument is a row of lanes on the same 16-column grid, with the selected instrument's sound settings below it
- Instrument locking to keep collaborators coordinated
- Saving a room to a file and opening it again later, in a new room or the one you are in
- Local recording pipeline using `public/recording-processor.js`, downloading 32-bit float WAV files

## Room Flow
1. Launch the server and open the UI.
2. Enter a display name (optional), then click **Create Room**. A modal prompts for a room name (letters, numbers, spaces, and hyphens). The server converts it to a URL slug and opens the sequencer.
3. Share an invite link with collaborators: click the **Invite** button inside the room to generate a signed token link (`/r/<slug>?inv=<token>`). Send that link to anyone you want to invite.
4. Recipients open the invite link directly in their browser, or click **Join Room** on the landing page and paste the link/token. They immediately receive the full room state (tempo, transport phase, instruments).
5. Invite tokens expire after 1 hour. Rooms persist on the server for 15 minutes after the last member leaves (so people can reconnect), then are cleaned up automatically.
6. Use **Leave Room** to return to the landing page.
7. To carry on later, click **Save** in the room: it downloads the room (tempo, instruments with their steps and sounds, LFOs) as a `.seqroom.json` file. **Open saved room** on the landing page opens that file in a new room, and **Load** inside a room replaces that room's music with it, for everyone in the room. If the connection drops and the room is gone from the server, the browser offers to save it before returning to the landing page.

## Working With The Sequencer
- **Adding instruments**: Select Acid Bass, Rave Kit, Rumble, Rave Stab, Hoover, FX or Poly Synth from the add-instrument dialog. Instrument cards appear in the order they were created; drag ordering is handled server-side when card reorder buttons are used.
- **Editing steps**: Melodic instruments expose per-step note buttons and pitch pickers, the Rave Kit shows one lane per drum voice (kick, snare, clap, rim, closed hat, open hat, ride, low/mid/high tom, cowbell, shaker, crash) and FX one per effect (riser, downlifter, impact, zap). Every edit emits a Socket.IO event so the server can broadcast the normalized pattern.
- **Parameters**: Each card exposes sliders (volume, filter, envelopes, drum and voice levels). Changes sync immediately after the server validates them.
- **Tempo & transport**: Use the slider or numeric input to set BPM (30–300). Play/Stop toggles transport for everyone in the room. The sync banner displays clock offset and round-trip time after the ping/pong handshake stabilizes.
- **Recording**: Click **REC** to instantiate the AudioWorklet and capture the mixed output. Recording stats show elapsed time and bytes recorded. Clicking the button again stops capture and downloads `seqroom_recording.wav`.

## Sync Testing
1. Run `npm start`.
2. Open the local URL in a desktop browser and create a room.
3. On the first browser, click **Invite** to generate a share link and copy it. Open that link on a second device (phone, tablet, or another computer) to join the same room.
4. Wait for the sync banner to show a finite offset and RTT (typically under 20 ms on a LAN), then toggle steps or change tempo on either device. Both browsers should stay phase-aligned because each schedules locally using the server clock.

## Notes
- Browsers require a user gesture before audio can start; click once anywhere in the document when prompted to unlock audio playback.
- The server never generates sound; every participant’s browser is responsible for synthesis, which means CPU usage scales with the number of instruments per client.
- There is no user authentication, and rooms live only in the server's memory; save a room to a file to keep it. Rate limiting is applied server-side to room creation, joins, instrument operations, and tempo changes; room creation and joins are limited per visitor IP, taken from the proxy headers on Render (Cloudflare's `CF-Connecting-IP` only when the request really came through Cloudflare). One server holds at most 500 rooms (rooms nobody is in make way first) and 24 instruments per room; `SEQROOM_MAX_ROOMS` and `SEQROOM_MAX_INSTRUMENTS_PER_ROOM` override these, and `TRUST_PROXY=1` trusts proxy headers on hosts other than Render.
- Recording requires AudioWorklet support. If the button is disabled, the browser does not expose `AudioWorkletNode`.
- See `SETUP_AND_RUN.md` for in-depth setup, troubleshooting, and architecture notes, and `MODULE_DOCUMENTATION.md` for module-level details.
