// pizarraState.js - Fixed player customization
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
// Renamed to _networkRoomData to match the patch's convention for the internal store
let _networkRoomData = { // Internal store
    roomId: null,              
    leaderPeerId: null,        
    myPlayerIdInRoom: null,    
    isRoomLeader: false,       
    maxPlayers: MAX_PLAYERS_NETWORK,
    players: [],               
    gameSettings: { difficulty: "easy" }, 
    roomState: 'idle',         
    turnCounter: 0,            
    currentWordObject: null,
    guessedLetters: [], 
    remainingAttemptsPerPlayer: [],
    currentPlayerId: 0,
    clueUsedThisGame: false,
    gameActive: false, 
    _peerInitPromise: null,
    _peerInitResolve: null,
    _peerInitReject: null,
    _setupCompleteCallback: null, 
    _setupErrorCallback: null,
};

// Core Gameplay State (these are distinct from _networkRoomData's snapshot)
let currentWord = ''; 
let currentWordObject = null; 
let guessedLetters = new Set(); 
let remainingAttemptsPerPlayer = []; 
let currentPlayerId = 0; 
let gameActive = false; 
let gamePhase = 'idle'; 
let currentDifficulty = "easy";
let clueUsedThisGame = false;

// Network Play State (global flags)
let pvpRemoteActive = false; 
let myPeerId = null; 

let localPlayersData = [];

/* ----------  HELPERS  ---------- */
// Keep a general-purpose clone for data properties if needed elsewhere,
// but setNetworkRoomData will use Object.assign
function clone(value) {
  if (typeof value === 'function') return value;
  if (value instanceof Set) return new Set(Array.from(value));
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => clone(item));
  try { 
    return JSON.parse(JSON.stringify(value)); 
  }
  catch (e) { 
    console.warn("[State] Clone failed for value (falling back to shallow):", value, "Error:", e); 
    return { ...value };
  }
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
    if (pvpRemoteActive) _networkRoomData.currentWordObject = currentWordObject; // Update internal store
}

export function setGuessedLetters(newSet) {
    guessedLetters = newSet instanceof Set ? new Set(Array.from(newSet).map(l => typeof l === 'string' ? l.toLowerCase() : l)) : new Set();
    if (pvpRemoteActive) _networkRoomData.guessedLetters = Array.from(guessedLetters); 
}

export function initRemainingAttempts(numPlayers, attempts = DEFAULT_ATTEMPTS_PER_PLAYER) {
  remainingAttemptsPerPlayer = Array(Math.max(1, numPlayers)).fill(attempts);
  if (pvpRemoteActive) _networkRoomData.remainingAttemptsPerPlayer = [...remainingAttemptsPerPlayer];
}

export function setRemainingAttemptsPerPlayer(newArray) {
  if (Array.isArray(newArray)) {
    remainingAttemptsPerPlayer = Array.from(newArray);
    if (pvpRemoteActive) _networkRoomData.remainingAttemptsPerPlayer = [...remainingAttemptsPerPlayer];
  } else {
    console.error("[State] setRemainingAttemptsPerPlayer: Provided value is not an array.", newArray);
  }
}

export function decAttemptsFor(playerId) {
  if (playerId >= 0 && playerId < remainingAttemptsPerPlayer.length) {
    if (remainingAttemptsPerPlayer[playerId] > 0) {
        remainingAttemptsPerPlayer[playerId]--;
        if (pvpRemoteActive) _networkRoomData.remainingAttemptsPerPlayer = [...remainingAttemptsPerPlayer];
    }
  }
}

export function setGameActive(isActive) {
    if (gameActive === isActive) return; 
    gameActive = isActive;
    if (pvpRemoteActive) _networkRoomData.gameActive = gameActive;
    
    const currentActualPhase = pvpRemoteActive ? _networkRoomData.roomState : gamePhase;
    if (!isActive && currentActualPhase === 'playing') {
        setGamePhase(pvpRemoteActive ? 'game_over' : 'ended');
    } else if (isActive && currentActualPhase !== 'playing') {
        setGamePhase('playing');
    }
}

export function setCurrentDifficulty(difficultyStr) { 
    currentDifficulty = difficultyStr; 
    if (pvpRemoteActive) {
        if (!_networkRoomData.gameSettings) _networkRoomData.gameSettings = {};
        _networkRoomData.gameSettings.difficulty = currentDifficulty;
    }
}

export function setClueUsedThisGame(wasUsed) { 
    clueUsedThisGame = wasUsed; 
    if (pvpRemoteActive) _networkRoomData.clueUsedThisGame = clueUsedThisGame;
}

