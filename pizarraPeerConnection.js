// pizarraPeerConnection.js
// Fixed based on working Cajitas implementation

import * as state from './pizarraState.js';
import * as ui from './pizarraUi.js';
import * as logic from './gameLogic.js';
import * as matchmaking from './pizarraMatchmaking.js';

const PIZARRA_BASE_URL = "https://palabras.martinez.fyi";
const PIZARRA_PEER_ID_PREFIX = state.PIZARRA_PEER_ID_PREFIX;

let connections = new Map();
let leaderConnection = null;

const MSG_TYPE = {
    REQUEST_JOIN_ROOM: 'req_join_pizarra',
    JOIN_ACCEPTED: 'join_accept_pizarra',
    JOIN_REJECTED: 'join_reject_pizarra',
    PLAYER_JOINED: 'player_joined_pizarra', // Note: This type seems unused in current broadcast logic
    PLAYER_LEFT: 'player_left_pizarra',
    ROOM_STATE_UPDATE: 'room_state_pizarra', // Note: This type seems unused, FULL_GAME_STATE is preferred
    PLAYER_READY_CHANGED: 'ready_change_pizarra',
    GAME_STARTED: 'game_started_pizarra',
    LETTER_GUESS: 'letter_guess_pizarra',
    GUESS_RESULT: 'guess_result_pizarra',
    CLUE_REQUEST: 'req_clue_pizarra',
    CLUE_PROVIDED: 'clue_provided_pizarra',
    GAME_OVER_ANNOUNCEMENT: 'game_over_pizarra',
    FULL_GAME_STATE: 'full_game_state_pizarra',
    ERROR_MESSAGE: 'error_message_pizarra',
};

// Forward declarations of handlers
function onDataReceived(data, fromPeerId) {
    console.log(`[PeerConn RX] From ${fromPeerId}: Type: ${data?.type}, Payload:`, data);
    if (!data || !data.type) {
        console.warn(`[PeerConn RX] Received data with no type from ${fromPeerId}:`, data);
        return;
    }

    if (state.getNetworkRoomData().isRoomLeader) {
        // console.log(`[PeerConn RX] Handling as LEADER.`);
        handleLeaderDataReception(data, fromPeerId);
    } else {
        // console.log(`[PeerConn RX] Handling as CLIENT.`);
        handleClientDataReception(data, fromPeerId);
    }
}

function onConnectionClose(peerId) {
    console.log(`[PeerConn Event] Data connection with ${peerId} closed.`);
    const currentNetworkData = state.getNetworkRoomData();
    if (currentNetworkData.isRoomLeader) {
        console.log(`[PeerConn Event] Host: Client ${peerId} connection closed.`);
        const connEntry = connections.get(peerId);
        if (connEntry) {
            console.log(`[PeerConn Event] Host: Removing connection entry for ${peerId}.`);
            connections.delete(peerId);
            const leavingPlayer = currentNetworkData.players.find(p => p.peerId === peerId);
            if (leavingPlayer) {
                const leavingPlayerName = leavingPlayer.name || `Jugador ${leavingPlayer.id}`;
                console.log(`[PeerConn Event] Host: Player ${leavingPlayerName} (PeerID: ${peerId}, GameID: ${leavingPlayer.id}) is considered leaving.`);
                state.removePlayerFromNetworkRoom(peerId); // Removes player by peerId
                
                // It's important that PLAYER_LEFT contains the game ID if possible,
                // as clients might rely on that more than peerId for UI updates.
                broadcastToRoom({ 
                    type: MSG_TYPE.PLAYER_LEFT, 
                    playerId: leavingPlayer.id, // Game ID
                    peerId: peerId, 
                    playerName: leavingPlayerName 
                });
                console.log(`[PeerConn Event] Host: Broadcasted PLAYER_LEFT for ${leavingPlayerName}.`);

                reassignPlayerIdsAndBroadcastUpdate(); // This will send FULL_GAME_STATE
                
                if (window.pizarraUiUpdateCallbacks?.updateLobby) {
                    window.pizarraUiUpdateCallbacks.updateLobby();
                }
                
                if (matchmaking && matchmaking.updateHostedRoomStatus) {
                    console.log(`[PeerConn Event] Host: Updating matchmaking status after player ${peerId} left.`);
                    matchmaking.updateHostedRoomStatus(
                        state.getNetworkRoomData().roomId, 
                        state.getNetworkRoomData().gameSettings, 
                        state.getNetworkRoomData().maxPlayers, 
                        state.getNetworkRoomData().players.filter(p => p.isConnected !== false).length // Count connected players
                    );
                }

                if (state.getNetworkRoomData().roomState === 'playing' && 
                    state.getNetworkRoomData().players.filter(p => p.isConnected !== false).length < state.MIN_PLAYERS_NETWORK) {
                    console.warn(`[PeerConn Event] Host: Game was active, but insufficient players after ${leavingPlayerName} left. Ending game.`);
                    if (window.pizarraUiUpdateCallbacks?.showModal) {
                        window.pizarraUiUpdateCallbacks.showModal(`Jugador ${leavingPlayerName} se desconectó. No hay suficientes jugadores para continuar la partida.`);
                    }
                    state.setGameActive(false);
                    state.setNetworkRoomData({ roomState: 'game_over' }); // Update room state
                    const finalWord = state.getCurrentWordObject()?.word || "N/A";
                    broadcastToRoom({ 
                        type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, 
                        reason: 'disconnect_insufficient_players', 
                        finalWord: finalWord 
                    });
                    console.log(`[PeerConn Event] Host: Broadcasted GAME_OVER due to insufficient players.`);
                }
            } else {
                console.warn(`[PeerConn Event] Host: Connection closed for ${peerId}, but no matching player found in room data.`);
            }
        } else {
            console.warn(`[PeerConn Event] Host: Connection closed for ${peerId}, but no connection entry found.`);
        }
    } else { // Client's perspective
        if (peerId === currentNetworkData.leaderPeerId) {
            console.error("[PeerConn Event] Client: Connection to LEADER lost!");
            if (window.pizarraUiUpdateCallbacks?.showNetworkError) {
                window.pizarraUiUpdateCallbacks.showNetworkError("Se perdió la conexión con el líder de la sala.", true);
            }
            if (window.pizarraUiUpdateCallbacks?.handleCriticalDisconnect) {
                window.pizarraUiUpdateCallbacks.handleCriticalDisconnect();
            }
        } else {
            console.warn(`[PeerConn Event] Client: Connection to non-leader peer ${peerId} closed. This shouldn't happen in a client-host model unless it was a stale connection.`);
        }
    }
}

async function onError(err, peerIdContext = null) {
    console.error(`[PeerConn Error] (Context: ${peerIdContext || 'general'}): Type: ${err.type}, Msg: ${err.message || err}`, err);
    let displayMessage = err.message || (typeof err === 'string' ? err : 'Error de conexión desconocido.');
    const targetPeerForMsg = peerIdContext || state.getNetworkRoomData().leaderPeerId || (err.peer ? err.peer : null);

    if (err.type) {
        if (err.type === 'peer-unavailable' || err.type === 'unavailable-id') {
            displayMessage = `No se pudo conectar a: ${targetPeerForMsg ? PIZARRA_PEER_ID_PREFIX + targetPeerForMsg : 'remoto'}.`;
            const currentRoomData = state.getNetworkRoomData();
            if (!currentRoomData.isRoomLeader && targetPeerForMsg &&
                (currentRoomData.roomState === 'connecting_to_lobby' || 
                 currentRoomData.roomState === 'awaiting_join_approval') &&
                targetPeerForMsg === currentRoomData.leaderPeerId) {
                console.warn(`[PeerConn onError] Peer ${targetPeerForMsg} is unavailable. Attempting cleanup if matchmaking active.`);
                if (matchmaking && matchmaking.removeDeadRoomByPeerId) {
                    await matchmaking.removeDeadRoomByPeerId(targetPeerForMsg); // Pass raw peer ID
                }
                displayMessage += " La sala podría no existir o haber sido cerrada. Intenta buscar de nuevo.";
            }
        } else if (err.type === 'network') {
            displayMessage = "Error de red. Verifica tu conexión e inténtalo de nuevo.";
        } else if (err.type === 'webrtc') {
            displayMessage = "Error de WebRTC (posiblemente firewall o configuración de red).";
        } else if (err.type === 'disconnected' || err.type === 'socket-closed') {
            displayMessage = "Desconectado del servidor de señalización PeerJS. Revisa tu conexión a internet.";
        } else if (err.type === 'server-error') {
            displayMessage = `Error del servidor PeerJS: ${err.message || err.type}`;
        } else if (err.type === 'connection-error') {
            displayMessage = `Error de conexión con ${targetPeerForMsg ? PIZARRA_PEER_ID_PREFIX + targetPeerForMsg : 'el otro jugador'}.`;
        } else {
            displayMessage = `${err.type}: ${displayMessage}`;
        }
    }

    const rawState = state.getRawNetworkRoomData();
    if (rawState._peerInitReject) {
        console.log("[PeerConn onError] Rejecting _peerInitPromise.");
        rawState._peerInitReject(new Error(displayMessage)); // Pass an Error object
        state.setNetworkRoomData({ _peerInitResolve: null, _peerInitReject: null, _peerInitPromise: null }); // Clear promise too
    }
    if (rawState._setupErrorCallback) {
        console.log("[PeerConn onError] Calling _setupErrorCallback.");
        const errorForCallback = new Error(displayMessage);
        errorForCallback.type = err.type;
        errorForCallback.originalError = err;
        rawState._setupErrorCallback(errorForCallback);
        // Nullify callbacks after use to prevent multiple calls
        state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
    }

    // Only show general modal if no specific setup callback handled it
    if (!rawState._peerInitReject && !rawState._setupErrorCallback && window.pizarraUiUpdateCallbacks?.showNetworkError) {
        const isCriticalError = err.type === 'peer-unavailable' || err.type === 'server-error' || 
                                err.type === 'disconnected' || err.type === 'socket-closed' ||
                                (err.type === 'network' && !state.getNetworkRoomData().isRoomLeader); // Network error is critical for client
        window.pizarraUiUpdateCallbacks.showNetworkError(displayMessage, isCriticalError);
    }
}

