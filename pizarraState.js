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
let remainingAttemptsPerPlayer = []; 
let currentPlayerId = 0; 
let gameActive = false; 
let gamePhase = 'idle'; 
let currentDifficulty = "easy";
let clueUsedThisGame = false;

// Network Play State
let pvpRemoteActive = false; 
let myPeerId = null; 

// THIS IS THE SINGLE SOURCE OF TRUTH FOR NETWORK ROOM DATA
let networkRoomData = {
    roomId: null,              
    leaderPeerId: null,        
    myPlayerIdInRoom: null,    
    isRoomLeader: false,       
    maxPlayers: MAX_PLAYERS_NETWORK,
    players: [],               
    gameSettings: { difficulty: "easy" }, 
    roomState: 'idle',         
    turnCounter: 0,            

    // Palabras game state snapshot for synchronization via FULL_GAME_STATE
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
    // Sync to networkRoomData snapshot if pvp is active
    if (pvpRemoteActive) networkRoomData.currentWordObject = currentWordObject;
}

export function setGuessedLetters(newSet) {
    guessedLetters = newSet instanceof Set ? new Set(Array.from(newSet).map(l => typeof l === 'string' ? l.toLowerCase() : l)) : new Set();
    if (pvpRemoteActive) networkRoomData.guessedLetters = Array.from(guessedLetters); // Sync as array
}

export function initRemainingAttempts(numPlayers, attempts = DEFAULT_ATTEMPTS_PER_PLAYER) {
  remainingAttemptsPerPlayer = Array(Math.max(1, numPlayers)).fill(attempts);
  if (pvpRemoteActive) networkRoomData.remainingAttemptsPerPlayer = [...remainingAttemptsPerPlayer];
}

export function setRemainingAttemptsPerPlayer(newArray) {
  if (Array.isArray(newArray)) {
    remainingAttemptsPerPlayer = Array.from(newArray);
    if (pvpRemoteActive) networkRoomData.remainingAttemptsPerPlayer = [...remainingAttemptsPerPlayer];
  } else {
    console.error("[State] setRemainingAttemptsPerPlayer: Provided value is not an array.", newArray);
  }
}

export function decAttemptsFor(playerId) {
  if (playerId >= 0 && playerId < remainingAttemptsPerPlayer.length) {
    if (remainingAttemptsPerPlayer[playerId] > 0) {
        remainingAttemptsPerPlayer[playerId]--;
        if (pvpRemoteActive) networkRoomData.remainingAttemptsPerPlayer = [...remainingAttemptsPerPlayer];
    }
  }
}

export function setGameActive(isActive) {
    gameActive = isActive;
    if (pvpRemoteActive) networkRoomData.gameActive = gameActive;
    const currentActualPhase = pvpRemoteActive ? networkRoomData.roomState : gamePhase;
    if (!isActive && currentActualPhase === 'playing') {
        setGamePhase(pvpRemoteActive ? 'game_over' : 'ended');
    } else if (isActive && currentActualPhase !== 'playing') {
        setGamePhase('playing');
    }
}

export function setCurrentDifficulty(difficultyStr) { 
    currentDifficulty = difficultyStr; 
    if (pvpRemoteActive) {
        if (!networkRoomData.gameSettings) networkRoomData.gameSettings = {};
        networkRoomData.gameSettings.difficulty = currentDifficulty;
    }
}

export function setClueUsedThisGame(wasUsed) { 
    clueUsedThisGame = wasUsed; 
    if (pvpRemoteActive) networkRoomData.clueUsedThisGame = clueUsedThisGame;
}

export function setPlayersData(newPlayers) {
  localPlayersData = newPlayers ? clone(newPlayers) : [];
  if (pvpRemoteActive) {
    // If these are the game instance players being set, reflect in networkRoomData.players if structure matches
    networkRoomData.players = clone(localPlayersData);
  } else if (localPlayersData.length > 0) { 
      initRemainingAttempts(localPlayersData.length || 1);
  }
}

export function setCurrentPlayerId(id) { 
    currentPlayerId = id; 
    if (pvpRemoteActive) networkRoomData.currentPlayerId = id;
}

