// pizarraState.js
/* =========================================================================
   Pizarra de Palabras – Reactive game-state container
   ========================================================================= */

// ---------- GAME CONSTANTS ----------
export const DEFAULT_PLAYER_COLORS = ['#FF69B4', '#00BFFF', '#FFD700', '#32CD32', '#FF7F50', '#DA70D6'];
export const AVAILABLE_ICONS = ['🦄', '🌈', '⭐', '🌸', '🦋', '🎀', '💖', '🌺', '✨', '🌟', '🧚‍♀️', '👑', '🍭', '🎈', '🌙'];
export const MAX_PLAYERS_LOCAL = 4;
export const MAX_PLAYERS_NETWORK = 4;
export const MIN_PLAYERS_NETWORK = 2;

export const MAX_ATTEMPTS = 6; 
export const DEFAULT_ATTEMPTS_PER_PLAYER = MAX_ATTEMPTS; 
export const STAR_SYMBOL = "🌟";
export const ALPHABET = "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ".split('');
export const PIZARRA_PEER_ID_PREFIX = "pizarra-";

/* ----------  PRIVATE, MUTABLE MODULE-LEVEL STATE  ---------- */
// Core Gameplay State
let currentWord = '';
let currentWordObject = null;
let guessedLetters = new Set();
let remainingAttemptsPerPlayer  = []; 
let currentPlayerId = 0; 
let gameActive = false; 
let gamePhase = 'idle'; // 'idle' | 'lobby' | 'playing' | 'ended' | 'creating_room' | 'connecting_to_lobby' | 'awaiting_join_approval' | 'seeking_match' | 'game_over'
let currentDifficulty = "easy";
let clueUsedThisGame = false;

// Network Play State
let pvpRemoteActive = false;
let myPeerId = null; 
// This is the authoritative source for network state, especially for the host.
// Clients receive a sanitized version.
let networkRoomData = {
    roomId: null, leaderPeerId: null, myPlayerIdInRoom: null, isRoomLeader: false,
    maxPlayers: MAX_PLAYERS_NETWORK, players: [], 
    gameSettings: { difficulty: "easy" }, roomState: 'idle', turnCounter: 0,
    // Internal flags for async setup, not meant to be part of general state sync for clients
    _peerInitPromise: null, _peerInitResolve: null, _peerInitReject: null,
    _setupCompleteCallback: null, _setupErrorCallback: null,
};
// Local Game Players Data (used by gameLogic when game is active, or for single player)
let localPlayersData = []; 


/* ----------  HELPERS  ---------- */
function clone(value) {
  try { return JSON.parse(JSON.stringify(value)); }
  catch (e) { console.warn("Clone failed for value:", value); return value; }
}

function normalizeStringInternal(str) {
    if (!str) return "";
    // Preserve Ñ/ñ as a distinct letter, convert others to uppercase, strip accents.
    return str.toUpperCase().normalize("NFD").replace(/[\u0300-\u0302\u0304-\u036f]/g, "");
}

/* ----------  PUBLIC SETTERS for Core Gameplay State ---------- */
export function setCurrentWordObject(obj) {
    currentWordObject = obj ? clone(obj) : null;
    if (currentWordObject && currentWordObject.word) {
        currentWord = normalizeStringInternal(currentWordObject.word);
    } else {
        currentWord = "";
    }
}
export function setGuessedLetters(newSet) { 
    guessedLetters = newSet instanceof Set ? new Set(Array.from(newSet).map(l => typeof l === 'string' ? l.toLowerCase() : l)) : new Set();
}

export function initRemainingAttempts(numPlayers, attempts = DEFAULT_ATTEMPTS_PER_PLAYER) {
  remainingAttemptsPerPlayer = Array(Math.max(1, numPlayers)).fill(attempts);
  console.log(`[State] Initialized remainingAttemptsPerPlayer for ${numPlayers} players with ${attempts} attempts:`, clone(remainingAttemptsPerPlayer));
}

export function setRemainingAttemptsPerPlayer(newArray) {
  if (Array.isArray(newArray)) {
    remainingAttemptsPerPlayer = Array.from(newArray); 
    // console.log(`[State] Set remainingAttemptsPerPlayer:`, clone(remainingAttemptsPerPlayer));
  } else {
    console.error("[State] setRemainingAttemptsPerPlayer: Provided value is not an array.", newArray);
  }
}