const peerJsCallbacks = {
    onPeerOpen: (id) => { // `id` is the raw PeerJS ID (string without prefix)
        console.log(`[PeerConn PeerJS] EVENT: peer.on('open'). My PeerJS ID: ${id}.`);
        const oldPeerId = state.getMyPeerId();
        state.setMyPeerId(id); // Store raw ID
        const rawState = state.getRawNetworkRoomData();

        if (rawState._peerInitResolve) {
            console.log("[PeerConn PeerJS] Resolving _peerInitPromise with ID:", id);
            rawState._peerInitResolve(id);
            // Don't nullify _peerInitPromise here, ensurePeerInitialized will do it.
            // Only nullify resolve/reject.
            state.setNetworkRoomData({ _peerInitResolve: null, _peerInitReject: null });
        }

        if (rawState._setupCompleteCallback) { // This means hostNewRoom or joinRoomById is waiting
            console.log("[PeerConn PeerJS] _setupCompleteCallback is present. Determining host/client finalization path.");
            if (rawState.isRoomLeader && 
                (rawState.roomState === 'creating_room' || rawState.roomState === 'seeking_match')) {
                console.log("[PeerConn PeerJS] Finalizing HOST setup.");
                _finalizeHostSetup(id); // Pass raw ID
            } else if (!rawState.isRoomLeader && rawState.leaderPeerId && state.getPvpRemoteActive()) {
                console.log("[PeerConn PeerJS] Finalizing CLIENT join attempt to leader:", rawState.leaderPeerId);
                _finalizeClientJoinAttempt(id, rawState.leaderPeerId); // Pass my raw ID and leader's raw ID
            } else {
                console.warn("[PeerConn PeerJS] _setupCompleteCallback present, but conditions for host/client finalization not met. State:", rawState);
            }
        } else if (!state.getPvpRemoteActive() && oldPeerId !== id) {
            console.log('[PeerConn PeerJS] PeerJS initialized/reconnected outside of active PvP mode. New ID:', id);
        }
    },

    onNewConnection: (conn) => { // `conn.peer` is the raw PeerJS ID of the connecting client
        console.log(`[PeerConn PeerJS] EVENT: peer.on('connection'). Incoming connection from PeerJS ID: ${conn.peer}. Metadata:`, conn.metadata);
        const currentNetworkData = state.getNetworkRoomData();
        if (!currentNetworkData.isRoomLeader) {
            console.warn(`[PeerConn PeerJS] Non-leader received connection from ${conn.peer}. Rejecting.`);
            conn.on('open', () => {
                console.log(`[PeerConn PeerJS] Closing unwanted incoming connection to non-leader from ${conn.peer}.`);
                conn.close();
            });
            return;
        }
        
        const connectedPlayers = currentNetworkData.players.filter(p => p.isConnected !== false);
        const isExistingPlayerReconnecting = connectedPlayers.some(p => p.peerId === conn.peer);
        
        if (connectedPlayers.length >= currentNetworkData.maxPlayers && !isExistingPlayerReconnecting) {
            console.warn(`[PeerConn PeerJS] Room full (${connectedPlayers.length}/${currentNetworkData.maxPlayers}). Rejecting new connection from ${conn.peer}.`);
            conn.on('open', () => {
                console.log(`[PeerConn PeerJS] Sending JOIN_REJECTED (room_full) to ${conn.peer}.`);
                conn.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }
        
        console.log(`[PeerConn PeerJS] Leader: Accepted incoming connection from ${conn.peer}. Setting up handlers.`);
        // Store raw peerId
        connections.set(conn.peer, { 
            connObject: conn, 
            status: 'pending_join_request', // Will wait for actual MSG_TYPE.REQUEST_JOIN_ROOM
            player: null, 
            playerGameId: -1 
        });
        setupConnectionEventHandlers(conn);
    },

    onConnectionOpen: (peerId) => { // `peerId` is the raw PeerJS ID of the other side
        console.log(`[PeerConn PeerJS] EVENT: conn.on('open'). Data connection open with PeerJS ID: ${peerId}.`);
        const currentNetworkData = state.getNetworkRoomData();
        
        if (currentNetworkData.isRoomLeader) {
            const connEntry = connections.get(peerId);
            if (connEntry && connEntry.status === 'pending_join_request') {
                connections.set(peerId, { ...connEntry, status: 'awaiting_join_request' }); // Status update
                console.log(`[PeerConn PeerJS] Host: Connection with client ${peerId} fully open. Awaiting MSG_TYPE.REQUEST_JOIN_ROOM from them.`);
            } else if (connEntry && connEntry.status === 'active') {
                console.log(`[PeerConn PeerJS] Host: Re-established or already active connection opened with ${peerId}. Sending full game state.`);
                sendFullGameStateToClient(peerId); // Send current state if it's a known player perhaps rejoining
            } else if (!connEntry) {
                 console.warn(`[PeerConn PeerJS] Host: Connection opened with ${peerId}, but no prior connEntry. This might be a late/reconnect. Setting up new entry.`);
                const existingPlayer = currentNetworkData.players.find(p => p.peerId === peerId);
                connections.set(peerId, {
                    connObject: window.peerJsMultiplayer.getConnection(peerId), // Get the connection object
                    status: existingPlayer ? 'active' : 'awaiting_join_request',
                    player: existingPlayer || null,
                    playerGameId: existingPlayer ? existingPlayer.id : -1
                });
                if (existingPlayer) {
                    sendFullGameStateToClient(peerId);
                }
            }
        } else { // Client's perspective
            if (peerId === currentNetworkData.leaderPeerId && leaderConnection && leaderConnection.open) {
                if (currentNetworkData.roomState === 'connecting_to_lobby' ||
                    (currentNetworkData.roomState === 'awaiting_join_approval' && 
                     currentNetworkData.myPlayerIdInRoom === null)) { // Ensure not already joined
                    console.log("[PeerConn PeerJS] Client: Connection to leader open. Sending MSG_TYPE.REQUEST_JOIN_ROOM.");
                    const myPlayerData = state.getLocalPlayerCustomizationForNetwork();
                    sendDataToLeader({
                        type: MSG_TYPE.REQUEST_JOIN_ROOM,
                        playerData: { 
                            name: myPlayerData.name, 
                            icon: myPlayerData.icon, 
                            color: myPlayerData.color 
                        }
                    });
                    state.setNetworkRoomData({ roomState: 'awaiting_join_approval' });
                } else {
                     console.log(`[PeerConn PeerJS] Client: Connection to leader ${peerId} opened, but roomState is '${currentNetworkData.roomState}'. Not sending JOIN_REQUEST now.`);
                }
            } else {
                console.warn(`[PeerConn PeerJS] Client: Connection opened with ${peerId}, but it's not the expected leader (${currentNetworkData.leaderPeerId}) or leaderConnection not ready.`);
            }
        }
    },

    onDataReceived,
    onConnectionClose,
    onError
};

function _finalizeHostSetup(hostRawPeerId) { // hostRawPeerId is the host's own PeerJS ID
    console.log(`[PeerConn] _finalizeHostSetup called for Host PeerJS ID: ${hostRawPeerId}.`);
    const rawState = state.getRawNetworkRoomData();

    if (!rawState.isRoomLeader || 
        !(rawState.roomState === 'creating_room' || rawState.roomState === 'seeking_match')) {
        console.error("[PeerConn] _finalizeHostSetup: Conditions not met. Not a leader or wrong room state.", rawState);
        if (rawState._setupErrorCallback) {
            rawState._setupErrorCallback(new Error("Error interno: El estado para finalizar la creación de sala no es válido."));
        }
        state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        return;
    }
    
    if (!rawState.players || rawState.players.length === 0 || !rawState.players[0]) {
        console.error("[PeerConn] _finalizeHostSetup: Host player data missing in state.", rawState.players);
         if (rawState._setupErrorCallback) {
            rawState._setupErrorCallback(new Error("Error interno: Datos del jugador anfitrión no encontrados."));
        }
        state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        return;
    }

    // Update the host's player entry with their actual PeerJS ID
    const updatedPlayers = [...rawState.players];
    updatedPlayers[0].peerId = hostRawPeerId; // Host is player 0

    state.setNetworkRoomData({
        roomId: hostRawPeerId, // Room ID is the host's raw PeerJS ID
        leaderPeerId: hostRawPeerId, // Leader is self
        players: updatedPlayers, // Update players array with host's peerId
        roomState: 'lobby' // Transition to lobby state
    });
    console.log("[PeerConn] _finalizeHostSetup: Host state updated. Room ID:", hostRawPeerId, "State set to lobby.");

    if (window.pizarraUiUpdateCallbacks?.showLobby) {
        window.pizarraUiUpdateCallbacks.showLobby(true); // true for isHost
    }

    if (rawState._setupCompleteCallback) {
        console.log("[PeerConn] _finalizeHostSetup: Calling _setupCompleteCallback with host PeerJS ID:", hostRawPeerId);
        rawState._setupCompleteCallback(hostRawPeerId); // Resolve the promise from hostNewRoom
    }
    state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null }); // Clear callbacks
}

