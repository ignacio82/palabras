// pizarraPeerConnection.js

import * as state from './pizarraState.js';
import * as logic from './gameLogic.js'; // Host uses this to process game events

// Note: UI updates (e.g., showLobbyScreen, updateLobbyUI) will be triggered by main.js
// in response to state changes or by callbacks/events from this module.
// For now, this module focuses on network logic and state updates.

const PIZARRA_BASE_URL = "https://palabras.martinez.fyi"; // Corrected line


let connections = new Map(); // For host: peerId -> { connObject, playerGameId (game-specific ID), status }
let leaderConnection = null; // For client: PeerJS DataConnection object to the host

// --- Message Types ---
export const MSG_TYPE = {
    REQUEST_JOIN_ROOM: 'req_join_pizarra',
    JOIN_ACCEPTED: 'join_accept_pizarra',
    JOIN_REJECTED: 'join_reject_pizarra',
    PLAYER_JOINED: 'player_joined_pizarra',
    PLAYER_LEFT: 'player_left_pizarra',
    ROOM_STATE_UPDATE: 'room_state_pizarra',
    PLAYER_READY_CHANGED: 'ready_change_pizarra',
    // START_GAME_REQUEST is an action in main.js by host, leading to GAME_STARTED broadcast
    GAME_STARTED: 'game_started_pizarra',
    LETTER_GUESS: 'guess_letter_pizarra',
    GUESS_RESULT: 'guess_result_pizarra',
    CLUE_REQUEST: 'req_clue_pizarra',
    CLUE_PROVIDED: 'clue_provided_pizarra',
    GAME_OVER_ANNOUNCEMENT: 'game_over_pizarra',
    ERROR_MESSAGE: 'error_message_pizarra' // Generic error message from host
};

