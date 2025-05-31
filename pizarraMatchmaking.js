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
            .eq('room_id', roomIdToRefresh)
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
    if (!initSupabase() || !deadRawPeerId) return;
    const deadRoomIdWithPrefix = `${state.PIZARRA_PEER_ID_PREFIX}${deadRawPeerId}`; 
    console.log(`[PizarraMatchmaking] Attempting to remove dead room: ${deadRoomIdWithPrefix}`);
    try {
        const { data, error } = await supabase
            .from(MATCHMAKING_TABLE)
            .delete()
            .eq('room_id', deadRoomIdWithPrefix); 

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
    if (!localRawPeerId || typeof localRawPeerId !== 'string') { // Add type check for localRawPeerId
        callbacks.onError?.(`ID de jugador local inválido ('${localRawPeerId}') para matchmaking.`);
        return;
    }

    cleanupMatchmakingState();
    await cleanupStaleRooms();

    callbacks.onSearching?.();
    const localPrefixedPeerId = `${state.PIZARRA_PEER_ID_PREFIX}${localRawPeerId}`; 

    // Ensure this peer isn't already listed as hosting a room.
    // Pass the string localRawPeerId.
    await leaveQueue(localRawPeerId, false); 

    try {
        const nowISO = new Date().toISOString();
        const { data: openRooms, error: fetchError } = await supabase
            .from(MATCHMAKING_TABLE)
            .select('*')
            .eq('status', 'hosting_waiting_for_players')
            .eq('game_type', GAME_TYPE_IDENTIFIER) 
            .lt('current_players', preferences.maxPlayers) 
            .gte('max_players', preferences.maxPlayers) 
            .eq('game_settings->>difficulty', preferences.gameSettings.difficulty)
            .gt('expires_at', nowISO) 
            .neq('peer_id', localPrefixedPeerId) 
            .order('created_at', { ascending: true });

        if (fetchError) {
            console.error('[PizarraMatchmaking] Error fetching open rooms:', fetchError);
            callbacks.onError?.(`Error buscando salas: ${fetchError.message}`);
            return;
        }

        if (openRooms && openRooms.length > 0) {
            const suitableRoom = openRooms[0];
            console.log('[PizarraMatchmaking] Found suitable room to join:', suitableRoom);
            const leaderRawPeerId = suitableRoom.room_id.startsWith(state.PIZARRA_PEER_ID_PREFIX) 
                ? suitableRoom.room_id.substring(state.PIZARRA_PEER_ID_PREFIX.length)
                : suitableRoom.room_id;

            callbacks.onMatchFoundAndJoiningRoom?.(
                leaderRawPeerId, 
                { 
                    maxPlayers: suitableRoom.max_players,
                    gameSettings: suitableRoom.game_settings, 
                    currentPlayers: suitableRoom.current_players
                }
            );
            return;
        }

        console.log('[PizarraMatchmaking] No suitable rooms. Becoming a host.');
        localPlayerHostedRoomId_Supabase = localPrefixedPeerId; // This is a string

        const newRoomEntry = {
            peer_id: localPrefixedPeerId, 
            room_id: localPrefixedPeerId, 
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
            callbacks.onError?.(`No se pudo crear una nueva sala: ${insertError.message}`);
            localPlayerHostedRoomId_Supabase = null;
            return;
        }

        hostRefreshIntervalId = setInterval(() => {
            refreshRoomExpiration(localPlayerHostedRoomId_Supabase);
        }, ROOM_REFRESH_INTERVAL_MS);

        callbacks.onMatchFoundAndHostingRoom?.(
            localRawPeerId, 
            { 
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
    // Add console log to see the exact type and value of localRawPeerIdToLeave
    console.log(`[PizarraMatchmaking] leaveQueue called. PeerID (raw) to leave: '${localRawPeerIdToLeave}', Type: ${typeof localRawPeerIdToLeave}. Full cleanup: ${performFullCleanup}`);
    
    let peerIdToRemoveString;
    if (localRawPeerIdToLeave && typeof localRawPeerIdToLeave === 'string') {
        peerIdToRemoveString = `${state.PIZARRA_PEER_ID_PREFIX}${localRawPeerIdToLeave}`;
    } else if (localPlayerHostedRoomId_Supabase && typeof localPlayerHostedRoomId_Supabase === 'string') {
        peerIdToRemoveString = localPlayerHostedRoomId_Supabase;
    } else {
        // If localRawPeerIdToLeave is not a string (e.g. null, undefined, or an object)
        // and localPlayerHostedRoomId_Supabase is also not set or not a string,
        // then we don't have a valid string ID to remove.
        console.warn(`[PizarraMatchmaking] leaveQueue: Cannot determine a valid string PeerID to remove. localRawPeerIdToLeave: '${localRawPeerIdToLeave}', localPlayerHostedRoomId_Supabase: '${localPlayerHostedRoomId_Supabase}'`);
        if (performFullCleanup) cleanupMatchmakingState(); // Still perform interval cleanup if full.
        return; // Exit if no valid string ID can be formed.
    }

    console.log(`[PizarraMatchmaking] Effective peerIdToRemoveString for Supabase: ${peerIdToRemoveString}`);


    if (performFullCleanup) {
        cleanupMatchmakingState();
    } else if (hostRefreshIntervalId && peerIdToRemoveString === localPlayerHostedRoomId_Supabase) {
        clearInterval(hostRefreshIntervalId);
        hostRefreshIntervalId = null;
    }

    if (peerIdToRemoveString && initSupabase()) { 
        console.log(`[PizarraMatchmaking] Removing Supabase entry for room/peer: ${peerIdToRemoveString}`);
        try {
            const { error } = await supabase
                .from(MATCHMAKING_TABLE)
                .delete()
                .eq('room_id', peerIdToRemoveString);

            if (error) console.warn('[PizarraMatchmaking] Error removing entry from Supabase:', error.message);
            else console.log('[PizarraMatchmaking] Successfully removed listing from Supabase or it was already gone.');
        } catch (dbError) {
            console.error('[PizarraMatchmaking] Exception during Supabase delete in leaveQueue:', dbError);
        }
    }

    if (peerIdToRemoveString === localPlayerHostedRoomId_Supabase) {
        localPlayerHostedRoomId_Supabase = null; // Clear our hosted room ID if we just unlisted it.
    }
}

export async function updateHostedRoomStatus(hostRawPeerId, gameSettings, maxPlayers, currentPlayers, newStatus = null) {
    if (!initSupabase() || !hostRawPeerId || typeof hostRawPeerId !== 'string') { // Add type check
        console.warn(`[PizarraMatchmaking] updateHostedRoomStatus: Invalid hostRawPeerId ('${hostRawPeerId}') or Supabase not init.`);
        return;
    }

    const hostPrefixedPeerId = `${state.PIZARRA_PEER_ID_PREFIX}${hostRawPeerId}`; 

    let statusToSet = newStatus;
    if (!statusToSet) {
        if (state.getRawNetworkRoomData().roomState === 'playing') { // Check Palabras state
             statusToSet = 'in_game';
        } else if (currentPlayers >= maxPlayers) {
            statusToSet = 'full';
        } else {
            statusToSet = 'hosting_waiting_for_players';
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
        if (hostPrefixedPeerId === localPlayerHostedRoomId_Supabase && !hostRefreshIntervalId) {
            hostRefreshIntervalId = setInterval(() => refreshRoomExpiration(localPlayerHostedRoomId_Supabase), ROOM_REFRESH_INTERVAL_MS);
        }
    } else if (statusToSet === 'full' || statusToSet === 'in_game') {
        if (hostPrefixedPeerId === localPlayerHostedRoomId_Supabase && hostRefreshIntervalId) {
            clearInterval(hostRefreshIntervalId);
            hostRefreshIntervalId = null;
        }
        updatePayload.expires_at = null; 
    }

    const { error } = await supabase
        .from(MATCHMAKING_TABLE)
        .update(updatePayload)
        .eq('room_id', hostPrefixedPeerId);

    if (error) console.error(`[PizarraMatchmaking] Error updating room ${hostPrefixedPeerId} to status ${statusToSet}:`, error);
    else console.log(`[PizarraMatchmaking] Room ${hostPrefixedPeerId} status updated to ${statusToSet}. Players: ${currentPlayers}/${maxPlayers}`);
}

initSupabase();