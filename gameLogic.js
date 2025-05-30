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
    let playersToInit = stateRef.getPlayersData(); // This is localPlayersData in state
    if (stateRef.getPvpRemoteActive()) { // If network game, use players from networkRoomData
        playersToInit = stateRef.getNetworkRoomData().players;
    }


    if (playersToInit && playersToInit.length > 0) {
        stateRef.initRemainingAttempts(playersToInit.length);
         // Ensure scores are reset for these players
        playersToInit.forEach(p => p.score = 0);
        if (stateRef.getPvpRemoteActive()) {
            stateRef.setNetworkRoomData({ players: [...playersToInit] }); // Update network state if modified
        } else {
            stateRef.setPlayersData([...playersToInit]); // Update local state
        }
    } else {
        stateRef.initRemainingAttempts(1); 
        if (playersToInit.length === 0) { 
             const defaultPlayer = {id: 0, name: "Jugador 1", icon: "✏️", color: state.DEFAULT_PLAYER_COLORS[0], score: 0};
            if (stateRef.getPvpRemoteActive()) {
                // This case should ideally not happen if hostNewRoom sets up the host player
                stateRef.setNetworkRoomData({ players: [defaultPlayer] });
            } else {
                stateRef.setPlayersData([defaultPlayer]);
            }
            stateRef.setCurrentPlayerId(0);
        }
    }
    
    stateRef.setGameActive(true);
    const guessedLetters = stateRef.getGuessedLetters(); // Should be empty from resetGameFlowState
    // guessedLetters.clear(); // Already cleared in resetGameFlowState
    // stateRef.setGuessedLetters(guessedLetters); 
    // stateRef.setClueUsedThisGame(false); // Already cleared in resetGameFlowState

    console.log(`[GameLogic] Game initialized. Word: ${stateRef.getCurrentWordObject()?.word}, Difficulty: ${difficulty}, CurrentPlayerID: ${stateRef.getCurrentPlayerId()}`);
    return { success: true, currentWordObject: stateRef.getCurrentWordObject() };
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

    const currentDifficulty = stateRef.getCurrentDifficulty();
    const availableWords = DICTIONARY_DATA.filter(item => item.difficulty === currentDifficulty);

    if (availableWords.length === 0) {
        console.warn(`GAME LOGIC: No hay palabras para la dificultad: ${currentDifficulty}`);
        stateRef.setCurrentWordObject(null);
        return false;
    }

    const randomIndex = Math.floor(Math.random() * availableWords.length);
    const selectedWordObj = availableWords[randomIndex];
    stateRef.setCurrentWordObject(selectedWordObj); 
    return true;
}

/**
 * Processes a player's letter guess.
 * Directly uses the imported 'state' module.
 */
