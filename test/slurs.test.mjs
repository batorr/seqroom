import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSlurs } from '../public/src/shared/slurs.js';

// Builds a pattern from a compact string: '.' rest, 'n' note, 's' sliding
// note, 'x' slide flag on a rest.
function pattern(text) {
    return [...text].map((c) => ({ active: c === 'n' || c === 's', slide: c === 's' || c === 'x' }));
}

const visible = (slurs) => slurs.filter((s) => !s.inert);

test('a run of sliding notes is one slur from the first note to where the last slide lands', () => {
    const slurs = visible(computeSlurs(pattern('n.sssn..n.......'), 16));
    assert.deepEqual(slurs, [{ start: 2.5, end: 5.5, openStart: false, openEnd: false, inert: false }]);
});

test('separate runs get separate slurs', () => {
    const slurs = visible(computeSlurs(pattern('sn..sn..........'), 16));
    assert.deepEqual(slurs.map((s) => [s.start, s.end]), [[0.5, 1.5], [4.5, 5.5]]);
});

test('a slide into a rest still ends on that step', () => {
    const slurs = visible(computeSlurs(pattern('s...............'), 16));
    assert.deepEqual(slurs.map((s) => [s.start, s.end]), [[0.5, 1.5]]);
});

test('a slide on the last step is open at the end and reappears open before step 1', () => {
    const slurs = visible(computeSlurs(pattern('n..............s'), 16));
    assert.deepEqual(slurs, [
        { start: 0, end: 0.5, openStart: true, openEnd: false, inert: false },
        { start: 15.5, end: 16, openStart: false, openEnd: true, inert: false },
    ]);
});

test('wrapping into a run that starts on step 1 joins it', () => {
    const slurs = visible(computeSlurs(pattern('ss.............s'), 16));
    assert.deepEqual(slurs.map((s) => [s.start, s.end, s.openStart, s.openEnd]), [
        [0, 2.5, true, false],
        [15.5, 16, false, true],
    ]);
});

test('a slide flag on a rest is drawn faint on its own and breaks a run', () => {
    const slurs = computeSlurs(pattern('ssxs............'), 16);
    assert.deepEqual(slurs.filter((s) => s.inert).map((s) => [s.start, s.end]), [[2.5, 3.5]]);
    assert.deepEqual(visible(slurs).map((s) => [s.start, s.end]), [[0.5, 2.5], [3.5, 4.5]]);
});

test('runs crossing a 16-step line stay one slur (split when drawn)', () => {
    const text = '..............ssn' + '.'.repeat(15);
    const slurs = visible(computeSlurs(pattern(text), 32));
    assert.deepEqual(slurs.map((s) => [s.start, s.end]), [[14.5, 16.5]]);
});

test('steps beyond the pattern length are ignored', () => {
    assert.deepEqual(computeSlurs(pattern('nnnnssss'), 4), []);
});
