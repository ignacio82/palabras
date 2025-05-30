// pizarraPeerConnection.js

import * as state from './pizarraState.js';
import * as logic from './gameLogic.js'; // Host uses this to process game events

const PIZARRA_BASE_URL = "https://palabras.martinez.fyi";

let connections = new Map();
let leaderConnection = null;

export const MSG_TYPE = {
    REQUEST_JOIN_ROOM: 'req_join_pizarra',
    JOIN_ACCEPTED: 'join_accept_pizarra',
    JOIN_REJECTED: 'join_reject_pizarra',
    PLAYER_JOINED: 'player_joined_pizarra',
    PLAYER_LEFT: 'player_left_pizarra',
    ROOM_STATE_UPDATE: 'room_state_pizarra',
    PLAYER_READY_CHANGED: 'ready_change_pizarra',
    GAME_STARTED: 'game_started_pizarra',
    LETTER_GUESS: 'letter_guess',             // Highlighted by user
    GUESS_RESULT: 'guess_result',             // Highlighted by user
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
            console.warn(`[PizarraPeerConn] Non-leader received connection from ${conn.peer}. Rejecting.`);
            conn.on('open', () => conn.close()); return;
        }
        if (state.networkRoomData.players.some(p => p.peerId === conn.peer)) {
             console.warn(`[PizarraPeerConn] Host: Duplicate connection attempt from ${conn.peer}. Ignoring new one.`);
            // Do not add to connections map if already existing, let existing one handle it.
            // Or, close old and accept new? For now, simplest is to ignore new if one exists.
            return; 
        }
        if (state.networkRoomData.players.length >= state.networkRoomData.maxPlayers) {
            console.warn(`[PizarraPeerConn] Room full. Rejecting connection from ${conn.peer}.`);
            conn.on('open', () => {
                conn.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }
        console.log(`[PizarraPeerConn] Host: Incoming connection from ${conn.peer}.`);
        connections.set(conn.peer, { connObject: conn, status: 'pending_join_request', playerGameId: -1 });
        setupConnectionEventHandlers(conn);
    },
    onConnectionOpen: (remotePeerId) => {
        console.log(`[PizarraPeerConn] Connection now open with ${remotePeerId}.`);
        if (state.networkRoomData.isRoomLeader) {
            const connEntry = connections.get(remotePeerId);
            if (connEntry && connEntry.status === 'pending_join_request') {
                connEntry.status = 'awaiting_join_request';
                console.log(`[PizarraPeerConn] Host: Connection with ${remotePeerId} ready for JOIN_REQUEST.`);
            }
        } else { 
            if (remotePeerId === state.networkRoomData.leaderPeerId && leaderConnection && leaderConnection.open) {
                // Avoid sending multiple join requests if already in lobby or awaiting approval
                if (state.networkRoomData.roomState === 'connecting_to_lobby' || 
                    (state.networkRoomData.roomState === 'awaiting_join_approval' && !state.networkRoomData.myPlayerIdInRoom)) { // Allow retry if previous join failed to get ID
                    console.log("[PizarraPeerConn] Client: Connection to leader open. Sending JOIN_REQUEST.");
                    const myPlayerData = state.getLocalPlayerCustomizationForNetwork();
                    sendDataToLeader({
                        type: MSG_TYPE.REQUEST_JOIN_ROOM,
                        playerData: { name: myPlayerData.name, icon: myPlayerData.icon, color: myPlayerData.color }
                    });
                    state.setNetworkRoomData({ roomState: 'awaiting_join_approval' });
                } else {
                     console.log(`[PizarraPeerConn] Client: Connection to leader ${remotePeerId} open, but roomState is ${state.networkRoomData.roomState}. Not sending new JOIN_REQUEST.`);
                }
            }
        }
    },
    onDataReceived: (data, fromPeerId) => {
        const currentIsLeader = state.networkRoomData.isRoomLeader;
        const logPrefix = currentIsLeader ? "[PizarraPeerConn L RX]" : "[PizarraPeerConn C RX]";
        console.log(`${logPrefix} From ${fromPeerId}: Type: ${data.type}`); 

        if (currentIsLeader) {
            handleLeaderDataReception(data, fromPeerId);
        } else {
            handleClientDataReception(data, fromPeerId);
        }
    },
    onConnectionClose: (peerId) => {
        console.log(`[PizarraPeerConn] Connection closed with ${peerId}.`);
        if (state.networkRoomData.isRoomLeader) {
            const leavingPlayerEntry = connections.get(peerId);
            if (leavingPlayerEntry) {
                const leavingPlayer = state.networkRoomData.players.find(p => p.id === leavingPlayerEntry.playerGameId && p.peerId === peerId);
                state.removePlayerFromNetworkRoom(peerId);
                connections.delete(peerId);
                if (leavingPlayer) {
                    broadcastToRoom({ type: MSG_TYPE.PLAYER_LEFT, player: { id: leavingPlayer.id, name: leavingPlayer.name, peerId: peerId } });
                }
                if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
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
        } else if (window.pizarraUiUpdateCallbacks?.showNetworkError){
            window.pizarraUiUpdateCallbacks.showNetworkError(`Error de Red: ${err.message || err.type}`, true);
        }
    }
};

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
    const myInitialData = state.getLocalPlayerCustomizationForNetwork();
    // Ensure player's array for client is initialized with their own data and peerId
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
        if (window.peerJsMultiplayer?.init) window.peerJsMultiplayer.init(null, peerJsCallbacks);
        else reject(new Error('PeerJS wrapper not ready.'));
    });
    state.setNetworkRoomData({ _peerInitPromise: initPromise });
    try { const newPeerId = await initPromise; state.setNetworkRoomData({ _peerInitPromise: null }); return newPeerId; }
    catch (err) { state.setNetworkRoomData({ _peerInitPromise: null }); throw err; }
}

