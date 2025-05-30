// gameLogic.js

import * as state from './pizarraState.js';
import { normalizeLetter } from './util.js'; // Using the new util.js

// Assuming DICTIONARY_DATA is globally available from dictionary.js

/**
 * Initializes a new game round.
 * stateRef: A reference to the state management object (pizarraState.js exports)
 * difficulty: The difficulty string ("easy", "medium", "hard")
 */
export function initializeGame(stateRef, difficulty) {
    stateRef.resetGameFlowState();
    stateRef.setCurrentDifficulty(difficulty);

    const wordSelected = selectNewWord(stateRef);
    if (!wordSelected) {
        stateRef.setGameActive(false); // Ensure game is not active if no word
        return { success: false, message: `No hay palabras para la dificultad '${difficulty}'.` };
    }

    // Initialize attempts per player based on current playersData
    // playersData should be set before calling initializeGame (e.g., by main.js or network logic)
    if (stateRef.playersData && stateRef.playersData.length > 0) {
        stateRef.initRemainingAttempts(stateRef.playersData.length);
    } else {
        // Fallback for local single player if playersData isn't set up yet by main.js
        // This path should ideally be handled by main.js ensuring playersData has at least one player.
        stateRef.initRemainingAttempts(1); 
        if (stateRef.playersData.length === 0) { // If truly no player data, set up a default local player
            stateRef.setPlayersData([{id: 0, name: "Jugador 1", icon: "✏️", color: state.DEFAULT_PLAYER_COLORS[0], score: 0}]);
            stateRef.setCurrentPlayerId(0);
        }
    }
    
    stateRef.setGameActive(true);
    stateRef.guessedLetters.clear(); // Cleared in resetGameFlowState, but good to be explicit
    stateRef.setClueUsedThisGame(false); // Cleared in resetGameFlowState

    console.log(`[GameLogic] Game initialized. Word: ${stateRef.currentWordObject?.word}, Difficulty: ${difficulty}, CurrentPlayerID: ${stateRef.currentPlayerId}`);
    return { success: true, currentWordObject: stateRef.currentWordObject };
}

/**
 * Selects a new word based on the current difficulty set in stateRef.
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
    stateRef.setCurrentWordObject(selectedWordObj); // This also sets the normalized state.currentWord
    return true;
}

/**
 * Processes a player's letter guess.
 * Directly uses the imported 'state' module.
 */
export function processGuess(letter) {
    if (!state.gameActive) {
         return {
            letter: normalizeLetter(letter), // Still normalize for consistency in return
            correct: false,
            affectedPlayerId: state.currentPlayerId,
            attemptsLeft: state.getAttemptsFor(state.currentPlayerId),
            nextPlayerId: state.currentPlayerId,
            wordSolved: false,
            gameOver: true, // Game is over if not active
            error: "El juego no está activo."
        };
    }

    const l = normalizeLetter(letter);
    const affectedPlayerId = state.currentPlayerId; // The player making the guess

    if (state.guessedLetters.has(l)) {
        // Letter already guessed, turn might not change, attempts not affected
        return {
            letter: l,
            correct: state.currentWord.includes(l), // It was correct previously
            alreadyGuessed: true,
            affectedPlayerId: affectedPlayerId,
            attemptsLeft: state.getAttemptsFor(affectedPlayerId),
            nextPlayerId: affectedPlayerId, // Turn doesn't change for an already guessed letter
            wordSolved: checkWinCondition(state),
            gameOver: state.getAttemptsFor(affectedPlayerId) <= 0 && !checkWinCondition(state)
        };
    }

    state.guessedLetters.add(l); // Add to guessed set

    const wasCorrect = state.currentWord.includes(l);
    let attemptsLeftForPlayer = state.getAttemptsFor(affectedPlayerId);

    if (!wasCorrect) {
        state.decAttemptsFor(affectedPlayerId);
        attemptsLeftForPlayer = state.getAttemptsFor(affectedPlayerId); // Get updated attempts
    }

    const wordSolved = checkWinCondition(state);
    const playerLost = attemptsLeftForPlayer <= 0 && !wordSolved;
    const gameIsOver = wordSolved || playerLost;

    if (gameIsOver) {
        state.setGameActive(false);
    }

    // Determine next player ID
    // If correct guess and word not solved, player might continue (Pizarra current single player model).
    // For multiplayer, turn always passes unless player solves the word or a specific rule says otherwise.
    // Your proposal: const nextPid = (pid + 1) % state.playersData.length; This always passes turn.
    let nextPlayerId;
    if (gameIsOver) {
        nextPlayerId = -1; // No next player if game is over
    } else if (wasCorrect && !wordSolved) { 
        // Pizarra is single player or host manages turns. If host, turn might not change yet.
        // For strict round-robin as per your proposal:
        nextPlayerId = (affectedPlayerId + 1) % state.playersData.length;
        // However, if Pizarra logic is "player continues on correct guess", this should be:
        // nextPlayerId = affectedPlayerId; 
        // For now, following your round-robin proposal:
        if (state.playersData.length === 0) { // Should not happen if game started
            console.error("[GameLogic] playersData is empty during nextPid calculation!");
            nextPlayerId = 0; // Fallback
        } else {
             nextPlayerId = state.playersData[ (state.playersData.findIndex(p => p.id === affectedPlayerId) + 1) % state.playersData.length ].id;
        }

    } else { // Incorrect guess or word solved
        if (state.playersData.length === 0) {
             console.error("[GameLogic] playersData is empty during nextPid calculation!");
            nextPlayerId = 0; // Fallback
        } else {
            nextPlayerId = state.playersData[ (state.playersData.findIndex(p => p.id === affectedPlayerId) + 1) % state.playersData.length ].id;
        }
    }


    return {
        letter: l,
        correct: wasCorrect,
        affectedPlayerId: affectedPlayerId,
        attemptsLeft: attemptsLeftForPlayer,
        nextPlayerId: nextPlayerId,
        wordSolved: wordSolved,
        gameOver: gameIsOver // True if word solved OR player lost
    };
}

