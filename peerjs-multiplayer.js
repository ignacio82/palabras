// peerjs-multiplayer.js
// console.log("DEBUG: peerjs-multiplayer.js script execution started."); 

let peer = null;
let currentConnection = null; // Represents a single primary connection (client-to-host or host-to-first-client if simplified)
                               // For a host handling multiple clients, `peer.connections` is the source of truth.
let localPeerId = null;

// Default callbacks
let onPeerOpenCallback_default = (id) => console.log('PeerJS: Default (Global) - My peer ID is:', id);
let onConnectionOpenCallback_default = (peerId) => console.log('PeerJS: Default (Global) - Connection opened with:', peerId);
let onDataReceivedCallback_default = (data, peerId) => console.log('PeerJS: Default (Global) - Data received from:', peerId, data);
let onConnectionCloseCallback_default = (peerId) => console.log('PeerJS: Default (Global) - Connection closed with:', peerId);
let onErrorCallback_default = (err) => console.error('PeerJS: Default (Global) - Error:', err.type, err.message || err);
let onNewConnectionCallback_default = (conn) => {
    console.log('PeerJS: Default (Global) - New incoming connection from:', conn.peer);
    // Default behavior: if already connected, reject new one.
    // This is very basic; multi-connection scenarios (host) need more logic in the main app.
    if (currentConnection && currentConnection.open) {
        console.warn("PeerJS: Default - Already have an open connection. Closing new one from", conn.peer);
        conn.on('open', () => conn.close());
        return;
    }
    currentConnection = conn;
    setupConnectionEventHandlers(currentConnection); // Setup handlers for this new connection
};

// Module-level variables to hold the currently registered callbacks from the main application
let currentOnPeerOpenCallback = onPeerOpenCallback_default;
let currentOnConnectionOpenCallback = onConnectionOpenCallback_default;
let currentOnDataReceivedCallback = onDataReceivedCallback_default;
let currentOnConnectionCloseCallback = onConnectionCloseCallback_default;
let currentOnErrorCallback = onErrorCallback_default;
let currentOnNewConnectionCallback = onNewConnectionCallback_default;


function initPeerSession(options = {}, callbacks = {}) { 
    if (peer && !peer.destroyed) {
        console.warn("PeerJS: Peer object already exists and is not destroyed. Closing existing session before creating a new one.");
        closePeerSession(); // Attempt to clean up existing peer
    } else if (peer && peer.destroyed) {
        console.log("PeerJS: Peer object was already destroyed. Ready for new initialization.");
        peer = null; // Ensure peer is null for re-initialization
    }

    // Register callbacks provided by the application
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

        let peerIdToUse = null; // Default: let PeerJS assign an ID
        let peerOptionsFromApp = { ...options }; // Clone options from app

        // Default PeerJS STUN servers (can be overridden by options from app)
        let finalPeerJsConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
            ]
        };
        if(peerOptionsFromApp.config) { // Merge app's config with defaults
            finalPeerJsConfig = {...finalPeerJsConfig, ...peerOptionsFromApp.config};
        }
        peerOptionsFromApp.config = finalPeerJsConfig; // Set merged config back


        if (peerOptionsFromApp.peerId) { // If app specified a peerId in the options object
            peerIdToUse = peerOptionsFromApp.peerId;
            delete peerOptionsFromApp.peerId; // Remove from options passed to Peer constructor directly
        }
        
        // Ensure options has the correct structure expected by PeerJS constructor
        const peerConstructorOptions = {
            key: peerOptionsFromApp.key, // API key for PeerServer Cloud (if used)
            host: peerOptionsFromApp.host,
            port: peerOptionsFromApp.port,
            path: peerOptionsFromApp.path,
            secure: peerOptionsFromApp.secure,
            config: peerOptionsFromApp.config, // STUN/TURN servers
            debug: peerOptionsFromApp.debug === undefined ? 2 : peerOptionsFromApp.debug, // 0:none,1:err,2:warn,3:all
        };
        
        // Remove undefined properties to avoid issues with PeerJS constructor
        Object.keys(peerConstructorOptions).forEach(key => peerConstructorOptions[key] === undefined && delete peerConstructorOptions[key]);


        console.log(`PeerJS: Initializing with ID: ${peerIdToUse || 'Auto-assigned'} and options:`, peerConstructorOptions);
        peer = new Peer(peerIdToUse, peerConstructorOptions);

    } catch (error) {
        console.error("PeerJS: Failed to create Peer object.", error);
        currentOnErrorCallback({type: 'init_failed', message: 'Failed to create Peer object.', originalError: error});
        return;
    }

    peer.on('open', (id) => {
        localPeerId = id;
        console.log('PeerJS: Peer.on("open") event. My peer ID is:', id);
        if (currentOnPeerOpenCallback) {
            currentOnPeerOpenCallback(id);
        }
    });

    peer.on('connection', (conn) => { // This is for incoming connections
        console.log('PeerJS: Peer.on("connection") event. Incoming connection from', conn.peer);
        if (currentOnNewConnectionCallback) {
            // The application's onNewConnection callback is responsible for managing multiple connections (e.g., for a host)
            // and calling setupConnectionEventHandlers for each accepted connection.
            currentOnNewConnectionCallback(conn);
        } else {
            // Fallback if no specific handler from app (should not happen in Palabras)
            console.warn("PeerJS: No onNewConnectionCallback registered by app, using default limited handling.");
            onNewConnectionCallback_default(conn); // Uses the basic default handler
        }
    });

    // --- PATCH: Modify 'disconnected' handler ---
    peer.on('disconnected', () => {
        console.warn('PeerJS: Disconnected from PeerServer – trying to reconnect...');
        if (peer && !peer.destroyed) { // Check if peer exists and is not already destroyed
            try {
                peer.reconnect();
            } catch (e) {
                console.error("PeerJS: Error during peer.reconnect():", e);
                currentOnErrorCallback({type: 'reconnect_failed', message: 'Failed to reconnect to PeerServer.', originalError: e});
                // Optionally, trigger a full closePeerSession here if reconnect fails catastrophically
            }
        } else {
            console.warn("PeerJS: Peer was destroyed or null, cannot reconnect.");
        }
    });
    // --- END PATCH ---

    peer.on('close', () => { // This means the Peer object itself is destroyed
        console.log('PeerJS: Peer.on("close") event. Peer object fully closed and destroyed.');
        localPeerId = null;
        peer = null; // Ensure peer is marked as null after destruction
        // Note: The application's close callback (currentOnConnectionCloseCallback) is for DataConnection close, not Peer close.
        // If the app needs to know the Peer itself closed, it should handle it via error or a specific callback for Peer close if added.
    });

    peer.on('error', (err) => {
        console.error('PeerJS: Peer.on("error") event:', err.type, err.message || err);
        if (currentOnErrorCallback) {
            currentOnErrorCallback(err); // Forward error to the application
        }
        // Certain errors might necessitate a full Peer shutdown, e.g., 'network', 'server-error', 'socket-error' if not recoverable.
        // Example: if (err.type === 'network' || err.type === 'server-error') closePeerSession();
    });
}

