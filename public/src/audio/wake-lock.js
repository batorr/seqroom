// Keeps the screen on while the transport plays.
//
// When a phone's screen dims and locks, the browser throttles or pauses the
// page's timers, and the scheduler (a 25 ms timer on the main thread) can no
// longer queue steps in time: notes go missing or stutter. A screen wake lock
// stops that from happening during playback. Browsers release the lock when
// the page is hidden, so it is taken again when the page comes back, and on
// the next tap if the browser refused it without a user gesture.

let sentinel = null;
let wanted = false;
let requesting = false;

async function acquire() {
    if (!wanted || sentinel || requesting || typeof navigator === 'undefined' || !navigator.wakeLock) {
        return;
    }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
    }
    requesting = true;
    try {
        const lock = await navigator.wakeLock.request('screen');
        if (!wanted) {
            lock.release().catch(() => {});
            return;
        }
        sentinel = lock;
        lock.addEventListener('release', () => {
            if (sentinel === lock) {
                sentinel = null;
            }
        });
    } catch {
        // Not allowed right now (no gesture yet, low battery, not https): the
        // next tap or return to the page tries again.
    } finally {
        requesting = false;
    }
}

export function keepScreenAwake(on) {
    wanted = Boolean(on);
    if (wanted) {
        acquire();
    } else if (sentinel) {
        const lock = sentinel;
        sentinel = null;
        lock.release().catch(() => {});
    }
}

export function isScreenKeptAwake() {
    return Boolean(sentinel);
}

if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', acquire);
    document.addEventListener('pointerup', acquire, { passive: true });
}
