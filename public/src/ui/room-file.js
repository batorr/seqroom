// Room files: saving the room to a file, and opening a saved room again,
// either in a new room (start page) or in the room you are in (which
// replaces its music for everyone there).

import { state } from '../state/main.js';
import { getLFOs } from '../audio/lfo.js';
import {
    createRoomFile,
    readRoomFile,
    ROOM_FILE_EXTENSION,
    ROOM_FILE_MAX_BYTES,
} from '../shared/room-file.js';

// The server drops socket messages over 100 KB (SOCKET_MAX_MESSAGE_BYTES in
// server.js), which would cut the connection; stay well under it.
const MAX_SEND_BYTES = 90 * 1024;

const ROOM_NAME_MAX_LENGTH = 64;

export function roomFileErrorMessage(errorCode, { limit } = {}) {
    switch (errorCode) {
        case 'not-a-room-file':
            return 'That file is not a saved seqroom room.';
        case 'room-file-too-new':
            return 'That room was saved by a newer version of seqroom. Reload the page and try again.';
        case 'room-file-too-large':
            return 'That file is too large to be a saved room.';
        case 'instrument-limit':
            return `That room has more instruments than a room here can hold${limit ? ` (${limit})` : ''}.`;
        default:
            return null;
    }
}

// Downloads the room as it is now: tempo, every instrument with its steps
// and sound settings, and the LFOs.
export function saveRoomToFile() {
    const file = createRoomFile({
        name: state.roomSlug || '',
        bpm: state.transport.bpm,
        instruments: state.instrumentOrder.map((id) => state.instruments.get(id)).filter(Boolean),
        lfos: Array.from(getLFOs().values()),
    });
    downloadText(roomFileName(file.name), `${JSON.stringify(file, null, 2)}\n`);
}

export function setupRoomFileControls({ socket, connectToRoom }) {
    const fileInput = document.getElementById('room-file-input');
    const saveBtn = document.getElementById('save-room');
    const loadBtn = document.getElementById('load-room');
    const openBtn = document.getElementById('open-room-file');
    if (!fileInput) {
        return;
    }

    // Which button opened the file picker.
    let destination = null;
    const pickFile = (target) => {
        destination = target;
        fileInput.value = '';
        fileInput.click();
    };

    saveBtn?.addEventListener('click', () => {
        if (state.isInRoom) {
            saveRoomToFile();
        }
    });
    loadBtn?.addEventListener('click', () => pickFile('this-room'));
    openBtn?.addEventListener('click', () => pickFile('new-room'));

    fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        const target = destination;
        destination = null;
        fileInput.value = '';
        if (!file) {
            return;
        }
        const action = target === 'this-room'
            ? loadIntoThisRoom(file, socket)
            : openInNewRoom(file, connectToRoom);
        action.catch((error) => {
            console.error('Failed to open the room file:', error);
            window.alert('Could not open that file.');
        });
    });
}

async function openInNewRoom(file, connectToRoom) {
    const result = await prepareFile(file);
    if (!result.ok) {
        window.alert(roomFileErrorMessage(result.error) || 'Could not open that file.');
        return;
    }
    connectToRoom({
        mode: 'create',
        roomName: roomNameFor(result.room.name, file.name),
        roomFile: result.bytes,
    });
}

async function loadIntoThisRoom(file, socket) {
    if (!state.isInRoom) {
        return;
    }
    const result = await prepareFile(file);
    if (!result.ok) {
        window.alert(roomFileErrorMessage(result.error) || 'Could not open that file.');
        return;
    }
    const confirmed = window.confirm(
        `Load “${file.name}” into this room?\n\n`
        + 'It replaces every instrument, the tempo and the LFOs, for everyone in the room. '
        + 'Save first if you want to keep what is here now.',
    );
    if (!confirmed || !state.isInRoom) {
        return;
    }
    if (!socket.connected) {
        window.alert('Not connected to the room right now. Try again in a moment.');
        return;
    }
    socket.emit('room:import', { roomFile: result.bytes }, (response = {}) => {
        if (response.ok) {
            return;
        }
        if (response.error === 'rate-limited') {
            window.alert('Rooms are being loaded too fast from your connection. Wait a minute and try again.');
        } else if (response.error === 'not-in-room') {
            window.alert('Reconnect to your room before loading a file into it.');
        } else {
            window.alert(roomFileErrorMessage(response.error, response) || `Could not load that file: ${response.error || 'unknown error'}.`);
        }
    });
}

// Checks the file here first, so a wrong file gets an answer straight away,
// then packs it for the server: minified and, where the browser can, gzipped.
async function prepareFile(file) {
    if (file.size > ROOM_FILE_MAX_BYTES) {
        return { ok: false, error: 'room-file-too-large' };
    }
    let data;
    try {
        data = JSON.parse(await file.text());
    } catch {
        return { ok: false, error: 'not-a-room-file' };
    }
    const result = readRoomFile(data);
    if (!result.ok) {
        return result;
    }
    const bytes = await compress(JSON.stringify(data));
    if (bytes.byteLength > MAX_SEND_BYTES) {
        return { ok: false, error: 'room-file-too-large' };
    }
    return { ok: true, room: result.room, bytes };
}

async function compress(text) {
    const raw = new TextEncoder().encode(text);
    if (typeof CompressionStream !== 'function') {
        return raw;
    }
    try {
        const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
        return raw;
    }
}

// The saved room's name, else the file's, in the characters room names allow.
function roomNameFor(savedName, fileName) {
    const clean = (value) => String(value || '')
        .replace(/[^A-Za-z0-9 -]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, ROOM_NAME_MAX_LENGTH)
        .trim();
    const fromFile = String(fileName || '').replace(/\.seqroom\.json$/i, '').replace(/\.json$/i, '');
    return clean(savedName) || clean(fromFile) || 'session';
}

// e.g. friday-jam-2026-11-16-2130.seqroom.json
function roomFileName(roomName) {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const base = String(roomName || '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'seqroom';
    return `${base}-${stamp}${ROOM_FILE_EXTENSION}`;
}

function downloadText(fileName, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Some browsers (iOS Safari) read the blob after click() returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}
