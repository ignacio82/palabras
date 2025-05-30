// pizarraState.js
/* =========================================================================
   Pizarra de Palabras – Reactive game-state container
   ========================================================================= */

// ---------- GAME CONSTANTS ----------
export const DEFAULT_PLAYER_COLORS = ['#FF69B4', '#00BFFF', '#FFD700', '#32CD32', '#FF7F50', '#DA70D6'];
export const AVAILABLE_ICONS = ['🦄', '🌈', '⭐', '🌸', '🦋', '🎀', '💖', '🌺', '✨', '🌟', '🧚‍♀️', '👑', '🍭', '🎈', '🌙']; // Updated for girl-friendly icons
export const MAX_PLAYERS_LOCAL = 4;
export const MAX_PLAYERS_NETWORK = 4;
export const MIN_PLAYERS_NETWORK = 2;

export const MAX_ATTEMPTS = 6; // Default max attempts for a player in a game
export const DEFAULT_ATTEMPTS_PER_PLAYER = MAX_ATTEMPTS; // Explicit constant for clarity
export const STAR_SYMBOL = "🌟";
export const ALPHABET = "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ".split('');
export const PIZARRA_PEER_ID_PREFIX = "pizarra-";

/* ----------  PRIVATE, MUTABLE MODULE-LEVEL STATE  ---------- */
// Core Gameplay State
let currentWord = '';
let currentWordObject = null;
let guessedLetters = new Set();
let remainingAttemptsPerPlayer  = []; // [attempts_p0, attempts_p1, ...]
let currentPlayerId = 0; // Game-specific ID of the current player (0, 1, 2...)
let gameActive = false; // General flag if a game (local or network) is in progress
let gamePhase = 'idle'; // 'idle' | 'lobby' | 'playing' | 'ended' | specific network states
let currentDifficulty = "easy";
let clueUsedThisGame = false;

// Network Play State
let pvpRemoteActive = false;
let myPeerId = null; // This client's raw PeerJS ID
let networkRoomData = {
    roomId: null, leaderPeerId: null, myPlayerIdInRoom: null, isRoomLeader: false,
    maxPlayers: MAX_PLAYERS_NETWORK, players: [], // Network player metadata { id, peerId, name, icon, color, isReady, isConnected, score }
    gameSettings: { difficulty: "easy" }, roomState: 'idle', turnCounter: 0,
    _peerInitPromise: null, _peerInitResolve: null, _peerInitReject: null,
    _setupCompleteCallback: null, _setupErrorCallback: null,
};
// Local Game Players Data (used by gameLogic when game is active)
let localPlayersData = []; // [{ id, name, icon, color, score }]


/* ----------  HELPERS  ---------- */
function clone(value) {
  try { return JSON.parse(JSON.stringify(value)); }
  catch (e) { console.warn("Clone failed for value:", value); return value; }
}

