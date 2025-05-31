// gameLogic.js

import * as state from './pizarraState.js';
import { normalizeLetter } from './util.js'; 

// Assuming DICTIONARY_DATA is globally available from dictionary.js

export function initializeGame(stateRef, difficulty) {
    // console.log(`[GameLogic] initializeGame called. Difficulty: ${difficulty}`);
    stateRef.resetGameFlowState();
    stateRef.setCurrentDifficulty(difficulty);

    const wordSelected = selectNewWord(stateRef);
    if (!wordSelected) {
        stateRef.setGameActive(false); 
        console.error(`[GameLogic] No words found for difficulty '${difficulty}'.`);
        return { success: false, message: `No hay palabras para la dificultad '${difficulty}'.` };
    }

    let playersToInit = [];
    if (stateRef.getPvpRemoteActive()) { 
        playersToInit = stateRef.getRawNetworkRoomData().players; // Get players from network state
    } else {
        playersToInit = stateRef.getPlayersData(); // Get players from local state
    }

    if (!playersToInit || playersToInit.length === 0) {
        console.warn("[GameLogic] No playersData found during init, creating default player.");
        const defaultPlayer = {id: 0, name: "Jugador", icon: "✏️", color: state.DEFAULT_PLAYER_COLORS[0], score: 0, isConnected: true };
        stateRef.setPlayersData([defaultPlayer]); // This will also update networkRoomData.players if PVP active
        playersToInit = stateRef.getPlayersData(); // Re-fetch after setting
        stateRef.setCurrentPlayerId(0);
    }
    
    // console.log("[GameLogic] Initializing attempts for players:", playersToInit);
    stateRef.initRemainingAttempts(playersToInit.length);
    
    // Reset scores for all players at the start of a new game
    const playersWithResetScores = playersToInit.map(p => ({ ...p, score: 0 }));
    stateRef.setPlayersData(playersWithResetScores); // This updates both localPlayersData and networkRoomData.players

    // Determine starting player - typically player 0 unless specific logic dictates otherwise
    if (playersWithResetScores.length > 0) {
        stateRef.setCurrentPlayerId(playersWithResetScores[0].id); // Start with the first player in the (potentially sorted) list
    } else {
        stateRef.setCurrentPlayerId(0); // Fallback
    }
    
    stateRef.setGameActive(true);
    
    console.log(`[GameLogic] Game initialized. Word: ${stateRef.getCurrentWordObject()?.word}, Difficulty: ${difficulty}, CurrentPlayerID: ${stateRef.getCurrentPlayerId()}, Players:`, stateRef.getPlayersData());
    return { success: true, currentWordObject: stateRef.getCurrentWordObject() };
}

export function selectNewWord(stateRef) {
    if (typeof DICTIONARY_DATA === 'undefined' || DICTIONARY_DATA.length === 0) {
        console.error("[GameLogic] CRITICAL: DICTIONARY_DATA not loaded or empty!");
        stateRef.setCurrentWordObject(null);
        return false;
    }

    const currentDifficulty = stateRef.getCurrentDifficulty();
    const availableWords = DICTIONARY_DATA.filter(item => item.difficulty === currentDifficulty);

    if (availableWords.length === 0) {
        console.warn(`[GameLogic] No words available for difficulty: ${currentDifficulty}`);
        stateRef.setCurrentWordObject(null);
        return false;
    }

    const randomIndex = Math.floor(Math.random() * availableWords.length);
    const selectedWordObj = availableWords[randomIndex];
    stateRef.setCurrentWordObject(selectedWordObj); 
    // console.log(`[GameLogic] New word selected: ${selectedWordObj.word} (Difficulty: ${currentDifficulty})`);
    return true;
}

