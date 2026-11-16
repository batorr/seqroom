// Room files: a saved copy of a room's music (tempo, instruments, steps,
// sound settings, LFOs) that can be opened later in a new room or loaded
// into a running one.
//
// Shared by the browser, which writes the file and checks it before sending,
// and the server, which reads it back. Reading only checks the structure and
// loosely bounds the values; the server still puts every value through the
// same normalisers a live edit goes through.

import { DRUM_VOICE_IDS } from './drum-kit.js';
import { FX_VOICE_IDS } from './fx.js';

export const ROOM_FILE_FORMAT = 'seqroom-room';
export const ROOM_FILE_VERSION = 1;
export const ROOM_FILE_EXTENSION = '.seqroom.json';

// Far above the largest room a server holds; anything bigger is not a room file.
export const ROOM_FILE_MAX_BYTES = 2 * 1024 * 1024;

// Instruments whose steps are a set of voices (lanes) rather than a note.
const LAYERED_VOICES = {
    'drum-kit': DRUM_VOICE_IDS,
    fx: FX_VOICE_IDS,
};

// Keep reading a hand-edited or hostile file cheap; the server applies its
// own, tighter room limits afterwards.
const MAX_INSTRUMENTS = 256;
const MAX_STEPS = 128;
const MAX_LFOS = 32;
const MAX_LFO_TARGETS = 32;
const MAX_PARAMS = 128;
const ROOM_NAME_MAX_LENGTH = 64;
const INSTRUMENT_NAME_MAX_LENGTH = 48;
const DISPLAY_NAME_MAX_LENGTH = 32;
const KEY_MAX_LENGTH = 64;
const STRING_VALUE_MAX_LENGTH = 32;

const PITCH_PATTERN = /^[A-G]#?[0-9]$/;
const LFO_FIELDS = ['waveform', 'shape', 'steps', 'jitter', 'smooth', 'division', 'depth', 'offset', 'phase'];

// ─── Writing ─────────────────────────────────────────────────────────────

// `instruments` in room order, as the browser holds them; `lfos` with targets
// naming instruments by id. Ids are not saved (a loaded room gets new ones):
// an LFO target names its instrument by position in `instruments` instead.
export function createRoomFile({ name = '', bpm = null, instruments = [], lfos = [], savedAt = new Date() } = {}) {
    const positions = new Map();
    const savedInstruments = instruments.map((instrument, index) => {
        positions.set(instrument.id, index);
        return saveInstrument(instrument);
    });
    return {
        format: ROOM_FILE_FORMAT,
        version: ROOM_FILE_VERSION,
        savedAt: savedAt.toISOString(),
        name,
        bpm,
        instruments: savedInstruments,
        lfos: lfos.map((lfo) => saveLfo(lfo, positions)),
    };
}

function saveInstrument(instrument) {
    const voices = LAYERED_VOICES[instrument.type];
    const stepCount = instrument.stepCount;
    // Only the steps in play; ones kept beyond a shortened pattern are dropped.
    const steps = (instrument.steps || [])
        .slice(0, stepCount)
        .map((step) => (voices ? saveLayeredStep(step, voices) : saveNoteStep(step)));
    const saved = {
        type: instrument.type,
        name: instrument.name,
        muted: Boolean(instrument.muted),
        stepCount,
        params: { ...(instrument.params || {}) },
        steps,
    };
    if (instrument.creatorDisplayName) {
        saved.creator = instrument.creatorDisplayName;
    }
    return saved;
}

// The voices that sound on the step, e.g. ["kick", "hat"].
function saveLayeredStep(step, voices) {
    const layers = step?.layers || {};
    return voices.filter((id) => layers[id] === true);
}

// The pitch, plus only what differs from an empty step (off, velocity 1, no
// accent, no slide). A step that is off keeps its pitch for when it is back on.
function saveNoteStep(step) {
    const saved = { pitch: step?.pitch };
    if (step?.active) saved.active = true;
    if (Number.isFinite(step?.velocity) && step.velocity !== 1) saved.velocity = step.velocity;
    if (step?.accent) saved.accent = true;
    if (step?.slide) saved.slide = true;
    return saved;
}

function saveLfo(lfo, positions) {
    const saved = {};
    for (const field of LFO_FIELDS) {
        if (lfo[field] !== undefined) {
            saved[field] = lfo[field];
        }
    }
    saved.targets = (lfo.targets || [])
        .filter((target) => positions.has(target.instrumentId))
        .map((target) => ({
            instrument: positions.get(target.instrumentId),
            paramKey: target.paramKey,
            paramMin: target.paramMin,
            paramMax: target.paramMax,
            label: target.label,
        }));
    return saved;
}

// ─── Reading ─────────────────────────────────────────────────────────────

