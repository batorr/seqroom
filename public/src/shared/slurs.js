// Slur layout for TB-303 slides (pure: no DOM, so it runs under node --test).
//
// Slides are drawn as slurs, like ties in notation: a run of sliding notes
// gets one arc from the first note to the note the last slide lands on.
// Positions are in steps, a step's centre being index + 0.5. A slide on the
// last step wraps to step 1, so that arc is open at the pattern's end and
// reappears, open, in front of step 1. A slide flag on a silent step has no
// effect on the sound; it is drawn as a faint arc of its own.
export function computeSlurs(steps, count) {
    const flagged = (k) => Boolean(steps[k]?.slide);
    const sliding = (k) => flagged(k) && Boolean(steps[k]?.active);
    const slurs = [];
    if (count <= 0) {
        return slurs;
    }

    for (let k = 0; k < count; k += 1) {
        if (flagged(k) && !steps[k]?.active) {
            const atEnd = k === count - 1;
            slurs.push({ start: k + 0.5, end: atEnd ? count : k + 1.5, openStart: false, openEnd: atEnd, inert: true });
        }
    }

    const wrapsIntoStart = sliding(count - 1);
    if (wrapsIntoStart && !sliding(0)) {
        slurs.push({ start: 0, end: 0.5, openStart: true, openEnd: false, inert: false });
    }

    let k = 0;
    while (k < count) {
        if (!sliding(k)) {
            k += 1;
            continue;
        }
        const first = k;
        while (k < count && sliding(k)) {
            k += 1;
        }
        const last = k - 1;
        const reachesEnd = last === count - 1;
        const openStart = first === 0 && wrapsIntoStart;
        slurs.push({
            start: openStart ? 0 : first + 0.5,
            end: reachesEnd ? count : last + 1.5,
            openStart,
            openEnd: reachesEnd,
            inert: false,
        });
    }
    return slurs;
}
