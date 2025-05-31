// pizarraPeerConnection.js
// Adapted from Cajitas' peerConnection.js for Palabras game

import * as state from './pizarraState.js'; // Palabras state
import * as ui from './pizarraUi.js'; // Palabras UI
import * as logic from './gameLogic.js'; // Palabras game logic
import * as matchmaking from './pizarraMatchmaking.js'; // Palabras matchmaking
import * as netHandlers from './pizarraNetHandlers.js'; // FIX: Add missing import

const PIZARRA_BASE_URL = "https://palabras.martinez.fyi"; // Palabras specific
const PIZARRA_PEER_ID_PREFIX = state.PIZARRA_PEER_ID_PREFIX; // From Palabras state

let connections = new Map(); // For host: peerId -> { connObject, playerGameId, status, player (full player object) }
let leaderConnection = null; // For client: PeerJS DataConnection object to the host

// Message Types for Palabras
export const MSG_TYPE = {
    REQUEST_JOIN_ROOM: 'req_join_pizarra',
    JOIN_ACCEPTED: 'join_accept_pizarra',
    JOIN_REJECTED: 'join_reject_pizarra',
    PLAYER_JOINED: 'player_joined_pizarra',
    PLAYER_LEFT: 'player_left_pizarra',
    ROOM_STATE_UPDATE: 'room_state_pizarra', // For general lobby updates
    PLAYER_READY_CHANGED: 'ready_change_pizarra',
    GAME_STARTED: 'game_started_pizarra',     // Sent by host with initial game state
    LETTER_GUESS: 'letter_guess_pizarra',     // Client sends guess to host
    GUESS_RESULT: 'guess_result_pizarra',     // Host broadcasts result of a guess
    CLUE_REQUEST: 'req_clue_pizarra',         // Client requests a clue
    CLUE_PROVIDED: 'clue_provided_pizarra',   // Host broadcasts the clue
    GAME_OVER_ANNOUNCEMENT: 'game_over_pizarra',// Host announces game end
    FULL_GAME_STATE: 'full_game_state_pizarra', // For resync or late join during game
    ERROR_MESSAGE: 'error_message_pizarra',   // For sending error messages
    STATE_SYNC: 'state_sync', // FIX: Add STATE_SYNC message type
};


// Forward declarations of handlers to be used in peerJsCallbacks
function onDataReceived(data, fromPeerId) {
    console.log(`[PizarraPeerConn RX] From ${fromPeerId}: Type: ${data.type}`, data);
    if (state.getNetworkRoomData().isRoomLeader) {
        handleLeaderDataReception(data, fromPeerId);
    } else {
        handleClientDataReception(data, fromPeerId);
    }
}

function onConnectionClose(peerId) {
    console.log(`[PizarraPeerConn Event] Connection with ${peerId} closed.`);
    const currentNetworkData = state.getNetworkRoomData();
    if (currentNetworkData.isRoomLeader) {
        const connEntry = connections.get(peerId);
        if (connEntry) {
            connections.delete(peerId);
            const leavingPlayer = currentNetworkData.players.find(p => p.peerId === peerId);
            if (leavingPlayer) {
                const leavingPlayerName = leavingPlayer.name;
                state.removePlayerFromNetworkRoom(peerId);
                broadcastToRoom({ type: MSG_TYPE.PLAYER_LEFT, playerId: leavingPlayer.id, peerId: peerId, playerName: leavingPlayerName });
                reassignPlayerIdsAndBroadcastUpdate(); 
                ui.updateLobbyUI();
                
                // FIX: Add null check for matchmaking function
                if (matchmaking && matchmaking.updateHostedRoomStatus) {
                    matchmaking.updateHostedRoomStatus(state.getNetworkRoomData().roomId, state.getNetworkRoomData().gameSettings, state.getNetworkRoomData().maxPlayers, state.getNetworkRoomData().players.length);
                }

                if (state.getNetworkRoomData().roomState === 'playing' && state.getNetworkRoomData().players.length < state.MIN_PLAYERS_NETWORK) {
                    if(window.pizarraUiUpdateCallbacks?.showModal) window.pizarraUiUpdateCallbacks.showModal(`Jugador ${leavingPlayerName} se desconectó. No hay suficientes jugadores.`);
                    state.setGameActive(false);
                    state.setNetworkRoomData({ roomState: 'game_over' }); 
                    const finalWord = state.getCurrentWordObject()?.word || "N/A";
                    broadcastToRoom({ type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, reason: 'disconnect_insufficient_players', finalWord: finalWord });
                }
            }
        }
    } else { 
        if (peerId === currentNetworkData.leaderPeerId) {
            console.error("[PizarraPeerConn] Client: Connection to leader lost!");
            const setupState = state.getRawNetworkRoomData();
            if (setupState._setupErrorCallback) {
                setupState._setupErrorCallback(new Error("Conexión con el líder perdida."));
            } else if (window.pizarraUiUpdateCallbacks?.showNetworkError) {
                window.pizarraUiUpdateCallbacks.showNetworkError("Se perdió la conexión con el líder de la sala.", true);
            }
            state.resetFullLocalStateForNewUIScreen();
            if (window.pizarraUiUpdateCallbacks?.handleCriticalDisconnect) {
                window.pizarraUiUpdateCallbacks.handleCriticalDisconnect();
            }
        }
    }
}

