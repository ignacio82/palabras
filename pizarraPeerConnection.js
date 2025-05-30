// pizarraPeerConnection.js

import * as state from './pizarraState.js';
import * as logic from './gameLogic.js'; // Host uses this to process game events

const PIZARRA_BASE_URL = "https://palabras.martinez.fyi";

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
    GAME_STARTED: 'game_started_pizarra',
    LETTER_GUESS: 'guess_letter_pizarra',
    GUESS_RESULT: 'guess_result_pizarra',
    CLUE_REQUEST: 'req_clue_pizarra',
    CLUE_PROVIDED: 'clue_provided_pizarra',
    GAME_OVER_ANNOUNCEMENT: 'game_over_pizarra',
    ERROR_MESSAGE: 'error_message_pizarra'
};

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
    onNewConnection: (conn) => {
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
        } else {
            if (remotePeerId === state.networkRoomData.leaderPeerId && leaderConnection && leaderConnection.open) {
                const myPlayerData = state.getLocalPlayerCustomizationForNetwork();
                sendDataToLeader({
                    type: MSG_TYPE.REQUEST_JOIN_ROOM,
                    playerData: { name: myPlayerData.name, icon: myPlayerData.icon, color: myPlayerData.color }
                });
                state.setNetworkRoomData({ roomState: 'awaiting_join_approval' });
            }
        }
    },
    onDataReceived: (data, fromPeerId) => {
        console.log(`[PizarraPeerConn RX] From ${fromPeerId}: Type: ${data.type}`, /*data*/); // Keep data log minimal for now
        if (state.networkRoomData.isRoomLeader) {
            handleLeaderDataReception(data, fromPeerId);
        } else {
            handleClientDataReception(data, fromPeerId);
        }
    },
    onConnectionClose: (peerId) => {
        console.log(`[PizarraPeerConn] Connection closed with ${peerId}.`);
        if (state.networkRoomData.isRoomLeader) {
            const leavingPlayerEntry = connections.get(peerId);
            if (leavingPlayerEntry && leavingPlayerEntry.playerGameId !== -1) {
                const leavingPlayer = state.networkRoomData.players.find(p => p.id === leavingPlayerEntry.playerGameId);
                state.removePlayerFromNetworkRoom(peerId);
                connections.delete(peerId);
                if (leavingPlayer) {
                    broadcastToRoom({ type: MSG_TYPE.PLAYER_LEFT, player: { id: leavingPlayer.id, name: leavingPlayer.name, peerId: peerId } });
                     if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
                }
                if (state.networkRoomData.roomState === 'in_game' && state.networkRoomData.players.length < state.MIN_PLAYERS_NETWORK) {
                    broadcastToRoom({ type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, reason: 'disconnect_insufficient_players'});
                    state.setNetworkRoomData({ roomState: 'game_over' });
                     if(window.pizarraUiUpdateCallbacks?.showNetworkGameOver) window.pizarraUiUpdateCallbacks.showNetworkGameOver({reason: 'disconnect_insufficient_players'});
                }
            }
        } else { 
            if (peerId === state.networkRoomData.leaderPeerId) {
                console.error("[PizarraPeerConn] Client: Connection to leader lost!");
                if (state.networkRoomData._setupErrorCallback) {
                    state.networkRoomData._setupErrorCallback(new Error("Conexión con el líder perdida."));
                } else if(window.pizarraUiUpdateCallbacks?.showNetworkError) {
                    window.pizarraUiUpdateCallbacks.showNetworkError("Se perdió la conexión con el líder de la sala.", true);
                }
                state.resetFullLocalStateForNewUIScreen(); // Ensure client state is reset
            }
        }
    },
    onError: (err) => {
        // ... (onError logic as previously defined)
        console.error(`[PizarraPeerConn] PeerJS Error: ${err.type}`, err.message || err);
        if (state.networkRoomData._peerInitReject) {
            state.networkRoomData._peerInitReject(err);
            state.setNetworkRoomData({ _peerInitResolve: null, _peerInitReject: null });
        }
        if (state.networkRoomData._setupErrorCallback) {
            state.networkRoomData._setupErrorCallback(err);
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        } else if (window.pizarraUiUpdateCallbacks?.showNetworkError){
            window.pizarraUiUpdateCallbacks.showNetworkError(`Error de Red: ${err.message || err.type}`, true);
        }
    }
};