function _finalizeClientJoinAttempt(myRawPeerId, leaderRawPeerIdToJoin) {
    console.log(`[PeerConn] _finalizeClientJoinAttempt. My PeerJS ID: ${myRawPeerId}, Leader's PeerJS ID: ${leaderRawPeerIdToJoin}`);
    const rawState = state.getRawNetworkRoomData();

    if (rawState.isRoomLeader || !leaderRawPeerIdToJoin || !state.getPvpRemoteActive()) {
        console.error("[PeerConn] _finalizeClientJoinAttempt: Conditions not met. Is leader, no leader ID, or PVP not active.", rawState);
        if (rawState._setupErrorCallback) {
            rawState._setupErrorCallback(new Error("Error interno: El estado para unirse a sala no es válido."));
        }
        state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        return;
    }
    
    // Ensure client's own player data includes their peerId
    let clientPlayerDataUpdated = false;
    if (rawState.players && rawState.players.length > 0 && rawState.players[0]) {
        if (rawState.players[0].peerId !== myRawPeerId) {
            const updatedPlayers = [...rawState.players];
            updatedPlayers[0].peerId = myRawPeerId;
            state.setNetworkRoomData({ players: updatedPlayers });
            clientPlayerDataUpdated = true;
        }
    } else { // Should not happen if joinRoomById sets up initial player data
        console.warn("[PeerConn] _finalizeClientJoinAttempt: Client player data was missing or empty. Creating default.");
        const customData = state.getLocalPlayerCustomizationForNetwork(); // Gets name/icon from UI
        state.setNetworkRoomData({ 
            players: [{ ...customData, peerId: myRawPeerId, id: null, isReady: false, isConnected: false }]
        });
        clientPlayerDataUpdated = true;
    }
    if(clientPlayerDataUpdated) console.log("[PeerConn] _finalizeClientJoinAttempt: Client's own player data updated with peerId:", myRawPeerId);


    if (window.peerJsMultiplayer?.connect) {
        if (leaderConnection && leaderConnection.open && leaderConnection.peer === leaderRawPeerIdToJoin) {
            console.log("[PeerConn] _finalizeClientJoinAttempt: Already connected to leader:", leaderRawPeerIdToJoin, " Attempting to send JOIN_REQUEST if needed.");
             // This case implies peer.on('open') fired after connection was somehow already established, or re-called.
             // We must ensure JOIN_REQUEST is sent if not already accepted into room.
            if (state.getNetworkRoomData().roomState === 'connecting_to_lobby' || 
                (state.getNetworkRoomData().roomState === 'awaiting_join_approval' && state.getNetworkRoomData().myPlayerIdInRoom === null) ) {
                console.log("[PeerConn] Client: (Re-checking) Connection to leader open. Sending MSG_TYPE.REQUEST_JOIN_ROOM.");
                const myPlayerDataForJoin = state.getLocalPlayerCustomizationForNetwork();
                sendDataToLeader({
                    type: MSG_TYPE.REQUEST_JOIN_ROOM,
                    playerData: { name: myPlayerDataForJoin.name, icon: myPlayerDataForJoin.icon, color: myPlayerDataForJoin.color }
                });
                state.setNetworkRoomData({ roomState: 'awaiting_join_approval' });
            }

            if (rawState._setupCompleteCallback) { // If the setup promise from joinRoomById is waiting
                rawState._setupCompleteCallback(myRawPeerId); // Resolve it, join process continues via messages
            }
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
            return;
        }
        
        console.log(`[PeerConn] _finalizeClientJoinAttempt: Attempting to connect to leader PeerJS ID: ${leaderRawPeerIdToJoin}`);
        const connToLeader = window.peerJsMultiplayer.connect(leaderRawPeerIdToJoin);
        if (connToLeader) {
            leaderConnection = connToLeader; // This will trigger its own 'open' event which then sends JOIN_REQUEST
            console.log(`[PeerConn] _finalizeClientJoinAttempt: peer.connect call successful for ${leaderRawPeerIdToJoin}. Waiting for connection 'open' event.`);
            // The _setupCompleteCallback for joinRoomById will be called when the connection 'open' event leads to JOIN_ACCEPTED.
            // For now, just resolve the current step of _finalizeClientJoinAttempt's part of joinRoomById if it had a callback
             if (rawState._setupCompleteCallback) {
                rawState._setupCompleteCallback(myRawPeerId); 
            }
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null }); // Clear for this stage
        } else {
            console.error(`[PeerConn] _finalizeClientJoinAttempt: peer.connect() returned null for ${leaderRawPeerIdToJoin}.`);
            peerJsCallbacks.onError({
                type: 'connect_failed',
                message: `No se pudo iniciar la conexión a la sala ${PIZARRA_PEER_ID_PREFIX}${leaderRawPeerIdToJoin}.`
            }, leaderRawPeerIdToJoin);
        }
    } else {
        console.error('[PeerConn] _finalizeClientJoinAttempt: PeerJS connect function not available.');
        peerJsCallbacks.onError({
            type: 'internal_error',
            message: 'Función de conexión PeerJS no disponible.'
        });
    }
}

function initPeerObject(peerIdToUse = null) { // peerIdToUse is raw PeerJS ID, or null for auto
    console.log(`[PeerConn] initPeerObject called. Requested PeerJS ID to use: ${peerIdToUse || 'Auto-assigned'}.`);
    return new Promise((resolve, reject) => {
        if (!window.peerJsMultiplayer?.init) {
            const err = new Error('Error interno: El sistema de conexión (peerJsMultiplayer) no está disponible.');
            console.error("[PeerConn] initPeerObject:", err.message);
            reject(err);
            return;
        }
        
        // Store resolve/reject for onPeerOpen/onError to use
        console.log("[PeerConn] initPeerObject: Storing _peerInitResolve and _peerInitReject.");
        state.setNetworkRoomData({ _peerInitResolve: resolve, _peerInitReject: reject });
        
        console.log(`[PeerConn] initPeerObject: Calling peerJsMultiplayer.init with PeerJS ID: ${peerIdToUse || 'Auto-assigned'}.`);
        window.peerJsMultiplayer.init(peerIdToUse || {}, peerJsCallbacks); // Pass raw ID or empty object for auto
    });
}

export async function ensurePeerInitialized() {
    console.log("[PeerConn] ensurePeerInitialized called.");
    const existingPeer = window.peerJsMultiplayer?.getPeer();
    let currentLocalRawId = window.peerJsMultiplayer?.getLocalId(); // Raw ID

    if (existingPeer && !existingPeer.destroyed && currentLocalRawId) {
        console.log(`[PeerConn] ensurePeerInitialized: Peer already exists, is not destroyed, and has ID: ${currentLocalRawId}.`);
        if (state.getMyPeerId() !== currentLocalRawId) { // Ensure state is up-to-date
            console.log(`[PeerConn] ensurePeerInitialized: Aligning state.myPeerId with current local ID.`);
            state.setMyPeerId(currentLocalRawId);
        }
        // If setup callbacks are pending, try to finalize.
        const rawStateForFinalize = state.getRawNetworkRoomData();
        if (rawStateForFinalize._setupCompleteCallback) {
            console.log("[PeerConn] ensurePeerInitialized: Existing peer, _setupCompleteCallback found. Attempting finalization.");
            if (rawStateForFinalize.isRoomLeader) {
                _finalizeHostSetup(currentLocalRawId);
            } else if (rawStateForFinalize.leaderPeerId) {
                _finalizeClientJoinAttempt(currentLocalRawId, rawStateForFinalize.leaderPeerId);
            }
        }
        return currentLocalRawId; // Return raw ID
    }
    
    console.log("[PeerConn] ensurePeerInitialized: No valid existing peer or ID. Proceeding with initialization.");
    const rawState = state.getRawNetworkRoomData();
    if (rawState._peerInitPromise) {
        console.log("[PeerConn] ensurePeerInitialized: Found existing _peerInitPromise. Awaiting it.");
        // This promise should resolve with the raw peer ID
        try {
            const awaitedId = await rawState._peerInitPromise;
            console.log("[PeerConn] ensurePeerInitialized: Existing _peerInitPromise resolved with ID:", awaitedId);
            return awaitedId; // Return raw ID
        } catch (error) {
            console.error("[PeerConn] ensurePeerInitialized: Error awaiting existing _peerInitPromise:", error);
            state.setNetworkRoomData({_peerInitPromise: null, _peerInitResolve: null, _peerInitReject: null}); // Clear failed promise
            throw error; // Re-throw to be caught by caller
        }
    }

    console.log("[PeerConn] ensurePeerInitialized: Creating new initPromise.");
    const initPromise = initPeerObject(); // Not passing any specific ID, let PeerJS assign
    state.setNetworkRoomData({ _peerInitPromise: initPromise }); // Store the new promise

    try {
        const newRawPeerId = await initPromise; // This will be the raw ID from onPeerOpen
        console.log("[PeerConn] ensurePeerInitialized: New initPromise resolved. New PeerJS ID:", newRawPeerId);
        // Clear the promise from state once resolved to allow re-init if needed later
        if (state.getRawNetworkRoomData()._peerInitPromise === initPromise) { 
            state.setNetworkRoomData({ _peerInitPromise: null }); // Don't clear resolve/reject, they were used
        }
        return newRawPeerId; // Return raw ID
    } catch (err) {
        console.error("[PeerConn] ensurePeerInitialized: Error awaiting new initPromise:", err);
        if (state.getRawNetworkRoomData()._peerInitPromise === initPromise) {
            state.setNetworkRoomData({ _peerInitPromise: null, _peerInitResolve: null, _peerInitReject: null });
        }
        throw err; // Re-throw for hostNewRoom/joinRoomById to catch
    }
}

export function hostNewRoom(hostPlayerData, gameSettingsFromUI) {
    console.log("[PeerConn] hostNewRoom called. Host Player Data:", hostPlayerData, "Game Settings:", gameSettingsFromUI);
    state.resetFullLocalStateForNewUIScreen(); // Crucial: Resets _peerInitPromise too.
    state.setPvpRemoteActive(true);
    console.log("[PeerConn] hostNewRoom: PVP mode activated, state reset.");

    return new Promise(async (resolve, reject) => {
        console.log("[PeerConn] hostNewRoom: Promise created. Setting initial network room data for host.");
        state.setNetworkRoomData({
            isRoomLeader: true,
            myPlayerIdInRoom: 0, // Host is always player 0
            gameSettings: { difficulty: gameSettingsFromUI.difficulty || "easy" },
            maxPlayers: parseInt(gameSettingsFromUI.maxPlayers) || state.MAX_PLAYERS_NETWORK,
            players: [{ // Host's initial player entry
                id: 0,
                peerId: null, // Will be filled by _finalizeHostSetup after peer opens
                name: hostPlayerData.name,
                icon: hostPlayerData.icon,
                color: hostPlayerData.color,
                isReady: true, // Host is implicitly ready
                isConnected: true, 
                score: 0
            }],
            roomState: 'creating_room',
            _setupCompleteCallback: resolve, // To resolve this promise with host's raw PeerJS ID
            _setupErrorCallback: reject    // To reject this promise if setup fails
        });
        
        if (window.pizarraUiUpdateCallbacks?.showModal) { // This is main.js's ui.showModal
            // window.pizarraUiUpdateCallbacks.showModal("Creando tu sala de Palabras... 🏰✨"); // Done by main.js before calling this
        }
        
        try {
            console.log("[PeerConn] hostNewRoom: Calling ensurePeerInitialized.");
            const hostRawPeerId = await ensurePeerInitialized(); // Gets raw PeerJS ID
            console.log(`[PeerConn] hostNewRoom: ensurePeerInitialized successful. Host raw PeerJS ID: ${hostRawPeerId}.`);
            // _finalizeHostSetup (called via onPeerOpen) will use this ID and call the resolve from _setupCompleteCallback
            // If ensurePeerInitialized resolved because peer was already open, _finalizeHostSetup might have already run.
            // The promise 'resolve' from _setupCompleteCallback is what resolves the hostNewRoom promise.
        } catch (err) {
            console.error("[PeerConn] hostNewRoom: Error during ensurePeerInitialized:", err);
            // _setupErrorCallback (which is 'reject') should have been called by onError if it was a peer init error
            // If it wasn't, explicitly reject.
            const currentErrorCb = state.getRawNetworkRoomData()._setupErrorCallback;
            if (currentErrorCb === reject) {
                // onError already called reject
                console.log("[PeerConn] hostNewRoom: onError has already handled the rejection via _setupErrorCallback.");
            } else if (reject) {
                console.log("[PeerConn] hostNewRoom: Explicitly rejecting promise due to error:", err.message);
                reject(err); // Reject the promise from hostNewRoom
            }
            // Ensure callbacks are cleared on error to prevent stale state
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        }
    });
}