export function decAttemptsFor(playerId) {
  if (playerId >= 0 && playerId < remainingAttemptsPerPlayer.length) {
    if (remainingAttemptsPerPlayer[playerId] > 0) {
        remainingAttemptsPerPlayer[playerId]--;
    }
  } else {
    // console.warn(`[State] decAttemptsFor: Invalid playerId ${playerId} for array of length ${remainingAttemptsPerPlayer.length}`);
  }
}

export function setGameActive(isActive) {
    gameActive = isActive;
    const currentPhase = pvpRemoteActive ? networkRoomData.roomState : gamePhase;
    if (!isActive && currentPhase === 'playing') {
        setGamePhase(pvpRemoteActive ? 'game_over' : 'ended'); // Use 'game_over' for network context if ended by game logic
    } else if (isActive && currentPhase !== 'playing') {
        setGamePhase('playing');
    }
    // console.log(`[State] Game active set to: ${gameActive}, phase: ${pvpRemoteActive ? networkRoomData.roomState : gamePhase}`);
}
export function setCurrentDifficulty(difficultyStr) { currentDifficulty = difficultyStr; }
export function setClueUsedThisGame(wasUsed) { clueUsedThisGame = wasUsed; }

export function setPlayersData(newPlayers) { // For local game OR to set game instance players in network mode
  localPlayersData = newPlayers ? clone(newPlayers) : [];
  if (!pvpRemoteActive) { // Only init attempts here if it's a local game setup
      initRemainingAttempts(localPlayersData.length || 1); 
  }
  // console.log("[State] setPlayersData (current game instance):", clone(localPlayersData));
}
export function setCurrentPlayerId(id) { currentPlayerId = id; }
export function setGamePhase(phase) {
    const validPhases = ['idle', 'lobby', 'playing', 'ended', 'creating_room', 'connecting_to_lobby', 'awaiting_join_approval', 'seeking_match', 'game_over'];
    if (validPhases.includes(phase)) {
        if (pvpRemoteActive) {
            // For network games, roomState is the primary phase indicator
            if (networkRoomData.roomState !== phase) {
                networkRoomData.roomState = phase;
                console.log(`[State] Network roomState (phase) set to: ${networkRoomData.roomState}`);
            }
        } else {
            // For local games, gamePhase is used
            if (gamePhase !== phase) {
                gamePhase = phase;
                console.log(`[State] Local gamePhase set to: ${gamePhase}`);
            }
        }
    } else {
        console.warn(`[State] Attempted to set invalid game phase: ${phase}`);
    }
}

/* ----------  PUBLIC SETTERS for Network State ---------- */
export function setPvpRemoteActive(isActive) { pvpRemoteActive = isActive; }
export function setMyPeerId(id) { myPeerId = id; }

export function setNetworkRoomData(data) {
    // Preserve internal async callbacks if 'data' doesn't explicitly overwrite them
    const preserved = {
        _peerInitPromise: data.hasOwnProperty('_peerInitPromise') ? data._peerInitPromise : networkRoomData._peerInitPromise,
        _peerInitResolve: data.hasOwnProperty('_peerInitResolve') ? data._peerInitResolve : networkRoomData._peerInitResolve,
        _peerInitReject: data.hasOwnProperty('_peerInitReject') ? data._peerInitReject : networkRoomData._peerInitReject,
        _setupCompleteCallback: data.hasOwnProperty('_setupCompleteCallback') ? data._setupCompleteCallback : networkRoomData._setupCompleteCallback,
        _setupErrorCallback: data.hasOwnProperty('_setupErrorCallback') ? data._setupErrorCallback : networkRoomData._setupErrorCallback,
    };
    const oldRoomState = networkRoomData.roomState;
    networkRoomData = { ...networkRoomData, ...data, ...preserved };
    
    if (networkRoomData.roomState && networkRoomData.roomState !== oldRoomState) {
        console.log(`[State] networkRoomData.roomState changed: ${oldRoomState} -> ${networkRoomData.roomState}`);
        // Update gameActive based on roomState if in network mode
        if (pvpRemoteActive) {
            gameActive = (networkRoomData.roomState === 'playing');
            // Also sync general gamePhase if it's tied to roomState
            gamePhase = networkRoomData.roomState; 
        }
    }
    // If players data is part of the sync, ensure local game instance players are also updated
    if (data.players && pvpRemoteActive) {
        localPlayersData = clone(data.players); // Keep game instance players in sync
        // If attempts are part of full state sync, set them. Otherwise, game init handles it.
        if(data.remainingAttemptsPerPlayer) {
            remainingAttemptsPerPlayer = clone(data.remainingAttemptsPerPlayer);
        }
    }
     if(data.currentWordObject !== undefined) setCurrentWordObject(data.currentWordObject);
     if(data.guessedLetters !== undefined) setGuessedLetters(new Set(data.guessedLetters));
     if(data.currentPlayerId !== undefined) setCurrentPlayerId(data.currentPlayerId);
     if(data.clueUsedThisGame !== undefined) setClueUsedThisGame(data.clueUsedThisGame);
     if(data.gameSettings?.difficulty && currentDifficulty !== data.gameSettings.difficulty) {
        setCurrentDifficulty(data.gameSettings.difficulty);
     }
}