export function setPlayersData(newPlayers) {
  localPlayersData = newPlayers ? clone(newPlayers) : []; 
  if (pvpRemoteActive) {
    _networkRoomData.players = newPlayers ? clone(newPlayers) : [];
  } else if (localPlayersData.length > 0 && remainingAttemptsPerPlayer.length !== localPlayersData.length) {
      initRemainingAttempts(localPlayersData.length || 1);
  }
}

export function setCurrentPlayerId(id) { 
    currentPlayerId = id; 
    if (pvpRemoteActive) _networkRoomData.currentPlayerId = id;
}

export function setGamePhase(phase) {
    const validPhases = ['idle', 'lobby', 'playing', 'ended', 'creating_room', 'connecting_to_lobby', 'awaiting_join_approval', 'seeking_match', 'game_over'];
    if (validPhases.includes(phase)) {
        if (pvpRemoteActive) {
            if (_networkRoomData.roomState !== phase) {
                _networkRoomData.roomState = phase; 
            }
            if (gamePhase !== phase) gamePhase = phase; 
        } else { 
            if (gamePhase !== phase) {
                gamePhase = phase;
            }
        }
    } else {
        console.warn(`[State] Attempted to set invalid game phase: ${phase}`);
    }
}

/* ----------  PUBLIC SETTERS for Network State ---------- */
export function setPvpRemoteActive(isActive) { pvpRemoteActive = isActive; }
export function setMyPeerId(id) { myPeerId = id; }

/**
 * Merge a partial update into the live room-state *without*
 * destroying function references (promise resolvers, callbacks, etc.).
 */
export function setNetworkRoomData(partialUpdate) {
  // console.log("[State] setNetworkRoomData (new impl) called with partialUpdate:", partialUpdate);
  // console.log("[State] _networkRoomData BEFORE Object.assign:", JSON.parse(JSON.stringify(getRawNetworkRoomData())));

  if (partialUpdate && typeof partialUpdate === 'object') {
    // Object.assign directly merges properties from partialUpdate into _networkRoomData.
    // If partialUpdate has a function (e.g., _setupCompleteCallback), that function reference is copied.
    Object.assign(_networkRoomData, partialUpdate);
  }
  // console.log("[State] _networkRoomData AFTER Object.assign:", JSON.parse(JSON.stringify(getRawNetworkRoomData())));


  // Sync relevant parts to global state variables IF they were in the partialUpdate
  // This is important if setNetworkRoomData is called with a full game state snapshot from network.
  if (partialUpdate) {
    if (partialUpdate.hasOwnProperty('currentWordObject')) setCurrentWordObject(partialUpdate.currentWordObject);
    if (partialUpdate.hasOwnProperty('guessedLetters')) setGuessedLetters(new Set(partialUpdate.guessedLetters));
    if (partialUpdate.hasOwnProperty('remainingAttemptsPerPlayer')) setRemainingAttemptsPerPlayer(partialUpdate.remainingAttemptsPerPlayer);
    if (partialUpdate.hasOwnProperty('clueUsedThisGame')) setClueUsedThisGame(partialUpdate.clueUsedThisGame);
    if (partialUpdate.hasOwnProperty('currentPlayerId')) setCurrentPlayerId(partialUpdate.currentPlayerId);
    if (partialUpdate.hasOwnProperty('players')) setPlayersData(partialUpdate.players);
    if (partialUpdate.gameSettings?.hasOwnProperty('difficulty')) setCurrentDifficulty(partialUpdate.gameSettings.difficulty);
    
    const oldGameActive = gameActive; // Need to compare with global gameActive
    if (partialUpdate.hasOwnProperty('gameActive')) {
        if (partialUpdate.gameActive !== oldGameActive) {
            setGameActive(partialUpdate.gameActive);
        } else { // Ensure internal _networkRoomData.gameActive is aligned if it wasn't via setGameActive
            if(_networkRoomData.gameActive !== partialUpdate.gameActive) _networkRoomData.gameActive = partialUpdate.gameActive;
        }
    }

    if (partialUpdate.hasOwnProperty('roomState') && partialUpdate.roomState !== _networkRoomData.roomState) {
        // If roomState is being explicitly set by partialUpdate, let setGamePhase handle it
        // and also ensure gameActive is consistent if not part of partialUpdate.
        setGamePhase(partialUpdate.roomState); // This updates _networkRoomData.roomState
        if (!partialUpdate.hasOwnProperty('gameActive')) {
            const expectedGameActive = (partialUpdate.roomState === 'playing');
            if (gameActive !== expectedGameActive) {
                setGameActive(expectedGameActive);
            }
        }
    }
  }
  // console.log("[State] _networkRoomData FINAL after all updates in setNetworkRoomData:", JSON.parse(JSON.stringify(getRawNetworkRoomData())));
}