export function setGamePhase(phase) {
    const validPhases = ['idle', 'lobby', 'playing', 'ended', 'creating_room', 'connecting_to_lobby', 'awaiting_join_approval', 'seeking_match', 'game_over'];
    if (validPhases.includes(phase)) {
        if (pvpRemoteActive) {
            if (networkRoomData.roomState !== phase) {
                networkRoomData.roomState = phase; 
                console.log(`[State] Network roomState (phase) set to: ${networkRoomData.roomState}`);
            }
            gamePhase = phase; // Keep global gamePhase in sync with network roomState
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

// This function updates the *single* networkRoomData object and syncs relevant parts to global state.
// pizarraState.js

export function setNetworkRoomData(data) {
    // console.log("[State] setNetworkRoomData called with data:", data);
    // console.log("[State] networkRoomData BEFORE update:", {...networkRoomData});

    const oldRoomState = networkRoomData.roomState;

    // Explicitly preserve existing internal callbacks if not being overwritten by `data`
    const preserved_peerInitPromise = data.hasOwnProperty('_peerInitPromise') ? data._peerInitPromise : networkRoomData._peerInitPromise;
    const preserved_peerInitResolve = data.hasOwnProperty('_peerInitResolve') ? data._peerInitResolve : networkRoomData._peerInitResolve;
    const preserved_peerInitReject = data.hasOwnProperty('_peerInitReject') ? data._peerInitReject : networkRoomData._peerInitReject;
    const preserved_setupCompleteCallback = data.hasOwnProperty('_setupCompleteCallback') ? data._setupCompleteCallback : networkRoomData._setupCompleteCallback;
    const preserved_setupErrorCallback = data.hasOwnProperty('_setupErrorCallback') ? data._setupErrorCallback : networkRoomData._setupErrorCallback;

    // Clone the incoming data, which might strip functions if they were part of `data`
    const clonedDataPayload = clone(data);

    // Merge: Start with existing, overlay with cloned payload, then ensure callbacks are correctly set.
    networkRoomData = {
        ...networkRoomData,
        ...clonedDataPayload // Apply changes from data (functions potentially stripped by clone)
    };

    // Re-apply/preserve the callbacks explicitly to ensure functions are not lost by cloning
    networkRoomData._peerInitPromise = preserved_peerInitPromise;
    networkRoomData._peerInitResolve = preserved_peerInitResolve;
    networkRoomData._peerInitReject = preserved_peerInitReject;
    networkRoomData._setupCompleteCallback = preserved_setupCompleteCallback;
    networkRoomData._setupErrorCallback = preserved_setupErrorCallback;
    
    // console.log("[State] networkRoomData AFTER callback preservation:", {...networkRoomData});

    // Update global state variables from the authoritative data received (e.g., from host via FULL_GAME_STATE)
    // These should use the original `data` object in case they expect functions, though unlikely for these.
    if (data.currentWordObject !== undefined) setCurrentWordObject(data.currentWordObject);
    if (data.guessedLetters !== undefined) setGuessedLetters(new Set(data.guessedLetters)); // data.guessedLetters is already an array from network
    if (data.remainingAttemptsPerPlayer !== undefined) setRemainingAttemptsPerPlayer(clone(data.remainingAttemptsPerPlayer));
    if (data.clueUsedThisGame !== undefined) setClueUsedThisGame(data.clueUsedThisGame);
    if (data.currentPlayerId !== undefined) setCurrentPlayerId(data.currentPlayerId);
    
    if (data.players) { 
        // console.log("[State] setNetworkRoomData updating players from data:", data.players);
        setPlayersData(data.players); 
    }
    if (data.gameSettings?.difficulty) {
        // console.log("[State] setNetworkRoomData updating difficulty from data:", data.gameSettings.difficulty);
        setCurrentDifficulty(data.gameSettings.difficulty);
    }

    // Handle gameActive and gamePhase updates carefully
    // Order matters: setGameActive might call setGamePhase.
    // If data.gameActive is present, it drives the gameActive state.
    // If data.roomState is present, it drives the gamePhase state.
    let gameActiveChangedByThisCall = false;
    if (data.hasOwnProperty('gameActive') && data.gameActive !== gameActive) {
        // console.log(`[State] setNetworkRoomData: gameActive changing from ${gameActive} to ${data.gameActive}`);
        setGameActive(data.gameActive); // This might call setGamePhase
        gameActiveChangedByThisCall = true;
    }

    if (data.roomState && data.roomState !== networkRoomData.roomState) { // If new roomState provided and different
        // console.log(`[State] setNetworkRoomData: roomState changing from ${networkRoomData.roomState} to ${data.roomState}`);
        if (pvpRemoteActive) {
            setGamePhase(data.roomState); // This updates networkRoomData.roomState and gamePhase
             // If gameActive wasn't explicitly in data, ensure it's consistent with the new roomState
            if (!data.hasOwnProperty('gameActive')) {
                const expectedGameActive = (data.roomState === 'playing');
                if (gameActive !== expectedGameActive) {
                    // console.log(`[State] setNetworkRoomData: Adjusting gameActive to ${expectedGameActive} based on new roomState ${data.roomState}`);
                    setGameActive(expectedGameActive);
                }
            }
        } else { // local game, data.roomState shouldn't really happen unless it's from internal logic
            setGamePhase(data.roomState);
        }
    } else if (!data.roomState && networkRoomData.roomState && networkRoomData.roomState !== oldRoomState && !gameActiveChangedByThisCall) {
        // If networkRoomData.roomState was changed by some other means (e.g. setGameActive calling setGamePhase)
        // and data didn't provide a new roomState, ensure consistency.
        // console.log(`[State] setNetworkRoomData: networkRoomData.roomState ('${networkRoomData.roomState}') differs from oldRoomState ('${oldRoomState}'). Syncing gameActive/gamePhase.`);
        if (pvpRemoteActive) { 
            const isActiveBasedOnCurrentRoomState = (networkRoomData.roomState === 'playing');
            if (gameActive !== isActiveBasedOnCurrentRoomState) setGameActive(isActiveBasedOnCurrentRoomState); 
            else if (gamePhase !== networkRoomData.roomState) setGamePhase(networkRoomData.roomState); 
        }
    }
    // console.log("[State] networkRoomData FINAL:", {...networkRoomData});
}

export function resetNetworkRoomData() {
    // Preserve setupCompleteCallback and setupErrorCallback if they exist from a previous operation that hasn't finished.
    // However, peer initialization related promises and their resolvers should be cleared to ensure a fresh start.
    const preservedSetupCallbacks = {
        _setupCompleteCallback: networkRoomData._setupCompleteCallback,
        _setupErrorCallback: networkRoomData._setupErrorCallback,
    };

    networkRoomData = {
        roomId: null, leaderPeerId: null, myPlayerIdInRoom: null, isRoomLeader: false,
        maxPlayers: MAX_PLAYERS_NETWORK, players: [],
        gameSettings: { difficulty: currentDifficulty }, // Keep current difficulty as a default
        roomState: 'idle', turnCounter: 0,
        currentWordObject: null, guessedLetters: [], remainingAttemptsPerPlayer: [],
        currentPlayerId: 0, clueUsedThisGame: false, gameActive: false,
        
        _peerInitPromise: null, // Explicitly nullify
        _peerInitResolve: null, // Explicitly nullify
        _peerInitReject: null,  // Explicitly nullify
        
        ...preservedSetupCallbacks // Restore only these two if they were set
    };
    if (!pvpRemoteActive) { 
        setGamePhase('idle');
    }
}


export function addPlayerToNetworkRoom(player) { 
    const existingPlayerIndex = networkRoomData.players.findIndex(p => p.peerId === player.peerId || (p.id !== null && p.id === player.id));
    if (existingPlayerIndex === -1) {
        networkRoomData.players.push(clone(player));
    } else { 
        networkRoomData.players[existingPlayerIndex] = { ...networkRoomData.players[existingPlayerIndex], ...clone(player), isConnected: true };
    }
    networkRoomData.players.sort((a, b) => (a.id === undefined || a.id === null ? Infinity : a.id) - (b.id === undefined || b.id === null ? Infinity : b.id));
    // Sync to localPlayersData if pvpRemoteActive, as this list is authoritative for the game instance
    if (pvpRemoteActive) setPlayersData(networkRoomData.players);
}

export function removePlayerFromNetworkRoom(peerIdToRemove) { 
    networkRoomData.players = networkRoomData.players.filter(p => p.peerId !== peerIdToRemove);
    if (pvpRemoteActive) setPlayersData(networkRoomData.players);
}

export function updatePlayerInNetworkRoom(peerIdToUpdate, updates) { 
    const playerIndex = networkRoomData.players.findIndex(p => p.peerId === peerIdToUpdate);
    if (playerIndex !== -1) {
        networkRoomData.players[playerIndex] = { ...networkRoomData.players[playerIndex], ...clone(updates) };
        if (pvpRemoteActive) setPlayersData(networkRoomData.players);
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
    return pvpRemoteActive ? networkRoomData.roomState : gamePhase;
}

/* ----------  PUBLIC GETTERS for Network State ---------- */
export function getPvpRemoteActive() { return pvpRemoteActive; }
export function getMyPeerId() { return myPeerId; }

// Returns a clone of the *entire internal* networkRoomData object.
export function getRawNetworkRoomData() {
    return clone(networkRoomData);
}

// Alias for consistency with Cajitas code
export function getNetworkRoomData() {
    return getRawNetworkRoomData();
}

// Returns a version of networkRoomData suitable for sending to clients for lobby updates.
export function getSanitizedNetworkRoomDataForClient() {
    if (!networkRoomData) return {};
    // Destructure to exclude internal callbacks and sensitive game state not needed for lobby view
    const {
        _peerInitPromise, _peerInitResolve, _peerInitReject,
        _setupCompleteCallback, _setupErrorCallback,
        currentWordObject, guessedLetters, remainingAttemptsPerPlayer, // Exclude detailed game state for simple lobby updates
        currentPlayerId, clueUsedThisGame, gameActive, // These are part of FULL_GAME_STATE
        ...sanitizedDataForLobby // Includes players, roomState, gameSettings, roomId, leaderPeerId etc.
    } = networkRoomData;
    if (sanitizedDataForLobby.players) sanitizedDataForLobby.players = clone(sanitizedDataForLobby.players);
    return clone(sanitizedDataForLobby);
}

/* ---------- Combined State Management Functions ---------- */
export function resetScores() {
    if (localPlayersData) localPlayersData.forEach(p => p.score = 0);
    if (networkRoomData?.players) {
        networkRoomData.players.forEach(p => p.score = 0);
        // If scores are reset, localPlayersData (used by gameLogic) should also reflect this
        if (pvpRemoteActive) setPlayersData(networkRoomData.players);
    }
}

export function resetGameFlowState() {
    setCurrentWordObject(null);
    setGuessedLetters(new Set());
    setClueUsedThisGame(false);
    // remainingAttemptsPerPlayer and currentPlayerId are typically reset by initializeGame
    if (pvpRemoteActive && networkRoomData) {
        networkRoomData.turnCounter = 0;
        // Reset game-specific snapshot fields in networkRoomData too
        networkRoomData.currentWordObject = null;
        networkRoomData.guessedLetters = [];
        networkRoomData.remainingAttemptsPerPlayer = [];
        networkRoomData.currentPlayerId = 0;
        networkRoomData.clueUsedThisGame = false;
        networkRoomData.gameActive = false;
    }
}

export function resetFullLocalStateForNewUIScreen() {
    resetGameFlowState(); 
    resetScores();       

    localPlayersData = []; 
    currentPlayerId = 0;
    setGameActive(false); 
    remainingAttemptsPerPlayer = []; 
    
    resetNetworkRoomData(); // This will now clear _peerInitPromise etc.
    setGamePhase('idle'); 
}

export function normalizeString(str) { return normalizeStringInternal(str); }

export function getLocalPlayerCustomizationForNetwork() {
    const nameEl = document.getElementById(`network-player-name`);
    const iconEl = document.getElementById(`network-player-icon`);
    const name = nameEl?.value.trim() || `Pizarrín${Math.floor(Math.random()*1000)}`;
    const icon = iconEl?.value || AVAILABLE_ICONS[0];

    let colorIndex = 0;
    const currentPlayersInRoom = networkRoomData?.players || [];
    if (currentPlayersInRoom.length > 0 && currentPlayersInRoom.length < DEFAULT_PLAYER_COLORS.length) {
        const usedColors = new Set(currentPlayersInRoom.filter(p => p.isConnected || p.peerId === myPeerId).map(p => p.color)); // Consider only connected or self
        for (let i = 0; i < DEFAULT_PLAYER_COLORS.length; i++) {
            if (!usedColors.has(DEFAULT_PLAYER_COLORS[i])) {
                colorIndex = i;
                break;
            }
            if (i === DEFAULT_PLAYER_COLORS.length -1) {
                colorIndex = currentPlayersInRoom.length % DEFAULT_PLAYER_COLORS.length;
            }
        }
    } else if (currentPlayersInRoom.length >= DEFAULT_PLAYER_COLORS.length) {
         colorIndex = currentPlayersInRoom.length % DEFAULT_PLAYER_COLORS.length;
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
    console.log("Network Room Data (RAW - internal snapshot):", getRawNetworkRoomData()); // Log the full internal object for debug
    console.log("------------------------");
}