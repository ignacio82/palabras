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
    ROOM_STATE_UPDATE: 'room_state_pizarra', // This might be superseded by 'state_sync' for full updates
    PLAYER_READY_CHANGED: 'ready_change_pizarra',
    GAME_STARTED: 'game_started_pizarra',
    LETTER_GUESS: 'letter_guess',
    GUESS_RESULT: 'guess_result',
    CLUE_REQUEST: 'req_clue_pizarra',
    CLUE_PROVIDED: 'clue_provided_pizarra',
    GAME_OVER_ANNOUNCEMENT: 'game_over_pizarra',
    ERROR_MESSAGE: 'error_message_pizarra',
    // --- PATCH: Consider adding STATE_SYNC if it becomes a formal type ---
    // STATE_SYNC: 'state_sync_pizarra', // For now, using the string 'state_sync' as per patch
};

const peerJsCallbacks = {
    onPeerOpen: (id) => {
        console.log(`[PizarraPeerConn] My PeerJS ID: ${id}.`);
        state.setMyPeerId(id);
        
        const currentRoomData = state.getNetworkRoomData(); // Uses getter which returns sanitized copy
        
        // Need to access the internal _peerInitResolve/Reject from the module's networkRoomData
        // This part of state access might need refinement if these callbacks are stored in the sanitized copy
        // For now, assuming getNetworkRoomData() was intended to provide these if they exist.
        // A better approach: state module manages these promises internally or provides dedicated functions.
        // Let's assume state.getNetworkRoomData() temporarily holds these for setup.
        const setupState = state.getRawNetworkRoomData(); // Get raw for internal callbacks

        if (setupState._peerInitResolve) {
            setupState._peerInitResolve(id);
            state.setNetworkRoomData({ _peerInitResolve: null, _peerInitReject: null }); // Clear them
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
        setupConnectionEventHandlers(conn); // This now also calls pizarraNetHandlers.attach(conn)
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
        // Note: pizarraNetHandlers.attach(conn) also sets up a 'data' listener on the connection.
        // This global onDataReceived might conflict or be redundant for messages handled by pizarraNetHandlers.
        // For 'state_sync', it will be handled by the listener in pizarraNetHandlers.attach.
        // This current onDataReceived should handle other game-specific messages.
        // The `pizarraNetHandlers.attach` adds its own 'data' listener. This one will also fire.
        // This needs careful management to avoid double processing.
        // Let's assume 'state_sync' is exclusively handled by pizarraNetHandlers.
        if (data?.type === 'state_sync') {
            // console.log(`[PizarraPeerConn] state_sync received, handled by netHandler's listener for ${fromPeerId}`);
            return; // Let pizarraNetHandlers.attach's listener handle it.
        }

        const currentRoomData = state.getNetworkRoomData();
        const currentIsLeader = currentRoomData.isRoomLeader;
        const logPrefix = currentIsLeader ? "[PizarraPeerConn L RX]" : "[PizarraPeerConn C RX]";
        console.log(`${logPrefix} From ${fromPeerId}: Type: ${data.type}`); // Keep logging other types
        
        if (currentIsLeader) handleLeaderDataReception(data, fromPeerId);
        else handleClientDataReception(data, fromPeerId);
    },
    
    onConnectionClose: (peerId) => {
        console.log(`[PizarraPeerConn] Connection closed with ${peerId}.`);
        const currentRoomData = state.getNetworkRoomData(); // This is sanitized
        const rawRoomDataForHost = state.getRawNetworkRoomData(); // For host to modify its actual player list
        
        if (rawRoomDataForHost.isRoomLeader) {
            const leavingPlayerEntry = connections.get(peerId);
            if (leavingPlayerEntry) { 
                const leavingPlayer = rawRoomDataForHost.players.find(p => p.id === leavingPlayerEntry.playerGameId && p.peerId === peerId);
                state.removePlayerFromNetworkRoom(peerId); // Updates the state module's internal networkRoomData.players
                connections.delete(peerId);
                if (leavingPlayer) {
                    broadcastToRoom({ type: MSG_TYPE.PLAYER_LEFT, player: { id: leavingPlayer.id, name: leavingPlayer.name, peerId: peerId } });
                }
                // --- PATCH: Broadcast full state after a player leaves ---
                pizarraNetHandlers.broadcastState(connections);
                // --- END PATCH ---
                if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();

                // Check current players from the updated state for game over condition
                const updatedPlayersList = state.getNetworkRoomData().players;
                if (state.getGamePhase() === 'playing' && updatedPlayersList.length < state.MIN_PLAYERS_NETWORK) {
                    const gameOverReason = 'disconnect_insufficient_players';
                    broadcastToRoom({ type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, reason: gameOverReason, finalWord: state.getCurrentWordObject()?.word });
                    state.setNetworkRoomData({ roomState: 'game_over' }); // Update state
                    if(window.pizarraUiUpdateCallbacks?.showNetworkGameOver) window.pizarraUiUpdateCallbacks.showNetworkGameOver({reason: gameOverReason, finalWord: state.getCurrentWordObject()?.word});
                }
            }
        } else { 
            if (peerId === currentRoomData.leaderPeerId) { // currentRoomData here is fine as leaderPeerId is stable
                console.error("[PizarraPeerConn] Client: Connection to leader lost!");
                const setupState = state.getRawNetworkRoomData(); // For _setupErrorCallback
                if (setupState._setupErrorCallback) {
                    setupState._setupErrorCallback(new Error("Conexión con el líder perdida."));
                } else if(window.pizarraUiUpdateCallbacks?.showNetworkError) {
                    window.pizarraUiUpdateCallbacks.showNetworkError("Se perdió la conexión con el líder de la sala.", true);
                }
                state.resetFullLocalStateForNewUIScreen(); // This calls peerConnection.closeAllConnectionsAndSession internally
            }
        }
    },
    
    onError: (err) => {
        console.error(`[PizarraPeerConn] PeerJS Error: ${err.type}`, err.message || err);
        const setupState = state.getRawNetworkRoomData(); // For setup callbacks
        
        if (setupState._peerInitReject) {
            setupState._peerInitReject(err);
            state.setNetworkRoomData({ _peerInitResolve: null, _peerInitReject: null });
        }
        
        if (setupState._setupErrorCallback) {
            setupState._setupErrorCallback(err);
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        } else if (window.pizarraUiUpdateCallbacks?.showNetworkError && err.type !== 'peer-unavailable'){ // Don't show modal for every peer-unavailable if host is just not there
            // window.pizarraUiUpdateCallbacks.showNetworkError(`Error de Red: ${err.message || err.type}`, true);
            // This can be noisy, consider logging only for certain error types for modals.
        }
    }
};

function _finalizeHostSetup(hostPeerId) {
    const setupState = state.getRawNetworkRoomData();
    if (!setupState._setupCompleteCallback) return;
    
    // Update the actual state object
    state.setNetworkRoomData({
        roomId: hostPeerId, 
        leaderPeerId: hostPeerId,
        players: setupState.players.map(p => p.id === 0 ? { ...p, peerId: hostPeerId, isConnected: true, isReady: true } : p), // Ensure host player has peerId
        roomState: 'lobby' // Transition to lobby state
    });
    
    setupState._setupCompleteCallback(hostPeerId); // Call the original promise resolver
    state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null }); // Clear callbacks
}