// Reads a room file, given its text or its parsed JSON. Returns
// { ok: true, room } or { ok: false, error }, error being 'not-a-room-file'
// or 'room-file-too-new'.
//
// room: { name, bpm, instruments, lfos }. Each instrument is
// { type, name, creatorDisplayName, muted, stepCount, params, steps }, its
// steps in the shape the server's step updates take: { layers: { kick: true } }
// for the Rave Kit and FX, { active, pitch, velocity, accent, slide } for the
// rest. LFOs are { params, targets }, a target naming its instrument by
// position in room.instruments. Types, parameter keys and ranges are left to
// the server.
export function readRoomFile(input) {
    let data = input;
    if (typeof input === 'string') {
        try {
            data = JSON.parse(input);
        } catch {
            return { ok: false, error: 'not-a-room-file' };
        }
    }

    if (!isPlainObject(data) || data.format !== ROOM_FILE_FORMAT || !Number.isInteger(data.version) || data.version < 1) {
        return { ok: false, error: 'not-a-room-file' };
    }
    if (data.version > ROOM_FILE_VERSION) {
        return { ok: false, error: 'room-file-too-new' };
    }

    // Unreadable entries are skipped, so LFO targets are renumbered to match.
    const instruments = [];
    const positions = new Map();
    (Array.isArray(data.instruments) ? data.instruments : []).slice(0, MAX_INSTRUMENTS).forEach((raw, index) => {
        const instrument = readInstrument(raw);
        if (instrument) {
            positions.set(index, instruments.length);
            instruments.push(instrument);
        }
    });

    const lfos = (Array.isArray(data.lfos) ? data.lfos : [])
        .slice(0, MAX_LFOS)
        .filter(isPlainObject)
        .map((raw) => readLfo(raw, positions));

    return {
        ok: true,
        room: {
            name: readString(data.name, ROOM_NAME_MAX_LENGTH),
            bpm: Number.isFinite(data.bpm) ? data.bpm : null,
            instruments,
            lfos,
        },
    };
}

function readInstrument(raw) {
    if (!isPlainObject(raw) || typeof raw.type !== 'string' || !raw.type) {
        return null;
    }
    const voices = LAYERED_VOICES[raw.type];
    const steps = (Array.isArray(raw.steps) ? raw.steps : [])
        .slice(0, MAX_STEPS)
        .map((step) => (voices ? readLayeredStep(step, voices) : readNoteStep(step)));
    return {
        type: raw.type.slice(0, KEY_MAX_LENGTH),
        name: readString(raw.name, INSTRUMENT_NAME_MAX_LENGTH),
        creatorDisplayName: readString(raw.creator, DISPLAY_NAME_MAX_LENGTH),
        muted: raw.muted === true,
        stepCount: Number.isFinite(raw.stepCount) ? raw.stepCount : steps.length,
        params: readParams(raw.params),
        steps,
    };
}

function readLayeredStep(step, voices) {
    const layers = {};
    if (Array.isArray(step)) {
        for (const id of step) {
            if (voices.includes(id)) {
                layers[id] = true;
            }
        }
    }
    return { layers };
}

function readNoteStep(step) {
    if (!isPlainObject(step)) {
        return { active: false };
    }
    const changes = {
        active: step.active === true,
        velocity: Number.isFinite(step.velocity) ? Math.min(Math.max(step.velocity, 0), 1) : 1,
        accent: step.accent === true,
        slide: step.slide === true,
    };
    if (typeof step.pitch === 'string' && PITCH_PATTERN.test(step.pitch)) {
        changes.pitch = step.pitch;
    }
    return changes;
}

// Plain values only; which keys and ranges an instrument takes is the server's call.
function readParams(raw) {
    const params = {};
    if (!isPlainObject(raw)) {
        return params;
    }
    for (const [key, value] of Object.entries(raw).slice(0, MAX_PARAMS)) {
        if (key === '__proto__' || key.length > KEY_MAX_LENGTH) {
            continue;
        }
        if (isPlainValue(value)) {
            params[key] = value;
        }
    }
    return params;
}

function readLfo(raw, positions) {
    const params = {};
    for (const field of LFO_FIELDS) {
        if (isPlainValue(raw[field])) {
            params[field] = raw[field];
        }
    }
    const targets = (Array.isArray(raw.targets) ? raw.targets : [])
        .slice(0, MAX_LFO_TARGETS)
        .filter((target) => isPlainObject(target)
            && positions.has(target.instrument)
            && typeof target.paramKey === 'string'
            && target.paramKey.length > 0
            && Number.isFinite(target.paramMin)
            && Number.isFinite(target.paramMax))
        .map((target) => ({
            instrument: positions.get(target.instrument),
            paramKey: target.paramKey.slice(0, KEY_MAX_LENGTH),
            paramMin: target.paramMin,
            paramMax: target.paramMax,
            label: readString(target.label, KEY_MAX_LENGTH) || target.paramKey.slice(0, KEY_MAX_LENGTH),
        }));
    return { params, targets };
}

function readString(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isPlainValue(value) {
    return (typeof value === 'number' && Number.isFinite(value))
        || typeof value === 'boolean'
        || (typeof value === 'string' && value.length <= STRING_VALUE_MAX_LENGTH);
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