export function processGuess(letter) {
    const affectedPlayerId = state.getCurrentPlayerId(); // Player whose turn it was
    // console.log(`[GameLogic] processGuess: Letter '${letter}', PlayerID '${affectedPlayerId}', Current Word: '${state.getCurrentWord()}'`);

    if (!state.getGameActive()) {
         console.warn("[GameLogic] processGuess: Game not active. Returning error state.");
         return {
            letter: normalizeLetter(letter), 
            correct: false,
            affectedPlayerId: affectedPlayerId,
            attemptsLeft: state.getAttemptsFor(affectedPlayerId),
            guessedLetters: Array.from(state.getGuessedLetters()),
            nextPlayerId: affectedPlayerId, 
            wordSolved: false,
            gameOver: true, 
            error: "El juego no está activo."
        };
    }

    const l = normalizeLetter(letter); 
    const guessedLetters = state.getGuessedLetters(); 

    if (guessedLetters.has(l)) {
        // console.log(`[GameLogic] Letter '${l}' already guessed.`);
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

    const currentWordNormalized = state.getCurrentWord().toLowerCase(); 
    const wasCorrect = currentWordNormalized.includes(l);
    let attemptsLeftForPlayer = state.getAttemptsFor(affectedPlayerId);

    if (!wasCorrect) {
        state.decAttemptsFor(affectedPlayerId);
        attemptsLeftForPlayer = state.getAttemptsFor(affectedPlayerId); 
    }

    const wordSolved = checkWinCondition();
    const playerLostThisWord = attemptsLeftForPlayer <= 0 && !wordSolved; 
    
    let gameIsOver = wordSolved || playerLostThisWord; 

    // If it's a single-player game (local or network with 1 player), playerLostThisWord means game over.
    // In multiplayer, game continues until all players lose or word is solved.
    // For now, this 'gameIsOver' reflects immediate end conditions from this guess.
    // The host will ultimately decide true "game over" in network play.
    const playersInGame = state.getPvpRemoteActive() ? state.getRawNetworkRoomData().players : state.getPlayersData();
    const activePlayers = playersInGame.filter(p => p.isConnected !== false && state.getAttemptsFor(p.id) > 0);

    if (!wordSolved && activePlayers.length === 0) { // All active players ran out of attempts
        console.log("[GameLogic] All active players have run out of attempts and word not solved. Setting gameIsOver=true.");
        gameIsOver = true;
    }
    
    // console.log(`[GameLogic] Letter ${l} is ${wasCorrect ? 'correct' : 'incorrect'}. Word solved: ${wordSolved}, Player ${affectedPlayerId} lost this word: ${playerLostThisWord}, Overall gameIsOver: ${gameIsOver}`);

    if (gameIsOver && !state.getPvpRemoteActive()) { 
        state.setGameActive(false);
    }
    // In PVP, host controls gameActive state via network messages based on these results.

    if (wordSolved) {
        let playersListToUpdate = state.getPvpRemoteActive() ? state.getRawNetworkRoomData().players : state.getPlayersData();
        const playerToGetScore = playersListToUpdate.find(p => p.id === affectedPlayerId);
        if (playerToGetScore) {
            playerToGetScore.score = (playerToGetScore.score || 0) + 1;
            // The state update will be done via setNetworkRoomData by the host after broadcasting
            // or directly by setPlayersData for local games.
            // For now, we ensure the local copy of players (if used by host) is updated.
            // If this is called by host, this modifies a clone from getRawNetworkRoomData(),
            // host needs to commit this via setNetworkRoomData.
            // If local, this modifies a clone from getPlayersData(), needs setPlayersData.
            // This function primarily returns the result; state persistence is slightly outside.
            // However, to ensure consistency for the *next turn* logic, we update the state used by getPlayersData()
            if(state.getPvpRemoteActive()){
                 // The host will call setNetworkRoomData which internally updates players
            } else {
                state.setPlayersData(playersListToUpdate);
            }
        }
    }

    // --- NEW: Turn progression logic (AI's suggestion) ---
    let nextPlayerId = affectedPlayerId; // Default to same player if no change
    if (state.getGameActive() && !wordSolved && playersInGame.length > 0) { // Only switch if game is ongoing and word not solved
        const connectedPlayers = playersInGame.filter(p => p.isConnected !== false); // Consider only connected players for turn rotation
        if (connectedPlayers.length > 0) {
            // Find current player's index among *connected* players
            const currentPlayerIndexInConnected = connectedPlayers.findIndex(p => p.id === affectedPlayerId);
            
            if (currentPlayerIndexInConnected !== -1) {
                // Try to find the next connected player who still has attempts
                let attemptsToFindNext = connectedPlayers.length; // Max attempts to find next player
                let nextPlayerIndex = (currentPlayerIndexInConnected + 1) % connectedPlayers.length;
                
                while(attemptsToFindNext > 0 && state.getAttemptsFor(connectedPlayers[nextPlayerIndex].id) <= 0) {
                    nextPlayerIndex = (nextPlayerIndex + 1) % connectedPlayers.length;
                    attemptsToFindNext--;
                }

                if (state.getAttemptsFor(connectedPlayers[nextPlayerIndex].id) > 0) { // Found a valid next player
                    nextPlayerId = connectedPlayers[nextPlayerIndex].id;
                } else { // No player with attempts left (should also mean gameIsOver is true)
                    console.log("[GameLogic] No connected players with attempts left. Game should be over.");
                    nextPlayerId = -1; // Or handle as game over
                    if(!gameIsOver) gameIsOver = true; // Force game over if not already set
                }
            } else {
                console.warn(`[GameLogic] Current player ID ${affectedPlayerId} not found in connected players list for turn rotation. Defaulting to first connected player.`);
                if (connectedPlayers.length > 0 && state.getAttemptsFor(connectedPlayers[0].id) > 0) {
                     nextPlayerId = connectedPlayers[0].id;
                } else {
                    nextPlayerId = -1; // No valid player
                    if(!gameIsOver) gameIsOver = true;
                }
            }
        } else {
            console.warn("[GameLogic] No connected players found for turn rotation.");
            nextPlayerId = -1; // No one to pass turn to
            if(!gameIsOver) gameIsOver = true;
        }
    } else if (wordSolved || !state.getGameActive()) { // If word solved or game became inactive
        nextPlayerId = -1; // No next player, game ends or pauses
    }
    
    if (nextPlayerId !== -1 && nextPlayerId !== affectedPlayerId) {
        console.log(`[GameLogic] Advancing turn from player ${affectedPlayerId} to ${nextPlayerId}`);
        state.setCurrentPlayerId(nextPlayerId);
    } else if (nextPlayerId === -1) {
        console.log(`[GameLogic] Turn does not advance, game ended or no valid next player. Next Player ID set to -1.`);
        // state.setCurrentPlayerId(affectedPlayerId); // Or keep current player, game will be marked inactive
    }


    return {
        letter: l,
        correct: wasCorrect,
        alreadyGuessed: false, // This path is for new guesses
        affectedPlayerId: affectedPlayerId,
        attemptsLeft: attemptsLeftForPlayer, 
        guessedLetters: Array.from(state.getGuessedLetters()), 
        nextPlayerId: state.getCurrentPlayerId(), // Return the *new* current player ID from state
        wordSolved: wordSolved,
        gameOver: gameIsOver, 
        // Scores are now part of the FULL_GAME_STATE, not typically sent with each guess result message
        // scores: (state.getPvpRemoteActive() ? state.getRawNetworkRoomData().players : state.getPlayersData()).map(p => ({id: p.id, score: p.score}))
    };
}

export function checkWinCondition() {
    const currentWord = state.getCurrentWord(); 
    if (!currentWord) return false;    
    const guessedLettersSet = state.getGuessedLetters(); 
    for (const letter of currentWord) { 
        const normalizedLetterFromWord = normalizeLetter(letter); 
        if (!guessedLettersSet.has(normalizedLetterFromWord)) {
            return false;
        }
    }
    return true;
}

export function checkLossConditionForPlayer(playerId) {
    return state.getAttemptsFor(playerId) <= 0;
}

export function getWinnerData(stateRef) { 
    const players = stateRef.getPvpRemoteActive() ? stateRef.getRawNetworkRoomData().players : stateRef.getPlayersData();
    if (!players || players.length === 0) {
        return { winners: [], isTie: false, reason: "No player data." };
    }

    const wordWasSolved = checkWinCondition(); 

    if (wordWasSolved) {
        const winner = players.find(p => p.id === stateRef.getCurrentPlayerId()); // Player whose turn it was
        return { 
            winners: winner ? [winner] : (players.length > 0 && players.some(p=>p.score > 0) ? players.filter(p=>p.score === Math.max(...players.map(pl=>pl.score || 0))) : []), 
            isTie: winner ? false : (players.length > 0 && players.some(p=>p.score > 0) ? players.filter(p=>p.score === Math.max(...players.map(pl=>pl.score || 0))).length > 1 : false),
            reason: `Palabra '${stateRef.getCurrentWordObject()?.word}' resuelta.`
        };
    }

    // If word not solved, game ended due to other reasons (e.g., all players lost attempts)
    const activePlayersWithAttempts = players.filter(p => p.isConnected !== false && stateRef.getAttemptsFor(p.id) > 0);
    if (activePlayersWithAttempts.length === 0 && !wordWasSolved) { // All players lost
         return { winners: [], isTie: false, reason: "Todos los jugadores perdieron sus intentos." };
    }
    
    // Fallback if game ends for other reasons (e.g. disconnect, host ends early) - find highest score
    const maxScore = Math.max(0, ...players.map(p => p.score || 0)); // Ensure maxScore is at least 0
    if (maxScore > 0) {
        const topScorers = players.filter(p => (p.score || 0) === maxScore);
        if (topScorers.length === 1) {
            return { winners: topScorers, isTie: false, reason: "Puntuación más alta." };
        } 
        if (topScorers.length > 1) {
            return { winners: topScorers, isTie: true, reason: "Empate en puntuación." };
        }
    }

    return { winners: [], isTie: false, reason: "No se determinó ganador." }; 
}

export function requestClue() { 
    // console.log("[GameLogic] requestClue called.");
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
    // console.log("[GameLogic] Clue used. Definition:", currentWordObject.definition);
    
    // Requesting a clue does not advance the turn in this model.
    return {
        success: true,
        clue: currentWordObject.definition,
    };
}