// --- PeerJS Callbacks (passed to peerjs-multiplayer.js) ---
const peerJsCallbacks = {
    onPeerOpen: (id) => {
        console.log(`[PizarraPeerConn] My PeerJS ID: ${id}.`);
        state.setMyPeerId(id);
        if (state.networkRoomData._peerInitResolve) {
            state.networkRoomData._peerInitResolve(id);
            state.setNetworkRoomData({ _peerInitResolve: null, _peerInitReject: null });
        }
        if (state.networkRoomData._setupCompleteCallback) {
            if (state.networkRoomData.isRoomLeader) _finalizeHostSetup(id);
            else if (state.networkRoomData.leaderPeerId) _finalizeClientJoinAttempt(id, state.networkRoomData.leaderPeerId);
        }
    },
    onNewConnection: (conn) => { // Host: New client trying to connect
        if (!state.networkRoomData.isRoomLeader) {
            conn.on('open', () => conn.close()); return;
        }
        if (state.networkRoomData.players.length >= state.networkRoomData.maxPlayers) {
            conn.on('open', () => {
                conn.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }
        connections.set(conn.peer, { connObject: conn, status: 'pending_join_request', playerGameId: -1 });
        setupConnectionEventHandlers(conn);
    },
    onConnectionOpen: (remotePeerId) => {
        if (state.networkRoomData.isRoomLeader) {
            const connEntry = connections.get(remotePeerId);
            if (connEntry) connEntry.status = 'awaiting_join_request';
        } else { // Client
            if (remotePeerId === state.networkRoomData.leaderPeerId && leaderConnection && leaderConnection.open) {
                const myPlayerData = state.getLocalPlayerCustomizationForNetwork();
                sendDataToLeader({
                    type: MSG_TYPE.REQUEST_JOIN_ROOM,
                    playerData: { name: myPlayerData.name, icon: myPlayerData.icon, color: myPlayerData.color }
                });
                state.setNetworkRoomData({ roomState: 'awaiting_join_approval' });
                // main.js shows "Connecting..." or similar modal
            }
        }
    },
    onDataReceived: (data, fromPeerId) => {
        if (state.networkRoomData.isRoomLeader) {
            handleLeaderDataReception(data, fromPeerId);
        } else {
            handleClientDataReception(data, fromPeerId);
        }
    },
    onConnectionClose: (peerId) => {
        if (state.networkRoomData.isRoomLeader) {
            const leavingPlayerEntry = connections.get(peerId);
            if (leavingPlayerEntry && leavingPlayerEntry.playerGameId !== -1) {
                const leavingPlayer = state.networkRoomData.players.find(p => p.id === leavingPlayerEntry.playerGameId);
                state.removePlayerFromNetworkRoom(peerId);
                connections.delete(peerId);
                if (leavingPlayer) {
                    broadcastToRoom({ type: MSG_TYPE.PLAYER_LEFT, player: { id: leavingPlayer.id, name: leavingPlayer.name, peerId: peerId } });
                }
                // main.js to update lobby UI and matchmaking status
                if (state.networkRoomData.roomState === 'in_game' && state.networkRoomData.players.length < state.MIN_PLAYERS_NETWORK) {
                    broadcastToRoom({ type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, reason: 'disconnect_insufficient_players'});
                    state.setNetworkRoomData({ roomState: 'game_over' });
                    // main.js handles UI for game over
                }
            }
        } else { // Client
            if (peerId === state.networkRoomData.leaderPeerId) {
                if (state.networkRoomData._setupErrorCallback) {
                    state.networkRoomData._setupErrorCallback(new Error("Conexión con el líder perdida."));
                }
                state.resetFullLocalStateForNewUIScreen();
            }
        }
    },
    onError: (err) => {
        console.error(`[PizarraPeerConn] PeerJS Error: ${err.type}`, err.message || err);
        if (state.networkRoomData._peerInitReject) {
            state.networkRoomData._peerInitReject(err);
            state.setNetworkRoomData({ _peerInitResolve: null, _peerInitReject: null });
        }
        if (state.networkRoomData._setupErrorCallback) {
            state.networkRoomData._setupErrorCallback(err);
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        }
    }
};

// --- Internal Setup Finalizers ---
function _finalizeHostSetup(hostPeerId) {
    if (!state.networkRoomData._setupCompleteCallback) return;
    state.setNetworkRoomData({
        roomId: hostPeerId,
        leaderPeerId: hostPeerId,
        players: state.networkRoomData.players.map(p => p.id === 0 ? { ...p, peerId: hostPeerId, isConnected: true, isReady: true } : p),
        roomState: 'lobby'
    });
    state.networkRoomData._setupCompleteCallback(hostPeerId);
    state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
}

function _finalizeClientJoinAttempt(myPeerId, leaderPeerIdToJoin) {
    if (!state.networkRoomData._setupCompleteCallback && !state.networkRoomData._setupErrorCallback) return;
    if (state.networkRoomData.isRoomLeader || !leaderPeerIdToJoin || !state.pvpRemoteActive) {
        if(state.networkRoomData._setupErrorCallback) state.networkRoomData._setupErrorCallback(new Error("Client join conditions not met"));
        state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        return;
    }
    state.setNetworkRoomData({ players: state.networkRoomData.players.map(p => ({...p, peerId: myPeerId})) });

    if (window.peerJsMultiplayer?.connect) {
        const connToLeader = window.peerJsMultiplayer.connect(leaderPeerIdToJoin);
        if (connToLeader) {
            leaderConnection = connToLeader;
            setupConnectionEventHandlers(leaderConnection);
        } else {
            peerJsCallbacks.onError({ type: 'connect_failed', message: `Failed to init connection to ${leaderPeerIdToJoin}.` });
        }
    } else {
        peerJsCallbacks.onError({ type: 'internal_error', message: 'PeerJS connect fn not available.' });
    }
}

// --- Public API ---
export async function ensurePeerInitialized() {
    const existingPeer = window.peerJsMultiplayer?.getPeer();
    let currentPeerId = window.peerJsMultiplayer?.getLocalId();

    if (existingPeer && !existingPeer.destroyed && currentPeerId) {
        if (state.myPeerId !== currentPeerId) state.setMyPeerId(currentPeerId);
        if (state.networkRoomData._setupCompleteCallback) {
            if (state.networkRoomData.isRoomLeader) _finalizeHostSetup(currentPeerId);
            else if (state.networkRoomData.leaderPeerId) _finalizeClientJoinAttempt(currentPeerId, state.networkRoomData.leaderPeerId);
        }
        return currentPeerId;
    }
    if (state.networkRoomData._peerInitPromise) return state.networkRoomData._peerInitPromise;

    const initPromise = new Promise((resolve, reject) => {
        state.setNetworkRoomData({ _peerInitResolve: resolve, _peerInitReject: reject });
        if (window.peerJsMultiplayer?.init) {
            window.peerJsMultiplayer.init(null, peerJsCallbacks);
        } else {
            reject(new Error('PeerJS wrapper not ready.'));
        }
    });
    state.setNetworkRoomData({ _peerInitPromise: initPromise });
    try {
        const newPeerId = await initPromise;
        state.setNetworkRoomData({ _peerInitPromise: null }); return newPeerId;
    } catch (err) {
        state.setNetworkRoomData({ _peerInitPromise: null }); throw err;
    }
}

export function hostNewRoom(hostPlayerData, gameSettingsFromUI) {
    state.resetFullLocalStateForNewUIScreen();
    state.setPvpRemoteActive(true);
    return new Promise(async (resolve, reject) => {
        state.setNetworkRoomData({
            isRoomLeader: true, myPlayerIdInRoom: 0,
            gameSettings: { difficulty: gameSettingsFromUI.difficulty || "easy" },
            maxPlayers: parseInt(gameSettingsFromUI.maxPlayers) || state.MAX_PLAYERS_NETWORK,
            players: [{ id: 0, peerId: null, name: hostPlayerData.name, icon: hostPlayerData.icon, color: hostPlayerData.color, isReady: true, isConnected: true, score: 0 }],
            roomState: 'creating_room',
            _setupCompleteCallback: resolve, _setupErrorCallback: reject
        });
        try { await ensurePeerInitialized(); }
        catch (err) {
            if(state.networkRoomData._setupErrorCallback === reject) reject(err);
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        }
    });
}

export function joinRoomById(leaderRawPeerId, joinerPlayerData) {
    state.resetFullLocalStateForNewUIScreen();
    state.setPvpRemoteActive(true);
    return new Promise(async (resolve, reject) => {
        state.setNetworkRoomData({
            roomId: leaderRawPeerId, leaderPeerId: leaderRawPeerId, isRoomLeader: false,
            players: [{ name: joinerPlayerData.name, icon: joinerPlayerData.icon, color: joinerPlayerData.color, peerId: null }],
            roomState: 'connecting_to_lobby',
            _setupCompleteCallback: resolve, _setupErrorCallback: reject
        });
        try { await ensurePeerInitialized(); }
        catch (err) {
            if(state.networkRoomData._setupErrorCallback === reject) reject(err);
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        }
    });
}

function setupConnectionEventHandlers(conn) {
    conn.on('open', () => peerJsCallbacks.onConnectionOpen(conn.peer));
    conn.on('data', (data) => peerJsCallbacks.onDataReceived(data, conn.peer));
    conn.on('close', () => peerJsCallbacks.onConnectionClose(conn.peer));
    conn.on('error', (err) => peerJsCallbacks.onError(err));
}

// --- Data Sending ---
function sendDataToLeader(data) {
    if (leaderConnection?.open) leaderConnection.send(data);
    else peerJsCallbacks.onError({type: 'send_error_no_connection', message: 'No open connection to leader.'});
}
function sendDataToClient(clientPeerId, data) {
    const connEntry = connections.get(clientPeerId);
    if (connEntry?.connObject?.open) connEntry.connObject.send(data);
    else console.warn(`[PizarraPeerConn L] No open conn to client ${clientPeerId}. Cannot send.`);
}
function broadcastToRoom(data, excludePeerId = null) {
    if (!state.networkRoomData.isRoomLeader) return;
    connections.forEach((connEntry, peerId) => {
        if (peerId !== excludePeerId && connEntry?.connObject?.open) {
            try { connEntry.connObject.send(data); } catch (e) {}
        }
    });
}
export function broadcastRoomState() {
    if (!state.networkRoomData.isRoomLeader) return;
    broadcastToRoom({ type: MSG_TYPE.ROOM_STATE_UPDATE, roomData: state.getSanitizedNetworkRoomDataForClient() });
}

// --- Message Handlers ---
function handleLeaderDataReception(data, fromPeerId) {
    const connEntry = connections.get(fromPeerId);
    const playerGameId = connEntry?.playerGameId !== -1 ? connEntry.playerGameId : state.networkRoomData.players.find(p=>p.peerId === fromPeerId)?.id;

    switch (data.type) {
        case MSG_TYPE.REQUEST_JOIN_ROOM:
            const clientConnObj = connEntry?.connObject || window.peerJsMultiplayer.getConnection(fromPeerId);
            if (!clientConnObj) return;

            if (state.networkRoomData.players.length >= state.networkRoomData.maxPlayers) {
                clientConnObj.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' }); return;
            }
            const newPlayerId = state.networkRoomData.players.length > 0 ? Math.max(...state.networkRoomData.players.map(p => p.id)) + 1 : 1;
            const newPlayer = { id: newPlayerId, peerId: fromPeerId, ...data.playerData, isReady: false, isConnected: true, score: 0 };
            state.addPlayerToNetworkRoom(newPlayer);
            if(connEntry) connEntry.playerGameId = newPlayerId;
            else connections.set(fromPeerId, {connObject: clientConnObj, playerGameId: newPlayerId, status: 'active'});

            sendDataToClient(fromPeerId, { type: MSG_TYPE.JOIN_ACCEPTED, yourPlayerIdInRoom: newPlayerId, roomData: state.getSanitizedNetworkRoomDataForClient() });
            broadcastToRoom({ type: MSG_TYPE.PLAYER_JOINED, player: newPlayer }, fromPeerId);
            break;

        case MSG_TYPE.PLAYER_READY_CHANGED:
            if (playerGameId !== undefined) {
                state.updatePlayerInNetworkRoom(fromPeerId, { isReady: data.isReady });
                broadcastToRoom({ type: MSG_TYPE.PLAYER_READY_CHANGED, player: { id: playerGameId, isReady: data.isReady } });
            }
            break;

        case MSG_TYPE.LETTER_GUESS:
            if (playerGameId === state.currentPlayerId && state.gameActive) {
                const result = logic.processGuess(state, data.letter);

                let nextPlayerIdAfterGuess = state.currentPlayerId;
                if (!result.correct || result.wordSolved || result.gameOver) {
                    const currentIdx = state.playersData.findIndex(p => p.id === state.currentPlayerId);
                    if (currentIdx !== -1 && state.playersData.length > 0) { // Ensure player found and list not empty
                         nextPlayerIdAfterGuess = state.playersData[(currentIdx + 1) % state.playersData.length].id;
                    } else {
                         nextPlayerIdAfterGuess = state.playersData[0]?.id || 0; // Fallback
                    }
                }
                 if (result.correct && !result.wordSolved && !result.gameOver) {
                    nextPlayerIdAfterGuess = state.currentPlayerId;
                } else if (!result.wordSolved && !result.gameOver) {
                     state.setCurrentPlayerId(nextPlayerIdAfterGuess);
                }

                const guessResultPayload = {
                    type: MSG_TYPE.GUESS_RESULT,
                    guess: data.letter, result: result,
                    currentWordDisplay: state.currentWord.split('').map(l => state.guessedLetters.has(l) ? l : '_').join(''),
                    guessedLetters: Array.from(state.guessedLetters),
                    remainingAttempts: state.remainingAttempts,
                    nextPlayerId: state.gameActive ? state.currentPlayerId : -1,
                    scores: state.playersData.map(p => ({ id: p.id, score: state.networkRoomData.players.find(np => np.id === p.id)?.score || 0 }))
                };
                const guessingPlayerNetworkData = state.networkRoomData.players.find(p => p.id === playerGameId);
                const guessingPlayerGameData = state.playersData.find(p => p.id === playerGameId);
                if(guessingPlayerNetworkData && guessingPlayerGameData) guessingPlayerNetworkData.score = guessingPlayerGameData.score;

                broadcastToRoom(guessResultPayload);

                if (result.wordSolved || result.gameOver) {
                    state.setNetworkRoomData({ roomState: 'game_over' });
                    const winnerData = logic.checkWinCondition(state) ? logic.getWinnerData(state) : (result.gameOver ? logic.getWinnerData(state) : { winners: [], isTie: false, maxScore: 0 }); // Ensure getWinnerData is called with state
                    broadcastToRoom({ type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, winnerData: winnerData, finalScores: guessResultPayload.scores });
                }
            }
            break;

        case MSG_TYPE.CLUE_REQUEST:
            if (playerGameId !== undefined && state.gameActive && !state.clueUsedThisGame) {
                const clueResult = logic.requestClue(state);
                if (clueResult.success) {
                    broadcastToRoom({ type: MSG_TYPE.CLUE_PROVIDED, clue: clueResult.clue, clueUsed: state.clueUsedThisGame, remainingAttempts: state.remainingAttempts });
                } else {
                    sendDataToClient(fromPeerId, {type: MSG_TYPE.ERROR_MESSAGE, message: clueResult.message });
                }
            }
            break;
    }
}

function handleClientDataReception(data, fromLeaderPeerId) {
    if (fromLeaderPeerId !== state.networkRoomData.leaderPeerId) return;

    switch (data.type) {
        case MSG_TYPE.JOIN_ACCEPTED:
            state.setNetworkRoomData({ myPlayerIdInRoom: data.yourPlayerIdInRoom, ...data.roomData, roomState: 'lobby' });
            if (state.networkRoomData._setupCompleteCallback) {
                state.networkRoomData._setupCompleteCallback(state.myPeerId);
                state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
            }
            break;
        case MSG_TYPE.JOIN_REJECTED:
            if (state.networkRoomData._setupErrorCallback) state.networkRoomData._setupErrorCallback(new Error(data.reason));
            state.resetFullLocalStateForNewUIScreen();
            break;
        case MSG_TYPE.PLAYER_JOINED:
        case MSG_TYPE.PLAYER_LEFT:
        case MSG_TYPE.ROOM_STATE_UPDATE:
        case MSG_TYPE.PLAYER_READY_CHANGED:
             if (data.roomData) {
                 state.setNetworkRoomData({ ...data.roomData, myPlayerIdInRoom: data.roomData.players.find(p=>p.peerId === state.myPeerId)?.id ?? state.networkRoomData.myPlayerIdInRoom });
            } else if (data.player) {
                if (data.type === MSG_TYPE.PLAYER_JOINED && data.player.peerId !== state.myPeerId) state.addPlayerToNetworkRoom(data.player);
                else if (data.type === MSG_TYPE.PLAYER_LEFT) state.removePlayerFromNetworkRoom(data.player.peerId);
                else if (data.type === MSG_TYPE.PLAYER_READY_CHANGED) {
                    const playerToUpdate = state.networkRoomData.players.find(p=>p.id === data.player.id);
                    if(playerToUpdate) state.updatePlayerInNetworkRoom(playerToUpdate.peerId, { isReady: data.player.isReady });
                }
            }
            break;
        case MSG_TYPE.GAME_STARTED:
            state.setNetworkRoomData({ roomState: 'in_game' });
            state.setPlayersData(data.initialGameState.playersInGameOrder);
            state.setCurrentDifficulty(data.initialGameState.gameSettings.difficulty);
            state.setCurrentWordObject(data.initialGameState.currentWordObject);
            state.setGuessedLetters(new Set(data.initialGameState.guessedLetters || []));
            state.setRemainingAttempts(data.initialGameState.remainingAttempts);
            state.setCurrentPlayerId(data.initialGameState.startingPlayerId);
            state.setClueUsedThisGame(data.initialGameState.clueUsed || false);
            break;
        case MSG_TYPE.GUESS_RESULT:
            state.setGuessedLetters(new Set(data.guessedLetters));
            state.setRemainingAttempts(data.remainingAttempts);
            state.setCurrentPlayerId(data.nextPlayerId);
            if (data.scores) {
                data.scores.forEach(ps => {
                    const playerNet = state.networkRoomData.players.find(p=>p.id === ps.id);
                    if(playerNet) state.updatePlayerInNetworkRoom(playerNet.peerId, { score: ps.score });

                    const playerGame = state.playersData.find(p => p.id === ps.id);
                    if (playerGame) playerGame.score = ps.score;
                 });
            }
            if (data.result.wordSolved || data.result.gameOver) state.setGameActive(false);
            break;
        case MSG_TYPE.CLUE_PROVIDED:
            state.setClueUsedThisGame(data.clueUsed);
            if (data.remainingAttempts !== undefined) state.setRemainingAttempts(data.remainingAttempts);
            break;
        case MSG_TYPE.GAME_OVER_ANNOUNCEMENT:
            state.setGameActive(false);
            state.setNetworkRoomData({ roomState: 'game_over' });
            break;
        case MSG_TYPE.ERROR_MESSAGE:
            break;
    }
}

// --- Actions from UI (called by main.js) ---
export function sendPlayerReadyState(isReady) {
    const myData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
    if (!myData) return;

    if (state.networkRoomData.isRoomLeader) {
        myData.isReady = isReady;
        state.updatePlayerInNetworkRoom(state.myPeerId, { isReady });
        broadcastToRoom({ type: MSG_TYPE.PLAYER_READY_CHANGED, player: { id: myData.id, isReady: isReady } });
    } else {
        sendDataToLeader({ type: MSG_TYPE.PLAYER_READY_CHANGED, playerId: state.networkRoomData.myPlayerIdInRoom, isReady: isReady });
    }
}

export function leaderStartGameRequest() {
    if (!state.networkRoomData.isRoomLeader || state.networkRoomData.roomState !== 'lobby') return;
    const allReady = state.networkRoomData.players.length >= state.MIN_PLAYERS_NETWORK &&
                     state.networkRoomData.players.every(p => p.isReady && p.isConnected);
    if (!allReady) return;

    state.setNetworkRoomData({ roomState: 'in_game' });
    state.setCurrentDifficulty(state.networkRoomData.gameSettings.difficulty);

    const gameInitResult = logic.initializeGame(state, state.networkRoomData.gameSettings.difficulty);
    if (!gameInitResult.success || !state.currentWordObject) {
        broadcastToRoom({ type: MSG_TYPE.ERROR_MESSAGE, message: "Host failed to start game: No word selected."});
        state.setNetworkRoomData({ roomState: 'lobby' });
        return;
    }
    const gamePlayers = state.networkRoomData.players.map(p => ({
        id: p.id, name: p.name, icon: p.icon, color: p.color, score: 0, peerId: p.peerId
    })).sort((a,b) => a.id - b.id);
    state.setPlayersData(gamePlayers);
    state.setCurrentPlayerId(gamePlayers[0].id);

    const initialGameState = {
        gameSettings: state.networkRoomData.gameSettings,
        currentWordObject: state.currentWordObject,
        guessedLetters: [],
        remainingAttempts: state.MAX_ATTEMPTS,
        playersInGameOrder: gamePlayers,
        startingPlayerId: state.currentPlayerId,
        clueUsed: false,
        maxAttempts: state.MAX_ATTEMPTS
    };
    broadcastToRoom({ type: MSG_TYPE.GAME_STARTED, initialGameState });
}

export function sendGuessToHost(letter) {
    if (state.pvpRemoteActive && !state.networkRoomData.isRoomLeader && state.gameActive) {
        sendDataToLeader({ type: MSG_TYPE.LETTER_GUESS, letter: letter, playerId: state.networkRoomData.myPlayerIdInRoom });
    }
}

export function sendClueRequestToHost() {
    if (state.pvpRemoteActive && !state.networkRoomData.isRoomLeader && state.gameActive) {
        sendDataToLeader({ type: MSG_TYPE.CLUE_REQUEST, playerId: state.networkRoomData.myPlayerIdInRoom });
    }
}

export function closeAllConnectionsAndSession() {
    if (state.networkRoomData.isRoomLeader) {
        broadcastToRoom({type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, reason: 'host_closed_room'});
        connections.forEach(connEntry => connEntry.connObject?.close());
        connections.clear();
    } else if (leaderConnection) {
        leaderConnection.close();
        leaderConnection = null;
    }
    if (window.peerJsMultiplayer) window.peerJsMultiplayer.close();
}

if (typeof window !== 'undefined' && !window.peerJsMultiplayer) {
    console.error("pizarraPeerConnection.js: peerjs-multiplayer.js wrapper not found on window object! Load it first.");
}