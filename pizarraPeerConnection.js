// pizarraPeerConnection.js

import * as state from './pizarraState.js';
import * as logic from './gameLogic.js'; // Host uses this to process game events
import * as pizarraNetHandlers from './pizarraNetHandlers.js'; // --- PATCH: Import new handlers ---

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
    ERROR_MESSAGE: 'error_message_pizarra',
    STATE_SYNC: 'state_sync' // Added as per your RCA
};

const peerJsCallbacks = {
    onPeerOpen: (id) => {
        console.log(`[PizarraPeerConn] My PeerJS ID: ${id}.`);
        state.setMyPeerId(id);
        
        const currentRoomData = state.getNetworkRoomData(); 
        
        const setupState = state.getRawNetworkRoomData(); 

        if (setupState._peerInitResolve) {
            setupState._peerInitResolve(id);
            state.setNetworkRoomData({ _peerInitResolve: null, _peerInitReject: null }); 
        }
        
        if (setupState._setupCompleteCallback) {
            if (setupState.isRoomLeader) {
                _finalizeHostSetup(id);
            } else if (setupState.leaderPeerId) {
                _finalizeClientJoinAttempt(id, setupState.leaderPeerId);
            }
        }
    },
    
    onNewConnection: (conn) => { 
        const currentRoomData = state.getNetworkRoomData();
        if (!currentRoomData.isRoomLeader) {
            console.warn(`[PizarraPeerConn] Non-leader received connection from ${conn.peer}. Rejecting.`);
            conn.on('open', () => conn.close()); 
            return;
        }

        if (connections.has(conn.peer)) {
            const existingEntry = connections.get(conn.peer);
            if (existingEntry.connObject && existingEntry.connObject.open && existingEntry.connObject !== conn) {
                console.warn(`[PizarraPeerConn] Host: New connection from ${conn.peer}, but active one exists. Closing new, keeping old.`);
                conn.on('open', () => conn.close());
                return;
            } else if (existingEntry.connObject !== conn) {
                 console.log(`[PizarraPeerConn] Host: Updating connection object for re-connecting peer ${conn.peer}.`);
                 if (existingEntry.connObject?.close) existingEntry.connObject.close(); 
                 existingEntry.connObject = conn;
                 existingEntry.status = 'pending_join_request'; 
            }
        } else {
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
        } else { 
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
        if (data?.type === MSG_TYPE.STATE_SYNC) { // Use MSG_TYPE
            return; 
        }

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
        const rawRoomDataForHost = state.getRawNetworkRoomData(); 
        
        if (rawRoomDataForHost.isRoomLeader) {
            const leavingPlayerEntry = connections.get(peerId);
            if (leavingPlayerEntry) { 
                const leavingPlayer = rawRoomDataForHost.players.find(p => p.id === leavingPlayerEntry.playerGameId && p.peerId === peerId);
                state.removePlayerFromNetworkRoom(peerId); 
                connections.delete(peerId);
                if (leavingPlayer) {
                    broadcastToRoom({ type: MSG_TYPE.PLAYER_LEFT, player: { id: leavingPlayer.id, name: leavingPlayer.name, peerId: peerId } });
                }
                pizarraNetHandlers.broadcastState(connections);
                if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();

                const updatedPlayersList = state.getNetworkRoomData().players;
                if (state.getGamePhase() === 'playing' && updatedPlayersList.length < state.MIN_PLAYERS_NETWORK) {
                    const gameOverReason = 'disconnect_insufficient_players';
                    broadcastToRoom({ type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, reason: gameOverReason, finalWord: state.getCurrentWordObject()?.word });
                    state.setNetworkRoomData({ roomState: 'game_over' }); 
                    if(window.pizarraUiUpdateCallbacks?.showNetworkGameOver) window.pizarraUiUpdateCallbacks.showNetworkGameOver({reason: gameOverReason, finalWord: state.getCurrentWordObject()?.word});
                }
            }
        } else { 
            if (peerId === currentRoomData.leaderPeerId) { 
                console.error("[PizarraPeerConn] Client: Connection to leader lost!");
                const setupState = state.getRawNetworkRoomData(); 
                if (setupState._setupErrorCallback) {
                    setupState._setupErrorCallback(new Error("Conexión con el líder perdida."));
                } else if(window.pizarraUiUpdateCallbacks?.showNetworkError) {
                    window.pizarraUiUpdateCallbacks.showNetworkError("Se perdió la conexión con el líder de la sala.", true);
                }
                state.resetFullLocalStateForNewUIScreen(); 
            }
        }
    },
    
    onError: (err) => {
        console.error(`[PizarraPeerConn] PeerJS Error: ${err.type}`, err.message || err);
        const setupState = state.getRawNetworkRoomData(); 
        
        if (setupState._peerInitReject) {
            setupState._peerInitReject(err);
            state.setNetworkRoomData({ _peerInitResolve: null, _peerInitReject: null });
        }
        
        if (setupState._setupErrorCallback) {
            setupState._setupErrorCallback(err);
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        } else if (window.pizarraUiUpdateCallbacks?.showNetworkError && err.type !== 'peer-unavailable'){ 
        }
    }
};

function _finalizeHostSetup(hostPeerId) {
    const setupState = state.getRawNetworkRoomData();
    if (!setupState._setupCompleteCallback) return;
    
    state.setNetworkRoomData({
        roomId: hostPeerId, 
        leaderPeerId: hostPeerId,
        players: setupState.players.map(p => p.id === 0 ? { ...p, peerId: hostPeerId, isConnected: true, isReady: true } : p), 
        roomState: 'lobby' 
    });
    
    setupState._setupCompleteCallback(hostPeerId); 
    state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null }); 
}

