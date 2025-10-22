# SeqRoom - Setup and Run Guide

## 🚀 Quick Start

### Prerequisites
- **Node.js**: v18.0.0 or higher (you have v22.16.0 ✅)
- **npm**: v8.0.0 or higher (you have v10.9.2 ✅)
- **Modern Browser**: Chrome, Firefox, or Edge with Web Audio API support

### Platform Compatibility
✅ **Windows 11 with WSL** (your environment)
✅ **Windows Native**
✅ **macOS**
✅ **Linux**

**Note**: All dependencies (Express, Socket.IO) are pure JavaScript - fully cross-platform compatible!

---

## 📦 Installation

### Option 1: Fresh Install (Recommended if node_modules has issues)

```bash
# Navigate to project directory
cd /mnt/c/Dev/Projects/secrum

# Remove existing node_modules (if any issues)
rm -rf node_modules package-lock.json

# Install dependencies
npm install
```

### Option 2: Use Existing Installation

```bash
# Navigate to project directory
cd /mnt/c/Dev/Projects/secrum

# Dependencies already installed ✅
# express@4.21.2
# socket.io@4.8.1
```

---

## 🎮 Running the Application

### Start the Server

```bash
# From WSL
cd /mnt/c/Dev/Projects/secrum
npm start
```

**OR from Windows Command Prompt/PowerShell:**

```cmd
cd C:\Dev\Projects\secrum
npm start
```

### Expected Output

```
Seqroom server running on:
  Local:      http://localhost:3000
  Network:    http://192.168.x.x:3000
  [Additional IPv4 addresses...]
```

### Access the Application

**On the same machine:**
- Open browser: `http://localhost:3000`

**From other devices on the same network (phones, tablets, other computers):**
- Open browser: `http://192.168.x.x:3000` (use the IP shown in terminal)

---

## 🏗️ Architecture Overview

### Project Structure

```
secrum/
├── server.js                      # Express + Socket.IO server (1,300 lines)
├── package.json                   # Dependencies
├── public/                        # Static files served by Express
│   ├── index.html                 # Main HTML (ES module entry)
│   ├── recording-processor.js     # AudioWorklet for recording
│   ├── client.js                  # OLD monolithic code (backup)
│   └── src/                       # Modular application source
│       ├── app.js                 # Entry point (auto-initializes)
│       ├── constants/             # Configuration
│       │   ├── audio.js
│       │   ├── instruments.js
│       │   └── ui.js
│       ├── utils/                 # Utility functions
│       │   ├── helpers.js
│       │   └── audio.js
│       ├── state/                 # State management
│       │   ├── main.js
│       │   └── audio.js
│       ├── ui/                    # User interface
│       │   ├── main.js
│       │   ├── instrument-card.js
│       │   └── tempo-controls.js
│       ├── audio/                 # Audio engine
│       │   ├── main.js
│       │   ├── scheduler.js
│       │   ├── recording.js
│       │   └── instruments/
│       │       ├── tb303.js
│       │       ├── tr808.js
│       │       ├── poly-synth.js
│       │       └── sampler.js
│       └── socket/                # WebSocket layer
│           └── main.js
└── node_modules/                  # Dependencies
```

### Key Files Modified

1. ✅ **public/index.html**
   - Changed: `<script src="client.js"></script>`
   - To: `<script type="module" src="src/app.js"></script>`
   - Enables ES6 module support

2. ✅ **public/recording-processor.js**
   - Added comment explaining `sampleRate` global variable
   - No functional changes needed

