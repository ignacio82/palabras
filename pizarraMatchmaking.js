// pizarraMatchmaking.js
// Adapted from Cajitas' matchmaking_supabase.js for Palabras game

import * as state from './pizarraState.js'; // For PIZARRA_PEER_ID_PREFIX

// IMPORTANT: Supabase URL and Anon Key are assumed to be the same as your Cajitas game.
// If Palabras uses a different Supabase project, update these.
const SUPABASE_URL = "https://lunxhfsvlfyhqehpirdi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1bnhoZnN2bGZ5aHFlaHBpcmRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgzMDMzMzMsImV4cCI6MjA2Mzg3OTMzM30.iKEnrtSVjwTQhB8OLahTANJzvCamR60bjhC6qvTtwxU";

let supabase = null;
const MATCHMAKING_TABLE = 'matchmaking_queue_pizarra'; // Updated for Palabras
const GAME_TYPE_IDENTIFIER = 'pizarra_de_palabras';   // Updated for Palabras
const ROOM_EXPIRATION_MINUTES = 5;
const ROOM_REFRESH_INTERVAL_MS = 30 * 1000; // 30 seconds

let localPlayerHostedRoomId_Supabase = null; // Stores the prefixed room_id (host's PeerJS ID)
let hostRefreshIntervalId = null;
let refreshFailures = 0;
const MAX_REFRESH_FAILURES = 5; // Added constant for clarity

function initSupabase() {
    if (!supabase && window.supabase && typeof window.supabase.createClient === 'function') {
        try {
            supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log('[PizarraMatchmaking] Supabase client initialized.');
            return true;
        } catch (e) {
            console.error('[PizarraMatchmaking] Error initializing Supabase client:', e);
            supabase = null;
            return false;
        }
    } else if (supabase) {
        return true; // Already initialized
    }
    console.error('[PizarraMatchmaking] Supabase library (supabase-js) not found on window object.');
    return false;
}

function cleanupMatchmakingState() {
    // console.log('[PizarraMatchmaking] Cleaning up matchmaking state (interval).'); // Less verbose
    if (hostRefreshIntervalId) {
        clearInterval(hostRefreshIntervalId);
        hostRefreshIntervalId = null;
    }
    refreshFailures = 0;
    // localPlayerHostedRoomId_Supabase is cleared by leaveQueue or when starting a new queue join/host
}

async function refreshRoomExpiration(roomIdToRefresh) {
    if (!initSupabase() || !roomIdToRefresh) return; // Ensure Supabase is init
    try {
        const newExpiration = new Date(Date.now() + ROOM_EXPIRATION_MINUTES * 60 * 1000).toISOString();
        const { error } = await supabase
            .from(MATCHMAKING_TABLE)
            .update({ expires_at: newExpiration, updated_at: new Date().toISOString() })
            .eq('room_id', roomIdToRefresh)
            .eq('status', 'hosting_waiting_for_players'); // Only refresh active waiting rooms

        if (error) {
            refreshFailures++;
            console.warn(`[PizarraMatchmaking] Room expiration refresh failed (${refreshFailures}/${MAX_REFRESH_FAILURES}):`, error.message);
            if (refreshFailures >= MAX_REFRESH_FAILURES) {
                console.error('[PizarraMatchmaking] Too many refresh failures. Stopping refresh interval. Room may expire.');
                clearInterval(hostRefreshIntervalId);
                hostRefreshIntervalId = null;
            }
        } else {
            refreshFailures = 0; // Reset on success
            // console.log(`[PizarraMatchmaking] Room ${roomIdToRefresh} expiration refreshed.`); // Can be verbose
        }
    } catch (e) {
        console.error(`[PizarraMatchmaking] Exception during refreshRoomExpiration for ${roomIdToRefresh}:`, e);
    }
}

async function cleanupStaleRooms() {
    if (!initSupabase()) return;
    try {
        const nowISO = new Date().toISOString();
        const { data, error } = await supabase
            .from(MATCHMAKING_TABLE)
            .delete()
            .lt('expires_at', nowISO); // Less than current time means expired

        if (error) {
            console.warn('[PizarraMatchmaking] Error during stale room cleanup:', error.message);
        } else if (data && data.length > 0) {
            console.log(`[PizarraMatchmaking] Cleaned up ${data.length} stale room(s).`);
        }
    } catch (e) {
        console.error('[PizarraMatchmaking] Exception during stale room cleanup:', e);
    }
}