function normalizeStringInternal(str) {
    if (!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

/* ----------  PUBLIC SETTERS for Core Gameplay State ---------- */
export function setCurrentWordObject(obj) {
    currentWordObject = obj ? clone(obj) : null;
    if (currentWordObject && currentWordObject.word) {
        currentWord = normalizeStringInternal(currentWordObject.word);
    } else {
        currentWord = "";
    }
    // console.log(`[State] setCurrentWordObject. Word: ${currentWordObject?.word}, Normalized: ${currentWord}`);
}
export function setGuessedLetters(newSet) { guessedLetters = newSet instanceof Set ? new Set(newSet) : new Set(newSet || []); }

export function initRemainingAttempts(numPlayers, attempts = DEFAULT_ATTEMPTS_PER_PLAYER) {
  remainingAttemptsPerPlayer = Array(Math.max(1, numPlayers)).fill(attempts);
  console.log(`[State] Initialized remainingAttemptsPerPlayer for ${numPlayers} players with ${attempts} attempts:`, clone(remainingAttemptsPerPlayer));
}

export function setRemainingAttemptsPerPlayer(newArray) {
  if (Array.isArray(newArray)) {
    remainingAttemptsPerPlayer = Array.from(newArray); // Defensive copy
    console.log(`[State] Set remainingAttemptsPerPlayer:`, clone(remainingAttemptsPerPlayer));
  } else {
    console.error("[State] setRemainingAttemptsPerPlayer: Provided value is not an array.", newArray);
    // Optionally initialize if newArray is invalid but we know numPlayers
    // initRemainingAttempts(localPlayersData.length || networkRoomData.players.length || 1);
  }
}

export function decAttemptsFor(playerId) {
  if (playerId >= 0 && playerId < remainingAttemptsPerPlayer.length) {
    if (remainingAttemptsPerPlayer[playerId] > 0) {
        remainingAttemptsPerPlayer[playerId]--;
    }
    // console.log(`[State] Decremented attempts for player ${playerId}. Now: ${remainingAttemptsPerPlayer[playerId]}`);
  } else {
    // console.warn(`[State] decAttemptsFor: Invalid playerId ${playerId} for array of length ${remainingAttemptsPerPlayer.length}`);
  }
}

export function setGameActive(isActive) {
    gameActive = isActive;
    // Only change phase to 'ended' if we're explicitly ending a game that was playing
    if (!isActive && gamePhase === 'playing') {
        setGamePhase('ended');
    } else if (isActive && gamePhase !== 'playing') {
        setGamePhase('playing');
    }
    console.log(`[State] Game active set to: ${gameActive}, phase: ${gamePhase}`);
}
export function setCurrentDifficulty(difficultyStr) { currentDifficulty = difficultyStr; }
export function setClueUsedThisGame(wasUsed) { clueUsedThisGame = wasUsed; }

export function setPlayersData(newPlayers) {
  localPlayersData = newPlayers ? clone(newPlayers) : [];
  initRemainingAttempts(localPlayersData.length || 1); // Reset attempts based on current game players
  console.log("[State] setPlayersData (current game instance):", clone(localPlayersData));
}
export function setCurrentPlayerId(id) { currentPlayerId = id; }
export function setGamePhase(phase) {
    if (['idle', 'lobby', 'playing', 'ended', 'creating_room', 'connecting_to_lobby', 'awaiting_join_approval', 'seeking_match', 'game_over'].includes(phase)) {
        gamePhase = phase;
        console.log(`[State] Game phase set to: ${gamePhase}`);
    } else {
        console.warn(`[State] Attempted to set invalid game phase: ${phase}`);
    }
}

/* ----------  PUBLIC SETTERS for Network State ---------- */
export function setPvpRemoteActive(isActive) { pvpRemoteActive = isActive; }
export function setMyPeerId(id) { myPeerId = id; }
export function setNetworkRoomData(data) {
    const oldRoomState = networkRoomData.roomState;
    const preservedCallbacks = {
        _peerInitPromise: networkRoomData._peerInitPromise, _peerInitResolve: networkRoomData._peerInitResolve,
        _peerInitReject: networkRoomData._peerInitReject, _setupCompleteCallback: networkRoomData._setupCompleteCallback,
        _setupErrorCallback: networkRoomData._setupErrorCallback,
    };
    networkRoomData = { ...networkRoomData, ...data, ...preservedCallbacks }; // Apply preserved last to ensure they are not overwritten by spread of data if data also contains them as null
    if (data.hasOwnProperty('_peerInitPromise')) networkRoomData._peerInitPromise = data._peerInitPromise;
    if (data.hasOwnProperty('_peerInitResolve')) networkRoomData._peerInitResolve = data._peerInitResolve;
    if (data.hasOwnProperty('_peerInitReject')) networkRoomData._peerInitReject = data._peerInitReject;
    if (data.hasOwnProperty('_setupCompleteCallback')) networkRoomData._setupCompleteCallback = data._setupCompleteCallback;
    if (data.hasOwnProperty('_setupErrorCallback')) networkRoomData._setupErrorCallback = data._setupErrorCallback;
    if (data.roomState && data.roomState !== oldRoomState) {
        console.log(`[State] networkRoomData.roomState changed: ${oldRoomState} -> ${networkRoomData.roomState}`);
        // Only update game phase for network room state changes if we're in network mode
        if (pvpRemoteActive) {
            setGamePhase(data.roomState);
        }
    }
}
export function resetNetworkRoomData() {
    const preservedCallbacks = {
        _peerInitPromise: networkRoomData._peerInitPromise, _peerInitResolve: networkRoomData._peerInitResolve,
        _peerInitReject: networkRoomData._peerInitReject, _setupCompleteCallback: networkRoomData._setupCompleteCallback,
        _setupErrorCallback: networkRoomData._setupErrorCallback,
    };
    networkRoomData = {
        roomId: null, leaderPeerId: null, myPlayerIdInRoom: null, isRoomLeader: false,
        maxPlayers: MAX_PLAYERS_NETWORK, players: [],
        gameSettings: { difficulty: "easy" }, roomState: 'idle', turnCounter: 0,
        ...preservedCallbacks
    };
    if (!pvpRemoteActive) {
        setGamePhase('idle');
    }
}
export function addPlayerToNetworkRoom(player) {
    const existingPlayerIndex = networkRoomData.players.findIndex(p => p.peerId === player.peerId);
    if (existingPlayerIndex === -1) networkRoomData.players.push(clone(player));
    else networkRoomData.players[existingPlayerIndex] = { ...networkRoomData.players[existingPlayerIndex], ...clone(player) };
    networkRoomData.players.sort((a, b) => (a.id === undefined ? Infinity : a.id) - (b.id === undefined ? Infinity : b.id));
}
export function removePlayerFromNetworkRoom(peerIdToRemove) {
    const initialCount = networkRoomData.players.length;
    networkRoomData.players = networkRoomData.players.filter(p => p.peerId !== peerIdToRemove);
    if (networkRoomData.players.length < initialCount) console.log(`[State] Player ${peerIdToRemove} removed from network room.`);
}
export function updatePlayerInNetworkRoom(peerIdToUpdate, updates) {
    const playerIndex = networkRoomData.players.findIndex(p => p.peerId === peerIdToUpdate);
    if (playerIndex !== -1) networkRoomData.players[playerIndex] = { ...networkRoomData.players[playerIndex], ...clone(updates) };
}

/* ----------  PUBLIC GETTERS for Core Gameplay State ---------- */
export function getCurrentWord() { return currentWord; }
export function getCurrentWordObject() { return currentWordObject ? clone(currentWordObject) : null; }
export function getGuessedLetters() { return new Set(guessedLetters); }
export function getAttemptsFor(playerId) {
  if (playerId !== null && playerId !== undefined && playerId >= 0 && playerId < remainingAttemptsPerPlayer.length) {
    return remainingAttemptsPerPlayer[playerId];
  }
  // console.warn(`[State] getAttemptsFor: Invalid playerId ${playerId} or attempts array not ready. Returning MAX_ATTEMPTS.`);
  return MAX_ATTEMPTS; 
}

// NEW: Add the missing getter function
export function getRemainingAttemptsPerPlayer() {
  return [...remainingAttemptsPerPlayer]; // Return a copy to prevent external modification
}

export function getGameActive() { return gameActive; }
export function getCurrentDifficulty() { return currentDifficulty; }
export function getClueUsedThisGame() { return clueUsedThisGame; }
export function getPlayersData() { return clone(localPlayersData); }
export function getCurrentPlayerId() { return currentPlayerId; }
export function getGamePhase() { return gamePhase; }

/* ----------  PUBLIC GETTERS for Network State ---------- */
export function getPvpRemoteActive() { return pvpRemoteActive; }
export function getMyPeerId() { return myPeerId; }
export function getNetworkRoomData() { return getSanitizedNetworkRoomDataForClient(); }

/* ---------- Combined State Management Functions ---------- */
export function resetScores() {
    if (localPlayersData) localPlayersData.forEach(p => p.score = 0);
    if (networkRoomData?.players) networkRoomData.players.forEach(p => p.score = 0);
}
export function resetGameFlowState() {
    setCurrentWordObject(null); guessedLetters.clear();
    // remainingAttemptsPerPlayer is initialized by initRemainingAttempts,
    // which is called when setPlayersData is called or when a new game starts.
    clueUsedThisGame = false;
    if (pvpRemoteActive && networkRoomData) networkRoomData.turnCounter = 0;
    console.log(`[State] resetGameFlowState completed.`);
}
export function resetFullLocalStateForNewUIScreen() {
    resetGameFlowState(); resetScores();
    localPlayersData = []; currentPlayerId = 0; currentDifficulty = "easy";
    gameActive = false; remainingAttemptsPerPlayer = [];
    resetNetworkRoomData(); pvpRemoteActive = false; myPeerId = null;
    console.log("[State] resetFullLocalStateForNewUIScreen completed.");
}
export function normalizeString(str) { return normalizeStringInternal(str); }
export function getLocalPlayerCustomizationForNetwork() {
    const nameEl = document.getElementById(`network-player-name`);
    const iconEl = document.getElementById(`network-player-icon`);
    const name = nameEl?.value.trim() || `Pizarrín${Math.floor(Math.random()*100)}`;
    const icon = iconEl?.value || AVAILABLE_ICONS[0];
    let colorIndex = 0;
    if (networkRoomData?.players?.length > 0) colorIndex = networkRoomData.players.length % DEFAULT_PLAYER_COLORS.length;
    return { name, icon, color: DEFAULT_PLAYER_COLORS[colorIndex] };
}
export function getSanitizedNetworkRoomDataForClient() {
    if (!networkRoomData) return {};
    const { _peerInitPromise, _peerInitResolve, _peerInitReject, _setupCompleteCallback, _setupErrorCallback, ...sanitizedData } = networkRoomData;
    return clone(sanitizedData);
}
export function logCurrentState(context = "Generic") {
    console.log(`--- CURRENT GAME STATE (${context}) ---`);
    console.log("Difficulty:", currentDifficulty, "Game Active:", gameActive, "Game Phase:", gamePhase);
    console.log("Word Object:", currentWordObject ? currentWordObject.word : "N/A", "Norm Word:", currentWord);
    console.log("Attempts Left (per player):", clone(remainingAttemptsPerPlayer));
    console.log("Clue Used:", clueUsedThisGame);
    console.log("Guessed Letters:", Array.from(guessedLetters).join(', '));
    console.log("Players Data (Game Instance):", clone(localPlayersData));
    console.log("Current Player ID (Game Instance):", currentPlayerId);
    console.log("--- NETWORK STATE ---");
    console.log("PVP Remote Active:", pvpRemoteActive);
    console.log("My Peer ID:", myPeerId);
    console.log("Network Room Data (Sanitized):", getSanitizedNetworkRoomDataForClient());
    console.log("------------------------");
}

// No direct 'let' exports for mutable state to prevent read-only assignment errors.
// All state access and mutation should go through exported functions (getters/setters).