3. ✅ **public/src/**
   - Complete modular refactoring (19 files, 3,452 lines)
   - All import paths corrected
   - Critical async timing bugs fixed

---

## 🔧 How It Works

### Server Side (Node.js)

**server.js** runs an Express HTTP server with Socket.IO WebSocket server:

1. **Serves static files** from `public/` directory
2. **Manages rooms** - creates/joins/leaves
3. **Broadcasts events** - syncs all connected clients
4. **Clock synchronization** - ping/pong protocol every 2 seconds
5. **State management** - keeps track of instruments, tempo, transport

### Client Side (Browser)

**public/src/app.js** initializes the application:

1. **Loads as ES6 module** - enables import/export
2. **Auto-initializes** - runs `initialize()` on load
3. **Sets up UI** - event listeners, DOM references
4. **Connects to server** - Socket.IO client
5. **Starts audio engine** - Web Audio API (after user interaction)

### Data Flow

```
Browser 1                    Server                    Browser 2
   │                           │                           │
   ├─ User clicks "Play" ─────►│                           │
   │                           ├─ Broadcast ──────────────►│
   │                           │  'transport:update'        │
   │◄─ Receive event ──────────┤                           │
   │  'transport:update'        │                           │
   │                           │                           ├─ Receive event
   ├─ syncAudioScheduler() ────┤                           │  'transport:update'
   │                           │                           │
   │  [Audio plays in sync via clock synchronization]      │
   │                           │                           ├─ syncAudioScheduler()
```

---

## 🎵 Using the Application

### Creating a Room

1. Open `http://localhost:3000`
2. Click **"Create Room"**
3. A room code appears (e.g., `K7H2P`)
4. Share this code with collaborators

### Joining a Room

1. Open `http://localhost:3000` (on any device)
2. Click **"Join Room"**
3. Enter the room code
4. You're connected!

### Adding Instruments

1. Click **"Add Synth"**
2. Choose instrument type:
   - **Acid Bass** (TB-303) - Resonant bass synthesizer
   - **808 Drums** (TR-808) - Kick, snare, hat, clap
   - **Poly Synth** - Polyphonic synthesizer
   - **Sampler** - Load your own audio files (6 slots)

### Sequencing

1. **Click step buttons** to toggle notes on/off
2. **Adjust parameters** - volume, filter, envelope, etc.
3. **Change step count** - 1 to 128 steps per instrument
4. **Adjust tempo** - 30 to 300 BPM
5. **Press Play** - all connected clients play in sync!

### Recording

1. Click **"Record"** button
2. Music is recorded in real-time
3. Click **"Stop Recording"**
4. WAV file downloads automatically

---

## 🐛 Troubleshooting

### Issue: "Cannot GET /"
**Solution**: Server not running. Run `npm start`

### Issue: "No audio playing"
**Solution**: Click anywhere on the page to unlock audio (browser requirement)

### Issue: "Connection refused"
**Solution**: Check if port 3000 is available
```bash
# Check if port is in use
netstat -ano | findstr :3000    # Windows
lsof -i :3000                   # macOS/Linux/WSL
```

### Issue: "Module not found"
**Solution**:
```bash
cd /mnt/c/Dev/Projects/secrum
rm -rf node_modules package-lock.json
npm install
```

### Issue: "Clock not syncing"
**Solution**:
- Check network connectivity
- Refresh browser
- Check browser console for errors (F12)

### Issue: WSL/Windows Path Issues
**Solution**:
```bash
# From WSL, use /mnt/c/... paths
cd /mnt/c/Dev/Projects/secrum

# From Windows, use C:\... paths
cd C:\Dev\Projects\secrum
```

---

## 🔍 Verification Checklist

✅ **Dependencies Installed**
```bash
npm list --depth=0
# Should show:
# express@4.21.2
# socket.io@4.8.1
```

✅ **Server Starts Without Errors**
```bash
npm start
# Should show URLs without error messages
```

✅ **Browser Opens Successfully**
- Navigate to `http://localhost:3000`
- Should see "SEQROOM" header and Create/Join buttons

✅ **Room Creation Works**
- Click "Create Room"
- Room code appears
- Sequencer interface shows

✅ **Audio Unlocks**
- Click anywhere on the page
- Transport controls should enable
- Click "Play" - should hear metronome or added instruments

✅ **Multiple Clients Sync**
- Open two browser tabs
- Both join same room code
- Changes in one appear in the other
- Audio plays in sync

---

## 🚨 Important Notes

### Audio Worklet
- **recording-processor.js** must be in `public/` directory
- Accessed by browser as `/recording-processor.js`
- Required for recording feature

### ES6 Modules
- Modern browsers required (Chrome 61+, Firefox 60+, Edge 79+)
- `type="module"` in script tag enables imports
- Modules load asynchronously

### CORS and Security
- Server runs on localhost by default
- For production, add CORS headers and authentication
- Do NOT expose publicly without security measures

### Performance
- Each client runs its own audio engine (CPU intensive)
- Server only relays control events (lightweight)
- Network latency affects sync quality (LAN recommended)

---

## 📊 Performance Monitoring

### Server Console
```
Seqroom server running on:
  Local:      http://localhost:3000
  Network:    http://192.168.1.100:3000

Room K7H2P created
Client abc123 joined room K7H2P (2 connections)
Clock ping sent to abc123
Clock pong received: offset=5ms, RTT=12ms
```

### Browser Console (F12)
```javascript
// Check state
console.log(state)
// Check audio state
console.log(audioState)
// Check sync status
console.log(socketState.clockOffsetMs)
```

---

## 🎯 Development vs Production

### Current Setup (Development)
- ✅ Auto-reload not enabled (manual refresh needed)
- ✅ Source maps available (ES6 modules)
- ✅ No minification (readable code)
- ✅ No authentication (local network only)

### For Production Use
Consider adding:
- **Process manager** (PM2, forever)
- **Authentication** (passport.js, JWT)
- **HTTPS** (Let's Encrypt)
- **Database** (persist rooms/patterns)
- **Rate limiting** (prevent abuse)
- **Minification** (reduce bandwidth)

---

## 🎉 Success Indicators

You'll know everything is working when:

1. ✅ Server starts and prints URLs
2. ✅ Browser loads landing page
3. ✅ Room creation shows sequencer
4. ✅ Clicking step buttons adds highlights
5. ✅ Pressing Play makes sound
6. ✅ Two browsers stay in sync
7. ✅ Clock sync shows < 20ms offset
8. ✅ Recording downloads WAV file

---

## 🆘 Getting Help

### Check Files
- `MODULE_DOCUMENTATION.md` - Complete code documentation
- `README.md` - Project overview
- Server logs in terminal
- Browser console (F12 → Console tab)

### Common Commands
```bash
# Restart server (Ctrl+C to stop first)
npm start

# Reinstall dependencies
rm -rf node_modules package-lock.json && npm install

# Check Node/npm versions
node --version
npm --version

# View server logs
npm start | tee server.log
```

---

## ✅ Final Checklist Before Running

- [ ] Node.js v18+ installed
- [ ] npm dependencies installed
- [ ] In correct directory: `/mnt/c/Dev/Projects/secrum`
- [ ] Port 3000 available
- [ ] Browser supports Web Audio API
- [ ] For multi-device testing: devices on same network

**All ready? Run**: `npm start` and enjoy! 🎵