function _finalizeClientJoinAttempt(myPeerId, leaderPeerIdToJoin) {
    const setupState = state.getRawNetworkRoomData();
    if (!setupState._setupCompleteCallback && !setupState._setupErrorCallback) return;
    
    if (!setupState.isRoomLeader && leaderPeerIdToJoin && state.getPvpRemoteActive()) {
        const myInitialData = state.getLocalPlayerCustomizationForNetwork();
        state.setNetworkRoomData({ 
            players: [{ ...myInitialData, peerId: myPeerId, id: null, isReady: false, isConnected: false }] 
        });
        
        if (window.peerJsMultiplayer?.connect) {
            const connToLeader = window.peerJsMultiplayer.connect(leaderPeerIdToJoin);
            if (connToLeader) { 
                leaderConnection = connToLeader; 
            } else {
                peerJsCallbacks.onError({ type: 'connect_failed', message: `Failed to init connection to ${leaderPeerIdToJoin}.` });
            }
        } else {
            peerJsCallbacks.onError({ type: 'internal_error', message: 'PeerJS connect fn not available.' });
        }
    } else {
        if(setupState._setupErrorCallback) {
            setupState._setupErrorCallback(new Error("Client join conditions not met"));
        }
        state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null }); 
    }
}

export async function ensurePeerInitialized() {
    const existingPeer = window.peerJsMultiplayer?.getPeer(); 
    let currentPeerId = window.peerJsMultiplayer?.getLocalId();
    
    if (existingPeer && !existingPeer.destroyed && currentPeerId) {
        if (state.getMyPeerId() !== currentPeerId) state.setMyPeerId(currentPeerId);
        
        const setupState = state.getRawNetworkRoomData(); 
        if (setupState._setupCompleteCallback) { 
            if (setupState.isRoomLeader) _finalizeHostSetup(currentPeerId);
            else if (setupState.leaderPeerId) _finalizeClientJoinAttempt(currentPeerId, setupState.leaderPeerId);
        }
        return currentPeerId;
    }
    
    const setupState = state.getRawNetworkRoomData();
    if (setupState._peerInitPromise) return setupState._peerInitPromise; 
    
    const initPromise = new Promise((resolve, reject) => {
        state.setNetworkRoomData({ _peerInitResolve: resolve, _peerInitReject: reject });

        const peerJSOptions = {
            host: 'palabras.martinez.fyi',
            port: 443,
            secure: true,
            path: '/peerjs',
            debug: 2 
        };

        if (window.peerJsMultiplayer?.init) {
            window.peerJsMultiplayer.init(peerJSOptions, peerJsCallbacks); 
        } else {
            const initReject = state.getRawNetworkRoomData()._peerInitReject;
            if(initReject) initReject(new Error('PeerJS wrapper not ready.'));
            else reject(new Error('PeerJS wrapper not ready and reject callback missing.'));
            state.setNetworkRoomData({ _peerInitResolve: null, _peerInitReject: null });
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
            const currentSetupState = state.getRawNetworkRoomData();
            if(currentSetupState._setupErrorCallback === reject) {
                reject(err); 
            }
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        }
    });
}