export function hostNewRoom(hostPlayerData, gameSettingsFromUI) {
    state.resetFullLocalStateForNewUIScreen(); state.setPvpRemoteActive(true);
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
        catch (err) { if(state.networkRoomData._setupErrorCallback === reject) reject(err); state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });}
    });
}

export function joinRoomById(leaderRawPeerId, joinerPlayerData) {
    state.resetFullLocalStateForNewUIScreen(); state.setPvpRemoteActive(true);
    // Set isRoomLeader to false IMMEDIATELY for the client
    state.setNetworkRoomData({ 
        isRoomLeader: false, roomId: leaderRawPeerId, leaderPeerId: leaderRawPeerId,
        players: [{ name: joinerPlayerData.name, icon: joinerPlayerData.icon, color: joinerPlayerData.color, peerId: null }], // peerId to be set once own peer opens
        roomState: 'connecting_to_lobby'
    });
    return new Promise(async (resolve, reject) => {
        state.setNetworkRoomData({ _setupCompleteCallback: resolve, _setupErrorCallback: reject });
        try { await ensurePeerInitialized(); }
        catch (err) { if(state.networkRoomData._setupErrorCallback === reject) reject(err); state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });}
    });
}

function setupConnectionEventHandlers(conn) {
    conn.on('open', () => peerJsCallbacks.onConnectionOpen(conn.peer));
    conn.on('data', (data) => peerJsCallbacks.onDataReceived(data, conn.peer));
    conn.on('close', () => peerJsCallbacks.onConnectionClose(conn.peer));
    conn.on('error', (err) => peerJsCallbacks.onError(err));
}

