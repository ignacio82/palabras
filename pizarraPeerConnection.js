// pizarraPeerConnection.js

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
    PLAYER_JOINED: 'player_joined_pizarra',
    PLAYER_LEFT: 'player_left_pizarra',
    ROOM_STATE_UPDATE: 'room_state_pizarra',
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

function onDataReceived(data, fromPeerId) {
    console.log(`[PeerConn RX] From ${fromPeerId}: Type: ${data?.type}, Payload:`, data);
    if (!data || !data.type) {
        console.warn(`[PeerConn RX] Received data with no type from ${fromPeerId}:`, data);
        return;
    }
    if (state.getRawNetworkRoomData().isRoomLeader) { 
        handleLeaderDataReception(data, fromPeerId);
    } else {
        handleClientDataReception(data, fromPeerId);
    }
}

function onConnectionClose(peerId) {
    console.log(`[PeerConn Event] Data connection with ${peerId} closed.`);
    const currentNetworkData = state.getRawNetworkRoomData(); 
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
                state.removePlayerFromNetworkRoom(peerId); 
                
                broadcastToRoom({ 
                    type: MSG_TYPE.PLAYER_LEFT, 
                    playerId: leavingPlayer.id, 
                    peerId: peerId, 
                    playerName: leavingPlayerName 
                });
                console.log(`[PeerConn Event] Host: Broadcasted PLAYER_LEFT for ${leavingPlayerName}.`);

                reassignPlayerIdsAndBroadcastUpdate(); 
                
                if (window.pizarraUiUpdateCallbacks?.updateLobby) {
                    window.pizarraUiUpdateCallbacks.updateLobby();
                }
                
                const updatedNetworkData = state.getRawNetworkRoomData();
                if (matchmaking && matchmaking.updateHostedRoomStatus) {
                    console.log(`[PeerConn Event] Host: Updating matchmaking status after player ${peerId} left.`);
                    matchmaking.updateHostedRoomStatus(
                        updatedNetworkData.roomId, 
                        updatedNetworkData.gameSettings, 
                        updatedNetworkData.maxPlayers, 
                        updatedNetworkData.players.filter(p => p.isConnected !== false).length
                    );
                }

                const activePlayers = updatedNetworkData.players.filter(p => p.isConnected !== false);
                if (updatedNetworkData.roomState === 'playing' && 
                    activePlayers.length < state.MIN_PLAYERS_NETWORK) {
                    console.warn(`[PeerConn Event] Host: Game was active, but insufficient players (${activePlayers.length}) after ${leavingPlayerName} left. Ending game.`);
                    if (window.pizarraUiUpdateCallbacks?.showModal) {
                        window.pizarraUiUpdateCallbacks.showModal(`Jugador ${leavingPlayerName} se desconectó. No hay suficientes jugadores para continuar la partida.`);
                    }
                    state.setGameActive(false); 
                    state.setNetworkRoomData({ roomState: 'game_over' }); 
                    const finalWord = state.getCurrentWordObject()?.word || "N/A"; 
                    broadcastToRoom({ 
                        type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, 
                        reason: 'disconnect_insufficient_players', 
                        finalWord: finalWord 
                    });
                    console.log(`[PeerConn Event] Host: Broadcasted GAME_OVER due to insufficient players.`);
                }
            } else {
                console.warn(`[PeerConn Event] Host: Connection closed for ${peerId}, but no matching player found in currentNetworkData.players. This might happen if player was already removed.`);
                reassignPlayerIdsAndBroadcastUpdate();
                if (matchmaking && matchmaking.updateHostedRoomStatus) {
                     const freshData = state.getRawNetworkRoomData();
                     matchmaking.updateHostedRoomStatus(
                        freshData.roomId, freshData.gameSettings, freshData.maxPlayers,
                        freshData.players.filter(p => p.isConnected !== false).length
                    );
                }
            }
        } else {
            console.warn(`[PeerConn Event] Host: Connection closed for ${peerId}, but no connection entry found.`);
        }
    } else { 
        if (peerId === currentNetworkData.leaderPeerId) {
            console.error("[PeerConn Event] Client: Connection to LEADER lost!");
            if (window.pizarraUiUpdateCallbacks?.showNetworkError) {
                window.pizarraUiUpdateCallbacks.showNetworkError("Se perdió la conexión con el líder de la sala.", true);
            }
            if (window.pizarraUiUpdateCallbacks?.handleCriticalDisconnect) {
                window.pizarraUiUpdateCallbacks.handleCriticalDisconnect();
            }
        } else {
            console.warn(`[PeerConn Event] Client: Connection to non-leader peer ${peerId} closed.`);
        }
    }
}