export async function removeDeadRoomByPeerId(deadRawPeerId) {
    if (!initSupabase() || !deadRawPeerId) return;
    const deadRoomIdWithPrefix = `${state.PIZARRA_PEER_ID_PREFIX}${deadRawPeerId}`; // Updated prefix
    console.log(`[PizarraMatchmaking] Attempting to remove dead room: ${deadRoomIdWithPrefix}`);
    try {
        const { data, error } = await supabase
            .from(MATCHMAKING_TABLE)
            .delete()
            .eq('room_id', deadRoomIdWithPrefix); // room_id is the host's prefixed PeerJS ID

        if (error) console.warn(`[PizarraMatchmaking] Failed to clean up dead room ${deadRoomIdWithPrefix}:`, error.message);
        else if (data && data.length > 0) console.log(`[PizarraMatchmaking] Cleaned up dead room: ${deadRoomIdWithPrefix}`);
        else console.log(`[PizarraMatchmaking] No room found with ID ${deadRoomIdWithPrefix} to clean up.`);
    } catch (e) {
        console.error(`[PizarraMatchmaking] Exception cleaning up dead room ${deadRoomIdWithPrefix}:`, e);
    }
}

export async function joinQueue(localRawPeerId, myPlayerData, preferences, callbacks) {
    if (!initSupabase()) {
        callbacks.onError?.('Servicio de matchmaking no disponible.');
        return;
    }
    if (!localRawPeerId) {
        callbacks.onError?.('ID de jugador local inválido para matchmaking.');
        return;
    }

    cleanupMatchmakingState();
    await cleanupStaleRooms();

    callbacks.onSearching?.();
    const localPrefixedPeerId = `${state.PIZARRA_PEER_ID_PREFIX}${localRawPeerId}`; // Updated prefix

    await leaveQueue(localRawPeerId, false); // Remove any existing listing for this peer

    try {
        const nowISO = new Date().toISOString();
        // Client looks for rooms matching their preferred maxPlayers and game type
        // and game settings (e.g. difficulty for Palabras)
        const { data: openRooms, error: fetchError } = await supabase
            .from(MATCHMAKING_TABLE)
            .select('*')
            .eq('status', 'hosting_waiting_for_players')
            .eq('game_type', GAME_TYPE_IDENTIFIER) // Updated game type
            .lt('current_players', preferences.maxPlayers) // Room has space for at least one more
            .gte('max_players', preferences.maxPlayers) // Room's max capacity is at least what client prefers
            // Palabras specific: filter by difficulty if 'preferences.gameSettings.difficulty' is provided
            .eq('game_settings->>difficulty', preferences.gameSettings.difficulty)
            .gt('expires_at', nowISO) // Room is not expired
            .neq('peer_id', localPrefixedPeerId) // Don't join own room listing
            .order('created_at', { ascending: true });

        if (fetchError) {
            console.error('[PizarraMatchmaking] Error fetching open rooms:', fetchError);
            callbacks.onError?.(`Error buscando salas: ${fetchError.message}`);
            return;
        }

        if (openRooms && openRooms.length > 0) {
            const suitableRoom = openRooms[0];
            console.log('[PizarraMatchmaking] Found suitable room to join:', suitableRoom);
            const leaderRawPeerId = suitableRoom.room_id.startsWith(state.PIZARRA_PEER_ID_PREFIX) // Updated prefix
                ? suitableRoom.room_id.substring(state.PIZARRA_PEER_ID_PREFIX.length)
                : suitableRoom.room_id;

            callbacks.onMatchFoundAndJoiningRoom?.(
                leaderRawPeerId, // Pass the raw PeerJS ID for connection
                { // Pass room data that might be useful for the client
                    maxPlayers: suitableRoom.max_players,
                    gameSettings: suitableRoom.game_settings, // e.g., { difficulty: "easy" }
                    currentPlayers: suitableRoom.current_players
                }
            );
            return;
        }

        // No suitable room found, so this player becomes a host.
        console.log('[PizarraMatchmaking] No suitable rooms. Becoming a host.');
        localPlayerHostedRoomId_Supabase = localPrefixedPeerId; // This client is hosting

        const newRoomEntry = {
            peer_id: localPrefixedPeerId, // Who created this entry (host's prefixed ID)
            room_id: localPrefixedPeerId, // The connectable ID for this room (host's prefixed PeerJS ID)
            status: 'hosting_waiting_for_players',
            game_type: GAME_TYPE_IDENTIFIER, // Updated game type
            max_players: preferences.maxPlayers,
            current_players: 1, // Host themselves
            game_settings: preferences.gameSettings, // e.g., { difficulty: "easy" } for Palabras
            expires_at: new Date(Date.now() + ROOM_EXPIRATION_MINUTES * 60 * 1000).toISOString()
        };

        const { error: insertError } = await supabase.from(MATCHMAKING_TABLE).insert(newRoomEntry);

        if (insertError) {
            console.error('[PizarraMatchmaking] Error inserting new room:', insertError);
            callbacks.onError?.(`No se pudo crear una nueva sala: ${insertError.message}`);
            localPlayerHostedRoomId_Supabase = null;
            return;
        }

        hostRefreshIntervalId = setInterval(() => {
            refreshRoomExpiration(localPlayerHostedRoomId_Supabase);
        }, ROOM_REFRESH_INTERVAL_MS);

        callbacks.onMatchFoundAndHostingRoom?.(
            localRawPeerId, // Own raw PeerJS ID to use for hosting
            { // Initial data for the host's room state
                maxPlayers: preferences.maxPlayers,
                gameSettings: preferences.gameSettings,
            }
        );

    } catch (error) {
        console.error('[PizarraMatchmaking] General exception in joinQueue:', error);
        callbacks.onError?.('Error inesperado durante el matchmaking.');
    }
}

