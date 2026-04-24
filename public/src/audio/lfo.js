// LFO Engine - local modulation only, not synced over socket

import { state } from '../state/main.js';

export const LFO_DIVISIONS = [
    { label: '1/32', beats: 0.125 },
    { label: '1/16', beats: 0.25 },
    { label: '1/8',  beats: 0.5 },
    { label: '1/4',  beats: 1 },
    { label: '1/2',  beats: 2 },
    { label: '1 bar', beats: 4 },
    { label: '2 bars', beats: 8 },
    { label: '4 bars', beats: 16 },
];

const lfos = new Map();
let _nextId = 1;
let _mappingLFOId = null;
let _rafId = null;
let _lastTime = null;
const _tickCallbacks = new Set();

export function getMappingLFOId() { return _mappingLFOId; }

export function setMappingLFO(id) {
    _mappingLFOId = id;
    document.body.classList.toggle('lfo-mapping', id !== null);
}

export function onLFOTick(cb) {
    _tickCallbacks.add(cb);
    return () => _tickCallbacks.delete(cb);
}

function _startClock() {
    if (_rafId) return;
    _lastTime = performance.now();
    function frame(now) {
        const dt = Math.min((now - _lastTime) / 1000, 0.1);
        _lastTime = now;
        _tick(dt);
        _rafId = requestAnimationFrame(frame);
    }
    _rafId = requestAnimationFrame(frame);
}

function _stopClock() {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
}

export function waveformAt(type, shape, p) {
    const phase = ((p % 1) + 1) % 1;
    switch (type) {
        case 'sine': {
            const s = Math.sin(2 * Math.PI * phase);
            return shape > 0 ? Math.sign(s) * Math.pow(Math.abs(s), 1 - shape * 0.85) : s;
        }
        case 'saw': {
            const raw = 2 * phase - 1;
            if (shape > 0) {
                const tri = phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
                return raw + (tri - raw) * shape;
            }
            return raw;
        }
        case 'square': {
            if (shape > 0) {
                const edge = shape * 0.45;
                if (phase < edge) return -1 + 2 * (phase / edge);
                if (phase < 0.5) return 1;
                if (phase < 0.5 + edge) return 1 - 2 * ((phase - 0.5) / edge);
                return -1;
            }
            return phase < 0.5 ? 1 : -1;
        }
        default: return 0;
    }
}

function _tick(dt) {
    const bpm = state.transport?.bpm ?? 120;
    lfos.forEach(lfo => {
        const rateHz = (bpm / 60) / lfo.division;
        const jFactor = lfo.jitter > 0 ? 1 + lfo.jitter * (Math.random() - 0.5) * 0.5 : 1;
        const prevPhase = lfo._phase;
        lfo._phase += rateHz * jFactor * dt;

        let raw;
        if (lfo.waveform === 'sah') {
            const prevCycle = Math.floor(prevPhase);
            const currCycle = Math.floor(lfo._phase);
            if (currCycle > prevCycle || !lfo._sahInit) {
                lfo._sahValue = Math.random() * 2 - 1;
                lfo._sahInit = true;
                lfo._sahHistory.push({ phase: lfo._phase, value: lfo._sahValue });
                if (lfo._sahHistory.length > 16) lfo._sahHistory.shift();
            }
            raw = lfo._sahValue;
        } else {
            raw = waveformAt(lfo.waveform, lfo.shape, lfo._phase + lfo.phase);
        }

        if (lfo.steps >= 2) {
            const stepSize = 2 / lfo.steps;
            raw = Math.round(raw / stepSize) * stepSize;
        }

        if (lfo.smooth > 0) {
            const tc = 0.001 + lfo.smooth * 1.5;
            const alpha = 1 - Math.exp(-dt / tc);
            lfo._out += (raw - lfo._out) * alpha;
        } else {
            lfo._out = raw;
        }
    });
    _tickCallbacks.forEach(cb => cb());
}

export function createLFO() {
    const n = _nextId++;
    const lfo = {
        id: `lfo-${n}`, name: `LFO ${n}`,
        waveform: 'sine', shape: 0, steps: 0, jitter: 0, smooth: 0,
        division: 1, depth: 1.0, offset: 0.0, phase: 0.0,
        targets: [],
        _phase: 0, _out: 0, _sahValue: 0, _sahInit: false, _sahHistory: [],
    };
    lfos.set(lfo.id, lfo);
    _startClock();
    return lfo;
}

export function removeLFO(id) {
    lfos.delete(id);
    if (_mappingLFOId === id) setMappingLFO(null);
    if (lfos.size === 0) _stopClock();
}

export function getLFOs() { return lfos; }
export function getLFO(id) { return lfos.get(id); }

export function addTarget(lfoId, instrumentId, paramKey, paramMin, paramMax, label) {
    const lfo = lfos.get(lfoId);
    if (!lfo) return;
    lfo.targets = lfo.targets.filter(
        t => !(t.instrumentId === instrumentId && t.paramKey === paramKey)
    );
    lfo.targets.push({ instrumentId, paramKey, paramMin, paramMax, label });
}

export function removeTarget(lfoId, instrumentId, paramKey) {
    const lfo = lfos.get(lfoId);
    if (!lfo) return;
    lfo.targets = lfo.targets.filter(
        t => !(t.instrumentId === instrumentId && t.paramKey === paramKey)
    );
}

export function isParamMapped(instrumentId, paramKey) {
    for (const lfo of lfos.values()) {
        if (lfo.targets.some(t => t.instrumentId === instrumentId && t.paramKey === paramKey)) {
            return true;
        }
    }
    return false;
}

export function getModulatedParam(instrumentId, paramKey, baseValue, paramMin, paramMax) {
    let mod = 0;
    let found = false;
    lfos.forEach(lfo => {
        if (!lfo.targets.some(t => t.instrumentId === instrumentId && t.paramKey === paramKey)) return;
        mod += (lfo._out + lfo.offset) * lfo.depth * (paramMax - paramMin) * 0.5;
        found = true;
    });
    if (!found) return baseValue;
    return Math.max(paramMin, Math.min(paramMax, baseValue + mod));
}
