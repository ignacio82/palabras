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
        // console.log('[PizarraMatchmaking] Supabase client already initialized.');
        return true; 
    }
    console.error('[PizarraMatchmaking] Supabase library (supabase-js) not found on window object.');
    return false;
}

function cleanupMatchmakingState() {
    console.log('[PizarraMatchmaking] cleanupMatchmakingState called.');
    if (hostRefreshIntervalId) {
        console.log('[PizarraMatchmaking] Clearing host refresh interval.');
        clearInterval(hostRefreshIntervalId);
        hostRefreshIntervalId = null;
    }
    refreshFailures = 0;
    // localPlayerHostedRoomId_Supabase is usually nulled by leaveQueue
}

async function refreshRoomExpiration(roomIdToRefresh) {
    console.log(`[PizarraMatchmaking] refreshRoomExpiration called for room_id: ${roomIdToRefresh}`);
    if (!initSupabase() || !roomIdToRefresh) {
        console.warn(`[PizarraMatchmaking] refreshRoomExpiration: Supabase not init or no room ID. Supabase: ${!!supabase}, RoomID: ${roomIdToRefresh}`);
        return;
    }
    try {
        const newExpiration = new Date(Date.now() + ROOM_EXPIRATION_MINUTES * 60 * 1000).toISOString();
        console.log(`[PizarraMatchmaking] Attempting to refresh expiration for ${roomIdToRefresh} to ${newExpiration}`);
        const { error } = await supabase
            .from(MATCHMAKING_TABLE)
            .update({ expires_at: newExpiration, updated_at: new Date().toISOString() })
            .eq('room_id', roomIdToRefresh) 
            .eq('status', 'hosting_waiting_for_players'); 

        if (error) {
            refreshFailures++;
            console.warn(`[PizarraMatchmaking] Room expiration refresh failed for ${roomIdToRefresh} (${refreshFailures}/${MAX_REFRESH_FAILURES}):`, error.message);
            if (refreshFailures >= MAX_REFRESH_FAILURES) {
                console.error('[PizarraMatchmaking] Too many refresh failures. Stopping refresh interval. Room may expire.');
                clearInterval(hostRefreshIntervalId);
                hostRefreshIntervalId = null;
            }
        } else {
            // console.log(`[PizarraMatchmaking] Successfully refreshed expiration for room ${roomIdToRefresh}.`);
            refreshFailures = 0; 
        }
    } catch (e) {
        console.error(`[PizarraMatchmaking] Exception during refreshRoomExpiration for ${roomIdToRefresh}:`, e);
    }
}

async function cleanupStaleRooms() {
    console.log('[PizarraMatchmaking] cleanupStaleRooms called.');
    if (!initSupabase()) return;
    try {
        const nowISO = new Date().toISOString();
        console.log(`[PizarraMatchmaking] Cleaning up rooms expired before: ${nowISO}`);
        const { data, error } = await supabase
            .from(MATCHMAKING_TABLE)
            .delete()
            .lt('expires_at', nowISO); 

        if (error) {
            console.warn('[PizarraMatchmaking] Error during stale room cleanup:', error.message);
        } else if (data && data.length > 0) {
            console.log(`[PizarraMatchmaking] Cleaned up ${data.length} stale room(s). Data:`, data);
        } else {
            // console.log('[PizarraMatchmaking] No stale rooms found to clean up.');
        }
    } catch (e) {
        console.error('[PizarraMatchmaking] Exception during stale room cleanup:', e);
    }
}