function _finalizeHostSetup(hostPeerId) {
    // ... (as previously defined)
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
    // ... (as previously defined)
    if (!state.networkRoomData._setupCompleteCallback && !state.networkRoomData._setupErrorCallback) return;
    if (state.networkRoomData.isRoomLeader || !leaderPeerIdToJoin || !state.pvpRemoteActive) {
        if(state.networkRoomData._setupErrorCallback) state.networkRoomData._setupErrorCallback(new Error("Client join conditions not met"));
        state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        return;
    }
    // Ensure local player data template is updated with our peerId
    const myInitialData = state.getLocalPlayerCustomizationForNetwork();
    state.setNetworkRoomData({ 
        players: [{ ...myInitialData, peerId: myPeerId }] 
    });

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

export async function ensurePeerInitialized() {
    // ... (as previously defined)
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
    // ... (as previously defined)
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
    // ... (as previously defined)
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
    conn.on('error', (err) => peerJsCallbacks.onError(err)); // PeerJS errors on conn now include peer context
}

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

function handleLeaderDataReception(data, fromPeerId) {
    const connEntry = connections.get(fromPeerId);

    // This critical check must happen first for any message type other than REQUEST_JOIN_ROOM
    if (!connEntry && data.type !== MSG_TYPE.REQUEST_JOIN_ROOM) {
        console.warn(`[PizarraPeerConn L] Data from ${fromPeerId} (Type: ${data.type}) but no established connection entry. Ignored.`);
        return;
    }

    // Retrieve playerGameId safely after connEntry is confirmed (for relevant messages)
    // For REQUEST_JOIN_ROOM, playerGameId is assigned within its case.
    let playerGameId;
    if (data.type !== MSG_TYPE.REQUEST_JOIN_ROOM) {
        if (!connEntry || connEntry.playerGameId === -1) {
             console.warn(`[PizarraPeerConn L] Message type ${data.type} from ${fromPeerId} received, but player is not fully joined or connEntry is missing. Ignored.`);
            return;
        }
        playerGameId = connEntry.playerGameId;
    }


    switch (data.type) {
        case MSG_TYPE.REQUEST_JOIN_ROOM:
            const clientConnObjForJoin = connEntry?.connObject || window.peerJsMultiplayer.getConnection(fromPeerId);
            if (!clientConnObjForJoin) {
                console.warn(`[PizarraPeerConn L] REQUEST_JOIN_ROOM from ${fromPeerId} but actual connection object not found.`);
                return;
            }
            if (state.networkRoomData.players.length >= state.networkRoomData.maxPlayers) {
                clientConnObjForJoin.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' }); return;
            }
            const newPlayerId = state.networkRoomData.players.length > 0 ? Math.max(...state.networkRoomData.players.map(p => p.id)) + 1 : (state.networkRoomData.players.some(p=>p.id===0) ? 1:0); // Ensure unique ID, host is 0
            // If host is player 0, new players start from 1.
            // This logic needs to be robust to ensure unique IDs, especially if players leave and IDs are not reused sequentially.
            // A safer way for newPlayerId:
            let assignedPlayerId = 0;
            const existingIds = new Set(state.networkRoomData.players.map(p => p.id));
            while(existingIds.has(assignedPlayerId)) { assignedPlayerId++; }


            const newPlayer = { id: assignedPlayerId, peerId: fromPeerId, ...data.playerData, isReady: false, isConnected: true, score: 0 };
            state.addPlayerToNetworkRoom(newPlayer);
            // Update or set the connEntry with the definitive playerGameId
            connections.set(fromPeerId, {connObject: clientConnObjForJoin, playerGameId: newPlayer.id, status: 'active'});


            sendDataToClient(fromPeerId, { type: MSG_TYPE.JOIN_ACCEPTED, yourPlayerIdInRoom: newPlayer.id, roomData: state.getSanitizedNetworkRoomDataForClient() });
            broadcastToRoom({ type: MSG_TYPE.PLAYER_JOINED, player: newPlayer }, fromPeerId);
            if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            // main.js also calls matchmaking.updateHostedRoomStatus(...)
            break;

        case MSG_TYPE.PLAYER_READY_CHANGED:
            // playerGameId is already safely retrieved above for this case
            state.updatePlayerInNetworkRoom(fromPeerId, { isReady: data.isReady });
            broadcastToRoom({ type: MSG_TYPE.PLAYER_READY_CHANGED, player: { id: playerGameId, isReady: data.isReady, peerId: fromPeerId } });
            if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;

        case MSG_TYPE.LETTER_GUESS:
            // playerGameId retrieved above
            if (playerGameId === state.currentPlayerId && state.gameActive) {
                const result = logic.processGuess(state, data.letter);

                let nextPlayerIdAfterGuess = state.currentPlayerId;
                if (!result.correct || result.wordSolved || result.gameOver) {
                    const currentIdx = state.playersData.findIndex(p => p.id === state.currentPlayerId);
                    if (currentIdx !== -1 && state.playersData.length > 0) {
                         nextPlayerIdAfterGuess = state.playersData[(currentIdx + 1) % state.playersData.length].id;
                    } else { nextPlayerIdAfterGuess = state.playersData[0]?.id || 0; }
                }
                 if (result.correct && !result.wordSolved && !result.gameOver) {
                    nextPlayerIdAfterGuess = state.currentPlayerId;
                } else if (!result.wordSolved && !result.gameOver) {
                     state.setCurrentPlayerId(nextPlayerIdAfterGuess);
                }

                // Sync host's game logic score to networkRoomData.players
                const guessingPlayerInGame = state.playersData.find(p => p.id === playerGameId);
                if (guessingPlayerInGame) {
                    state.updatePlayerInNetworkRoom(fromPeerId, { score: guessingPlayerInGame.score });
                }

                const guessResultPayload = {
                    type: MSG_TYPE.GUESS_RESULT,
                    guess: data.letter, result: result,
                    currentWordDisplay: state.currentWord.split('').map(l => state.guessedLetters.has(l) ? l : '_').join(''),
                    guessedLetters: Array.from(state.guessedLetters),
                    remainingAttempts: state.remainingAttempts,
                    nextPlayerId: state.gameActive ? state.currentPlayerId : -1,
                    scores: state.networkRoomData.players.map(p => ({ id: p.id, score: p.score })) // Send scores from networkRoomData
                };
                broadcastToRoom(guessResultPayload);

                if (result.wordSolved || result.gameOver) {
                    state.setNetworkRoomData({ roomState: 'game_over' });
                    const winnerData = logic.getWinnerData(state); // getWinnerData needs to be robust
                    broadcastToRoom({ type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, winnerData: winnerData, finalScores: guessResultPayload.scores });
                }
            }
            break;

        case MSG_TYPE.CLUE_REQUEST:
            // playerGameId retrieved above
            if (state.gameActive && !state.clueUsedThisGame) { // Global clue for now
                const clueResult = logic.requestClue(state);
                if (clueResult.success) {
                    broadcastToRoom({ type: MSG_TYPE.CLUE_PROVIDED, clue: clueResult.clue, clueUsed: state.clueUsedThisGame, remainingAttempts: state.remainingAttempts });
                } else {
                    sendDataToClient(fromPeerId, {type: MSG_TYPE.ERROR_MESSAGE, message: clueResult.message || "No se pudo obtener la pista." });
                }
            }
            break;
        default:
            console.warn(`[PizarraPeerConn L] Unhandled message type: ${data.type} from ${fromPeerId}`);
    }
}

function handleClientDataReception(data, fromLeaderPeerId) {
    // ... (rest of the function as previously defined, including all case statements)
    // Ensure logic.getWinnerData() is available or handled if called by UI callbacks.
    if (fromLeaderPeerId !== state.networkRoomData.leaderPeerId) return;

    switch (data.type) {
        case MSG_TYPE.JOIN_ACCEPTED:
            state.setNetworkRoomData({ myPlayerIdInRoom: data.yourPlayerIdInRoom, ...data.roomData, roomState: 'lobby' });
            if (state.networkRoomData._setupCompleteCallback) {
                state.networkRoomData._setupCompleteCallback(state.myPeerId);
                state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
            }
            if(window.pizarraUiUpdateCallbacks?.showLobby) window.pizarraUiUpdateCallbacks.showLobby(false);
            break;
        case MSG_TYPE.JOIN_REJECTED:
            if (state.networkRoomData._setupErrorCallback) state.networkRoomData._setupErrorCallback(new Error(data.reason || 'Join rejected'));
            else if(window.pizarraUiUpdateCallbacks?.showNetworkError) window.pizarraUiUpdateCallbacks.showNetworkError(`Unión Rechazada: ${data.reason}`, true);
            state.resetFullLocalStateForNewUIScreen();
            break;
        case MSG_TYPE.PLAYER_JOINED:
             if (data.player.peerId !== state.myPeerId) state.addPlayerToNetworkRoom(data.player);
             if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;
        case MSG_TYPE.PLAYER_LEFT:
            state.removePlayerFromNetworkRoom(data.player.peerId);
            if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;
        case MSG_TYPE.ROOM_STATE_UPDATE:
             state.setNetworkRoomData({ ...data.roomData, myPlayerIdInRoom: data.roomData.players.find(p=>p.peerId === state.myPeerId)?.id ?? state.networkRoomData.myPlayerIdInRoom });
             if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;
        case MSG_TYPE.PLAYER_READY_CHANGED:
            const playerToUpdate = state.networkRoomData.players.find(p=>p.id === data.player.id);
            if(playerToUpdate) state.updatePlayerInNetworkRoom(playerToUpdate.peerId, { isReady: data.player.isReady });
            if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;
        case MSG_TYPE.GAME_STARTED:
            if(window.pizarraUiUpdateCallbacks?.startGameOnNetwork) window.pizarraUiUpdateCallbacks.startGameOnNetwork(data.initialGameState);
            break;
        case MSG_TYPE.GUESS_RESULT:
            if(window.pizarraUiUpdateCallbacks?.updateGameFromNetwork) window.pizarraUiUpdateCallbacks.updateGameFromNetwork(data);
            break;
        case MSG_TYPE.CLUE_PROVIDED:
            if(window.pizarraUiUpdateCallbacks?.displayClueFromNetwork) window.pizarraUiUpdateCallbacks.displayClueFromNetwork(data);
            break;
        case MSG_TYPE.GAME_OVER_ANNOUNCEMENT:
            if(window.pizarraUiUpdateCallbacks?.showNetworkGameOver) window.pizarraUiUpdateCallbacks.showNetworkGameOver(data);
            break;
        case MSG_TYPE.ERROR_MESSAGE:
            if(window.pizarraUiUpdateCallbacks?.showNetworkError) window.pizarraUiUpdateCallbacks.showNetworkError(data.message, false);
            break;
        default:
            console.warn(`[PizarraPeerConn C] Unhandled message type: ${data.type} from ${fromLeaderPeerId}`);

    }
}

export function sendPlayerReadyState(isReady) {
    // ... (as previously defined)
    const myData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
    if (!myData) return;

    if (state.networkRoomData.isRoomLeader) {
        myData.isReady = isReady; 
        state.updatePlayerInNetworkRoom(state.myPeerId, { isReady });
        broadcastToRoom({ type: MSG_TYPE.PLAYER_READY_CHANGED, player: { id: myData.id, isReady: isReady, peerId: state.myPeerId } });
        if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
    } else {
        sendDataToLeader({ type: MSG_TYPE.PLAYER_READY_CHANGED, playerId: state.networkRoomData.myPlayerIdInRoom, isReady: isReady });
    }
}

export function leaderStartGameRequest() {
    // ... (as previously defined)
    if (!state.networkRoomData.isRoomLeader || state.networkRoomData.roomState !== 'lobby') return;
    const allReady = state.networkRoomData.players.length >= state.MIN_PLAYERS_NETWORK &&
                     state.networkRoomData.players.every(p => p.isReady && p.isConnected !== false); // Treat undefined isConnected as true
    if (!allReady) {
        if(window.pizarraUiUpdateCallbacks?.showNetworkError) window.pizarraUiUpdateCallbacks.showNetworkError("No todos los jugadores están listos.", false);
        return;
    }

    state.setNetworkRoomData({ roomState: 'in_game' });
    state.setCurrentDifficulty(state.networkRoomData.gameSettings.difficulty);

    const gameInitResult = logic.initializeGame(state, state.networkRoomData.gameSettings.difficulty);
    if (!gameInitResult.success || !state.currentWordObject) {
        broadcastToRoom({ type: MSG_TYPE.ERROR_MESSAGE, message: "Host failed to start game: No word selected."});
        state.setNetworkRoomData({ roomState: 'lobby' });
        if(window.pizarraUiUpdateCallbacks?.showNetworkError) window.pizarraUiUpdateCallbacks.showNetworkError("Error del Host al iniciar: Palabra no seleccionada.", false);
        return;
    }
    const gamePlayers = state.networkRoomData.players.map(p => ({
        id: p.id, name: p.name, icon: p.icon, color: p.color, score: 0, peerId: p.peerId
    })).sort((a,b) => a.id - b.id);
    state.setPlayersData(gamePlayers); // This will be the official player list for the game logic
    state.setCurrentPlayerId(gamePlayers[0].id); // Host (player 0 by sort) usually starts

    const initialGameState = {
        gameSettings: state.networkRoomData.gameSettings,
        currentWordObject: state.currentWordObject,
        guessedLetters: Array.from(state.guessedLetters), // Send as array
        remainingAttempts: state.remainingAttempts,
        playersInGameOrder: gamePlayers,
        startingPlayerId: state.currentPlayerId,
        clueUsed: state.clueUsedThisGame,
        maxAttempts: state.MAX_ATTEMPTS
    };
    broadcastToRoom({ type: MSG_TYPE.GAME_STARTED, initialGameState });
    // Host itself needs to transition UI
    if(window.pizarraUiUpdateCallbacks?.startGameOnNetwork) window.pizarraUiUpdateCallbacks.startGameOnNetwork(initialGameState);
}

export function sendGuessToHost(letter) {
    // ... (as previously defined)
    if (state.pvpRemoteActive && !state.networkRoomData.isRoomLeader && state.gameActive) {
        sendDataToLeader({ type: MSG_TYPE.LETTER_GUESS, letter: letter, playerId: state.networkRoomData.myPlayerIdInRoom });
    }
}

export function sendClueRequestToHost() {
    // ... (as previously defined)
    if (state.pvpRemoteActive && !state.networkRoomData.isRoomLeader && state.gameActive) {
        sendDataToLeader({ type: MSG_TYPE.CLUE_REQUEST, playerId: state.networkRoomData.myPlayerIdInRoom });
    }
}

export function closeAllConnectionsAndSession() {
    // ... (as previously defined)
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

// Ensure peerJsMultiplayer is available
if (typeof window !== 'undefined' && !window.peerJsMultiplayer) {
    console.error("pizarraPeerConnection.js: peerjs-multiplayer.js wrapper not found on window object! Load it first.");
}