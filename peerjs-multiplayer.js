// peerjs-multiplayer.js
// console.log("DEBUG: peerjs-multiplayer.js script execution started."); // Keep for debugging if needed

let peer = null;
let currentConnection = null;
let localPeerId = null;

// Default callbacks
let onPeerOpenCallback_default = (id) => console.log('PeerJS: Default (Global) - My peer ID is:', id);
let onConnectionOpenCallback_default = (peerId) => console.log('PeerJS: Default (Global) - Connection opened with:', peerId);
let onDataReceivedCallback_default = (data, peerId) => console.log('PeerJS: Default (Global) - Data received from:', peerId, data);
let onConnectionCloseCallback_default = (peerId) => console.log('PeerJS: Default (Global) - Connection closed with:', peerId);
let onErrorCallback_default = (err) => console.error('PeerJS: Default (Global) - Error:', err.type, err.message || err);
let onNewConnectionCallback_default = (conn) => console.log('PeerJS: Default (Global) - New incoming connection from:', conn.peer);

// Module-level variables to hold the currently registered callbacks
let currentOnPeerOpenCallback = onPeerOpenCallback_default;
let currentOnConnectionOpenCallback = onConnectionOpenCallback_default;
let currentOnDataReceivedCallback = onDataReceivedCallback_default;
let currentOnConnectionCloseCallback = onConnectionCloseCallback_default;
let currentOnErrorCallback = onErrorCallback_default;
let currentOnNewConnectionCallback = onNewConnectionCallback_default;


function initPeerSession(options = {}, callbacks = {}) { // Options can now include PeerJS constructor options
    if (peer && !peer.destroyed) {
        console.warn("PeerJS: Peer object already exists and is not destroyed. Closing existing session before creating a new one.");
        closePeerSession();
    } else if (peer && peer.destroyed) {
        console.log("PeerJS: Peer object was already destroyed. Ready for new initialization.");
        peer = null;
    }

    currentOnPeerOpenCallback = callbacks.onPeerOpen || onPeerOpenCallback_default;
    currentOnConnectionOpenCallback = callbacks.onConnectionOpen || onConnectionOpenCallback_default;
    currentOnDataReceivedCallback = callbacks.onDataReceived || onDataReceivedCallback_default;
    currentOnConnectionCloseCallback = callbacks.onConnectionClose || onConnectionCloseCallback_default;
    currentOnErrorCallback = callbacks.onError || onErrorCallback_default;
    currentOnNewConnectionCallback = callbacks.onNewConnection || onNewConnectionCallback_default;

    try {
        if (typeof Peer === 'undefined') {
            console.error("PeerJS: Peer library (Peer constructor) is not loaded!");
            currentOnErrorCallback({type: 'init_failed', message: 'PeerJS library not loaded.', originalError: new Error('Peer is not defined')});
            return;
        }

        let peerIdToUse = null;
        let peerOptions = {
            debug: 2, // 0: none, 1: errors, 2: warnings, 3: verbose
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                ]
            }
        };

        if (typeof options === 'string' || options === null) {
            peerIdToUse = options;
        } else if (typeof options === 'object' && options !== null) {
            if(options.peerId) peerIdToUse = options.peerId;
            if(options.config) peerOptions.config = {...peerOptions.config, ...options.config};
            if(options.key) peerOptions.key = options.key;
            if(options.host) peerOptions.host = options.host;
            if(options.port) peerOptions.port = options.port;
            if(options.path) peerOptions.path = options.path;
            if(options.debug !== undefined) peerOptions.debug = options.debug;
        }


        if (peerIdToUse) {
            // console.log(`PeerJS: Initializing with preferred ID: ${peerIdToUse} and options:`, peerOptions);
            peer = new Peer(peerIdToUse, peerOptions);
        } else {
            // console.log("PeerJS: Initializing with auto-assigned ID and options:", peerOptions);
            peer = new Peer(peerOptions);
        }
    } catch (error) {
        console.error("PeerJS: Failed to create Peer object.", error);
        currentOnErrorCallback({type: 'init_failed', message: 'Failed to create Peer object.', originalError: error});
        return;
    }

    peer.on('open', (id) => {
        localPeerId = id;
        // console.log('PeerJS: Peer.on("open") event. My peer ID is:', id);
        if (currentOnPeerOpenCallback) {
            currentOnPeerOpenCallback(id);
        }
    });

    peer.on('connection', (conn) => {
        // console.log('PeerJS: Peer.on("connection") event. Incoming connection from', conn.peer);
        if (currentOnNewConnectionCallback) {
            currentOnNewConnectionCallback(conn);
        } else {
            console.warn("PeerJS: No onNewConnectionCallback registered, default handling.");
            if (currentConnection && currentConnection.open) {
                conn.on('open', () => conn.close());
                return;
            }
            currentConnection = conn;
            setupConnectionEventHandlers(currentConnection);
        }
    });

    peer.on('disconnected', () => {
        console.log('PeerJS: Peer.on("disconnected") event. Disconnected from PeerServer.');
        if (currentOnErrorCallback) currentOnErrorCallback({type: 'disconnected', message: 'Disconnected from PeerServer.'});
    });

    peer.on('close', () => {
        console.log('PeerJS: Peer.on("close") event. Peer object closed.');
        localPeerId = null;
    });

    peer.on('error', (err) => {
        console.error('PeerJS: Peer.on("error") event:', err.type, err.message || err);
        if (currentOnErrorCallback) {
            currentOnErrorCallback(err);
        }
    });
}