export async function removeDeadRoomByPeerId(deadRawPeerId) {
    console.log(`[PizarraMatchmaking] removeDeadRoomByPeerId called for raw PeerJS ID: ${deadRawPeerId}`);
    if (!initSupabase() || !deadRawPeerId) {
        console.warn(`[PizarraMatchmaking] removeDeadRoomByPeerId: Invalid input. deadRawPeerId: '${deadRawPeerId}', Supabase initialized: ${!!supabase}`);
        return;
    }
    const deadRoomIdWithPrefix = `${state.PIZARRA_PEER_ID_PREFIX}${deadRawPeerId}`; 
    console.log(`[PizarraMatchmaking] Attempting to remove dead room by room_id (which is prefixed host peerId): ${deadRoomIdWithPrefix}`);
    try {
        const { data, error } = await supabase
            .from(MATCHMAKING_TABLE)
            .delete()
            .eq('room_id', deadRoomIdWithPrefix); 

        if (error) console.warn(`[PizarraMatchmaking] Failed to clean up dead room ${deadRoomIdWithPrefix}:`, error.message);
        else if (data && data.length > 0) console.log(`[PizarraMatchmaking] Cleaned up dead room (ID: ${deadRoomIdWithPrefix}). Data:`, data);
        else console.log(`[PizarraMatchmaking] No room found with room_id ${deadRoomIdWithPrefix} to clean up.`);
    } catch (e) {
        console.error(`[PizarraMatchmaking] Exception cleaning up dead room ${deadRoomIdWithPrefix}:`, e);
    }
}

