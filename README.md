# Seqroom

Seqroom is a lightweight collaborative 16-step sequencer prototype. Each browser keeps its own audio engine, while the server only relays control events via Socket.IO.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the development server:
   ```bash
   npm start
   ```
3. Open a browser at the printed URLs (e.g. `http://localhost:3000` or the local LAN address such as `http://192.168.x.x:3000`). The server logs every available IPv4 so phones on the same Wi-Fi can join quickly.
4. Use the landing page to create a new room or join an existing room code. Once you are in a room, the shared sequencer appears and begins playing in sync.

## Room Flow

- **Create Room** generates a short shareable code (e.g. `7GH42P`), shows it on the landing card, and connects you to a fresh sequencer session.
- **Join Room** prompts for an existing code and connects your browser to that session. The pattern, tempo, and transport phase load instantly, and audio starts playing as soon as the clock locks.
- The status bar displays the active room, clock offset/latency, and how many collaborators are connected. Use the Leave button to return to the lobby; you can rejoin later with the same code.

## Sync Testing

- Start the server with `npm start`, then open Seqroom in a desktop browser.
- Join from a second device (for example, a phone on the same Wi-Fi) using one of the LAN URLs printed in the terminal.
- Watch the sync banner in the UI; once it shows a small offset and RTT, both browsers are locked to the same musical phase.
- Toggle steps on either device—the shared pattern updates instantly while the metronomes stay phase-aligned thanks to the continuous clock correction.

## Notes

- Audio requires a user gesture in some browsers; tap or click once to unlock audio playback.
- Tempo changes are limited to 60–180 BPM to keep things musical.
- This is a prototype meant for LAN testing; add authentication or persistence before putting it on the public internet.
- The Web Audio transport follows a smoothed NTP-style sync: the server pings every two seconds, clients measure round-trip latency, and offsets are eased in to avoid audible jumps.