export function joinRoomById(leaderRawPeerId, joinerPlayerData) { // leaderRawPeerId is the host's raw PeerJS ID
    console.log(`[PeerConn] joinRoomById called for leader's raw PeerJS ID: ${leaderRawPeerId}. Joiner Data:`, joinerPlayerData);
    state.resetFullLocalStateForNewUIScreen(); // Crucial: Resets _peerInitPromise too.
    state.setPvpRemoteActive(true);
    console.log("[PeerConn] joinRoomById: PVP mode activated, state reset.");

    return new Promise(async (resolve, reject) => {
        console.log("[PeerConn] joinRoomById: Promise created. Setting initial network room data for client.");
        state.setNetworkRoomData({
            isRoomLeader: false,
            roomId: leaderRawPeerId, // Store target room/leader's raw ID
            leaderPeerId: leaderRawPeerId, // Store target room/leader's raw ID
            players: [{ // Client's initial player entry (will get game ID from host)
                name: joinerPlayerData.name,
                icon: joinerPlayerData.icon,
                color: joinerPlayerData.color,
                peerId: null, // Will be filled by _finalizeClientJoinAttempt after local peer opens
                id: null,     // Will be filled by host upon JOIN_ACCEPTED
                isReady: false,
                isConnected: false // Initially not connected to game logic
            }],
            roomState: 'connecting_to_lobby',
            _setupCompleteCallback: resolve, // To resolve this promise with client's own raw PeerJS ID
            _setupErrorCallback: reject    // To reject this promise if setup fails
        });
        
        if (window.pizarraUiUpdateCallbacks?.showModal) {
            // window.pizarraUiUpdateCallbacks.showModal(`Conectando a sala ${PIZARRA_PEER_ID_PREFIX}${leaderRawPeerId}...`); // Done by main.js
        }
        
        try {
            console.log("[PeerConn] joinRoomById: Calling ensurePeerInitialized for client.");
            const myRawPeerId = await ensurePeerInitialized(); // Gets client's own raw PeerJS ID
            console.log(`[PeerConn] joinRoomById: ensurePeerInitialized for client successful. My raw PeerJS ID: ${myRawPeerId}.`);
            // _finalizeClientJoinAttempt (called via onPeerOpen or directly if peer already open) will attempt connection
            // The promise 'resolve' for joinRoomById is from _setupCompleteCallback, which _finalizeClientJoinAttempt calls.
            // Actual entry into room is confirmed by JOIN_ACCEPTED message.
        } catch (err) {
            console.error("[PeerConn] joinRoomById: Error during ensurePeerInitialized for client:", err);
            const currentErrorCb = state.getRawNetworkRoomData()._setupErrorCallback;
            if (currentErrorCb === reject) {
                console.log("[PeerConn] joinRoomById: onError has already handled the rejection via _setupErrorCallback.");
            } else if (reject) {
                console.log("[PeerConn] joinRoomById: Explicitly rejecting promise due to error:", err.message);
                reject(err);
            }
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        }
    });
}

function handleLeaderDataReception(data, fromPeerId) { // fromPeerId is raw client PeerJS ID
    console.log(`[PeerConn L RX] Leader received data from client ${fromPeerId}. Type: ${data.type}`);
    const connEntry = connections.get(fromPeerId);
    if (!connEntry && data.type !== MSG_TYPE.REQUEST_JOIN_ROOM) {
        console.warn(`[PeerConn L RX] Data from ${fromPeerId} (type ${data.type}) but no active connection entry and not a JOIN_REQUEST. Ignored.`);
        return;
    }
    
    const playerGameId = connEntry?.playerGameId; // This is the internal game ID (0, 1, 2...)
    if (data.type !== MSG_TYPE.REQUEST_JOIN_ROOM && 
        (playerGameId === undefined || playerGameId === -1 || !connEntry?.player) ) {
        console.warn(`[PeerConn L RX] Msg type ${data.type} from ${fromPeerId}, but player not fully joined or connEntry invalid. Ignored. ConnEntry:`, connEntry);
        return;
    }

    switch (data.type) {
        case MSG_TYPE.REQUEST_JOIN_ROOM:
            console.log(`[PeerConn L RX] Handling REQUEST_JOIN_ROOM from ${fromPeerId}. Data:`, data.playerData);
            handleJoinRequest(data, fromPeerId, connEntry);
            break;
            
        case MSG_TYPE.PLAYER_READY_CHANGED:
            console.log(`[PeerConn L RX] Handling PLAYER_READY_CHANGED from ${fromPeerId} (PlayerGameID: ${playerGameId}). Ready: ${data.isReady}`);
            handlePlayerReadyChanged(data, fromPeerId); // fromPeerId is enough to find player
            break;
            
        case MSG_TYPE.LETTER_GUESS:
            console.log(`[PeerConn L RX] Handling LETTER_GUESS from ${fromPeerId} (PlayerGameID: ${playerGameId}). Letter: ${data.letter}`);
            handleLetterGuess(data, fromPeerId, playerGameId);
            break;
            
        case MSG_TYPE.CLUE_REQUEST:
            console.log(`[PeerConn L RX] Handling CLUE_REQUEST from ${fromPeerId} (PlayerGameID: ${playerGameId}).`);
            handleClueRequest(data, fromPeerId, playerGameId);
            break;
            
        default:
            console.warn(`[PeerConn L RX] Unhandled message type: ${data.type} from ${fromPeerId}`);
    }
}

