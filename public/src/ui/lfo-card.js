// LFO Card UI - renders LFO panels and handles interaction

import {
    createLFO, removeLFO, getLFOs,
    addTarget, removeTarget, isParamMapped, getModulatedParam,
    getMappingLFOId, setMappingLFO, onLFOTick,
    waveformAt, LFO_DIVISIONS,
} from '../audio/lfo.js';
import { state } from '../state/main.js';
import { formatParamDisplay } from '../utils/helpers.js';

const CYCLES = 2; // cycles shown in canvas

let _lfoListEl = null;

export function initLFOPanel() {
    _lfoListEl = document.getElementById('lfo-list');

    const addBtn = document.getElementById('add-lfo');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            createLFO();
            renderLFOCards();
        });
    }

    // Map mode: intercept param control clicks in capture phase
    document.addEventListener('click', (e) => {
        const mappingId = getMappingLFOId();
        if (!mappingId) return;
        if (e.target.closest('.lfo-card')) return;
        const ctrl = e.target.closest('.param-control[data-param-min]');
        if (!ctrl) return;
        const { instrumentId, paramKey, paramMin, paramMax, paramLabel } = ctrl.dataset;
        if (!instrumentId || !paramKey || paramMin === undefined) return;
        addTarget(mappingId, instrumentId, paramKey, Number(paramMin), Number(paramMax), paramLabel || paramKey);
        setMappingLFO(null);
        renderLFOCards();
        refreshParamIndicators();
        e.stopPropagation();
    }, true);

    // RAF tick: update canvases + modulated sliders
    onLFOTick(() => {
        if (!_lfoListEl) return;
        getLFOs().forEach(lfo => {
            const canvas = document.getElementById(`lfo-canvas-${lfo.id}`);
            if (canvas) drawCanvas(canvas, lfo);

            lfo.targets.forEach(t => {
                const slider = document.getElementById(`${t.instrumentId}-${t.paramKey}`);
                if (!slider || document.activeElement === slider) return;
                const instrument = state.instruments?.get(t.instrumentId);
                if (!instrument) return;
                const baseValue = instrument.params?.[t.paramKey] ?? 0;
                const modValue = getModulatedParam(t.instrumentId, t.paramKey, baseValue, t.paramMin, t.paramMax);
                slider.value = String(modValue);
                const badge = slider.nextElementSibling;
                if (badge?.classList.contains('param-value')) {
                    badge.textContent = formatParamDisplay(modValue, { max: t.paramMax });
                }
            });
        });
    });
}

export function refreshParamIndicators() {
    document.querySelectorAll('.param-control[data-instrument-id][data-param-key]').forEach(ctrl => {
        const { instrumentId, paramKey } = ctrl.dataset;
        ctrl.classList.toggle('lfo-mapped', !!(paramKey && isParamMapped(instrumentId, paramKey)));
    });
}

export function renderLFOCards() {
    if (!_lfoListEl) return;
    _lfoListEl.innerHTML = '';
    getLFOs().forEach(lfo => _lfoListEl.appendChild(buildCard(lfo)));
    refreshParamIndicators();
}

