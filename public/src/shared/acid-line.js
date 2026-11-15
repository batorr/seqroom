// Random TB-303 lines for acid techno (pure: no DOM, so it runs under node --test).
//
// Notes are not drawn from the whole chromatic range: each roll picks a root
// in octave 2 and one of the dark, minor-flavoured scales acid lines live in,
// then draws pitches from that scale. The root is weighted heaviest, then its
// octave and the fifth, so the line keeps pumping on the tonic the way acid
// basslines do. Slides and accents are only rolled on notes that play; a
// slide may still lead into a rest.

export const ACID_SCALES = [
    { name: 'Minor pentatonic', intervals: [0, 3, 5, 7, 10] },
    { name: 'Natural minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
    { name: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
    { name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
    { name: 'Harmonic minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROOT_OCTAVE = 2;

const ACTIVE_CHANCE = 0.5;
const ACCENT_CHANCE = 0.25;
const SLIDE_CHANCE = 0.15;

function noteName(semitonesFromC1) {
    return `${NOTE_NAMES[semitonesFromC1 % 12]}${Math.floor(semitonesFromC1 / 12) + 1}`;
}

// Weighted pitch pool for one root and scale, in semitones above the root.
function pitchPool(intervals) {
    const pool = intervals.map((interval) => {
        if (interval === 0) return { interval, weight: 5 };
        if (interval === 7) return { interval, weight: 2 };
        if (interval === 3) return { interval, weight: 1.5 };
        return { interval, weight: 1 };
    });
    pool.push({ interval: 12, weight: 2.5 });
    intervals
        .filter((interval) => interval > 0 && interval <= 7)
        .forEach((interval) => pool.push({ interval: interval + 12, weight: 0.5 }));
    return pool;
}

function pickWeighted(pool, rng) {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let r = rng() * total;
    for (const entry of pool) {
        r -= entry.weight;
        if (r < 0) return entry;
    }
    return pool[pool.length - 1];
}

export function randomAcidLine(count, rng = Math.random) {
    const rootClass = Math.floor(rng() * 12);
    const scale = ACID_SCALES[Math.floor(rng() * ACID_SCALES.length)];
    const rootSemitones = (ROOT_OCTAVE - 1) * 12 + rootClass;
    const pool = pitchPool(scale.intervals);

    const steps = [];
    for (let i = 0; i < count; i += 1) {
        const active = rng() < ACTIVE_CHANCE;
        const pitch = noteName(rootSemitones + pickWeighted(pool, rng).interval);
        steps.push({
            active,
            pitch,
            accent: active && rng() < ACCENT_CHANCE,
            slide: active && rng() < SLIDE_CHANCE,
        });
    }

    return { root: NOTE_NAMES[rootClass], scale: scale.name, steps };
}