function sendDataToLeader(data) {
    if (leaderConnection?.open) try { leaderConnection.send(data); } catch (e) { peerJsCallbacks.onError({type: 'send_error', message: 'Failed to send data to leader.', originalError: e});}
    else peerJsCallbacks.onError({type: 'send_error_no_connection', message: 'No open connection to leader.'});
}
function sendDataToClient(clientPeerId, data) {
    const connEntry = connections.get(clientPeerId);
    if (connEntry?.connObject?.open) try { connEntry.connObject.send(data); } catch (e) { console.error(`[PizarraPeerConn L] Error sending to client ${clientPeerId}:`, e, data); }
    else console.warn(`[PizarraPeerConn L] No open conn to client ${clientPeerId}. Cannot send. Conn Entry:`, connEntry);
}
function broadcastToRoom(data, excludePeerId = null) {
    if (!state.networkRoomData.isRoomLeader) return;
    connections.forEach((connEntry, peerId) => {
        if (peerId !== excludePeerId && connEntry?.connObject?.open) try { connEntry.connObject.send(data); } catch (e) {}
    });
}
export function broadcastRoomState() {
    if (!state.networkRoomData.isRoomLeader) return;
    broadcastToRoom({ type: MSG_TYPE.ROOM_STATE_UPDATE, roomData: state.getSanitizedNetworkRoomDataForClient() });
}

function handleLeaderDataReception(data, fromPeerId) {
    const connEntry = connections.get(fromPeerId);
    if (!connEntry && data.type !== MSG_TYPE.REQUEST_JOIN_ROOM) {
        console.warn(`[PizarraPeerConn L] Data from ${fromPeerId} (Type: ${data.type}) but no connection entry. Ignored.`); return;
    }
    let playerGameId; // Assigned per relevant case
    if (data.type !== MSG_TYPE.REQUEST_JOIN_ROOM) {
        if (!connEntry || connEntry.playerGameId === -1) {
            console.warn(`[PizarraPeerConn L] Msg type ${data.type} from ${fromPeerId}, but player not fully joined. Ignored.`); return;
        }
        playerGameId = connEntry.playerGameId;
    }

    switch (data.type) {
        case MSG_TYPE.REQUEST_JOIN_ROOM:
            const clientConnObjForJoin = connEntry?.connObject || window.peerJsMultiplayer.getConnection(fromPeerId);
            if (!clientConnObjForJoin) { console.warn(`[PizarraPeerConn L] REQUEST_JOIN_ROOM from ${fromPeerId} but no connection object.`); return; }
            if (state.networkRoomData.players.length >= state.networkRoomData.maxPlayers) {
                clientConnObjForJoin.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' }); return;
            }
            let newPlayerAssignedId = 0; const existingGameIds = new Set(state.networkRoomData.players.map(p => p.id));
            while(existingGameIds.has(newPlayerAssignedId)) { newPlayerAssignedId++; }
            const newPlayer = { id: newPlayerAssignedId, peerId: fromPeerId, ...data.playerData, isReady: false, isConnected: true, score: 0 };
            state.addPlayerToNetworkRoom(newPlayer);
            connections.set(fromPeerId, {connObject: clientConnObjForJoin, playerGameId: newPlayer.id, status: 'active'});
            console.log(`[PizarraPeerConn L] Sending JOIN_ACCEPTED to ${fromPeerId} (Player ID ${newPlayer.id})`);
            sendDataToClient(fromPeerId, { type: MSG_TYPE.JOIN_ACCEPTED, yourPlayerIdInRoom: newPlayer.id, roomData: state.getSanitizedNetworkRoomDataForClient() });
            broadcastToRoom({ type: MSG_TYPE.PLAYER_JOINED, player: newPlayer }, fromPeerId);
            if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;

        case MSG_TYPE.PLAYER_READY_CHANGED:
            // playerGameId is validated at the start of this switch for this case
            state.updatePlayerInNetworkRoom(fromPeerId, { isReady: data.isReady });
            broadcastToRoom({ type: MSG_TYPE.PLAYER_READY_CHANGED, player: { id: playerGameId, isReady: data.isReady, peerId: fromPeerId } });
            if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;

        case MSG_TYPE.LETTER_GUESS:
            // playerGameId is validated
            if (playerGameId === state.currentPlayerId && state.gameActive) {
                const result = logic.processGuess(data.letter); // Uses global state, result includes nextPlayerId, attemptsLeft
                
                // Host's state.currentPlayerId is updated by processGuess if turn changes
                // Host's state.remainingAttemptsPerPlayer is updated by processGuess

                const guessingPlayerInGame = state.playersData.find(p => p.id === playerGameId);
                if (guessingPlayerInGame) { // Sync gameLogic score to networkRoomData for broadcast consistency
                    state.updatePlayerInNetworkRoom(fromPeerId, { score: guessingPlayerInGame.score });
                }

                const guessResultPayload = {
                    type: MSG_TYPE.GUESS_RESULT,
                    // Spread the entire result object from gameLogic.processGuess
                    ...result 
                    // result contains: { letter, correct, affectedPlayerId, attemptsLeft, nextPlayerId, wordSolved, gameOver }
                };
                broadcastToRoom(guessResultPayload);

                if (result.gameOver) { // Check gameOver flag from processGuess result
                    state.setNetworkRoomData({ roomState: 'game_over' });
                    const winnerData = logic.getWinnerData(state); // Assuming getWinnerData is in gameLogic & uses state
                    broadcastToRoom({ type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, winnerData: winnerData, finalScores: state.playersData.map(p=>({id: p.id, score:p.score})) });
                }
            } else {
                 console.warn(`[PizarraPeerConn L] Letter guess from ${fromPeerId} (P-ID ${playerGameId}) invalid. Current turn P-ID: ${state.currentPlayerId}, Game Active: ${state.gameActive}`);
            }
            break;

        case MSG_TYPE.CLUE_REQUEST:
            // playerGameId is validated
            if (state.gameActive && !state.clueUsedThisGame) {
                const clueResult = logic.requestClue(state);
                if (clueResult.success) {
                    broadcastToRoom({ type: MSG_TYPE.CLUE_PROVIDED, clue: clueResult.clue, clueUsed: state.clueUsedThisGame, remainingAttemptsPerPlayer: [...state.remainingAttemptsPerPlayer] /* if clue costs attempts */ });
                } else {
                    sendDataToClient(fromPeerId, {type: MSG_TYPE.ERROR_MESSAGE, message: clueResult.message || "No se pudo obtener la pista." });
                }
            }
            break;
        default: console.warn(`[PizarraPeerConn L] Unhandled message type: ${data.type} from ${fromPeerId}`);
    }
}

