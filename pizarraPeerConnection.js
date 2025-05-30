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
    LETTER_GUESS: 'letter_guess',
    GUESS_RESULT: 'guess_result',
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
    onNewConnection: (conn) => { // Host: New client trying to connect
        if (!state.networkRoomData.isRoomLeader) {
            console.warn(`[PizarraPeerConn] Non-leader received connection from ${conn.peer}. Rejecting.`);
            conn.on('open', () => conn.close()); return;
        }

        // Check if we already have an active connection entry for this peerId
        if (connections.has(conn.peer)) {
            const existingEntry = connections.get(conn.peer);
            if (existingEntry.connObject && existingEntry.connObject.open && existingEntry.connObject !== conn) {
                console.warn(`[PizarraPeerConn] Host: New connection from ${conn.peer}, but active one exists. Closing new, keeping old.`);
                conn.on('open', () => conn.close());
                return;
            } else if (existingEntry.connObject !== conn) {
                 console.log(`[PizarraPeerConn] Host: Updating connection object for re-connecting peer ${conn.peer}.`);
                 if (existingEntry.connObject?.close) existingEntry.connObject.close(); // Close old if it exists
                 existingEntry.connObject = conn;
                 existingEntry.status = 'pending_join_request'; // Reset status
            }
            // If player is already in state.networkRoomData.players, their playerGameId is already set in existingEntry
        } else {
            // This peer is not in our active connections map.
            // If they are somehow in state.networkRoomData.players (e.g. after host refresh/reload not clearing state fully),
            // try to re-associate. Otherwise, new connection.
            const playerInRoomData = state.networkRoomData.players.find(p => p.peerId === conn.peer);
            connections.set(conn.peer, { 
                connObject: conn, 
                status: 'pending_join_request', 
                playerGameId: playerInRoomData ? playerInRoomData.id : -1 
            });
        }
        console.log(`[PizarraPeerConn] Host: Incoming connection from ${conn.peer} managed.`);
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
        } else { // Client
            if (remotePeerId === state.networkRoomData.leaderPeerId && leaderConnection && leaderConnection.open) {
                if (state.networkRoomData.roomState === 'connecting_to_lobby' ||
                   (state.networkRoomData.roomState === 'awaiting_join_approval' && state.networkRoomData.myPlayerIdInRoom === null)) {
                    console.log("[PizarraPeerConn] Client: Connection to leader open. Sending JOIN_REQUEST.");
                    const myPlayerData = state.getLocalPlayerCustomizationForNetwork();
                    sendDataToLeader({
                        type: MSG_TYPE.REQUEST_JOIN_ROOM,
                        playerData: { name: myPlayerData.name, icon: myPlayerData.icon, color: myPlayerData.color }
                    });
                    state.setNetworkRoomData({ roomState: 'awaiting_join_approval' });
                } else {
                     console.log(`[PizarraPeerConn] Client: Connection to leader ${remotePeerId} open, but roomState is ${state.networkRoomData.roomState} and myPlayerIdInRoom is ${state.networkRoomData.myPlayerIdInRoom}. Not sending new JOIN_REQUEST.`);
                }
            }
        }
    },
    onDataReceived: (data, fromPeerId) => {
        const currentIsLeader = state.networkRoomData.isRoomLeader;
        const logPrefix = currentIsLeader ? "[PizarraPeerConn L RX]" : "[PizarraPeerConn C RX]";
        console.log(`${logPrefix} From ${fromPeerId}: Type: ${data.type}`);
        if (currentIsLeader) handleLeaderDataReception(data, fromPeerId);
        else handleClientDataReception(data, fromPeerId);
    },
    onConnectionClose: (peerId) => { /* ... (same as previous version with UI callback calls) ... */ 
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
    onError: (err) => { /* ... (same as previous version with UI callback calls) ... */ 
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

function _finalizeHostSetup(hostPeerId) { /* ... same ... */ 
    if (!state.networkRoomData._setupCompleteCallback) return;
    state.setNetworkRoomData({
        roomId: hostPeerId, leaderPeerId: hostPeerId,
        players: state.networkRoomData.players.map(p => p.id === 0 ? { ...p, peerId: hostPeerId, isConnected: true, isReady: true } : p),
        roomState: 'lobby'
    });
    state.networkRoomData._setupCompleteCallback(hostPeerId);
    state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
}
function _finalizeClientJoinAttempt(myPeerId, leaderPeerIdToJoin) { /* ... same ... */ 
    if (!state.networkRoomData._setupCompleteCallback && !state.networkRoomData._setupErrorCallback) return;
    if (state.networkRoomData.isRoomLeader || !leaderPeerIdToJoin || !state.pvpRemoteActive) {
        if(state.networkRoomData._setupErrorCallback) state.networkRoomData._setupErrorCallback(new Error("Client join conditions not met"));
        state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null }); return;
    }
    const myInitialData = state.getLocalPlayerCustomizationForNetwork();
    state.setNetworkRoomData({ players: [{ ...myInitialData, peerId: myPeerId }] });
    if (window.peerJsMultiplayer?.connect) {
        const connToLeader = window.peerJsMultiplayer.connect(leaderPeerIdToJoin);
        if (connToLeader) { leaderConnection = connToLeader; setupConnectionEventHandlers(leaderConnection); }
        else peerJsCallbacks.onError({ type: 'connect_failed', message: `Failed to init connection to ${leaderPeerIdToJoin}.` });
    } else peerJsCallbacks.onError({ type: 'internal_error', message: 'PeerJS connect fn not available.' });
}
export async function ensurePeerInitialized() { /* ... same ... */ 
    const existingPeer = window.peerJsMultiplayer?.getPeer(); let currentPeerId = window.peerJsMultiplayer?.getLocalId();
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
export function hostNewRoom(hostPlayerData, gameSettingsFromUI) { /* ... same ... */ 
    state.resetFullLocalStateForNewUIScreen(); state.setPvpRemoteActive(true);
    return new Promise(async (resolve, reject) => {
        state.setNetworkRoomData({
            isRoomLeader: true, myPlayerIdInRoom: 0, gameSettings: { difficulty: gameSettingsFromUI.difficulty || "easy" },
            maxPlayers: parseInt(gameSettingsFromUI.maxPlayers) || state.MAX_PLAYERS_NETWORK,
            players: [{ id: 0, peerId: null, name: hostPlayerData.name, icon: hostPlayerData.icon, color: hostPlayerData.color, isReady: true, isConnected: true, score: 0 }],
            roomState: 'creating_room', _setupCompleteCallback: resolve, _setupErrorCallback: reject
        });
        try { await ensurePeerInitialized(); }
        catch (err) { if(state.networkRoomData._setupErrorCallback === reject) reject(err); state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });}
    });
}
export function joinRoomById(leaderRawPeerId, joinerPlayerData) { /* ... same, with early isRoomLeader:false ... */ 
    state.resetFullLocalStateForNewUIScreen(); state.setPvpRemoteActive(true);
    state.setNetworkRoomData({ 
        isRoomLeader: false, roomId: leaderRawPeerId, leaderPeerId: leaderRawPeerId,
        players: [{ name: joinerPlayerData.name, icon: joinerPlayerData.icon, color: joinerPlayerData.color, peerId: null }],
        roomState: 'connecting_to_lobby'
    });
    return new Promise(async (resolve, reject) => {
        state.setNetworkRoomData({ _setupCompleteCallback: resolve, _setupErrorCallback: reject });
        try { await ensurePeerInitialized(); }
        catch (err) { if(state.networkRoomData._setupErrorCallback === reject) reject(err); state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });}
    });
}
function setupConnectionEventHandlers(conn) { /* ... same ... */ 
    conn.on('open', () => peerJsCallbacks.onConnectionOpen(conn.peer));
    conn.on('data', (data) => peerJsCallbacks.onDataReceived(data, conn.peer));
    conn.on('close', () => peerJsCallbacks.onConnectionClose(conn.peer));
    conn.on('error', (err) => peerJsCallbacks.onError(err));
}
function sendDataToLeader(data) { /* ... same ... */ 
    if (leaderConnection?.open) try { leaderConnection.send(data); } catch (e) { peerJsCallbacks.onError({type: 'send_error', message: 'Failed to send data to leader.', originalError: e});}
    else peerJsCallbacks.onError({type: 'send_error_no_connection', message: 'No open connection to leader.'});
}
function sendDataToClient(clientPeerId, data) { /* ... same ... */ 
    const connEntry = connections.get(clientPeerId);
    if (connEntry?.connObject?.open) try { connEntry.connObject.send(data); } catch (e) { console.error(`[PizarraPeerConn L] Error sending to client ${clientPeerId}:`, e, data); }
    else console.warn(`[PizarraPeerConn L] No open conn to client ${clientPeerId}. Cannot send. Conn Entry:`, connEntry);
}
function broadcastToRoom(data, excludePeerId = null) { /* ... same ... */ 
    if (!state.networkRoomData.isRoomLeader) return;
    connections.forEach((connEntry, peerId) => {
        if (peerId !== excludePeerId && connEntry?.connObject?.open) try { connEntry.connObject.send(data); } catch (e) {}
    });
}
export function broadcastRoomState() { /* ... same ... */ 
    if (!state.networkRoomData.isRoomLeader) return;
    broadcastToRoom({ type: MSG_TYPE.ROOM_STATE_UPDATE, roomData: state.getSanitizedNetworkRoomDataForClient() });
}

