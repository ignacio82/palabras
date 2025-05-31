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
let currentWord = ''; // Normalized, uppercase version of currentWordObject.word
let currentWordObject = null; // { word: "RAW", definition: "...", difficulty: "..." }
let guessedLetters = new Set(); // Set of normalized, lowercase letters
let remainingAttemptsPerPlayer = []; // Array, index corresponds to player ID
let currentPlayerId = 0; // ID of the current player
let gameActive = false; // Is a game currently in progress?
let gamePhase = 'idle'; // Overall application/game phase: 'idle' | 'lobby' | 'playing' | 'ended' | 'creating_room' | 'connecting_to_lobby' | 'awaiting_join_approval' | 'seeking_match' | 'game_over'
let currentDifficulty = "easy";
let clueUsedThisGame = false;

// Network Play State
let pvpRemoteActive = false; // Is the current game a network game?
let myPeerId = null; // This client's PeerJS ID

// This holds the state of the network room.
// For the host, it's the authoritative state.
// For clients, it's a synchronized copy from the host.
// Includes both room management and potentially a snapshot of game state for sync.
let networkRoomData = {
    roomId: null,               // Unique ID of the room (usually host's PeerJS ID)
    leaderPeerId: null,         // PeerJS ID of the room leader/host
    myPlayerIdInRoom: null,     // This client's game-specific ID within the room (e.g., 0, 1, 2)
    isRoomLeader: false,        // Is this client the leader of the room?
    maxPlayers: MAX_PLAYERS_NETWORK,
    players: [],                // Array of player objects { id, peerId, name, icon, color, isReady, isConnected, score }
    gameSettings: { difficulty: "easy" }, // Settings for the current/next game in the room
    roomState: 'idle',          // State of the room: 'idle', 'lobby', 'playing', 'game_over' (mirrors gamePhase for network games)
    turnCounter: 0,             // Primarily for network games to resolve potential race conditions (optional)

    // Palabras game state snapshot for synchronization via FULL_GAME_STATE
    // These fields are mirrored from/to the global gameplay state variables above.
    currentWordObject: null,
    guessedLetters: [], // Serialized as array
    remainingAttemptsPerPlayer: [],
    currentPlayerId: 0,
    clueUsedThisGame: false,
    gameActive: false, // Mirrored from global gameActive

    // Internal flags for async setup, not meant to be part of general state sync for clients
    _peerInitPromise: null,
    _peerInitResolve: null,
    _peerInitReject: null,
    _setupCompleteCallback: null, // For hostNewRoom/joinRoomById promises
    _setupErrorCallback: null,
};

// Local Game Players Data (used by gameLogic when game is active, or for single player)
// In network games, this is typically a synchronized copy of networkRoomData.players
// or a subset relevant to the game logic.
let localPlayersData = [];


/* ----------  HELPERS  ---------- */
function clone(value) {
  try { return JSON.parse(JSON.stringify(value)); }
  catch (e) { console.warn("Clone failed for value:", value); return value; }
}

function normalizeStringInternal(str) {
    if (!str) return "";
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
}

export function setRemainingAttemptsPerPlayer(newArray) {
  if (Array.isArray(newArray)) {
    remainingAttemptsPerPlayer = Array.from(newArray);
  } else {
    console.error("[State] setRemainingAttemptsPerPlayer: Provided value is not an array.", newArray);
  }
}

export function decAttemptsFor(playerId) {
  if (playerId >= 0 && playerId < remainingAttemptsPerPlayer.length) {
    if (remainingAttemptsPerPlayer[playerId] > 0) {
        remainingAttemptsPerPlayer[playerId]--;
    }
  }
}

export function setGameActive(isActive) {
    gameActive = isActive;
    const currentActualPhase = pvpRemoteActive ? networkRoomData.roomState : gamePhase;
    if (!isActive && currentActualPhase === 'playing') {
        setGamePhase(pvpRemoteActive ? 'game_over' : 'ended');
    } else if (isActive && currentActualPhase !== 'playing') {
        setGamePhase('playing');
    }
}
export function setCurrentDifficulty(difficultyStr) { currentDifficulty = difficultyStr; }
export function setClueUsedThisGame(wasUsed) { clueUsedThisGame = wasUsed; }