function handleClientDataReception(data, fromLeaderPeerId) {
    if (fromLeaderPeerId !== state.networkRoomData.leaderPeerId) {
        console.warn(`[PizarraPeerConn C] Data from non-leader ${fromLeaderPeerId}. Expected ${state.networkRoomData.leaderPeerId}. Ignored.`); return;
    }
    switch (data.type) {
        case MSG_TYPE.JOIN_ACCEPTED:
            const clientIsLeaderWas = false; // Client is never the leader when joining
            const clientMyPeerIdWas = state.myPeerId;
            const clientRoomIdWas = state.networkRoomData.roomId;
            const clientLeaderPeerIdWas = state.networkRoomData.leaderPeerId;

            state.setNetworkRoomData({
                ...data.roomData,
                isRoomLeader: clientIsLeaderWas, myPeerId: clientMyPeerIdWas,
                roomId: clientRoomIdWas, leaderPeerId: clientLeaderPeerIdWas,
                myPlayerIdInRoom: data.yourPlayerIdInRoom,
                roomState: 'lobby'
            });
            if (state.networkRoomData._setupCompleteCallback) {
                state.networkRoomData._setupCompleteCallback(state.myPeerId);
                state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
            }
            if(window.pizarraUiUpdateCallbacks?.showLobby) window.pizarraUiUpdateCallbacks.showLobby(false);
            break;
        // ... (other cases like JOIN_REJECTED, PLAYER_JOINED etc. as defined previously) ...
        case MSG_TYPE.JOIN_REJECTED:
            if (state.networkRoomData._setupErrorCallback) state.networkRoomData._setupErrorCallback(new Error(data.reason || 'Join rejected'));
            else if(window.pizarraUiUpdateCallbacks?.showNetworkError) window.pizarraUiUpdateCallbacks.showNetworkError(`Unión Rechazada: ${data.reason || 'Desconocido'}`, true);
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
             state.setNetworkRoomData({
                ...data.roomData,
                isRoomLeader: state.networkRoomData.isRoomLeader, 
                myPeerId: state.myPeerId,                         
                myPlayerIdInRoom: data.roomData.players.find(p=>p.peerId === state.myPeerId)?.id ?? state.networkRoomData.myPlayerIdInRoom
             });
             if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;
        case MSG_TYPE.PLAYER_READY_CHANGED:
            const playerToUpdate = state.networkRoomData.players.find(p=>p.id === data.player.id);
            const targetPeerId = data.player.peerId || playerToUpdate?.peerId;
            if(targetPeerId) state.updatePlayerInNetworkRoom(targetPeerId, { isReady: data.player.isReady });
            if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;
        case MSG_TYPE.GAME_STARTED:
            // This sets up the client's game state based on the host's authoritative start.
            // state.setPlayersData, setCurrentDifficulty, setCurrentWordObject, etc. are called here.
            // Then the UI update callback is triggered.
            if(window.pizarraUiUpdateCallbacks?.startGameOnNetwork) window.pizarraUiUpdateCallbacks.startGameOnNetwork(data.initialGameState);
            break;
        case MSG_TYPE.GUESS_RESULT:
            // Client directly uses the comprehensive result from the host
            state.setGuessedLetters(new Set(data.guessedLetters || data.result.guessedLetters || [])); // Use result.guessedLetters if available
            state.remainingAttemptsPerPlayer[data.affectedPlayerId] = data.attemptsLeft;
            state.setCurrentPlayerId(data.nextPlayerId);
            
            // Update scores in local playersData and networkRoomData.players for consistency
            if (data.scores) { // data.scores is {id, score} from host's networkRoomData
                data.scores.forEach(ps => {
                    const playerNetIdx = state.networkRoomData.players.findIndex(p=>p.id === ps.id);
                    if(playerNetIdx !== -1) state.networkRoomData.players[playerNetIdx].score = ps.score;
                    
                    const playerGameIdx = state.playersData.findIndex(p => p.id === ps.id);
                    if (playerGameIdx !== -1) state.playersData[playerGameIdx].score = ps.score;
                 });
            }
            state.setGameActive(data.nextPlayerId !== -1 && !data.gameOver && !data.wordSolved); // Update gameActive status

            if(window.pizarraUiUpdateCallbacks?.updateGameFromNetwork) window.pizarraUiUpdateCallbacks.updateGameFromNetwork(data);
            break;
        case MSG_TYPE.CLUE_PROVIDED:
            state.setClueUsedThisGame(data.clueUsed);
            // If clue had a cost, host would send updated remainingAttemptsPerPlayer in payload
            if (data.remainingAttemptsPerPlayer) { 
                state.remainingAttemptsPerPlayer = [...data.remainingAttemptsPerPlayer];
            }
            if(window.pizarraUiUpdateCallbacks?.displayClueFromNetwork) window.pizarraUiUpdateCallbacks.displayClueFromNetwork(data);
            break;
        case MSG_TYPE.GAME_OVER_ANNOUNCEMENT:
            state.setGameActive(false); 
            state.setNetworkRoomData({ roomState: 'game_over' });
            if(window.pizarraUiUpdateCallbacks?.showNetworkGameOver) window.pizarraUiUpdateCallbacks.showNetworkGameOver(data);
            break;
        case MSG_TYPE.ERROR_MESSAGE:
            if(window.pizarraUiUpdateCallbacks?.showNetworkError) window.pizarraUiUpdateCallbacks.showNetworkError(data.message, false);
            break;
        default: console.warn(`[PizarraPeerConn C] Unhandled message type: ${data.type} from ${fromLeaderPeerId}`);
    }
}

