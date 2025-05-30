// pizarraNetHandlers.js
import * as state from './pizarraState.js';
// ui import removed as UI updates are now triggered by a callback in main.js

/**
 * Attaches a data listener to a connection, specifically for handling 'state_sync' messages.
 * This is intended to be called on the client-side for connections to the host,
 * and on the host-side for connections from clients (though host primarily sends state_sync).
 * @param {PeerJS.DataConnection} conn - The PeerJS DataConnection object.
 */
export function attach(conn) {
  conn.on('data', data => {
    if (data?.type === 'state_sync') {
      console.log(`[NetHandlers] Received state_sync from ${conn.peer}:`, data.payload);
      // Client updates its local state based on the host's authoritative state
      if (!state.getNetworkRoomData().isRoomLeader) { // Ensure only clients process incoming state_sync this way
        state.setNetworkRoomData(data.payload); // Update the entire network room data

        // Trigger UI update callback if available (defined in main.js)
        if (window.pizarraUiUpdateCallbacks?.syncGameUIFromNetworkState) {
          window.pizarraUiUpdateCallbacks.syncGameUIFromNetworkState();
        }
      }
    }
    // Other message types are handled by the main onDataReceived in pizarraPeerConnection.js
  });
}

/**
 * Broadcasts the full current network game state from the host to all connected clients.
 * @param {Map<string, {connObject: PeerJS.DataConnection, playerGameId: number, status: string}>} hostConnectionsMap - The host's map of active client connections.
 */
export function broadcastState(hostConnectionsMap) {
  if (!state.getNetworkRoomData().isRoomLeader) {
    // console.warn("[NetHandlers] broadcastState called by non-leader. Aborting.");
    return; 
  }

  const snapshot = state.getRawNetworkRoomData(); // Get the full, clone-safe network data from host's perspective
  // console.log("[NetHandlers] Host broadcasting state_sync:", snapshot);

  hostConnectionsMap.forEach((clientEntry, peerId) => {
    if (clientEntry.connObject && clientEntry.connObject.open) {
      try {
        clientEntry.connObject.send({ type: 'state_sync', payload: snapshot });
      } catch (e) {
        console.error(`[NetHandlers] Error sending state_sync to client ${peerId}:`, e);
      }
    }
  });
}