export async function joinQueue(localRawPeerId, myPlayerData, preferences, callbacks) {
    console.log(`[PizarraMatchmaking] joinQueue called. Local Raw PeerID: ${localRawPeerId}, PlayerData:`, myPlayerData, "Preferences:", preferences);
    
    if (!callbacks || typeof callbacks !== 'object' || !callbacks.onSearching || !callbacks.onMatchFoundAndJoiningRoom || !callbacks.onMatchFoundAndHostingRoom || !callbacks.onError) {
        console.error('[PizarraMatchmaking] joinQueue: callbacks object with all required methods is required.');
        if(callbacks && callbacks.onError) callbacks.onError("Error interno: Callbacks de matchmaking incompletos.");
        else console.error("Error interno: Callbacks de matchmaking incompletos y no se pudo llamar a onError.");
        return;
    }
    
    if (!initSupabase()) {
        callbacks.onError('Servicio de matchmaking no disponible en este momento.');
        return;
    }
    
    if (!localRawPeerId || typeof localRawPeerId !== 'string') {
        console.error(`[PizarraMatchmaking] joinQueue: Invalid localRawPeerId: '${localRawPeerId}', type: ${typeof localRawPeerId}`);
        callbacks.onError(`ID de jugador local inválido para matchmaking: ${localRawPeerId}`);
        return;
    }

    if (!myPlayerData || !preferences || !preferences.gameSettings) {
        console.error('[PizarraMatchmaking] joinQueue: myPlayerData and preferences (with gameSettings) are required.');
        callbacks.onError('Datos de jugador o preferencias (incluyendo dificultad) faltantes.');
        return;
    }

    console.log("[PizarraMatchmaking] Initializing cleanup and calling onSearching callback.");
    cleanupMatchmakingState();
    await cleanupStaleRooms();

    callbacks.onSearching();
    const localPrefixedHostPeerId = `${state.PIZARRA_PEER_ID_PREFIX}${localRawPeerId}`; 
    console.log(`[PizarraMatchmaking] Local prefixed PeerJS ID for host operations: ${localPrefixedHostPeerId}`);

    console.log(`[PizarraMatchmaking] Ensuring this peer (${localRawPeerId}) is not already listed as hosting by calling leaveQueue first.`);
    await leaveQueue(localRawPeerId, false); // false to not cleanup interval if it's about to be reset

    try {
        const nowISO = new Date().toISOString();
        console.log(`[PizarraMatchmaking] Querying Supabase for open rooms. Time: ${nowISO}. Difficulty filter: ${preferences.gameSettings.difficulty}`);
        
        const query = supabase
            .from(MATCHMAKING_TABLE)
            .select('room_id, host_peer_id, max_players, game_settings, current_players') // Select specific columns
            .eq('status', 'hosting_waiting_for_players')
            .eq('game_type', GAME_TYPE_IDENTIFIER) 
            .lt('current_players', supabase.expressions.sql('max_players')) // Ensure current_players < max_players
            // .lt('current_players', preferences.maxPlayers) // This might be too restrictive if room allows more but user wants fewer
            .gte('max_players', preferences.maxPlayers) // Room's max_players >= user's preference
            .eq('game_settings->>difficulty', preferences.gameSettings.difficulty) // JSONB query for difficulty
            .gt('expires_at', nowISO) 
            .neq('host_peer_id', localPrefixedHostPeerId) // Don't join my own room listing
            .order('created_at', { ascending: true });

        // console.log("[PizarraMatchmaking] Supabase Query:", query.toString()); // For debugging the query structure
        const { data: openRooms, error: fetchError } = await query;


        if (fetchError) {
            console.error('[PizarraMatchmaking] Error fetching open rooms from Supabase:', fetchError);
            callbacks.onError(`Error buscando salas: ${fetchError.message}`);
            return;
        }

        console.log(`[PizarraMatchmaking] Found ${openRooms ? openRooms.length : 0} potential open room(s).`, openRooms);

        if (openRooms && openRooms.length > 0) {
            const suitableRoom = openRooms[0]; // Simplest: take the oldest suitable one
            console.log('[PizarraMatchmaking] Found suitable room to join:', suitableRoom);
            
            // suitableRoom.room_id is the prefixed host peer ID, which acts as the room's unique identifier.
            // We need the RAW peer ID for PeerJS connection.
            const leaderRawPeerIdToJoin = suitableRoom.room_id.startsWith(state.PIZARRA_PEER_ID_PREFIX) 
                ? suitableRoom.room_id.substring(state.PIZARRA_PEER_ID_PREFIX.length)
                : suitableRoom.room_id; // Fallback if not prefixed (should be consistent)

            console.log(`[PizarraMatchmaking] Extracted leaderRawPeerIdToJoin: ${leaderRawPeerIdToJoin} from room_id: ${suitableRoom.room_id}`);
            callbacks.onMatchFoundAndJoiningRoom(
                leaderRawPeerIdToJoin, 
                { 
                    maxPlayers: suitableRoom.max_players,
                    gameSettings: suitableRoom.game_settings, 
                    currentPlayers: suitableRoom.current_players
                }
            );
            return;
        }

        console.log('[PizarraMatchmaking] No suitable rooms found. Becoming a host.');
        // When hosting, localPrefixedHostPeerId is both the room_id and the host_peer_id
        localPlayerHostedRoomId_Supabase = localPrefixedHostPeerId; // This is the room_id for this host

        const newRoomEntry = {
            host_peer_id: localPrefixedHostPeerId, 
            room_id: localPrefixedHostPeerId,      
            status: 'hosting_waiting_for_players',
            game_type: GAME_TYPE_IDENTIFIER, 
            max_players: preferences.maxPlayers,
            current_players: 1, 
            game_settings: preferences.gameSettings, // Should include difficulty
            expires_at: new Date(Date.now() + ROOM_EXPIRATION_MINUTES * 60 * 1000).toISOString(),
            // created_at and updated_at will be set by Supabase default or triggers
        };
        console.log('[PizarraMatchmaking] Creating new room entry in Supabase:', newRoomEntry);

        const { error: insertError } = await supabase.from(MATCHMAKING_TABLE).insert(newRoomEntry);

        if (insertError) {
            console.error('[PizarraMatchmaking] Error inserting new room into Supabase:', insertError);
            callbacks.onError(`No se pudo crear una nueva sala: ${insertError.message}`);
            localPlayerHostedRoomId_Supabase = null; // Reset if failed
            return;
        }
        console.log('[PizarraMatchmaking] Successfully inserted new room. Setting up refresh interval.');

        hostRefreshIntervalId = setInterval(() => {
            refreshRoomExpiration(localPlayerHostedRoomId_Supabase); 
        }, ROOM_REFRESH_INTERVAL_MS);

        callbacks.onMatchFoundAndHostingRoom(
            localRawPeerId, // Pass the raw peer ID for consistency with hostNewRoom expectation
            { 
                maxPlayers: preferences.maxPlayers,
                gameSettings: preferences.gameSettings, // Pass difficulty etc.
            }
        );

    } catch (error) {
        console.error('[PizarraMatchmaking] General exception in joinQueue:', error);
        callbacks.onError(`Error inesperado durante el matchmaking: ${error.message || error}`);
    }
}

