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
        
        // Get current network room data to check for callbacks
        const currentRoomData = state.getNetworkRoomData();
        
        if (currentRoomData._peerInitResolve) {
            currentRoomData._peerInitResolve(id);
            state.setNetworkRoomData({ _peerInitResolve: null, _peerInitReject: null });
        }
        
        if (currentRoomData._setupCompleteCallback) {
            if (currentRoomData.isRoomLeader) {
                _finalizeHostSetup(id);
            } else if (currentRoomData.leaderPeerId) {
                _finalizeClientJoinAttempt(id, currentRoomData.leaderPeerId);
            }
        }
    },
    
    onNewConnection: (conn) => { // Host: New client trying to connect
        const currentRoomData = state.getNetworkRoomData();
        if (!currentRoomData.isRoomLeader) {
            console.warn(`[PizarraPeerConn] Non-leader received connection from ${conn.peer}. Rejecting.`);
            conn.on('open', () => conn.close()); 
            return;
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
            const playerInRoomData = currentRoomData.players.find(p => p.peerId === conn.peer);
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
        const currentRoomData = state.getNetworkRoomData();
        
        if (currentRoomData.isRoomLeader) {
            const connEntry = connections.get(remotePeerId);
            if (connEntry && connEntry.status === 'pending_join_request') {
                connEntry.status = 'awaiting_join_request';
                console.log(`[PizarraPeerConn] Host: Connection with ${remotePeerId} ready for JOIN_REQUEST.`);
            }
        } else { // Client
            if (remotePeerId === currentRoomData.leaderPeerId && leaderConnection && leaderConnection.open) {
                if (currentRoomData.roomState === 'connecting_to_lobby' ||
                   (currentRoomData.roomState === 'awaiting_join_approval' && currentRoomData.myPlayerIdInRoom === null)) {
                    console.log("[PizarraPeerConn] Client: Connection to leader open. Sending JOIN_REQUEST.");
                    const myPlayerData = state.getLocalPlayerCustomizationForNetwork();
                    sendDataToLeader({
                        type: MSG_TYPE.REQUEST_JOIN_ROOM,
                        playerData: { name: myPlayerData.name, icon: myPlayerData.icon, color: myPlayerData.color }
                    });
                    state.setNetworkRoomData({ roomState: 'awaiting_join_approval' });
                } else {
                     console.log(`[PizarraPeerConn] Client: Connection to leader ${remotePeerId} open, but roomState is ${currentRoomData.roomState} and myPlayerIdInRoom is ${currentRoomData.myPlayerIdInRoom}. Not sending new JOIN_REQUEST.`);
                }
            }
        }
    },
    
    onDataReceived: (data, fromPeerId) => {
        const currentRoomData = state.getNetworkRoomData();
        const currentIsLeader = currentRoomData.isRoomLeader;
        const logPrefix = currentIsLeader ? "[PizarraPeerConn L RX]" : "[PizarraPeerConn C RX]";
        console.log(`${logPrefix} From ${fromPeerId}: Type: ${data.type}`);
        if (currentIsLeader) handleLeaderDataReception(data, fromPeerId);
        else handleClientDataReception(data, fromPeerId);
    },
    
    onConnectionClose: (peerId) => {
        console.log(`[PizarraPeerConn] Connection closed with ${peerId}.`);
        const currentRoomData = state.getNetworkRoomData();
        
        if (currentRoomData.isRoomLeader) {
            const leavingPlayerEntry = connections.get(peerId);
            if (leavingPlayerEntry) { 
                const leavingPlayer = currentRoomData.players.find(p => p.id === leavingPlayerEntry.playerGameId && p.peerId === peerId);
                state.removePlayerFromNetworkRoom(peerId);
                connections.delete(peerId);
                if (leavingPlayer) {
                    broadcastToRoom({ type: MSG_TYPE.PLAYER_LEFT, player: { id: leavingPlayer.id, name: leavingPlayer.name, peerId: peerId } });
                }
                if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
                if (currentRoomData.roomState === 'in_game' && currentRoomData.players.length < state.MIN_PLAYERS_NETWORK) {
                    broadcastToRoom({ type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, reason: 'disconnect_insufficient_players'});
                    state.setNetworkRoomData({ roomState: 'game_over' });
                    if(window.pizarraUiUpdateCallbacks?.showNetworkGameOver) window.pizarraUiUpdateCallbacks.showNetworkGameOver({reason: 'disconnect_insufficient_players'});
                }
            }
        } else { 
            if (peerId === currentRoomData.leaderPeerId) {
                console.error("[PizarraPeerConn] Client: Connection to leader lost!");
                if (currentRoomData._setupErrorCallback) {
                    currentRoomData._setupErrorCallback(new Error("Conexión con el líder perdida."));
                } else if(window.pizarraUiUpdateCallbacks?.showNetworkError) {
                    window.pizarraUiUpdateCallbacks.showNetworkError("Se perdió la conexión con el líder de la sala.", true);
                }
                state.resetFullLocalStateForNewUIScreen();
            }
        }
    },
    
    onError: (err) => {
        console.error(`[PizarraPeerConn] PeerJS Error: ${err.type}`, err.message || err);
        const currentRoomData = state.getNetworkRoomData();
        
        if (currentRoomData._peerInitReject) {
            currentRoomData._peerInitReject(err);
            state.setNetworkRoomData({ _peerInitResolve: null, _peerInitReject: null });
        }
        
        if (currentRoomData._setupErrorCallback) {
            currentRoomData._setupErrorCallback(err);
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        } else if (window.pizarraUiUpdateCallbacks?.showNetworkError){
            window.pizarraUiUpdateCallbacks.showNetworkError(`Error de Red: ${err.message || err.type}`, true);
        }
    }
};