export function setPlayersData(newPlayers) {
  localPlayersData = newPlayers ? clone(newPlayers) : [];
  if (!pvpRemoteActive && localPlayersData.length > 0) { // Only init attempts here if it's a local game setup with players
      initRemainingAttempts(localPlayersData.length || 1);
  }
}
export function setCurrentPlayerId(id) { currentPlayerId = id; }

export function setGamePhase(phase) {
    const validPhases = ['idle', 'lobby', 'playing', 'ended', 'creating_room', 'connecting_to_lobby', 'awaiting_join_approval', 'seeking_match', 'game_over'];
    if (validPhases.includes(phase)) {
        if (pvpRemoteActive) {
            if (networkRoomData.roomState !== phase) {
                networkRoomData.roomState = phase; // Update networkRoomData's view of the phase
                console.log(`[State] Network roomState (phase) set to: ${networkRoomData.roomState}`);
            }
            // Also sync general gamePhase if it's meant to mirror roomState for network games
            gamePhase = phase;
        } else {
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

// This function is crucial for clients receiving FULL_GAME_STATE
export function setNetworkRoomData(data) {
    const preservedCallbacks = {
        _peerInitPromise: data.hasOwnProperty('_peerInitPromise') ? data._peerInitPromise : networkRoomData._peerInitPromise,
        _peerInitResolve: data.hasOwnProperty('_peerInitResolve') ? data._peerInitResolve : networkRoomData._peerInitResolve,
        _peerInitReject: data.hasOwnProperty('_peerInitReject') ? data._peerInitReject : networkRoomData._peerInitReject,
        _setupCompleteCallback: data.hasOwnProperty('_setupCompleteCallback') ? data._setupCompleteCallback : networkRoomData._setupCompleteCallback,
        _setupErrorCallback: data.hasOwnProperty('_setupErrorCallback') ? data._setupErrorCallback : networkRoomData._setupErrorCallback,
    };
    const oldRoomState = networkRoomData.roomState;

    // Merge incoming data into networkRoomData
    networkRoomData = { ...networkRoomData, ...clone(data), ...preservedCallbacks };

    // If the incoming data (e.g., from FULL_GAME_STATE) contains game-specific fields,
    // update the global state variables accordingly.
    if (data.currentWordObject !== undefined) setCurrentWordObject(data.currentWordObject);
    if (data.guessedLetters !== undefined) setGuessedLetters(new Set(data.guessedLetters)); // Ensure it's a Set
    if (data.remainingAttemptsPerPlayer !== undefined) setRemainingAttemptsPerPlayer(clone(data.remainingAttemptsPerPlayer));
    if (data.clueUsedThisGame !== undefined) setClueUsedThisGame(data.clueUsedThisGame);
    if (data.currentPlayerId !== undefined) setCurrentPlayerId(data.currentPlayerId);
    if (data.gameActive !== undefined) setGameActive(data.gameActive); // This will also call setGamePhase if needed

    // If players list is part of the update (it will be in FULL_GAME_STATE),
    // also update localPlayersData which gameLogic uses.
    if (data.players) { // data.players should be the full player list {id, name, score, etc.}
        setPlayersData(data.players); // This updates localPlayersData
    }

    // Update game settings if provided
    if (data.gameSettings?.difficulty && currentDifficulty !== data.gameSettings.difficulty) {
        setCurrentDifficulty(data.gameSettings.difficulty);
    }
     if (data.roomState && pvpRemoteActive) { // If roomState is explicitly in data, sync gamePhase
        setGamePhase(data.roomState); // This updates global gamePhase and networkRoomData.roomState
    } else if (networkRoomData.roomState && networkRoomData.roomState !== oldRoomState) {
        console.log(`[State] networkRoomData.roomState changed: ${oldRoomState} -> ${networkRoomData.roomState}`);
        if (pvpRemoteActive) { // Sync gameActive and gamePhase based on the new roomState
            const isActive = (networkRoomData.roomState === 'playing');
            if (gameActive !== isActive) setGameActive(isActive); // This calls setGamePhase
            else if (gamePhase !== networkRoomData.roomState) setGamePhase(networkRoomData.roomState); // Sync phase if gameActive didn't change it
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
        gameSettings: { difficulty: currentDifficulty }, // Default to current app difficulty
        roomState: 'idle', turnCounter: 0,
        // Reset Palabras game state fields within networkRoomData snapshot
        currentWordObject: null, guessedLetters: [], remainingAttemptsPerPlayer: [],
        currentPlayerId: 0, clueUsedThisGame: false, gameActive: false,
        ...preservedCallbacks
    };
    if (!pvpRemoteActive) { // If switching away from network mode by this reset
        setGamePhase('idle');
    }
}

export function addPlayerToNetworkRoom(player) { // Used by host
    const existingPlayerIndex = networkRoomData.players.findIndex(p => p.peerId === player.peerId || (p.id !== null && p.id === player.id));
    if (existingPlayerIndex === -1) {
        networkRoomData.players.push(clone(player));
    } else { // Update existing player (e.g., on reconnect or if data changes)
        networkRoomData.players[existingPlayerIndex] = { ...networkRoomData.players[existingPlayerIndex], ...clone(player), isConnected: true };
    }
    // Ensure players are sorted by ID for consistent order if IDs are managed sequentially
    networkRoomData.players.sort((a, b) => (a.id === undefined || a.id === null ? Infinity : a.id) - (b.id === undefined || b.id === null ? Infinity : b.id));
}

export function removePlayerFromNetworkRoom(peerIdToRemove) { // Used by host
    const initialCount = networkRoomData.players.length;
    networkRoomData.players = networkRoomData.players.filter(p => p.peerId !== peerIdToRemove);
    if (networkRoomData.players.length < initialCount) {
        // Player was removed
    }
}

export function updatePlayerInNetworkRoom(peerIdToUpdate, updates) { // Used by host
    const playerIndex = networkRoomData.players.findIndex(p => p.peerId === peerIdToUpdate);
    if (playerIndex !== -1) {
        networkRoomData.players[playerIndex] = { ...networkRoomData.players[playerIndex], ...clone(updates) };
    }
}

/* ----------  PUBLIC GETTERS for Core Gameplay State ---------- */
export function getCurrentWord() { return currentWord; }
export function getCurrentWordObject() { return currentWordObject ? clone(currentWordObject) : null; }
export function getGuessedLetters() { return new Set(guessedLetters); } // Return a clone Set

export function getAttemptsFor(playerId) {
  if (playerId !== null && playerId !== undefined && playerId >= 0 && playerId < remainingAttemptsPerPlayer.length) {
    return remainingAttemptsPerPlayer[playerId];
  }
  // Fallback if player ID is out of bounds or attempts not initialized for them
  return DEFAULT_ATTEMPTS_PER_PLAYER;
}
export function getRemainingAttemptsPerPlayer() { // Returns a clone array
  return [...remainingAttemptsPerPlayer];
}
export function getGameActive() { return gameActive; }
export function getCurrentDifficulty() { return currentDifficulty; }
export function getClueUsedThisGame() { return clueUsedThisGame; }

// Returns players for the current game instance (local or network game logic context)
export function getPlayersData() {
    return clone(localPlayersData);
}
export function getCurrentPlayerId() { return currentPlayerId; } // ID of current player for game turn

export function getGamePhase() { // Authoritative game phase
    return pvpRemoteActive ? networkRoomData.roomState : gamePhase;
}

/* ----------  PUBLIC GETTERS for Network State ---------- */
export function getPvpRemoteActive() { return pvpRemoteActive; }
export function getMyPeerId() { return myPeerId; }

// Returns a clone of the raw networkRoomData, including internal fields.
// Primarily for host to construct FULL_GAME_STATE or for debugging.
export function getRawNetworkRoomData() {
    return clone(networkRoomData);
}

// Returns a version of networkRoomData suitable for sending to clients
// (e.g., for lobby updates, excluding internal callbacks).
export function getSanitizedNetworkRoomDataForClient() {
    if (!networkRoomData) return {};
    const {
        _peerInitPromise, _peerInitResolve, _peerInitReject,
        _setupCompleteCallback, _setupErrorCallback,
        // Explicitly take what's needed for client ROOM_STATE_UPDATE (lobby)
        // For Palabras, this is primarily: players, gameSettings, maxPlayers, roomState, roomId, leaderPeerId
        // The game-specific fields like currentWordObject are sent via FULL_GAME_STATE when game is active.
        currentWordObject, guessedLetters, remainingAttemptsPerPlayer, currentPlayerId, clueUsedThisGame, gameActive, // Exclude these from simple room state unless intended
        ...sanitizedData
    } = networkRoomData;
     // Ensure players list in sanitizedData is also a clone if it wasn't already handled by the spread
    if (sanitizedData.players) sanitizedData.players = clone(sanitizedData.players);
    return clone(sanitizedData); // Clone the result too
}

/* ---------- Combined State Management Functions ---------- */
export function resetScores() {
    if (localPlayersData) localPlayersData.forEach(p => p.score = 0);
    if (networkRoomData?.players) networkRoomData.players.forEach(p => p.score = 0);
}

// For starting a new word/round (resets game flow, not players/scores necessarily for a multi-round game)
export function resetGameFlowState() {
    setCurrentWordObject(null);
    setGuessedLetters(new Set()); // Clears guessed letters
    // remainingAttemptsPerPlayer is typically re-initialized by initializeGame or setPlayersData
    setClueUsedThisGame(false);
    if (pvpRemoteActive && networkRoomData) networkRoomData.turnCounter = 0; // Reset turn counter for network
    // currentPlayerId might be reset by initializeGame to the starting player
}

// For returning to main menu, quitting a game entirely
export function resetFullLocalStateForNewUIScreen() {
    resetGameFlowState(); // Resets word, guessed letters, clue
    resetScores();        // Resets scores in localPlayersData and networkRoomData.players

    localPlayersData = []; // Clear game instance players
    currentPlayerId = 0;
    // currentDifficulty = "easy"; // User's difficulty selection often persists
    setGameActive(false); // Ensures game is not active
    remainingAttemptsPerPlayer = []; // Clear attempts array

    // myPeerId should persist if PeerJS session is not fully closed yet,
    // peerConnection.closeAllConnectionsAndSession() handles setting myPeerId to null.

    // pvpRemoteActive should be set by UI flow, not reset here,
    // but networkRoomData itself is reset.
    resetNetworkRoomData(); // Resets network specific state (room, players in room, etc.)
    setGamePhase('idle'); // Set overall game phase to idle
}

export function normalizeString(str) { return normalizeStringInternal(str); }

export function getLocalPlayerCustomizationForNetwork() {
    const nameEl = document.getElementById(`network-player-name`);
    const iconEl = document.getElementById(`network-player-icon`);
    const name = nameEl?.value.trim() || `Pizarrín${Math.floor(Math.random()*100)}`;
    const icon = iconEl?.value || AVAILABLE_ICONS[0];

    // Basic color assignment - host might re-assign for uniqueness if needed
    let colorIndex = 0;
    if (networkRoomData?.players?.length > 0 && networkRoomData.players.length < DEFAULT_PLAYER_COLORS.length) {
        // Try to pick a color not already in use by connected players in the room
        const usedColors = new Set(networkRoomData.players.filter(p => p.isConnected).map(p => p.color));
        for (let i = 0; i < DEFAULT_PLAYER_COLORS.length; i++) {
            if (!usedColors.has(DEFAULT_PLAYER_COLORS[i])) {
                colorIndex = i;
                break;
            }
             // If all default colors are used, cycle through them
            if (i === DEFAULT_PLAYER_COLORS.length -1) {
                colorIndex = networkRoomData.players.length % DEFAULT_PLAYER_COLORS.length;
            }
        }
    } else if (networkRoomData?.players?.length >= DEFAULT_PLAYER_COLORS.length) {
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
    console.log("Players Data (Game Instance - localPlayersData):", clone(localPlayersData));
    console.log("Current Player ID (Game Instance):", currentPlayerId);
    console.log("--- NETWORK STATE ---");
    console.log("PVP Remote Active:", pvpRemoteActive);
    console.log("My Peer ID:", myPeerId);
    // Log sanitized for brevity, raw for host debugging if needed
    console.log("Network Room Data (Sanitized for Client view):", getSanitizedNetworkRoomDataForClient());
    // if (getNetworkRoomData().isRoomLeader) console.log("Network Room Data (RAW for Host):", getRawNetworkRoomData());
    console.log("------------------------");
}