export function processGuess(letter) {
    if (!state.getGameActive()) {
         return {
            letter: normalizeLetter(letter), 
            correct: false,
            affectedPlayerId: state.getCurrentPlayerId(),
            attemptsLeft: state.getAttemptsFor(state.getCurrentPlayerId()),
            guessedLetters: Array.from(state.getGuessedLetters()),
            nextPlayerId: state.getCurrentPlayerId(),
            wordSolved: false,
            gameOver: true, 
            error: "El juego no está activo."
        };
    }

    const l = normalizeLetter(letter); // Normalized, lowercase letter
    const affectedPlayerId = state.getCurrentPlayerId(); 
    const guessedLetters = state.getGuessedLetters(); // Set of normalized, lowercase letters

    console.log(`[GameLogic] Processing guess: ${l}, Current word: ${state.getCurrentWord()}, Already guessed: ${Array.from(guessedLetters)}`);

    if (guessedLetters.has(l)) {
        return {
            letter: l,
            correct: state.getCurrentWord().toLowerCase().includes(l), 
            alreadyGuessed: true,
            affectedPlayerId: affectedPlayerId,
            attemptsLeft: state.getAttemptsFor(affectedPlayerId),
            guessedLetters: Array.from(guessedLetters),
            nextPlayerId: affectedPlayerId, 
            wordSolved: checkWinCondition(),
            gameOver: state.getAttemptsFor(affectedPlayerId) <= 0 && !checkWinCondition()
        };
    }

    guessedLetters.add(l); 
    state.setGuessedLetters(guessedLetters); 

    const currentWordNormalized = state.getCurrentWord().toLowerCase(); // Normalized current word for checking
    const wasCorrect = currentWordNormalized.includes(l);
    let attemptsLeftForPlayer = state.getAttemptsFor(affectedPlayerId);

    if (!wasCorrect) {
        state.decAttemptsFor(affectedPlayerId);
        attemptsLeftForPlayer = state.getAttemptsFor(affectedPlayerId); 
    }

    const wordSolved = checkWinCondition();
    const playerLostThisWord = attemptsLeftForPlayer <= 0 && !wordSolved; // Player specific loss for this word
    
    // Game Over condition: either word is solved OR the current player has lost AND no other players can continue (single player)
    // In multiplayer, game over is more complex (e.g., all players lost, or host decides).
    // For now, processGuess determines if THIS guess makes the game end for THIS player or solves word.
    // The actual game over state for multiplayer is managed by pizarraPeerConnection based on these results.
    const gameIsOver = wordSolved || playerLostThisWord; // Simplified: if word is solved, game ends. If player loses, and it's single player, game ends.

    console.log(`[GameLogic] Letter ${l} is ${wasCorrect ? 'correct' : 'incorrect'}. Word solved: ${wordSolved}, Player ${affectedPlayerId} lost this word: ${playerLostThisWord}`);

    if (gameIsOver && !state.getPvpRemoteActive()) { // Only set game inactive for local game based on this logic directly
        state.setGameActive(false);
    }


    if (wordSolved) {
        // Update score for the current player if word is solved
        // This needs to handle both localPlayersData and networkRoomData.players
        let playersListToUpdate;
        if (state.getPvpRemoteActive()) {
            playersListToUpdate = state.getRawNetworkRoomData().players; // Get mutable list for host
        } else {
            playersListToUpdate = state.getPlayersData(); // Get copy for local
        }
        
        const currentPlayerInList = playersListToUpdate.find(p => p.id === affectedPlayerId);
        if (currentPlayerInList) {
            currentPlayerInList.score = (currentPlayerInList.score || 0) + 1;
            if (state.getPvpRemoteActive()) {
                state.setNetworkRoomData({ players: [...playersListToUpdate] }); // Host updates its state
            } else {
                state.setPlayersData([...playersListToUpdate]); // Local game updates its state
            }
        }
    }

    let nextPlayerId;
    const playersInGame = state.getPvpRemoteActive() ? state.getNetworkRoomData().players : state.getPlayersData();
    
    if (playersInGame.length === 0) {
        console.error("[GameLogic] No players found for next player logic!");
        nextPlayerId = 0; // Fallback, should not happen
    } else if (wordSolved || playerLostThisWord && playersInGame.length === 1) { // If solved, or single player loses
        nextPlayerId = -1; // Indicates game should end or pause for "Game Over"
    } else {
        // Standard turn progression: find current player index, go to next, wrap around.
        const currentPlayerIndex = playersInGame.findIndex(p => p.id === affectedPlayerId);
        if (currentPlayerIndex === -1) {
            console.error(`[GameLogic] Current player ID ${affectedPlayerId} not found in players list.`);
            nextPlayerId = playersInGame[0].id; // Default to first player
        } else {
            nextPlayerId = playersInGame[(currentPlayerIndex + 1) % playersInGame.length].id;
        }
    }
    
    // If game became inactive due to this guess (e.g. local player lost)
    if (!state.getGameActive() && !wordSolved) { // If game is over and not because word was solved
         nextPlayerId = -1; // ensure nextPlayerId reflects game end
    }


    return {
        letter: l,
        correct: wasCorrect,
        affectedPlayerId: affectedPlayerId,
        attemptsLeft: attemptsLeftForPlayer, // Attempts left for the affected player
        guessedLetters: Array.from(state.getGuessedLetters()), // Current set of all guessed letters
        nextPlayerId: nextPlayerId, // ID of the next player to play
        wordSolved: wordSolved,
        gameOver: gameIsOver, // True if this guess resulted in word solved OR current player losing their last attempt
        scores: (state.getPvpRemoteActive() ? state.getNetworkRoomData().players : state.getPlayersData()).map(p => ({id: p.id, score: p.score}))
    };
}