export function resetNetworkRoomData() {
    const currentDifficultyPreserved = currentDifficulty;
    _networkRoomData = {
        roomId: null, leaderPeerId: null, myPlayerIdInRoom: null, isRoomLeader: false,
        maxPlayers: MAX_PLAYERS_NETWORK, players: [],
        gameSettings: { difficulty: currentDifficultyPreserved }, 
        roomState: 'idle', turnCounter: 0,
        currentWordObject: null, guessedLetters: [], remainingAttemptsPerPlayer: [],
        currentPlayerId: 0, clueUsedThisGame: false, gameActive: false,
        _peerInitPromise: null, 
        _peerInitResolve: null, 
        _peerInitReject: null,  
        _setupCompleteCallback: null, 
        _setupErrorCallback: null,
    };
    if (!pvpRemoteActive) { 
        setGamePhase('idle');
    }
}


export function addPlayerToNetworkRoom(player) { 
    const existingPlayerIndex = _networkRoomData.players.findIndex(p => p.peerId === player.peerId || (p.id !== null && p.id !== undefined && p.id === player.id));
    if (existingPlayerIndex === -1) {
        _networkRoomData.players.push(clone(player));
    } else { 
        _networkRoomData.players[existingPlayerIndex] = { ..._networkRoomData.players[existingPlayerIndex], ...clone(player), isConnected: true };
    }
    _networkRoomData.players.sort((a, b) => (a.id === undefined || a.id === null ? Infinity : a.id) - (b.id === undefined || b.id === null ? Infinity : b.id));
    if (pvpRemoteActive) setPlayersData(_networkRoomData.players);
}

export function removePlayerFromNetworkRoom(peerIdToRemove) { 
    _networkRoomData.players = _networkRoomData.players.filter(p => p.peerId !== peerIdToRemove);
    if (pvpRemoteActive) setPlayersData(_networkRoomData.players);
}