// Sets up event handlers for a single DataConnection object
function setupConnectionEventHandlers(conn) {
    conn.on('open', () => {
        console.log(`PeerJS: DataConnection.on("open") with ${conn.peer}. Ready to send/receive data.`);
        if (currentOnConnectionOpenCallback) {
            currentOnConnectionOpenCallback(conn.peer); // Notify app that this specific connection is open
        }
    });

    conn.on('data', (data) => {
        // console.log(`PeerJS: DataConnection.on("data") from ${conn.peer}:`, data); // Can be very verbose
        if (currentOnDataReceivedCallback) {
            currentOnDataReceivedCallback(data, conn.peer); // Pass data to application's handler
        }
    });

    conn.on('close', () => { // This DataConnection closed
        console.log(`PeerJS: DataConnection.on("close") with ${conn.peer}.`);
        if (currentOnConnectionCloseCallback) {
            currentOnConnectionCloseCallback(conn.peer); // Notify app
        }
        // If this was the 'primary' tracked currentConnection, nullify it. App needs to manage its own list for multi-peer.
        if (conn === currentConnection) {
            currentConnection = null;
        }
        // The application (e.g., pizarraPeerConnection) should manage its list of connections and remove this one.
    });

    conn.on('error', (err) => { // Error on this specific DataConnection
        console.error(`PeerJS: DataConnection.on("error") with ${conn.peer}:`, err.type, err.message || err);
        if (currentOnErrorCallback) {
            currentOnErrorCallback({type: 'connection_error', peer: conn.peer, originalError: err});
        }
    });
}