export function resetNetworkRoomData() {
    const preservedCallbacks = { // Keep any pending async setup callbacks
        _peerInitPromise: networkRoomData._peerInitPromise, _peerInitResolve: networkRoomData._peerInitResolve,
        _peerInitReject: networkRoomData._peerInitReject, _setupCompleteCallback: networkRoomData._setupCompleteCallback,
        _setupErrorCallback: networkRoomData._setupErrorCallback,
    };
    networkRoomData = {
        roomId: null, leaderPeerId: null, myPlayerIdInRoom: null, isRoomLeader: false,
        maxPlayers: MAX_PLAYERS_NETWORK, players: [],
        gameSettings: { difficulty: currentDifficulty }, // Default to current app difficulty
        roomState: 'idle', turnCounter: 0,
        ...preservedCallbacks
    };
    if (!pvpRemoteActive) { // If switching away from network mode
        setGamePhase('idle');
    }
    // console.log("[State] resetNetworkRoomData completed.");
}

export function addPlayerToNetworkRoom(player) {
    const existingPlayerIndex = networkRoomData.players.findIndex(p => p.peerId === player.peerId || p.id === player.id);
    if (existingPlayerIndex === -1) {
        networkRoomData.players.push(clone(player));
    } else {
        networkRoomData.players[existingPlayerIndex] = { ...networkRoomData.players[existingPlayerIndex], ...clone(player) };
    }
    networkRoomData.players.sort((a, b) => (a.id === undefined ? Infinity : a.id) - (b.id === undefined ? Infinity : b.id));
    // console.log(`[State] Player ${player.peerId || player.id} added/updated in network room. Players:`, clone(networkRoomData.players));
}

export function removePlayerFromNetworkRoom(peerIdToRemove) {
    const initialCount = networkRoomData.players.length;
    networkRoomData.players = networkRoomData.players.filter(p => p.peerId !== peerIdToRemove);
    if (networkRoomData.players.length < initialCount) {
        // console.log(`[State] Player ${peerIdToRemove} removed from network room. Players:`, clone(networkRoomData.players));
    }
}

export function updatePlayerInNetworkRoom(peerIdToUpdate, updates) {
    const playerIndex = networkRoomData.players.findIndex(p => p.peerId === peerIdToUpdate);
    if (playerIndex !== -1) {
        networkRoomData.players[playerIndex] = { ...networkRoomData.players[playerIndex], ...clone(updates) };
        // console.log(`[State] Player ${peerIdToUpdate} updated in network room. Updates:`, clone(updates));
    }
}

/* ----------  PUBLIC GETTERS for Core Gameplay State ---------- */
export function getCurrentWord() { return currentWord; }
export function getCurrentWordObject() { return currentWordObject ? clone(currentWordObject) : null; }
export function getGuessedLetters() { return new Set(guessedLetters); }
export function getAttemptsFor(playerId) {
  if (playerId !== null && playerId !== undefined && playerId >= 0 && playerId < remainingAttemptsPerPlayer.length) {
    return remainingAttemptsPerPlayer[playerId];
  }
  return DEFAULT_ATTEMPTS_PER_PLAYER; // Fallback if no specific data
}
export function getRemainingAttemptsPerPlayer() {
  return [...remainingAttemptsPerPlayer]; 
}
export function getGameActive() { return gameActive; }
export function getCurrentDifficulty() { return currentDifficulty; }
export function getClueUsedThisGame() { return clueUsedThisGame; }
export function getPlayersData() { // Returns players for the current game instance (local or network)
    return clone(localPlayersData); 
}
export function getCurrentPlayerId() { return currentPlayerId; }
export function getGamePhase() { 
    return pvpRemoteActive ? networkRoomData.roomState : gamePhase;
}