async function onError(err, peerIdContext = null) {
    console.error(`[PeerConn Error] (Context: ${peerIdContext || 'general'}): Type: ${err.type}, Msg: ${err.message || err}`, err);
    let displayMessage = err.message || (typeof err === 'string' ? err : 'Error de conexión desconocido.');
    const targetPeerForMsg = peerIdContext || state.getRawNetworkRoomData().leaderPeerId || (err.peer ? err.peer : null);

    if (err.type) {
        if (err.type === 'peer-unavailable' || err.type === 'unavailable-id') {
            displayMessage = `No se pudo conectar a: ${targetPeerForMsg ? PIZARRA_PEER_ID_PREFIX + targetPeerForMsg : 'remoto'}.`;
            const currentRoomData = state.getRawNetworkRoomData();
            if (!currentRoomData.isRoomLeader && targetPeerForMsg &&
                (currentRoomData.roomState === 'connecting_to_lobby' || 
                 currentRoomData.roomState === 'awaiting_join_approval') &&
                targetPeerForMsg === currentRoomData.leaderPeerId) {
                console.warn(`[PeerConn onError] Peer ${targetPeerForMsg} is unavailable. Attempting cleanup if matchmaking active.`);
                if (matchmaking && matchmaking.removeDeadRoomByPeerId) {
                    await matchmaking.removeDeadRoomByPeerId(targetPeerForMsg); 
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
        } else if (err.type === 'connection_error' || err.type === 'connection-error') { 
             displayMessage = `Error en la conexión con ${targetPeerForMsg ? PIZARRA_PEER_ID_PREFIX + targetPeerForMsg : 'el otro jugador'}.`;
        } else {
            displayMessage = `${err.type}: ${displayMessage}`;
        }
    }

    const peerInitReject = state.getInternalPeerInitReject();
    if (peerInitReject) {
        console.log("[PeerConn onError] Rejecting _peerInitPromise via getInternalPeerInitReject.");
        peerInitReject(new Error(displayMessage)); 
        state.setNetworkRoomData({ _peerInitResolve: null, _peerInitReject: null, _peerInitPromise: null }); 
    }
    
    const setupErrorCallback = state.getInternalSetupErrorCallback();
    if (setupErrorCallback) {
        console.log("[PeerConn onError] Calling _setupErrorCallback via getInternalSetupErrorCallback.");
        const errorForCallback = new Error(displayMessage);
        errorForCallback.type = err.type;
        errorForCallback.originalError = err;
        setupErrorCallback(errorForCallback);
        state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
    }

    const stillHasPeerInitReject = !!state.getInternalPeerInitReject(); 
    const stillHasSetupErrorCallback = !!state.getInternalSetupErrorCallback();

    if (!stillHasPeerInitReject && !stillHasSetupErrorCallback && window.pizarraUiUpdateCallbacks?.showNetworkError) {
        const isCriticalError = err.type === 'peer-unavailable' || err.type === 'server-error' || 
                                err.type === 'disconnected' || err.type === 'socket-closed' ||
                                (err.type === 'network' && !state.getRawNetworkRoomData().isRoomLeader); 
        window.pizarraUiUpdateCallbacks.showNetworkError(displayMessage, isCriticalError);
    }
}

const peerJsCallbacks = {
    onPeerOpen: (id) => { 
        console.log(`[PeerConn PeerJS] EVENT: peer.on('open'). My PeerJS ID: ${id}.`);
        const oldPeerId = state.getMyPeerId();
        state.setMyPeerId(id); 
        
        const peerInitResolve = state.getInternalPeerInitResolve();
        const setupCompleteCallback = state.getInternalSetupCompleteCallback();
        const rawStateData = state.getRawNetworkRoomData(); 

        console.log(`[PeerConn PeerJS] onPeerOpen: Current DataState check values: isRoomLeader=${rawStateData.isRoomLeader}, roomState='${rawStateData.roomState}', leaderPeerId='${rawStateData.leaderPeerId}', pvpRemoteActive=${state.getPvpRemoteActive()}, setupCompleteCallback_exists=${!!setupCompleteCallback}`);

        if (peerInitResolve) {
            console.log("[PeerConn PeerJS] Resolving _peerInitPromise (via getInternalPeerInitResolve) with ID:", id);
            peerInitResolve(id);
            state.setNetworkRoomData({ _peerInitResolve: null, _peerInitReject: null }); 
        }

        if (setupCompleteCallback) { 
            console.log("[PeerConn PeerJS] setupCompleteCallback (via getInternalSetupCompleteCallback) IS present. Determining host/client finalization path.");
            if (rawStateData.isRoomLeader && 
                (rawStateData.roomState === 'creating_room' || rawStateData.roomState === 'seeking_match')) {
                console.log("[PeerConn PeerJS] Conditions met for HOST setup. Calling _finalizeHostSetup.");
                _finalizeHostSetup(id); 
            } else if (!rawStateData.isRoomLeader && rawStateData.leaderPeerId && state.getPvpRemoteActive()) {
                console.log("[PeerConn PeerJS] Conditions met for CLIENT join. Calling _finalizeClientJoinAttempt.");
                _finalizeClientJoinAttempt(id, rawStateData.leaderPeerId); 
            } else {
                console.warn("[PeerConn PeerJS] setupCompleteCallback present, BUT conditions for host/client finalization NOT MET. Dumping relevant data state:", {
                    isRoomLeader: rawStateData.isRoomLeader,
                    roomState: rawStateData.roomState,
                    leaderPeerId: rawStateData.leaderPeerId,
                    isPvpRemoteActive: state.getPvpRemoteActive() 
                });
                const setupErrorCb = state.getInternalSetupErrorCallback();
                if (setupErrorCb) {
                    console.warn("[PeerConn PeerJS] Calling setupErrorCallback due to unmet finalization conditions.");
                    setupErrorCb(new Error("Error interno: Condiciones para finalizar la configuración de red no cumplidas después de abrir PeerJS."));
                    state.setNetworkRoomData({_setupCompleteCallback: null, _setupErrorCallback: null});
                }
            }
        } else if (!state.getPvpRemoteActive() && oldPeerId !== id) {
            console.log('[PeerConn PeerJS] PeerJS initialized/reconnected outside of active PvP mode (no setupCompleteCallback). New ID:', id);
        } else if (state.getPvpRemoteActive() && !setupCompleteCallback) {
            console.warn('[PeerConn PeerJS] PeerJS opened in PVP mode, but setupCompleteCallback was NOT present (checked via getInternal). This might indicate an issue or that the operation (host/join) was cancelled or completed differently. Data state:', rawStateData);
        }
    },

    onNewConnection: (conn) => { 
        console.log(`[PeerConn PeerJS] EVENT: peer.on('connection'). Incoming connection from PeerJS ID: ${conn.peer}. Metadata:`, conn.metadata);
        const currentNetworkData = state.getRawNetworkRoomData();
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
        connections.set(conn.peer, { 
            connObject: conn, 
            status: 'pending_join_request', 
            player: null, 
            playerGameId: -1 
        });
        setupConnectionEventHandlers(conn);
    },

    onConnectionOpen: (peerId) => { 
        console.log(`[PeerConn PeerJS] EVENT: conn.on('open'). Data connection open with PeerJS ID: ${peerId}.`);
        const currentNetworkData = state.getRawNetworkRoomData();
        
        if (currentNetworkData.isRoomLeader) {
            const connEntry = connections.get(peerId);
            if (connEntry && connEntry.status === 'pending_join_request') {
                connections.set(peerId, { ...connEntry, status: 'awaiting_join_request' });
                console.log(`[PeerConn PeerJS] Host: Connection with client ${peerId} fully open. Awaiting MSG_TYPE.REQUEST_JOIN_ROOM from them.`);
            } else if (connEntry && connEntry.status === 'active') {
                console.log(`[PeerConn PeerJS] Host: Re-established or already active connection opened with ${peerId}. Sending full game state.`);
                sendFullGameStateToClient(peerId); 
            } else if (!connEntry) {
                 console.warn(`[PeerConn PeerJS] Host: Connection opened with ${peerId}, but no prior connEntry. This might be a late/reconnect. Setting up new entry.`);
                const existingPlayer = currentNetworkData.players.find(p => p.peerId === peerId);
                const newConnObj = window.peerJsMultiplayer.getConnection(peerId);
                if (newConnObj) { 
                    connections.set(peerId, {
                        connObject: newConnObj,
                        status: existingPlayer ? 'active' : 'awaiting_join_request',
                        player: existingPlayer || null,
                        playerGameId: existingPlayer ? existingPlayer.id : -1
                    });
                    if (existingPlayer) {
                        sendFullGameStateToClient(peerId);
                    }
                } else {
                    console.error(`[PeerConn PeerJS] Host: Could not get connection object for ${peerId} on onConnectionOpen.`);
                }
            }
        } else { // Client logic
            if (peerId === currentNetworkData.leaderPeerId && leaderConnection && leaderConnection.open) {
                // Player data for join request should be fresh from UI
                const myPlayerDataForJoin = ui.getPlayerCustomizationDataFromUI(true, 
                    document.getElementById('modal-player-name-urljoin'), // Assuming these IDs are used in URL join modal
                    document.getElementById('modal-player-icon-urljoin')
                ) || state.getLocalPlayerCustomizationForNetwork(); // Fallback to general network setup inputs

                console.log(`[PeerConn PeerJS] Client: Fresh player data for join request:`, myPlayerDataForJoin);

                if (currentNetworkData.roomState === 'connecting_to_lobby' ||
                    (currentNetworkData.roomState === 'awaiting_join_approval' && 
                     state.getRawNetworkRoomData().myPlayerIdInRoom === null)) { 
                    console.log("[PeerConn PeerJS] Client: Connection to leader open. Sending MSG_TYPE.REQUEST_JOIN_ROOM.");
                    sendDataToLeader({
                        type: MSG_TYPE.REQUEST_JOIN_ROOM,
                        playerData: myPlayerDataForJoin
                    });
                    state.setNetworkRoomData({ roomState: 'awaiting_join_approval' });
                } else {
                     console.log(`[PeerConn PeerJS] Client: Connection to leader ${peerId} opened, but roomState is '${currentNetworkData.roomState}' or already joined (myPlayerIdInRoom: ${state.getRawNetworkRoomData().myPlayerIdInRoom}). Not sending JOIN_REQUEST now.`);
                }
            } else {
                console.warn(`[PeerConn PeerJS] Client: Connection opened with ${peerId}, but it's not the expected leader (${currentNetworkData.leaderPeerId}) or leaderConnection not ready/open (leaderConn open: ${leaderConnection?.open}).`);
            }
        }
    },
    onDataReceived,
    onConnectionClose,
    onError
};

function _finalizeHostSetup(myHostRawPeerId) {
  console.log(`[PeerConn] _finalizeHostSetup called for Host PeerJS ID: ${myHostRawPeerId}.`);
  const setupDone = state.getInternalSetupCompleteCallback();
  const setupError = state.getInternalSetupErrorCallback(); 

  if (!setupDone && !setupError) {
      console.warn(`[PeerConn] _finalizeHostSetup: Both setupDone and setupError callbacks are null. Setup might have already been finalized, aborted, or this is an unexpected call. Current state:`, state.getRawNetworkRoomData());
      return; 
  }

  const currentPlayers = state.getRawNetworkRoomData().players; 
  let updatedPlayersArray = currentPlayers ? [...currentPlayers] : []; 
  
  if (updatedPlayersArray.length > 0 && updatedPlayersArray[0]?.id === 0) { 
      updatedPlayersArray[0] = { ...updatedPlayersArray[0], peerId: myHostRawPeerId, isConnected: true };
  } else { 
      console.warn("[PeerConn] _finalizeHostSetup: Host player (ID 0) not found as first in players array or array empty. Creating/prepending host entry.", currentPlayers);
      const hostDataForPlayerArray = state.getLocalPlayerCustomizationForNetwork(); 
      const hostPlayerEntry = { ...hostDataForPlayerArray, peerId: myHostRawPeerId, id: 0, isConnected: true, isReady: true, score: 0 };
      const existingHostIndex = updatedPlayersArray.findIndex(p => p.id === 0);
      if (existingHostIndex !== -1) updatedPlayersArray[existingHostIndex] = hostPlayerEntry;
      else updatedPlayersArray.unshift(hostPlayerEntry);
  }
  
  state.setNetworkRoomData({
    roomId:       myHostRawPeerId,
    leaderPeerId: myHostRawPeerId,
    roomState:    'lobby',
    players:      updatedPlayersArray, 
    myPlayerIdInRoom: 0 
  });
  console.log(`[PeerConn] _finalizeHostSetup: Host state updated. Room ID: ${myHostRawPeerId}, State set to lobby. Players updated with host peerId.`);

  const currentLobbyState = state.getRawNetworkRoomData(); 
  if (window.pizarraUiUpdateCallbacks?.showLobby) {
      console.log("[PeerConn] _finalizeHostSetup: Calling window.pizarraUiUpdateCallbacks.showLobby(true).");
      window.pizarraUiUpdateCallbacks.showLobby(true, currentLobbyState); 
  } else {
      console.warn("[PeerConn] _finalizeHostSetup: window.pizarraUiUpdateCallbacks.showLobby not found!");
  }

  if (typeof setupDone === 'function') {
    console.log(`[PeerConn] _finalizeHostSetup: Calling setupDone callback with host PeerID: ${myHostRawPeerId}.`);
    setupDone(myHostRawPeerId);
  } else {
    console.warn(`[PeerConn] _finalizeHostSetup: setupDone callback was not a function or null. Promise from hostNewRoom might not resolve as expected. Callback was:`, setupDone);
  }
  state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
}

function _finalizeClientJoinAttempt(myRawPeerId, leaderRawPeerIdToJoin) {
  console.log(`[PeerConn] _finalizeClientJoinAttempt. My PeerJS ID: ${myRawPeerId}, Leader's PeerJS ID: ${leaderRawPeerIdToJoin}`);
  const setupDone = state.getInternalSetupCompleteCallback();
  const setupError = state.getInternalSetupErrorCallback();

  if (!setupDone && !setupError) {
      console.warn(`[PeerConn] _finalizeClientJoinAttempt: Both setupDone and setupError callbacks are null. Setup might have already been finalized or aborted.`);
  }

  const clientPlayersArray = state.getRawNetworkRoomData().players; 
  if (clientPlayersArray && clientPlayersArray.length > 0 && clientPlayersArray[0]) {
    if (clientPlayersArray[0].peerId !== myRawPeerId) { 
        const updatedPlayers = [...clientPlayersArray];
        updatedPlayers[0] = { ...updatedPlayers[0], peerId: myRawPeerId }; 
        state.setNetworkRoomData({ players: updatedPlayers });
        console.log("[PeerConn] _finalizeClientJoinAttempt: Client's own player data in state updated with their peerId:", myRawPeerId);
    }
  } else {
     console.warn("[PeerConn] _finalizeClientJoinAttempt: Client players array empty or invalid. Cannot set peerId for self.");
  }
  
  state.setPvpRemoteActive(true); 
  state.setNetworkRoomData({ leaderPeerId: leaderRawPeerIdToJoin, roomId: leaderRawPeerIdToJoin}); 

  console.log(`[PeerConn] _finalizeClientJoinAttempt: Attempting to connect to leader PeerJS ID: ${leaderRawPeerIdToJoin}`);
  const connToLeader = window.peerJsMultiplayer.connect(leaderRawPeerIdToJoin);

  if (connToLeader) {
      leaderConnection = connToLeader; 
      console.log(`[PeerConn] _finalizeClientJoinAttempt: peer.connect call successful for ${leaderRawPeerIdToJoin}. Waiting for connection 'open' event on this new connection.`);
      if (typeof setupDone === 'function') {
          console.log(`[PeerConn] _finalizeClientJoinAttempt: Calling setupDone callback with my PeerID: ${myRawPeerId}.`);
          setupDone(myRawPeerId); 
      }
      state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
  } else {
      const errorMsg = `No se pudo iniciar la conexión a la sala ${PIZARRA_PEER_ID_PREFIX}${leaderRawPeerIdToJoin}. La función de conexión (peer.connect) falló.`;
      console.error(`[PeerConn] _finalizeClientJoinAttempt: peer.connect() returned null for ${leaderRawPeerIdToJoin}.`);
      if (typeof setupError === 'function') {
          setupError(new Error(errorMsg));
      } else { 
          peerJsCallbacks.onError({ type: 'connect_failed', message: errorMsg }, leaderRawPeerIdToJoin);
      }
      state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
  }
}

function initPeerObject(peerIdToUse = null) { 
    console.log(`[PeerConn] initPeerObject called. Requested PeerJS ID to use: ${peerIdToUse || 'Auto-assigned'}.`);
    return new Promise((resolveIPO, rejectIPO) => { 
        if (!window.peerJsMultiplayer?.init) {
            const err = new Error('Error interno: El sistema de conexión (peerJsMultiplayer) no está disponible.');
            console.error("[PeerConn] initPeerObject:", err.message);
            rejectIPO(err);
            return;
        }
        console.log("[PeerConn] initPeerObject: Storing _peerInitResolve and _peerInitReject via setNetworkRoomData.");
        state.setNetworkRoomData({ 
            _peerInitResolve: resolveIPO, 
            _peerInitReject: rejectIPO 
        });
        console.log(`[PeerConn] initPeerObject: Calling peerJsMultiplayer.init with PeerJS ID: ${peerIdToUse || 'Auto-assigned'}.`);
        window.peerJsMultiplayer.init(peerIdToUse || {}, peerJsCallbacks); 
    });
}

export async function ensurePeerInitialized() {
    console.log("[PeerConn] ensurePeerInitialized called.");
    const existingPeer = window.peerJsMultiplayer?.getPeer();
    let currentLocalRawId = window.peerJsMultiplayer?.getLocalId(); 

    if (existingPeer && !existingPeer.destroyed && currentLocalRawId) {
        console.log(`[PeerConn] ensurePeerInitialized: Peer already exists, is not destroyed, and has ID: ${currentLocalRawId}.`);
        if (state.getMyPeerId() !== currentLocalRawId) { 
            console.log(`[PeerConn] ensurePeerInitialized: Aligning state.myPeerId with current local ID.`);
            state.setMyPeerId(currentLocalRawId);
        }
        const setupCompleteCb = state.getInternalSetupCompleteCallback(); 
        if (setupCompleteCb) { 
            console.log("[PeerConn] ensurePeerInitialized: Existing peer, AND an internal _setupCompleteCallback exists. Attempting to finalize pending operation.");
            const dataState = state.getRawNetworkRoomData(); 
            if (dataState.isRoomLeader && (dataState.roomState === 'creating_room' || dataState.roomState === 'seeking_match')) {
                console.log("[PeerConn] ensurePeerInitialized: Conditions suggest pending HOST setup. Calling _finalizeHostSetup.");
                _finalizeHostSetup(currentLocalRawId);
            } else if (!dataState.isRoomLeader && dataState.leaderPeerId && state.getPvpRemoteActive() && (dataState.roomState === 'connecting_to_lobby' || dataState.roomState === 'awaiting_join_approval')) {
                console.log("[PeerConn] ensurePeerInitialized: Conditions suggest pending CLIENT join. Calling _finalizeClientJoinAttempt.");
                _finalizeClientJoinAttempt(currentLocalRawId, dataState.leaderPeerId);
            } else {
                 console.log("[PeerConn] ensurePeerInitialized: Existing peer and _setupCompleteCallback, but conditions for finalization not met (or already finalized). State:", dataState);
            }
        }
        return currentLocalRawId; 
    }
    
    console.log("[PeerConn] ensurePeerInitialized: No valid existing peer or ID. Proceeding with initialization.");
    const existingPeerInitPromise = state.getInternalPeerInitPromise();
    if (existingPeerInitPromise) {
        console.log("[PeerConn] ensurePeerInitialized: Found existing _peerInitPromise (getInternal). Awaiting it.");
        try {
            const awaitedId = await existingPeerInitPromise;
            console.log("[PeerConn] ensurePeerInitialized: Existing _peerInitPromise resolved with ID:", awaitedId);
            return awaitedId; 
        } catch (error) {
            console.error("[PeerConn] ensurePeerInitialized: Error awaiting existing _peerInitPromise:", error);
            state.setNetworkRoomData({_peerInitPromise: null, _peerInitResolve: null, _peerInitReject: null}); 
            throw error; 
        }
    }

    console.log("[PeerConn] ensurePeerInitialized: Creating new initPromise.");
    const initPromise = initPeerObject(); 
    state.setNetworkRoomData({ _peerInitPromise: initPromise }); 

    try {
        const newRawPeerId = await initPromise; 
        console.log("[PeerConn] ensurePeerInitialized: New initPromise resolved. New PeerJS ID:", newRawPeerId);
        if (state.getInternalPeerInitPromise() === initPromise) { 
            state.setNetworkRoomData({ _peerInitPromise: null }); 
        }
        return newRawPeerId; 
    } catch (err) {
        console.error("[PeerConn] ensurePeerInitialized: Error awaiting new initPromise:", err);
        if (state.getInternalPeerInitPromise() === initPromise) {
            state.setNetworkRoomData({ _peerInitPromise: null, _peerInitResolve: null, _peerInitReject: null });
        }
        throw err; 
    }
}

export function hostNewRoom(hostPlayerData, gameSettingsFromUI) {
    console.log("[PeerConn] hostNewRoom called. Host Player Data:", hostPlayerData, "Game Settings:", gameSettingsFromUI);
    state.resetFullLocalStateForNewUIScreen(); 
    state.setPvpRemoteActive(true);
    console.log("[PeerConn] hostNewRoom: PVP mode activated, state reset.");

    return new Promise(async (resolve, reject) => {
        console.log("[PeerConn] hostNewRoom: Promise created. Setting initial network room data for host.");
        state.setNetworkRoomData({
            isRoomLeader: true,
            myPlayerIdInRoom: 0, 
            gameSettings: { difficulty: gameSettingsFromUI.difficulty || "easy" },
            maxPlayers: parseInt(gameSettingsFromUI.maxPlayers) || state.MAX_PLAYERS_NETWORK,
            players: [{ 
                id: 0,
                peerId: null, 
                name: hostPlayerData.name,
                icon: hostPlayerData.icon,
                color: hostPlayerData.color,
                isReady: true, 
                isConnected: true, 
                score: 0
            }],
            roomState: 'creating_room',
            _setupCompleteCallback: resolve, 
            _setupErrorCallback: reject    
        });
                
        try {
            console.log("[PeerConn] hostNewRoom: Calling ensurePeerInitialized.");
            const hostRawPeerId = await ensurePeerInitialized(); 
            console.log(`[PeerConn] hostNewRoom: ensurePeerInitialized successful (or was already initialized). Host raw PeerJS ID: ${hostRawPeerId}.`);
        } catch (err) {
            console.error("[PeerConn] hostNewRoom: Error during ensurePeerInitialized:", err);
            const setupErrorCb = state.getInternalSetupErrorCallback();
            if (setupErrorCb === reject) { 
                console.log("[PeerConn] hostNewRoom: onError or deeper logic likely handled the rejection via _setupErrorCallback.");
            } else if (reject) { 
                console.log("[PeerConn] hostNewRoom: Explicitly rejecting hostNewRoom promise due to error:", err.message);
                reject(err); 
            }
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        }
    });
}

export function joinRoomById(leaderRawPeerId, joinerPlayerData) { 
    console.log(`[PeerConn] joinRoomById called for leader's raw PeerJS ID: ${leaderRawPeerId}. Joiner Data:`, joinerPlayerData);
    state.resetFullLocalStateForNewUIScreen(); 
    state.setPvpRemoteActive(true);
    console.log("[PeerConn] joinRoomById: PVP mode activated, state reset.");

    return new Promise(async (resolve, reject) => {
        console.log("[PeerConn] joinRoomById: Promise created. Setting initial network room data for client.");
        state.setNetworkRoomData({
            isRoomLeader: false,
            roomId: leaderRawPeerId, 
            leaderPeerId: leaderRawPeerId, 
            players: [{ 
                name: joinerPlayerData.name,
                icon: joinerPlayerData.icon,
                color: joinerPlayerData.color,
                peerId: null, 
                id: null,     
                isReady: false,
                isConnected: false 
            }],
            roomState: 'connecting_to_lobby',
            _setupCompleteCallback: resolve, 
            _setupErrorCallback: reject    
        });
                
        try {
            console.log("[PeerConn] joinRoomById: Calling ensurePeerInitialized for client.");
            const myRawPeerId = await ensurePeerInitialized(); 
            console.log(`[PeerConn] joinRoomById: ensurePeerInitialized for client successful. My raw PeerJS ID: ${myRawPeerId}.`);
        } catch (err) {
            console.error("[PeerConn] joinRoomById: Error during ensurePeerInitialized for client:", err);
            const setupErrorCb = state.getInternalSetupErrorCallback();
            if (setupErrorCb === reject) {
                console.log("[PeerConn] joinRoomById: onError likely handled the rejection via _setupErrorCallback.");
            } else if (reject) {
                console.log("[PeerConn] joinRoomById: Explicitly rejecting promise due to error:", err.message);
                reject(err);
            }
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        }
    });
}

function handleLeaderDataReception(data, fromPeerId) { 
    console.log(`[PeerConn L RX] Leader received data from client ${fromPeerId}. Type: ${data.type}`);
    const connEntry = connections.get(fromPeerId);
    if (!connEntry && data.type !== MSG_TYPE.REQUEST_JOIN_ROOM) {
        console.warn(`[PeerConn L RX] Data from ${fromPeerId} (type ${data.type}) but no active connection entry and not a JOIN_REQUEST. Ignored.`);
        return;
    }
    
    const playerGameId = connEntry?.playerGameId; 
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
            handlePlayerReadyChanged(data, fromPeerId); 
            break;
        case MSG_TYPE.LETTER_GUESS: // This is when HOST receives a guess from a CLIENT
            console.log(`[PeerConn L RX] Handling LETTER_GUESS from client ${fromPeerId} (PlayerGameID: ${playerGameId}). Letter: ${data.letter}`);
            handleLetterGuess(data, fromPeerId, playerGameId);
            break;
        case MSG_TYPE.CLUE_REQUEST: // This is when HOST receives a clue request from a CLIENT
            console.log(`[PeerConn L RX] Handling CLUE_REQUEST from client ${fromPeerId} (PlayerGameID: ${playerGameId}).`);
            handleClueRequest(data, fromPeerId, playerGameId);
            break;
        default:
            console.warn(`[PeerConn L RX] Unhandled message type: ${data.type} from ${fromPeerId}`);
    }
}

function handleJoinRequest(data, fromPeerId, connEntry) { 
    console.log(`[PeerConn L] handleJoinRequest from PeerJS ID: ${fromPeerId}. Player data:`, data.playerData);
    const clientConnObjForJoin = connEntry?.connObject || window.peerJsMultiplayer.getConnection(fromPeerId);
    if (!clientConnObjForJoin || !clientConnObjForJoin.open) {
        console.warn(`[PeerConn L] REQUEST_JOIN_ROOM from ${fromPeerId} but connection object not found or not open. Conn Obj:`, clientConnObjForJoin);
        if (!window.peerJsMultiplayer.getConnection(fromPeerId)) {
            console.error(`[PeerConn L] No open connection available at all for ${fromPeerId} during join request.`);
            return;
        }
    }

    const currentHostState = state.getRawNetworkRoomData();
    // Check for duplicate name or icon before adding
    const nameTaken = currentHostState.players.some(p => p.name === data.playerData.name && p.peerId !== fromPeerId); // Exclude self if rejoining with same name
    const iconTaken = currentHostState.players.some(p => p.icon === data.playerData.icon && p.peerId !== fromPeerId); // Exclude self if rejoining with same icon

    if (nameTaken) {
        console.warn(`[PeerConn L] Player name '${data.playerData.name}' taken. Rejecting join from ${fromPeerId}.`);
        sendDataToClient(fromPeerId, { type: MSG_TYPE.JOIN_REJECTED, reason: 'name_taken', detail: data.playerData.name });
        return;
    }
    if (iconTaken) {
        console.warn(`[PeerConn L] Player icon '${data.playerData.icon}' taken. Rejecting join from ${fromPeerId}.`);
        sendDataToClient(fromPeerId, { type: MSG_TYPE.JOIN_REJECTED, reason: 'icon_taken', detail: data.playerData.icon });
        return;
    }

    const existingPlayer = currentHostState.players.find(p => p.peerId === fromPeerId);

    if (existingPlayer && existingPlayer.id !== null && existingPlayer.id !== -1) {
        console.log(`[PeerConn L] Player ${fromPeerId} (GameID: ${existingPlayer.id}) is rejoining or join request is redundant.`);
        if (!existingPlayer.isConnected || existingPlayer.name !== data.playerData.name || existingPlayer.icon !== data.playerData.icon) {
            console.log(`[PeerConn L] Updating player ${existingPlayer.name} data (isConnected, name, icon).`);
            state.updatePlayerInNetworkRoom(fromPeerId, { isConnected: true, ...data.playerData }); 
        }
        console.log(`[PeerConn L] Sending JOIN_ACCEPTED (rejoin) to ${fromPeerId}.`);
        sendDataToClient(fromPeerId, {
            type: MSG_TYPE.JOIN_ACCEPTED,
            yourPlayerIdInRoom: existingPlayer.id,
            roomData: state.getSanitizedNetworkRoomDataForClient() 
        });
        sendFullGameStateToClient(fromPeerId); 
        return;
    }

    const connectedPlayersCount = currentHostState.players.filter(p => p.isConnected !== false).length;
    if (connectedPlayersCount >= currentHostState.maxPlayers) {
        console.warn(`[PeerConn L] Room full (${connectedPlayersCount}/${currentHostState.maxPlayers}). Rejecting join request from ${fromPeerId}.`);
        sendDataToClient(fromPeerId, { type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
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
        peerId: fromPeerId, 
        ...data.playerData, 
        isReady: false,
        isConnected: true, 
        score: 0
    };
    
    state.addPlayerToNetworkRoom(newPlayer); 
    
    connections.set(fromPeerId, {
        connObject: clientConnObjForJoin, 
        playerGameId: newPlayer.id,
        player: newPlayer, 
        status: 'active'
    });
    console.log(`[PeerConn L] Player ${newPlayer.name} (PeerID: ${fromPeerId}) added to room with GameID ${newPlayer.id}. Connection status: active.`);

    console.log(`[PeerConn L] Sending JOIN_ACCEPTED to ${fromPeerId} (GameID: ${newPlayer.id}).`);
    sendDataToClient(fromPeerId, {
        type: MSG_TYPE.JOIN_ACCEPTED,
        yourPlayerIdInRoom: newPlayer.id,
        roomData: state.getSanitizedNetworkRoomDataForClient() 
    });
    
    console.log("[PeerConn L] Broadcasting full game state to all after new player joined.");
    broadcastFullGameStateToAll(); 
    
    if (window.pizarraUiUpdateCallbacks?.updateLobby) {
        window.pizarraUiUpdateCallbacks.updateLobby();
    }
    
    if (matchmaking && matchmaking.updateHostedRoomStatus) {
        console.log(`[PeerConn L] Updating matchmaking status after player ${fromPeerId} joined.`);
        matchmaking.updateHostedRoomStatus(
            currentHostState.roomId, 
            currentHostState.gameSettings,
            currentHostState.maxPlayers,
            state.getRawNetworkRoomData().players.filter(p => p.isConnected !== false).length
        );
    }
}

function handlePlayerReadyChanged(data, fromPeerId) { 
    console.log(`[PeerConn L] handlePlayerReadyChanged from ${fromPeerId}. New ready state: ${data.isReady}`);
    const playerChangingReady = state.getRawNetworkRoomData().players.find(p => p.peerId === fromPeerId);
    if (playerChangingReady) {
        state.updatePlayerInNetworkRoom(fromPeerId, { isReady: data.isReady });
        console.log(`[PeerConn L] Player ${playerChangingReady.name} (GameID: ${playerChangingReady.id}) ready state changed to ${data.isReady}. Broadcasting full state.`);
        broadcastFullGameStateToAll(); 
        if (window.pizarraUiUpdateCallbacks?.updateLobby) { 
            window.pizarraUiUpdateCallbacks.updateLobby();
        }
    } else {
        console.warn(`[PeerConn L] PLAYER_READY_CHANGED from unknown peer ${fromPeerId}.`);
    }
}

function handleLetterGuess(data, fromPeerId, playerGameId) { 
    console.log(`[PeerConn L] Processing LETTER_GUESS from client ${fromPeerId} (PlayerGameID ${playerGameId}). Letter: ${data.letter}`);
    if (playerGameId === state.getCurrentPlayerId() && state.getGameActive()) {
        const result = logic.processGuess(data.letter); 
        console.log(`[PeerConn L] Guess result for letter '${data.letter}' by player ${playerGameId}:`, result);
        
        const guessResultPayload = { 
            type: MSG_TYPE.GUESS_RESULT, 
            ...result, 
            letter: data.letter.toUpperCase() 
        };
        console.log("[PeerConn L] Broadcasting GUESS_RESULT for client's guess:", guessResultPayload);
        broadcastToRoom(guessResultPayload); 
        
        console.log("[PeerConn L] Broadcasting full game state after client's guess.");
        broadcastFullGameStateToAll(); 

        if (result.gameOver) { 
            console.log(`[PeerConn L] Game over condition met after client's guess. Word: ${state.getCurrentWordObject()?.word}`);
            state.setNetworkRoomData({ roomState: 'game_over' }); 
            const winnerData = logic.getWinnerData(state); 
            const finalWord = state.getCurrentWordObject()?.word;
            const gameOverPayload = {
                type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT,
                winnerData: winnerData,
                finalScores: state.getPlayersData().map(p => ({
                    id: p.id, name: p.name, icon: p.icon, score: p.score
                })),
                finalWord: finalWord,
                reason: result.wordSolved ? 'word_solved' : 'player_lost' 
            };
            console.log("[PeerConn L] Broadcasting GAME_OVER_ANNOUNCEMENT (from client's guess):", gameOverPayload);
            broadcastToRoom(gameOverPayload);
            if (window.pizarraUiUpdateCallbacks?.showNetworkGameOver) {
                console.log("[PeerConn L] Triggering host's own showNetworkGameOver (from client's guess).");
                window.pizarraUiUpdateCallbacks.showNetworkGameOver(gameOverPayload);
            }
        }
    } else {
        console.warn(`[PeerConn L] Letter guess from ${fromPeerId} (Player ${playerGameId}) ignored. Not their turn (current: ${state.getCurrentPlayerId()}) or game not active (${state.getGameActive()}).`);
    }
}

function handleClueRequest(data, fromPeerId, playerGameId) {
    console.log(`[PeerConn L] Processing CLUE_REQUEST from client ${fromPeerId} (PlayerGameID ${playerGameId}).`);
    if (playerGameId === state.getCurrentPlayerId() && 
        state.getGameActive() && 
        !state.getClueUsedThisGame()) {
        const clueResult = logic.requestClue(); 
        if (clueResult.success) {
            console.log("[PeerConn L] Clue request successful for client. Clue:", clueResult.clue);
            const clueProvidedPayload = {
                type: MSG_TYPE.CLUE_PROVIDED,
                clue: clueResult.clue,
                clueUsed: state.getClueUsedThisGame() 
            };
            console.log("[PeerConn L] Broadcasting CLUE_PROVIDED for client's request:", clueProvidedPayload);
            broadcastToRoom(clueProvidedPayload);
            if (window.pizarraUiUpdateCallbacks?.displayClueFromNetwork) {
                 console.log("[PeerConn L] Triggering host's own displayClueFromNetwork (from client's request).");
                window.pizarraUiUpdateCallbacks.displayClueFromNetwork(clueProvidedPayload);
            }
            console.log("[PeerConn L] Broadcasting full game state after clue provided for client.");
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

function handleClientDataReception(data, fromLeaderPeerId) { 
    const currentClientState = state.getRawNetworkRoomData();
    if (fromLeaderPeerId !== currentClientState.leaderPeerId) {
        console.warn(`[PeerConn C RX] Data from non-leader ${fromLeaderPeerId} (expected ${currentClientState.leaderPeerId}). Type ${data.type} Ignored.`);
        return;
    }

    switch (data.type) {
        case MSG_TYPE.JOIN_ACCEPTED:
            console.log("[PeerConn C RX] Received JOIN_ACCEPTED. Room Data:", data.roomData, "My Player ID in Room:", data.yourPlayerIdInRoom);
            state.setNetworkRoomData({
                ...data.roomData, 
                myPlayerIdInRoom: data.yourPlayerIdInRoom,
                isRoomLeader: false, 
                myPeerId: state.getMyPeerId(), 
                leaderPeerId: currentClientState.leaderPeerId, 
                roomId: currentClientState.roomId, 
                roomState: data.roomData.roomState || 'lobby' 
            });
            console.log("[PeerConn C RX] JOIN_ACCEPTED: State updated. Calling showLobby.");
            if (window.pizarraUiUpdateCallbacks?.hideModal) window.pizarraUiUpdateCallbacks.hideModal(); 
            if (window.pizarraUiUpdateCallbacks?.showLobby) window.pizarraUiUpdateCallbacks.showLobby(false); 
            
            const setupCompleteCbJoin = state.getInternalSetupCompleteCallback();
            if (setupCompleteCbJoin) {
                 console.log("[PeerConn C RX] JOIN_ACCEPTED: Calling _setupCompleteCallback (from joinRoomById).");
                setupCompleteCbJoin(state.getMyPeerId());
            }
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
            break;

        case MSG_TYPE.JOIN_REJECTED:
            console.warn(`[PeerConn C RX] Received JOIN_REJECTED. Reason: ${data.reason}`, data.detail ? `Detail: ${data.detail}`: '');
            const setupErrorCbReject = state.getInternalSetupErrorCallback();
            let rejectMsg = `Unión rechazada: ${data.reason || 'Desconocido'}`;
            if (data.reason === 'name_taken') rejectMsg = `El nombre '${data.detail}' ya está en uso. ¡Elige otro!`;
            if (data.reason === 'icon_taken') rejectMsg = `El ícono '${data.detail}' ya está en uso. ¡Elige otro!`;

            if (setupErrorCbReject) { 
                console.log("[PeerConn C RX] JOIN_REJECTED: Calling _setupErrorCallback (from joinRoomById).");
                setupErrorCbReject(new Error(rejectMsg));
            } else if (window.pizarraUiUpdateCallbacks?.showNetworkError) {
                window.pizarraUiUpdateCallbacks.showNetworkError(rejectMsg, true);
            }
            state.resetFullLocalStateForNewUIScreen(); 
            break;

        case MSG_TYPE.PLAYER_LEFT:
            console.log(`[PeerConn C RX] Received PLAYER_LEFT. Player GameID: ${data.playerId}, PeerID: ${data.peerId}, Name: ${data.playerName}`);
            if (data.peerId !== state.getMyPeerId()) { 
                if (window.pizarraUiUpdateCallbacks?.showLobbyMessage) {
                    window.pizarraUiUpdateCallbacks.showLobbyMessage(`${data.playerName || `Jugador ${data.playerId}`} ha salido de la sala.`);
                }
            }
            break;

        case MSG_TYPE.GAME_STARTED:
            console.log("[PeerConn C RX] Received GAME_STARTED. Initial Game State:", data.initialGameState);
            state.setPlayersData(data.initialGameState.playersInGameOrder); 
            state.setCurrentWordObject(data.initialGameState.currentWordObject);
            state.setGuessedLetters(new Set(data.initialGameState.guessedLetters || []));
            state.setRemainingAttemptsPerPlayer(data.initialGameState.remainingAttemptsPerPlayer || []);
            state.setCurrentPlayerId(data.initialGameState.startingPlayerId);
            state.setClueUsedThisGame(data.initialGameState.clueUsedThisGame || false);
            state.setCurrentDifficulty(data.initialGameState.gameSettings.difficulty);
            
            state.setNetworkRoomData({
                gameSettings: data.initialGameState.gameSettings,
                roomState: 'playing',
                currentWordObject: data.initialGameState.currentWordObject,
                guessedLetters: Array.from(data.initialGameState.guessedLetters || []),
                remainingAttemptsPerPlayer: data.initialGameState.remainingAttemptsPerPlayer || [],
                currentPlayerId: data.initialGameState.startingPlayerId,
                clueUsedThisGame: data.initialGameState.clueUsedThisGame || false,
                gameActive: true, 
                players: data.initialGameState.playersInGameOrder 
            });
            
            if (window.pizarraUiUpdateCallbacks?.startGameOnNetwork) {
                window.pizarraUiUpdateCallbacks.startGameOnNetwork(data.initialGameState);
            }
            break;

        case MSG_TYPE.GUESS_RESULT:
            if (window.pizarraUiUpdateCallbacks?.updateGameFromNetwork) {
                window.pizarraUiUpdateCallbacks.updateGameFromNetwork(data);
            }
            break;

        case MSG_TYPE.CLUE_PROVIDED:
            console.log("[PeerConn C RX] Received CLUE_PROVIDED:", data);
            if (window.pizarraUiUpdateCallbacks?.displayClueFromNetwork) {
                window.pizarraUiUpdateCallbacks.displayClueFromNetwork(data); 
            }
            state.setClueUsedThisGame(data.clueUsed); 
            break;

        case MSG_TYPE.FULL_GAME_STATE:
            console.log("[PeerConn C RX] Received FULL_GAME_STATE. Game State Payload:", data.gameState);
            state.setNetworkRoomData({
                ...data.gameState, 
                isRoomLeader: false, 
                myPeerId: state.getMyPeerId(), 
                myPlayerIdInRoom: data.gameState.players?.find(p => p.peerId === state.getMyPeerId())?.id ?? 
                                 state.getRawNetworkRoomData().myPlayerIdInRoom, 
                leaderPeerId: currentClientState.leaderPeerId, 
                roomId: currentClientState.roomId, 
            });
            
            console.log("[PeerConn C RX] FULL_GAME_STATE: State updated. Calling syncUIFromNetworkState.");
            if (window.pizarraUiUpdateCallbacks?.syncUIFromNetworkState) {
                window.pizarraUiUpdateCallbacks.syncUIFromNetworkState();
            }
            break;

        case MSG_TYPE.GAME_OVER_ANNOUNCEMENT:
            console.log("[PeerConn C RX] Received GAME_OVER_ANNOUNCEMENT:", data);
            state.setGameActive(false); 
            state.setNetworkRoomData({ roomState: 'game_over' }); 
            
            if (data.finalWord && !logic.checkWinCondition()) { 
                state.setCurrentWordObject({ 
                    word: data.finalWord,
                    definition: "La palabra era esta.", 
                    difficulty: state.getCurrentDifficulty()
                });
                const finalGuessed = new Set();
                for (const letter of data.finalWord.toUpperCase()) { 
                    finalGuessed.add(state.normalizeString(letter).toLowerCase());
                }
                state.setGuessedLetters(finalGuessed);
            }
            
            if (data.finalScores) {
                const currentPlayers = state.getPlayersData(); 
                const networkPlayers = state.getRawNetworkRoomData().players; 
                data.finalScores.forEach(ps => {
                    const pLocal = currentPlayers.find(p => p.id === ps.id); 
                    if (pLocal) pLocal.score = ps.score;
                    
                    const pNet = networkPlayers.find(pNetEntry => pNetEntry.id === ps.id);
                    if (pNet) pNet.score = ps.score;
                });
                state.setPlayersData(currentPlayers); 
                if(networkPlayers.length > 0) state.setNetworkRoomData({players: networkPlayers}); 
            }
            
            if (window.pizarraUiUpdateCallbacks?.showNetworkGameOver) {
                window.pizarraUiUpdateCallbacks.showNetworkGameOver(data);
            }
            break;

        case MSG_TYPE.ERROR_MESSAGE:
            console.warn(`[PeerConn C RX] Received ERROR_MESSAGE from leader: ${data.message}`);
            if (window.pizarraUiUpdateCallbacks?.showNetworkError) {
                window.pizarraUiUpdateCallbacks.showNetworkError(data.message, false); 
            }
            break;

        default:
            console.warn(`[PeerConn C RX] Unhandled message type from leader: ${data.type}`);
    }
    
    if (data.type === MSG_TYPE.JOIN_ACCEPTED || data.type === MSG_TYPE.JOIN_REJECTED) {
        state.setNetworkRoomData({ 
            _setupCompleteCallback: null, 
            _setupErrorCallback: null 
        });
    }
}

function reassignPlayerIdsAndBroadcastUpdate() {
    console.log("[PeerConn L] reassignPlayerIdsAndBroadcastUpdate called by host.");
    if (!state.getRawNetworkRoomData().isRoomLeader) {
        console.warn("[PeerConn L] reassignPlayerIdsAndBroadcastUpdate called by non-leader. Aborting.");
        return;
    }
    
    const currentPlayersFromState = state.getRawNetworkRoomData().players; 
    
    const connectedPeerJsIds = new Set(Array.from(connections.keys()).filter(peerId => 
        connections.get(peerId)?.connObject?.open));
    connectedPeerJsIds.add(state.getMyPeerId()); 

    const activePlayers = currentPlayersFromState.filter(p => 
        p.isConnected !== false && connectedPeerJsIds.has(p.peerId));

    console.log(`[PeerConn L] Active players for ID reassignment (isConn=true & has open conn): ${activePlayers.length}`, activePlayers.map(p=>({id:p.id, name:p.name, peerId:p.peerId})));

    activePlayers.sort((a, b) => {
        if (a.peerId === state.getMyPeerId()) return -1; 
        if (b.peerId === state.getMyPeerId()) return 1;
        return (a.id === undefined || a.id === null ? Infinity : a.id) - 
               (b.id === undefined || b.id === null ? Infinity : b.id); 
    });

    let idsChanged = false;
    const newPlayerArrayForState = activePlayers.map((player, index) => {
        if (player.id !== index) {
            idsChanged = true;
            console.log(`[PeerConn L] Reassigning ID for player ${player.name} (PeerID: ${player.peerId}): Old ID ${player.id} -> New ID ${index}`);
        }
        return { ...player, id: index }; 
    });

    const hostPlayerEntry = newPlayerArrayForState.find(p => p.peerId === state.getMyPeerId());
    if (hostPlayerEntry) {
        state.setNetworkRoomData({ myPlayerIdInRoom: hostPlayerEntry.id });
    }

    state.setNetworkRoomData({ players: newPlayerArrayForState });

    if (idsChanged || activePlayers.length !== currentPlayersFromState.filter(p => p.isConnected !== false).length) {
        console.log("[PeerConn L] Player list or IDs changed. Broadcasting new full game state.");
        broadcastFullGameStateToAll(); 
        if (window.pizarraUiUpdateCallbacks?.updateLobby) {
            window.pizarraUiUpdateCallbacks.updateLobby(); 
        }
    } else {
        console.log("[PeerConn L] No player ID changes detected after filtering and sorting active players.");
    }
}

function sendFullGameStateToClient(clientRawPeerId) { 
    console.log(`[PeerConn L] sendFullGameStateToClient called for client: ${clientRawPeerId}.`);
    if (!state.getRawNetworkRoomData().isRoomLeader) return;
    
    const currentNetworkState = state.getRawNetworkRoomData(); 
    const gameStatePayload = {
        players: currentNetworkState.players.map(p => ({ ...p })), 
        gameSettings: { ...currentNetworkState.gameSettings },
        roomState: currentNetworkState.roomState,
        maxPlayers: currentNetworkState.maxPlayers,
        roomId: currentNetworkState.roomId,
        leaderPeerId: currentNetworkState.leaderPeerId,
        turnCounter: currentNetworkState.turnCounter,
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
    if (!state.getRawNetworkRoomData().isRoomLeader) {
        console.warn("[PeerConn L] broadcastFullGameStateToAll called by non-leader. Aborting.");
        return;
    }
    
    const currentNetworkState = state.getRawNetworkRoomData(); 
    const gameStatePayload = {
        players: currentNetworkState.players.map(p => ({ ...p })), 
        gameSettings: { ...currentNetworkState.gameSettings },
        roomState: currentNetworkState.roomState,
        maxPlayers: currentNetworkState.maxPlayers,
        roomId: currentNetworkState.roomId, 
        leaderPeerId: currentNetworkState.leaderPeerId, 
        turnCounter: currentNetworkState.turnCounter,
        currentWordObject: currentNetworkState.currentWordObject ? { ...currentNetworkState.currentWordObject } : null,
        guessedLetters: Array.isArray(currentNetworkState.guessedLetters) ? [...currentNetworkState.guessedLetters] : [],
        remainingAttemptsPerPlayer: Array.isArray(currentNetworkState.remainingAttemptsPerPlayer) ? [...currentNetworkState.remainingAttemptsPerPlayer] : [],
        currentPlayerId: currentNetworkState.currentPlayerId,
        clueUsedThisGame: currentNetworkState.clueUsedThisGame,
        gameActive: currentNetworkState.gameActive,
    };
    console.log("[PeerConn L] Broadcasting FULL_GAME_STATE to all clients. Payload:", gameStatePayload);
    broadcastToRoom({ type: MSG_TYPE.FULL_GAME_STATE, gameState: gameStatePayload });
    
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
    
    const currentRoomData = state.getRawNetworkRoomData(); 
    const isCurrentlyLeader = currentRoomData.isRoomLeader;
    const myCurrentPeerId = state.getMyPeerId(); 

    console.log(`[PeerConn] leaveRoom - Current State (from getRawNetworkRoomData): isLeader=${currentRoomData.isRoomLeader}, myPeerId (from getMyPeerId)=${myCurrentPeerId}, roomData.roomId=${currentRoomData.roomId}, roomData.leaderPeerId=${currentRoomData.leaderPeerId}, roomData.roomState=${currentRoomData.roomState}`);

    if (isCurrentlyLeader) {
        let roomIdForCleanup = currentRoomData.roomId;
        if (!roomIdForCleanup && (currentRoomData.roomState === 'creating_room' || currentRoomData.roomState === 'seeking_match') && myCurrentPeerId) {
            console.warn(`[PeerConn] leaveRoom (Leader): roomId in state is null/falsy but state is ${currentRoomData.roomState}. Using myCurrentPeerId ('${myCurrentPeerId}') for cleanup.`);
            roomIdForCleanup = myCurrentPeerId;
        } else if (!roomIdForCleanup && myCurrentPeerId) {
            console.warn(`[PeerConn] leaveRoom (Leader): roomId in state is null/falsy (state: ${currentRoomData.roomState}). Using myCurrentPeerId ('${myCurrentPeerId}') as a fallback for cleanup.`);
            roomIdForCleanup = myCurrentPeerId;
        }

        console.log(`[PeerConn] Leader (PeerID: ${myCurrentPeerId}, Determined RoomID for Cleanup: ${roomIdForCleanup}) is leaving. Broadcasting GAME_OVER.`);
        broadcastToRoom({
            type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT,
            reason: 'leader_left_room',
            finalWord: state.getCurrentWordObject()?.word 
        });
        
        if (roomIdForCleanup && matchmaking && matchmaking.leaveQueue) { 
            console.log(`[PeerConn] Leader leaving matchmaking queue for room/peerId: ${roomIdForCleanup}`);
            matchmaking.leaveQueue(roomIdForCleanup); 
        } else {
            console.warn(`[PeerConn] Leader leaveRoom: matchmaking.leaveQueue not called. roomIdForCleanup: ${roomIdForCleanup}`);
        }
        
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
        }, 500); 
    } else if (leaderConnection) { 
        console.log(`[PeerConn] Client (PeerID: ${myCurrentPeerId}) is leaving room. Closing connection to leader ${leaderConnection.peer}.`);
        if (leaderConnection.close && !leaderConnection.disconnected) {
            try { leaderConnection.close(); }
            catch (e) { console.warn(`[PeerConn] Error closing leader connection:`, e); }
        }
    }
    leaderConnection = null; 
    console.log("[PeerConn] leaveRoom processing finished. PeerJS session closure will be handled by stopAnyActiveGameOrNetworkSession.");
}

function sendDataToLeader(data) {
    if (leaderConnection && leaderConnection.open) {
        try {
            // console.log(`[PeerConn C TX] Client sending data to leader ${leaderConnection.peer}. Type: ${data.type}`, data);
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

function sendDataToClient(clientRawPeerId, data) { 
    const connEntry = connections.get(clientRawPeerId);
    if (connEntry?.connObject?.open) {
        try {
            // console.log(`[PeerConn L TX] Host sending data to client ${clientRawPeerId}. Type: ${data.type}`, data);
            connEntry.connObject.send(data);
        } catch (e) {
            console.error(`[PeerConn L TX] Error sending data to client ${clientRawPeerId}:`, e, data);
        }
    } else {
        console.warn(`[PeerConn L TX] No open connection to client ${clientRawPeerId}. Cannot send data type ${data.type}. ConnEntry:`, connEntry);
    }
}

function broadcastToRoom(data, excludePeerId = null) { 
    if (!state.getRawNetworkRoomData().isRoomLeader) {
        console.warn("[PeerConn L TX] Non-leader attempting to broadcast. Aborted.");
        return;
    }
    // console.log(`[PeerConn L TX] Host broadcasting to room. Type: ${data.type}, Excluding: ${excludePeerId}`, data);
    connections.forEach((connEntry, peerId) => { 
        if (peerId !== excludePeerId && connEntry?.connObject?.open) {
            try {
                connEntry.connObject.send(data);
            } catch (e) {
                console.error(`[PeerConn L TX] Error broadcasting type ${data.type} to client ${peerId}:`, e);
            }
        }
    });
}

export function sendPlayerReadyState(isReady) {
    console.log(`[PeerConn] sendPlayerReadyState called. Is Ready: ${isReady}`);
    const currentRoomData = state.getRawNetworkRoomData();
    if (currentRoomData.isRoomLeader) {
        console.log("[PeerConn] Host is changing their own ready state.");
        state.updatePlayerInNetworkRoom(state.getMyPeerId(), { isReady });
        console.log("[PeerConn] Host ready state updated. Broadcasting full game state.");
        broadcastFullGameStateToAll(); 
        if (window.pizarraUiUpdateCallbacks?.updateLobby) { 
            window.pizarraUiUpdateCallbacks.updateLobby();
        }
    } else {
        console.log(`[PeerConn] Client (PlayerGameID: ${currentRoomData.myPlayerIdInRoom}) sending ready state ${isReady} to host.`);
        sendDataToLeader({
            type: MSG_TYPE.PLAYER_READY_CHANGED,
            playerId: currentRoomData.myPlayerIdInRoom, 
            isReady: isReady
        });
    }
}

export function leaderStartGameRequest() {
    console.log("[PeerConn L] leaderStartGameRequest called by host.");
    const currentRoomData = state.getRawNetworkRoomData(); 
    if (!currentRoomData.isRoomLeader || currentRoomData.roomState !== 'lobby') {
        console.warn(`[PeerConn L] Leader start game request ignored. Not leader or not in lobby. State:`, currentRoomData);
        return;
    }

    const connectedAndReadyPlayers = currentRoomData.players.filter(p => p.isReady && p.isConnected !== false);
    const totalConnectedPlayers = currentRoomData.players.filter(p => p.isConnected !== false).length;

    if (connectedAndReadyPlayers.length < state.MIN_PLAYERS_NETWORK || 
        connectedAndReadyPlayers.length !== totalConnectedPlayers) {
        const msg = `No todos los jugadores están listos (${connectedAndReadyPlayers.length}/${totalConnectedPlayers}) o no hay suficientes conectados (${state.MIN_PLAYERS_NETWORK} min).`;
        console.warn(`[PeerConn L] Cannot start game: ${msg}`);
        if (window.pizarraUiUpdateCallbacks?.showNetworkError) {
            window.pizarraUiUpdateCallbacks.showNetworkError(msg, false);
        }
        return;
    }

    console.log("[PeerConn L] All conditions met. Starting game setup.");
    
    const gameInitResult = logic.initializeGame(state, currentRoomData.gameSettings.difficulty); 

    if (!gameInitResult.success || !state.getCurrentWordObject()) { 
        console.error("[PeerConn L] Failed to initialize game logic (e.g., no word selected):", gameInitResult.message);
        state.setNetworkRoomData({ roomState: 'lobby' }); 
        broadcastFullGameStateToAll(); 
        if (window.pizarraUiUpdateCallbacks?.showNetworkError) {
            window.pizarraUiUpdateCallbacks.showNetworkError(
                `Error del Host al iniciar: ${gameInitResult.message || "No se pudo seleccionar palabra."}`, false
            );
        }
        return;
    }
    console.log(`[PeerConn L] Game logic initialized. Word: ${state.getCurrentWordObject()?.word}. Starting player ID: ${state.getCurrentPlayerId()}`);

    state.setNetworkRoomData({
        roomState: 'playing', 
        currentWordObject: state.getCurrentWordObject(),
        guessedLetters: Array.from(state.getGuessedLetters()),
        remainingAttemptsPerPlayer: state.getRemainingAttemptsPerPlayer(),
        currentPlayerId: state.getCurrentPlayerId(),
        clueUsedThisGame: state.getClueUsedThisGame(),
        gameActive: true, 
        turnCounter: 0, 
        players: state.getPlayersData().map(p => ({...p, score:0})) 
    });

    const finalNetworkStateForStart = state.getRawNetworkRoomData();
    const initialGameStatePayload = {
        gameSettings: finalNetworkStateForStart.gameSettings,
        currentWordObject: finalNetworkStateForStart.currentWordObject,
        guessedLetters: finalNetworkStateForStart.guessedLetters,
        remainingAttemptsPerPlayer: finalNetworkStateForStart.remainingAttemptsPerPlayer,
        playersInGameOrder: finalNetworkStateForStart.players, 
        startingPlayerId: finalNetworkStateForStart.currentPlayerId,
        clueUsedThisGame: finalNetworkStateForStart.clueUsedThisGame,
    };

    console.log("[PeerConn L] Broadcasting GAME_STARTED with payload:", initialGameStatePayload);
    broadcastToRoom({ type: MSG_TYPE.GAME_STARTED, initialGameState: initialGameStatePayload });
    
    if (window.pizarraUiUpdateCallbacks?.startGameOnNetwork) {
        console.log("[PeerConn L] Triggering host's own startGameOnNetwork UI update.");
        window.pizarraUiUpdateCallbacks.startGameOnNetwork(initialGameStatePayload);
    }

    if (currentRoomData.roomId) { 
        if (matchmaking && matchmaking.leaveQueue) { 
            console.log(`[PeerConn L] Removing room ${currentRoomData.roomId} from matchmaking 'waiting' queue as game starts.`);
            matchmaking.leaveQueue(currentRoomData.roomId); 
        }
        if (matchmaking && matchmaking.updateHostedRoomStatus) {
             console.log(`[PeerConn L] Updating matchmaking status for room ${currentRoomData.roomId} to 'in_game'.`);
            matchmaking.updateHostedRoomStatus(
                currentRoomData.roomId, 
                finalNetworkStateForStart.gameSettings,
                finalNetworkStateForStart.maxPlayers,
                finalNetworkStateForStart.players.length,
                'in_game' 
            );
        }
    }
}

// REVISED sendGuessToHost (with AI patch logic)
export function sendGuessToHost(letter) {
  console.log(`[PeerConn TX] sendGuessToHost called. Letter: ${letter}`);
  const currentRoomData = state.getRawNetworkRoomData();

  // --- CLIENT path ---
  if (state.getPvpRemoteActive() && !currentRoomData.isRoomLeader && state.getGameActive()) {
    console.log(`[PeerConn C TX] Client (PlayerGameID: ${currentRoomData.myPlayerIdInRoom}) sending guess '${letter}' to host.`);
    sendDataToLeader({
      type: MSG_TYPE.LETTER_GUESS,
      letter: letter,
      playerId: currentRoomData.myPlayerIdInRoom 
    });
    return; // Client's job is done once message is sent
  }
  
  // --- HOST path (local processing for host's own guess) ---
  if (currentRoomData.isRoomLeader && state.getGameActive()) {
    // Check if it's actually the host's turn (host is player 0, or more generally, their myPlayerIdInRoom)
    if (currentRoomData.myPlayerIdInRoom === state.getCurrentPlayerId()) {
        console.log(`[PeerConn L] Host (PlayerGameID: ${currentRoomData.myPlayerIdInRoom}) processing own guess '${letter}' locally.`);
        const result = logic.processGuess(letter); 
        console.log(`[PeerConn L] Host's own guess result for '${letter}':`, result);

        const guessResultPayload = {
          type   : MSG_TYPE.GUESS_RESULT,
          ...result, 
          letter : letter.toUpperCase() 
        };

        // Update host's UI immediately
        if (window.pizarraUiUpdateCallbacks?.updateGameFromNetwork) {
          console.log("[PeerConn L] Updating host's UI directly after own guess.");
          window.pizarraUiUpdateCallbacks.updateGameFromNetwork(guessResultPayload);
        }

        console.log("[PeerConn L] Broadcasting GUESS_RESULT for host's own guess:", guessResultPayload);
        broadcastToRoom(guessResultPayload); 
        
        console.log("[PeerConn L] Broadcasting full game state after host's own guess.");
        broadcastFullGameStateToAll(); 

        if (result.gameOver) { 
            console.log(`[PeerConn L] Game over condition met after host's own guess. Word: ${state.getCurrentWordObject()?.word}`);
            state.setNetworkRoomData({ roomState: 'game_over' }); 
            const winnerData = logic.getWinnerData(state); 
            const finalWord = state.getCurrentWordObject()?.word;
            const gameOverPayload = {
                type        : MSG_TYPE.GAME_OVER_ANNOUNCEMENT,
                winnerData  : winnerData,
                finalScores : state.getPlayersData().map(p => ({ id:p.id, name:p.name, icon: p.icon, score:p.score })),
                finalWord   : finalWord,
                reason      : result.wordSolved ? "word_solved" : "player_lost",
            };
            console.log("[PeerConn L] Broadcasting GAME_OVER_ANNOUNCEMENT for host's game over:", gameOverPayload);
            broadcastToRoom(gameOverPayload);
            if (window.pizarraUiUpdateCallbacks?.showNetworkGameOver) {
                console.log("[PeerConn L] Triggering host's own showNetworkGameOver.");
                window.pizarraUiUpdateCallbacks.showNetworkGameOver(gameOverPayload);
            }
        }
    } else {
        console.warn(`[PeerConn L] Host attempting to guess but not their turn. Host ID: ${currentRoomData.myPlayerIdInRoom}, Current Turn: ${state.getCurrentPlayerId()}`);
    }
    return; // Host's processing done
  }

  console.warn(`[PeerConn TX] sendGuessToHost: Conditions not met for client or host action. PVP: ${state.getPvpRemoteActive()}, IsLeader: ${currentRoomData.isRoomLeader}, GameActive: ${state.getGameActive()}`);
}

// REVISED sendClueRequestToHost (with AI patch logic)
export function sendClueRequestToHost() {
  console.log("[PeerConn TX] sendClueRequestToHost called.");
  const currentRoomData = state.getRawNetworkRoomData();

  // --- CLIENT path ---
  if (state.getPvpRemoteActive() && !currentRoomData.isRoomLeader && state.getGameActive()) {
    if (currentRoomData.myPlayerIdInRoom === state.getCurrentPlayerId()) { // Client checks if it's their turn
        console.log(`[PeerConn C TX] Client (PlayerGameID: ${currentRoomData.myPlayerIdInRoom}) sending clue request to host.`);
        sendDataToLeader({
          type: MSG_TYPE.CLUE_REQUEST,
          playerId: currentRoomData.myPlayerIdInRoom 
        });
    } else {
        console.warn(`[PeerConn C TX] Client (PlayerGameID: ${currentRoomData.myPlayerIdInRoom}) tried to request clue, but not their turn (Current: ${state.getCurrentPlayerId()}).`);
        if (window.pizarraUiUpdateCallbacks?.showNetworkError) {
             window.pizarraUiUpdateCallbacks.showNetworkError("No es tu turno para pedir pista.", false);
        }
    }
    return; // Client's job is done
  }

  // --- HOST path (local processing for host's own clue request) ---
  if (currentRoomData.isRoomLeader && state.getGameActive()) {
    if (currentRoomData.myPlayerIdInRoom === state.getCurrentPlayerId() && !state.getClueUsedThisGame()) {
        console.log(`[PeerConn L] Host (PlayerGameID: ${currentRoomData.myPlayerIdInRoom}) processing own clue request locally.`);
        const clueResult = logic.requestClue(); // This updates state.clueUsedThisGame

        if (clueResult.success) {
            console.log("[PeerConn L] Host's own clue request successful. Clue:", clueResult.clue);
            const cluePayload = {
                type     : MSG_TYPE.CLUE_PROVIDED,
                clue     : clueResult.clue,
                clueUsed : state.getClueUsedThisGame() 
            };

            if (window.pizarraUiUpdateCallbacks?.displayClueFromNetwork) {
                console.log("[PeerConn L] Updating host's UI directly after own clue request.");
                window.pizarraUiUpdateCallbacks.displayClueFromNetwork(cluePayload);
            }

            console.log("[PeerConn L] Broadcasting CLUE_PROVIDED for host's own clue:", cluePayload);
            broadcastToRoom(cluePayload);
            console.log("[PeerConn L] Broadcasting full game state after host's own clue.");
            broadcastFullGameStateToAll();
        } else {
            console.warn(`[PeerConn L] Host's own clue request failed: ${clueResult.message}`);
            if (window.pizarraUiUpdateCallbacks?.showNetworkError) { 
                window.pizarraUiUpdateCallbacks.showNetworkError(clueResult.message || "No se pudo obtener la pista.", false);
            }
        }
    } else {
        const reason = state.getClueUsedThisGame() ? "La pista ya fue usada." : "No es tu turno para pedir pista.";
        console.warn(`[PeerConn L] Host clue request conditions not met. Turn: ${state.getCurrentPlayerId()}/${currentRoomData.myPlayerIdInRoom}, ClueUsed: ${state.getClueUsedThisGame()}. Reason: ${reason}`);
        if (window.pizarraUiUpdateCallbacks?.showNetworkError) {
            window.pizarraUiUpdateCallbacks.showNetworkError(reason, false);
        }
    }
    return; // Host's processing done
  }
  
  console.warn(`[PeerConn TX] sendClueRequestToHost: Conditions not met for client or host action. PVP: ${state.getPvpRemoteActive()}, IsLeader: ${currentRoomData.isRoomLeader}, GameActive: ${state.getGameActive()}`);
}

function setupConnectionEventHandlers(conn) { 
    console.log(`[PeerConn] Setting up event handlers for connection with PeerJS ID: ${conn.peer}. Reliable: ${conn.reliable}`);
    conn.on('open', () => peerJsCallbacks.onConnectionOpen(conn.peer));
    conn.on('data', (data) => peerJsCallbacks.onDataReceived(data, conn.peer));
    conn.on('close', () => peerJsCallbacks.onConnectionClose(conn.peer));
    conn.on('error', (err) => peerJsCallbacks.onError(err, conn.peer)); 
}

export function closePeerSession() {
    console.log("[PeerConn] closePeerSession called. Closing PeerJS session...");
    
    if (window.peerJsMultiplayer?.close) {
        window.peerJsMultiplayer.close(); 
    } else {
        console.warn("[PeerConn] peerJsMultiplayer.close function not available.");
    }
    leaderConnection = null; 
    connections.clear();     
    console.log("[PeerConn] closePeerSession: PeerJS close requested. Local connection references cleared.");
}

window.addEventListener('load', () => { 
    let checkCount = 0;
    const maxChecks = 20; 
    const checkIntervalTime = 200;
    const intervalId = setInterval(() => {
        if (window.peerJsMultiplayer && typeof window.peerJsMultiplayer.init === 'function') {
            clearInterval(intervalId);
            console.log("[PeerConn] peerjs-multiplayer.js wrapper found and seems ready.");
        } else {
            checkCount++;
            if (checkCount >= maxChecks) {
                clearInterval(intervalId);
                console.error("[PeerConn] CRITICAL: peerjs-multiplayer.js wrapper not found after multiple checks! Peer connections will fail.");
                if(window.pizarraUiUpdateCallbacks?.showNetworkError) {
                    window.pizarraUiUpdateCallbacks.showNetworkError("Error Crítico: No se pudo cargar el componente de red principal (PJSMP).", true);
                }
            }
        }
    }, checkIntervalTime);
});

window.addEventListener('beforeunload', () => {
    console.log("[PeerConn] beforeunload event triggered.");
    if (state.getPvpRemoteActive()) { 
        console.log("[PeerConn] PVP mode active during unload. Attempting cleanup.");
        const currentRoomData = state.getRawNetworkRoomData(); 
        if (currentRoomData.isRoomLeader && currentRoomData.roomId) { 
            if (matchmaking && matchmaking.leaveQueue) {
                console.log(`[PeerConn] Host (Room: ${currentRoomData.roomId}) leaving matchmaking queue due to page unload.`);
                matchmaking.leaveQueue(currentRoomData.roomId); 
            }
        }
        closePeerSession(); 
    }
});