// Attempts to connect to a remote peer
function connectToPeer(hostPeerId, options = {}) { // options can include {reliable: true, serialization: 'json', metadata: {...}}
    if (!peer || peer.destroyed) {
        console.error("PeerJS: connectToPeer - Peer object not initialized or destroyed.");
        currentOnErrorCallback({type: 'not_initialized', message: 'PeerJS not initialized for connectToPeer.'});
        return null;
    }
    // Application should manage if it's already connected or trying to connect to this peer via its own logic.
    // This function just initiates a new connection attempt via PeerJS.

    console.log(`PeerJS: Attempting to connect to host with ID: ${hostPeerId}`);
    let newConnection = null;
    try {
        const connectionOptions = {
            reliable: options.reliable === undefined ? true : options.reliable,
            serialization: options.serialization || 'json',
            metadata: options.metadata
        };
        newConnection = peer.connect(hostPeerId, connectionOptions);

        if (!newConnection) { // Should not happen with modern PeerJS if peer object exists
            console.error("PeerJS: peer.connect() returned null or undefined. This is unexpected.");
            currentOnErrorCallback({type: 'connect_failed', message: 'peer.connect() failed to return a connection object.', peerId: hostPeerId });
            return null;
        }
        
        // Important: Event handlers for this new outbound connection must be set up by the caller (main app)
        // or by the 'connection' event on the remote peer's side (for their end of it).
        // For the local end of this new outbound connection, we set them up here.
        console.log(`PeerJS: Connection object created for ${hostPeerId}. Setting up its event handlers.`);
        setupConnectionEventHandlers(newConnection); // Setup handlers for this outgoing connection immediately
        
        // The application (pizarraPeerConnection) will use this returned connection object.
        // It might replace its 'leaderConnection' with this.
        currentConnection = newConnection; // Track this as the primary outgoing connection if in client mode.
        return newConnection;

    } catch (error) {
        console.error(`PeerJS: Error when trying to call peer.connect() to ${hostPeerId}:`, error);
        currentOnErrorCallback({type: 'connect_exception', message: 'Exception during peer.connect().', peerId: hostPeerId, originalError: error });
        return null;
    }
}


// Sends data over a specific DataConnection or the 'currentConnection'
function sendData(data, connToSendTo = null) {
    const targetConn = connToSendTo || currentConnection; // Fallback to primary connection

    if (targetConn && targetConn.open) {
        try {
            targetConn.send(data);
        } catch (error) { // Should be rare if .open is true
            console.error(`PeerJS: Error sending data to ${targetConn.peer}:`, error, data);
            if (currentOnErrorCallback) currentOnErrorCallback({type: 'send_error', message: 'Failed to send data.', peer: targetConn.peer, originalError: error});
        }
    } else {
        const targetPeerInfo = targetConn ? targetConn.peer : "unspecified connection";
        console.warn(`PeerJS: No open connection or connection not ready/specified for ${targetPeerInfo}. Cannot send data.`, data);
        if (currentOnErrorCallback && (!targetConn || !targetConn.open) ) {
             currentOnErrorCallback({type: 'send_error_no_connection', message: `No open connection to ${targetPeerInfo} to send data.`});
        }
    }
}

// Closes all connections and destroys the local Peer object
function closePeerSession() {
    console.log("PeerJS: Closing peer session (destroying local peer object)...");
    
    // Close all active connections associated with this peer
    if (peer && peer.connections) {
        Object.keys(peer.connections).forEach(peerId => {
            peer.connections[peerId].forEach(conn => {
                if (conn.close) conn.close();
            });
        });
    }
    // Also close the tracked 'currentConnection' if it exists
    if (currentConnection && currentConnection.close) {
        try { currentConnection.close(); } 
        catch (e) { console.warn("PeerJS: Error closing main data connection", e); }
        currentConnection = null;
    }

    if (peer) {
        try {
            if (!peer.destroyed) {
                console.log("PeerJS: Calling peer.destroy().");
                peer.destroy(); // This will trigger the 'close' event on the peer
            } else {
                console.log("PeerJS: Peer object was already destroyed.");
            }
        } catch (e) {
            console.warn("PeerJS: Error destroying peer object", e);
        }
        // peer = null; // Peer becomes null in the 'close' event handler for the peer
    }
    // localPeerId = null; // localPeerId becomes null in the 'close' event handler for the peer
}

function getLocalPeerId() {
    return localPeerId;
}

function getPeer() { // Returns the raw PeerJS peer object
    return peer;
}

function getConnection(targetPeerId) { // Get a specific open connection from the peer's list
    if (!peer || peer.destroyed) {
        return null;
    }
    if (peer.connections && peer.connections[targetPeerId]) {
        // A peer can have multiple DataConnection objects to another peer, find an open one.
        const connectionsToPeer = peer.connections[targetPeerId];
        for (let i = 0; i < connectionsToPeer.length; i++) {
            if (connectionsToPeer[i].open) {
                return connectionsToPeer[i]; // Return the first open connection found
            }
        }
    }
    return null; // No open connection to this specific peer found
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
        getConnection: getConnection,
        setupConnectionEventHandlers // Expose this if app needs to manually set up handlers on connections it manages
    };
} else if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        init: initPeerSession,
        connect: connectToPeer,
        send: sendData,
        close: closePeerSession,
        getLocalId: getLocalPeerId,
        getPeer: getPeer,
        getConnection: getConnection,
        setupConnectionEventHandlers
    };
}