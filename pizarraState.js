// pizarraState.js

// ---------- GAME CONSTANTS ----------
export const DEFAULT_PLAYER_COLORS = ['#FF69B4', '#00BFFF', '#FFD700', '#32CD32', '#FF7F50', '#DA70D6'];
export const AVAILABLE_ICONS = ['✏️', '🌟', '🍎', '💡', '📖', '🧑‍🏫', '🎓', '🖍️', '🎨', '🏆'];
export const MAX_PLAYERS_LOCAL = 4;
export const MAX_PLAYERS_NETWORK = 4;
export const MIN_PLAYERS_NETWORK = 2;

export const MAX_ATTEMPTS = 6; // Stays as the max for each player
export const STAR_SYMBOL = "🌟";
export const ALPHABET = "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ".split('');
export const PIZARRA_PEER_ID_PREFIX = "pizarra-";

// ---------- CORE GAME STATE (Local & Gameplay) ----------
export let currentWord = '';
export let currentWordObject = null;
export let guessedLetters = new Set();
// export let remainingAttempts = MAX_ATTEMPTS; // REMOVED
export let remainingAttemptsPerPlayer = []; // NEW: Array to store attempts for each player
export let gameActive = false;
export let currentDifficulty = "easy";
export let clueUsedThisGame = false;

export let playersData = []; // { id, name, icon, color, score } for current game instance
export let currentPlayerId = 0; // ID of the current player

// ---------- NETWORK PLAY STATE ----------
export let pvpRemoteActive = false;
export let myPeerId = null;

export let networkRoomData = {
    roomId: null,
    leaderPeerId: null,
    myPlayerIdInRoom: null,
    isRoomLeader: false,
    maxPlayers: MAX_PLAYERS_NETWORK,
    players: [], // { id, peerId, name, icon, color, isReady, isConnected, score }
    gameSettings: {
        difficulty: "easy",
    },
    roomState: 'idle',
    turnCounter: 0,
    _peerInitPromise: null,
    _peerInitResolve: null,
    _peerInitReject: null,
    _setupCompleteCallback: null,
    _setupErrorCallback: null,
};

// ---------- STATE MUTATORS / SETTERS ----------

// --- Core Game Mutators ---
export function setCurrentWordObject(obj) {
    currentWordObject = obj;
    if (obj && obj.word) {
        currentWord = normalizeString(obj.word); // Uses normalizeString below
    } else {
        currentWord = "";
    }
}
export function setGuessedLetters(newSet) { guessedLetters = newSet; }
// export function setRemainingAttempts(num) { remainingAttempts = num; } // REMOVED

// NEW functions for per-player attempts
export function initRemainingAttempts(numPlayers = 1) { // Default to 1 for local single player
  remainingAttemptsPerPlayer = Array(Math.max(1, numPlayers)).fill(MAX_ATTEMPTS);
  console.log(`[State] Initialized remainingAttemptsPerPlayer for ${numPlayers} players:`, JSON.parse(JSON.stringify(remainingAttemptsPerPlayer)));
}
export function decAttemptsFor(playerId) {
  // Ensure playerID is a valid index for the array.
  // Player IDs (0, 1, 2...) should directly map to array indices.
  if (playerId >= 0 && playerId < remainingAttemptsPerPlayer.length) {
    if (remainingAttemptsPerPlayer[playerId] > 0) {
        remainingAttemptsPerPlayer[playerId]--;
    }
    console.log(`[State] Decremented attempts for player ${playerId}. Now: ${remainingAttemptsPerPlayer[playerId]}`);
  } else {
    console.warn(`[State] decAttemptsFor: Invalid playerId ${playerId} for remainingAttemptsPerPlayer of length ${remainingAttemptsPerPlayer.length}`);
  }
}
export function getAttemptsFor(playerId) {
  if (playerId >= 0 && playerId < remainingAttemptsPerPlayer.length) {
    return remainingAttemptsPerPlayer[playerId];
  }
  // Fallback or error for invalid playerId if necessary, though UI should usually display for valid players
  console.warn(`[State] getAttemptsFor: Invalid playerId ${playerId}, returning MAX_ATTEMPTS as fallback.`);
  return MAX_ATTEMPTS; 
}


export function setGameActive(isActive) { gameActive = isActive; }
export function setCurrentDifficulty(difficultyStr) { currentDifficulty = difficultyStr; }
export function setClueUsedThisGame(wasUsed) { clueUsedThisGame = wasUsed; }

export function setPlayersData(data) {
    playersData = data.map(p => ({ ...p, score: p.score || 0, id: p.id }));
    console.log("[State] setPlayersData (game instance):", JSON.parse(JSON.stringify(playersData)));
    // When playersData is set (especially for network games), initialize attempts array
    if (playersData.length > 0) {
        initRemainingAttempts(playersData.length);
    }
}
export function setCurrentPlayerId(id) { currentPlayerId = id; }

// --- Network State Mutators ---
export function setPvpRemoteActive(isActive) { pvpRemoteActive = isActive; }
export function setMyPeerId(id) { myPeerId = id; }

