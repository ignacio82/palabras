// pizarraState.js

// ---------- GAME CONSTANTS ----------
export const DEFAULT_PLAYER_COLORS = ['#FF69B4', '#00BFFF', '#FFD700', '#32CD32', '#FF7F50', '#DA70D6'];
export const AVAILABLE_ICONS = ['✏️', '🌟', '🍎', '💡', '📖', '🧑‍🏫', '🎓', '🖍️', '🎨', '🏆']; // Themed icons
export const MAX_PLAYERS_LOCAL = 4; // Max local players (if you ever add more than 1 human for local)
export const MAX_PLAYERS_NETWORK = 4;
export const MIN_PLAYERS_NETWORK = 2; // Minimum for a network game

export const MAX_ATTEMPTS = 6;
export const STAR_SYMBOL = "🌟";
export const ALPHABET = "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ".split('');
export const PIZARRA_PEER_ID_PREFIX = "pizarra-"; // Unique prefix for this game

// ---------- CORE GAME STATE (Local & Gameplay) ----------
export let currentWord = ''; // Normalized (uppercase, no accents) word for guessing
export let currentWordObject = null; // Stores { word: "Original", definition: "...", difficulty: "..." }
export let guessedLetters = new Set();
export let remainingAttempts = MAX_ATTEMPTS;
export let gameActive = false;
export let currentDifficulty = "easy"; // Default: "easy", "medium", "hard"
export let clueUsedThisGame = false;

// playersData for the current local game instance (even if it's just one human player)
// For network games, this will be populated by the host based on networkRoomData.players
export let playersData = [];
export let currentPlayerId = 0; // ID of the current player (e.g., 0, 1, 2, 3)

// ---------- NETWORK PLAY STATE ----------
export let pvpRemoteActive = false;
export let myPeerId = null; // This client's raw PeerJS ID

export let networkRoomData = {
    roomId: null,             // Host's raw PeerJS ID, serves as the room identifier
    leaderPeerId: null,       // Host's raw PeerJS ID
    myPlayerIdInRoom: null,   // This client's game-specific ID (0-3) in the network room
    isRoomLeader: false,
    maxPlayers: MAX_PLAYERS_NETWORK,
    players: [],              // Array of player objects for the network room:
                              // { id, peerId, name, icon, color, isReady, isConnected, score }
    gameSettings: {           // Settings determined by the host
        difficulty: "easy",   // Default difficulty for the room
        // language: "es",    // Future: if multiple dictionaries/languages
    },
    roomState: 'idle',        // 'idle', 'connecting_to_lobby', 'awaiting_join_approval',
                              // 'lobby', 'in_game', 'game_over',
                              // 'creating_random_match_room', 'seeking_match'
    turnCounter: 0,           // For synchronizing turns, if necessary

    // Internal promise handlers for PeerJS initialization and connection setup
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
        currentWord = normalizeString(obj.word);
    } else {
        currentWord = "";
    }
}
export function setGuessedLetters(newSet) { guessedLetters = newSet; }
export function setRemainingAttempts(num) { remainingAttempts = num; }
export function setGameActive(isActive) { gameActive = isActive; }
export function setCurrentDifficulty(difficultyStr) { currentDifficulty = difficultyStr; }
export function setClueUsedThisGame(wasUsed) { clueUsedThisGame = wasUsed; }

export function setPlayersData(data) { // For current game instance (local or synced from network)
    playersData = data.map(p => ({ ...p, score: p.score || 0, id: p.id })); // Ensure ID and score
    console.log("[State] setPlayersData (game instance):", JSON.parse(JSON.stringify(playersData)));
}
export function setCurrentPlayerId(id) { currentPlayerId = id; }

// --- Network State Mutators ---
export function setPvpRemoteActive(isActive) { pvpRemoteActive = isActive; }
export function setMyPeerId(id) { myPeerId = id; }

export function setNetworkRoomData(data) { // Merges new data with existing networkRoomData
    const oldRoomState = networkRoomData.roomState;
    const preservedCallbacks = {
        _peerInitPromise: networkRoomData._peerInitPromise,
        _peerInitResolve: networkRoomData._peerInitResolve,
        _peerInitReject: networkRoomData._peerInitReject,
        _setupCompleteCallback: networkRoomData._setupCompleteCallback,
        _setupErrorCallback: networkRoomData._setupErrorCallback,
    };
    networkRoomData = { ...preservedCallbacks, ...networkRoomData, ...data };

    // Ensure callbacks are explicitly managed if passed in data
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
        _peerInitPromise: networkRoomData._peerInitPromise,
        _peerInitResolve: networkRoomData._peerInitResolve,
        _peerInitReject: networkRoomData._peerInitReject,
        _setupCompleteCallback: networkRoomData._setupCompleteCallback,
        _setupErrorCallback: networkRoomData._setupErrorCallback,
    };
    networkRoomData = {
        roomId: null, leaderPeerId: null, myPlayerIdInRoom: null, isRoomLeader: false,
        maxPlayers: MAX_PLAYERS_NETWORK, players: [],
        gameSettings: { difficulty: "easy" }, roomState: 'idle', turnCounter: 0,
        ...preservedCallbacks
    };
}