async function onError(err, peerIdContext = null) {
    console.error(`[PizarraPeerConn Error] (Context: ${peerIdContext || 'general'}): Type: ${err.type}, Msg: ${err.message || err}`, err);
    let displayMessage = err.message || (typeof err === 'string' ? err : 'Error desconocido.');
    const targetPeerForMsg = peerIdContext || state.getNetworkRoomData().leaderPeerId || (err.peer ? err.peer : null) || (err.message?.match(/peer\s(.+)/)?.[1]);

    if (err.type) {
        if (err.type === 'peer-unavailable' || err.type === 'unavailable-id') {
            displayMessage = `No se pudo conectar a: ${targetPeerForMsg ? PIZARRA_PEER_ID_PREFIX + targetPeerForMsg : 'remoto'}.`;
            if (!state.getNetworkRoomData().isRoomLeader && targetPeerForMsg &&
                (state.getNetworkRoomData().roomState === 'connecting_to_lobby' || state.getNetworkRoomData().roomState === 'awaiting_join_approval') &&
                targetPeerForMsg === state.getNetworkRoomData().leaderPeerId) {
                console.warn(`[PizarraPeerConn onError] Peer ${targetPeerForMsg} is unavailable. This might be a dead room. Attempting cleanup.`);
                
                // FIX: Add null check for matchmaking function
                if (matchmaking && matchmaking.removeDeadRoomByPeerId) {
                    await matchmaking.removeDeadRoomByPeerId(targetPeerForMsg);
                }
                displayMessage += " La sala podría haber sido cerrada. Intentá buscar de nuevo.";
            }
        } else if (err.type === 'network') { displayMessage = "Error de red. Verificá tu conexión."; }
        else if (err.type === 'webrtc') { displayMessage = "Error de WebRTC (firewall/red)."; }
        else if (err.type === 'disconnected' || err.type === 'socket-closed') { displayMessage = "Desconectado del servidor PeerJS."; }
        else if (err.type === 'server-error') { displayMessage = `Error del servidor PeerJS: ${err.message || err.type}`; }
        else if (err.type === 'socket-error' && err.message === 'Trying to send command before socket is open.') { displayMessage = "Error de conexión inicial. Reintentando..."; }
        else if (err.type === 'connection-error') { displayMessage = `Error de conexión con ${targetPeerForMsg ? PIZARRA_PEER_ID_PREFIX + targetPeerForMsg : 'par'}.`;}
        else { displayMessage = `${err.type}: ${displayMessage}`; }
    }

    const rawState = state.getRawNetworkRoomData();
    if (rawState._peerInitReject) {
        rawState._peerInitReject(err);
        state.setNetworkRoomData({ _peerInitResolve: null, _peerInitReject: null });
    }
    if (rawState._setupErrorCallback) {
        const errorForCallback = new Error(displayMessage);
        errorForCallback.type = err.type; errorForCallback.originalError = err;
        rawState._setupErrorCallback(errorForCallback);
        state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
    }

    if (!rawState._peerInitReject && !rawState._setupErrorCallback && window.pizarraUiUpdateCallbacks?.showNetworkError) {
         window.pizarraUiUpdateCallbacks.showNetworkError(displayMessage, err.type === 'peer-unavailable' || err.type === 'server-error' || err.type === 'disconnected' || err.type === 'socket-closed');
    }
}