export function setNetworkRoomData(data) {
    const oldRoomState = networkRoomData.roomState;
    const preservedCallbacks = {
        _peerInitPromise: networkRoomData._peerInitPromise,
        _peerInitResolve: networkRoomData._peerInitResolve,
        _peerInitReject: networkRoomData._peerInitReject,
        _setupCompleteCallback: networkRoomData._setupCompleteCallback,
        _setupErrorCallback: networkRoomData._setupErrorCallback,
    };
    networkRoomData = { ...preservedCallbacks, ...networkRoomData, ...data };
    if (data.hasOwnProperty('_peerInitPromise')) networkRoomData._peerInitPromise = data._peerInitPromise;
    if (data.hasOwnProperty('_peerInitResolve')) networkRoomData._peerInitResolve = data._peerInitResolve;
    if (data.hasOwnProperty('_peerInitReject')) networkRoomData._peerInitReject = data._peerInitReject;
    if (data.hasOwnProperty('_setupCompleteCallback')) networkRoomData._setupCompleteCallback = data._setupCompleteCallback;
    if (data.hasOwnProperty('_setupErrorCallback')) networkRoomData._setupErrorCallback = data._setupErrorCallback;
    if (data.roomState && data.roomState !== oldRoomState) {
        console.log(`[State] networkRoomData.roomState changed: ${oldRoomState} -> ${networkRoomData.roomState}`);
    }
}

export function resetNetworkRoomData() {
    console.log("[State] Resetting networkRoomData (preserving promise handlers if any).");
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
}

export function addPlayerToNetworkRoom(player) {
    const existingPlayerIndex = networkRoomData.players.findIndex(p => p.peerId === player.peerId);
    if (existingPlayerIndex === -1) {
        networkRoomData.players.push(player);
    } else {
        networkRoomData.players[existingPlayerIndex] = { ...networkRoomData.players[existingPlayerIndex], ...player };
    }
    networkRoomData.players.sort((a, b) => (a.id === undefined ? Infinity : a.id) - (b.id === undefined ? Infinity : b.id));
}

export function removePlayerFromNetworkRoom(peerIdToRemove) {
    const initialCount = networkRoomData.players.length;
    networkRoomData.players = networkRoomData.players.filter(p => p.peerId !== peerIdToRemove);
    if (networkRoomData.players.length < initialCount) {
        console.log(`[State] Player with peerId ${peerIdToRemove} removed from network room.`);
    }
}

export function updatePlayerInNetworkRoom(peerIdToUpdate, updates) {
    const playerIndex = networkRoomData.players.findIndex(p => p.peerId === peerIdToUpdate);
    if (playerIndex !== -1) {
        networkRoomData.players[playerIndex] = { ...networkRoomData.players[playerIndex], ...updates };
    }
}

export function resetScores() {
    if (playersData) playersData.forEach(p => p.score = 0);
    if (networkRoomData?.players) networkRoomData.players.forEach(p => p.score = 0);
}

export function resetGameFlowState() {
    setCurrentWordObject(null);
    guessedLetters.clear();
    // remainingAttemptsPerPlayer is initialized by initRemainingAttempts, called when playersData is set or game starts
    // initRemainingAttempts(playersData.length || 1); // Ensure it's initialized if playersData known
    clueUsedThisGame = false;
    if (pvpRemoteActive && networkRoomData) networkRoomData.turnCounter = 0;
    console.log(`[State] resetGameFlowState completed.`);
}

export function resetFullLocalStateForNewUIScreen() {
    resetGameFlowState(); // Resets core game logic vars
    resetScores();
    playersData = [];
    currentPlayerId = 0; // Default to player 0
    currentDifficulty = "easy";
    gameActive = false;
    remainingAttemptsPerPlayer = []; // Clear this too

    resetNetworkRoomData();
    pvpRemoteActive = false;
    myPeerId = null;
    console.log("[State] resetFullLocalStateForNewUIScreen completed.");
}

export function normalizeString(str) {
    if (!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

export function getLocalPlayerCustomizationForNetwork(playerIndex = 0) {
    const nameEl = document.getElementById(`network-player-name`); // Uses the main page input now
    const iconEl = document.getElementById(`network-player-icon`);
    return {
        name: nameEl?.value.trim() || `Pizarrín${Math.floor(Math.random()*100)}`,
        icon: iconEl?.value || AVAILABLE_ICONS[0], // Default icon
        // Color assigned by host or default, not taken from UI for *initial* join data for simplicity
        color: DEFAULT_PLAYER_COLORS[playerIndex % DEFAULT_PLAYER_COLORS.length] 
    };
}

export function getSanitizedNetworkRoomDataForClient() {
    if (!networkRoomData) return {};
    const {
        _peerInitPromise, _peerInitResolve, _peerInitReject,
        _setupCompleteCallback, _setupErrorCallback,
        ...sanitizedData
    } = networkRoomData;
    return sanitizedData;
}

export function logCurrentState(context = "Generic") {
    // ... (can be expanded to log remainingAttemptsPerPlayer)
    console.log(`--- CURRENT GAME STATE (${context}) ---`);
    console.log("Difficulty:", currentDifficulty, "Game Active:", gameActive);
    console.log("Word Object:", currentWordObject ? currentWordObject.word : "N/A", "Norm Word:", currentWord);
    console.log("Attempts Left (per player):", JSON.parse(JSON.stringify(remainingAttemptsPerPlayer)));
    console.log("Clue Used:", clueUsedThisGame);
    console.log("Guessed Letters:", Array.from(guessedLetters).join(', '));
    console.log("Players Data (Game Instance):", JSON.parse(JSON.stringify(playersData)));
    console.log("Current Player ID (Game Instance):", currentPlayerId);
    console.log("--- NETWORK STATE ---");
    console.log("PVP Remote Active:", pvpRemoteActive);
    console.log("My Peer ID:", myPeerId);
    console.log("Network Room Data (Sanitized):", JSON.parse(JSON.stringify(getSanitizedNetworkRoomDataForClient())));
    console.log("------------------------");
}