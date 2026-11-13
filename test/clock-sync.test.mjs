import test from 'node:test';
import assert from 'node:assert/strict';
import { computeClockSample, createOffsetEstimator, createRollingMedian } from '../public/src/shared/clock-sync.js';

test('computeClockSample recovers offset and round trip', () => {
    // Server clock is 1000 ms ahead; 20 ms each way; 2 ms server processing.
    const sample = computeClockSample(0, 1020, 1022, 42);
    assert.equal(sample.offsetMs, 1000);
    assert.equal(sample.rttMs, 40);
});

test('the estimator trusts the lowest round-trip sample', () => {
    const estimator = createOffsetEstimator();
    estimator.addSample(130, 300);
    estimator.addSample(100, 10);
    estimator.addSample(160, 250);
    assert.equal(estimator.value, 100);
});

test('while playing, the estimate slews instead of jumping', () => {
    const estimator = createOffsetEstimator({ warmupSamples: 1, maxSlewMs: 1, jumpThresholdMs: 50 });
    estimator.addSample(100, 10);
    // A later, better sample says 110; the playing estimate may only move 1 ms per sample.
    estimator.addSample(110, 5, { playing: true });
    assert.equal(estimator.value, 101);
    estimator.addSample(110, 5, { playing: true });
    assert.equal(estimator.value, 102);
});

test('large errors and stopped transport allow an immediate jump', () => {
    const estimator = createOffsetEstimator({ warmupSamples: 1 });
    estimator.addSample(100, 10);
    estimator.addSample(500, 1, { playing: true });
    assert.equal(estimator.value, 500);
    estimator.addSample(520, 0.5, { playing: false });
    assert.equal(estimator.value, 520);
});

test('rolling median ignores outliers', () => {
    const median = createRollingMedian(5);
    [10, 11, 500, 10, 12].forEach((value) => median.push(value));
    assert.equal(median.value, 11);
});