export async function leaveQueue(localRawPeerIdToLeave = null, performFullCleanup = true) {
    console.log(`[PizarraMatchmaking] leaveQueue called. Raw PeerID to leave: '${localRawPeerIdToLeave}'. Full cleanup: ${performFullCleanup}`);
    
    let roomIdToRemove; 
    if (localRawPeerIdToLeave && typeof localRawPeerIdToLeave === 'string') {
        roomIdToRemove = `${state.PIZARRA_PEER_ID_PREFIX}${localRawPeerIdToLeave}`;
    } else if (localPlayerHostedRoomId_Supabase && typeof localPlayerHostedRoomId_Supabase === 'string') {
        roomIdToRemove = localPlayerHostedRoomId_Supabase;
    } else {
        console.warn(`[PizarraMatchmaking] leaveQueue: Cannot determine a valid RoomID (prefixed peer ID) to remove. localRawPeerIdToLeave: '${localRawPeerIdToLeave}', localPlayerHostedRoomId_Supabase: '${localPlayerHostedRoomId_Supabase}'`);
        if (performFullCleanup) cleanupMatchmakingState();
        return;
    }

    console.log(`[PizarraMatchmaking] Effective room_id to remove from Supabase: ${roomIdToRemove}`);

    if (performFullCleanup) {
        cleanupMatchmakingState();
    } else if (hostRefreshIntervalId && roomIdToRemove === localPlayerHostedRoomId_Supabase) {
        // If not full cleanup, but we are leaving the room we are actively refreshing, stop the refresh.
        console.log(`[PizarraMatchmaking] leaveQueue (not full cleanup): Stopping refresh for room ${roomIdToRemove}.`);
        clearInterval(hostRefreshIntervalId);
        hostRefreshIntervalId = null;
    }

    if (roomIdToRemove && initSupabase()) { 
        console.log(`[PizarraMatchmaking] Attempting to delete Supabase entry for room_id: ${roomIdToRemove}`);
        try {
            const { data, error } = await supabase
                .from(MATCHMAKING_TABLE)
                .delete()
                .eq('room_id', roomIdToRemove); 

            if (error) console.warn(`[PizarraMatchmaking] Error removing entry for room_id ${roomIdToRemove} from Supabase:`, error.message);
            else if (data && data.length > 0) console.log(`[PizarraMatchmaking] Successfully removed listing for room_id ${roomIdToRemove} from Supabase. Data:`, data);
            else console.log(`[PizarraMatchmaking] No listing found for room_id ${roomIdToRemove} to remove, or it was already gone.`);
        } catch (dbError) {
            console.error(`[PizarraMatchmaking] Exception during Supabase delete for room_id ${roomIdToRemove} in leaveQueue:`, dbError);
        }
    }

    if (roomIdToRemove === localPlayerHostedRoomId_Supabase) {
        console.log(`[PizarraMatchmaking] Nullifying localPlayerHostedRoomId_Supabase as it matched roomIdToRemove: ${roomIdToRemove}`);
        localPlayerHostedRoomId_Supabase = null;
    }
}