function setupConnectionEventHandlers(conn) {
    conn.on('open', () => {
        // console.log(`PeerJS: DataConnection.on("open") with ${conn.peer}.`);
        if (currentOnConnectionOpenCallback) {
            currentOnConnectionOpenCallback(conn.peer);
        }
    });

    conn.on('data', (data) => {
        if (currentOnDataReceivedCallback) {
            currentOnDataReceivedCallback(data, conn.peer);
        }
    });

    conn.on('close', () => {
        // console.log(`PeerJS: DataConnection.on("close") with ${conn.peer}.`);
        if (currentOnConnectionCloseCallback) {
            currentOnConnectionCloseCallback(conn.peer);
        }
        if (conn === currentConnection) {
            currentConnection = null;
        }
    });

    conn.on('error', (err) => {
        console.error(`PeerJS: DataConnection.on("error") with ${conn.peer}:`, err.type, err.message || err);
        if (currentOnErrorCallback) {
            currentOnErrorCallback({type: 'connection_error', peer: conn.peer, originalError: err});
        }
    });
}

function connectToPeer(hostPeerId) {
    if (!peer || peer.destroyed) {
        console.error("PeerJS: connectToPeer - Peer object not initialized or destroyed.");
        currentOnErrorCallback({type: 'not_initialized', message: 'PeerJS not initialized for connectToPeer.'});
        return null;
    }
    if (currentConnection && currentConnection.open && currentConnection.peer === hostPeerId) {
        console.warn(`PeerJS: connectToPeer - Already connected to ${hostPeerId}.`);
        return currentConnection;
    }
    if (currentConnection && currentConnection.peer === hostPeerId && !currentConnection.open) {
        console.warn(`PeerJS: connectToPeer - Already attempting to connect to ${hostPeerId}.`);
        return currentConnection;
    }
     if (currentConnection && currentConnection.open && currentConnection.peer !== hostPeerId) {
        console.warn(`PeerJS: connectToPeer - Already connected to a different peer (${currentConnection.peer}). Closing it before connecting to ${hostPeerId}.`);
        currentConnection.close();
        currentConnection = null;
    }

    // console.log(`PeerJS: Attempting to connect to host with ID: ${hostPeerId}`);
    let newConnection = null;
    try {
        newConnection = peer.connect(hostPeerId, {
            reliable: true,
            serialization: 'json'
        });

        if (!newConnection) {
            console.error("PeerJS: peer.connect() returned null or undefined.");
            currentOnErrorCallback({type: 'connect_failed', message: 'peer.connect() failed to return a connection object.', peerId: hostPeerId });
            return null;
        }
        currentConnection = newConnection;
        setupConnectionEventHandlers(currentConnection);
        return currentConnection;

    } catch (error) {
        console.error("PeerJS: Error when trying to call peer.connect():", error);
        currentOnErrorCallback({type: 'connect_exception', message: 'Exception during peer.connect().', peerId: hostPeerId, originalError: error });
        return null;
    }
}


function sendData(data, connToSendTo = null) {
    const targetConn = connToSendTo || currentConnection;

    if (targetConn && targetConn.open) {
        try {
            targetConn.send(data);
        } catch (error) {
            console.error("PeerJS: Error sending data:", error);
            if (currentOnErrorCallback) currentOnErrorCallback({type: 'send_error', message: 'Failed to send data.', originalError: error});
        }
    } else {
        console.warn("PeerJS: No open connection or connection not ready/specified. Cannot send data.");
        if (currentOnErrorCallback && (!targetConn || !targetConn.open) ) {
             currentOnErrorCallback({type: 'send_error_no_connection', message: 'No open connection to send data.'});
        }
    }
}

function closePeerSession() {
    // console.log("PeerJS: Closing peer session (destroying local peer object)...");
    if (currentConnection) {
        try {
            if (currentConnection.open) {
                currentConnection.close();
            }
        } catch (e) {
            // console.warn("PeerJS: Error closing main data connection", e);
        }
        currentConnection = null;
    }

    if (peer) {
        try {
            if (!peer.destroyed) {
                // console.log("PeerJS: Calling peer.destroy().");
                peer.destroy();
            } else {
                // console.log("PeerJS: Peer object was already destroyed.");
            }
        } catch (e) {
            // console.warn("PeerJS: Error destroying peer object", e);
        }
        peer = null;
    }
    localPeerId = null;
}

function getLocalPeerId() {
    return localPeerId;
}

function getPeer() {
    return peer;
}

function getConnection(targetPeerId) {
    if (!peer || peer.destroyed) {
        // console.warn("getConnection: Peer object not available or destroyed.");
        return null;
    }

    if (currentConnection && currentConnection.peer === targetPeerId && currentConnection.open) {
        return currentConnection;
    }

    if (peer.connections && peer.connections[targetPeerId]) {
        const connectionsToPeer = peer.connections[targetPeerId];
        for (let i = 0; i < connectionsToPeer.length; i++) {
            if (connectionsToPeer[i].open) {
                return connectionsToPeer[i];
            }
        }
    }
    return null;
}

// Expose the functions through a global object, or export if using modules
if (typeof window !== 'undefined') {
    window.peerJsMultiplayer = {
        init: initPeerSession,
        connect: connectToPeer,
        send: sendData,
        close: closePeerSession,
        getLocalId: getLocalPeerId,
        getPeer: getPeer,
        getConnection: getConnection
    };
    // console.log("PeerJS multiplayer script loaded and attached to window.peerJsMultiplayer.");
} else if (typeof module !== 'undefined' && module.exports) {
    // For Node.js environments if ever needed (primarily for testing)
    module.exports = {
        init: initPeerSession,
        connect: connectToPeer,
        send: sendData,
        close: closePeerSession,
        getLocalId: getLocalPeerId,
        getPeer: getPeer,
        getConnection: getConnection
    };
}