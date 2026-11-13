// Clock synchronisation helpers (pure, unit-tested).

// NTP-style sample from one request/response round trip. All times in ms.
export function computeClockSample(clientSendTime, serverReceiveTime, serverResponseTime, clientReceiveTime) {
    const offsetMs = ((serverReceiveTime - clientSendTime) + (serverResponseTime - clientReceiveTime)) / 2;
    const rttMs = Math.max(0, (clientReceiveTime - clientSendTime) - (serverResponseTime - serverReceiveTime));
    return { offsetMs, rttMs };
}

// Estimates the server clock offset from noisy samples.
//
// Network queuing only ever adds delay, so the sample with the smallest round
// trip in the recent window is the most trustworthy. While music is playing
// the estimate is slewed by at most `maxSlewMs` per sample, so a noisy sample
// can never make scheduled notes jump; it may jump freely while stopped,
// during warm-up, or when the error is large (clock change, sleep/wake).
export function createOffsetEstimator({
    windowSize = 12,
    warmupSamples = 6,
    maxSlewMs = 1,
    jumpThresholdMs = 50,
} = {}) {
    let samples = [];
    let estimate = null;
    let sampleCount = 0;

    return {
        addSample(offsetMs, rttMs, { playing = false } = {}) {
            if (!Number.isFinite(offsetMs) || !Number.isFinite(rttMs)) {
                return estimate;
            }
            sampleCount += 1;
            samples.push({ offsetMs, rttMs });
            if (samples.length > windowSize) {
                samples = samples.slice(samples.length - windowSize);
            }
            const best = samples.reduce((a, b) => (b.rttMs < a.rttMs ? b : a));
            const target = best.offsetMs;
            const canJump = estimate === null
                || !playing
                || sampleCount <= warmupSamples
                || Math.abs(target - estimate) > jumpThresholdMs;
            if (canJump) {
                estimate = target;
            } else {
                const delta = target - estimate;
                estimate += Math.max(-maxSlewMs, Math.min(maxSlewMs, delta));
            }
            return estimate;
        },
        get value() {
            return estimate;
        },
        get bestRttMs() {
            return samples.length ? Math.min(...samples.map((sample) => sample.rttMs)) : null;
        },
        reset() {
            samples = [];
            estimate = null;
            sampleCount = 0;
        },
    };
}

// Rolling median, used to de-jitter the performance.now() <-> AudioContext
// time mapping (AudioContext time only advances once per audio callback).
export function createRollingMedian(windowSize = 15) {
    let values = [];
    return {
        push(value) {
            if (Number.isFinite(value)) {
                values.push(value);
                if (values.length > windowSize) {
                    values = values.slice(values.length - windowSize);
                }
            }
            return this.value;
        },
        get value() {
            if (!values.length) {
                return null;
            }
            const sorted = [...values].sort((a, b) => a - b);
            const middle = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
        },
        reset() {
            values = [];
        },
    };
}