function buildCard(lfo) {
    const isMappingThis = getMappingLFOId() === lfo.id;
    const card = document.createElement('div');
    card.className = 'lfo-card' + (isMappingThis ? ' lfo-mapping-active' : '');
    card.id = `lfo-card-${lfo.id}`;

    // ── Header
    const header = document.createElement('div');
    header.className = 'lfo-header';

    const name = document.createElement('span');
    name.className = 'lfo-name';
    name.textContent = lfo.name;

    const mapBtn = document.createElement('button');
    mapBtn.className = 'lfo-map-btn' + (isMappingThis ? ' active' : '');
    mapBtn.textContent = isMappingThis ? 'Cancel' : 'Map';
    mapBtn.title = 'Assign this LFO to a parameter';
    mapBtn.addEventListener('click', () => {
        setMappingLFO(getMappingLFOId() === lfo.id ? null : lfo.id);
        renderLFOCards();
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'lfo-remove-btn';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove LFO';
    removeBtn.addEventListener('click', () => {
        removeLFO(lfo.id);
        renderLFOCards();
        refreshParamIndicators();
    });

    header.append(name, mapBtn, removeBtn);

    // ── Canvas
    const canvas = document.createElement('canvas');
    canvas.className = 'lfo-canvas';
    canvas.id = `lfo-canvas-${lfo.id}`;
    canvas.width = 300;
    canvas.height = 48;
    drawCanvas(canvas, lfo);

    // ── Controls
    const controls = document.createElement('div');
    controls.className = 'lfo-controls';

    // Row 1: Waveform, Shape, Steps, Jitter, Smooth
    const row1 = document.createElement('div');
    row1.className = 'lfo-row';

    // Waveform selector
    const waveCtrl = document.createElement('div');
    waveCtrl.className = 'lfo-control';
    const waveLabel = document.createElement('label');
    waveLabel.textContent = 'Waveform';
    const waveBtns = document.createElement('div');
    waveBtns.className = 'lfo-wave-btns';
    [['sine', 'Sine'], ['saw', 'Saw'], ['square', 'Sqr'], ['sah', 'S&H']].forEach(([w, label]) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.dataset.wave = w;
        btn.className = lfo.waveform === w ? 'active' : '';
        btn.addEventListener('click', () => {
            lfo.waveform = w;
            waveBtns.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.wave === w));
        });
        waveBtns.appendChild(btn);
    });
    waveCtrl.append(waveLabel, waveBtns);
    row1.appendChild(waveCtrl);

    row1.appendChild(makeSlider('Shape', lfo, 'shape', 0, 1, 0.01, v => `${Math.round(v * 100)}%`));

    // Steps select
    const stepsCtrl = document.createElement('div');
    stepsCtrl.className = 'lfo-control';
    const stepsLabel = document.createElement('label');
    stepsLabel.textContent = 'Steps';
    const stepsSelect = document.createElement('select');
    [0, 2, 4, 8, 16, 32].forEach(n => {
        const opt = document.createElement('option');
        opt.value = n;
        opt.textContent = n === 0 ? 'Off' : n;
        opt.selected = lfo.steps === n;
        stepsSelect.appendChild(opt);
    });
    stepsSelect.addEventListener('change', () => { lfo.steps = Number(stepsSelect.value); });
    stepsCtrl.append(stepsLabel, stepsSelect);
    row1.appendChild(stepsCtrl);

    row1.appendChild(makeSlider('Jitter', lfo, 'jitter', 0, 1, 0.01, v => `${Math.round(v * 100)}%`));
    row1.appendChild(makeSlider('Smooth', lfo, 'smooth', 0, 1, 0.01, v => `${Math.round(v * 100)}%`));

    controls.appendChild(row1);

    // Row 2: Rate, Depth, Offset, Phase
    const row2 = document.createElement('div');
    row2.className = 'lfo-row';

    // Rate (musical division select)
    const rateCtrl = document.createElement('div');
    rateCtrl.className = 'lfo-control';
    const rateLabel = document.createElement('label');
    rateLabel.textContent = 'Rate';
    const rateSelect = document.createElement('select');
    LFO_DIVISIONS.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.beats;
        opt.textContent = d.label;
        opt.selected = lfo.division === d.beats;
        rateSelect.appendChild(opt);
    });
    rateSelect.addEventListener('change', () => {
        lfo.division = Number(rateSelect.value);
    });
    rateCtrl.append(rateLabel, rateSelect);
    row2.appendChild(rateCtrl);

    row2.appendChild(makeSlider('Depth', lfo, 'depth', 0, 2, 0.01, v => `${Math.round(v * 100)}%`));
    row2.appendChild(makeSlider('Offset', lfo, 'offset', -1, 1, 0.01, v => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`));
    row2.appendChild(makeSlider('Phase', lfo, 'phase', 0, 1, 0.01, v => `${Math.round(v * 360)}°`));

    controls.appendChild(row2);

    // ── Targets
    const targetsEl = buildTargets(lfo, isMappingThis);

    card.append(header, canvas, controls, targetsEl);
    return card;
}

function makeSlider(labelText, lfo, key, min, max, step, fmt) {
    const ctrl = document.createElement('div');
    ctrl.className = 'lfo-control lfo-slider-ctrl';

    const labelRow = document.createElement('div');
    labelRow.className = 'lfo-label-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    const valSpan = document.createElement('span');
    valSpan.className = 'lfo-val';
    valSpan.textContent = fmt(lfo[key]);
    labelRow.append(label, valSpan);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = lfo[key];
    input.addEventListener('input', () => {
        lfo[key] = Number(input.value);
        valSpan.textContent = fmt(lfo[key]);
    });

    ctrl.append(labelRow, input);
    return ctrl;
}

function buildTargets(lfo, isMappingThis) {
    const section = document.createElement('div');
    section.className = 'lfo-targets';

    if (lfo.targets.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'lfo-targets-empty';
        empty.textContent = isMappingThis ? 'Click any parameter slider to map...' : 'No targets — click Map';
        section.appendChild(empty);
        return section;
    }

    lfo.targets.forEach(t => {
        const tag = document.createElement('div');
        tag.className = 'lfo-target-tag';
        const tagLabel = document.createElement('span');
        tagLabel.textContent = t.label || t.paramKey;
        const removeBtn = document.createElement('button');
        removeBtn.className = 'lfo-target-remove';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
            removeTarget(lfo.id, t.instrumentId, t.paramKey);
            renderLFOCards();
            refreshParamIndicators();
        });
        tag.append(tagLabel, removeBtn);
        section.appendChild(tag);
    });

    return section;
}

function drawCanvas(canvas, lfo) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const pad = 5;

    ctx.clearRect(0, 0, W, H);

    // Centerline
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(129, 140, 248, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    if (lfo.waveform === 'sah') {
        // Draw last CYCLES samples as a step function
        const h = lfo._sahHistory;
        const stepW = W / CYCLES;
        for (let i = 0; i < CYCLES; i++) {
            const entry = h[h.length - CYCLES + i];
            const val = entry ? entry.value : 0;
            const x1 = i * stepW;
            const x2 = (i + 1) * stepW;
            const y = H / 2 - val * (H / 2 - pad);
            if (i === 0) ctx.moveTo(x1, y);
            else ctx.lineTo(x1, y); // vertical step (x same as prev x2)
            ctx.lineTo(x2 - 0.5, y);
        }
    } else {
        for (let px = 0; px <= W; px++) {
            const phase = (px / W) * CYCLES;
            let val = waveformAt(lfo.waveform, lfo.shape, phase + lfo.phase);
            if (lfo.steps >= 2) {
                const stepSize = 2 / lfo.steps;
                val = Math.round(val / stepSize) * stepSize;
            }
            const y = H / 2 - val * (H / 2 - pad);
            if (px === 0) ctx.moveTo(px, y);
            else ctx.lineTo(px, y);
        }
    }
    ctx.stroke();

    // Current position dot
    const dotX = ((lfo._phase % CYCLES) / CYCLES) * W;
    const dotY = H / 2 - lfo._out * (H / 2 - pad);
    ctx.fillStyle = '#c7d2fe';
    ctx.beginPath();
    ctx.arc(dotX, dotY, 3.5, 0, Math.PI * 2);
    ctx.fill();
}
