// pizarraSound.js

import * as state from './pizarraState.js'; // For soundEnabled state if you add a global toggle later

// --- Tone.js Sound Definitions (assuming Tone.js is loaded via CDN in index.html) ---
let letterSelectCorrectSound = null;
let letterSelectIncorrectSound = null;
let wordSolvedSound = null;
let gameOverSound = null;   // For losing the game (running out of stars)
let uiClickSound = null;    // For general UI clicks (buttons, tabs)
export let gameStartSound = null;  // Exporting as it's directly used by name in user's main.js RCA
let clueRevealSound = null;
let errorSound = null;      // For invalid actions or general errors

let soundsCurrentlyInitialized = false; // Internal flag for this module
let hapticsEnabled = true; // User preference, can be made a setting in pizarraState.js later

/**
 * Initializes all Tone.js instruments.
 * Should be called once after a user interaction.
 */
export async function initSounds() {
    if (soundsCurrentlyInitialized) {
        // console.log("[PizarraSound] Sounds already initialized.");
        return;
    }
    if (typeof Tone === 'undefined') {
        console.warn("[PizarraSound] Tone.js library not found. Sound effects will be unavailable.");
        return;
    }

    try {
        await Tone.start(); // Required by modern browsers for AudioContext
        console.log("[PizarraSound] Tone.js AudioContext started.");

        letterSelectCorrectSound = new Tone.Synth({
            oscillator: { type: 'sine' }, volume: -18,
            envelope: { attack: 0.005, decay: 0.08, sustain: 0.01, release: 0.1 }
        }).toDestination();

        letterSelectIncorrectSound = new Tone.Synth({
            oscillator: { type: 'square' }, volume: -20,
            envelope: { attack: 0.005, decay: 0.1, sustain: 0.01, release: 0.1 }
        }).toDestination();
        
        wordSolvedSound = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: 'triangle8' }, volume: -10,
            envelope: { attack: 0.02, decay: 0.4, sustain: 0.2, release: 0.5 }
        }).toDestination();

        gameOverSound = new Tone.NoiseSynth({
            noise: { type: 'brown' }, volume: -15,
            envelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.3 }
        }).toDestination();

        uiClickSound = new Tone.MembraneSynth({
            pitchDecay: 0.01, octaves: 2, oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 },
            volume: -22
        }).toDestination();
        
        gameStartSound = new Tone.Synth({ // As specified in user's RCA for main.js
            oscillator: { type: 'triangle' }, volume: -12,
            envelope: { attack: 0.05, decay: 0.2, sustain: 0.1, release: 0.3 }
        }).toDestination();

        clueRevealSound = new Tone.Synth({
            oscillator: { type: 'sawtooth' }, volume: -16,
            envelope: { attack: 0.02, decay: 0.15, sustain: 0.05, release: 0.2 },
            filter: { type: 'lowpass', frequency: 1200, Q: 0.8 },
            filterEnvelope: { attack: 0.06, decay: 0.1, sustain: 0, release: 0.1, baseFrequency: 250, octaves: 1.5 }
        }).toDestination();

        errorSound = new Tone.NoiseSynth({
            noise: { type: 'pink' }, volume: -18,
            envelope: { attack: 0.005, decay: 0.12, sustain: 0, release: 0.1 }
        }).toDestination();

        soundsCurrentlyInitialized = true;
        // state.setSoundsInitialized(true); // If a flag exists in pizarraState.js
        console.log("[PizarraSound] Sounds initialized.");
    } catch (e) {
        console.error("[PizarraSound] Error initializing sounds:", e);
        soundsCurrentlyInitialized = false;
    }
}

/**
 * Plays a specified sound if sounds are enabled and initialized.
 */
export function playSound(soundObject, note = "C4", duration = "8n", time) {
    // const soundIsEnabled = state.getSoundEnabled(); // If using global toggle
    const soundIsEnabled = true; // Assuming enabled for now

    if (soundIsEnabled && soundsCurrentlyInitialized && soundObject && Tone.context.state === 'running') {
        try {
            if (soundObject.name === "NoiseSynth" || soundObject.name === "MembraneSynth") {
                soundObject.triggerAttackRelease(duration, time || Tone.now());
            } else { // PolySynth or Synth
                soundObject.triggerAttackRelease(note, duration, time || Tone.now());
            }
        } catch (e) {
            console.error("[PizarraSound] Error playing sound:", e, { soundObject_name: soundObject?.name, note, duration });
        }
    }
}

// --- Specific Sound Playing Functions ---
export function playLetterSelectSound(isCorrect) {
    if (isCorrect) {
        playSound(letterSelectCorrectSound, "G4", "16n");
    } else {
        playSound(letterSelectIncorrectSound, "C3", "16n");
    }
}
export function playWordSolvedSound() { playSound(wordSolvedSound, ["C4", "E4", "G4", "C5"], "2n"); }
export function playGameOverSound() { playSound(gameOverSound, undefined, "2n"); } // Note/duration might need adjustment
export function playUiClick() { playSound(uiClickSound, "C5", "32n"); } // Renamed to avoid conflict
export function playGameStart() { playSound(gameStartSound, "G4", "4n"); } // Renamed
export function playClueReveal() { playSound(clueRevealSound, "A3", "4n"); } // Renamed
export function playErrorSound() { playSound(errorSound, undefined, "8n");}


// --- Haptic Feedback ---
/**
 * Triggers haptic feedback if available and enabled.
 * @param {number | number[]} pattern - Vibration pattern (e.g., 50, [100, 30, 100]).
 */
export function triggerVibration(pattern = 30) {
    // const hapticsAreEnabled = state.getHapticsEnabled(); // If using global toggle from pizarraState
    if (hapticsEnabled && typeof navigator.vibrate === 'function') {
        try {
            navigator.vibrate(pattern);
        } catch (e) {
            console.warn("[PizarraSound] Haptic feedback failed:", e);
        }
    }
}

// --- Toggles (basic implementation) ---
export function toggleSoundGlobally() {
    // This would ideally toggle a flag in pizarraState.js
    // For now, it's a placeholder if not using a state flag.
    // To actually mute, you might set Tone.Destination.mute = !isSoundEnabled;
    console.warn("[PizarraSound] toggleSoundGlobally needs integration with a global state for soundEnabled.");
}

export function toggleHapticsGlobally() {
    hapticsEnabled = !hapticsEnabled;
    console.log(`[PizarraSound] Haptics enabled: ${hapticsEnabled}`);
    if (hapticsEnabled) triggerVibration(20);
    return hapticsEnabled;
}