const peerJsCallbacks = {
    onPeerOpen: (id) => {
        console.log(`[PizarraPeerConn] PeerJS opened with ID: ${id}.`);
        const oldPeerId = state.getMyPeerId();
        state.setMyPeerId(id);
        const rawState = state.getRawNetworkRoomData();

        if (rawState._peerInitResolve) {
            rawState._peerInitResolve(id);
            state.setNetworkRoomData({_peerInitResolve: null, _peerInitReject: null});
        }

        if (rawState._setupCompleteCallback) {
            if (rawState.isRoomLeader && (rawState.roomState === 'creating_room' || rawState.roomState === 'seeking_match')) { // Updated roomStates
                _finalizeHostSetup(id);
            } else if (!rawState.isRoomLeader && rawState.leaderPeerId && state.getPvpRemoteActive()) {
                 _finalizeClientJoinAttempt(id, rawState.leaderPeerId);
            }
        } else if (!state.getPvpRemoteActive() && oldPeerId !== id) {
            console.log('[PizarraPeerConn] PeerJS initialized/reconnected outside of active PvP mode. ID:', id);
        }
    },
    onNewConnection: (conn) => {
        const currentNetworkData = state.getNetworkRoomData();
        if (!currentNetworkData.isRoomLeader) {
            console.warn(`[PizarraPeerConn] Non-leader received connection from ${conn.peer}. Rejecting.`);
            conn.on('open', () => conn.close()); return;
        }
        // Check if room is full, but allow re-connections from players already in the list
        const isExistingPlayerReconnecting = currentNetworkData.players.some(p => p.peerId === conn.peer);
        if (currentNetworkData.players.length >= currentNetworkData.maxPlayers && !isExistingPlayerReconnecting) {
            console.warn(`[PizarraPeerConn] Room full (${currentNetworkData.players.length}/${currentNetworkData.maxPlayers}). Rejecting new connection from ${conn.peer}.`);
            conn.on('open', () => {
                conn.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }
        console.log(`[PizarraPeerConn] Leader received incoming connection from ${conn.peer}.`);
        connections.set(conn.peer, { connObject: conn, status: 'pending_join_request', player: null, playerGameId: -1 });
        setupConnectionEventHandlers(conn);
        
        // FIX: Add netHandlers attachment for state sync
        if (netHandlers && netHandlers.attach) {
            netHandlers.attach(conn);
        }
    },
    onConnectionOpen: (peerId) => {
        console.log(`[PizarraPeerConn] Data connection open with: ${peerId}.`);
        const currentNetworkData = state.getNetworkRoomData();
        if (currentNetworkData.isRoomLeader) {
            const connEntry = connections.get(peerId);
            if (connEntry && connEntry.status === 'pending_join_request') { 
                 connections.set(peerId, { ...connEntry, status: 'awaiting_join_request' });
                 console.log(`[PizarraPeerConn] Host: Connection with ${peerId} ready for JOIN_REQUEST.`);
            } else if (!connEntry) { 
                const existingPlayer = currentNetworkData.players.find(p => p.peerId === peerId);
                connections.set(peerId, {
                    connObject: window.peerJsMultiplayer.getConnection(peerId),
                    status: existingPlayer ? 'active' : 'awaiting_join_request', 
                    player: existingPlayer || null,
                    playerGameId: existingPlayer ? existingPlayer.id : -1
                });
                 console.log(`[PizarraPeerConn] Host: Re-established/newly-opened connection with ${peerId}. Player known: ${!!existingPlayer}`);
                 if (existingPlayer) { // If it's a known player rejoining, send them the current state
                    sendFullGameStateToClient(peerId);
                 }
            }
        } else { 
            if (peerId === currentNetworkData.leaderPeerId && leaderConnection && leaderConnection.open) {
                 if (currentNetworkData.roomState === 'connecting_to_lobby' ||
                    (currentNetworkData.roomState === 'awaiting_join_approval' && currentNetworkData.myPlayerIdInRoom === null)) {
                    console.log("[PizarraPeerConn] Client: Connection to leader open. Sending JOIN_REQUEST.");
                    const myPlayerData = state.getLocalPlayerCustomizationForNetwork();
                    sendDataToLeader({
                        type: MSG_TYPE.REQUEST_JOIN_ROOM,
                        playerData: { name: myPlayerData.name, icon: myPlayerData.icon, color: myPlayerData.color }
                    });
                    state.setNetworkRoomData({ roomState: 'awaiting_join_approval' });
                 }
            }
        }
    },
    onDataReceived,
    onConnectionClose,
    onError
};

function _finalizeHostSetup(hostPeerId) {
    const rawState = state.getRawNetworkRoomData();
    if (!rawState._setupCompleteCallback && !rawState._setupErrorCallback) return;
    if (!rawState.isRoomLeader || !(rawState.roomState === 'creating_room' || rawState.roomState === 'seeking_match')) {
        if (rawState._setupErrorCallback) rawState._setupErrorCallback(new Error("Host setup conditions not met."));
        state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        return;
    }
    if (!rawState.players || !rawState.players[0]) {
        if (rawState._setupErrorCallback) rawState._setupErrorCallback(new Error("Host player data missing."));
        state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        return;
    }

    rawState.players[0].peerId = hostPeerId; // Assign host's peerId to their player entry
    state.setNetworkRoomData({
        roomId: hostPeerId, leaderPeerId: hostPeerId,
        players: [...rawState.players],
        roomState: 'lobby' 
    });

    if (window.pizarraUiUpdateCallbacks?.showLobby) window.pizarraUiUpdateCallbacks.showLobby(true);
    // matchmaking.updateHostedRoomStatus is called from main.js after hostNewRoom resolves

    if (rawState._setupCompleteCallback) rawState._setupCompleteCallback(hostPeerId);
    state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
}

function _finalizeClientJoinAttempt(myPeerId, leaderPeerIdToJoin) {
    const rawState = state.getRawNetworkRoomData();
    if (!rawState._setupCompleteCallback && !rawState._setupErrorCallback) return;
    if (rawState.isRoomLeader || !leaderPeerIdToJoin || !state.getPvpRemoteActive()) {
        if (rawState._setupErrorCallback) rawState._setupErrorCallback(new Error("Client join conditions not met."));
        state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        return;
    }
    if (rawState.players && rawState.players[0]) rawState.players[0].peerId = myPeerId;
    else { 
        const customData = state.getLocalPlayerCustomizationForNetwork();
        state.setNetworkRoomData({ players: [{ ...customData, peerId: myPeerId, id: null, isReady: false, isConnected: false }]});
    }

    if (window.peerJsMultiplayer?.connect) {
        if (leaderConnection && leaderConnection.open && leaderConnection.peer === leaderPeerIdToJoin) {
             console.log("[PizarraPeerConn] _finalizeClientJoinAttempt: Already connected to leader.");
             if (rawState._setupCompleteCallback) {
                rawState._setupCompleteCallback(myPeerId);
                state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
             }
            return;
        }
        const connToLeader = window.peerJsMultiplayer.connect(leaderPeerIdToJoin);
        if (connToLeader) {
            leaderConnection = connToLeader;
            
            // FIX: Add netHandlers attachment for state sync on client side too
            if (netHandlers && netHandlers.attach) {
                netHandlers.attach(connToLeader);
            }
            // Event handlers including onConnectionOpen (which sends JOIN_REQUEST) are set by peerjs-multiplayer
        } else {
            peerJsCallbacks.onError({ type: 'connect_failed', message: `peer.connect() returned null for ${leaderPeerIdToJoin}.` }, leaderPeerIdToJoin);
        }
    } else {
        peerJsCallbacks.onError({ type: 'internal_error', message: 'PeerJS connect fn not available.' });
    }
}

// Initialize PeerJS connection without specific server options
// to use the public PeerJS server via peerjs-multiplayer.js defaults
function initPeerObject(peerIdToUse = null) {
    return new Promise((resolve, reject) => {
        // FIX: Add check for peerJsMultiplayer availability
        if (!window.peerJsMultiplayer?.init) {
            const err = new Error('PeerJS wrapper (peerJsMultiplayer) not found on window object.');
            reject(err);
            return;
        }
        
        state.setNetworkRoomData({ _peerInitResolve: resolve, _peerInitReject: reject });
        console.log(`[PizarraPeerConn] initPeerObject: Calling peerJsMultiplayer.init. Preferred ID: ${peerIdToUse}. Relying on peerjs-multiplayer for server defaults.`);
        // Pass empty object as server options part if no peerIdToUse,
        // so peerjs-multiplayer uses its internal defaults (public PeerServer).
        window.peerJsMultiplayer.init(peerIdToUse || {}, peerJsCallbacks);
    });
}


export async function ensurePeerInitialized() {
    const existingPeer = window.peerJsMultiplayer?.getPeer();
    let currentPeerId = window.peerJsMultiplayer?.getLocalId();

    if (existingPeer && !existingPeer.destroyed && currentPeerId) {
        if (state.getMyPeerId() !== currentPeerId) state.setMyPeerId(currentPeerId);
        const rawState = state.getRawNetworkRoomData();
        if (rawState._setupCompleteCallback) { 
            if (rawState.isRoomLeader) _finalizeHostSetup(currentPeerId);
            else if (rawState.leaderPeerId) _finalizeClientJoinAttempt(currentPeerId, rawState.leaderPeerId);
        }
        return currentPeerId;
    }
    const rawState = state.getRawNetworkRoomData();
    if (rawState._peerInitPromise) return rawState._peerInitPromise; 

    const initPromise = initPeerObject(); 
    state.setNetworkRoomData({ _peerInitPromise: initPromise });

    try {
        const newPeerId = await initPromise;
        if (state.getRawNetworkRoomData()._peerInitPromise === initPromise) state.setNetworkRoomData({ _peerInitPromise: null });
        return newPeerId;
    } catch (err) {
        if (state.getRawNetworkRoomData()._peerInitPromise === initPromise) state.setNetworkRoomData({ _peerInitPromise: null });
        throw err;
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
        if(window.pizarraUiUpdateCallbacks?.showModal) window.pizarraUiUpdateCallbacks.showModal("Creando tu sala de Palabras...");
        try {
            await ensurePeerInitialized(); 
        } catch (err) {
             const currentErrorCallback = state.getRawNetworkRoomData()._setupErrorCallback;
             if (currentErrorCallback === reject) { /* Error already handled by onError chain */ }
             else if(reject) reject(err); // Fallback if not handled
             state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null }); // Ensure cleanup
        }
    });
}

