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
  // Ensure functions are not part of what we try to clone with JSON.stringify
  if (typeof value === 'function') {
    return value; // Return function reference directly if passed to clone
  }
  if (value instanceof Set) {
    return new Set(Array.from(value)); // Handle Set cloning
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  // For arrays or plain objects
  if (Array.isArray(value)) {
    return value.map(item => clone(item));
  }
  try { 
    // A more robust clone for plain objects, but still won't carry functions through stringify
    // However, setNetworkRoomData explicitly handles callbacks now.
    return JSON.parse(JSON.stringify(value)); 
  }
  catch (e) { 
    console.warn("[State] Clone failed for value:", value, "Error:", e); 
    // Fallback for complex objects not well handled by JSON stringify (e.g. containing functions directly)
    // This is a shallow clone for the top level if JSON stringify fails.
    // Deeper properties might still be references.
    // Given setNetworkRoomData's structure, this part of clone is mostly for the 'data' payload.
    const newObj = { ...value };
    // console.warn("[State] Clone fallback to shallow copy for:", newObj);
    return newObj;
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
    if (pvpRemoteActive) networkRoomData.currentWordObject = currentWordObject;
}

export function setGuessedLetters(newSet) {
    guessedLetters = newSet instanceof Set ? new Set(Array.from(newSet).map(l => typeof l === 'string' ? l.toLowerCase() : l)) : new Set();
    if (pvpRemoteActive) networkRoomData.guessedLetters = Array.from(guessedLetters); 
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
    // console.log(`[State] setGameActive called with: ${isActive}. Current gameActive: ${gameActive}`);
    if (gameActive === isActive) return; // Avoid redundant updates

    gameActive = isActive;
    if (pvpRemoteActive) networkRoomData.gameActive = gameActive;
    
    const currentActualPhase = pvpRemoteActive ? networkRoomData.roomState : gamePhase;
    // console.log(`[State] setGameActive: currentActualPhase is ${currentActualPhase}`);
    if (!isActive && currentActualPhase === 'playing') {
        // console.log(`[State] setGameActive: Game becoming inactive while phase was 'playing'. Setting phase to game_over/ended.`);
        setGamePhase(pvpRemoteActive ? 'game_over' : 'ended');
    } else if (isActive && currentActualPhase !== 'playing') {
        // console.log(`[State] setGameActive: Game becoming active while phase was not 'playing'. Setting phase to 'playing'.`);
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
  // console.log("[State] setPlayersData called with:", newPlayers);
  localPlayersData = newPlayers ? clone(newPlayers) : []; // Clone to avoid external mutations affecting localPlayersData directly
  if (pvpRemoteActive) {
    // console.log("[State] PVP active, syncing networkRoomData.players");
    // Ensure networkRoomData.players is also a fresh clone if structure matches
    networkRoomData.players = newPlayers ? clone(newPlayers) : [];
  } else if (localPlayersData.length > 0 && remainingAttemptsPerPlayer.length !== localPlayersData.length) {
      // console.log("[State] Local game, initializing attempts for new players data.");
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
                // console.log(`[State] Network roomState (phase) set to: ${networkRoomData.roomState}`);
            }
            // Also align the global gamePhase, primarily used for local context but good to keep in sync.
            if (gamePhase !== phase) gamePhase = phase; 
        } else { // Local game
            if (gamePhase !== phase) {
                gamePhase = phase;
                // console.log(`[State] Local gamePhase set to: ${gamePhase}`);
            }
        }
    } else {
        console.warn(`[State] Attempted to set invalid game phase: ${phase}`);
    }
}

/* ----------  PUBLIC SETTERS for Network State ---------- */
export function setPvpRemoteActive(isActive) { 
    // console.log(`[State] Setting PVP Remote Active to: ${isActive}`);
    pvpRemoteActive = isActive; 
}
export function setMyPeerId(id) { 
    // console.log(`[State] Setting My Peer ID to: ${id}`);
    myPeerId = id; 
}