// --- Message Handlers ---
function handleLeaderDataReception(data, fromPeerId) {
    const connEntry = connections.get(fromPeerId);

    if (!connEntry && data.type !== MSG_TYPE.REQUEST_JOIN_ROOM) {
        console.warn(`[PizarraPeerConn L] Data from ${fromPeerId} (Type: ${data.type}) but no established connection entry. Ignored.`);
        return;
    }
    let playerGameId;
    if (data.type !== MSG_TYPE.REQUEST_JOIN_ROOM) {
        if (!connEntry || connEntry.playerGameId === -1) {
            console.warn(`[PizarraPeerConn L] Msg type ${data.type} from ${fromPeerId}, but player not fully joined. Ignored.`); return;
        }
        playerGameId = connEntry.playerGameId;
    }

    switch (data.type) {
        case MSG_TYPE.REQUEST_JOIN_ROOM:
            const clientConnObjForJoin = connEntry?.connObject || window.peerJsMultiplayer.getConnection(fromPeerId);
            if (!clientConnObjForJoin) {
                console.warn(`[PizarraPeerConn L] REQUEST_JOIN_ROOM from ${fromPeerId} but actual connection object not found.`); return;
            }

            // MODIFICATION: Prevent adding same peerId multiple times
            const existingPlayer = state.networkRoomData.players.find(p => p.peerId === fromPeerId);
            if (existingPlayer) {
                console.warn(`[PizarraPeerConn L] Player ${fromPeerId} (ID ${existingPlayer.id}) sent REQUEST_JOIN_ROOM again. Resending JOIN_ACCEPTED with existing data.`);
                sendDataToClient(fromPeerId, { type: MSG_TYPE.JOIN_ACCEPTED, yourPlayerIdInRoom: existingPlayer.id, roomData: state.getSanitizedNetworkRoomDataForClient() });
                // If they were marked as disconnected, mark them as connected again and inform others.
                if (!existingPlayer.isConnected) {
                    state.updatePlayerInNetworkRoom(fromPeerId, { isConnected: true });
                    broadcastToRoom({ type: MSG_TYPE.PLAYER_JOINED, player: {...existingPlayer, isConnected: true} }, fromPeerId);
                    if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
                }
                return; 
            }

            if (state.networkRoomData.players.length >= state.networkRoomData.maxPlayers) {
                clientConnObjForJoin.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' }); return;
            }
            
            let newPlayerAssignedId = 0;
            const existingGameIds = new Set(state.networkRoomData.players.map(p => p.id));
            while(existingGameIds.has(newPlayerAssignedId)) { newPlayerAssignedId++; }

            const newPlayer = { id: newPlayerAssignedId, peerId: fromPeerId, ...data.playerData, isReady: false, isConnected: true, score: 0 };
            state.addPlayerToNetworkRoom(newPlayer);
            connections.set(fromPeerId, {connObject: clientConnObjForJoin, playerGameId: newPlayer.id, status: 'active'});

            console.log(`[PizarraPeerConn L] Sending JOIN_ACCEPTED to ${fromPeerId} (Player ID ${newPlayer.id})`);
            sendDataToClient(fromPeerId, { type: MSG_TYPE.JOIN_ACCEPTED, yourPlayerIdInRoom: newPlayer.id, roomData: state.getSanitizedNetworkRoomDataForClient() });
            broadcastToRoom({ type: MSG_TYPE.PLAYER_JOINED, player: newPlayer }, fromPeerId);
            if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;
        // ... (PLAYER_READY_CHANGED, LETTER_GUESS, CLUE_REQUEST remain as in your corrected version from last turn)
        case MSG_TYPE.PLAYER_READY_CHANGED:
            state.updatePlayerInNetworkRoom(fromPeerId, { isReady: data.isReady });
            broadcastToRoom({ type: MSG_TYPE.PLAYER_READY_CHANGED, player: { id: playerGameId, isReady: data.isReady, peerId: fromPeerId } });
            if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;

        case MSG_TYPE.LETTER_GUESS:
            if (playerGameId === state.currentPlayerId && state.gameActive) {
                const result = logic.processGuess(data.letter); 
                const guessingPlayerInGame = state.playersData.find(p => p.id === playerGameId);
                if (guessingPlayerInGame) { 
                    state.updatePlayerInNetworkRoom(fromPeerId, { score: guessingPlayerInGame.score });
                }
                const guessResultPayload = { type: MSG_TYPE.GUESS_RESULT, ...result };
                broadcastToRoom(guessResultPayload);
                if (result.gameOver) {
                    state.setNetworkRoomData({ roomState: 'game_over' });
                    const winnerData = logic.getWinnerData(state); 
                    broadcastToRoom({ type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, winnerData: winnerData, finalScores: state.playersData.map(p=>({id:p.id, score:p.score})) });
                }
            }
            break;

        case MSG_TYPE.CLUE_REQUEST:
            if (state.gameActive && !state.clueUsedThisGame) { 
                const clueResult = logic.requestClue(state); 
                if (clueResult.success) {
                    broadcastToRoom({ type: MSG_TYPE.CLUE_PROVIDED, clue: clueResult.clue, clueUsed: state.clueUsedThisGame, remainingAttemptsPerPlayer: [...state.remainingAttemptsPerPlayer] });
                } else {
                    sendDataToClient(fromPeerId, {type: MSG_TYPE.ERROR_MESSAGE, message: clueResult.message || "No se pudo obtener la pista." });
                }
            }
            break;
        default: console.warn(`[PizarraPeerConn L] Unhandled message type: ${data.type} from ${fromPeerId}`);
    }
}