/**
 * Checks if the current word has been completely guessed.
 * Uses the imported 'state'.
 */
export function checkWinCondition() {
    if (!state.currentWord) return false;
    for (const letter of state.currentWord) {
        if (!state.guessedLetters.has(letter)) {
            return false;
        }
    }
    return true;
}

/**
 * Checks if a specific player has run out of attempts.
 * This determines if *that player* has lost their chance for this word.
 * The overall game might end if all players lose or if the word is solved.
 */
export function checkLossConditionForPlayer(playerId) {
    return state.getAttemptsFor(playerId) <= 0;
}

/**
 * Determines the winner(s) and returns winner data for game over scenarios.
 * Returns an object with winners array and tie information.
 */
export function getWinnerData(stateRef) {
    const players = stateRef.getPlayersData();
    if (!players || players.length === 0) {
        return { winners: [], isTie: false };
    }

    // If word was solved, all players who have attempts left are winners
    const wordSolved = checkWinCondition();
    if (wordSolved) {
        const winners = players.filter(p => stateRef.getAttemptsFor(p.id) > 0);
        return { 
            winners: winners.length > 0 ? winners : [players[0]], // Fallback to first player if none have attempts
            isTie: winners.length > 1 
        };
    }

    // If word not solved, find players with highest score or most attempts remaining
    const maxScore = Math.max(...players.map(p => p.score || 0));
    const topScorers = players.filter(p => (p.score || 0) === maxScore);
    
    if (topScorers.length === 1) {
        return { winners: topScorers, isTie: false };
    } else if (topScorers.length > 1) {
        // Tie-breaker: most attempts remaining
        const maxAttempts = Math.max(...topScorers.map(p => stateRef.getAttemptsFor(p.id)));
        const finalWinners = topScorers.filter(p => stateRef.getAttemptsFor(p.id) === maxAttempts);
        return { 
            winners: finalWinners, 
            isTie: finalWinners.length > 1 
        };
    }

    // Fallback: no clear winner
    return { winners: [], isTie: false };
}


/**
 * Handles a clue request.
 * Uses the imported 'state'.
 */
export function requestClue() {
    if (!state.gameActive) {
        return { success: false, message: "El juego no está activo para pedir pistas." };
    }
    if (state.clueUsedThisGame) {
        return { success: false, message: "Ya usaste la pista para esta palabra." };
    }
    if (!state.currentWordObject || !state.currentWordObject.definition) {
        return { success: false, message: "No hay pista disponible para esta palabra." };
    }

    state.setClueUsedThisGame(true);
    // No cost for clue in this version, as per previous logic.
    // If a cost was introduced (e.g., losing an attempt):
    // const pid = state.currentPlayerId;
    // state.decAttemptsFor(pid);
    // const attemptsLeft = state.getAttemptsFor(pid);
    // const wordSolved = checkWinCondition(state);
    // const playerLost = attemptsLeft <= 0 && !wordSolved;
    // if (playerLost) state.setGameActive(false);

    return {
        success: true,
        clue: state.currentWordObject.definition,
        // gameOver: state.gameActive ? false : true // if clue cost could end game
    };
}