export async function leaveQueue(localRawPeerIdToLeave = null, performFullCleanup = true) {
    const peerIdToRemoveFromListing = localRawPeerIdToLeave
        ? `${state.PIZARRA_PEER_ID_PREFIX}${localRawPeerIdToLeave}` // Updated prefix
        : localPlayerHostedRoomId_Supabase;

    if (performFullCleanup) {
        cleanupMatchmakingState();
    } else if (hostRefreshIntervalId && peerIdToRemoveFromListing === localPlayerHostedRoomId_Supabase) {
        clearInterval(hostRefreshIntervalId);
        hostRefreshIntervalId = null;
    }

    if (peerIdToRemoveFromListing && initSupabase()) { // Ensure Supabase is init
        console.log(`[PizarraMatchmaking] Removing listing for room/peer: ${peerIdToRemoveFromListing}`);
        try {
            const { error } = await supabase
                .from(MATCHMAKING_TABLE)
                .delete()
                .eq('room_id', peerIdToRemoveFromListing);

            if (error) console.warn('[PizarraMatchmaking] Error removing entry from Supabase:', error.message);
            else console.log('[PizarraMatchmaking] Successfully removed listing from Supabase.');
        } catch (dbError) {
            console.error('[PizarraMatchmaking] Exception during Supabase delete in leaveQueue:', dbError);
        }
    }

    if (peerIdToRemoveFromListing === localPlayerHostedRoomId_Supabase) {
        localPlayerHostedRoomId_Supabase = null;
    }
}

export async function updateHostedRoomStatus(hostRawPeerId, gameSettings, maxPlayers, currentPlayers, newStatus = null) {
    if (!initSupabase() || !hostRawPeerId) return;

    const hostPrefixedPeerId = `${state.PIZARRA_PEER_ID_PREFIX}${hostRawPeerId}`; // Updated prefix

    let statusToSet = newStatus;
    if (!statusToSet) {
        // networkRoomData might not be available here directly if this module is generic.
        // Rely on passed parameters or determine status based on them.
        // For Palabras, roomState 'playing' would be 'in_game'.
        // This function is usually called by host with explicit status or based on player count.
        if (currentPlayers >= maxPlayers) {
            statusToSet = 'full';
        } else {
            statusToSet = 'hosting_waiting_for_players';
        }
        // If newStatus is 'in_game', it will be handled below.
    }

    const updatePayload = {
        current_players: currentPlayers,
        status: statusToSet,
        game_settings: gameSettings, // For Palabras, this would be { difficulty: "..." }
        max_players: maxPlayers,
        updated_at: new Date().toISOString() // Good practice to add
    };

    if (statusToSet === 'hosting_waiting_for_players') {
        updatePayload.expires_at = new Date(Date.now() + ROOM_EXPIRATION_MINUTES * 60 * 1000).toISOString();
        if (hostPrefixedPeerId === localPlayerHostedRoomId_Supabase && !hostRefreshIntervalId) {
            hostRefreshIntervalId = setInterval(() => refreshRoomExpiration(localPlayerHostedRoomId_Supabase), ROOM_REFRESH_INTERVAL_MS);
        }
    } else if (statusToSet === 'full' || statusToSet === 'in_game') {
        if (hostPrefixedPeerId === localPlayerHostedRoomId_Supabase && hostRefreshIntervalId) {
            clearInterval(hostRefreshIntervalId);
            hostRefreshIntervalId = null;
        }
        updatePayload.expires_at = null; // Rooms in game or full don't expire from queue this way
    }

    const { error } = await supabase
        .from(MATCHMAKING_TABLE)
        .update(updatePayload)
        .eq('room_id', hostPrefixedPeerId);

    if (error) console.error(`[PizarraMatchmaking] Error updating room ${hostPrefixedPeerId} to status ${statusToSet}:`, error);
    else console.log(`[PizarraMatchmaking] Room ${hostPrefixedPeerId} status updated to ${statusToSet}. Players: ${currentPlayers}/${maxPlayers}`);
}

// Initialize Supabase client when script loads
initSupabase();