export function addPlayerToNetworkRoom(player) { // For networkRoomData.players
    const existingPlayerIndex = networkRoomData.players.findIndex(p => p.peerId === player.peerId);
    if (existingPlayerIndex === -1) {
        networkRoomData.players.push(player);
    } else {
        networkRoomData.players[existingPlayerIndex] = { ...networkRoomData.players[existingPlayerIndex], ...player };
    }
    networkRoomData.players.sort((a, b) => (a.id || Infinity) - (b.id || Infinity)); // Sort by game ID
}

export function removePlayerFromNetworkRoom(peerIdToRemove) { // For networkRoomData.players
    const initialCount = networkRoomData.players.length;
    networkRoomData.players = networkRoomData.players.filter(p => p.peerId !== peerIdToRemove);
    if (networkRoomData.players.length < initialCount) {
        console.log(`[State] Player with peerId ${peerIdToRemove} removed from network room.`);
    }
}

export function updatePlayerInNetworkRoom(peerIdToUpdate, updates) { // For networkRoomData.players
    const playerIndex = networkRoomData.players.findIndex(p => p.peerId === peerIdToUpdate);
    if (playerIndex !== -1) {
        networkRoomData.players[playerIndex] = { ...networkRoomData.players[playerIndex], ...updates };
    }
}

// --- Combined State Management Functions ---
export function resetScores() {
    if (playersData) {
        playersData.forEach(p => p.score = 0);
    }
    // For network games, scores are primarily managed in networkRoomData.players by the host
    // and then synced to playersData when a game starts.
    if (networkRoomData && networkRoomData.players) {
        networkRoomData.players.forEach(p => p.score = 0);
    }
}

export function resetGameFlowState() { // Resets for a new round/game
    setCurrentWordObject(null);
    guessedLetters.clear();
    remainingAttempts = MAX_ATTEMPTS;
    // gameActive will be set by startGame logic
    clueUsedThisGame = false;
    // playersData scores are reset by resetScores, called by startGame if needed
    // currentPlayerId is set by startGame
    if (pvpRemoteActive && networkRoomData) {
        networkRoomData.turnCounter = 0; // Reset for network games
    }
    console.log(`[State] resetGameFlowState completed.`);
}

export function resetFullLocalStateForNewUIScreen() { // When going back to main setup screen
    resetGameFlowState();
    resetScores();
    playersData = []; // Clear local game players
    currentPlayerId = 0;
    currentDifficulty = "easy"; // Reset to default
    gameActive = false;

    resetNetworkRoomData(); // Fully resets network state, including promise handlers
    pvpRemoteActive = false;
    myPeerId = null; // If peer session is also closed, this should be null
    console.log("[State] resetFullLocalStateForNewUIScreen completed.");
}


// --- Helper Functions ---
export function normalizeString(str) { // Already in your script.js, good to keep here
    if (!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

export function getLocalPlayerCustomizationForNetwork(playerIndex = 0) { // Default to first player for customization
    // This function will need to read from HTML elements where player customizes their appearance
    // For now, placeholder. main.js will populate this from UI inputs.
    const nameEl = document.getElementById(`player-name-${playerIndex}`); // Assuming an ID convention
    const iconEl = document.getElementById(`player-icon-${playerIndex}`);
    const colorEl = document.getElementById(`player-color-${playerIndex}`);

    return {
        name: nameEl?.value || `Jugador ${playerIndex + 1}`,
        icon: iconEl?.value || AVAILABLE_ICONS[playerIndex % AVAILABLE_ICONS.length],
        color: colorEl?.value || DEFAULT_PLAYER_COLORS[playerIndex % DEFAULT_PLAYER_COLORS.length]
    };
}

export function getSanitizedNetworkRoomDataForClient() { // To avoid sending internal promise handlers
    if (!networkRoomData) return {};
    const {
        _peerInitPromise, _peerInitResolve, _peerInitReject,
        _setupCompleteCallback, _setupErrorCallback,
        ...sanitizedData
    } = networkRoomData;
    return sanitizedData;
}

export function logCurrentState(context = "Generic") {
    console.log(`--- CURRENT GAME STATE (${context}) ---`);
    console.log("Difficulty:", currentDifficulty, "Game Active:", gameActive);
    console.log("Word Object:", currentWordObject ? currentWordObject.word : "N/A", "Norm Word:", currentWord);
    console.log("Attempts Left:", remainingAttempts, "Clue Used:", clueUsedThisGame);
    console.log("Guessed Letters:", Array.from(guessedLetters).join(', '));
    console.log("Players Data (Game Instance):", JSON.parse(JSON.stringify(playersData)));
    console.log("Current Player ID (Game Instance):", currentPlayerId);
    console.log("--- NETWORK STATE ---");
    console.log("PVP Remote Active:", pvpRemoteActive);
    console.log("My Peer ID:", myPeerId);
    console.log("Network Room Data (Sanitized):", JSON.parse(JSON.stringify(getSanitizedNetworkRoomDataForClient())));
    console.log("------------------------");
}