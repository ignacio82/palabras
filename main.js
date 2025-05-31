// main.js - Fixed for network mode and mobile UI
import * as state from './pizarraState.js';
import * as logic from './gameLogic.js';
import * as peerConnection from './pizarraPeerConnection.js';
import * as matchmaking from './pizarraMatchmaking.js';
import * as ui from './pizarraUi.js';
import * as sound from './pizarraSound.js';

const PIZARRA_BASE_URL = "https://palabras.martinez.fyi";

// --- NEW: Helper functions for mobile layout ---
function enterPlayMode(){
  document.body.classList.add('playing');
  console.log("[Main] Entered play mode. Body class 'playing' added.");
}

function exitPlayMode(){
  document.body.classList.remove('playing');
  console.log("[Main] Exited play mode. Body class 'playing' removed.");
}

document.addEventListener('DOMContentLoaded', () => {
    console.log("Pizarra de Palabras: DOMContentLoaded, initializing main.js with network features.");

    ui.initializeUiDOMReferences();

    const gameModeTabs = document.querySelectorAll('.tab-button');
    const difficultyButtons = document.querySelectorAll('.difficulty-button');
    const startLocalGameButton = document.getElementById('start-local-game-button');

    const networkPlayerNameInput = document.getElementById('network-player-name');
    const networkPlayerIconSelect = document.getElementById('network-player-icon');
    const networkMaxPlayersSelect = document.getElementById('network-max-players');
    const hostGameButton = document.getElementById('host-game-button');
    const joinRandomButton = document.getElementById('join-random-button');
    const copyRoomLinkButtonEl = document.getElementById('copy-room-link-button');
    const cancelMatchmakingButtonEl = document.getElementById('cancel-matchmaking-button'); 

    const lobbyToggleReadyButtonEl = document.getElementById('lobby-toggle-ready-button');
    const lobbyStartGameLeaderButtonEl = document.getElementById('lobby-start-game-leader-button');
    const lobbyLeaveRoomButtonEl = document.getElementById('lobby-leave-room-button');

    const clueButtonEl = document.getElementById('clue-button');
    const playAgainButtonEl = document.getElementById('play-again-button');
    const mainMenuButtonEl = document.getElementById('main-menu-button');

    const customModalEl = document.getElementById('custom-modal');
    const modalCloseButtonEl = document.getElementById('modal-close-button');
    const modalDynamicButtonsEl = document.getElementById('modal-dynamic-buttons');

    const clueDisplayAreaEl = document.getElementById('clue-display-area');
    const messageAreaEl = document.getElementById('message-area');
    const networkInfoAreaEl = document.getElementById('network-info-area');
    const networkInfoTitleEl = document.getElementById('network-info-title');
    const networkInfoTextEl = document.getElementById('network-info-text');
    const qrCodeContainerEl = document.getElementById('qr-code-container');

    function handleCancelMatchmaking() {
        console.log("[Main] handleCancelMatchmaking called.");
        sound.playUiClick();
        exitPlayMode();
        const currentPeerId = state.getMyPeerId();
        if (currentPeerId && matchmaking?.leaveQueue) {
            console.log(`[Main] Calling matchmaking.leaveQueue for peerId: ${currentPeerId}`);
            matchmaking.leaveQueue(currentPeerId);
        }
        stopAnyActiveGameOrNetworkSession(true); 
        ui.showScreen('networkSetup');
        ui.displayMessage("Búsqueda de partida cancelada. 🚫", "info");
        ui.hideModal(); 
        if (cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
    }

    function refreshAlphabetKeyboard() {
        // console.log("[Main] refreshAlphabetKeyboard called.");
        if (!state.getGameActive()) {
            ui.createAlphabetKeyboard(false, handleLetterClickUI);
            return;
        }
        const isMyTurn = state.getPvpRemoteActive() ?
                       (state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) :
                       true;
        ui.createAlphabetKeyboard(isMyTurn, handleLetterClickUI);
    }

    function startLocalGameUI() {
        console.log("[Main] startLocalGameUI called.");
        ui.stopConfetti(); // Stop any ongoing confetti
        const selectedDifficulty = state.getCurrentDifficulty();
        console.log(`[Main] Starting local game with difficulty: ${selectedDifficulty}`);

        // Do not call stopAnyActiveGameOrNetworkSession here if we are auto-restarting,
        // as it resets too much. We only need to reset game flow state.
        state.resetGameFlowState(); // Reset word, guessed letters, etc.
        // Scores are reset within initializeGame

        state.setPvpRemoteActive(false); // Ensure local mode
        // Player data should persist or be re-initialized as needed for local play
        if (!state.getPlayersData() || state.getPlayersData().length === 0) {
            state.setPlayersData([{ 
                id: 0, 
                name: "Jugador", 
                icon: "✏️", 
                color: state.DEFAULT_PLAYER_COLORS[0], 
                score: 0 // Score reset by initializeGame
            }]);
        }
        state.setCurrentPlayerId(0);

        const initState = logic.initializeGame(state, selectedDifficulty);
        if (!initState.success) {
            console.error("[Main] Failed to initialize local game:", initState.message);
            ui.showModal(initState.message || "No se pudo iniciar el juego local.");
            exitPlayMode();
            return;
        }

        console.log(`[Main] Local game initialized. Word: ${initState.currentWordObject?.word}`);
        ui.renderFullGameBoard(true, handleLetterClickUI);
        
        if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'none';
        if(document.getElementById('app')) document.getElementById('app').style.display = 'flex';
        
        enterPlayMode();
        ui.displayMessage("¡Adiviná la palabra secreta! ✨", 'info', false);
        if (playAgainButtonEl) playAgainButtonEl.style.display = 'none'; // Ensure play again is hidden
        if (mainMenuButtonEl) mainMenuButtonEl.style.display = 'inline-block'; // Ensure main menu is visible
    }

    function handleLetterClickUI(letter, buttonElement) {
        // console.log(`[Main] handleLetterClickUI called with letter: ${letter}`);
        if (!state.getGameActive() || (buttonElement && buttonElement.disabled)) {
            console.log("[Main] Letter click ignored: game not active or button disabled.");
            return;
        }
        sound.triggerVibration(25);

        if (state.getPvpRemoteActive()) {
            console.log("[Main] PVP mode active for letter click.");
            if (state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) {
                console.log("[Main] It's my turn. Sending guess to host.");
                if (buttonElement) buttonElement.disabled = true;
                peerConnection.sendGuessToHost(letter);
            } else {
                console.log("[Main] Not my turn. Displaying message.");
                ui.displayMessage("No es tu turno. ¡Esperá un poquito! ⏳", 'error');
            }
            return;
        }

        console.log("[Main] Local mode active for letter click. Processing guess.");
        const result = logic.processGuess(letter);
        ui.renderFullGameBoard(true, handleLetterClickUI);

        if (result.error) {
            ui.displayMessage(result.error, 'error');
        } else if (result.alreadyGuessed) {
             ui.displayMessage(`Ya intentaste la letra '${result.letter.toUpperCase()}'. ¡Probá otra! 🤔`, 'info');
        } else if (result.correct) {
            sound.playLetterSelectSound(true);
            ui.displayMessage(`¡Genial! '${result.letter.toUpperCase()}' está en la palabra. 👍`, 'success');
            if (result.wordSolved) {
                console.log("[Main] Word solved locally!");
                endGameUI(true); 
                return;
            }
        } else {
            sound.playLetterSelectSound(false);
            ui.displayMessage(`'${result.letter.toUpperCase()}' no está. ¡Perdés una ${state.STAR_SYMBOL}! 😢`, 'error');
            if (result.gameOver) {
                console.log("[Main] Game over locally (player lost).");
                endGameUI(false);
                return;
            }
        }
    }

    function handleClueRequestUI() {
        console.log("[Main] handleClueRequestUI called.");
        if (!state.getGameActive() || state.getClueUsedThisGame()) {
            if (state.getClueUsedThisGame()) ui.displayMessage("Ya usaste la pista para esta palabra. 🤫", "error");
            console.log("[Main] Clue request ignored: game not active or clue already used.");
            return;
        }
        const isMyTurnForClue = state.getPvpRemoteActive() ?
                               (state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) :
                               true;
        if (!isMyTurnForClue) {
            ui.displayMessage("No es tu turno para pedir una pista. 🚫", "error");
            console.log("[Main] Clue request ignored: not my turn in PVP.");
            return;
        }

        sound.triggerVibration(40);
        if (state.getPvpRemoteActive()) {
            console.log("[Main] PVP mode: Sending clue request to host.");
            peerConnection.sendClueRequestToHost();
            if(clueButtonEl) clueButtonEl.disabled = true;
        } else {
            console.log("[Main] Local mode: Processing clue request.");
            const clueResult = logic.requestClue();
            if (clueResult.success) {
                sound.playClueReveal();
                ui.displayClueOnUI(clueResult.clue);
                ui.displayMessage("¡Pista mágica revelada! 🔮", 'info');
                if(clueButtonEl) clueButtonEl.disabled = true;
            } else {
                sound.playErrorSound();
                ui.displayMessage(clueResult.message || "No se pudo obtener la pista.", 'error');
            }
        }
    }

    function endGameUI(isWin) {
        console.log(`[Main] endGameUI called. isWin: ${isWin}`);
        // Game active state is set by logic.processGuess or by network events for multiplayer
        // For local, ensure it's false if it reaches here.
        if (!state.getPvpRemoteActive()) {
            state.setGameActive(false);
        }
        
        refreshAlphabetKeyboard(); // Disable keyboard
        ui.toggleClueButtonUI(false, false); // Hide clue button

        if (mainMenuButtonEl) mainMenuButtonEl.style.display = 'inline-block';
        if (playAgainButtonEl) playAgainButtonEl.style.display = 'none'; // Hide manual play again for auto-restart

        const wordObject = state.getCurrentWordObject();
        let finalMessage = "";
        if (isWin) {
            sound.playWordSolvedSound();
            finalMessage = `¡GANASTE! 🎉 La palabra era: ${wordObject.word.toUpperCase()}`;
            ui.displayMessage(finalMessage, 'success', true);
            sound.triggerVibration([100, 40, 100, 40, 200]);
            ui.startConfetti(200);
        } else {
            sound.playGameOverSound();
            if (wordObject?.word) {
                const finalGuessed = new Set();
                for (const letter of state.getCurrentWord()) {
                    finalGuessed.add(letter.toLowerCase());
                }
                state.setGuessedLetters(finalGuessed);
                ui.updateWordDisplay();
                finalMessage = `¡Oh no! 😢 La palabra era: ${wordObject.word.toUpperCase()}`;
            } else {
                finalMessage = `¡Juego Terminado! 💔`;
            }
            ui.displayMessage(finalMessage, 'error', true);
            sound.triggerVibration([70, 50, 70]);
        }

        // Automatic restart for local play after a delay
        if (!state.getPvpRemoteActive()) {
            const autoRestartDelay = 5000; // 5 seconds
            console.log(`[Main] Scheduling automatic local game restart in ${autoRestartDelay}ms.`);
            setTimeout(() => {
                // Check if we are still in an ended local game state and not in a network session
                if (!state.getPvpRemoteActive() && (state.getGamePhase() === 'ended' || state.getGamePhase() === 'game_over')) {
                     console.log("[Main] Automatically restarting local game after delay.");
                     ui.hideModal(); // Ensure any game over modal is hidden
                     startLocalGameUI();
                } else {
                    console.log("[Main] Conditions for auto local restart not met. Phase:", state.getGamePhase(), "PVP:", state.getPvpRemoteActive());
                }
            }, autoRestartDelay);
        }
    }

    function returnToMainMenuUI() {
        console.log("[Main] returnToMainMenuUI called.");
        ui.stopConfetti();
        ui.hideModal();
        stopAnyActiveGameOrNetworkSession(); 
    }

    function stopAnyActiveGameOrNetworkSession(preserveUIScreen = false) {
        console.log(`[Main] stopAnyActiveGameOrNetworkSession called. Preserve UI: ${preserveUIScreen}`);
        exitPlayMode();
        const wasPvpActive = state.getPvpRemoteActive();
        const currentNetworkRoomState = state.getRawNetworkRoomData().roomState;
        const myCurrentPeerId = state.getMyPeerId(); 

        console.log(`[Main] Before reset: PVP Active: ${wasPvpActive}, Room State: ${currentNetworkRoomState}, My Peer ID: ${myCurrentPeerId}`);

        if (state.getGameActive()) {
            console.log("[Main] Setting game inactive.");
            state.setGameActive(false);
        }

        if (wasPvpActive) {
            console.log("[Main] PVP was active, leaving room and closing peer session.");
            peerConnection.leaveRoom();
            peerConnection.closePeerSession(); 
            if (currentNetworkRoomState === 'seeking_match' && myCurrentPeerId) {
                 if (matchmaking && typeof matchmaking.leaveQueue === 'function') {
                    console.log(`[Main] Leaving matchmaking queue for peerId: ${myCurrentPeerId}`);
                    matchmaking.leaveQueue(myCurrentPeerId);
                }
            }
        }
        
        console.log("[Main] Resetting full local state.");
        state.resetFullLocalStateForNewUIScreen();
        console.log("[Main] State after resetFullLocalStateForNewUIScreen:", state.getRawNetworkRoomData());

        if (!preserveUIScreen) {
            console.log("[Main] Not preserving UI screen. Resetting to local setup.");
            if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'block';
            if(document.getElementById('app')) document.getElementById('app').style.display = 'none';
            ui.updateGameModeTabs('local'); // Default to local tab
            ui.showScreen('localSetup'); // Show local setup screen
        }
        ui.updateDifficultyButtonUI(); // Ensure difficulty buttons reflect current state (likely default)

        if (clueDisplayAreaEl) clueDisplayAreaEl.style.display = 'none';
        if (messageAreaEl) ui.displayMessage('\u00A0', 'info', true); // Clear message area
        
        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';

        if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none';
        ui.stopConfetti();

        // Clear game board elements
        ui.updateScoreDisplayUI();
        ui.updateCurrentPlayerTurnUI();
        ui.updateWordDisplay();
        ui.updateGuessedLettersDisplay();
        refreshAlphabetKeyboard(); // Re-render disabled keyboard
        ui.toggleClueButtonUI(false, false); // Hide clue button
        if(playAgainButtonEl) playAgainButtonEl.style.display = 'none';
        if(mainMenuButtonEl) mainMenuButtonEl.style.display = 'none';
        console.log("[Main] stopAnyActiveGameOrNetworkSession completed.");
    }

    function getPlayerCustomizationDataFromUI(isModal = false, modalNameInput = null, modalIconSelect = null) {
        let name, icon;
        const randomSuffix = Math.floor(Math.random() * 1000);
        if (isModal) {
            name = modalNameInput?.value.trim() || `Pizarrín${randomSuffix}`;
            icon = modalIconSelect?.value || state.AVAILABLE_ICONS[0];
        } else {
            name = networkPlayerNameInput?.value.trim() || `Pizarrín${randomSuffix}`;
            icon = networkPlayerIconSelect?.value || state.AVAILABLE_ICONS[0];
        }
        // console.log(`[Main] getPlayerCustomizationDataFromUI: Name: ${name}, Icon: ${icon}`);
        return { name, icon };
    }

    async function hostGameUI() {
        console.log("[Main] hostGameUI called.");
        stopAnyActiveGameOrNetworkSession(true);
        ui.showModal("Creando tu sala de Palabras... 🏰✨");
        sound.triggerVibration(50);

        const hostCustomization = state.getLocalPlayerCustomizationForNetwork();
        const gameSettings = {
            difficulty: state.getCurrentDifficulty(),
            maxPlayers: parseInt(networkMaxPlayersSelect.value) || state.MAX_PLAYERS_NETWORK
        };
        console.log("[Main] Host Customization:", hostCustomization, "Game Settings:", gameSettings);

        try {
            console.log("[Main] Calling peerConnection.hostNewRoom...");
            const hostPeerId = await peerConnection.hostNewRoom(hostCustomization, gameSettings);
            console.log(`[Main] hostNewRoom successful. Host Peer ID (from hostNewRoom promise): ${hostPeerId}. Current state peerId: ${state.getMyPeerId()}`);
            
            if (matchmaking?.updateHostedRoomStatus && state.getMyPeerId()) { 
                 console.log(`[Main] Calling matchmaking.updateHostedRoomStatus for host: ${state.getMyPeerId()}`);
                 matchmaking.updateHostedRoomStatus(state.getMyPeerId(), gameSettings, gameSettings.maxPlayers, 1, 'hosting_waiting_for_players');
            } else {
                 console.warn("[Main] Matchmaking updateHostedRoomStatus not called or myPeerId not available.");
            }
        } catch (error) {
            console.error("[Main] Error hosting game:", error);
            ui.hideModal();
            ui.showModal(`Error al crear la sala: ${error.message || 'Desconocido'}. Intentá de nuevo.`, [{text:"OK", action: ui.hideModal}]);
            stopAnyActiveGameOrNetworkSession(true);
            ui.showScreen('networkSetup');
        }
    }

    async function joinRandomGameUI() {
        console.log("[Main] joinRandomGameUI called.");
        stopAnyActiveGameOrNetworkSession(true); 
        sound.triggerVibration(50);
        state.setPvpRemoteActive(true);
        console.log("[Main] PVP mode set to true for join random.");

        ui.showModal("Buscando una sala de Palabras... 🎲🕵️‍♀️", [
            { text: "❌ Cancelar Búsqueda", action: handleCancelMatchmaking, className: 'action-button-danger' }
        ]);

        const joinerCustomization = state.getLocalPlayerCustomizationForNetwork();
        const preferences = {
            maxPlayers: parseInt(networkMaxPlayersSelect.value) || state.MAX_PLAYERS_NETWORK,
            gameSettings: { difficulty: state.getCurrentDifficulty() }
        };
        console.log("[Main] Joiner Customization:", joinerCustomization, "Preferences:", preferences);

        try {
            console.log("[Main] Calling peerConnection.ensurePeerInitialized for joiner...");
            const localRawPeerId = await peerConnection.ensurePeerInitialized();
            console.log(`[Main] ensurePeerInitialized for joiner successful. Local Raw Peer ID: ${localRawPeerId}`);

            if (!localRawPeerId || typeof localRawPeerId !== 'string') { 
                console.error(`[Main] Invalid localRawPeerId after ensurePeerInitialized: ${localRawPeerId}, type: ${typeof localRawPeerId}`);
                throw new Error("ID de jugador local inválido después de la inicialización de PeerJS.");
            }
            
            console.log(`[Main] Peer ID for matchmaking.joinQueue: ${localRawPeerId}`);
            if (matchmaking?.joinQueue) {
                matchmaking.joinQueue(localRawPeerId, joinerCustomization, preferences, {
                    onSearching: () => {
                        console.log("[Main] Matchmaking Callback: onSearching.");
                        if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'block'; 
                        if(document.getElementById('app')) document.getElementById('app').style.display = 'none';
                        ui.showScreen('networkSetup'); 
                        exitPlayMode();
                    },
                    onMatchFoundAndJoiningRoom: async (leaderRawPeerIdToJoin, roomDetails) => {
                        console.log(`[Main] Matchmaking Callback: onMatchFoundAndJoiningRoom. Leader Peer ID: ${leaderRawPeerIdToJoin}`, roomDetails);
                        ui.hideModal(); 
                        ui.showModal(`¡Sala encontrada! (${state.PIZARRA_PEER_ID_PREFIX}${leaderRawPeerIdToJoin}). Uniendo... ⏳`);
                        try {
                            console.log(`[Main] Calling peerConnection.joinRoomById for leader: ${leaderRawPeerIdToJoin}`);
                            await peerConnection.joinRoomById(leaderRawPeerIdToJoin, joinerCustomization);
                            console.log(`[Main] joinRoomById completed for ${leaderRawPeerIdToJoin}. Waiting for showLobby.`);
                        } catch (joinError) {
                            console.error(`[Main] Error joining room ${leaderRawPeerIdToJoin}:`, joinError);
                            ui.hideModal();
                            ui.showModal(`Error al unirse a la sala: ${joinError.message || 'Intentá de nuevo'}`);
                            stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup');
                        }
                    },
                    onMatchFoundAndHostingRoom: async (myNewRawPeerIdForHosting, initialHostData) => {
                        console.log(`[Main] Matchmaking Callback: onMatchFoundAndHostingRoom. My new Peer ID for hosting: ${myNewRawPeerIdForHosting}`, initialHostData);
                        ui.hideModal(); 
                        ui.showModal("No hay salas disponibles, ¡creando una nueva para vos! 🚀");
                        try {
                            console.log("[Main] Calling peerConnection.hostNewRoom from onMatchFoundAndHostingRoom.");
                            const actualHostPeerId = await peerConnection.hostNewRoom(joinerCustomization, initialHostData.gameSettings); 
                            console.log(`[Main] hostNewRoom (from onMatchFoundAndHostingRoom) successful. Actual Host Peer ID: ${actualHostPeerId}. Current state peerId: ${state.getMyPeerId()}`);
                            
                            if (matchmaking?.updateHostedRoomStatus && state.getMyPeerId()) {
                                console.log(`[Main] Updating matchmaking status for new host: ${state.getMyPeerId()}`);
                                matchmaking.updateHostedRoomStatus(state.getMyPeerId(), initialHostData.gameSettings, initialHostData.gameSettings.maxPlayers || preferences.maxPlayers, 1, 'hosting_waiting_for_players');
                            } else {
                                console.warn("[Main] matchmaking.updateHostedRoomStatus not called in onMatchFoundAndHostingRoom or myPeerId missing.");
                            }
                        } catch (hostError) {
                            console.error("[Main] Error hosting new room from onMatchFoundAndHostingRoom:", hostError);
                            ui.hideModal(); ui.showModal(`Error al crear nueva sala: ${hostError.message}`);
                            stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup');
                        }
                    },
                    onError: (errMsg) => {
                        console.error(`[Main] Matchmaking Callback: onError. Message: ${errMsg}`);
                        ui.hideModal(); 
                        ui.showModal(`Error de Matchmaking: ${errMsg}`, [{text: "OK", action: () => {
                            handleCancelMatchmaking(); 
                        }}]);
                    }
                });
            } else {
                 console.error("[Main] matchmaking.joinQueue is not available.");
                 throw new Error("Servicio de matchmaking no disponible.");
            }
        } catch (initError) {
            console.error("[Main] Error in joinRandomGameUI (likely during peer initialization):", initError);
            ui.hideModal(); 
            ui.showModal(`Error de Red: ${initError.message || 'No se pudo conectar.'}`, [{text: "OK", action: () => {
                handleCancelMatchmaking(); 
            }}]);
        }
    }

    // Updated processUrlJoin function to use the new modal
    async function processUrlJoin() {
        console.log("[Main] processUrlJoin called.");
        const urlParams = new URLSearchParams(window.location.search);
        const roomIdFromUrl = urlParams.get('room');
        if (roomIdFromUrl && roomIdFromUrl.trim()) {
            console.log(`[Main] Room ID found in URL: ${roomIdFromUrl}. Processing join.`);
            window.history.replaceState({}, document.title, window.location.pathname);
            exitPlayMode();

            // Use the new simplified join modal
            ui.createJoinRoomModal(roomIdFromUrl, 
                async (playerData) => {
                    console.log("[Main] URL Join: Player data from modal:", playerData);
                    ui.showModal(`Conectando a ${state.PIZARRA_PEER_ID_PREFIX}${roomIdFromUrl}... Por favor esperá. ⏳`);
                    
                    // Update the network inputs with the selected data
                    if (networkPlayerNameInput) networkPlayerNameInput.value = playerData.name;
                    if (networkPlayerIconSelect) networkPlayerIconSelect.value = playerData.icon;

                    state.setPvpRemoteActive(true);
                    ui.updateGameModeTabs('network');
                    if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'block';
                    if(document.getElementById('app')) document.getElementById('app').style.display = 'none';
                    ui.showScreen('networkSetup'); 

                    try {
                        console.log(`[Main] URL Join: Calling peerConnection.joinRoomById for room: ${roomIdFromUrl.trim()}`);
                        await peerConnection.joinRoomById(roomIdFromUrl.trim(), playerData);
                        console.log("[Main] URL Join: joinRoomById completed. Waiting for showLobby callback.");
                    } catch (error) {
                        console.error("[Main] URL Join: Error joining room:", error);
                        ui.hideModal(); 
                        ui.showModal(`Error al unirse a la sala: ${error.message || 'Intentá de nuevo o verificá el ID.'}`);
                        stopAnyActiveGameOrNetworkSession(true); 
                        ui.showScreen('networkSetup'); 
                    }
                },
                () => {
                    console.log("[Main] URL Join: Cancel button clicked."); 
                    ui.showScreen('localSetup'); 
                    ui.updateGameModeTabs('local'); 
                    exitPlayMode();
                }
            );
        } else {
            console.log("[Main] No room ID found in URL parameters.");
        }
    }

    window.pizarraUiUpdateCallbacks = {
        showLobby: (isHost) => {
            console.log(`[Main] UI Callback: showLobby. Is Host: ${isHost}. Current Room Data:`, state.getRawNetworkRoomData());
            ui.hideModal(); 
            if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'block';
            if(document.getElementById('app')) document.getElementById('app').style.display = 'none';
            ui.showScreen('lobby');
            ui.updateLobbyUI();
            if (isHost) {
                ui.displayRoomQRCodeAndLink(state.getRawNetworkRoomData().roomId, state.getRawNetworkRoomData().maxPlayers, PIZARRA_BASE_URL, state.PIZARRA_PEER_ID_PREFIX);
            } else {
                if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none';
            }
            exitPlayMode();
        },
        updateLobby: () => {
            // console.log("[Main] UI Callback: updateLobby.");
            ui.updateLobbyUI();
        },
        showNetworkError: (message, shouldReturnToSetupIfCritical = false) => {
            console.error(`[Main] UI Callback: showNetworkError. Message: ${message}, Critical: ${shouldReturnToSetupIfCritical}`);
            ui.showModal(`Error de Red: ${message}`, [{ text: "OK", action: () => {
                ui.hideModal();
                if (shouldReturnToSetupIfCritical) {
                    console.log("[Main] Critical network error, calling handleCancelMatchmaking.");
                    handleCancelMatchmaking(); 
                }
            }}]);
            sound.playErrorSound();
            exitPlayMode();
        },
        startGameOnNetwork: (initialGameState) => {
            console.log('[Main] UI Callback: startGameOnNetwork called with initialGameState:', initialGameState);
            ui.hideModal();
            if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none';
            ui.stopConfetti(); // Stop confetti from previous round
            
            if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'none';
            if(document.getElementById('app')) document.getElementById('app').style.display = 'flex';

            ui.renderFullGameBoard(state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId(), handleLetterClickUI);
            
            enterPlayMode();
            ui.displayMessage("¡El juego en red ha comenzado! 🎮🌍", 'info', false);
            sound.playGameStart();
        },
        updateGameFromNetwork: (guessResultPayload) => {
            // console.log('[Main] UI Callback: updateGameFromNetwork (GUESS_RESULT) received:', guessResultPayload);
            const { letter, correct, error, affectedPlayerId } = guessResultPayload;
            const playerMakingGuess = state.getPlayersData().find(p => p.id === affectedPlayerId);
            const guesserName = playerMakingGuess ? `${playerMakingGuess.icon}${playerMakingGuess.name}` : 'Alguien';

            if (error) {
                 ui.displayMessage(error, 'error');
            } else if (letter) {
                const messageText = correct ?
                    `'${letter.toUpperCase()}' es CORRECTA. ¡Bien hecho ${guesserName}! 🎉` :
                    `'${letter.toUpperCase()}' es INCORRECTA. (${guesserName}) ¡Upa! 😥`; 
                ui.displayMessage(messageText, correct ? 'success' : 'error', false);
                if (correct) sound.playLetterSelectSound(true); else sound.playLetterSelectSound(false);
            }
            refreshAlphabetKeyboard();
            ui.updateWordDisplay();
            ui.updateGuessedLettersDisplay();
            ui.updateScoreDisplayUI();
            ui.updateCurrentPlayerTurnUI();
            ui.updateStarsDisplay();
        },
        syncUIFromNetworkState: () => {
            console.log('[Main] UI Callback: syncUIFromNetworkState. Current game phase:', state.getGamePhase());
            const currentPhase = state.getGamePhase();
            if (currentPhase === 'lobby') {
                ui.hideModal();
                if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'block';
                if(document.getElementById('app')) document.getElementById('app').style.display = 'none';
                ui.showScreen('lobby');
                ui.updateLobbyUI();
                exitPlayMode();
            } else if (currentPhase === 'playing' || currentPhase === 'game_over' || currentPhase === 'ended') {
                ui.hideModal();
                if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'none';
                if(document.getElementById('app')) document.getElementById('app').style.display = 'flex';
                
                const isMyTurn = state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId();
                ui.renderFullGameBoard(isMyTurn, handleLetterClickUI);
                if (!state.getGameActive()) {
                    ui.toggleClueButtonUI(false, false);
                }
                if(currentPhase === 'playing') enterPlayMode(); else exitPlayMode();
            } else {
                console.log(`[Main] syncUIFromNetworkState: Unhandled phase '${currentPhase}' for full UI sync, potentially showing setup.`);
                 if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'block';
                if(document.getElementById('app')) document.getElementById('app').style.display = 'none';
                ui.showScreen('networkSetup'); 
                exitPlayMode();
            }
        },
        displayClueFromNetwork: (clueData) => {
            console.log('[Main] UI Callback: displayClueFromNetwork.', clueData);
            sound.playClueReveal();
            ui.displayClueOnUI(clueData.clue);
            ui.displayMessage("¡Pista mágica para todos! 🤫✨", 'info');
            ui.toggleClueButtonUI(false, true); // Show button but keep disabled
        },
        showNetworkGameOver: (gameOverData) => {
            console.log('[Main] UI Callback: showNetworkGameOver.', gameOverData);
            state.setGameActive(false); // Ensure game is marked inactive
            refreshAlphabetKeyboard();
            ui.toggleClueButtonUI(false, false);
            exitPlayMode();
        
            let message = gameOverData.reason ? `Juego terminado: ${gameOverData.reason}.` : "¡Juego Terminado!";
            let isWinForLocalPlayer = false;
        
            if (gameOverData.winnerData?.winners?.length > 0) {
                 const winnerNames = gameOverData.winnerData.winners.map(w => `${w.icon || ''}${w.name || 'Jugador Desconocido'}`).join(' y ');
                 isWinForLocalPlayer = gameOverData.winnerData.winners.some(w => w.id === state.getRawNetworkRoomData().myPlayerIdInRoom);
                 if(gameOverData.winnerData.isTie) {
                     message += ` ¡Empate entre ${winnerNames}! 🤝`;
                 } else if (winnerNames) {
                     message += ` ¡Ganador(es): ${winnerNames}! 🏆`;
                 }
            } else if (gameOverData.finalWord) {
                message += ` La palabra era: ${gameOverData.finalWord.toUpperCase()}.`;
            }
        
            if (gameOverData.finalScores) {
                const currentPlayers = state.getPlayersData(); // Use getPlayersData for a fresh clone
                const networkPlayers = state.getRawNetworkRoomData().players; // Raw for direct comparison
                
                const updatedPlayers = currentPlayers.map(pLocal => {
                    const pScoreUpdate = gameOverData.finalScores.find(ps => ps.id === pLocal.id);
                    return pScoreUpdate ? { ...pLocal, score: pScoreUpdate.score } : pLocal;
                });
                state.setPlayersData([...updatedPlayers]); // Update local and potentially network state via setter
                
                // Also ensure _networkRoomData.players is synced if this is host
                if(state.getRawNetworkRoomData().isRoomLeader){
                    const updatedNetworkPlayers = networkPlayers.map(pNet => {
                         const pScoreUpdate = gameOverData.finalScores.find(ps => ps.id === pNet.id);
                         return pScoreUpdate ? { ...pNet, score: pScoreUpdate.score } : pNet;
                    });
                    state.setNetworkRoomData({players: [...updatedNetworkPlayers]});
                }
                ui.updateScoreDisplayUI();
            }

            if (gameOverData.finalWord && !logic.checkWinCondition()) { // If word wasn't solved but is revealed
                const finalGuessed = new Set();
                for (const letter of gameOverData.finalWord.toUpperCase()) { 
                    finalGuessed.add(state.normalizeString(letter).toLowerCase()); 
                }
                state.setGuessedLetters(finalGuessed);
                ui.updateWordDisplay();
            }
        
            // Modal changes based on whether client or host
            if (state.getRawNetworkRoomData().isRoomLeader) {
                ui.showModal(message + "\nReiniciando automáticamente en unos segundos...", [], true); // Host sees this, no buttons. Actual restart in PeerConnection.
            } else {
                ui.showModal(message + "\nEsperando que el anfitrión inicie una nueva partida... ✨", [
                    {text: "🏠 Volver al Menú", action: () => { ui.stopConfetti(); returnToMainMenuUI();}, className: 'action-button-secondary'}
                ]);
            }
        
            if (isWinForLocalPlayer) { 
                sound.playWordSolvedSound(); 
                sound.triggerVibration([100, 40, 100, 40, 200]); 
                ui.startConfetti(200); 
            } else { 
                sound.playGameOverSound(); 
                sound.triggerVibration([70,50,70]); 
            }
        },
        handleCriticalDisconnect: () => {
            console.error("[Main] UI Callback: handleCriticalDisconnect.");
            exitPlayMode();
            handleCancelMatchmaking(); 
            ui.showModal("Desconectado de la partida. Volviendo al menú principal.", [{text: "OK", action: ui.hideModal}]);
        },
        showLobbyMessage: (messageText, isError = false) => {
            console.log(`[Main] UI Callback: showLobbyMessage. Text: ${messageText}, Error: ${isError}`);
            const lobbyMessageArea = document.getElementById('lobby-message-area');
            if(lobbyMessageArea) ui.displayMessage(messageText, isError ? 'error' : 'info', false, lobbyMessageArea);
        },
        hideModal: ui.hideModal,
        showModal: ui.showModal,
        hideNetworkInfo: () => {
            console.log("[Main] UI Callback: hideNetworkInfo.");
            if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none';
        }
    };

    function initializeAppEventListeners() {
        console.log("[Main] Initializing app event listeners.");
        gameModeTabs.forEach(tab => tab.addEventListener('click', () => {
            console.log(`[Main] Game mode tab clicked: ${tab.dataset.mode}`);
            sound.playUiClick();
            exitPlayMode();
            const newMode = tab.dataset.mode;
            const isCurrentlyPvp = state.getPvpRemoteActive();
            if ((newMode === 'local' && isCurrentlyPvp) || (newMode === 'network' && !isCurrentlyPvp)) {
                 console.log("[Main] Mode changed, stopping active session.");
                 stopAnyActiveGameOrNetworkSession(true);
            }
            ui.updateGameModeTabs(newMode);
            if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'block';
            if(document.getElementById('app')) document.getElementById('app').style.display = 'none';
            ui.showScreen(newMode === 'local' ? 'localSetup' : 'networkSetup');
            state.setPvpRemoteActive(newMode === 'network');
            console.log(`[Main] PVP mode set to: ${state.getPvpRemoteActive()}`);
        }));

        difficultyButtons.forEach(button => {
            button.addEventListener('click', (event) => {
                const newDifficulty = event.target.dataset.difficulty;
                console.log(`[Main] Difficulty button clicked: ${newDifficulty}`);
                sound.playUiClick();
                state.setCurrentDifficulty(newDifficulty);
                ui.updateDifficultyButtonUI();
                if (state.getPvpRemoteActive() && state.getRawNetworkRoomData().isRoomLeader) {
                    console.log("[Main] Host changed difficulty, updating network room data.");
                    state.setNetworkRoomData({ gameSettings: { ...state.getRawNetworkRoomData().gameSettings, difficulty: state.getCurrentDifficulty() } });
                    // Host should broadcast this change if lobby UI depends on it for all players
                    peerConnection.broadcastFullGameStateToAll(); // Simplest way to sync everyone
                }
            });
        });

        if(startLocalGameButton) startLocalGameButton.addEventListener('click', () => { console.log("[Main] Start Local Game button clicked."); sound.playUiClick(); startLocalGameUI(); });
        if(clueButtonEl) clueButtonEl.addEventListener('click', () => { console.log("[Main] Clue button clicked."); sound.playUiClick(); handleClueRequestUI(); });
        
        // Play Again button is now hidden for local play due to auto-restart
        // if(playAgainButtonEl) playAgainButtonEl.addEventListener('click', () => { /* ... */ });

        if(mainMenuButtonEl) mainMenuButtonEl.addEventListener('click', () => { console.log("[Main] Main Menu button clicked."); sound.playUiClick(); ui.stopConfetti(); returnToMainMenuUI(); });
        if(hostGameButton) hostGameButton.addEventListener('click', () => { console.log("[Main] Host Game button clicked."); sound.playUiClick(); hostGameUI(); });
        if(joinRandomButton) joinRandomButton.addEventListener('click', () => { console.log("[Main] Join Random button clicked."); sound.playUiClick(); joinRandomGameUI(); });

        if(copyRoomLinkButtonEl) copyRoomLinkButtonEl.addEventListener('click', () => {
            console.log("[Main] Copy Room Link button clicked.");
            sound.playUiClick();
            const roomId = state.getRawNetworkRoomData().roomId;
            if (!roomId) {
                console.warn("[Main] Copy Room Link: Room ID not available.");
                ui.displayMessage("ID de sala no disponible aún. 😔", "error", false, document.getElementById('lobby-message-area') || messageAreaEl);
                return;
            }
            const roomLink = `${PIZARRA_BASE_URL}?room=${roomId}`;
            navigator.clipboard.writeText(roomLink).then(() => {
                console.log("[Main] Room link copied to clipboard:", roomLink);
                ui.displayMessage("¡Enlace copiado al portapapeles! ✨", "success", false, document.getElementById('lobby-message-area') || messageAreaEl);
            }).catch(err => {
                console.error('[Main] Error al copiar enlace: ', err);
                ui.displayMessage("No se pudo copiar el enlace. 😔", "error", false, document.getElementById('lobby-message-area') || messageAreaEl);
            });
        });
        
        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.addEventListener('click', () => {
            console.log("[Main] Cancel Matchmaking button (standalone) clicked.");
            handleCancelMatchmaking();
        });

        if(lobbyToggleReadyButtonEl) lobbyToggleReadyButtonEl.addEventListener('click', () => {
            console.log("[Main] Lobby Toggle Ready button clicked.");
            sound.playUiClick(); sound.triggerVibration(25);
            const myPlayer = state.getRawNetworkRoomData().players.find(p => p.peerId === state.getMyPeerId());
            if(myPlayer) {
                console.log(`[Main] Sending player ready state: ${!myPlayer.isReady}`);
                peerConnection.sendPlayerReadyState(!myPlayer.isReady);
            } else {
                console.warn("[Main] Lobby Toggle Ready: My player not found in room data.");
            }
        });
        if(lobbyStartGameLeaderButtonEl) lobbyStartGameLeaderButtonEl.addEventListener('click', () => {
            console.log("[Main] Lobby Start Game Leader button clicked.");
            sound.playUiClick(); sound.triggerVibration(50);
            peerConnection.leaderStartGameRequest();
        });
        if(lobbyLeaveRoomButtonEl) lobbyLeaveRoomButtonEl.addEventListener('click', () => {
            console.log("[Main] Lobby Leave Room button clicked.");
            sound.playUiClick(); sound.triggerVibration(30);
             ui.showModal("¿Seguro que querés salir de la sala? 🚪🥺", [
                 {text: "Sí, Salir", action: returnToMainMenuUI, className: 'action-button-danger'},
                 {text: "No, Quedarme", action: ui.hideModal, className: 'action-button-secondary'}
                ]);
        });
        if(modalCloseButtonEl) modalCloseButtonEl.addEventListener('click', () => { console.log("[Main] Modal Close (X) button clicked."); sound.playUiClick(); ui.hideModal();});
        if(customModalEl) customModalEl.addEventListener('click', (e) => {
            if (e.target === customModalEl) {
                const hasDynamicButtons = modalDynamicButtonsEl && modalDynamicButtonsEl.children.length > 0;
                if (!hasDynamicButtons) { 
                    console.log("[Main] Clicked outside modal (no dynamic buttons), closing.");
                    sound.playUiClick(); 
                    ui.hideModal();
                } else {
                    console.log("[Main] Clicked outside modal (dynamic buttons present), not closing.");
                }
            }
        });

        const bodyEl = document.querySelector('body');
        const initAudioOnUserGesture = async () => {
            console.log("[Main] User gesture detected for audio initialization.");
            try {
                if (typeof Tone !== 'undefined' && Tone.start && Tone.context && Tone.context.state !== 'running') {
                    await Tone.start();
                    console.log("[Main] Tone.js AudioContext started on user gesture.");
                }
                if (sound?.initSounds && !sound.soundsCurrentlyInitialized) {
                    console.log("[Main] Initializing custom sounds.");
                    await sound.initSounds(); 
                }
            } catch (e) {
                console.warn("[Main] Error starting audio on user gesture:", e);
            }
        };
        bodyEl.addEventListener('click', initAudioOnUserGesture, { once: true });
        bodyEl.addEventListener('touchend', initAudioOnUserGesture, { once: true });

        console.log("[Main] App event listeners initialized.");
    }

    function initializeApp() {
        console.log("[Main] initializeApp called.");
        initializeAppEventListeners(); 
        
        if (typeof DICTIONARY_DATA !== 'undefined' && DICTIONARY_DATA.length > 0) {
            console.log("[Main] Dictionary loaded. Populating icons and setting defaults.");
            if(networkPlayerIconSelect) ui.populatePlayerIcons(networkPlayerIconSelect);
            state.setCurrentDifficulty('easy');
            ui.updateDifficultyButtonUI();
            stopAnyActiveGameOrNetworkSession(); // Ensures a clean start to the setup screen
        } else {
            console.error("[Main] CRITICAL ERROR: Dictionary not loaded.");
            ui.showModal("Error Crítico: El diccionario de palabras no está cargado. El juego no puede iniciar. 💔");
            exitPlayMode();
        }
        processUrlJoin(); 
        console.log("[Main] initializeApp completed.");
    }

    initializeApp();
});