// --- Actions from UI (called by main.js) ---
export function sendPlayerReadyState(isReady) { /* ... same ... */ 
    const myData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
    if (!myData) return;
    if (state.networkRoomData.isRoomLeader) {
        myData.isReady = isReady; state.updatePlayerInNetworkRoom(state.myPeerId, { isReady });
        broadcastToRoom({ type: MSG_TYPE.PLAYER_READY_CHANGED, player: { id: myData.id, isReady: isReady, peerId: state.myPeerId } });
        if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
    } else {
        sendDataToLeader({ type: MSG_TYPE.PLAYER_READY_CHANGED, playerId: state.networkRoomData.myPlayerIdInRoom, isReady: isReady });
    }
}
export function leaderStartGameRequest() { /* ... same, ensure logic.initializeGame uses state ... */
    if (!state.networkRoomData.isRoomLeader || state.networkRoomData.roomState !== 'lobby') return;
    const allReady = state.networkRoomData.players.length >= state.MIN_PLAYERS_NETWORK &&
                     state.networkRoomData.players.every(p => p.isReady && p.isConnected !== false);
    if (!allReady) {
        if(window.pizarraUiUpdateCallbacks?.showNetworkError) window.pizarraUiUpdateCallbacks.showNetworkError("No todos los jugadores están listos.", false);
        return;
    }
    state.setNetworkRoomData({ roomState: 'in_game' });
    state.setCurrentDifficulty(state.networkRoomData.gameSettings.difficulty); // Set this for logic.initializeGame

    // Host calls logic.initializeGame to set up the word and initial game state (like attempts)
    const gameInitResult = logic.initializeGame(state, state.networkRoomData.gameSettings.difficulty);
    if (!gameInitResult.success || !state.currentWordObject) {
        broadcastToRoom({ type: MSG_TYPE.ERROR_MESSAGE, message: "Host failed to start game: No word selected."});
        state.setNetworkRoomData({ roomState: 'lobby' });
        if(window.pizarraUiUpdateCallbacks?.showNetworkError) window.pizarraUiUpdateCallbacks.showNetworkError("Error del Host al iniciar.", false);
        return;
    }
    const gamePlayers = state.networkRoomData.players.map(p => ({
        id: p.id, name: p.name, icon: p.icon, color: p.color, score: 0, peerId: p.peerId
    })).sort((a,b) => a.id - b.id);
    state.setPlayersData(gamePlayers); // This now also calls initRemainingAttempts via the setter in pizarraState
    state.setCurrentPlayerId(gamePlayers[0].id); // Typically host (player ID 0) starts

    const initialGameState = {
        gameSettings: state.networkRoomData.gameSettings,
        currentWordObject: state.currentWordObject,
        guessedLetters: Array.from(state.guessedLetters), // Initial empty set
        remainingAttemptsPerPlayer: [...state.remainingAttemptsPerPlayer], // Send initial attempts
        playersInGameOrder: gamePlayers,
        startingPlayerId: state.currentPlayerId,
        clueUsed: state.clueUsedThisGame, // false
        maxAttempts: state.MAX_ATTEMPTS
    };
    broadcastToRoom({ type: MSG_TYPE.GAME_STARTED, initialGameState });
    if(window.pizarraUiUpdateCallbacks?.startGameOnNetwork) window.pizarraUiUpdateCallbacks.startGameOnNetwork(initialGameState);
 }
export function sendGuessToHost(letter) { /* ... same ... */
    if (state.pvpRemoteActive && !state.networkRoomData.isRoomLeader && state.gameActive) {
        sendDataToLeader({ type: MSG_TYPE.LETTER_GUESS, letter: letter, playerId: state.networkRoomData.myPlayerIdInRoom });
    }
 }
export function sendClueRequestToHost() { /* ... same ... */ 
    if (state.pvpRemoteActive && !state.networkRoomData.isRoomLeader && state.gameActive) {
        sendDataToLeader({ type: MSG_TYPE.CLUE_REQUEST, playerId: state.networkRoomData.myPlayerIdInRoom });
    }
}
export function closeAllConnectionsAndSession() { /* ... same ... */ 
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