function handleJoinRequest(data, fromPeerId, connEntry) { // fromPeerId is raw client PeerJS ID
    console.log(`[PeerConn L] handleJoinRequest from PeerJS ID: ${fromPeerId}. Player data:`, data.playerData);
    const clientConnObjForJoin = connEntry?.connObject || window.peerJsMultiplayer.getConnection(fromPeerId);
    if (!clientConnObjForJoin || !clientConnObjForJoin.open) {
        console.warn(`[PeerConn L] REQUEST_JOIN_ROOM from ${fromPeerId} but connection object not found or not open. Attempting to get new:`, clientConnObjForJoin);
         // This case should be rare if onNewConnection and onConnectionOpen are working.
        if (!window.peerJsMultiplayer.getConnection(fromPeerId)) {
            console.error(`[PeerConn L] No open connection available at all for ${fromPeerId} during join request.`);
            return;
        }
    }

    const currentHostState = state.getRawNetworkRoomData();
    const existingPlayer = currentHostState.players.find(p => p.peerId === fromPeerId);

    if (existingPlayer && existingPlayer.id !== null && existingPlayer.id !== -1) {
        console.log(`[PeerConn L] Player ${fromPeerId} (GameID: ${existingPlayer.id}) is rejoining or join request is redundant.`);
        if (!existingPlayer.isConnected) {
            console.log(`[PeerConn L] Marking player ${existingPlayer.name} as connected.`);
            state.updatePlayerInNetworkRoom(fromPeerId, { isConnected: true, ...data.playerData }); // Update with latest data
        }
        console.log(`[PeerConn L] Sending JOIN_ACCEPTED (rejoin) to ${fromPeerId}.`);
        sendDataToClient(fromPeerId, {
            type: MSG_TYPE.JOIN_ACCEPTED,
            yourPlayerIdInRoom: existingPlayer.id,
            roomData: state.getSanitizedNetworkRoomDataForClient() // Send current lobby state
        });
        sendFullGameStateToClient(fromPeerId); // Send full game state if game is in progress
        return;
    }

    const connectedPlayersCount = currentHostState.players.filter(p => p.isConnected !== false).length;
    if (connectedPlayersCount >= currentHostState.maxPlayers) {
        console.warn(`[PeerConn L] Room full (${connectedPlayersCount}/${currentHostState.maxPlayers}). Rejecting join request from ${fromPeerId}.`);
        sendDataToClient(fromPeerId, { type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
        // Consider closing the connection if it's just for this failed join.
        // clientConnObjForJoin.close(); // This might be too aggressive if it's a shared conn object
        return;
    }

    let newPlayerAssignedId = 0;
    const existingGameIds = new Set(currentHostState.players.map(p => p.id).filter(id => id !== null && id !== undefined));
    while (existingGameIds.has(newPlayerAssignedId)) {
        newPlayerAssignedId++;
    }
    console.log(`[PeerConn L] Assigning GameID ${newPlayerAssignedId} to new player ${fromPeerId}.`);

    const newPlayer = {
        id: newPlayerAssignedId,
        peerId: fromPeerId, // Store raw PeerJS ID
        ...data.playerData, // name, icon, color
        isReady: false,
        isConnected: true, // Now connected to game logic
        score: 0
    };
    
    state.addPlayerToNetworkRoom(newPlayer); // Adds to networkRoomData.players and localPlayersData
    
    // Update or set the connection entry
    connections.set(fromPeerId, {
        connObject: clientConnObjForJoin, // Ensure this is the active, open connection object
        playerGameId: newPlayer.id,
        player: newPlayer, // Store the full player object
        status: 'active'
    });
    console.log(`[PeerConn L] Player ${newPlayer.name} (PeerID: ${fromPeerId}) added to room with GameID ${newPlayer.id}. Connection status: active.`);

    console.log(`[PeerConn L] Sending JOIN_ACCEPTED to ${fromPeerId} (GameID: ${newPlayer.id}).`);
    sendDataToClient(fromPeerId, {
        type: MSG_TYPE.JOIN_ACCEPTED,
        yourPlayerIdInRoom: newPlayer.id,
        roomData: state.getSanitizedNetworkRoomDataForClient() // Send current lobby state
    });
    
    console.log("[PeerConn L] Broadcasting full game state to all after new player joined.");
    broadcastFullGameStateToAll(); // Inform everyone (including the new player again with full state)
    
    if (window.pizarraUiUpdateCallbacks?.updateLobby) {
        window.pizarraUiUpdateCallbacks.updateLobby();
    }
    
    if (matchmaking && matchmaking.updateHostedRoomStatus) {
        console.log(`[PeerConn L] Updating matchmaking status after player ${fromPeerId} joined.`);
        matchmaking.updateHostedRoomStatus(
            currentHostState.roomId, // This is host's raw peerId
            currentHostState.gameSettings,
            currentHostState.maxPlayers,
            state.getNetworkRoomData().players.filter(p => p.isConnected !== false).length
        );
    }
}

function handlePlayerReadyChanged(data, fromPeerId) { // fromPeerId is raw client PeerJS ID
    console.log(`[PeerConn L] handlePlayerReadyChanged from ${fromPeerId}. New ready state: ${data.isReady}`);
    const playerChangingReady = state.getNetworkRoomData().players.find(p => p.peerId === fromPeerId);
    if (playerChangingReady) {
        state.updatePlayerInNetworkRoom(fromPeerId, { isReady: data.isReady });
        console.log(`[PeerConn L] Player ${playerChangingReady.name} (GameID: ${playerChangingReady.id}) ready state changed to ${data.isReady}. Broadcasting full state.`);
        broadcastFullGameStateToAll(); // This will update all clients' lobby UI
        if (window.pizarraUiUpdateCallbacks?.updateLobby) { // Also call specific lobby update for host
            window.pizarraUiUpdateCallbacks.updateLobby();
        }
    } else {
        console.warn(`[PeerConn L] PLAYER_READY_CHANGED from unknown peer ${fromPeerId}.`);
    }
}

function handleLetterGuess(data, fromPeerId, playerGameId) { // fromPeerId is raw, playerGameId is internal ID
    console.log(`[PeerConn L] handleLetterGuess from PeerID ${fromPeerId} (GameID ${playerGameId}). Letter: ${data.letter}`);
    if (playerGameId === state.getCurrentPlayerId() && state.getGameActive()) {
        console.log(`[PeerConn L] Processing guess for player ${playerGameId}.`);
        const result = logic.processGuess(data.letter); // processGuess uses and updates state
        console.log(`[PeerConn L] Guess result for letter '${data.letter}':`, result);
        
        const guessResultPayload = { 
            type: MSG_TYPE.GUESS_RESULT, 
            ...result, 
            letter: data.letter.toUpperCase() // Ensure letter is consistently cased
        };
        console.log("[PeerConn L] Broadcasting GUESS_RESULT:", guessResultPayload);
        broadcastToRoom(guessResultPayload); // Send specific result
        
        console.log("[PeerConn L] Broadcasting full game state after guess.");
        broadcastFullGameStateToAll(); // Then send full state for consistency

        if (result.gameOver) { // This gameOver is from logic.processGuess perspective (word solved or player out of tries)
            console.log(`[PeerConn L] Game over condition met for player ${playerGameId} or word solved. Current word: ${state.getCurrentWordObject()?.word}`);
            state.setNetworkRoomData({ roomState: 'game_over' }); // Update authoritative room state
            const winnerData = logic.getWinnerData(state); // state is the module
            const finalWord = state.getCurrentWordObject()?.word;
            const gameOverPayload = {
                type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT,
                winnerData: winnerData,
                finalScores: state.getPlayersData().map(p => ({
                    id: p.id, name: p.name, icon: p.icon, score: p.score
                })),
                finalWord: finalWord,
                reason: result.wordSolved ? 'word_solved' : 'player_lost' // Add a reason
            };
            console.log("[PeerConn L] Broadcasting GAME_OVER_ANNOUNCEMENT:", gameOverPayload);
            broadcastToRoom(gameOverPayload);
        }
    } else {
        console.warn(`[PeerConn L] Letter guess from ${fromPeerId} (Player ${playerGameId}) ignored. Not their turn (current: ${state.getCurrentPlayerId()}) or game not active (${state.getGameActive()}).`);
        // Optionally send an error back to the specific client if it was a mis-timed guess
        // sendDataToClient(fromPeerId, { type: MSG_TYPE.ERROR_MESSAGE, message: "No es tu turno o el juego no está activo." });
    }
}

function handleClueRequest(data, fromPeerId, playerGameId) {
    console.log(`[PeerConn L] handleClueRequest from PeerID ${fromPeerId} (GameID ${playerGameId}).`);
    if (playerGameId === state.getCurrentPlayerId() && 
        state.getGameActive() && 
        !state.getClueUsedThisGame()) {
        console.log(`[PeerConn L] Processing clue request for player ${playerGameId}.`);
        const clueResult = logic.requestClue(); // Modifies state (clueUsedThisGame)
        if (clueResult.success) {
            console.log("[PeerConn L] Clue request successful. Clue:", clueResult.clue);
            const clueProvidedPayload = {
                type: MSG_TYPE.CLUE_PROVIDED,
                clue: clueResult.clue,
                clueUsed: state.getClueUsedThisGame() // Send updated status
            };
            console.log("[PeerConn L] Broadcasting CLUE_PROVIDED:", clueProvidedPayload);
            broadcastToRoom(clueProvidedPayload);
            
            console.log("[PeerConn L] Broadcasting full game state after clue provided.");
            broadcastFullGameStateToAll();
        } else {
            console.warn(`[PeerConn L] Clue request failed for player ${playerGameId}: ${clueResult.message}`);
            sendDataToClient(fromPeerId, {
                type: MSG_TYPE.ERROR_MESSAGE,
                message: clueResult.message || "No se pudo obtener la pista en este momento."
            });
        }
    } else {
        console.warn(`[PeerConn L] Clue request from ${fromPeerId} (Player ${playerGameId}) ignored. Conditions not met. Turn: ${state.getCurrentPlayerId()}, Active: ${state.getGameActive()}, ClueUsed: ${state.getClueUsedThisGame()}`);
         sendDataToClient(fromPeerId, { 
            type: MSG_TYPE.ERROR_MESSAGE, 
            message: state.getClueUsedThisGame() ? "La pista ya fue usada." : "No puedes pedir pista ahora." 
        });
    }
}

function handleClientDataReception(data, fromLeaderPeerId) { // fromLeaderPeerId is raw leader PeerJS ID
    // console.log(`[PeerConn C RX] Client received data from leader ${fromLeaderPeerId}. Type: ${data.type}`);
    const currentClientState = state.getNetworkRoomData();
    if (fromLeaderPeerId !== currentClientState.leaderPeerId) {
        console.warn(`[PeerConn C RX] Data from non-leader ${fromLeaderPeerId} (expected ${currentClientState.leaderPeerId}). Type ${data.type} Ignored.`);
        return;
    }

    switch (data.type) {
        case MSG_TYPE.JOIN_ACCEPTED:
            console.log("[PeerConn C RX] Received JOIN_ACCEPTED. Room Data:", data.roomData, "My Player ID in Room:", data.yourPlayerIdInRoom);
            state.setNetworkRoomData({
                ...data.roomData, // Apply host's view of room (players, settings, roomState)
                myPlayerIdInRoom: data.yourPlayerIdInRoom,
                isRoomLeader: false, // Ensure this is false
                myPeerId: state.getMyPeerId(), // Keep my own peerId
                leaderPeerId: currentClientState.leaderPeerId, // Keep leader's peerId
                roomId: currentClientState.roomId, // Keep room Id (which is leader's peerId)
                roomState: data.roomData.roomState || 'lobby' // Ensure roomState is set
            });
            console.log("[PeerConn C RX] JOIN_ACCEPTED: State updated. Calling showLobby.");
            if (window.pizarraUiUpdateCallbacks?.hideModal) window.pizarraUiUpdateCallbacks.hideModal(); // Hide "connecting..."
            if (window.pizarraUiUpdateCallbacks?.showLobby) window.pizarraUiUpdateCallbacks.showLobby(false); // false for isHost
            
            // Clear setup callbacks as this specific setup phase (joining) is complete
            const rawStateJoinAccepted = state.getRawNetworkRoomData();
            if (rawStateJoinAccepted._setupCompleteCallback) {
                 console.log("[PeerConn C RX] JOIN_ACCEPTED: Calling _setupCompleteCallback (from joinRoomById).");
                rawStateJoinAccepted._setupCompleteCallback(state.getMyPeerId());
            }
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
            break;

        case MSG_TYPE.JOIN_REJECTED:
            console.warn(`[PeerConn C RX] Received JOIN_REJECTED. Reason: ${data.reason}`);
            const rawStateReject = state.getRawNetworkRoomData();
            if (rawStateReject._setupErrorCallback) { // If joinRoomById promise is waiting
                console.log("[PeerConn C RX] JOIN_REJECTED: Calling _setupErrorCallback (from joinRoomById).");
                rawStateReject._setupErrorCallback(new Error(`Unión rechazada: ${data.reason || 'Desconocido'}`));
            } else if (window.pizarraUiUpdateCallbacks?.showNetworkError) {
                window.pizarraUiUpdateCallbacks.showNetworkError(
                    `No se pudo unir a la sala: ${data.reason || 'Razón desconocida'}`, true // Critical, return to setup
                );
            }
            // Full reset because join failed completely
            state.resetFullLocalStateForNewUIScreen(); // This clears peer connection related state
            // UI should be reset by showNetworkError or main.js logic
            break;

        case MSG_TYPE.PLAYER_LEFT:
            console.log(`[PeerConn C RX] Received PLAYER_LEFT. Player GameID: ${data.playerId}, PeerID: ${data.peerId}, Name: ${data.playerName}`);
            if (data.peerId !== state.getMyPeerId()) { // If it's not me leaving
                // The host will send a FULL_GAME_STATE shortly after this, which will update the player list.
                // This message is more of an immediate notification.
                if (window.pizarraUiUpdateCallbacks?.showLobbyMessage) {
                    window.pizarraUiUpdateCallbacks.showLobbyMessage(`${data.playerName || `Jugador ${data.playerId}`} ha salido de la sala.`);
                }
                // Optionally, immediately remove player from local display if FULL_GAME_STATE is too slow,
                // but be careful about consistency. Relying on FULL_GAME_STATE is safer.
                // state.removePlayerFromNetworkRoom(data.peerId); // Might cause issues if not careful
                // if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();

            }
            break;

        // MSG_TYPE.ROOM_STATE_UPDATE is largely superseded by FULL_GAME_STATE
        // case MSG_TYPE.ROOM_STATE_UPDATE:
        //     console.log("[PeerConn C RX] Received ROOM_STATE_UPDATE. New Room Data:", data.roomData);
        //     state.setNetworkRoomData({
        //         ...data.roomData,
        //         isRoomLeader: false,
        //         myPeerId: state.getMyPeerId(),
        //         myPlayerIdInRoom: data.roomData.players.find(p => p.peerId === state.getMyPeerId())?.id ?? 
        //                          currentClientState.myPlayerIdInRoom,
        //         leaderPeerId: currentClientState.leaderPeerId,
        //         roomId: currentClientState.roomId
        //     });
        //     if (window.pizarraUiUpdateCallbacks?.updateLobby) {
        //         window.pizarraUiUpdateCallbacks.updateLobby();
        //     }
        //     break;

        case MSG_TYPE.GAME_STARTED:
            console.log("[PeerConn C RX] Received GAME_STARTED. Initial Game State:", data.initialGameState);
            // Apply the initial game state provided by the host
            state.setPlayersData(data.initialGameState.playersInGameOrder); // Sets localPlayersData and networkRoomData.players
            state.setCurrentWordObject(data.initialGameState.currentWordObject);
            state.setGuessedLetters(new Set(data.initialGameState.guessedLetters || []));
            state.setRemainingAttemptsPerPlayer(data.initialGameState.remainingAttemptsPerPlayer || []);
            state.setCurrentPlayerId(data.initialGameState.startingPlayerId);
            state.setClueUsedThisGame(data.initialGameState.clueUsedThisGame || false);
            state.setCurrentDifficulty(data.initialGameState.gameSettings.difficulty);
            
            // Update the broader networkRoomData state too
            state.setNetworkRoomData({
                gameSettings: data.initialGameState.gameSettings,
                // players already set by setPlayersData if it syncs networkRoomData.players
                roomState: 'playing',
                currentWordObject: data.initialGameState.currentWordObject,
                guessedLetters: Array.from(data.initialGameState.guessedLetters || []),
                remainingAttemptsPerPlayer: data.initialGameState.remainingAttemptsPerPlayer || [],
                currentPlayerId: data.initialGameState.startingPlayerId,
                clueUsedThisGame: data.initialGameState.clueUsedThisGame || false,
                gameActive: true, // Explicitly set gameActive
            });
            
            if (window.pizarraUiUpdateCallbacks?.startGameOnNetwork) {
                window.pizarraUiUpdateCallbacks.startGameOnNetwork(data.initialGameState);
            }
            break;

        case MSG_TYPE.GUESS_RESULT:
            // console.log("[PeerConn C RX] Received GUESS_RESULT:", data);
            // This message primarily drives UI updates for the guess itself.
            // Full state consistency is ensured by subsequent FULL_GAME_STATE.
            if (window.pizarraUiUpdateCallbacks?.updateGameFromNetwork) {
                window.pizarraUiUpdateCallbacks.updateGameFromNetwork(data);
            }
            break;

        case MSG_TYPE.CLUE_PROVIDED:
            console.log("[PeerConn C RX] Received CLUE_PROVIDED:", data);
            // Similar to GUESS_RESULT, drives immediate UI for clue.
            // State like 'clueUsedThisGame' will be synced by FULL_GAME_STATE.
            if (window.pizarraUiUpdateCallbacks?.displayClueFromNetwork) {
                window.pizarraUiUpdateCallbacks.displayClueFromNetwork(data); // data contains {clue, clueUsed}
            }
            // state.setClueUsedThisGame(data.clueUsed); // Or rely on FULL_GAME_STATE
            break;

        case MSG_TYPE.FULL_GAME_STATE:
            console.log("[PeerConn C RX] Received FULL_GAME_STATE. Game State Payload:", data.gameState);
            // Authoritative state update from host.
            // setNetworkRoomData handles updating individual state pieces like currentWordObject, guessedLetters, etc.
            // and also updates the main networkRoomData object.
            state.setNetworkRoomData({
                ...data.gameState, // This includes players, gameSettings, roomState, and game specific state
                isRoomLeader: false, // Client is never leader
                myPeerId: state.getMyPeerId(), // Preserve my own peer ID
                // myPlayerIdInRoom should be part of gameState.players, find it.
                myPlayerIdInRoom: data.gameState.players?.find(p => p.peerId === state.getMyPeerId())?.id ?? 
                                 state.getNetworkRoomData().myPlayerIdInRoom, // Fallback to current if not found
                leaderPeerId: currentClientState.leaderPeerId, // leaderPeerId does not change for client
                roomId: currentClientState.roomId, // roomId does not change for client
            });
            
            console.log("[PeerConn C RX] FULL_GAME_STATE: State updated. Calling syncUIFromNetworkState.");
            if (window.pizarraUiUpdateCallbacks?.syncUIFromNetworkState) {
                window.pizarraUiUpdateCallbacks.syncUIFromNetworkState();
            }
            break;

        case MSG_TYPE.GAME_OVER_ANNOUNCEMENT:
            console.log("[PeerConn C RX] Received GAME_OVER_ANNOUNCEMENT:", data);
            state.setGameActive(false); // Ensure local game state reflects game over
            state.setNetworkRoomData({ roomState: 'game_over' }); // Update room state
            
            // Update word display if game ended and word was revealed
            if (data.finalWord && !logic.checkWinCondition()) { // If game didn't end by solving
                state.setCurrentWordObject({ // Create a minimal word object
                    word: data.finalWord,
                    definition: "La palabra era esta.", // Generic definition
                    difficulty: state.getCurrentDifficulty()
                });
                // Reveal all letters of the final word
                const finalGuessed = new Set();
                for (const letter of data.finalWord.toUpperCase()) { // Ensure uppercase like currentWord
                    finalGuessed.add(state.normalizeString(letter).toLowerCase());
                }
                state.setGuessedLetters(finalGuessed);
            }
            
            // Update scores
            if (data.finalScores) {
                const currentPlayers = state.getPlayersData(); // Get a mutable copy
                const networkPlayers = state.getRawNetworkRoomData().players; // Get network copy
                data.finalScores.forEach(ps => {
                    const pLocal = currentPlayers.find(p => p.id === ps.id); 
                    if (pLocal) pLocal.score = ps.score;
                    
                    const pNet = networkPlayers.find(pNetEntry => pNetEntry.id === ps.id);
                    if (pNet) pNet.score = ps.score;
                });
                state.setPlayersData(currentPlayers); // Update state with modified local players
                if(networkPlayers.length > 0) state.setNetworkRoomData({players: networkPlayers}); // Update network players in state
            }
            
            if (window.pizarraUiUpdateCallbacks?.showNetworkGameOver) {
                window.pizarraUiUpdateCallbacks.showNetworkGameOver(data);
            }
            break;

        case MSG_TYPE.ERROR_MESSAGE:
            console.warn(`[PeerConn C RX] Received ERROR_MESSAGE from leader: ${data.message}`);
            if (window.pizarraUiUpdateCallbacks?.showNetworkError) {
                // False for shouldReturnToSetupIfCritical, as it's a specific message not a connection loss
                window.pizarraUiUpdateCallbacks.showNetworkError(data.message, false); 
            }
            break;

        default:
            console.warn(`[PeerConn C RX] Unhandled message type from leader: ${data.type}`);
    }
    
    // Clear setup callbacks after JOIN_ACCEPTED or JOIN_REJECTED specifically
    if (data.type === MSG_TYPE.JOIN_ACCEPTED || data.type === MSG_TYPE.JOIN_REJECTED) {
        state.setNetworkRoomData({ 
            _setupCompleteCallback: null, 
            _setupErrorCallback: null 
        });
    }
}

function reassignPlayerIdsAndBroadcastUpdate() {
    console.log("[PeerConn L] reassignPlayerIdsAndBroadcastUpdate called by host.");
    if (!state.getNetworkRoomData().isRoomLeader) {
        console.warn("[PeerConn L] reassignPlayerIdsAndBroadcastUpdate called by non-leader. Aborting.");
        return;
    }
    
    const currentPlayersFromState = state.getNetworkRoomData().players; // Get current players from authoritative source
    
    // Filter for players who are still considered connected based on open PeerJS connections
    // AND have the isConnected flag true in their player object
    const connectedPeerJsIds = new Set(Array.from(connections.keys()).filter(peerId => 
        connections.get(peerId)?.connObject?.open));
    // Host is always "connected" in terms of PeerJS presence for their own game instance
    connectedPeerJsIds.add(state.getMyPeerId()); 

    // Players considered active for ID reassignment
    const activePlayers = currentPlayersFromState.filter(p => 
        p.isConnected !== false && connectedPeerJsIds.has(p.peerId));

    console.log(`[PeerConn L] Active players for ID reassignment (isConn=true & has open conn): ${activePlayers.length}`, activePlayers.map(p=>({id:p.id, name:p.name, peerId:p.peerId})));


    // Sort to ensure host (if present) is usually player 0, then by original ID or join order.
    // This helps in maintaining some consistency but might not be strictly necessary if clients always use received IDs.
    activePlayers.sort((a, b) => {
        if (a.peerId === state.getMyPeerId()) return -1; // Host first
        if (b.peerId === state.getMyPeerId()) return 1;
        return (a.id === undefined || a.id === null ? Infinity : a.id) - 
               (b.id === undefined || b.id === null ? Infinity : b.id); // Then by old ID
    });

    let idsChanged = false;
    const newPlayerArrayForState = activePlayers.map((player, index) => {
        if (player.id !== index) {
            idsChanged = true;
            console.log(`[PeerConn L] Reassigning ID for player ${player.name} (PeerID: ${player.peerId}): Old ID ${player.id} -> New ID ${index}`);
        }
        return { ...player, id: index }; // Create new player object with updated ID
    });

    // Update myPlayerIdInRoom for the host
    const hostPlayerEntry = newPlayerArrayForState.find(p => p.peerId === state.getMyPeerId());
    if (hostPlayerEntry) {
        state.setNetworkRoomData({ myPlayerIdInRoom: hostPlayerEntry.id });
    }


    // Update the authoritative player list in the state
    state.setNetworkRoomData({ players: newPlayerArrayForState });
    // setPlayersData will also be called internally if pvpRemoteActive to sync localPlayersData from networkRoomData.players

    if (idsChanged || activePlayers.length !== currentPlayersFromState.length) {
        console.log("[PeerConn L] Player list or IDs changed. Broadcasting new full game state.");
        broadcastFullGameStateToAll(); // This is crucial
        if (window.pizarraUiUpdateCallbacks?.updateLobby) {
            window.pizarraUiUpdateCallbacks.updateLobby(); // Update host's lobby UI immediately
        }
    } else {
        console.log("[PeerConn L] No player ID changes detected after filtering and sorting active players.");
    }
}


function sendFullGameStateToClient(clientRawPeerId) { // clientRawPeerId is raw PeerJS ID
    console.log(`[PeerConn L] sendFullGameStateToClient called for client: ${clientRawPeerId}.`);
    if (!state.getNetworkRoomData().isRoomLeader) return;
    
    const currentNetworkState = state.getRawNetworkRoomData();
    const gameStatePayload = {
        // Data from networkRoomData (single source of truth for network state)
        players: currentNetworkState.players.map(p => ({ ...p })), // Send clone
        gameSettings: { ...currentNetworkState.gameSettings },
        roomState: currentNetworkState.roomState,
        maxPlayers: currentNetworkState.maxPlayers,
        roomId: currentNetworkState.roomId,
        leaderPeerId: currentNetworkState.leaderPeerId,
        turnCounter: currentNetworkState.turnCounter,

        // Game-specific state from networkRoomData's snapshot part or derived from global state
        // Ensure these are from the networkRoomData if they represent the shared truth
        currentWordObject: currentNetworkState.currentWordObject ? { ...currentNetworkState.currentWordObject } : null,
        guessedLetters: Array.isArray(currentNetworkState.guessedLetters) ? [...currentNetworkState.guessedLetters] : [],
        remainingAttemptsPerPlayer: Array.isArray(currentNetworkState.remainingAttemptsPerPlayer) ? [...currentNetworkState.remainingAttemptsPerPlayer] : [],
        currentPlayerId: currentNetworkState.currentPlayerId,
        clueUsedThisGame: currentNetworkState.clueUsedThisGame,
        gameActive: currentNetworkState.gameActive,
    };
    console.log(`[PeerConn L] Preparing FULL_GAME_STATE payload for ${clientRawPeerId}:`, gameStatePayload);
    sendDataToClient(clientRawPeerId, { 
        type: MSG_TYPE.FULL_GAME_STATE, 
        gameState: gameStatePayload 
    });
}

function broadcastFullGameStateToAll() {
    console.log("[PeerConn L] broadcastFullGameStateToAll called by host.");
    if (!state.getNetworkRoomData().isRoomLeader) {
        console.warn("[PeerConn L] broadcastFullGameStateToAll called by non-leader. Aborting.");
        return;
    }
    
    const currentNetworkState = state.getRawNetworkRoomData(); // Get the single source of truth
    const gameStatePayload = {
        // Data from networkRoomData
        players: currentNetworkState.players.map(p => ({ ...p })), 
        gameSettings: { ...currentNetworkState.gameSettings },
        roomState: currentNetworkState.roomState,
        maxPlayers: currentNetworkState.maxPlayers,
        roomId: currentNetworkState.roomId, // host's raw peerId
        leaderPeerId: currentNetworkState.leaderPeerId, // host's raw peerId
        turnCounter: currentNetworkState.turnCounter,

        // Game-specific state from networkRoomData's snapshot
        currentWordObject: currentNetworkState.currentWordObject ? { ...currentNetworkState.currentWordObject } : null,
        guessedLetters: Array.isArray(currentNetworkState.guessedLetters) ? [...currentNetworkState.guessedLetters] : [],
        remainingAttemptsPerPlayer: Array.isArray(currentNetworkState.remainingAttemptsPerPlayer) ? [...currentNetworkState.remainingAttemptsPerPlayer] : [],
        currentPlayerId: currentNetworkState.currentPlayerId,
        clueUsedThisGame: currentNetworkState.clueUsedThisGame,
        gameActive: currentNetworkState.gameActive,
    };
    console.log("[PeerConn L] Broadcasting FULL_GAME_STATE to all clients. Payload:", gameStatePayload);
    broadcastToRoom({ type: MSG_TYPE.FULL_GAME_STATE, gameState: gameStatePayload });
    
    // Host UI should also sync from this same source of truth
    if (window.pizarraUiUpdateCallbacks?.syncUIFromNetworkState) {
        console.log("[PeerConn L] Triggering host's own UI sync after broadcasting full state.");
        window.pizarraUiUpdateCallbacks.syncUIFromNetworkState();
    }
}

export function leaveRoom() {
    console.log("[PeerConn] leaveRoom called.");
    if (window.pizarraUiUpdateCallbacks?.hideNetworkInfo) {
        window.pizarraUiUpdateCallbacks.hideNetworkInfo();
    }
    
    const currentRoomData = state.getNetworkRoomData(); // Use getter for clone
    const isCurrentlyLeader = currentRoomData.isRoomLeader;
    const myCurrentPeerId = state.getMyPeerId(); // Raw ID

    if (isCurrentlyLeader) {
        console.log(`[PeerConn] Leader (PeerID: ${myCurrentPeerId}, RoomID: ${currentRoomData.roomId}) is leaving. Broadcasting GAME_OVER.`);
        broadcastToRoom({
            type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT,
            reason: 'leader_left_room',
            finalWord: state.getCurrentWordObject()?.word // state getter for current word
        });
        
        if (currentRoomData.roomId && matchmaking && matchmaking.leaveQueue) { // roomId is host's raw peerId
            console.log(`[PeerConn] Leader leaving matchmaking queue for room/peerId: ${currentRoomData.roomId}`);
            matchmaking.leaveQueue(currentRoomData.roomId); // Pass raw peerId which is the room id
        }
        
        // Close connections after a short delay to allow messages to send
        setTimeout(() => {
            console.log("[PeerConn] Leader: Closing all client connections.");
            connections.forEach((connEntry, peerId) => {
                if (connEntry.connObject?.close && !connEntry.connObject.disconnected) {
                    console.log(`[PeerConn] Leader: Closing connection to client ${peerId}`);
                    try { connEntry.connObject.close(); } 
                    catch (e) { console.warn(`[PeerConn] Error closing connection to ${peerId}:`, e); }
                }
            });
            connections.clear();
        }, 500); // Increased delay
    } else if (leaderConnection) {
        console.log(`[PeerConn] Client (PeerID: ${myCurrentPeerId}) is leaving room. Closing connection to leader ${leaderConnection.peer}.`);
        if (leaderConnection.close && !leaderConnection.disconnected) {
            try { leaderConnection.close(); }
            catch (e) { console.warn(`[PeerConn] Error closing leader connection:`, e); }
        }
    }
    leaderConnection = null; // Clear leader connection for clients
    // The call to closePeerSession in stopAnyActiveGameOrNetworkSession will handle PeerJS object destruction.
    console.log("[PeerConn] leaveRoom processing finished. PeerJS session closure will be handled by stopAnyActiveGameOrNetworkSession.");
}


function sendDataToLeader(data) {
    // console.log(`[PeerConn C TX] Client sending data to leader. Type: ${data.type}, Payload:`, data);
    if (leaderConnection && leaderConnection.open) {
        try {
            leaderConnection.send(data);
        } catch (e) {
            console.error(`[PeerConn C TX] Error sending data to leader ${leaderConnection.peer}:`, e, data);
            peerJsCallbacks.onError({
                type: 'send_error',
                message: 'Error al enviar datos al líder de la sala.',
                originalError: e,
                peer: leaderConnection.peer
            });
        }
    } else {
        const leaderPeerInfo = leaderConnection ? leaderConnection.peer : "desconocido";
        console.warn(`[PeerConn C TX] No open connection to leader ${leaderPeerInfo}. Cannot send data type ${data.type}.`);
        peerJsCallbacks.onError({
            type: 'send_error_no_connection',
            message: `No hay conexión abierta con el líder (${leaderPeerInfo}) para enviar datos.`
        });
    }
}

function sendDataToClient(clientRawPeerId, data) { // clientRawPeerId is raw PeerJS ID
    // console.log(`[PeerConn L TX] Host sending data to client ${clientRawPeerId}. Type: ${data.type}, Payload:`, data);
    const connEntry = connections.get(clientRawPeerId);
    if (connEntry?.connObject?.open) {
        try {
            connEntry.connObject.send(data);
        } catch (e) {
            console.error(`[PeerConn L TX] Error sending data to client ${clientRawPeerId}:`, e, data);
        }
    } else {
        console.warn(`[PeerConn L TX] No open connection to client ${clientRawPeerId}. Cannot send data type ${data.type}. ConnEntry:`, connEntry);
    }
}

function broadcastToRoom(data, excludePeerId = null) { // excludePeerId is raw PeerJS ID
    // console.log(`[PeerConn L TX] Host broadcasting to room. Type: ${data.type}, Excluding: ${excludePeerId}, Payload:`, data);
    if (!state.getNetworkRoomData().isRoomLeader) {
        console.warn("[PeerConn L TX] Non-leader attempting to broadcast. Aborted.");
        return;
    }
    connections.forEach((connEntry, peerId) => { // peerId here is raw PeerJS ID
        if (peerId !== excludePeerId && connEntry?.connObject?.open) {
            try {
                // console.log(`[PeerConn L TX] Broadcasting type ${data.type} to client ${peerId}`);
                connEntry.connObject.send(data);
            } catch (e) {
                console.error(`[PeerConn L TX] Error broadcasting type ${data.type} to client ${peerId}:`, e);
            }
        }
    });
}

export function sendPlayerReadyState(isReady) {
    console.log(`[PeerConn] sendPlayerReadyState called. Is Ready: ${isReady}`);
    const currentNetworkData = state.getNetworkRoomData();
    if (currentNetworkData.isRoomLeader) {
        console.log("[PeerConn] Host is changing their own ready state.");
        state.updatePlayerInNetworkRoom(state.getMyPeerId(), { isReady });
        console.log("[PeerConn] Host ready state updated. Broadcasting full game state.");
        broadcastFullGameStateToAll(); // Update all clients including host's UI via sync
        if (window.pizarraUiUpdateCallbacks?.updateLobby) { // Also call specific lobby update for host
            window.pizarraUiUpdateCallbacks.updateLobby();
        }
    } else {
        console.log(`[PeerConn] Client (PlayerGameID: ${currentNetworkData.myPlayerIdInRoom}) sending ready state ${isReady} to host.`);
        sendDataToLeader({
            type: MSG_TYPE.PLAYER_READY_CHANGED,
            playerId: currentNetworkData.myPlayerIdInRoom, // Send game ID
            isReady: isReady
        });
    }
}

export function leaderStartGameRequest() {
    console.log("[PeerConn L] leaderStartGameRequest called by host.");
    const currentRoomData = state.getRawNetworkRoomData(); // Get authoritative state
    if (!currentRoomData.isRoomLeader || currentRoomData.roomState !== 'lobby') {
        console.warn(`[PeerConn L] Leader start game request ignored. Not leader or not in lobby. State:`, currentRoomData);
        return;
    }

    const connectedAndReadyPlayers = currentRoomData.players.filter(p => p.isReady && p.isConnected !== false);
    if (connectedAndReadyPlayers.length < state.MIN_PLAYERS_NETWORK || 
        connectedAndReadyPlayers.length !== currentRoomData.players.filter(p=>p.isConnected !== false).length) {
        const msg = `No todos los jugadores están listos (${connectedAndReadyPlayers.length}/${currentRoomData.players.filter(p=>p.isConnected !== false).length}) o no hay suficientes (${state.MIN_PLAYERS_NETWORK} min).`;
        console.warn(`[PeerConn L] Cannot start game: ${msg}`);
        if (window.pizarraUiUpdateCallbacks?.showNetworkError) {
            window.pizarraUiUpdateCallbacks.showNetworkError(msg, false);
        }
        return;
    }

    console.log("[PeerConn L] All conditions met. Starting game setup.");
    // Difficulty is already in currentRoomData.gameSettings.difficulty
    // state.setCurrentDifficulty(currentRoomData.gameSettings.difficulty); // Ensure global state is also aligned if needed by logic.initializeGame

    const gameInitResult = logic.initializeGame(state, currentRoomData.gameSettings.difficulty); // state is module

    if (!gameInitResult.success || !state.getCurrentWordObject()) { // Check state directly after init
        console.error("[PeerConn L] Failed to initialize game logic (e.g., no word selected):", gameInitResult.message);
        // Revert room state if game init fails
        state.setNetworkRoomData({ roomState: 'lobby' }); 
        broadcastFullGameStateToAll(); // Inform clients that it's still lobby
        if (window.pizarraUiUpdateCallbacks?.showNetworkError) {
            window.pizarraUiUpdateCallbacks.showNetworkError(
                `Error del Host al iniciar: ${gameInitResult.message || "No se pudo seleccionar palabra."}`, false
            );
        }
        return;
    }
    console.log(`[PeerConn L] Game logic initialized. Word: ${state.getCurrentWordObject()?.word}. Starting player ID: ${state.getCurrentPlayerId()}`);

    // Update networkRoomData with the game state details derived from initializeGame
    // This ensures the authoritative networkRoomData has the fresh game details.
    state.setNetworkRoomData({
        roomState: 'playing', // Officially in 'playing' state
        currentWordObject: state.getCurrentWordObject(),
        guessedLetters: Array.from(state.getGuessedLetters()),
        remainingAttemptsPerPlayer: state.getRemainingAttemptsPerPlayer(),
        currentPlayerId: state.getCurrentPlayerId(),
        clueUsedThisGame: state.getClueUsedThisGame(),
        gameActive: true, // Game is now active
        turnCounter: 0, // Reset turn counter
         // players array in networkRoomData should already be correct (scores reset by initializeGame if it modifies its input)
         // Ensure players in networkRoomData have scores reset if initializeGame doesn't do it reflectively.
        players: state.getPlayersData().map(p => ({...p, score:0})) // Ensure scores are zeroed for new game based on current players
    });


    // Construct the payload from the now updated state.getRawNetworkRoomData()
    const finalNetworkStateForStart = state.getRawNetworkRoomData();
    const initialGameStatePayload = {
        gameSettings: finalNetworkStateForStart.gameSettings,
        currentWordObject: finalNetworkStateForStart.currentWordObject,
        guessedLetters: finalNetworkStateForStart.guessedLetters,
        remainingAttemptsPerPlayer: finalNetworkStateForStart.remainingAttemptsPerPlayer,
        playersInGameOrder: finalNetworkStateForStart.players, // This is the ordered list from state
        startingPlayerId: finalNetworkStateForStart.currentPlayerId,
        clueUsedThisGame: finalNetworkStateForStart.clueUsedThisGame,
    };

    console.log("[PeerConn L] Broadcasting GAME_STARTED with payload:", initialGameStatePayload);
    broadcastToRoom({ type: MSG_TYPE.GAME_STARTED, initialGameState: initialGameStatePayload });
    
    // Host also needs to start its UI
    if (window.pizarraUiUpdateCallbacks?.startGameOnNetwork) {
        console.log("[PeerConn L] Triggering host's own startGameOnNetwork UI update.");
        window.pizarraUiUpdateCallbacks.startGameOnNetwork(initialGameStatePayload);
    }

    // Update matchmaking: room is now in_game and should not be joinable / should be removed from queue
    if (currentRoomData.roomId) { // roomId is host's raw peerId
        if (matchmaking && matchmaking.leaveQueue) { // Remove from active "waiting" queue
            console.log(`[PeerConn L] Removing room ${currentRoomData.roomId} from matchmaking 'waiting' queue as game starts.`);
            matchmaking.leaveQueue(currentRoomData.roomId); 
        }
        // Optionally, update status to 'in_game' if your matchmaking supports displaying ongoing games (not typical for simple queue)
        if (matchmaking && matchmaking.updateHostedRoomStatus) {
             console.log(`[PeerConn L] Updating matchmaking status for room ${currentRoomData.roomId} to 'in_game'.`);
            matchmaking.updateHostedRoomStatus(
                currentRoomData.roomId, // host's raw peerId
                finalNetworkStateForStart.gameSettings,
                finalNetworkStateForStart.maxPlayers,
                finalNetworkStateForStart.players.length,
                'in_game' // New status
            );
        }
    }
    // No need for broadcastFullGameStateToAll() immediately after GAME_STARTED if payload is complete,
    // unless specific client UIs rely on it for parts not in GAME_STARTED.
    // However, for robustness, if GAME_STARTED is narrowly defined, a full sync might be good.
    // Current GAME_STARTED payload seems comprehensive.
}

export function sendGuessToHost(letter) {
    console.log(`[PeerConn C TX] Client sending guess to host. Letter: ${letter}`);
    const currentRoomData = state.getNetworkRoomData();
    if (state.getPvpRemoteActive() && !currentRoomData.isRoomLeader && state.getGameActive()) {
        sendDataToLeader({
            type: MSG_TYPE.LETTER_GUESS,
            letter: letter,
            playerId: currentRoomData.myPlayerIdInRoom // Send client's game ID
        });
    } else {
        console.warn(`[PeerConn C TX] sendGuessToHost: Conditions not met. PVP: ${state.getPvpRemoteActive()}, IsLeader: ${currentRoomData.isRoomLeader}, GameActive: ${state.getGameActive()}`);
    }
}

export function sendClueRequestToHost() {
    console.log("[PeerConn C TX] Client sending clue request to host.");
    const currentRoomData = state.getNetworkRoomData();
    if (state.getPvpRemoteActive() && !currentRoomData.isRoomLeader && state.getGameActive()) {
        sendDataToLeader({
            type: MSG_TYPE.CLUE_REQUEST,
            playerId: currentRoomData.myPlayerIdInRoom // Send client's game ID
        });
    } else {
         console.warn(`[PeerConn C TX] sendClueRequestToHost: Conditions not met. PVP: ${state.getPvpRemoteActive()}, IsLeader: ${currentRoomData.isRoomLeader}, GameActive: ${state.getGameActive()}`);
    }
}

function setupConnectionEventHandlers(conn) { // conn.peer is raw PeerJS ID
    console.log(`[PeerConn] Setting up event handlers for connection with PeerJS ID: ${conn.peer}. Reliable: ${conn.reliable}`);
    conn.on('open', () => peerJsCallbacks.onConnectionOpen(conn.peer));
    conn.on('data', (data) => peerJsCallbacks.onDataReceived(data, conn.peer));
    conn.on('close', () => peerJsCallbacks.onConnectionClose(conn.peer));
    conn.on('error', (err) => peerJsCallbacks.onError(err, conn.peer)); // Pass peerId for context
}

export function closePeerSession() {
    console.log("[PeerConn] closePeerSession called. Closing PeerJS session...");
    
    if (window.peerJsMultiplayer?.close) {
        window.peerJsMultiplayer.close(); // This handles destroying the peer object and closing connections
    } else {
        console.warn("[PeerConn] peerJsMultiplayer.close function not available.");
    }
    leaderConnection = null; // Clear any specific leader connection reference
    connections.clear();     // Clear map of client connections
    // state.setMyPeerId(null); // This will be set to null by peer.on('close') via peerJsMultiplayer.js
    console.log("[PeerConn] closePeerSession: PeerJS close requested. Local connection references cleared.");
}


// Ensure peerjs-multiplayer wrapper is loaded (simple check)
window.addEventListener('load', () => { // Use 'load' to ensure scripts are parsed
    let checkCount = 0;
    const maxChecks = 20; // Increased checks and interval
    const checkIntervalTime = 200;
    console.log("[PeerConn] Checking for peerjs-multiplayer.js wrapper presence...");
    const intervalId = setInterval(() => {
        if (window.peerJsMultiplayer && typeof window.peerJsMultiplayer.init === 'function') {
            clearInterval(intervalId);
            console.log("[PeerConn] peerjs-multiplayer.js wrapper found and seems ready.");
        } else {
            checkCount++;
            if (checkCount >= maxChecks) {
                clearInterval(intervalId);
                console.error("[PeerConn] CRITICAL: peerjs-multiplayer.js wrapper not found after multiple checks! Peer connections will fail.");
                // Optionally, display an error to the user here
                if(window.pizarraUiUpdateCallbacks?.showNetworkError) {
                    window.pizarraUiUpdateCallbacks.showNetworkError("Error Crítico: No se pudo cargar el componente de red principal (PJSMP).", true);
                }
            } else {
                 console.warn(`[PeerConn] peerjs-multiplayer.js wrapper not yet found (check ${checkCount}/${maxChecks}). Retrying...`);
            }
        }
    }, checkIntervalTime);
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    console.log("[PeerConn] beforeunload event triggered.");
    if (state.getPvpRemoteActive()) {
        console.log("[PeerConn] PVP mode active during unload. Attempting cleanup.");
        const currentRoomData = state.getNetworkRoomData();
        if (currentRoomData.isRoomLeader && currentRoomData.roomId) { // roomId is host's raw peerId
            if (matchmaking && matchmaking.leaveQueue) {
                console.log(`[PeerConn] Host (Room: ${currentRoomData.roomId}) leaving matchmaking queue due to page unload.`);
                // matchmaking.leaveQueue is not async here, but underlying might be.
                // This is best-effort.
                matchmaking.leaveQueue(currentRoomData.roomId); 
            }
        }
        // This will call peer.destroy() which attempts to close connections.
        // It's best-effort as the page is unloading.
        closePeerSession(); 
    }
});