export function updatePlayerInNetworkRoom(peerIdToUpdate, updates) { 
    const playerIndex = _networkRoomData.players.findIndex(p => p.peerId === peerIdToUpdate);
    if (playerIndex !== -1) {
        _networkRoomData.players[playerIndex] = { ..._networkRoomData.players[playerIndex], ...clone(updates) };
        if (pvpRemoteActive) setPlayersData(_networkRoomData.players);
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
  return DEFAULT_ATTEMPTS_PER_PLAYER;
}

export function getRemainingAttemptsPerPlayer() { 
  return [...remainingAttemptsPerPlayer];
}

export function getGameActive() { return gameActive; }
export function getCurrentDifficulty() { return currentDifficulty; }
export function getClueUsedThisGame() { return clueUsedThisGame; }

export function getPlayersData() {
    return clone(localPlayersData);
}

export function getCurrentPlayerId() { return currentPlayerId; } 

export function getGamePhase() { 
    return pvpRemoteActive ? _networkRoomData.roomState : gamePhase;
}

/* ----------  PUBLIC GETTERS for Network State ---------- */
export function getPvpRemoteActive() { return pvpRemoteActive; }
export function getMyPeerId() { return myPeerId; }

/**
 * Read-only snapshot for consumers that should **not** mutate or leak
 * our internal callbacks.  
 * Function values are stripped on purpose.
 */
export function getRawNetworkRoomData() {
  return JSON.parse(
    JSON.stringify(_networkRoomData, (key, value) =>
      typeof value === 'function' ? `[Function ${key}]` : value // Stringify functions for logging if needed, or undefined to strip
    )
  );
}

// Getters for internal callbacks return the direct function reference
export const getInternalPeerInitPromise = () => _networkRoomData._peerInitPromise ?? null;
export const getInternalPeerInitResolve = () => _networkRoomData._peerInitResolve ?? null;
export const getInternalPeerInitReject = () => _networkRoomData._peerInitReject ?? null;
export const getInternalSetupCompleteCallback = () => _networkRoomData._setupCompleteCallback ?? null;
export const getInternalSetupErrorCallback = () => _networkRoomData._setupErrorCallback ?? null;


// Alias for getRawNetworkRoomData if used elsewhere by that name
export function getNetworkRoomData() { 
    return getRawNetworkRoomData();
}

export function getSanitizedNetworkRoomDataForClient() {
    // Use a temporary object from _networkRoomData to avoid cloning functions
    // then clone that temporary object.
    const tempObjectForCloning = { ..._networkRoomData };

    delete tempObjectForCloning._peerInitPromise;
    delete tempObjectForCloning._peerInitResolve;
    delete tempObjectForCloning._peerInitReject;
    delete tempObjectForCloning._setupCompleteCallback;
    delete tempObjectForCloning._setupErrorCallback;
    
    // If full game state shouldn't be in simple lobby updates, remove those too
    // delete tempObjectForCloning.currentWordObject;
    // delete tempObjectForCloning.guessedLetters;
    // etc.

    const clonedSanitizedData = clone(tempObjectForCloning);
    // Ensure players array within is also a clone if present (clone already handles arrays)
    
    return clonedSanitizedData;
}

/* ---------- Combined State Management Functions ---------- */
export function resetScores() {
    if (localPlayersData) localPlayersData.forEach(p => p.score = 0);
    if (_networkRoomData?.players) {
        _networkRoomData.players.forEach(p => p.score = 0);
        if (pvpRemoteActive) setPlayersData(_networkRoomData.players); 
    }
}

export function resetGameFlowState() {
    setCurrentWordObject(null);
    setGuessedLetters(new Set());
    setClueUsedThisGame(false);
    if (pvpRemoteActive && _networkRoomData) {
        _networkRoomData.turnCounter = 0;
        _networkRoomData.currentWordObject = null;
        _networkRoomData.guessedLetters = [];
        _networkRoomData.remainingAttemptsPerPlayer = [];
        _networkRoomData.currentPlayerId = 0;
        _networkRoomData.clueUsedThisGame = false;
        _networkRoomData.gameActive = false; 
    }
}

export function resetFullLocalStateForNewUIScreen() {
    resetGameFlowState(); 
    resetScores();       

    localPlayersData = []; 
    currentPlayerId = 0;
    
    resetNetworkRoomData(); 
    setGameActive(false);   
    setGamePhase('idle');   
}

export function normalizeString(str) { return normalizeStringInternal(str); }

// FIXED: Better player customization function that properly handles network state
export function getLocalPlayerCustomizationForNetwork() {
    console.log("[State] getLocalPlayerCustomizationForNetwork called");
    
    // Get UI elements
    const nameEl = document.getElementById('network-player-name');
    const iconEl = document.getElementById('network-player-icon');
    
    // Get values with fallbacks
    const randomSuffix = Math.floor(Math.random() * 1000);
    const name = nameEl?.value.trim() || `Pizarrín${randomSuffix}`;
    const icon = iconEl?.value || AVAILABLE_ICONS[0];
    
    console.log(`[State] Player customization - Name: "${name}", Icon: "${icon}"`);
    
    // Get current players in room to determine available color
    const currentPlayersInRoom = _networkRoomData?.players || [];
    console.log("[State] Current players in room:", currentPlayersInRoom);
    
    let colorIndex = 0;
    
    if (currentPlayersInRoom.length > 0) {
        // Get colors already in use by connected players (excluding current player if reconnecting)
        const usedColors = new Set();
        currentPlayersInRoom.forEach(p => {
            if (p.isConnected !== false && p.peerId !== myPeerId && p.color) {
                usedColors.add(p.color);
            }
        });
        
        console.log("[State] Used colors:", Array.from(usedColors));
        
        // Find first available color
        for (let i = 0; i < DEFAULT_PLAYER_COLORS.length; i++) {
            if (!usedColors.has(DEFAULT_PLAYER_COLORS[i])) {
                colorIndex = i;
                break;
            }
        }
        
        // If all colors are taken, use modulo fallback
        if (usedColors.size >= DEFAULT_PLAYER_COLORS.length) {
            colorIndex = currentPlayersInRoom.length % DEFAULT_PLAYER_COLORS.length;
        }
    }
    
    const selectedColor = DEFAULT_PLAYER_COLORS[colorIndex];
    console.log(`[State] Selected color index: ${colorIndex}, color: ${selectedColor}`);
    
    return { 
        name, 
        icon, 
        color: selectedColor 
    };
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
    console.log("--- NETWORK STATE (internal _networkRoomData direct access for logging) ---");
    console.log("PVP Remote Active:", pvpRemoteActive);
    console.log("My Peer ID:", myPeerId);
    const loggableNetworkRoomData = { ..._networkRoomData };
    for (const key in loggableNetworkRoomData) {
        if (typeof loggableNetworkRoomData[key] === 'function') {
            loggableNetworkRoomData[key] = `[Function ${key}]`;
        }
    }
    console.log("Network Room Data (RAW - internal, functions stringified for log):", loggableNetworkRoomData);
    console.log("--- Specific Callbacks (direct access for logging from _networkRoomData) ---");
    console.log("_peerInitPromise exists:", !!_networkRoomData._peerInitPromise);
    console.log("_peerInitResolve exists:", !!_networkRoomData._peerInitResolve);
    console.log("_peerInitReject exists:", !!_networkRoomData._peerInitReject);
    console.log("_setupCompleteCallback exists:", !!_networkRoomData._setupCompleteCallback);
    console.log("_setupErrorCallback exists:", !!_networkRoomData._setupErrorCallback);
    console.log("------------------------");
}