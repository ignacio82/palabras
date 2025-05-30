// gameLogic.js

// Assuming DICTIONARY_DATA is globally available from dictionary.js
// Assuming pizarraState.js is loaded and its exports are available if this were a module (see note below)

// For a modular approach, you'd typically use:
// import * as state from './pizarraState.js';
// import { DICTIONARY_DATA } from './dictionary.js'; // If dictionary.js also used ES6 modules

// Since we are not yet using full ES6 modules via <script type="module"> for all files,
// we'll assume DICTIONARY_DATA is global, and for state, we'll define functions
// that would interact with a state object if it were passed or imported.
// For now, let's make it work with the global/semi-global structure evolving.
// Ideally, pizarraState.js would export functions to get/set state, and this module would call them.

// --- Helper Functions ---
function normalizeStringForGame(str) {
    if (!str) return "";
    // This function should match how it's defined or used in pizarraState.js or main.js
    // For consistency, let's assume a global `normalizeString` or that `pizarraState.normalizeString` exists.
    // If not, we can define it here or ensure it's provided.
    // Using a simple version for now, assuming pizarraState.js might have a more robust one.
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}


// --- Core Game Logic Functions ---

/**
 * Initializes a new game round.
 * Relies on main.js to update UI elements based on returned state or direct calls to UI functions.
 * stateRef: A reference to the state management object (like the one in pizarraState.js)
 */
export function initializeGame(stateRef, difficulty) {
    stateRef.resetGameFlowState(); // Resets word, guessed letters, attempts, clue status
    stateRef.setCurrentDifficulty(difficulty);
    stateRef.setGameActive(true); // Mark game as active

    const wordSelected = selectNewWord(stateRef);
    if (!wordSelected) {
        stateRef.setGameActive(false);
        return { success: false, message: `No hay palabras para la dificultad '${difficulty}'.` };
    }

    stateRef.setRemainingAttempts(stateRef.MAX_ATTEMPTS); // Use constant from state
    stateRef.guessedLetters.clear();
    stateRef.setClueUsedThisGame(false);

    // For Pizarra (single local player for now), player ID is implicitly 0 or managed by main.js
    // stateRef.setCurrentPlayerId(0); // Example if managing here

    return { success: true, currentWordObject: stateRef.currentWordObject };
}

/**
 * Selects a new word based on the current difficulty set in stateRef.
 * Updates stateRef.currentWordObject and stateRef.currentWord.
 */
export function selectNewWord(stateRef) {
    if (typeof DICTIONARY_DATA === 'undefined' || DICTIONARY_DATA.length === 0) {
        console.error("GAME LOGIC: ¡Diccionario no cargado o vacío!");
        stateRef.setCurrentWordObject(null);
        return false;
    }

    const availableWords = DICTIONARY_DATA.filter(item => item.difficulty === stateRef.currentDifficulty);

    if (availableWords.length === 0) {
        console.warn(`GAME LOGIC: No hay palabras para la dificultad: ${stateRef.currentDifficulty}`);
        stateRef.setCurrentWordObject(null);
        return false;
    }

    const randomIndex = Math.floor(Math.random() * availableWords.length);
    const selectedWordObj = availableWords[randomIndex];
    stateRef.setCurrentWordObject(selectedWordObj); // Sets both currentWordObject and normalized currentWord in state
    return true;
}

/**
 * Processes a player's letter guess.
 * Updates stateRef (guessedLetters, remainingAttempts, gameActive).
 * Returns an object indicating the outcome.
 */
export function processGuess(stateRef, letter) {
    if (!stateRef.gameActive) {
        return { validGuess: false, message: "El juego no está activo." };
    }
    if (!letter || letter.length !== 1 || !stateRef.ALPHABET.includes(letter.toUpperCase())) {
        return { validGuess: false, message: "Intento inválido." };
    }

    const upperLetter = letter.toUpperCase();

    if (stateRef.guessedLetters.has(upperLetter)) {
        return { validGuess: false, alreadyGuessed: true, letter: upperLetter, message: "Ya intentaste esa letra." };
    }

    stateRef.guessedLetters.add(upperLetter);

    const letterIsInWord = stateRef.currentWord.includes(upperLetter);

    if (letterIsInWord) {
        const wordSolved = checkWinCondition(stateRef);
        if (wordSolved) {
            stateRef.setGameActive(false);
        }
        return {
            validGuess: true,
            correct: true,
            letter: upperLetter,
            wordSolved: wordSolved,
            remainingAttempts: stateRef.remainingAttempts
        };
    } else {
        stateRef.setRemainingAttempts(stateRef.remainingAttempts - 1);
        const gameOver = checkLossCondition(stateRef);
        if (gameOver) {
            stateRef.setGameActive(false);
        }
        return {
            validGuess: true,
            correct: false,
            letter: upperLetter,
            gameOver: gameOver,
            remainingAttempts: stateRef.remainingAttempts
        };
    }
}

/**
 * Checks if the current word has been completely guessed.
 */
export function checkWinCondition(stateRef) {
    if (!stateRef.currentWord) return false;
    for (const letter of stateRef.currentWord) {
        if (!stateRef.guessedLetters.has(letter)) {
            return false;
        }
    }
    return true;
}

/**
 * Checks if the player has run out of attempts.
 */
export function checkLossCondition(stateRef) {
    return stateRef.remainingAttempts <= 0;
}

/**
 * Handles a clue request.
 * Updates stateRef.clueUsedThisGame.
 * Returns an object with the clue or an error message.
 */
export function requestClue(stateRef) {
    if (!stateRef.gameActive) {
        return { success: false, message: "El juego no está activo para pedir pistas." };
    }
    if (stateRef.clueUsedThisGame) {
        return { success: false, message: "Ya usaste la pista para esta palabra." };
    }
    if (!stateRef.currentWordObject || !stateRef.currentWordObject.definition) {
        return { success: false, message: "No hay pista disponible para esta palabra." };
    }

    stateRef.setClueUsedThisGame(true);
    // Optional: Implement a cost for the clue, e.g.,
    // stateRef.setRemainingAttempts(stateRef.remainingAttempts - 1);
    // if (checkLossCondition(stateRef)) { stateRef.setGameActive(false); }

    return {
        success: true,
        clue: stateRef.currentWordObject.definition,
        // remainingAttempts: stateRef.remainingAttempts // if clue has a cost
    };
}