export function setNetworkRoomData(data) {
    // console.log("[State] setNetworkRoomData called with data:", data);
    // console.log("[State] networkRoomData BEFORE update:", {...networkRoomData});

    const oldRoomState = networkRoomData.roomState;
    const oldGameActive = gameActive; // Capture old global gameActive

    // Explicitly handle callbacks: if data provides one, it's the new one. Otherwise, keep the old.
    const new_peerInitPromise = data.hasOwnProperty('_peerInitPromise') ? data._peerInitPromise : networkRoomData._peerInitPromise;
    const new_peerInitResolve = data.hasOwnProperty('_peerInitResolve') ? data._peerInitResolve : networkRoomData._peerInitResolve;
    const new_peerInitReject = data.hasOwnProperty('_peerInitReject') ? data._peerInitReject : networkRoomData._peerInitReject;
    const new_setupCompleteCallback = data.hasOwnProperty('_setupCompleteCallback') ? data._setupCompleteCallback : networkRoomData._setupCompleteCallback;
    const new_setupErrorCallback = data.hasOwnProperty('_setupErrorCallback') ? data._setupErrorCallback : networkRoomData._setupErrorCallback;

    // Clone the rest of the data payload, excluding the callbacks we've handled manually
    // This is important because clone() would strip function properties.
    const dataClone = { ...data }; // Shallow clone is enough if we delete specific properties
    delete dataClone._peerInitPromise;
    delete dataClone._peerInitResolve;
    delete dataClone._peerInitReject;
    delete dataClone._setupCompleteCallback;
    delete dataClone._setupErrorCallback;

    networkRoomData = {
        ...networkRoomData, // Start with current state
        ...clone(dataClone), // Apply cloned incoming data (now without callbacks)
    };

    // Now, specifically assign the callbacks (which are actual function references)
    networkRoomData._peerInitPromise = new_peerInitPromise;
    networkRoomData._peerInitResolve = new_peerInitResolve;
    networkRoomData._peerInitReject = new_peerInitReject;
    networkRoomData._setupCompleteCallback = new_setupCompleteCallback;
    networkRoomData._setupErrorCallback = new_setupErrorCallback;
    
    // console.log("[State] networkRoomData AFTER merge & callback preservation:", {...networkRoomData});

    // Update global state variables from the authoritative data if present in original `data`
    if (data.currentWordObject !== undefined) setCurrentWordObject(data.currentWordObject);
    if (data.guessedLetters !== undefined) setGuessedLetters(new Set(data.guessedLetters));
    if (data.remainingAttemptsPerPlayer !== undefined) setRemainingAttemptsPerPlayer(data.remainingAttemptsPerPlayer); // Already an array
    if (data.clueUsedThisGame !== undefined) setClueUsedThisGame(data.clueUsedThisGame);
    if (data.currentPlayerId !== undefined) setCurrentPlayerId(data.currentPlayerId);
    
    if (data.players) { 
        setPlayersData(data.players); 
    }
    if (data.gameSettings?.difficulty) {
        setCurrentDifficulty(data.gameSettings.difficulty);
    }
    
    // Handle gameActive and gamePhase updates carefully
    if (data.hasOwnProperty('gameActive')) { // If 'gameActive' is explicitly in the update
        if (data.gameActive !== oldGameActive) { // And it's different from the global gameActive
            // console.log(`[State] setNetworkRoomData: data.gameActive (${data.gameActive}) differs from global gameActive (${oldGameActive}). Calling setGameActive.`);
            setGameActive(data.gameActive); // This updates global 'gameActive' and 'networkRoomData.gameActive', and might call setGamePhase.
        } else {
            // Ensure networkRoomData.gameActive is also set if it wasn't already
            if(networkRoomData.gameActive !== data.gameActive) networkRoomData.gameActive = data.gameActive;
        }
    }

    if (data.roomState && data.roomState !== oldRoomState) { 
        // console.log(`[State] setNetworkRoomData: data.roomState (${data.roomState}) differs from oldRoomState (${oldRoomState}). Calling setGamePhase.`);
        setGamePhase(data.roomState); // This updates networkRoomData.roomState and global gamePhase
         // If gameActive wasn't explicitly in data, ensure it's consistent with the new roomState
        if (!data.hasOwnProperty('gameActive')) {
            const expectedGameActiveBasedOnNewRoomState = (data.roomState === 'playing');
            if (gameActive !== expectedGameActiveBasedOnNewRoomState) {
                // console.log(`[State] setNetworkRoomData: Adjusting global gameActive to ${expectedGameActiveBasedOnNewRoomState} based on new roomState ${data.roomState}`);
                setGameActive(expectedGameActiveBasedOnNewRoomState);
            }
        }
    } else if (!data.roomState && networkRoomData.roomState !== oldRoomState && !data.hasOwnProperty('gameActive')) {
        // This case handles if networkRoomData.roomState was changed indirectly (e.g., by setGameActive -> setGamePhase)
        // and `data` didn't provide roomState, we still sync gameActive.
        // console.log(`[State] setNetworkRoomData: networkRoomData.roomState ('${networkRoomData.roomState}') changed indirectly. Syncing gameActive.`);
        if (pvpRemoteActive) { 
            const isActiveBasedOnCurrentRoomState = (networkRoomData.roomState === 'playing');
            if (gameActive !== isActiveBasedOnCurrentRoomState) setGameActive(isActiveBasedOnCurrentRoomState); 
            else if (gamePhase !== networkRoomData.roomState) setGamePhase(networkRoomData.roomState); 
        }
    }
    // console.log("[State] networkRoomData FINAL after all updates:", JSON.parse(JSON.stringify(getRawNetworkRoomData()))); // Log a clone
}