export async function updateHostedRoomStatus(hostRawPeerId, gameSettings, maxPlayers, currentPlayers, newStatus = null) {
    console.log(`[PizarraMatchmaking] updateHostedRoomStatus called. Host Raw PeerID: ${hostRawPeerId}, Settings:`, gameSettings, `MaxP: ${maxPlayers}, CurrentP: ${currentPlayers}, NewStatus: ${newStatus}`);
    
    if (!initSupabase() || !hostRawPeerId || typeof hostRawPeerId !== 'string') {
        console.warn(`[PizarraMatchmaking] updateHostedRoomStatus: Invalid hostRawPeerId ('${hostRawPeerId}') or Supabase not init.`);
        return;
    }

    if (!gameSettings || typeof maxPlayers !== 'number' || typeof currentPlayers !== 'number') {
        console.warn(`[PizarraMatchmaking] updateHostedRoomStatus: Invalid parameters. gameSettings: ${!!gameSettings}, maxPlayers: ${maxPlayers}, currentPlayers: ${currentPlayers}`);
        return;
    }

    const hostPrefixedPeerIdAsRoomId = `${state.PIZARRA_PEER_ID_PREFIX}${hostRawPeerId}`; 
    console.log(`[PizarraMatchmaking] Updating status for room_id: ${hostPrefixedPeerIdAsRoomId}`);

    let statusToSet = newStatus;
    if (!statusToSet) {
        try {
            const currentGlobalRoomState = state.getRawNetworkRoomData()?.roomState; // From pizarraState
            console.log(`[PizarraMatchmaking] Determining status based on global room state: ${currentGlobalRoomState}`);
            if (currentGlobalRoomState === 'playing' || currentGlobalRoomState === 'game_over') {
                statusToSet = 'in_game'; // Or 'game_over' if you want to distinguish, 'in_game' often means not joinable
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
    console.log(`[PizarraMatchmaking] Calculated statusToSet: ${statusToSet}`);

    const updatePayload = {
        current_players: currentPlayers,
        status: statusToSet,
        game_settings: gameSettings, 
        max_players: maxPlayers,
        updated_at: new Date().toISOString() 
    };

    if (statusToSet === 'hosting_waiting_for_players') {
        updatePayload.expires_at = new Date(Date.now() + ROOM_EXPIRATION_MINUTES * 60 * 1000).toISOString();
        // Only start interval if this host is managing this room_id and interval isn't already running
        if (hostPrefixedPeerIdAsRoomId === localPlayerHostedRoomId_Supabase && !hostRefreshIntervalId) {
            console.log(`[PizarraMatchmaking] Starting refresh interval for hosted room ${localPlayerHostedRoomId_Supabase}.`);
            hostRefreshIntervalId = setInterval(() => refreshRoomExpiration(localPlayerHostedRoomId_Supabase), ROOM_REFRESH_INTERVAL_MS);
        }
    } else if (statusToSet === 'full' || statusToSet === 'in_game' || statusToSet === 'game_over') {
        if (hostPrefixedPeerIdAsRoomId === localPlayerHostedRoomId_Supabase && hostRefreshIntervalId) {
            console.log(`[PizarraMatchmaking] Room ${localPlayerHostedRoomId_Supabase} is now ${statusToSet}. Stopping refresh interval.`);
            clearInterval(hostRefreshIntervalId);
            hostRefreshIntervalId = null;
        }
        // For 'full' or 'in_game', you might want to keep expires_at if you expect them to become available again,
        // or nullify it if they are permanently removed from joinable queue once full/started.
        // Setting to null means it won't be picked up by cleanupStaleRooms based on expiry while in these states.
        updatePayload.expires_at = null; 
    }
    console.log('[PizarraMatchmaking] Update payload for Supabase:', updatePayload);

    try {
        const { error } = await supabase
            .from(MATCHMAKING_TABLE)
            .update(updatePayload)
            .eq('room_id', hostPrefixedPeerIdAsRoomId); 

        if (error) console.error(`[PizarraMatchmaking] Error updating room ${hostPrefixedPeerIdAsRoomId} status to ${statusToSet} in Supabase:`, error);
        else console.log(`[PizarraMatchmaking] Room ${hostPrefixedPeerIdAsRoomId} status successfully updated to ${statusToSet}. Players: ${currentPlayers}/${maxPlayers}`);
    } catch (e) {
        console.error(`[PizarraMatchmaking] Exception during Supabase update for room ${hostPrefixedPeerIdAsRoomId} status:`, e);
    }
}

// Initial check for Supabase library
try {
    if (initSupabase()) {
        // console.log('[PizarraMatchmaking] Module initialized successfully (Supabase client ready).');
    } else {
        console.warn('[PizarraMatchmaking] Module initialization: Supabase client could not be initialized.');
    }
} catch (e) {
    console.error('[PizarraMatchmaking] Error during initial module check/Supabase init:', e);
}