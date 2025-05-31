// gameLogic.js

import * as state from './pizarraState.js';
import { normalizeLetter } from './util.js';

// Assuming DICTIONARY_DATA is globally available from dictionary.js

export function initializeGame(stateRef, difficulty) {
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
        // console.warn("[GameLogic] No playersData found during init, creating default player.");
        const defaultPlayer = {id: 0, name: "Jugador", icon: "✏️", color: state.DEFAULT_PLAYER_COLORS[0], score: 0, isConnected: true };
        stateRef.setPlayersData([defaultPlayer]); // This will also update networkRoomData.players if PVP active
        playersToInit = stateRef.getPlayersData(); // Re-fetch after setting
        stateRef.setCurrentPlayerId(0);
    }
    
    stateRef.initRemainingAttempts(playersToInit.length);
    
    const playersWithResetScores = playersToInit.map(p => ({ ...p, score: 0 }));
    stateRef.setPlayersData(playersWithResetScores);

    if (playersWithResetScores.length > 0) {
        stateRef.setCurrentPlayerId(playersWithResetScores[0].id);
    } else {
        stateRef.setCurrentPlayerId(0); // Fallback
    }
    
    stateRef.setGameActive(true);
    
    // console.log(`[GameLogic] Game initialized. Word: ${stateRef.getCurrentWordObject()?.word}, Difficulty: ${difficulty}, CurrentPlayerID: ${stateRef.getCurrentPlayerId()}, Players:`, stateRef.getPlayersData());
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
    return true;
}

export function processGuess(letter) {
    const affectedPlayerId = state.getCurrentPlayerId();

    if (!state.getGameActive()) {
         // console.warn("[GameLogic] processGuess: Game not active. Returning error state.");
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

    const playersInGame = state.getPvpRemoteActive() ? state.getRawNetworkRoomData().players : state.getPlayersData();
    const activePlayers = playersInGame.filter(p => p.isConnected !== false && state.getAttemptsFor(p.id) > 0);

    if (!wordSolved && activePlayers.length === 0) {
        gameIsOver = true;
    }
    
    if (gameIsOver && !state.getPvpRemoteActive()) {
        state.setGameActive(false);
    }

    if (wordSolved) {
        let playersListToUpdate = state.getPvpRemoteActive() ? state.getRawNetworkRoomData().players : state.getPlayersData();
        const playerToGetScore = playersListToUpdate.find(p => p.id === affectedPlayerId);
        if (playerToGetScore) {
            playerToGetScore.score = (playerToGetScore.score || 0) + 1;
            if(state.getPvpRemoteActive()){
                 // Host will call setNetworkRoomData
            } else {
                state.setPlayersData(playersListToUpdate);
            }
        }
    }

    let nextPlayerId = affectedPlayerId;
    if (state.getGameActive() && !wordSolved && playersInGame.length > 0) {
        const connectedPlayers = playersInGame.filter(p => p.isConnected !== false);
        if (connectedPlayers.length > 0) {
            const currentPlayerIndexInConnected = connectedPlayers.findIndex(p => p.id === affectedPlayerId);
            
            if (currentPlayerIndexInConnected !== -1) {
                let attemptsToFindNext = connectedPlayers.length;
                let nextPlayerIndex = (currentPlayerIndexInConnected + 1) % connectedPlayers.length;
                
                while(attemptsToFindNext > 0 && state.getAttemptsFor(connectedPlayers[nextPlayerIndex].id) <= 0) {
                    nextPlayerIndex = (nextPlayerIndex + 1) % connectedPlayers.length;
                    attemptsToFindNext--;
                }

                if (state.getAttemptsFor(connectedPlayers[nextPlayerIndex].id) > 0) {
                    nextPlayerId = connectedPlayers[nextPlayerIndex].id;
                } else {
                    nextPlayerId = -1; 
                    if(!gameIsOver) gameIsOver = true;
                }
            } else {
                // console.warn(`[GameLogic] Current player ID ${affectedPlayerId} not found in connected players list for turn rotation.`);
                if (connectedPlayers.length > 0 && state.getAttemptsFor(connectedPlayers[0].id) > 0) {
                     nextPlayerId = connectedPlayers[0].id;
                } else {
                    nextPlayerId = -1;
                    if(!gameIsOver) gameIsOver = true;
                }
            }
        } else {
            // console.warn("[GameLogic] No connected players found for turn rotation.");
            nextPlayerId = -1;
            if(!gameIsOver) gameIsOver = true;
        }
    } else if (wordSolved || !state.getGameActive()) {
        nextPlayerId = -1;
    }
    
    if (nextPlayerId !== -1 && nextPlayerId !== affectedPlayerId) {
        state.setCurrentPlayerId(nextPlayerId);
    } else if (nextPlayerId === -1) {
        // Turn does not advance
    }

    return {
        letter: l,
        correct: wasCorrect,
        alreadyGuessed: false,
        affectedPlayerId: affectedPlayerId,
        attemptsLeft: attemptsLeftForPlayer,
        guessedLetters: Array.from(state.getGuessedLetters()),
        nextPlayerId: state.getCurrentPlayerId(),
        wordSolved: wordSolved,
        gameOver: gameIsOver,
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
        const winner = players.find(p => p.id === stateRef.getCurrentPlayerId());
        return {
            winners: winner ? [winner] : (players.length > 0 && players.some(p=>p.score > 0) ? players.filter(p=>p.score === Math.max(...players.map(pl=>pl.score || 0))) : []),
            isTie: winner ? false : (players.length > 0 && players.some(p=>p.score > 0) ? players.filter(p=>p.score === Math.max(...players.map(pl=>pl.score || 0))).length > 1 : false),
            reason: `Palabra '${stateRef.getCurrentWordObject()?.word}' resuelta.`
        };
    }

    const activePlayersWithAttempts = players.filter(p => p.isConnected !== false && stateRef.getAttemptsFor(p.id) > 0);
    if (activePlayersWithAttempts.length === 0 && !wordWasSolved) {
         return { winners: [], isTie: false, reason: "Todos los jugadores perdieron sus intentos." };
    }
    
    const maxScore = Math.max(0, ...players.map(p => p.score || 0));
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
    
    return {
        success: true,
        clue: currentWordObject.definition,
    };
}