/**
 * Checks if the current word has been completely guessed.
 * Uses the imported 'state'.
 */
export function checkWinCondition() {
    const currentWord = state.getCurrentWord(); // Normalized, uppercase
    if (!currentWord) {
        // console.log("[GameLogic] checkWinCondition: No current word");
        return false;
    }
    
    const guessedLetters = state.getGuessedLetters(); // Set of normalized, lowercase letters
    // console.log(`[GameLogic] checkWinCondition: Word "${currentWord}", Guessed letters: [${Array.from(guessedLetters).join(', ')}]`);
    
    for (const letter of currentWord) { // letter is like 'M', 'A', 'Ñ'
        const normalizedLetterFromWord = normalizeLetter(letter); // Convert to lowercase, keep ñ
        if (!guessedLetters.has(normalizedLetterFromWord)) {
            // console.log(`[GameLogic] checkWinCondition: Missing letter "${letter}" (normalized: "${normalizedLetterFromWord}") - word not solved`);
            return false;
        }
    }
    
    // console.log("[GameLogic] checkWinCondition: All letters found - word solved!");
    return true;
}


export function checkLossConditionForPlayer(playerId) {
    return state.getAttemptsFor(playerId) <= 0;
}


export function getWinnerData(stateRef) { // stateRef is the main state module
    const players = stateRef.getPvpRemoteActive() ? stateRef.getNetworkRoomData().players : stateRef.getPlayersData();
    if (!players || players.length === 0) {
        return { winners: [], isTie: false, reason: "No player data." };
    }

    const wordWasSolved = checkWinCondition(); // Check against the current state

    if (wordWasSolved) {
        // If word solved, current player (who made the winning guess) is the primary winner for this round.
        // Or, if multiple players contributed and solved it, it's more complex.
        // Simplified: player whose turn it was when solved.
        const winner = players.find(p => p.id === stateRef.getCurrentPlayerId());
        return { 
            winners: winner ? [winner] : (players.length > 0 ? [players[0]] : []), // Fallback
            isTie: false,
            reason: `Palabra '${stateRef.getCurrentWordObject()?.word}' resuelta.`
        };
    }

    // If word not solved, game might end due to other reasons (e.g., host ends, disconnects)
    // Or, if all players run out of attempts. This needs a more robust check.
    // For now, let's assume game over implies we need to find highest score.
    // This function is typically called when the game is already declared over.

    const maxScore = Math.max(...players.map(p => p.score || 0));
    const topScorers = players.filter(p => (p.score || 0) === maxScore);
    
    if (topScorers.length === 0 && players.length > 0) { // No one scored, but players exist
        return { winners: [], isTie: false, reason: "Nadie puntuó."};
    }
    if (topScorers.length === 1) {
        return { winners: topScorers, isTie: false, reason: "Puntuación más alta." };
    } 
    if (topScorers.length > 1) {
        // Tie-breaker: if multiple players have max score, it's a tie among them.
        // (Original logic had attempts remaining as tie-breaker, but scores are usually final)
        return { 
            winners: topScorers, 
            isTie: true,
            reason: "Empate en puntuación." 
        };
    }

    return { winners: [], isTie: false, reason: "No se determinó ganador." }; // Fallback
}


/**
 * Handles a clue request.
 * Uses the imported 'state'.
 */
export function requestClue() { // state module is directly imported
    if (!state.getGameActive()) {
        return { success: false, message: "El juego no está activo para pedir pistas." };
    }
    if (state.getClueUsedThisGame()) {
        return { success: false, message: "Ya usaste la pista para esta palabra." };
    }
    const currentWordObject = state.getCurrentWordObject();
    if (!currentWordObject || !currentWordObject.definition) {
        return { success: false, message: "No hay pista disponible para esta palabra." };
    }

    state.setClueUsedThisGame(true);
    // No direct cost for clue in this version (e.g. losing an attempt) in gameLogic.
    // If a cost is applied (e.g. by host), pizarraPeerConnection would handle state changes.
    // For local game, no attempt cost for clue.

    return {
        success: true,
        clue: currentWordObject.definition,
        // No gameOver check here, clue request itself doesn't end game in this model
    };
}