export function resetNetworkRoomData() {
    // console.log("[State] resetNetworkRoomData called.");
    // console.log("[State] networkRoomData BEFORE reset in resetNetworkRoomData:", {...networkRoomData});
    // Callbacks are specific to an operation (hosting/joining/peer init).
    // When resetting the *entire* network room data (e.g. returning to menu), these should be nulled.
    const currentDifficultyPreserved = currentDifficulty; // Preserve current difficulty setting

    networkRoomData = {
        roomId: null, leaderPeerId: null, myPlayerIdInRoom: null, isRoomLeader: false,
        maxPlayers: MAX_PLAYERS_NETWORK, players: [],
        gameSettings: { difficulty: currentDifficultyPreserved }, // Reset with current difficulty
        roomState: 'idle', turnCounter: 0,
        currentWordObject: null, guessedLetters: [], remainingAttemptsPerPlayer: [],
        currentPlayerId: 0, clueUsedThisGame: false, gameActive: false,
        
        _peerInitPromise: null, 
        _peerInitResolve: null, 
        _peerInitReject: null,  
        _setupCompleteCallback: null, 
        _setupErrorCallback: null,
    };
    // console.log("[State] networkRoomData AFTER reset in resetNetworkRoomData:", {...networkRoomData});
    if (!pvpRemoteActive) { // If not in PVP mode, also reset global gamePhase to idle
        setGamePhase('idle');
    }
}


