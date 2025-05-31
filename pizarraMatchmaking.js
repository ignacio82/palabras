// pizarraMatchmaking.js
// Adapted from Cajitas' matchmaking_supabase.js for Palabras game

import * as state from './pizarraState.js'; // For PIZARRA_PEER_ID_PREFIX

const SUPABASE_URL = "https://lunxhfsvlfyhqehpirdi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1bnhoZnN2bGZ5aHFlaHBpcmRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgzMDMzMzMsImV4cCI6MjA2Mzg3OTMzM30.iKEnrtSVjwTQhB8OLahTANJzvCamR60bjhC6qvTtwxU";

let supabase = null;
const MATCHMAKING_TABLE = 'matchmaking_queue_pizarra'; 
const GAME_TYPE_IDENTIFIER = 'pizarra_de_palabras';   
const ROOM_EXPIRATION_MINUTES = 5;
const ROOM_REFRESH_INTERVAL_MS = 30 * 1000; 

let localPlayerHostedRoomId_Supabase = null; 
let hostRefreshIntervalId = null;
let refreshFailures = 0;
const MAX_REFRESH_FAILURES = 5; 

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
        return true; 
    }
    console.error('[PizarraMatchmaking] Supabase library (supabase-js) not found on window object.');
    return false;
}

function cleanupMatchmakingState() {
    if (hostRefreshIntervalId) {
        clearInterval(hostRefreshIntervalId);
        hostRefreshIntervalId = null;
    }
    refreshFailures = 0;
}