export function joinRoomById(leaderRawPeerId, joinerPlayerData) {
    state.resetFullLocalStateForNewUIScreen(); 
    state.setPvpRemoteActive(true);
    
    return new Promise(async (resolve, reject) => {
        state.setNetworkRoomData({ 
            isRoomLeader: false, 
            roomId: leaderRawPeerId, 
            leaderPeerId: leaderRawPeerId, 
            players: [{ name: joinerPlayerData.name, icon: joinerPlayerData.icon, color: joinerPlayerData.color, peerId: null }],
            roomState: 'connecting_to_lobby',
            _setupCompleteCallback: resolve, 
            _setupErrorCallback: reject
        });
        
        try { 
            await ensurePeerInitialized(); 
        } catch (err) { 
            const currentSetupState = state.getRawNetworkRoomData();
            if(currentSetupState._setupErrorCallback === reject) {
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
    conn.on('error', (err) => peerJsCallbacks.onError({ ...err, peer: conn.peer })); 
    pizarraNetHandlers.attach(conn);
}


function sendDataToLeader(data) {
    if (leaderConnection?.open) {
        try { 
            leaderConnection.send(data); 
        } catch (e) { 
            peerJsCallbacks.onError({type: 'send_error', message: 'Failed to send data to leader.', originalError: e, peer: leaderConnection.peer});
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
        console.warn(`[PizarraPeerConn L] No open conn to client ${clientPeerId}. Cannot send. Data:`, data, "Conn Entry:", connEntry);
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
                console.error(`[PizarraPeerConn L] Error broadcasting to ${peerId}:`, e, data);
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
    if (connEntry) { 
        playerGameId = connEntry.playerGameId;
        if (data.type !== MSG_TYPE.REQUEST_JOIN_ROOM && playerGameId === -1) { 
            console.warn(`[PizarraPeerConn L] Msg type ${data.type} from ${fromPeerId}, but player not fully joined (game ID -1). Ignored.`); 
            return;
        }
    }


    switch (data.type) {
        case MSG_TYPE.REQUEST_JOIN_ROOM:
            const clientConnObjForJoin = connEntry?.connObject || window.peerJsMultiplayer.getConnection(fromPeerId);
            if (!clientConnObjForJoin) {
                console.warn(`[PizarraPeerConn L] REQUEST_JOIN_ROOM from ${fromPeerId} but actual connection object not found.`); 
                return;
            }

            const currentHostState = state.getRawNetworkRoomData(); 
            const existingPlayer = currentHostState.players.find(p => p.peerId === fromPeerId);
            
            if (existingPlayer && existingPlayer.id !== null) { 
                console.warn(`[PizarraPeerConn L] Player ${fromPeerId} (ID ${existingPlayer.id}) sent REQUEST_JOIN_ROOM again. Resending JOIN_ACCEPTED.`);
                if (!existingPlayer.isConnected) {
                    state.updatePlayerInNetworkRoom(fromPeerId, { isConnected: true });
                }
                sendDataToClient(fromPeerId, { 
                    type: MSG_TYPE.JOIN_ACCEPTED, 
                    yourPlayerIdInRoom: existingPlayer.id, 
                    roomData: state.getSanitizedNetworkRoomDataForClient() 
                });
                pizarraNetHandlers.broadcastState(connections);
                return; 
            }

            if (currentHostState.players.length >= currentHostState.maxPlayers) {
                sendDataToClient(fromPeerId, { type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' }); 
                clientConnObjForJoin.close(); 
                return;
            }
            
            let newPlayerAssignedId = 0;
            const existingGameIds = new Set(currentHostState.players.map(p => p.id));
            while(existingGameIds.has(newPlayerAssignedId)) { newPlayerAssignedId++; }

            const newPlayer = { 
                id: newPlayerAssignedId, 
                peerId: fromPeerId, 
                ...data.playerData, 
                isReady: false, 
                isConnected: true, 
                score: 0 
            };
            state.addPlayerToNetworkRoom(newPlayer); 

            if (connEntry) {
                connEntry.playerGameId = newPlayer.id;
                connEntry.status = 'active';
            } else {
                connections.set(fromPeerId, {connObject: clientConnObjForJoin, playerGameId: newPlayer.id, status: 'active'});
            }

            console.log(`[PizarraPeerConn L] Sending JOIN_ACCEPTED to ${fromPeerId} (Player ID ${newPlayer.id})`);
            sendDataToClient(fromPeerId, { 
                type: MSG_TYPE.JOIN_ACCEPTED, 
                yourPlayerIdInRoom: newPlayer.id, 
                roomData: state.getSanitizedNetworkRoomDataForClient() 
            });
            pizarraNetHandlers.broadcastState(connections);
            if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby(); 
            break;
            
        case MSG_TYPE.PLAYER_READY_CHANGED:
            state.updatePlayerInNetworkRoom(fromPeerId, { isReady: data.isReady });
            pizarraNetHandlers.broadcastState(connections);
            if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby(); 
            break;

        case MSG_TYPE.LETTER_GUESS:
            if (playerGameId === state.getCurrentPlayerId() && state.getGameActive()) {
                const result = logic.processGuess(data.letter);
                
                const hostGameState = state.getRawNetworkRoomData();
                const guessingPlayerInState = hostGameState.players.find(p => p.id === playerGameId);
                const gameLogicPlayer = state.getPlayersData().find(p => p.id === playerGameId);
                if (guessingPlayerInState && gameLogicPlayer) {
                    guessingPlayerInState.score = gameLogicPlayer.score;
                    state.setNetworkRoomData({ players: [...hostGameState.players] });
                }
                
                const guessResultPayload = { 
                    type: MSG_TYPE.GUESS_RESULT, 
                    ...result, 
                    letter: data.letter.toUpperCase() 
                };
                broadcastToRoom(guessResultPayload);
                
                pizarraNetHandlers.broadcastState(connections);
                
                if (result.gameOver) {
                    state.setNetworkRoomData({ roomState: 'game_over' });
                    const winnerData = logic.getWinnerData(state);
                    const finalWord = state.getCurrentWordObject()?.word;
                    broadcastToRoom({
                        type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT,
                        winnerData: winnerData,
                        finalScores: state.getPlayersData().map(p=>({id:p.id, score:p.score})),
                        finalWord: finalWord
                    });
                }
            }
            break;

        case MSG_TYPE.CLUE_REQUEST:
            if (state.getGameActive() && !state.getClueUsedThisGame()) {
                const clueResult = logic.requestClue(state); // Pass the global state module
                if (clueResult.success) {
                    broadcastToRoom({
                        type: MSG_TYPE.CLUE_PROVIDED,
                        clue: clueResult.clue,
                        clueUsed: state.getClueUsedThisGame(),
                        remainingAttemptsPerPlayer: state.getRemainingAttemptsPerPlayer()
                    });
                    pizarraNetHandlers.broadcastState(connections);
                } else {
                    sendDataToClient(fromPeerId, {
                        type: MSG_TYPE.ERROR_MESSAGE, 
                        message: clueResult.message || "No se pudo obtener la pista."
                    });
                }
            }
            break;
            
        default: 
            console.warn(`[PizarraPeerConn L] Unhandled message type: ${data.type} from ${fromPeerId}`, data);
    }
}

function handleClientDataReception(data, fromLeaderPeerId) {
    const currentClientState = state.getNetworkRoomData(); 
    if (fromLeaderPeerId !== currentClientState.leaderPeerId) {
        console.warn(`[PizarraPeerConn C] Data from non-leader ${fromLeaderPeerId}. Expected ${currentClientState.leaderPeerId}. Ignored.`, data); 
        return;
    }
    
    switch (data.type) {
        case MSG_TYPE.JOIN_ACCEPTED:
            state.setNetworkRoomData({
                ...data.roomData, 
                isRoomLeader: false, 
                myPeerId: state.getMyPeerId(),                         
                myPlayerIdInRoom: data.yourPlayerIdInRoom, 
                leaderPeerId: currentClientState.leaderPeerId, 
                roomId: currentClientState.roomId, 
                roomState: data.roomData.roomState || 'lobby' 
            });
            
            const setupState = state.getRawNetworkRoomData(); 
            if (setupState._setupCompleteCallback) {
                setupState._setupCompleteCallback(state.getMyPeerId());
                state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
            }
            if(window.pizarraUiUpdateCallbacks?.showLobby) window.pizarraUiUpdateCallbacks.showLobby(false);
            break;
            
        case MSG_TYPE.JOIN_REJECTED:
            const clientSetupState = state.getRawNetworkRoomData();
            if (clientSetupState._setupErrorCallback) {
                clientSetupState._setupErrorCallback(new Error(data.reason || 'Join rejected'));
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
                isRoomLeader: currentClientState.isRoomLeader, 
                myPeerId: state.getMyPeerId(),                         
                myPlayerIdInRoom: data.roomData.players.find(p=>p.peerId === state.getMyPeerId())?.id ?? currentClientState.myPlayerIdInRoom,
                leaderPeerId: currentClientState.leaderPeerId,
                roomId: currentClientState.roomId
             });
             if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;
            
        case MSG_TYPE.PLAYER_READY_CHANGED: 
            const rawClientState = state.getRawNetworkRoomData();
            const playerToUpdateIdx = rawClientState.players.findIndex(p=>p.id === data.player.id);
            if(playerToUpdateIdx !== -1) {
                rawClientState.players[playerToUpdateIdx].isReady = data.player.isReady;
                state.setNetworkRoomData({ players: [...rawClientState.players] }); 
            }
            if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;
            
        case MSG_TYPE.GAME_STARTED:
            state.setPlayersData(data.initialGameState.playersInGameOrder);
            state.setRemainingAttemptsPerPlayer(data.initialGameState.remainingAttemptsPerPlayer);
            state.setCurrentWordObject(data.initialGameState.currentWordObject);
            state.setGuessedLetters(new Set(data.initialGameState.guessedLetters || []));
            state.setCurrentPlayerId(data.initialGameState.startingPlayerId);
            state.setClueUsedThisGame(data.initialGameState.clueUsed || false);
            state.setCurrentDifficulty(data.initialGameState.gameSettings.difficulty);
            state.setGameActive(true);
            state.setGamePhase('playing'); 
             state.setNetworkRoomData({ 
                gameSettings: data.initialGameState.gameSettings,
                players: data.initialGameState.playersInGameOrder.map(p => ({ 
                    id: p.id,
                    peerId: p.peerId, 
                    name: p.name,
                    icon: p.icon,
                    color: p.color,
                    isReady: true, 
                    isConnected: true, 
                    score: p.score
                })),
                roomState: 'playing'
            });

            if(window.pizarraUiUpdateCallbacks?.startGameOnNetwork) window.pizarraUiUpdateCallbacks.startGameOnNetwork(data.initialGameState);
            break;
            
        case MSG_TYPE.GUESS_RESULT:
            state.setGuessedLetters(new Set(data.guessedLetters || []));
            if(data.remainingAttemptsPerPlayer) {
                state.setRemainingAttemptsPerPlayer(data.remainingAttemptsPerPlayer);
            }
            if(data.nextPlayerId !== undefined) {
                state.setCurrentPlayerId(data.nextPlayerId);
            }
            
            if (data.scores) { 
                const currentPlayers = state.getPlayersData();
                const networkPlayers = state.getRawNetworkRoomData().players;
                data.scores.forEach(ps => {
                    const pLocalGame = currentPlayers.find(p => p.id === ps.id);
                    if (pLocalGame) pLocalGame.score = ps.score;
                    const pNetwork = networkPlayers.find(p => p.id === ps.id);
                    if (pNetwork) pNetwork.score = ps.score;
                 });
                state.setPlayersData([...currentPlayers]); 
                state.setNetworkRoomData({ players: [...networkPlayers] }); 
            }
            
            state.setGameActive(!data.gameOver && !data.wordSolved); 

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
            if (data.finalWord && !state.getCurrentWordObject()?.word) { 
                state.setCurrentWordObject({word: data.finalWord, definition: "N/A", difficulty: state.getCurrentDifficulty()});
                 const finalGuessed = state.getGuessedLetters();
                for (const letter of state.getCurrentWord()) { finalGuessed.add(letter.toLowerCase()); }
                state.setGuessedLetters(finalGuessed);
            }
            if(window.pizarraUiUpdateCallbacks?.showNetworkGameOver) window.pizarraUiUpdateCallbacks.showNetworkGameOver(data);
            break;
            
        case MSG_TYPE.ERROR_MESSAGE:
            if(window.pizarraUiUpdateCallbacks?.showNetworkError) window.pizarraUiUpdateCallbacks.showNetworkError(data.message, false);
            break;
            
        default: 
            console.warn(`[PizarraPeerConn C] Unhandled message type: ${data.type} from ${fromLeaderPeerId}`, data);
    }
}

// --- Actions from UI ---
export function sendPlayerReadyState(isReady) {
    const currentRoomData = state.getNetworkRoomData(); 
    const myData = currentRoomData.players.find(p => p.peerId === state.getMyPeerId());
    if (!myData) return;
    
    if (currentRoomData.isRoomLeader) {
        state.updatePlayerInNetworkRoom(state.getMyPeerId(), { isReady });
        pizarraNetHandlers.broadcastState(connections); 
        if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
    } else {
        sendDataToLeader({ type: MSG_TYPE.PLAYER_READY_CHANGED, playerId: currentRoomData.myPlayerIdInRoom, isReady: isReady });
    }
}

export function leaderStartGameRequest() {
    const currentRoomData = state.getRawNetworkRoomData();
    if (!currentRoomData.isRoomLeader || currentRoomData.roomState !== 'lobby') return;
    
    const allReady = currentRoomData.players.length >= state.MIN_PLAYERS_NETWORK &&
                     currentRoomData.players.every(p => p.isReady && p.isConnected !== false);
    if (!allReady) {
        if(window.pizarraUiUpdateCallbacks?.showNetworkError) {
            window.pizarraUiUpdateCallbacks.showNetworkError("No todos los jugadores están listos.", false);
        }
        return;
    }
    
    state.setNetworkRoomData({ roomState: 'in_game' });
    state.setCurrentDifficulty(currentRoomData.gameSettings.difficulty);
    
    const gameInitResult = logic.initializeGame(state, currentRoomData.gameSettings.difficulty);
    
    if (!gameInitResult.success || !state.getCurrentWordObject()) {
        state.setNetworkRoomData({ roomState: 'lobby' });
        pizarraNetHandlers.broadcastState(connections);
        if(window.pizarraUiUpdateCallbacks?.showNetworkError) {
            window.pizarraUiUpdateCallbacks.showNetworkError("Error al iniciar: No se pudo seleccionar palabra.", false);
        }
        return;
    }
    
    const playersForGame = currentRoomData.players.map(p => ({ 
        id: p.id, name: p.name, icon: p.icon, color: p.color, score: 0, peerId: p.peerId 
    })).sort((a,b) => a.id - b.id);
    
    state.setPlayersData(playersForGame);
    state.setCurrentPlayerId(playersForGame[0].id);
    
    const initialGameState = {
        gameSettings: currentRoomData.gameSettings,
        currentWordObject: state.getCurrentWordObject(),
        guessedLetters: Array.from(state.getGuessedLetters()),
        remainingAttemptsPerPlayer: state.getRemainingAttemptsPerPlayer(),
        playersInGameOrder: playersForGame,
        startingPlayerId: state.getCurrentPlayerId(),
        clueUsed: state.getClueUsedThisGame()
        // maxAttempts: state.MAX_ATTEMPTS // This was in your original code, but not in the provided fix, added back.
    };
    
    broadcastToRoom({ type: MSG_TYPE.GAME_STARTED, initialGameState });
    
    if(window.pizarraUiUpdateCallbacks?.startGameOnNetwork) {
        window.pizarraUiUpdateCallbacks.startGameOnNetwork(initialGameState);
    }
    
    pizarraNetHandlers.broadcastState(connections);
}


export function sendGuessToHost(letter) {
    const currentRoomData = state.getNetworkRoomData();
    if (state.getPvpRemoteActive() && !currentRoomData.isRoomLeader && state.getGameActive()) {
        sendDataToLeader({ 
            type: MSG_TYPE.LETTER_GUESS, 
            letter: letter, 
            playerId: currentRoomData.myPlayerIdInRoom 
        });
    }
}

export function sendClueRequestToHost() {
    const currentRoomData = state.getNetworkRoomData();
    if (state.getPvpRemoteActive() && !currentRoomData.isRoomLeader && state.getGameActive()) {
        sendDataToLeader({ 
            type: MSG_TYPE.CLUE_REQUEST, 
            playerId: currentRoomData.myPlayerIdInRoom 
        });
    }
}

export function closeAllConnectionsAndSession() {
    const currentRoomData = state.getRawNetworkRoomData(); 
    if (currentRoomData.isRoomLeader) {
        if (connections.size > 0) { 
            broadcastToRoom({type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, reason: 'host_closed_room'});
        }
        connections.forEach(connEntry => connEntry.connObject?.close());
        connections.clear();
    } else if (leaderConnection) {
        leaderConnection.close();
        leaderConnection = null;
    }
    if (window.peerJsMultiplayer) window.peerJsMultiplayer.close(); 
    state.setMyPeerId(null); 
}

if (typeof window !== 'undefined' && !window.peerJsMultiplayer) {
    console.error("pizarraPeerConnection.js: peerjs-multiplayer.js wrapper not found on window object! Load it first.");
}