function _finalizeHostSetup(hostPeerId) {
    const currentRoomData = state.getNetworkRoomData();
    if (!currentRoomData._setupCompleteCallback) return;
    
    state.setNetworkRoomData({
        roomId: hostPeerId, 
        leaderPeerId: hostPeerId,
        players: currentRoomData.players.map(p => p.id === 0 ? { ...p, peerId: hostPeerId, isConnected: true, isReady: true } : p),
        roomState: 'lobby'
    });
    
    currentRoomData._setupCompleteCallback(hostPeerId);
    state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
}

function _finalizeClientJoinAttempt(myPeerId, leaderPeerIdToJoin) {
    const currentRoomData = state.getNetworkRoomData();
    if (!currentRoomData._setupCompleteCallback && !currentRoomData._setupErrorCallback) return;
    
    if (!currentRoomData.isRoomLeader && leaderPeerIdToJoin && state.getPvpRemoteActive()) {
        const myInitialData = state.getLocalPlayerCustomizationForNetwork();
        state.setNetworkRoomData({ players: [{ ...myInitialData, peerId: myPeerId }] });
        
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
    } else {
        if(currentRoomData._setupErrorCallback) {
            currentRoomData._setupErrorCallback(new Error("Client join conditions not met"));
        }
        state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null }); 
    }
}

export async function ensurePeerInitialized() {
    const existingPeer = window.peerJsMultiplayer?.getPeer(); 
    let currentPeerId = window.peerJsMultiplayer?.getLocalId();
    
    if (existingPeer && !existingPeer.destroyed && currentPeerId) {
        if (state.getMyPeerId() !== currentPeerId) state.setMyPeerId(currentPeerId);
        
        const currentRoomData = state.getNetworkRoomData();
        if (currentRoomData._setupCompleteCallback) {
            if (currentRoomData.isRoomLeader) _finalizeHostSetup(currentPeerId);
            else if (currentRoomData.leaderPeerId) _finalizeClientJoinAttempt(currentPeerId, currentRoomData.leaderPeerId);
        }
        return currentPeerId;
    }
    
    const currentRoomData = state.getNetworkRoomData();
    if (currentRoomData._peerInitPromise) return currentRoomData._peerInitPromise;
    
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
        state.setNetworkRoomData({ _peerInitPromise: null }); 
        return newPeerId; 
    } catch (err) { 
        state.setNetworkRoomData({ _peerInitPromise: null }); 
        throw err; 
    }
}

