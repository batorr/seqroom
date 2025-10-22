// Audio-related constants

// Tempo constraints
export const TEMPO_MIN = 30;
export const TEMPO_MAX = 300;
export const DEFAULT_BPM = 120;

// Clock synchronization
export const OFFSET_SMOOTHING = 0.2;
export const LATENCY_SMOOTHING = 0.25;

// Audio scheduling
export const AUDIO_LOOKAHEAD_MS = 25;
export const AUDIO_SCHEDULE_AHEAD_SECONDS = 0.18;

// Recording
export const RECORDING_STATS_UPDATE_INTERVAL_MS = 200;

// Musical note options for sequencer
export const NOTE_OPTIONS = [
    'C1', 'C#1', 'D1', 'D#1', 'E1', 'F1', 'F#1', 'G1', 'G#1', 'A1', 'A#1', 'B1',
    'C2', 'C#2', 'D2', 'D#2', 'E2', 'F2', 'F#2', 'G2', 'G#2', 'A2', 'A#2', 'B2',
    'C3', 'C#3', 'D3', 'D#3', 'E3', 'F3', 'F#3', 'G3', 'G#3', 'A3', 'A#3', 'B3',
    'C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4',
    'C5', 'C#5', 'D5', 'D#5', 'E5', 'F5', 'F#5', 'G5', 'G#5', 'A5', 'A#5', 'B5',
];