export function joinRoomById(leaderRawPeerId, joinerPlayerData) {
    state.resetFullLocalStateForNewUIScreen();
    state.setPvpRemoteActive(true);

    return new Promise(async (resolve, reject) => {
        state.setNetworkRoomData({
            isRoomLeader: false, roomId: leaderRawPeerId, leaderPeerId: leaderRawPeerId,
            players: [{ name: joinerPlayerData.name, icon: joinerPlayerData.icon, color: joinerPlayerData.color, peerId: null, id:null, isReady: false, isConnected: false }], 
            roomState: 'connecting_to_lobby',
            _setupCompleteCallback: resolve, _setupErrorCallback: reject
        });
        if(window.pizarraUiUpdateCallbacks?.showModal) window.pizarraUiUpdateCallbacks.showModal(`Conectando a sala ${PIZARRA_PEER_ID_PREFIX}${leaderRawPeerId}...`);
        try {
            await ensurePeerInitialized(); 
        } catch (err) {
            const currentErrorCallback = state.getRawNetworkRoomData()._setupErrorCallback;
            if (currentErrorCallback === reject) { /* Error already handled */ }
            else if(reject) reject(err);
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        }
    });
}


function handleLeaderDataReception(data, fromPeerId) {
    const connEntry = connections.get(fromPeerId);
    if (!connEntry && data.type !== MSG_TYPE.REQUEST_JOIN_ROOM) {
        console.warn(`[PizarraPeerConn L] Data from ${fromPeerId} (Type: ${data.type}) but no connection entry. Ignored.`); return;
    }
    const playerGameId = connEntry?.playerGameId; // Game ID of the sender
    // Player must be fully joined (have a game ID) for most actions
    if (data.type !== MSG_TYPE.REQUEST_JOIN_ROOM && (playerGameId === undefined || playerGameId === -1)) {
        console.warn(`[PizarraPeerConn L] Msg type ${data.type} from ${fromPeerId}, but player not fully joined (ID: ${playerGameId}). Ignored.`); return;
    }

    switch (data.type) {
        case MSG_TYPE.REQUEST_JOIN_ROOM:
            const clientConnObjForJoin = connEntry?.connObject || window.peerJsMultiplayer.getConnection(fromPeerId);
            if (!clientConnObjForJoin) { console.warn(`[PizarraPeerConn L] REQUEST_JOIN_ROOM from ${fromPeerId} but no actual conn obj.`); return; }

            const currentHostState = state.getRawNetworkRoomData(); // Host's current room state
            const existingPlayer = currentHostState.players.find(p => p.peerId === fromPeerId);

            if (existingPlayer && existingPlayer.id !== null && existingPlayer.id !== -1) { 
                if (!existingPlayer.isConnected) state.updatePlayerInNetworkRoom(fromPeerId, { isConnected: true });
                sendDataToClient(fromPeerId, { type: MSG_TYPE.JOIN_ACCEPTED, yourPlayerIdInRoom: existingPlayer.id, roomData: state.getSanitizedNetworkRoomDataForClient() });
                sendFullGameStateToClient(fromPeerId); 
                return;
            }
            if (currentHostState.players.filter(p => p.isConnected).length >= currentHostState.maxPlayers) { // Check active players
                sendDataToClient(fromPeerId, { type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
                clientConnObjForJoin.close(); return;
            }

            let newPlayerAssignedId = 0;
            const existingGameIds = new Set(currentHostState.players.map(p => p.id).filter(id => id !== null && id !==-1));
            while(existingGameIds.has(newPlayerAssignedId)) { newPlayerAssignedId++; }

            const newPlayer = {
                id: newPlayerAssignedId, peerId: fromPeerId, ...data.playerData, // name, icon, color from client
                isReady: false, isConnected: true, score: 0
            };
            state.addPlayerToNetworkRoom(newPlayer); // Add to host's state
            // Update connection map with full player object and game ID
            connections.set(fromPeerId, { connObject: clientConnObjForJoin, playerGameId: newPlayer.id, player: newPlayer, status: 'active' });

            sendDataToClient(fromPeerId, { type: MSG_TYPE.JOIN_ACCEPTED, yourPlayerIdInRoom: newPlayer.id, roomData: state.getSanitizedNetworkRoomDataForClient()});
            broadcastFullGameStateToAll(); // Send full state to everyone, including new player
            if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            
            // FIX: Add null check for matchmaking function
            if (matchmaking && matchmaking.updateHostedRoomStatus) {
                matchmaking.updateHostedRoomStatus(state.getNetworkRoomData().roomId, currentHostState.gameSettings, currentHostState.maxPlayers, state.getNetworkRoomData().players.filter(p=>p.isConnected).length);
            }
            break;

        case MSG_TYPE.PLAYER_READY_CHANGED:
            // data.playerId is not sent by client, data.isReady is. Player identified by fromPeerId
            const playerChangingReady = state.getNetworkRoomData().players.find(p => p.peerId === fromPeerId);
            if (playerChangingReady) {
                state.updatePlayerInNetworkRoom(fromPeerId, { isReady: data.isReady });
                broadcastFullGameStateToAll(); 
                if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            }
            break;

        case MSG_TYPE.LETTER_GUESS:
            if (playerGameId === state.getCurrentPlayerId() && state.getGameActive()) {
                const result = logic.processGuess(data.letter); 
                const guessResultPayload = { type: MSG_TYPE.GUESS_RESULT, ...result, letter: data.letter.toUpperCase() };
                broadcastToRoom(guessResultPayload); // Immediate feedback
                broadcastFullGameStateToAll(); // Authoritative state update

                if (result.gameOver) { 
                    state.setNetworkRoomData({ roomState: 'game_over' }); 
                    const winnerData = logic.getWinnerData(state);
                    const finalWord = state.getCurrentWordObject()?.word;
                    broadcastToRoom({
                        type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT,
                        winnerData: winnerData,
                        finalScores: state.getPlayersData().map(p=>({id:p.id, name: p.name, icon: p.icon, score:p.score})),
                        finalWord: finalWord
                    });
                }
            }
            break;

        case MSG_TYPE.CLUE_REQUEST:
            if (playerGameId === state.getCurrentPlayerId() && state.getGameActive() && !state.getClueUsedThisGame()) {
                const clueResult = logic.requestClue(); 
                if (clueResult.success) {
                    broadcastToRoom({ type: MSG_TYPE.CLUE_PROVIDED, clue: clueResult.clue, clueUsed: state.getClueUsedThisGame() }); // Include clueUsed
                    broadcastFullGameStateToAll();
                } else {
                    sendDataToClient(fromPeerId, {type: MSG_TYPE.ERROR_MESSAGE, message: clueResult.message || "No se pudo obtener la pista." });
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
        console.warn(`[PizarraPeerConn C] Data from non-leader ${fromLeaderPeerId}. Ignored.`); return;
    }

    switch (data.type) {
        case MSG_TYPE.JOIN_ACCEPTED:
            state.setNetworkRoomData({ // Client updates its state based on host's authoritative version
                ...data.roomData, 
                myPlayerIdInRoom: data.yourPlayerIdInRoom,
                isRoomLeader: false, 
                myPeerId: state.getMyPeerId(),                       
                leaderPeerId: currentClientState.leaderPeerId, 
                roomId: currentClientState.roomId, 
                roomState: data.roomData.roomState || 'lobby' 
            });
            
            const myDataInRoom = state.getNetworkRoomData().players.find(p => p.id === data.yourPlayerIdInRoom);
            if (myDataInRoom && data.roomData.players.find(p=>p.id === data.yourPlayerIdInRoom)?.color && myDataInRoom.color !== data.roomData.players.find(p=>p.id === data.yourPlayerIdInRoom).color ) {
                // This logic for color assignment from Cajitas might not be needed if Palabras doesn't assign color like that
            }
            if(window.pizarraUiUpdateCallbacks?.hideModal) window.pizarraUiUpdateCallbacks.hideModal();
            if(window.pizarraUiUpdateCallbacks?.showLobby) window.pizarraUiUpdateCallbacks.showLobby(false); 

            const rawState = state.getRawNetworkRoomData(); // For _setupCompleteCallback
            if (rawState._setupCompleteCallback) {
                rawState._setupCompleteCallback(state.getMyPeerId());
                state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
            }
            break;

        case MSG_TYPE.JOIN_REJECTED:
             const rawStateReject = state.getRawNetworkRoomData();
            if (rawStateReject._setupErrorCallback) {
                rawStateReject._setupErrorCallback(new Error(data.reason || 'Join rejected'));
            } else if(window.pizarraUiUpdateCallbacks?.showNetworkError) {
                 window.pizarraUiUpdateCallbacks.showNetworkError(`Unión Rechazada: ${data.reason || 'Desconocido'}`, true);
            }
            state.resetFullLocalStateForNewUIScreen(); 
            break;
        
        case MSG_TYPE.PLAYER_LEFT: // A player (not self) left
            if (data.peerId !== state.getMyPeerId()) {
                const leftPlayerName = data.playerName || `Jugador ${data.playerId}`;
                if(window.pizarraUiUpdateCallbacks?.showLobbyMessage) window.pizarraUiUpdateCallbacks.showLobbyMessage(`${leftPlayerName} ha salido.`);
                // Full state update will refresh player list
            }
            // Client will receive a FULL_GAME_STATE or ROOM_STATE_UPDATE to refresh its player list
            break;
        
        case MSG_TYPE.ROOM_STATE_UPDATE: // General lobby state update
             state.setNetworkRoomData({
                ...data.roomData, // Base new state from host
                isRoomLeader: false, // Ensure these are not overwritten for client
                myPeerId: state.getMyPeerId(),                         
                myPlayerIdInRoom: data.roomData.players.find(p=>p.peerId === state.getMyPeerId())?.id ?? currentClientState.myPlayerIdInRoom, // Update my game ID
                leaderPeerId: currentClientState.leaderPeerId,
                roomId: currentClientState.roomId
             });
             if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;

        case MSG_TYPE.GAME_STARTED:
            state.setPlayersData(data.initialGameState.playersInGameOrder); // gameLogic uses playersData
            state.setCurrentWordObject(data.initialGameState.currentWordObject);
            state.setGuessedLetters(new Set(data.initialGameState.guessedLetters || []));
            state.setRemainingAttemptsPerPlayer(data.initialGameState.remainingAttemptsPerPlayer || []);
            state.setCurrentPlayerId(data.initialGameState.startingPlayerId);
            state.setClueUsedThisGame(data.initialGameState.clueUsedThisGame || false);
            state.setCurrentDifficulty(data.initialGameState.gameSettings.difficulty); 
            state.setGameActive(true);
            state.setNetworkRoomData({ 
                gameSettings: data.initialGameState.gameSettings,
                players: data.initialGameState.playersInGameOrder.map(p => ({...p, isConnected: true, isReady:true })), 
                roomState: 'playing',
                // Sync other game state parts to networkRoomData if they are primary source for clients
                currentWordObject: data.initialGameState.currentWordObject,
                guessedLetters: Array.from(data.initialGameState.guessedLetters || []),
                remainingAttemptsPerPlayer: data.initialGameState.remainingAttemptsPerPlayer || [],
                currentPlayerId: data.initialGameState.startingPlayerId,
                clueUsedThisGame: data.initialGameState.clueUsedThisGame || false,
                gameActive: true,
            });
            if(window.pizarraUiUpdateCallbacks?.startGameOnNetwork) window.pizarraUiUpdateCallbacks.startGameOnNetwork(data.initialGameState);
            break;

        case MSG_TYPE.GUESS_RESULT: // Immediate feedback, authoritative state via FULL_GAME_STATE
            // Apply only essential visual feedback, rely on FULL_GAME_STATE for data integrity
            if(window.pizarraUiUpdateCallbacks?.updateGameFromNetwork) window.pizarraUiUpdateCallbacks.updateGameFromNetwork(data); 
            break;

        case MSG_TYPE.CLUE_PROVIDED:
            // state.setClueUsedThisGame(data.clueUsed); // Rely on FULL_GAME_STATE
            if(window.pizarraUiUpdateCallbacks?.displayClueFromNetwork) window.pizarraUiUpdateCallbacks.displayClueFromNetwork(data);
            break;

        case MSG_TYPE.FULL_GAME_STATE: // Authoritative full state sync
            console.log("[PizarraPeerConn C] Received FULL_GAME_STATE:", data.gameState);
            state.setPlayersData(data.gameState.players); 
            state.setCurrentWordObject(data.gameState.currentWordObject);
            state.setGuessedLetters(new Set(data.gameState.guessedLetters || []));
            state.setRemainingAttemptsPerPlayer(data.gameState.remainingAttemptsPerPlayer || []);
            state.setCurrentPlayerId(data.gameState.currentPlayerId);
            state.setClueUsedThisGame(data.gameState.clueUsedThisGame || false);
            state.setGameActive(data.gameState.gameActive);
            state.setNetworkRoomData({ // Deep merge into networkRoomData
                ...state.getNetworkRoomData(), // Keep myPeerId, leaderPeerId, roomId, callbacks etc.
                ...data.gameState, // Overwrite with everything from host's game state
                isRoomLeader: false, // Ensure client knows it's not leader
                myPlayerIdInRoom: data.gameState.players.find(p=>p.peerId === state.getMyPeerId())?.id ?? state.getNetworkRoomData().myPlayerIdInRoom, // Update my game ID from synced players
                players: data.gameState.players.map(p => ({...p, isConnected: true, isReady:true })), // Make sure player structure is full
            });
            if (window.pizarraUiUpdateCallbacks?.syncUIFromNetworkState) window.pizarraUiUpdateCallbacks.syncUIFromNetworkState();
            break;

        case MSG_TYPE.GAME_OVER_ANNOUNCEMENT:
            state.setGameActive(false);
            state.setNetworkRoomData({ roomState: 'game_over' });
            if (data.finalWord && !logic.checkWinCondition()) { 
                state.setCurrentWordObject({word: data.finalWord, definition: "N/A", difficulty: state.getCurrentDifficulty()});
                const finalGuessed = new Set(); 
                for (const letter of data.finalWord) { finalGuessed.add(letter.toLowerCase()); }
                state.setGuessedLetters(finalGuessed);
            }
             // Update scores if provided
            if (data.finalScores) {
                const currentPlayers = state.getPlayersData();
                const networkPlayers = state.getRawNetworkRoomData().players;
                data.finalScores.forEach(ps => {
                    const pLocal = currentPlayers.find(p => p.id === ps.id); if (pLocal) pLocal.score = ps.score;
                    const pNet = networkPlayers.find(p => p.id === ps.id); if (pNet) pNet.score = ps.score;
                });
                state.setPlayersData([...currentPlayers]);
                state.setNetworkRoomData({players: [...networkPlayers]});
            }
            if(window.pizarraUiUpdateCallbacks?.showNetworkGameOver) window.pizarraUiUpdateCallbacks.showNetworkGameOver(data);
            break;

        case MSG_TYPE.ERROR_MESSAGE:
            if(window.pizarraUiUpdateCallbacks?.showNetworkError) window.pizarraUiUpdateCallbacks.showNetworkError(data.message, false);
            break;

        // FIX: Add missing STATE_SYNC case (handled by netHandlers but keeping for completeness)
        case MSG_TYPE.STATE_SYNC:
            // This is handled by pizarraNetHandlers.js attach() method
            // but we include it here to avoid "unhandled message" warnings
            break;

        default:
            console.warn(`[PizarraPeerConn C] Unhandled message type: ${data.type} from ${fromLeaderPeerId}`, data);
    }
    if (data.type === MSG_TYPE.JOIN_ACCEPTED || data.type === MSG_TYPE.JOIN_REJECTED) {
        state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
    }
}


function reassignPlayerIdsAndBroadcastUpdate() {
    if (!state.getNetworkRoomData().isRoomLeader) return;
    const currentPlayers = state.getNetworkRoomData().players;
    const connectedPeerIds = new Set(Array.from(connections.keys()).filter(peerId => connections.get(peerId)?.connObject?.open));
    connectedPeerIds.add(state.getMyPeerId());

    const activePlayers = currentPlayers.filter(p => p.isConnected && connectedPeerIds.has(p.peerId));

    activePlayers.sort((a, b) => {
        if (a.peerId === state.getMyPeerId()) return -1; if (b.peerId === state.getMyPeerId()) return 1;
        return (a.id === undefined || a.id === null ? Infinity : a.id) - (b.id === undefined || b.id === null ? Infinity : b.id);
    });

    let idsChanged = activePlayers.length !== currentPlayers.filter(p => p.isConnected).length; 

    activePlayers.forEach((player, index) => {
        if (player.id !== index) { idsChanged = true; player.id = index; }
        if (player.peerId === state.getMyPeerId()) state.setNetworkRoomData({ myPlayerIdInRoom: index });
    });

    state.setNetworkRoomData({ players: activePlayers });

    if (idsChanged) {
        console.log("[PizarraPeerConn L] Player IDs reassigned or player removed. Broadcasting new full state.");
        broadcastFullGameStateToAll(); 
        if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby(); 
    }
}

function sendFullGameStateToClient(clientPeerId) {
    if (!state.getNetworkRoomData().isRoomLeader) return;
    const gameStatePayload = {
        players: state.getPlayersData(), currentWordObject: state.getCurrentWordObject(),
        guessedLetters: Array.from(state.getGuessedLetters()),
        remainingAttemptsPerPlayer: state.getRemainingAttemptsPerPlayer(),
        currentPlayerId: state.getCurrentPlayerId(), clueUsedThisGame: state.getClueUsedThisGame(),
        gameActive: state.getGameActive(), gameSettings: state.getNetworkRoomData().gameSettings,
        roomState: state.getNetworkRoomData().roomState, maxPlayers: state.getNetworkRoomData().maxPlayers,
        roomId: state.getNetworkRoomData().roomId, leaderPeerId: state.getNetworkRoomData().leaderPeerId,
    };
    sendDataToClient(clientPeerId, { type: MSG_TYPE.FULL_GAME_STATE, gameState: gameStatePayload });
}

function broadcastFullGameStateToAll() {
    if (!state.getNetworkRoomData().isRoomLeader) return;
    const gameStatePayload = { // Construct this based on Palabras state structure
        players: state.getPlayersData(), // Game players (id, name, score, icon, color)
        currentWordObject: state.getCurrentWordObject(),
        guessedLetters: Array.from(state.getGuessedLetters()),
        remainingAttemptsPerPlayer: state.getRemainingAttemptsPerPlayer(),
        currentPlayerId: state.getCurrentPlayerId(),
        clueUsedThisGame: state.getClueUsedThisGame(),
        gameActive: state.getGameActive(),
        gameSettings: state.getNetworkRoomData().gameSettings,
        roomState: state.getNetworkRoomData().roomState,
        // Include network specific player list if different from game players for some reason
        // For Palabras, players in networkRoomData should mirror game players during active game.
        networkPlayers: state.getNetworkRoomData().players.map(p => ({...p})), // Send a copy
        maxPlayers: state.getNetworkRoomData().maxPlayers,
        roomId: state.getNetworkRoomData().roomId,
        leaderPeerId: state.getNetworkRoomData().leaderPeerId,
    };
    broadcastToRoom({ type: MSG_TYPE.FULL_GAME_STATE, gameState: gameStatePayload });
    
    // FIX: Also use netHandlers.broadcastState for better state synchronization
    if (netHandlers && netHandlers.broadcastState) {
        netHandlers.broadcastState(connections);
    }
    
    if (window.pizarraUiUpdateCallbacks?.syncUIFromNetworkState) {
         window.pizarraUiUpdateCallbacks.syncUIFromNetworkState(); // Sync leader's UI too
    }
}


export function leaveRoom() {
    console.log("[PizarraPeerConn] leaveRoom called.");
    if(window.pizarraUiUpdateCallbacks?.hideNetworkInfo) window.pizarraUiUpdateCallbacks.hideNetworkInfo();
    const currentRoomId = state.getNetworkRoomData().roomId;
    const isCurrentlyLeader = state.getNetworkRoomData().isRoomLeader;

    if (isCurrentlyLeader) {
        broadcastToRoom({ type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, reason: 'leader_left_room', finalWord: state.getCurrentWordObject()?.word });
        if (currentRoomId && state.getMyPeerId() === currentRoomId) { 
            // FIX: Add null check for matchmaking function
            if (matchmaking && matchmaking.leaveQueue) {
                matchmaking.leaveQueue(currentRoomId);
            }
        }
        setTimeout(() => { 
            connections.forEach((connEntry) => connEntry.connObject?.close());
            connections.clear();
        }, 300);
    } else if (leaderConnection) {
        leaderConnection.close();
    }
    leaderConnection = null;
}

function sendDataToLeader(data) {
    if (leaderConnection && leaderConnection.open) {
        try { leaderConnection.send(data); }
        catch (e) { peerJsCallbacks.onError({type: 'send_error', message: 'Failed to send data to leader.', originalError: e, peer: leaderConnection.peer}); }
    } else {
        peerJsCallbacks.onError({type: 'send_error_no_connection', message: 'No open connection to leader.'});
    }
}

function sendDataToClient(clientPeerId, data) {
    const connEntry = connections.get(clientPeerId);
    if (connEntry?.connObject?.open) {
        try { connEntry.connObject.send(data); }
        catch (e) { console.error(`[PizarraPeerConn L] Error sending to client ${clientPeerId}:`, e, data); }
    } else {
        console.warn(`[PizarraPeerConn L] No open conn to client ${clientPeerId}. Cannot send. Conn Entry:`, connEntry);
    }
}

function broadcastToRoom(data, excludePeerId = null) {
    if (!state.getNetworkRoomData().isRoomLeader) return;
    connections.forEach((connEntry, peerId) => {
        if (peerId !== excludePeerId && connEntry?.connObject?.open) {
            try { connEntry.connObject.send(data); }
            catch (e) { console.error(`[PizarraPeerConn L] Error broadcasting to ${peerId}:`, e, data); }
        }
    });
}

function broadcastRoomState() { // For lobby updates
    if (!state.getNetworkRoomData().isRoomLeader) return;
    // For lobby, a simpler ROOM_STATE_UPDATE is fine. FULL_GAME_STATE is for active game.
    broadcastToRoom({ type: MSG_TYPE.ROOM_STATE_UPDATE, roomData: state.getSanitizedNetworkRoomDataForClient() });
}


export function sendPlayerReadyState(isReady) {
    const currentNetworkData = state.getNetworkRoomData();
    if (currentNetworkData.isRoomLeader) {
        state.updatePlayerInNetworkRoom(state.getMyPeerId(), { isReady });
        broadcastFullGameStateToAll(); 
        if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
    } else {
        // Client sends ready state, their player ID is known by the host.
        sendDataToLeader({ type: MSG_TYPE.PLAYER_READY_CHANGED, playerId: currentNetworkData.myPlayerIdInRoom, isReady: isReady });
    }
}

export function leaderStartGameRequest() { 
    const currentRoomData = state.getRawNetworkRoomData(); 
    if (!currentRoomData.isRoomLeader || currentRoomData.roomState !== 'lobby') return;

    const allReady = currentRoomData.players.length >= state.MIN_PLAYERS_NETWORK &&
                     currentRoomData.players.every(p => p.isReady && p.isConnected !== false);
    if (!allReady) {
        if(window.pizarraUiUpdateCallbacks?.showNetworkError) window.pizarraUiUpdateCallbacks.showNetworkError("No todos los jugadores están listos o conectados.", false);
        return;
    }

    state.setNetworkRoomData({ roomState: 'playing' }); 
    state.setCurrentDifficulty(currentRoomData.gameSettings.difficulty);

    const gameInitResult = logic.initializeGame(state, currentRoomData.gameSettings.difficulty);

    if (!gameInitResult.success || !state.getCurrentWordObject()) {
        state.setNetworkRoomData({ roomState: 'lobby' }); 
        broadcastFullGameStateToAll(); 
        if(window.pizarraUiUpdateCallbacks?.showNetworkError) window.pizarraUiUpdateCallbacks.showNetworkError("Error del Host al iniciar: No se pudo seleccionar palabra.", false);
        return;
    }
    
    // logic.initializeGame should set state.playersData correctly for the game instance.
    // It should also set state.currentPlayerId.
    // We just need to ensure networkRoomData.players reflects scores being reset.
    const playersForGameInstance = state.getPlayersData(); // Players as set by initializeGame
    state.setNetworkRoomData({
        players: playersForGameInstance.map(p => ({...currentRoomData.players.find(np => np.id === p.id), score: 0})) // merge with network player data, ensure score 0
    });


    const initialGameState = {
        gameSettings: currentRoomData.gameSettings,
        currentWordObject: state.getCurrentWordObject(), 
        guessedLetters: Array.from(state.getGuessedLetters()),
        remainingAttemptsPerPlayer: state.getRemainingAttemptsPerPlayer(),
        playersInGameOrder: state.getPlayersData(), 
        startingPlayerId: state.getCurrentPlayerId(),
        clueUsedThisGame: state.getClueUsedThisGame(),
    };

    broadcastToRoom({ type: MSG_TYPE.GAME_STARTED, initialGameState });
    if(window.pizarraUiUpdateCallbacks?.startGameOnNetwork) window.pizarraUiUpdateCallbacks.startGameOnNetwork(initialGameState);

    if (currentRoomData.roomId) { 
        // FIX: Add null checks for matchmaking functions
        if (matchmaking && matchmaking.leaveQueue) {
            matchmaking.leaveQueue(currentRoomData.roomId);
        }
        if (matchmaking && matchmaking.updateHostedRoomStatus) {
            matchmaking.updateHostedRoomStatus(currentRoomData.roomId, currentRoomData.gameSettings, currentRoomData.maxPlayers, currentRoomData.players.length, 'in_game');
        }
    }
    broadcastFullGameStateToAll(); // Final sync after game start
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


function setupConnectionEventHandlers(conn) { // Removed isLeaderConn, not used in Cajitas version like that
    conn.on('open', () => peerJsCallbacks.onConnectionOpen(conn.peer));
    conn.on('data', (data) => peerJsCallbacks.onDataReceived(data, conn.peer));
    conn.on('close', () => peerJsCallbacks.onConnectionClose(conn.peer));
    conn.on('error', (err) => peerJsCallbacks.onError(err, conn.peer));
}

export function closePeerSession() { 
    console.log("[PizarraPeerConn] Closing peer session (destroying local peer object)...");
    
    // FIX: Add null check for peerJsMultiplayer
    if (window.peerJsMultiplayer?.close) {
        window.peerJsMultiplayer.close(); 
    } else {
        console.warn("[PizarraPeerConn] peerJsMultiplayer.close not available.");
    }
    leaderConnection = null;
    connections.clear();
    state.setMyPeerId(null); 
}

// FIX: Improve window beforeunload event handler
window.addEventListener('beforeunload', () => {
    if (state.getPvpRemoteActive()) {
        if (state.getNetworkRoomData().isRoomLeader && state.getNetworkRoomData().roomId) {
            // FIX: Add null check for matchmaking function
            if (matchmaking && matchmaking.leaveQueue) {
                matchmaking.leaveQueue(state.getNetworkRoomData().roomId); 
            }
        }
        closePeerSession(); 
    }
});

// FIX: Add better error checking for peerJsMultiplayer availability
if (typeof window !== 'undefined') {
    // Check periodically for peerJsMultiplayer availability instead of failing immediately
    let checkCount = 0;
    const maxChecks = 10;
    const checkInterval = setInterval(() => {
        if (window.peerJsMultiplayer) {
            clearInterval(checkInterval);
            console.log("[PizarraPeerConn] peerjs-multiplayer.js wrapper found and ready.");
        } else {
            checkCount++;
            if (checkCount >= maxChecks) {
                clearInterval(checkInterval);
                console.error("pizarraPeerConnection.js: peerjs-multiplayer.js wrapper not found on window object after multiple checks! Load it first.");
            }
        }
    }, 100);
}