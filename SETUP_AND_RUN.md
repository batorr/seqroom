# SeqRoom – Setup and Run Guide

This guide covers installation, execution, architecture, and troubleshooting for the SeqRoom prototype. All commands assume you are in the repository root; adjust paths if your checkout lives elsewhere.

## Prerequisites
- Node.js 18 or newer
- npm 8 or newer
- Modern Chromium, Firefox, or Edge browser with Web Audio + AudioWorklet support
- Local network connectivity (for multi-device sessions)

## Installation
```bash
npm install
```

If dependencies ever become corrupted:
```bash
rm -rf node_modules package-lock.json && npm install
```

## Running the Server
```bash
npm start
```

Sample output:
```
Seqroom server running on http://localhost:3000
Seqroom available on your network:
  http://192.168.x.x:3000
```
Open the local URL in a browser. LAN addresses are printed for every external IPv4 interface so phones and tablets on the same Wi-Fi can join.

## Accessing the App
- **Local machine**: `http://localhost:3000`
- **Other devices on the LAN**: use the `http://192.168.x.x:3000` (or similar) URL printed in the terminal.
- The UI loads `/socket.io/socket.io.js` automatically; no additional build step is required.

## Architecture Overview
- **Server (`server.js`)**: Express serves `public/`, Socket.IO manages rooms, instruments, transport, clock sync, and sampler uploads. All room state stays in memory.
- **Client entry (`public/index.html`, `public/src/app.js`)**: HTML provides the landing + sequencer layout; `app.js` wires tempo/transport controls, synth modal, room controls, recording, and socket listeners.
- **Client modules**:
  - `public/src/constants/` – tempo bounds, room-id regex, instrument metadata, sampler limits.
  - `public/src/utils/` – value clamping, formatting, room-id helpers, sampler slot creation, note/recording helpers.
  - `public/src/state/` – shared transport/instrument/UI state plus AudioContext/recorder/socket metadata.
  - `public/src/ui/` – DOM rendering (main view, instrument cards, sidebar, tempo controls).
  - `public/src/audio/` – AudioContext bootstrap, scheduler, recording controller, instrument renderers, sampler decoder.
  - `public/src/socket/main.js` – Socket.IO client, room lifecycle, transport commands, instrument updates, time sync.
  - `public/recording-processor.js` – AudioWorklet used by `audio/recording.js`.

Refer to `MODULE_DOCUMENTATION.md` for detailed module descriptions.

## Operating the Application
### Create or Join a Room
1. Visit the app. Optionally enter a display name.
2. Click **Create Room**. A modal prompts for a room name (letters, numbers, spaces, and hyphens are allowed). The server converts it to a URL slug and opens the sequencer.
3. Inside the room, click **Invite** to generate a signed invite link (`/r/<slug>?inv=<token>`). Share that link with collaborators.
4. Collaborators open the invite link directly, or click **Join Room** on the landing page and paste the link or token. They immediately receive the full transport/instrument state.
5. Invite tokens expire after 1 hour. Rooms are kept alive for up to 1 hour after the last member leaves, then automatically cleaned up.
6. Use **Leave Room** to return to the landing page.

### Instruments and Steps
- Open the synth modal to add TB-303, TR-808, Poly Synth, or Sampler instruments.
- Each instrument card contains a template-specific step grid (melodic notes, TR-808 drum layers, sampler slot toggles) plus parameter controls.
- Step counts can be set between 1 and 128 per instrument.
- Locks prevent conflicting edits; the sidebar shows who holds each instrument if the server reports a lock owner.

### Tempo and Transport
- Tempo slider and numeric input both clamp to 30–300 BPM. Changes emit `transport:set-tempo` and reschedule playback on every client.
- Play/Stop toggles the shared transport. The sync banner shows clock offset and round-trip latency once `time:ping`/`time:sync` have run.

### Sampler Uploads
- Each sampler slot accepts WAV or MP3 data up to 5 MB. Drag files directly onto the slot or use the upload button.
- Slots expose gain, pan, pitch, start/end, and reverse controls. These values sync to the server and every client decodes the audio buffer locally.

### Recording
- The **REC** button loads `public/recording-processor.js`, connects it to the master gain, and streams Float32 chunks back to `audio/recording.js`.
- While recording, the status label shows elapsed time and bytes captured. Stopping recording disconnects the node and downloads `seqroom_recording.wav`.
- Recording is only available in browsers that implement `AudioWorkletNode`.

## Troubleshooting
| Symptom | Resolution |
| --- | --- |
| `Cannot GET /` | Run `npm start` from the repo root and ensure it stays open. |
| UI loads but no sound | Click anywhere to unlock audio; confirm the browser supports Web Audio. |
| Recording button disabled | Browser does not expose `AudioWorkletNode`. Use a supported browser (Chrome, Edge, Firefox). |
| Room join fails | Paste the full invite link or token into the join prompt. Tokens expire after 1 hour; request a fresh invite from someone already in the room. |
| Sampler upload rejected | File exceeds 5 MB or uses a mime type outside `audio/wav`, `audio/x-wav`, `audio/mpeg`, `audio/mp3`. Trim or convert the file. |
| Port 3000 already in use | Stop other processes or free the port (`lsof -i :3000` on macOS/Linux, `netstat -ano | findstr :3000` on Windows). |
| Dependencies missing | Reinstall with `rm -rf node_modules package-lock.json && npm install`. |

## Verification Checklist
1. `npm install` completes without errors.
2. `npm start` prints local and network URLs.
3. The landing page loads and shows Create/Join buttons.
4. Creating a room reveals the sequencer, transport controls, and sidebar toggle.
5. Adding instruments shows their cards; step toggles immediately update the UI.
6. Tempo changes update the numeric field and slider and broadcast to all clients.
7. Two browsers in the same room stay in sync (offset/RTT reported in the banner).
8. Recording downloads a WAV and resets the UI state after stopping.

## Important Notes
- **Audio unlock**: Most browsers require a user gesture before starting the AudioContext. `app.js` calls `primeAudioUnlock`, but you still need to click once when prompted.
- **Security**: There is no user authentication or data persistence. Rate limiting is active server-side (room creation, joins, instrument edits, and tempo changes). Deploy only on trusted networks.
- **Resource usage**: Every client renders all instruments it can see. Keep card counts reasonable on low-power devices.
- **Single server instance**: All connected rooms share the same Node process; stopping the server clears every room.

## Useful Commands
```bash
# Start the server
npm start

# Show top-level dependencies
npm ls --depth=0

# Check runtime versions
node --version
npm --version

# Tail server output while logging to a file
npm start | tee server.log
```

## Final Checklist Before Launch
- [ ] You are inside the repository root
- [ ] `npm install` has been run at least once
- [ ] Port 3000 is free
- [ ] Browser supports Web Audio + AudioWorklet
- [ ] Devices that should collaborate are on the same LAN

Start the server with `npm start`, create a room, and begin sequencing.