export function hostNewRoom(hostPlayerData, gameSettingsFromUI) {
    state.resetFullLocalStateForNewUIScreen(); 
    state.setPvpRemoteActive(true);
    
    return new Promise(async (resolve, reject) => {
        state.setNetworkRoomData({
            isRoomLeader: true, 
            myPlayerIdInRoom: 0, 
            gameSettings: { difficulty: gameSettingsFromUI.difficulty || "easy" },
            maxPlayers: parseInt(gameSettingsFromUI.maxPlayers) || state.MAX_PLAYERS_NETWORK,
            players: [{ id: 0, peerId: null, name: hostPlayerData.name, icon: hostPlayerData.icon, color: hostPlayerData.color, isReady: true, isConnected: true, score: 0 }],
            roomState: 'creating_room', 
            _setupCompleteCallback: resolve, 
            _setupErrorCallback: reject
        });
        
        try { 
            await ensurePeerInitialized(); 
        } catch (err) { 
            const currentRoomData = state.getNetworkRoomData();
            if(currentRoomData._setupErrorCallback === reject) {
                reject(err); 
            }
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        }
    });
}

export function joinRoomById(leaderRawPeerId, joinerPlayerData) {
    state.resetFullLocalStateForNewUIScreen(); 
    state.setPvpRemoteActive(true);
    
    state.setNetworkRoomData({ 
        isRoomLeader: false, 
        roomId: leaderRawPeerId, 
        leaderPeerId: leaderRawPeerId,
        players: [{ name: joinerPlayerData.name, icon: joinerPlayerData.icon, color: joinerPlayerData.color, peerId: null }],
        roomState: 'connecting_to_lobby'
    });
    
    return new Promise(async (resolve, reject) => {
        state.setNetworkRoomData({ _setupCompleteCallback: resolve, _setupErrorCallback: reject });
        
        try { 
            await ensurePeerInitialized(); 
        } catch (err) { 
            const currentRoomData = state.getNetworkRoomData();
            if(currentRoomData._setupErrorCallback === reject) {
                reject(err); 
            }
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

function sendDataToLeader(data) {
    if (leaderConnection?.open) {
        try { 
            leaderConnection.send(data); 
        } catch (e) { 
            peerJsCallbacks.onError({type: 'send_error', message: 'Failed to send data to leader.', originalError: e});
        }
    } else {
        peerJsCallbacks.onError({type: 'send_error_no_connection', message: 'No open connection to leader.'});
    }
}

function sendDataToClient(clientPeerId, data) {
    const connEntry = connections.get(clientPeerId);
    if (connEntry?.connObject?.open) {
        try { 
            connEntry.connObject.send(data); 
        } catch (e) { 
            console.error(`[PizarraPeerConn L] Error sending to client ${clientPeerId}:`, e, data); 
        }
    } else {
        console.warn(`[PizarraPeerConn L] No open conn to client ${clientPeerId}. Cannot send. Conn Entry:`, connEntry);
    }
}

function broadcastToRoom(data, excludePeerId = null) {
    const currentRoomData = state.getNetworkRoomData();
    if (!currentRoomData.isRoomLeader) return;
    
    connections.forEach((connEntry, peerId) => {
        if (peerId !== excludePeerId && connEntry?.connObject?.open) {
            try { 
                connEntry.connObject.send(data); 
            } catch (e) {
                console.error(`[PizarraPeerConn] Error broadcasting to ${peerId}:`, e);
            }
        }
    });
}

export function broadcastRoomState() {
    const currentRoomData = state.getNetworkRoomData();
    if (!currentRoomData.isRoomLeader) return;
    
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
            console.warn(`[PizarraPeerConn L] Msg type ${data.type} from ${fromPeerId}, but player not fully joined. Ignored.`); 
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

            const currentRoomData = state.getNetworkRoomData();
            const existingPlayer = currentRoomData.players.find(p => p.peerId === fromPeerId);
            if (existingPlayer) {
                console.warn(`[PizarraPeerConn L] Player ${fromPeerId} (ID ${existingPlayer.id}) sent REQUEST_JOIN_ROOM again. Resending JOIN_ACCEPTED with existing data.`);
                sendDataToClient(fromPeerId, { type: MSG_TYPE.JOIN_ACCEPTED, yourPlayerIdInRoom: existingPlayer.id, roomData: state.getSanitizedNetworkRoomDataForClient() });
                
                if (!existingPlayer.isConnected) {
                    state.updatePlayerInNetworkRoom(fromPeerId, { isConnected: true });
                    broadcastToRoom({ type: MSG_TYPE.PLAYER_JOINED, player: {...existingPlayer, isConnected: true} }, fromPeerId);
                    if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
                }
                return; 
            }

            if (currentRoomData.players.length >= currentRoomData.maxPlayers) {
                clientConnObjForJoin.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' }); 
                return;
            }
            
            let newPlayerAssignedId = 0;
            const existingGameIds = new Set(currentRoomData.players.map(p => p.id));
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
            state.updatePlayerInNetworkRoom(fromPeerId, { isReady: data.isReady });
            broadcastToRoom({ type: MSG_TYPE.PLAYER_READY_CHANGED, player: { id: playerGameId, isReady: data.isReady, peerId: fromPeerId } });
            if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;

        case MSG_TYPE.LETTER_GUESS:
            if (playerGameId === state.getCurrentPlayerId() && state.getGameActive()) {
                const result = logic.processGuess(data.letter); 
                const guessingPlayerInGame = state.getPlayersData().find(p => p.id === playerGameId);
                if (guessingPlayerInGame) { 
                    state.updatePlayerInNetworkRoom(fromPeerId, { score: guessingPlayerInGame.score });
                }
                const guessResultPayload = { type: MSG_TYPE.GUESS_RESULT, ...result };
                broadcastToRoom(guessResultPayload);
                if (result.gameOver) {
                    state.setNetworkRoomData({ roomState: 'game_over' });
                    const winnerData = logic.getWinnerData(state); 
                    broadcastToRoom({ type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, winnerData: winnerData, finalScores: state.getPlayersData().map(p=>({id:p.id, score:p.score})) });
                }
            }
            break;

        case MSG_TYPE.CLUE_REQUEST:
            if (state.getGameActive() && !state.getClueUsedThisGame()) { 
                const clueResult = logic.requestClue(state); 
                if (clueResult.success) {
                    broadcastToRoom({ type: MSG_TYPE.CLUE_PROVIDED, clue: clueResult.clue, clueUsed: state.getClueUsedThisGame(), remainingAttemptsPerPlayer: [...state.remainingAttemptsPerPlayer] });
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
    const currentRoomData = state.getNetworkRoomData();
    if (fromLeaderPeerId !== currentRoomData.leaderPeerId) {
        console.warn(`[PizarraPeerConn C] Data from non-leader ${fromLeaderPeerId}. Expected ${currentRoomData.leaderPeerId}. Ignored.`); 
        return;
    }
    
    switch (data.type) {
        case MSG_TYPE.JOIN_ACCEPTED:
            const clientIsLeaderWas = false; 
            const clientMyPeerIdWas = state.getMyPeerId();
            const clientRoomIdWas = currentRoomData.roomId; 
            const clientLeaderPeerIdWas = currentRoomData.leaderPeerId;

            state.setNetworkRoomData({
                ...data.roomData, 
                isRoomLeader: clientIsLeaderWas, 
                myPeerId: clientMyPeerIdWas,
                roomId: clientRoomIdWas, 
                leaderPeerId: clientLeaderPeerIdWas,
                myPlayerIdInRoom: data.yourPlayerIdInRoom, 
                roomState: 'lobby'
            });
            
            const updatedRoomData = state.getNetworkRoomData();
            if (updatedRoomData._setupCompleteCallback) {
                updatedRoomData._setupCompleteCallback(state.getMyPeerId());
                state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
            }
            if(window.pizarraUiUpdateCallbacks?.showLobby) window.pizarraUiUpdateCallbacks.showLobby(false);
            break;
            
        case MSG_TYPE.JOIN_REJECTED:
            if (currentRoomData._setupErrorCallback) {
                currentRoomData._setupErrorCallback(new Error(data.reason || 'Join rejected'));
            } else if(window.pizarraUiUpdateCallbacks?.showNetworkError) {
                window.pizarraUiUpdateCallbacks.showNetworkError(`Unión Rechazada: ${data.reason || 'Desconocido'}`, true);
            }
            state.resetFullLocalStateForNewUIScreen();
            break;
            
        case MSG_TYPE.PLAYER_JOINED:
             if (data.player.peerId !== state.getMyPeerId()) state.addPlayerToNetworkRoom(data.player);
             if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;
            
        case MSG_TYPE.PLAYER_LEFT:
            state.removePlayerFromNetworkRoom(data.player.peerId);
            if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;
            
        case MSG_TYPE.ROOM_STATE_UPDATE:
             state.setNetworkRoomData({
                ...data.roomData, 
                isRoomLeader: currentRoomData.isRoomLeader, 
                myPeerId: state.getMyPeerId(),                         
                myPlayerIdInRoom: data.roomData.players.find(p=>p.peerId === state.getMyPeerId())?.id ?? currentRoomData.myPlayerIdInRoom
             });
             if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;
            
        case MSG_TYPE.PLAYER_READY_CHANGED:
            const playerToUpdate = currentRoomData.players.find(p=>p.id === data.player.id);
            const targetPeerId = data.player.peerId || playerToUpdate?.peerId;
            if(targetPeerId) state.updatePlayerInNetworkRoom(targetPeerId, { isReady: data.player.isReady });
            if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;
            
        case MSG_TYPE.GAME_STARTED:
            if(window.pizarraUiUpdateCallbacks?.startGameOnNetwork) window.pizarraUiUpdateCallbacks.startGameOnNetwork(data.initialGameState);
            break;
            
        case MSG_TYPE.GUESS_RESULT:
            state.setGuessedLetters(new Set(data.letter && data.correct ? [...state.getGuessedLetters(), data.letter] : data.guessedLetters || []));
        case MSG_TYPE.GUESS_RESULT:
            state.setGuessedLetters(new Set(data.letter && data.correct ? [...state.getGuessedLetters(), data.letter] : data.guessedLetters || []));
            state.setRemainingAttemptsPerPlayer(data.remainingAttemptsPerPlayer || state.getRemainingAttemptsPerPlayer());
            state.setCurrentPlayerId(data.nextPlayerId);
            
            if (data.scores) {
                data.scores.forEach(ps => {
                    const playerNetIdx = currentRoomData.players.findIndex(p=>p.id === ps.id);
                    if(playerNetIdx !== -1) currentRoomData.players[playerNetIdx].score = ps.score;
                    const playerGameIdx = state.getPlayersData().findIndex(p => p.id === ps.id);
                    if (playerGameIdx !== -1) state.getPlayersData()[playerGameIdx].score = ps.score;
                 });
            }
            state.setGameActive(data.nextPlayerId !== -1 && !data.gameOver && !data.wordSolved); 

            if(window.pizarraUiUpdateCallbacks?.updateGameFromNetwork) window.pizarraUiUpdateCallbacks.updateGameFromNetwork(data);
            break;
            
        case MSG_TYPE.CLUE_PROVIDED:
            state.setClueUsedThisGame(data.clueUsed);
            if (data.remainingAttemptsPerPlayer) { 
                state.setRemainingAttemptsPerPlayer(data.remainingAttemptsPerPlayer); 
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
            
        default: 
            console.warn(`[PizarraPeerConn C] Unhandled message type: ${data.type} from ${fromLeaderPeerId}`);
    }
}

// --- Actions from UI ---
export function sendPlayerReadyState(isReady) {
    const currentRoomData = state.getNetworkRoomData();
    const myData = currentRoomData.players.find(p => p.peerId === state.getMyPeerId());
    if (!myData) return;
    
    if (currentRoomData.isRoomLeader) {
        myData.isReady = isReady; 
        state.updatePlayerInNetworkRoom(state.getMyPeerId(), { isReady });
        broadcastToRoom({ type: MSG_TYPE.PLAYER_READY_CHANGED, player: { id: myData.id, isReady: isReady, peerId: state.getMyPeerId() } });
        if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
    } else {
        sendDataToLeader({ type: MSG_TYPE.PLAYER_READY_CHANGED, playerId: currentRoomData.myPlayerIdInRoom, isReady: isReady });
    }
}

export function leaderStartGameRequest() {
    const currentRoomData = state.getNetworkRoomData();
    if (!currentRoomData.isRoomLeader || currentRoomData.roomState !== 'lobby') return;
    
    const allReady = currentRoomData.players.length >= state.MIN_PLAYERS_NETWORK &&
                     currentRoomData.players.every(p => p.isReady && p.isConnected !== false);
    if (!allReady) {
        if(window.pizarraUiUpdateCallbacks?.showNetworkError) window.pizarraUiUpdateCallbacks.showNetworkError("No todos los jugadores están listos.", false);
        return;
    }
    
    state.setNetworkRoomData({ roomState: 'in_game' });
    state.setCurrentDifficulty(currentRoomData.gameSettings.difficulty); 
    const gameInitResult = logic.initializeGame(state, currentRoomData.gameSettings.difficulty);
    
    if (!gameInitResult.success || !state.getCurrentWordObject()) {
        broadcastToRoom({ type: MSG_TYPE.ERROR_MESSAGE, message: "Host failed to start game: No word selected."});
        state.setNetworkRoomData({ roomState: 'lobby' });
        if(window.pizarraUiUpdateCallbacks?.showNetworkError) window.pizarraUiUpdateCallbacks.showNetworkError("Error del Host al iniciar.", false);
        return;
    }
    
    const gamePlayers = currentRoomData.players.map(p => ({
        id: p.id, name: p.name, icon: p.icon, color: p.color, score: 0, peerId: p.peerId
    })).sort((a,b) => a.id - b.id);
    
    state.setPlayersData(gamePlayers); 
    state.setCurrentPlayerId(gamePlayers[0].id); 
    
    const initialGameState = {
        gameSettings: currentRoomData.gameSettings, 
        currentWordObject: state.getCurrentWordObject(),
        guessedLetters: Array.from(state.getGuessedLetters()), 
        remainingAttemptsPerPlayer: state.getRemainingAttemptsPerPlayer(),
        playersInGameOrder: gamePlayers, 
        startingPlayerId: state.getCurrentPlayerId(),
        clueUsed: state.getClueUsedThisGame(), 
        maxAttempts: state.MAX_ATTEMPTS
    };
    
    broadcastToRoom({ type: MSG_TYPE.GAME_STARTED, initialGameState });
    if(window.pizarraUiUpdateCallbacks?.startGameOnNetwork) window.pizarraUiUpdateCallbacks.startGameOnNetwork(initialGameState);
}

export function sendGuessToHost(letter) {
    const currentRoomData = state.getNetworkRoomData();
    if (state.getPvpRemoteActive() && !currentRoomData.isRoomLeader && state.getGameActive()) {
        sendDataToLeader({ type: MSG_TYPE.LETTER_GUESS, letter: letter, playerId: currentRoomData.myPlayerIdInRoom });
    }
}

export function sendClueRequestToHost() {
    const currentRoomData = state.getNetworkRoomData();
    if (state.getPvpRemoteActive() && !currentRoomData.isRoomLeader && state.getGameActive()) {
        sendDataToLeader({ type: MSG_TYPE.CLUE_REQUEST, playerId: currentRoomData.myPlayerIdInRoom });
    }
}

export function closeAllConnectionsAndSession() {
    const currentRoomData = state.getNetworkRoomData();
    if (currentRoomData.isRoomLeader) {
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