export function addPlayerToNetworkRoom(player) { 
    const existingPlayerIndex = networkRoomData.players.findIndex(p => p.peerId === player.peerId || (p.id !== null && p.id !== undefined && p.id === player.id));
    if (existingPlayerIndex === -1) {
        networkRoomData.players.push(clone(player));
    } else { 
        networkRoomData.players[existingPlayerIndex] = { ...networkRoomData.players[existingPlayerIndex], ...clone(player), isConnected: true };
    }
    networkRoomData.players.sort((a, b) => (a.id === undefined || a.id === null ? Infinity : a.id) - (b.id === undefined || b.id === null ? Infinity : b.id));
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

export function getRawNetworkRoomData() {
    // This clone will strip functions. Callbacks should be accessed via specific getters.
    return clone(networkRoomData);
}

// NEW GETTERS FOR INTERNAL CALLBACKS (do not clone, return direct reference)
export function getInternalPeerInitPromise() { return networkRoomData._peerInitPromise; }
export function getInternalPeerInitResolve() { return networkRoomData._peerInitResolve; }
export function getInternalPeerInitReject() { return networkRoomData._peerInitReject; }
export function getInternalSetupCompleteCallback() { return networkRoomData._setupCompleteCallback; }
export function getInternalSetupErrorCallback() { return networkRoomData._setupErrorCallback; }


export function getNetworkRoomData() { // Alias for getRawNetworkRoomData
    return getRawNetworkRoomData();
}

export function getSanitizedNetworkRoomDataForClient() {
    if (!networkRoomData) return {};
    // Destructure to exclude internal callbacks (which are functions) AND game state not needed for lobby
    const {
        _peerInitPromise, _peerInitResolve, _peerInitReject,
        _setupCompleteCallback, _setupErrorCallback,
        // Exclude detailed game state for simple lobby updates if this is just for lobby view
        // However, if clients need some game state preview, selectively include
        // For now, assuming this is for general lobby data and FULL_GAME_STATE handles game details.
        // currentWordObject, guessedLetters, remainingAttemptsPerPlayer, 
        // currentPlayerId, clueUsedThisGame, gameActive, 
        ...sanitizedDataForLobby 
    } = networkRoomData; // Operate on the direct object to get properties before cloning

    // Clone only the sanitized part
    const clonedSanitizedData = clone(sanitizedDataForLobby);
    // Ensure players array within is also a clone if present
    if (clonedSanitizedData.players) clonedSanitizedData.players = clone(clonedSanitizedData.players);
    
    return clonedSanitizedData;
}

/* ---------- Combined State Management Functions ---------- */
export function resetScores() {
    if (localPlayersData) localPlayersData.forEach(p => p.score = 0);
    if (networkRoomData?.players) {
        networkRoomData.players.forEach(p => p.score = 0);
        if (pvpRemoteActive) setPlayersData(networkRoomData.players); // Sync to localPlayersData if needed
    }
}

export function resetGameFlowState() {
    setCurrentWordObject(null);
    setGuessedLetters(new Set());
    setClueUsedThisGame(false);
    if (pvpRemoteActive && networkRoomData) {
        networkRoomData.turnCounter = 0;
        networkRoomData.currentWordObject = null;
        networkRoomData.guessedLetters = [];
        networkRoomData.remainingAttemptsPerPlayer = [];
        networkRoomData.currentPlayerId = 0;
        networkRoomData.clueUsedThisGame = false;
        networkRoomData.gameActive = false; // This might trigger setGamePhase if not careful
    }
}

export function resetFullLocalStateForNewUIScreen() {
    // console.log("[State] resetFullLocalStateForNewUIScreen called.");
    resetGameFlowState(); 
    resetScores();       

    localPlayersData = []; 
    currentPlayerId = 0;
    // Call setGameActive(false) AFTER resetNetworkRoomData if resetNetworkRoomData sets roomState to 'idle',
    // because setGameActive might change roomState.
    // resetNetworkRoomData will set gameActive to false within networkRoomData.
    
    resetNetworkRoomData(); // This also sets networkRoomData.gameActive = false and roomState = 'idle'
    setGameActive(false);   // Ensure global gameActive is also false, and syncs phase if needed
    setGamePhase('idle');   // Explicitly set global gamePhase to idle
    // console.log("[State] After resetFullLocalStateForNewUIScreen, global gameActive:", gameActive, "global gamePhase:", gamePhase);
}

export function normalizeString(str) { return normalizeStringInternal(str); }

export function getLocalPlayerCustomizationForNetwork() {
    const nameEl = document.getElementById(`network-player-name`);
    const iconEl = document.getElementById(`network-player-icon`);
    const name = nameEl?.value.trim() || `Pizarrín${Math.floor(Math.random()*1000)}`;
    const icon = iconEl?.value || AVAILABLE_ICONS[0];

    let colorIndex = 0;
    const currentPlayersInRoom = networkRoomData?.players || []; // Use internal for direct access
    if (currentPlayersInRoom.length > 0 && currentPlayersInRoom.length < DEFAULT_PLAYER_COLORS.length) {
        const usedColors = new Set(currentPlayersInRoom.filter(p => p.isConnected || p.peerId === myPeerId).map(p => p.color)); 
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
    console.log("--- NETWORK STATE (internal networkRoomData direct access for logging) ---");
    console.log("PVP Remote Active:", pvpRemoteActive);
    console.log("My Peer ID:", myPeerId);
    // For logging, show a version that doesn't expand functions massively in console
    const loggableNetworkRoomData = { ...networkRoomData };
    for (const key in loggableNetworkRoomData) {
        if (typeof loggableNetworkRoomData[key] === 'function') {
            loggableNetworkRoomData[key] = `[Function ${key}]`;
        }
    }
    console.log("Network Room Data (RAW - internal, functions stringified for log):", loggableNetworkRoomData);
    console.log("--- Specific Callbacks (direct access for logging) ---");
    console.log("_peerInitPromise exists:", !!networkRoomData._peerInitPromise);
    console.log("_peerInitResolve exists:", !!networkRoomData._peerInitResolve);
    console.log("_peerInitReject exists:", !!networkRoomData._peerInitReject);
    console.log("_setupCompleteCallback exists:", !!networkRoomData._setupCompleteCallback);
    console.log("_setupErrorCallback exists:", !!networkRoomData._setupErrorCallback);
    console.log("------------------------");
}