async function refreshRoomExpiration(roomIdToRefresh) {
    if (!initSupabase() || !roomIdToRefresh) return; 
    try {
        const newExpiration = new Date(Date.now() + ROOM_EXPIRATION_MINUTES * 60 * 1000).toISOString();
        const { error } = await supabase
            .from(MATCHMAKING_TABLE)
            .update({ expires_at: newExpiration, updated_at: new Date().toISOString() })
            .eq('room_id', roomIdToRefresh) // room_id is likely the primary key for the room entry
            .eq('status', 'hosting_waiting_for_players'); 

        if (error) {
            refreshFailures++;
            console.warn(`[PizarraMatchmaking] Room expiration refresh failed (${refreshFailures}/${MAX_REFRESH_FAILURES}):`, error.message);
            if (refreshFailures >= MAX_REFRESH_FAILURES) {
                console.error('[PizarraMatchmaking] Too many refresh failures. Stopping refresh interval. Room may expire.');
                clearInterval(hostRefreshIntervalId);
                hostRefreshIntervalId = null;
            }
        } else {
            refreshFailures = 0; 
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
            .lt('expires_at', nowISO); 

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
    if (!initSupabase() || !deadRawPeerId) {
        console.warn(`[PizarraMatchmaking] removeDeadRoomByPeerId: Invalid input. deadRawPeerId: '${deadRawPeerId}', Supabase initialized: ${!!supabase}`);
        return;
    }
    // Assuming room_id stores the prefixed peer ID, which acts as the unique room identifier
    const deadRoomIdWithPrefix = `${state.PIZARRA_PEER_ID_PREFIX}${deadRawPeerId}`; 
    console.log(`[PizarraMatchmaking] Attempting to remove dead room (using room_id): ${deadRoomIdWithPrefix}`);
    try {
        const { data, error } = await supabase
            .from(MATCHMAKING_TABLE)
            .delete()
            .eq('room_id', deadRoomIdWithPrefix); // Rooms are identified by room_id

        if (error) console.warn(`[PizarraMatchmaking] Failed to clean up dead room ${deadRoomIdWithPrefix}:`, error.message);
        else if (data && data.length > 0) console.log(`[PizarraMatchmaking] Cleaned up dead room: ${deadRoomIdWithPrefix}`);
        else console.log(`[PizarraMatchmaking] No room found with ID ${deadRoomIdWithPrefix} to clean up.`);
    } catch (e) {
        console.error(`[PizarraMatchmaking] Exception cleaning up dead room ${deadRoomIdWithPrefix}:`, e);
    }
}

export async function joinQueue(localRawPeerId, myPlayerData, preferences, callbacks) {
    if (!callbacks || typeof callbacks !== 'object') {
        console.error('[PizarraMatchmaking] joinQueue: callbacks object is required');
        return;
    }
    
    if (!initSupabase()) {
        if (callbacks.onError) callbacks.onError('Servicio de matchmaking no disponible.');
        return;
    }
    
    if (!localRawPeerId || typeof localRawPeerId !== 'string') {
        console.error(`[PizarraMatchmaking] joinQueue: Invalid localRawPeerId: '${localRawPeerId}'`);
        if (callbacks.onError) callbacks.onError(`ID de jugador local inválido para matchmaking.`);
        return;
    }

    if (!myPlayerData || !preferences) {
        console.error('[PizarraMatchmaking] joinQueue: myPlayerData and preferences are required');
        if (callbacks.onError) callbacks.onError('Datos de jugador o preferencias faltantes.');
        return;
    }

    cleanupMatchmakingState();
    await cleanupStaleRooms();

    if (callbacks.onSearching) callbacks.onSearching();
    const localPrefixedPeerId = `${state.PIZARRA_PEER_ID_PREFIX}${localRawPeerId}`; 

    await leaveQueue(localRawPeerId, false); 

    try {
        const nowISO = new Date().toISOString();
        const { data: openRooms, error: fetchError } = await supabase
            .from(MATCHMAKING_TABLE)
            .select('*') // Select all to get room_id and other details
            .eq('status', 'hosting_waiting_for_players')
            .eq('game_type', GAME_TYPE_IDENTIFIER) 
            .lt('current_players', preferences.maxPlayers) 
            .gte('max_players', preferences.maxPlayers) 
            .eq('game_settings->>difficulty', preferences.gameSettings.difficulty)
            .gt('expires_at', nowISO) 
             // Ensure we don't try to join our own room if it somehow existed with a different host_peer_id
            .neq('host_peer_id', localPrefixedPeerId) // Check against host_peer_id
            .order('created_at', { ascending: true });

        if (fetchError) {
            console.error('[PizarraMatchmaking] Error fetching open rooms:', fetchError);
            if (callbacks.onError) callbacks.onError(`Error buscando salas: ${fetchError.message}`);
            return;
        }

        if (openRooms && openRooms.length > 0) {
            const suitableRoom = openRooms[0];
            console.log('[PizarraMatchmaking] Found suitable room to join:', suitableRoom);
            // The room_id is the identifier for joining.
            // The actual host's PeerJS ID is stored in host_peer_id.
            // We need to extract the raw peer ID from room_id (which is host_peer_id with prefix)
            // or directly use suitableRoom.host_peer_id if it's the non-prefixed one.
            // Assuming suitableRoom.room_id is the prefixed one.
            const leaderRawPeerId = suitableRoom.room_id.startsWith(state.PIZARRA_PEER_ID_PREFIX) 
                ? suitableRoom.room_id.substring(state.PIZARRA_PEER_ID_PREFIX.length)
                : suitableRoom.room_id; // Fallback if room_id is not prefixed (should be consistent)

            if (callbacks.onMatchFoundAndJoiningRoom) {
                callbacks.onMatchFoundAndJoiningRoom(
                    leaderRawPeerId, 
                    { 
                        maxPlayers: suitableRoom.max_players,
                        gameSettings: suitableRoom.game_settings, 
                        currentPlayers: suitableRoom.current_players
                    }
                );
            }
            return;
        }

        console.log('[PizarraMatchmaking] No suitable rooms. Becoming a host.');
        // When hosting, our localPrefixedPeerId is both the room_id and the host_peer_id
        localPlayerHostedRoomId_Supabase = localPrefixedPeerId; // This is the room_id

        const newRoomEntry = {
            host_peer_id: localPrefixedPeerId, // Store the host's actual prefixed PeerJS ID
            room_id: localPrefixedPeerId,      // The room is identified by the host's prefixed PeerJS ID
            status: 'hosting_waiting_for_players',
            game_type: GAME_TYPE_IDENTIFIER, 
            max_players: preferences.maxPlayers,
            current_players: 1, 
            game_settings: preferences.gameSettings, 
            expires_at: new Date(Date.now() + ROOM_EXPIRATION_MINUTES * 60 * 1000).toISOString()
        };

        const { error: insertError } = await supabase.from(MATCHMAKING_TABLE).insert(newRoomEntry);

        if (insertError) {
            console.error('[PizarraMatchmaking] Error inserting new room:', insertError);
            if (callbacks.onError) callbacks.onError(`No se pudo crear una nueva sala: ${insertError.message}`);
            localPlayerHostedRoomId_Supabase = null;
            return;
        }

        hostRefreshIntervalId = setInterval(() => {
            refreshRoomExpiration(localPlayerHostedRoomId_Supabase); // Refresh using room_id
        }, ROOM_REFRESH_INTERVAL_MS);

        if (callbacks.onMatchFoundAndHostingRoom) {
            callbacks.onMatchFoundAndHostingRoom(
                localRawPeerId, 
                { 
                    maxPlayers: preferences.maxPlayers,
                    gameSettings: preferences.gameSettings,
                }
            );
        }

    } catch (error) {
        console.error('[PizarraMatchmaking] General exception in joinQueue:', error);
        if (callbacks.onError) callbacks.onError('Error inesperado durante el matchmaking.');
    }
}

export async function leaveQueue(localRawPeerIdToLeave = null, performFullCleanup = true) {
    console.log(`[PizarraMatchmaking] leaveQueue called. PeerID (raw) to leave: '${localRawPeerIdToLeave}', Type: ${typeof localRawPeerIdToLeave}. Full cleanup: ${performFullCleanup}`);
    
    let roomIdToRemove; // This will be the prefixed ID, used as room_id
    if (localRawPeerIdToLeave && typeof localRawPeerIdToLeave === 'string') {
        roomIdToRemove = `${state.PIZARRA_PEER_ID_PREFIX}${localRawPeerIdToLeave}`;
    } else if (localPlayerHostedRoomId_Supabase && typeof localPlayerHostedRoomId_Supabase === 'string') {
        // localPlayerHostedRoomId_Supabase already stores the prefixed ID which is the room_id
        roomIdToRemove = localPlayerHostedRoomId_Supabase;
    } else {
        console.warn(`[PizarraMatchmaking] leaveQueue: Cannot determine a valid string RoomID to remove. localRawPeerIdToLeave: '${localRawPeerIdToLeave}', localPlayerHostedRoomId_Supabase: '${localPlayerHostedRoomId_Supabase}'`);
        if (performFullCleanup) cleanupMatchmakingState();
        return;
    }

    console.log(`[PizarraMatchmaking] Effective room_id to remove from Supabase: ${roomIdToRemove}`);

    if (performFullCleanup) {
        cleanupMatchmakingState();
    } else if (hostRefreshIntervalId && roomIdToRemove === localPlayerHostedRoomId_Supabase) {
        clearInterval(hostRefreshIntervalId);
        hostRefreshIntervalId = null;
    }

    if (roomIdToRemove && initSupabase()) { 
        console.log(`[PizarraMatchmaking] Removing Supabase entry for room_id: ${roomIdToRemove}`);
        try {
            const { error } = await supabase
                .from(MATCHMAKING_TABLE)
                .delete()
                .eq('room_id', roomIdToRemove); // Delete based on room_id

            if (error) console.warn('[PizarraMatchmaking] Error removing entry from Supabase:', error.message);
            else console.log('[PizarraMatchmaking] Successfully removed listing from Supabase or it was already gone.');
        } catch (dbError) {
            console.error('[PizarraMatchmaking] Exception during Supabase delete in leaveQueue:', dbError);
        }
    }

    if (roomIdToRemove === localPlayerHostedRoomId_Supabase) {
        localPlayerHostedRoomId_Supabase = null;
    }
}

export async function updateHostedRoomStatus(hostRawPeerId, gameSettings, maxPlayers, currentPlayers, newStatus = null) {
    if (!initSupabase() || !hostRawPeerId || typeof hostRawPeerId !== 'string') {
        console.warn(`[PizarraMatchmaking] updateHostedRoomStatus: Invalid hostRawPeerId ('${hostRawPeerId}') or Supabase not init.`);
        return;
    }

    if (!gameSettings || typeof maxPlayers !== 'number' || typeof currentPlayers !== 'number') {
        console.warn(`[PizarraMatchmaking] updateHostedRoomStatus: Invalid parameters. gameSettings: ${!!gameSettings}, maxPlayers: ${maxPlayers}, currentPlayers: ${currentPlayers}`);
        return;
    }

    const hostPrefixedPeerIdAsRoomId = `${state.PIZARRA_PEER_ID_PREFIX}${hostRawPeerId}`; 

    let statusToSet = newStatus;
    if (!statusToSet) {
        try {
            const currentRoomState = state.getRawNetworkRoomData()?.roomState;
            if (currentRoomState === 'playing') {
                statusToSet = 'in_game';
            } else if (currentPlayers >= maxPlayers) {
                statusToSet = 'full';
            } else {
                statusToSet = 'hosting_waiting_for_players';
            }
        } catch (e) {
            console.warn('[PizarraMatchmaking] Error accessing state for status determination:', e);
            statusToSet = currentPlayers >= maxPlayers ? 'full' : 'hosting_waiting_for_players';
        }
    }

    const updatePayload = {
        current_players: currentPlayers,
        status: statusToSet,
        game_settings: gameSettings, 
        max_players: maxPlayers,
        updated_at: new Date().toISOString() 
    };

    if (statusToSet === 'hosting_waiting_for_players') {
        updatePayload.expires_at = new Date(Date.now() + ROOM_EXPIRATION_MINUTES * 60 * 1000).toISOString();
        if (hostPrefixedPeerIdAsRoomId === localPlayerHostedRoomId_Supabase && !hostRefreshIntervalId) {
            // Ensure localPlayerHostedRoomId_Supabase is the room_id
            hostRefreshIntervalId = setInterval(() => refreshRoomExpiration(localPlayerHostedRoomId_Supabase), ROOM_REFRESH_INTERVAL_MS);
        }
    } else if (statusToSet === 'full' || statusToSet === 'in_game') {
        if (hostPrefixedPeerIdAsRoomId === localPlayerHostedRoomId_Supabase && hostRefreshIntervalId) {
            clearInterval(hostRefreshIntervalId);
            hostRefreshIntervalId = null;
        }
        updatePayload.expires_at = null; 
    }

    try {
        const { error } = await supabase
            .from(MATCHMAKING_TABLE)
            .update(updatePayload)
            .eq('room_id', hostPrefixedPeerIdAsRoomId); // Update based on room_id

        if (error) console.error(`[PizarraMatchmaking] Error updating room ${hostPrefixedPeerIdAsRoomId} to status ${statusToSet}:`, error);
        else console.log(`[PizarraMatchmaking] Room ${hostPrefixedPeerIdAsRoomId} status updated to ${statusToSet}. Players: ${currentPlayers}/${maxPlayers}`);
    } catch (e) {
        console.error(`[PizarraMatchmaking] Exception updating room status for ${hostPrefixedPeerIdAsRoomId}:`, e);
    }
}

try {
    if (initSupabase()) {
        console.log('[PizarraMatchmaking] Module initialized successfully.');
    } else {
        console.warn('[PizarraMatchmaking] Module initialization failed - Supabase not available.');
    }
} catch (e) {
    console.error('[PizarraMatchmaking] Error during module initialization:', e);
}