function handleClientDataReception(data, fromLeaderPeerId) {
    // ... (CRITICAL FIX for JOIN_ACCEPTED as in your last response)
    if (fromLeaderPeerId !== state.networkRoomData.leaderPeerId) {
        console.warn(`[PizarraPeerConn C] Data from non-leader ${fromLeaderPeerId}. Expected ${state.networkRoomData.leaderPeerId}. Ignored.`); return;
    }
    switch (data.type) {
        case MSG_TYPE.JOIN_ACCEPTED:
            const clientIsLeaderWas = false; 
            const clientMyPeerIdWas = state.myPeerId;
            const clientRoomIdWas = state.networkRoomData.roomId; 
            const clientLeaderPeerIdWas = state.networkRoomData.leaderPeerId;

            state.setNetworkRoomData({
                ...data.roomData, 
                isRoomLeader: clientIsLeaderWas, myPeerId: clientMyPeerIdWas,
                roomId: clientRoomIdWas, leaderPeerId: clientLeaderPeerIdWas,
                myPlayerIdInRoom: data.yourPlayerIdInRoom, roomState: 'lobby'
            });
            if (state.networkRoomData._setupCompleteCallback) {
                state.networkRoomData._setupCompleteCallback(state.myPeerId);
                state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
            }
            if(window.pizarraUiUpdateCallbacks?.showLobby) window.pizarraUiUpdateCallbacks.showLobby(false);
            break;
        // ... (other cases like JOIN_REJECTED, PLAYER_JOINED etc. as in your corrected version) ...
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
                ...data.roomData, isRoomLeader: state.networkRoomData.isRoomLeader, 
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
            if(window.pizarraUiUpdateCallbacks?.startGameOnNetwork) window.pizarraUiUpdateCallbacks.startGameOnNetwork(data.initialGameState);
            break;
        case MSG_TYPE.GUESS_RESULT: // This data is the full result from gameLogic.processGuess
            state.setGuessedLetters(new Set(data.letter && data.correct ? [...state.guessedLetters, data.letter] : data.guessedLetters || [])); // Use data.guessedLetters from payload
            state.remainingAttemptsPerPlayer[data.affectedPlayerId] = data.attemptsLeft;
            state.setCurrentPlayerId(data.nextPlayerId);
            
            if (data.scores) {
                data.scores.forEach(ps => {
                    const playerNetIdx = state.networkRoomData.players.findIndex(p=>p.id === ps.id);
                    if(playerNetIdx !== -1) state.networkRoomData.players[playerNetIdx].score = ps.score;
                    const playerGameIdx = state.playersData.findIndex(p => p.id === ps.id);
                    if (playerGameIdx !== -1) state.playersData[playerGameIdx].score = ps.score;
                 });
            }
            state.setGameActive(data.nextPlayerId !== -1 && !data.gameOver && !data.wordSolved); 

            if(window.pizarraUiUpdateCallbacks?.updateGameFromNetwork) window.pizarraUiUpdateCallbacks.updateGameFromNetwork(data); // Pass the whole GUESS_RESULT
            break;
        case MSG_TYPE.CLUE_PROVIDED:
            state.setClueUsedThisGame(data.clueUsed);
            if (data.remainingAttemptsPerPlayer) { state.setRemainingAttemptsPerPlayer(data.remainingAttemptsPerPlayer); }
            if(window.pizarraUiUpdateCallbacks?.displayClueFromNetwork) window.pizarraUiUpdateCallbacks.displayClueFromNetwork(data);
            break;
        case MSG_TYPE.GAME_OVER_ANNOUNCEMENT:
            state.setGameActive(false); state.setNetworkRoomData({ roomState: 'game_over' });
            if(window.pizarraUiUpdateCallbacks?.showNetworkGameOver) window.pizarraUiUpdateCallbacks.showNetworkGameOver(data);
            break;
        case MSG_TYPE.ERROR_MESSAGE:
            if(window.pizarraUiUpdateCallbacks?.showNetworkError) window.pizarraUiUpdateCallbacks.showNetworkError(data.message, false);
            break;
        default: console.warn(`[PizarraPeerConn C] Unhandled message type: ${data.type} from ${fromLeaderPeerId}`);
    }
}

// --- Actions from UI ---
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
    state.setCurrentDifficulty(state.networkRoomData.gameSettings.difficulty); 
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
    state.setPlayersData(gamePlayers); 
    state.setCurrentPlayerId(gamePlayers[0].id); 
    const initialGameState = {
        gameSettings: state.networkRoomData.gameSettings, currentWordObject: state.currentWordObject,
        guessedLetters: Array.from(state.guessedLetters), 
        remainingAttemptsPerPlayer: [...state.remainingAttemptsPerPlayer], // Send current attempts array
        playersInGameOrder: gamePlayers, startingPlayerId: state.currentPlayerId,
        clueUsed: state.clueUsedThisGame, maxAttempts: state.MAX_ATTEMPTS
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