/* ----------  PUBLIC GETTERS for Network State ---------- */
export function getPvpRemoteActive() { return pvpRemoteActive; }
export function getMyPeerId() { return myPeerId; }

// --- PATCH: Add new getter for raw network data (for host state sync) ---
export function getRawNetworkRoomData() {
    // Return a clone to prevent direct external mutation of the internal object,
    // but include all fields, including internal ones like _callbacks.
    return clone(networkRoomData);
}
// --- END PATCH ---

export function getSanitizedNetworkRoomDataForClient() {
    if (!networkRoomData) return {};
    // Exclude internal async callbacks and promise objects from client sync
    const { 
        _peerInitPromise, _peerInitResolve, _peerInitReject, 
        _setupCompleteCallback, _setupErrorCallback, 
        ...sanitizedData 
    } = networkRoomData;
    return clone(sanitizedData);
}

/* ---------- Combined State Management Functions ---------- */
export function resetScores() {
    if (localPlayersData) localPlayersData.forEach(p => p.score = 0);
    if (networkRoomData?.players) networkRoomData.players.forEach(p => p.score = 0);
}

export function resetGameFlowState() { // For starting a new word/round
    setCurrentWordObject(null); 
    guessedLetters.clear(); // Use the setter to ensure it's a new Set
    setGuessedLetters(new Set());
    // remainingAttemptsPerPlayer is re-initialized by initializeGame or setPlayersData
    clueUsedThisGame = false;
    if (pvpRemoteActive && networkRoomData) networkRoomData.turnCounter = 0;
    // console.log(`[State] resetGameFlowState completed.`);
}

export function resetFullLocalStateForNewUIScreen() { // For returning to main menu, etc.
    resetGameFlowState(); 
    resetScores();
    localPlayersData = []; 
    currentPlayerId = 0; 
    // currentDifficulty = "easy"; // Keep current difficulty selection
    gameActive = false; 
    remainingAttemptsPerPlayer = [];
    // setMyPeerId(null); // myPeerId should persist if Peer object is not destroyed
    // pvpRemoteActive = false; // This should be set by UI flow, not reset here necessarily
    resetNetworkRoomData(); 
    // console.log("[State] resetFullLocalStateForNewUIScreen completed.");
}

export function normalizeString(str) { return normalizeStringInternal(str); }

export function getLocalPlayerCustomizationForNetwork() {
    const nameEl = document.getElementById(`network-player-name`);
    const iconEl = document.getElementById(`network-player-icon`);
    const name = nameEl?.value.trim() || `Pizarrín${Math.floor(Math.random()*100)}`;
    const icon = iconEl?.value || AVAILABLE_ICONS[0];
    let colorIndex = 0; // Default color index
    // Assign a unique color if possible, based on current players in room (if joining)
    // This is a basic assignment; host might re-assign for definitive uniqueness.
    if (networkRoomData?.players?.length > 0) {
        colorIndex = networkRoomData.players.length % DEFAULT_PLAYER_COLORS.length;
    }
    return { name, icon, color: DEFAULT_PLAYER_COLORS[colorIndex] };
}

export function logCurrentState(context = "Generic") {
    console.log(`--- CURRENT GAME STATE (${context}) ---`);
    console.log("Difficulty:", currentDifficulty, "Game Active:", gameActive, "Game Phase:", getGamePhase());
    console.log("Word Object:", currentWordObject ? currentWordObject.word : "N/A", "Norm Word:", currentWord);
    console.log("Attempts Left (per player):", clone(remainingAttemptsPerPlayer));
    console.log("Clue Used:", clueUsedThisGame);
    console.log("Guessed Letters:", Array.from(guessedLetters).join(', '));
    console.log("Players Data (Game Instance):", clone(localPlayersData));
    console.log("Current Player ID (Game Instance):", currentPlayerId);
    console.log("--- NETWORK STATE ---");
    console.log("PVP Remote Active:", pvpRemoteActive);
    console.log("My Peer ID:", myPeerId);
    console.log("Network Room Data (Sanitized for Client):", getSanitizedNetworkRoomDataForClient());
    // console.log("Network Room Data (Raw for Host):", getRawNetworkRoomData()); // For debugging host state
    console.log("------------------------");
}