function _finalizeClientJoinAttempt(myPeerId, leaderPeerIdToJoin) {
    const setupState = state.getRawNetworkRoomData();
    if (!setupState._setupCompleteCallback && !setupState._setupErrorCallback) return;
    
    if (!setupState.isRoomLeader && leaderPeerIdToJoin && state.getPvpRemoteActive()) {
        const myInitialData = state.getLocalPlayerCustomizationForNetwork();
        // Set own player data in state temporarily before join confirmation
        state.setNetworkRoomData({ 
            players: [{ ...myInitialData, peerId: myPeerId, id: null, isReady: false, isConnected: false }] // id will be assigned by host
        });
        
        if (window.peerJsMultiplayer?.connect) {
            const connToLeader = window.peerJsMultiplayer.connect(leaderPeerIdToJoin);
            if (connToLeader) { 
                leaderConnection = connToLeader; 
                // Event handlers including pizarraNetHandlers.attach will be set up once conn is established
                // by the generic setupConnectionEventHandlers call made through peerJsMultiplayer's internal flow
            } else {
                // This path (connect returning null immediately) is less common with PeerJS v1+
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
        
        const setupState = state.getRawNetworkRoomData(); // Use raw for setup callbacks
        if (setupState._setupCompleteCallback) { // If a setup process is waiting for peer init
            if (setupState.isRoomLeader) _finalizeHostSetup(currentPeerId);
            else if (setupState.leaderPeerId) _finalizeClientJoinAttempt(currentPeerId, setupState.leaderPeerId);
        }
        return currentPeerId;
    }
    
    const setupState = state.getRawNetworkRoomData();
    if (setupState._peerInitPromise) return setupState._peerInitPromise; // Return existing promise if init already in progress
    
    const initPromise = new Promise((resolve, reject) => {
        // Store resolve/reject on the actual state object, not a copy
        state.setNetworkRoomData({ _peerInitResolve: resolve, _peerInitReject: reject });

        // --- PATCH: Initialize PeerJS with specific options ---
        const peerJSOptions = {
            // peerId: null, // Let PeerJS assign ID by default
            host: 'palabras.martinez.fyi',
            port: 443,
            secure: true,
            path: '/peerjs',
            debug: 2 // 0: none, 1: errors, 2: warnings/info, 3: verbose
        };
        // --- END PATCH ---

        if (window.peerJsMultiplayer?.init) {
            window.peerJsMultiplayer.init(peerJSOptions, peerJsCallbacks); // Pass options
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
        state.setNetworkRoomData({ _peerInitPromise: null }); // Clear promise after resolution
        return newPeerId; 
    } catch (err) { 
        state.setNetworkRoomData({ _peerInitPromise: null }); // Clear promise on error
        throw err; 
    }
}

export function hostNewRoom(hostPlayerData, gameSettingsFromUI) {
    state.resetFullLocalStateForNewUIScreen(); 
    state.setPvpRemoteActive(true);
    
    return new Promise(async (resolve, reject) => {
        // Store callbacks directly in the state module's networkRoomData
        state.setNetworkRoomData({
            isRoomLeader: true, 
            myPlayerIdInRoom: 0, // Host is player 0
            gameSettings: { difficulty: gameSettingsFromUI.difficulty || "easy" },
            maxPlayers: parseInt(gameSettingsFromUI.maxPlayers) || state.MAX_PLAYERS_NETWORK,
            // Host player data, peerId will be filled once peer is open
            players: [{ id: 0, peerId: null, name: hostPlayerData.name, icon: hostPlayerData.icon, color: hostPlayerData.color, isReady: true, isConnected: true, score: 0 }],
            roomState: 'creating_room', 
            _setupCompleteCallback: resolve, 
            _setupErrorCallback: reject
        });
        
        try { 
            await ensurePeerInitialized(); 
            // _finalizeHostSetup will be called via onPeerOpen if _setupCompleteCallback is set
        } catch (err) { 
            const currentSetupState = state.getRawNetworkRoomData();
            // Check if the reject callback we stored is the one for this promise
            if(currentSetupState._setupErrorCallback === reject) {
                reject(err); 
            }
            // Clear callbacks if they were for this operation
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        }
    });
}

export function joinRoomById(leaderRawPeerId, joinerPlayerData) {
    state.resetFullLocalStateForNewUIScreen(); 
    state.setPvpRemoteActive(true);
    
    // Store callbacks for this specific join attempt
    return new Promise(async (resolve, reject) => {
        state.setNetworkRoomData({ 
            isRoomLeader: false, 
            roomId: leaderRawPeerId, // Store the raw ID, will be prefixed by display elements
            leaderPeerId: leaderRawPeerId, // Store raw for connection
            // Temporary player data, will be updated upon JOIN_ACCEPTED
            players: [{ name: joinerPlayerData.name, icon: joinerPlayerData.icon, color: joinerPlayerData.color, peerId: null }],
            roomState: 'connecting_to_lobby',
            _setupCompleteCallback: resolve, 
            _setupErrorCallback: reject
        });
        
        try { 
            await ensurePeerInitialized(); 
            // _finalizeClientJoinAttempt will be called via onPeerOpen if _setupCompleteCallback is set
        } catch (err) { 
            const currentSetupState = state.getRawNetworkRoomData();
            if(currentSetupState._setupErrorCallback === reject) {
                 reject(err);
            }
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        }
    });
}

function setupConnectionEventHandlers(conn) { // conn is PeerJS DataConnection
    conn.on('open', () => peerJsCallbacks.onConnectionOpen(conn.peer));
    
    // Data reception is now two-fold:
    // 1. pizarraNetHandlers for 'state_sync'
    // 2. peerJsCallbacks.onDataReceived for other game messages
    // The peerJsCallbacks.onDataReceived will check type and ignore 'state_sync'
    conn.on('data', (data) => peerJsCallbacks.onDataReceived(data, conn.peer));
    
    conn.on('close', () => peerJsCallbacks.onConnectionClose(conn.peer));
    conn.on('error', (err) => peerJsCallbacks.onError({ ...err, peer: conn.peer })); // Add peer info to error

    // --- PATCH: Attach pizarraNetHandlers data listener ---
    pizarraNetHandlers.attach(conn);
    // --- END PATCH ---
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
    const currentRoomData = state.getNetworkRoomData(); // Sanitized, but isRoomLeader is fine
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

// This function might be replaced or supplemented by the new 'state_sync' mechanism.
// For now, it remains for specific room updates if needed.
export function broadcastRoomState() { 
    const currentRoomData = state.getNetworkRoomData();
    if (!currentRoomData.isRoomLeader) return;
    
    // Send a minimal update, full sync is handled by pizarraNetHandlers.broadcastState
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
    if (connEntry) { // connEntry might still be null for a late REQUEST_JOIN_ROOM if something went wrong
        playerGameId = connEntry.playerGameId;
        if (data.type !== MSG_TYPE.REQUEST_JOIN_ROOM && playerGameId === -1) { // Check if player fully joined
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

            const currentHostState = state.getRawNetworkRoomData(); // Use raw data for host logic
            const existingPlayer = currentHostState.players.find(p => p.peerId === fromPeerId);
            
            if (existingPlayer && existingPlayer.id !== null) { // Player already exists and has an ID
                console.warn(`[PizarraPeerConn L] Player ${fromPeerId} (ID ${existingPlayer.id}) sent REQUEST_JOIN_ROOM again. Resending JOIN_ACCEPTED.`);
                // Ensure their connection status is updated if they reconnected
                if (!existingPlayer.isConnected) {
                    state.updatePlayerInNetworkRoom(fromPeerId, { isConnected: true });
                     // No need to broadcast PLAYER_JOINED, full state sync will handle it.
                }
                sendDataToClient(fromPeerId, { 
                    type: MSG_TYPE.JOIN_ACCEPTED, 
                    yourPlayerIdInRoom: existingPlayer.id, 
                    roomData: state.getSanitizedNetworkRoomDataForClient() // Send current sanitized state
                });
                // --- PATCH: Broadcast full state after re-accepting a player ---
                pizarraNetHandlers.broadcastState(connections);
                // --- END PATCH ---
                return; 
            }

            if (currentHostState.players.length >= currentHostState.maxPlayers) {
                sendDataToClient(fromPeerId, { type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' }); 
                clientConnObjForJoin.close(); // Close connection if room is full
                return;
            }
            
            let newPlayerAssignedId = 0;
            const existingGameIds = new Set(currentHostState.players.map(p => p.id));
            while(existingGameIds.has(newPlayerAssignedId)) { newPlayerAssignedId++; }

            const newPlayer = { 
                id: newPlayerAssignedId, 
                peerId: fromPeerId, 
                ...data.playerData, // name, icon, color from client
                isReady: false, 
                isConnected: true, 
                score: 0 
            };
            state.addPlayerToNetworkRoom(newPlayer); // Add to state module

            // Update or set the connection entry
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
                roomData: state.getSanitizedNetworkRoomDataForClient() // Send current sanitized state
            });
            // PLAYER_JOINED broadcast is handled by state_sync
            // --- PATCH: Broadcast full state after a new player joins ---
            pizarraNetHandlers.broadcastState(connections);
            // --- END PATCH ---
            if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby(); // For host UI
            break;
            
        case MSG_TYPE.PLAYER_READY_CHANGED:
            state.updatePlayerInNetworkRoom(fromPeerId, { isReady: data.isReady });
            // PLAYER_READY_CHANGED broadcast is handled by state_sync
            // --- PATCH: Broadcast full state after ready change ---
            pizarraNetHandlers.broadcastState(connections);
            // --- END PATCH ---
            if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby(); // For host UI
            break;

        case MSG_TYPE.LETTER_GUESS:
            if (playerGameId === state.getCurrentPlayerId() && state.getGameActive()) {
                const result = logic.processGuess(data.letter); 
                
                // Update score in state for the guessing player
                const hostGameState = state.getRawNetworkRoomData();
                const guessingPlayerInState = hostGameState.players.find(p => p.id === playerGameId);
                const gameLogicPlayer = state.getPlayersData().find(p => p.id === playerGameId); // gameLogic updates this
                if (guessingPlayerInState && gameLogicPlayer) { 
                    guessingPlayerInState.score = gameLogicPlayer.score; // Sync score to networkRoomData.players
                    state.setNetworkRoomData({ players: [...hostGameState.players] }); // Trigger state update
                }
                
                // Send specific guess result for immediate feedback (optional if state_sync is fast enough)
                const guessResultPayload = { type: MSG_TYPE.GUESS_RESULT, ...result, letter: data.letter.toUpperCase() };
                broadcastToRoom(guessResultPayload); 
                
                // --- PATCH: Broadcast full state after a guess ---
                pizarraNetHandlers.broadcastState(connections);
                // --- END PATCH ---

                if (result.gameOver) {
                    state.setNetworkRoomData({ roomState: 'game_over' }); // Update host state
                    const winnerData = logic.getWinnerData(state); 
                    const finalWord = state.getCurrentWordObject()?.word;
                    broadcastToRoom({ 
                        type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, 
                        winnerData: winnerData, 
                        finalScores: state.getPlayersData().map(p=>({id:p.id, score:p.score})),
                        finalWord: finalWord
                    });
                    // No need for another state_sync here, GAME_OVER_ANNOUNCEMENT is terminal.
                }
            }
            break;

        case MSG_TYPE.CLUE_REQUEST:
            if (state.getGameActive() && !state.getClueUsedThisGame()) { 
                const clueResult = logic.requestClue(state); // Updates host's state (clueUsed, possibly attempts)
                if (clueResult.success) {
                    // Send CLUE_PROVIDED for immediate clue display
                    broadcastToRoom({ 
                        type: MSG_TYPE.CLUE_PROVIDED, 
                        clue: clueResult.clue, 
                        clueUsed: state.getClueUsedThisGame(), 
                        // Send updated attempts if clue has a cost and logic.requestClue handles it
                        remainingAttemptsPerPlayer: state.getRemainingAttemptsPerPlayer() 
                    });
                    // --- PATCH: Broadcast full state after clue request ---
                    pizarraNetHandlers.broadcastState(connections);
                    // --- END PATCH ---
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
    const currentClientState = state.getNetworkRoomData(); // Sanitized is fine for client logic checks
    if (fromLeaderPeerId !== currentClientState.leaderPeerId) {
        console.warn(`[PizarraPeerConn C] Data from non-leader ${fromLeaderPeerId}. Expected ${currentClientState.leaderPeerId}. Ignored.`, data); 
        return;
    }
    
    switch (data.type) {
        // --- PATCH: Handle 'state_sync' via pizarraNetHandlers.attach ---
        // 'state_sync' is now handled by the listener in pizarraNetHandlers.attach,
        // which calls state.setNetworkRoomData() and then the UI update callback.
        // So, no explicit case here is needed if that flow is complete.
        // However, if we want to log it or do other specific client actions ONLY on state_sync:
        /*
        case 'state_sync': // Assuming 'state_sync' is the string type
            // State is already updated by pizarraNetHandlers.attach's listener
            console.log("[PizarraPeerConn C] Received state_sync. UI update should follow via callback.");
            // UI update is triggered by window.pizarraUiUpdateCallbacks.syncGameUIFromNetworkState
            // which is called after state.setNetworkRoomData in the attach handler.
            break; 
        */
        
        case MSG_TYPE.JOIN_ACCEPTED:
            // const clientIsLeaderWas = false; // Redundant, set by setNetworkRoomData
            // const clientMyPeerIdWas = state.getMyPeerId(); // Redundant
            // const clientRoomIdWas = currentClientState.roomId; // Redundant
            // const clientLeaderPeerIdWas = currentClientState.leaderPeerId; //Redundant

            // data.roomData is the new source of truth for room state
            state.setNetworkRoomData({
                ...data.roomData, // This is the full state from host (sanitized for client)
                // Crucially, keep client-specific identifiers that aren't in roomData from host
                isRoomLeader: false, // Explicitly set client as not leader
                myPeerId: state.getMyPeerId(), // Keep my own peerId           
                myPlayerIdInRoom: data.yourPlayerIdInRoom, 
                leaderPeerId: currentClientState.leaderPeerId, // Keep the leader's ID
                roomId: currentClientState.roomId, // Keep the room ID
                roomState: data.roomData.roomState || 'lobby' // Ensure roomState is updated
            });
            
            const setupState = state.getRawNetworkRoomData(); // For callbacks
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
            state.resetFullLocalStateForNewUIScreen(); // This will close connections
            break;
        
        // PLAYER_JOINED, PLAYER_LEFT, ROOM_STATE_UPDATE, PLAYER_READY_CHANGED
        // are now largely handled by the full 'state_sync' if it's sent frequently.
        // If 'state_sync' isn't sent for these minor updates, these handlers remain useful.
        // For a robust 'Cajitas' model, these might become less critical if state_sync is the norm.
        case MSG_TYPE.PLAYER_JOINED: // Incremental update, state_sync is preferred for full consistency
             if (data.player.peerId !== state.getMyPeerId()) state.addPlayerToNetworkRoom(data.player);
             if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;
            
        case MSG_TYPE.PLAYER_LEFT: // Incremental update
            state.removePlayerFromNetworkRoom(data.player.peerId);
            if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;
            
        case MSG_TYPE.ROOM_STATE_UPDATE: // Incremental update
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
            
        case MSG_TYPE.PLAYER_READY_CHANGED: // Incremental update
            // Find player by ID from message, update their ready status in local state.
            const rawClientState = state.getRawNetworkRoomData();
            const playerToUpdateIdx = rawClientState.players.findIndex(p=>p.id === data.player.id);
            if(playerToUpdateIdx !== -1) {
                rawClientState.players[playerToUpdateIdx].isReady = data.player.isReady;
                state.setNetworkRoomData({ players: [...rawClientState.players] }); // Trigger update
            }
            if(window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
            break;
            
        case MSG_TYPE.GAME_STARTED:
            // This message contains the complete initial game state.
            // It's more comprehensive than a simple state_sync for starting the game.
            // Update state based on this initial game state.
            state.setPlayersData(data.initialGameState.playersInGameOrder);
            state.setRemainingAttemptsPerPlayer(data.initialGameState.remainingAttemptsPerPlayer);
            state.setCurrentWordObject(data.initialGameState.currentWordObject);
            state.setGuessedLetters(new Set(data.initialGameState.guessedLetters || []));
            state.setCurrentPlayerId(data.initialGameState.startingPlayerId);
            state.setClueUsedThisGame(data.initialGameState.clueUsed || false);
            state.setCurrentDifficulty(data.initialGameState.gameSettings.difficulty);
            state.setGameActive(true);
            state.setGamePhase('playing'); // Ensure phase is correct
             state.setNetworkRoomData({ // Sync relevant parts of networkRoomData too
                gameSettings: data.initialGameState.gameSettings,
                players: data.initialGameState.playersInGameOrder.map(p => ({ // map to network player structure
                    id: p.id,
                    peerId: p.peerId, // Ensure peerId is mapped if available in initialGameState
                    name: p.name,
                    icon: p.icon,
                    color: p.color,
                    isReady: true, // Assume ready if game started
                    isConnected: true, // Assume connected
                    score: p.score
                })),
                roomState: 'playing'
            });

            if(window.pizarraUiUpdateCallbacks?.startGameOnNetwork) window.pizarraUiUpdateCallbacks.startGameOnNetwork(data.initialGameState);
            break;
            
        case MSG_TYPE.GUESS_RESULT:
            // This provides immediate feedback on a guess.
            // State (guessedLetters, attempts, currentPlayerId, scores) should be updated based on this.
            // This might be partially redundant if a state_sync follows immediately, but good for responsiveness.
            state.setGuessedLetters(new Set(data.letter && data.correct ? 
                [...state.getGuessedLetters(), data.letter.toLowerCase()] : 
                (data.guessedLetters ? data.guessedLetters.map(l => l.toLowerCase()) : state.getGuessedLetters())
            ));
            if(data.remainingAttemptsPerPlayer) state.setRemainingAttemptsPerPlayer(data.remainingAttemptsPerPlayer);
            if(data.nextPlayerId !== undefined) state.setCurrentPlayerId(data.nextPlayerId);
            
            if (data.affectedPlayerId !== undefined && data.letter) {
                 const playerMakingGuess = state.getPlayersData().find(p => p.id === data.affectedPlayerId);
                 if (playerMakingGuess && !data.correct) {
                    // This attempts logic is tricky if host is authoritative.
                    // decAttemptsFor(data.affectedPlayerId) should ideally only happen on host.
                    // Client relies on remainingAttemptsPerPlayer from host.
                 }
            }
            
            // Update scores if provided
            if (data.scores) { // Assuming scores is an array of {id, score}
                const currentPlayers = state.getPlayersData();
                const networkPlayers = state.getRawNetworkRoomData().players;
                data.scores.forEach(ps => {
                    const pLocalGame = currentPlayers.find(p => p.id === ps.id);
                    if (pLocalGame) pLocalGame.score = ps.score;
                    const pNetwork = networkPlayers.find(p => p.id === ps.id);
                    if (pNetwork) pNetwork.score = ps.score;
                 });
                state.setPlayersData([...currentPlayers]); // Update game instance players
                state.setNetworkRoomData({ players: [...networkPlayers] }); // Update network room players
            }
            // Game active status is critical
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
            if (data.finalWord && !state.getCurrentWordObject()?.word) { // If word wasn't known
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
    const currentRoomData = state.getNetworkRoomData(); // Sanitized is fine for this check
    const myData = currentRoomData.players.find(p => p.peerId === state.getMyPeerId());
    if (!myData) return;
    
    if (currentRoomData.isRoomLeader) {
        // Host updates its own state directly and then broadcasts
        state.updatePlayerInNetworkRoom(state.getMyPeerId(), { isReady });
        pizarraNetHandlers.broadcastState(connections); // Broadcast full state
        if (window.pizarraUiUpdateCallbacks?.updateLobby) window.pizarraUiUpdateCallbacks.updateLobby();
    } else {
        // Client sends message to host
        sendDataToLeader({ type: MSG_TYPE.PLAYER_READY_CHANGED, playerId: currentRoomData.myPlayerIdInRoom, isReady: isReady });
    }
}

export function leaderStartGameRequest() {
    const currentRoomData = state.getRawNetworkRoomData(); // Host needs raw data to check players
    if (!currentRoomData.isRoomLeader || currentRoomData.roomState !== 'lobby') return;
    
    const allReady = currentRoomData.players.length >= state.MIN_PLAYERS_NETWORK &&
                     currentRoomData.players.every(p => p.isReady && p.isConnected !== false); // isConnected check
    if (!allReady) {
        if(window.pizarraUiUpdateCallbacks?.showNetworkError) window.pizarraUiUpdateCallbacks.showNetworkError("No todos los jugadores están listos o conectados.", false);
        return;
    }
    
    state.setNetworkRoomData({ roomState: 'in_game' }); // Update shared state
    state.setCurrentDifficulty(currentRoomData.gameSettings.difficulty); 
    // Initialize game logic using the main state module (passed by reference to logic functions)
    const gameInitResult = logic.initializeGame(state, currentRoomData.gameSettings.difficulty); 
    
    if (!gameInitResult.success || !state.getCurrentWordObject()) { // Check state after init
        // broadcastToRoom({ type: MSG_TYPE.ERROR_MESSAGE, message: "Host failed to start game: No word selected."});
        state.setNetworkRoomData({ roomState: 'lobby' }); // Revert state
        pizarraNetHandlers.broadcastState(connections); // Sync reverted state
        if(window.pizarraUiUpdateCallbacks?.showNetworkError) window.pizarraUiUpdateCallbacks.showNetworkError("Error del Host al iniciar: No se pudo seleccionar palabra.", false);
        return;
    }
    
    // Players data for the game instance is now set by logic.initializeGame based on networkRoomData.players
    // Ensure scores are reset for the new game for all players in networkRoomData
    currentRoomData.players.forEach(p => p.score = 0);
    state.setPlayersData(currentRoomData.players.map(p => ({ // Map to game player structure for gameLogic
        id: p.id, name: p.name, icon: p.icon, color: p.color, score: 0, peerId: p.peerId
    })).sort((a,b) => a.id - b.id)); // This sets localPlayersData in state
    
    state.setCurrentPlayerId(state.getPlayersData()[0].id); // Set current player from the sorted list
    
    // Prepare the initial game state payload for clients
    const initialGameState = {
        gameSettings: currentRoomData.gameSettings, 
        currentWordObject: state.getCurrentWordObject(), // From state after logic.initializeGame
        guessedLetters: Array.from(state.getGuessedLetters()), 
        remainingAttemptsPerPlayer: state.getRemainingAttemptsPerPlayer(), // From state
        playersInGameOrder: state.getPlayersData(), // Synced players data
        startingPlayerId: state.getCurrentPlayerId(), // From state
        clueUsed: state.getClueUsedThisGame(), 
        maxAttempts: state.MAX_ATTEMPTS // Constant
    };
    
    broadcastToRoom({ type: MSG_TYPE.GAME_STARTED, initialGameState });
    // Host also needs to update its own UI for game start
    if(window.pizarraUiUpdateCallbacks?.startGameOnNetwork) window.pizarraUiUpdateCallbacks.startGameOnNetwork(initialGameState);
    // A full state sync might be beneficial here too, or GAME_STARTED is considered a full sync for game start
    pizarraNetHandlers.broadcastState(connections);
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
    const currentRoomData = state.getRawNetworkRoomData(); // Use raw for host actions
    if (currentRoomData.isRoomLeader) {
        if (connections.size > 0) { // Only broadcast if there were connections
            broadcastToRoom({type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, reason: 'host_closed_room'});
        }
        connections.forEach(connEntry => connEntry.connObject?.close());
        connections.clear();
    } else if (leaderConnection) {
        leaderConnection.close();
        leaderConnection = null;
    }
    if (window.peerJsMultiplayer) window.peerJsMultiplayer.close(); // This destroys the peer object
    state.setMyPeerId(null); // Clear peer ID state
}

if (typeof window !== 'undefined' && !window.peerJsMultiplayer) {
    console.error("pizarraPeerConnection.js: peerjs-multiplayer.js wrapper not found on window object! Load it first.");
}