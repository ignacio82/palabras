// main.js
import * as state from './pizarraState.js';
import * as logic from './gameLogic.js';
import * as peerConnection from './pizarraPeerConnection.js';
import * as matchmaking from './pizarraMatchmaking.js';
import * as ui from './pizarraUi.js';
import * as sound from './pizarraSound.js';

const PIZARRA_BASE_URL = "https://palabras.martinez.fyi";

document.addEventListener('DOMContentLoaded', () => {
    console.log("Pizarra de Palabras: DOMContentLoaded, initializing main.js with network features, haptics, and confetti.");

    // Initialize UI DOM references from pizarraUi.js
    ui.initializeUiDOMReferences();

    // --- DOM Element References (Mainly for event listeners in main.js) ---
    const gameModeTabs = document.querySelectorAll('.tab-button');
    const difficultyButtons = document.querySelectorAll('.difficulty-button');
    const startLocalGameButton = document.getElementById('start-local-game-button');

    const networkPlayerNameInput = document.getElementById('network-player-name'); // Used by getPlayerCustomizationDataFromUI
    const networkPlayerIconSelect = document.getElementById('network-player-icon'); // Used by getPlayerCustomizationDataFromUI
    const networkMaxPlayersSelect = document.getElementById('network-max-players');
    const hostGameButton = document.getElementById('host-game-button');
    const joinRandomButton = document.getElementById('join-random-button');
    const copyRoomLinkButtonEl = document.getElementById('copy-room-link-button'); // Listener set via ui.displayRoomQRCodeAndLink
    const cancelMatchmakingButtonEl = document.getElementById('cancel-matchmaking-button');

    const lobbyToggleReadyButtonEl = document.getElementById('lobby-toggle-ready-button');
    const lobbyStartGameLeaderButtonEl = document.getElementById('lobby-start-game-leader-button');
    const lobbyLeaveRoomButtonEl = document.getElementById('lobby-leave-room-button');

    const clueButtonEl = document.getElementById('clue-button');
    const playAgainButtonEl = document.getElementById('play-again-button');
    const mainMenuButtonEl = document.getElementById('main-menu-button');

    const customModalEl = document.getElementById('custom-modal'); // For backdrop click
    const modalCloseButtonEl = document.getElementById('modal-close-button');
    const modalDynamicButtonsEl = document.getElementById('modal-dynamic-buttons'); // For checking children length

    // Additional DOM elements needed by main.js
    const clueDisplayAreaEl = document.getElementById('clue-display-area');
    const messageAreaEl = document.getElementById('message-area');
    const networkInfoTitleEl = document.getElementById('network-info-title');
    const networkInfoTextEl = document.getElementById('network-info-text');
    const qrCodeContainerEl = document.getElementById('qr-code-container');

    // --- UI Update Functions (Specific adaptations from your RCA) ---

    // This function is now part of pizarraUi.js, but your RCA implies main.js has its own version.
    // For consistency with your RCA snippet for updateGameFromNetwork, I'll keep it here and it will call ui.updateAllAlphabetButtons
    function updateAlphabetEnablement() {
        if (!state.getGameActive()) {
            ui.updateAllAlphabetButtons(true); // Disable all if game not active
            return;
        }
        const myTurn = state.getPvpRemoteActive() ?
                       (state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) : // Corrected
                       true; // In local game, if active, it's effectively "my turn" to interact
        // The user's RCA for main.js's updateAlphabetEnablement was:
        // updateAllAlphabetButtons(!myTurn);
        // Assuming updateAllAlphabetButtons is now in ui.js and takes care of guessed letters.
        ui.updateAllAlphabetButtons(!myTurn || !state.getGameActive());
        // To be fully robust like the version in pizarraUi.js, it should recreate the keyboard:
        ui.createAlphabetKeyboard(myTurn, handleLetterClickUI); //MODIFIED: always call createAlphabetKeyboard as per pizarraUi's more robust update
    }

    // As per your RCA, this directly manipulates the DOM element.
    // The element ID in HTML is 'stars-display'. Your RCA used 'stars'.
    function updateStarsDisplay() { // This function name (updateStarsDisplay) is used in pizarraUi.js as well.
        // ui.updateStarsDisplay() should be called instead if it's the single source of truth for this UI update.
        // For now, keeping as per user's context that main.js might have its own distinct one.
        // However, the provided pizarraUi.js already has `export function updateStarsDisplay()`.
        // To avoid conflict and follow modularity, main.js should call ui.updateStarsDisplay().
        ui.updateStarsDisplay(); // Replaced with call to ui module
    }


    // --- Game Flow Functions ---
    function startLocalGameUI() {
        ui.stopConfetti();
        
        const selectedDifficulty = state.getCurrentDifficulty();
        console.log(`[Main] Starting local game with difficulty: ${selectedDifficulty}`);
        
        stopAnyActiveGameOrNetworkSession(true); // Preserve UI screen
        
        state.setCurrentDifficulty(selectedDifficulty); // Restore difficulty
        console.log(`[Main] Difficulty restored to: ${state.getCurrentDifficulty()}`);
        
        state.setPvpRemoteActive(false);
        state.setPlayersData([{ id: 0, name: "Jugador", icon: "✏️", color: state.DEFAULT_PLAYER_COLORS[0], score: 0 }]);
        state.setCurrentPlayerId(0);

        const initState = logic.initializeGame(state, state.getCurrentDifficulty());
        if (!initState.success) {
            ui.showModal(initState.message || "No se pudo iniciar juego local.");
            return;
        }
        
        console.log(`[Main] Game initialized with word: ${initState.currentWordObject?.word}, difficulty: ${state.getCurrentDifficulty()}`);
        
        ui.renderFullGameBoard(true, handleLetterClickUI); // Local game, always player's turn if active
        ui.showScreen('game');
        ui.displayMessage("Haz clic en una letra para adivinar...", 'info', true);
    }

    function handleLetterClickUI(letter, buttonElement) {
        console.log("[Main] Letter clicked:", letter, "Game active:", state.getGameActive(), "Button disabled:", buttonElement?.disabled);
        
        if (!state.getGameActive() || (buttonElement && buttonElement.disabled)) {
            console.log("[Main] Ignoring click - game not active or button disabled");
            return;
        }
        sound.triggerVibration(25);

        if (state.getPvpRemoteActive()) {
            if (state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) { // Corrected
                if (buttonElement) buttonElement.disabled = true; // Temporarily disable, will be re-enabled by state sync if turn persists
                peerConnection.sendGuessToHost(letter);
            } else {
                ui.displayMessage("No es tu turno.", 'error');
            }
            return;
        }

        // Local game
        console.log("[Main] Processing local game guess for letter:", letter);
        
        const result = logic.processGuess(letter); // gameLogic.processGuess updates state
        
        console.log("[Main] Guess result:", result);

        // Update the entire UI to reflect the new state including alphabet buttons
        ui.renderFullGameBoard(true, handleLetterClickUI);

        if (result.correct) {
            ui.displayMessage(`¡Muy bien! '${result.letter.toUpperCase()}' está en la palabra. 👍`, 'success');
            if (result.wordSolved) {
                console.log("[Main] Word solved! Ending game.");
                endGameUI(true);
                return;
            }
        } else {
            ui.displayMessage(`'${result.letter.toUpperCase()}' no está. ¡Pierdes una ${state.STAR_SYMBOL}!`, 'error');
            if (result.gameOver) {
                console.log("[Main] Game over! Ending game.");
                endGameUI(false);
                return;
            }
        }
    }

    function handleClueRequestUI() {
        if (!state.getGameActive() || state.getClueUsedThisGame() ||
            (state.getPvpRemoteActive() && state.getRawNetworkRoomData().myPlayerIdInRoom !== state.getCurrentPlayerId())) { // Corrected
            if (state.getPvpRemoteActive() && state.getRawNetworkRoomData().myPlayerIdInRoom !== state.getCurrentPlayerId()) { // Corrected
                ui.displayMessage("No es tu turno para pedir pista.", "error");
            } else if (state.getClueUsedThisGame()){
                ui.displayMessage("Ya usaste la pista para esta palabra.", "error");
            }
            return;
        }
        sound.triggerVibration(40);
        if (state.getPvpRemoteActive()) {
            peerConnection.sendClueRequestToHost();
            // Disable button immediately for client, host will confirm via state update
            if(clueButtonEl) clueButtonEl.disabled = true; 
            return;
        }
        const clueResult = logic.requestClue(state); // logic.requestClue updates state
        if (clueResult.success) {
            ui.displayClueOnUI(clueResult.clue); 
            ui.displayMessage("¡Pista revelada!", 'info');
            if(clueButtonEl) clueButtonEl.disabled = true;
        } else {
            ui.displayMessage(clueResult.message || "No se pudo obtener la pista.", 'error');
        }
    }

    function endGameUI(isWin) { // For local game over
        ui.updateAllAlphabetButtons(true); 
        ui.toggleClueButtonUI(false); 

        if (playAgainButtonEl) playAgainButtonEl.style.display = 'inline-block';
        if (mainMenuButtonEl) mainMenuButtonEl.style.display = 'inline-block';

        const wordObject = state.getCurrentWordObject();
        let finalMessage = "";
        if (isWin) {
            finalMessage = `¡GANASTE! 🎉 La palabra era: ${wordObject.word}`;
            ui.displayMessage(finalMessage, 'success', true);
            sound.triggerVibration([100, 40, 100, 40, 200]);
            ui.startConfetti();
        } else {
            if (wordObject?.word) {
                const finalGuessed = state.getGuessedLetters();
                for (const letter of state.getCurrentWord()) { finalGuessed.add(letter.toLowerCase()); } // Ensure lowercase for consistency
                state.setGuessedLetters(finalGuessed);
                ui.updateWordDisplay(); // Show the full word
                finalMessage = `¡Oh no! 😢 La palabra era: ${wordObject.word}`;
            } else {
                finalMessage = `¡Oh no! 😢 Intenta de nuevo.`;
            }
            ui.displayMessage(finalMessage, 'error', true);
            sound.triggerVibration([70, 50, 70]);
        }
    }

    function returnToMainMenuUI() {
        ui.stopConfetti();
        stopAnyActiveGameOrNetworkSession(); 
    }

    function stopAnyActiveGameOrNetworkSession(preserveUIScreen = false) {
        console.log("[Main] stopAnyActiveGameOrNetworkSession. Preserve UI:", preserveUIScreen);
        
        // --- PATCH: Guard against destroying fresh host peer ---
        // --- CORRECTED FUNCTION CALL ---
        const currentNetworkData = state.getRawNetworkRoomData(); 
        const rs = currentNetworkData.roomState;
        // --- END CORRECTED FUNCTION CALL ---
        if (rs === 'creating_room' || rs === 'lobby' || rs === 'awaiting_join_approval' || rs === 'seeking_match') {
            console.log(`[Main] stopAnyActiveGameOrNetworkSession: Aborting due to roomState '${rs}'. Host peer preserved.`);
            return;
        }
        // --- END PATCH ---

        const wasPvpActive = state.getPvpRemoteActive();
        if (state.getGameActive()) state.setGameActive(false);
        
        if (wasPvpActive) {
            peerConnection.closeAllConnectionsAndSession();
            if (currentNetworkData.roomState === 'seeking_match' && state.getMyPeerId()) { // Use currentNetworkData here
                 if (matchmaking && typeof matchmaking.leaveQueue === 'function') { // Ensure matchmaking is loaded
                    matchmaking.leaveQueue(state.getMyPeerId());
                }
            }
        }
        
        state.resetFullLocalStateForNewUIScreen(); 
        
        if (!preserveUIScreen) {
            ui.showScreen('localSetup');
            ui.updateDifficultyButtonUI(); // Ensure difficulty reflects state
            if (gameModeTabs.length > 0) ui.updateGameModeTabs('local'); // Ensure tab reflects state
        }
        
        if (clueDisplayAreaEl) clueDisplayAreaEl.style.display = 'none';
        if (messageAreaEl) ui.displayMessage('\u00A0', 'info', true); 
        if (cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
        ui.hideNetworkInfoArea();
        ui.stopConfetti();
        ui.updateScoreDisplayUI(); 
        ui.updateCurrentPlayerTurnUI(); 
        updateAlphabetEnablement(); // This calls ui.createAlphabetKeyboard
    }

    function getPlayerCustomizationDataFromUI(isModal = false, modalNameInput = null, modalIconSelect = null) {
        let name, icon;
        const randomSuffix = Math.floor(Math.random() * 100);
        if (isModal) {
            name = modalNameInput?.value.trim() || `Pizarrín${randomSuffix}`;
            icon = modalIconSelect?.value || state.AVAILABLE_ICONS[0];
        } else {
            name = networkPlayerNameInput?.value.trim() || `Pizarrín${randomSuffix}`;
            icon = networkPlayerIconSelect?.value || state.AVAILABLE_ICONS[0];
        }
        return { name, icon, color: state.DEFAULT_PLAYER_COLORS[0] }; 
    }

    async function hostGameUI() {
        stopAnyActiveGameOrNetworkSession(true); 
        ui.showModal("Creando tu sala de Pizarra...");
        sound.triggerVibration(50);
        const hostPlayerData = getPlayerCustomizationDataFromUI();
        const gameSettings = { difficulty: state.getCurrentDifficulty(), maxPlayers: parseInt(networkMaxPlayersSelect.value) || 2 };
        try {
            const hostPeerId = await peerConnection.hostNewRoom(hostPlayerData, gameSettings);
            ui.hideModal();
            window.pizarraUiUpdateCallbacks.showLobby(true); 
            if (matchmaking?.updateHostedRoomStatus && hostPeerId) {
                matchmaking.updateHostedRoomStatus(hostPeerId, state.getRawNetworkRoomData().gameSettings, state.getRawNetworkRoomData().maxPlayers, state.getRawNetworkRoomData().players.length, 'hosting_waiting_for_players'); // Corrected
            }
        } catch (error) {
            ui.hideModal(); ui.showModal(`Error al crear la sala: ${error.message || 'Desconocido'}.`);
            stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup');
        }
    }

    async function joinRandomGameUI() {
        stopAnyActiveGameOrNetworkSession(true); ui.showModal("Buscando una sala al azar..."); sound.triggerVibration(50); state.setPvpRemoteActive(true);
        const myPlayerData = getPlayerCustomizationDataFromUI();
        const preferences = { maxPlayers: parseInt(networkMaxPlayersSelect.value) || 2, gameSettings: { difficulty: state.getCurrentDifficulty() } };
        try {
            const localRawPeerId = await peerConnection.ensurePeerInitialized();
            if (!localRawPeerId) throw new Error("No se pudo obtener ID de PeerJS.");
            
            if (matchmaking && typeof matchmaking.joinQueue === 'function') {
                matchmaking.joinQueue(localRawPeerId, myPlayerData, preferences, {
                    onSearching: () => {
                        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'inline-block';
                        if(networkInfoTitleEl) networkInfoTitleEl.textContent = "Buscando Partida...";
                        if(networkInfoTextEl) networkInfoTextEl.textContent = "Intentando encontrar oponentes...";
                        if(qrCodeContainerEl) qrCodeContainerEl.innerHTML = ''; ui.showScreen('networkInfo');
                    },
                    onMatchFoundAndJoiningRoom: async (leaderRawPeerIdToJoin, roomDetails) => {
                        ui.hideModal(); ui.showModal(`Sala encontrada (${state.PIZARRA_PEER_ID_PREFIX}${leaderRawPeerIdToJoin}). Conectando...`);
                        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
                        try { await peerConnection.joinRoomById(leaderRawPeerIdToJoin, myPlayerData); } 
                        catch (joinError) { ui.hideModal(); ui.showModal(`Error al unirse: ${joinError.message || 'Desconocido'}`); stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup'); }
                    },
                    onMatchFoundAndHostingRoom: async (myNewRawPeerIdForHosting, initialHostData) => {
                        ui.hideModal(); 
                        try { await peerConnection.hostNewRoom(myPlayerData, initialHostData.gameSettings); } 
                        catch (hostError) { ui.showModal(`Error al crear sala: ${hostError.message}`); stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup'); }
                        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
                    },
                    onError: (errMsg) => {
                        ui.hideModal(); ui.showModal(`Error de Matchmaking: ${errMsg}`);
                        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
                        stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup');
                    }
                });
            } else {
                 ui.hideModal(); ui.showModal(`Error: Matchmaking no está disponible.`);
                 stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup');
            }
        } catch (initError) {
            ui.hideModal(); ui.showModal(`Error de Red: ${initError.message || 'No se pudo inicializar.'}`);
            stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup');
        }
    }

    // --- Global UI Callbacks for PeerConnection & Matchmaking ---
    window.pizarraUiUpdateCallbacks = {
        showLobby: (isHost) => {
            ui.hideModal(); ui.showScreen('lobby'); ui.updateLobbyUI();
            if (isHost) ui.displayRoomQRCodeAndLink(state.getRawNetworkRoomData().roomId, state.getRawNetworkRoomData().maxPlayers, PIZARRA_BASE_URL, state.PIZARRA_PEER_ID_PREFIX); // Corrected
            else ui.hideNetworkInfoArea();
        },
        updateLobby: ui.updateLobbyUI,
        showNetworkError: (message, shouldReturnToSetup = false) => {
            ui.showModal(message); if (shouldReturnToSetup) stopAnyActiveGameOrNetworkSession(); // This will show 'localSetup' by default
        },
        startGameOnNetwork: (initialGameState) => { 
            console.log('[Main] startGameOnNetwork received initialGameState:', initialGameState);
            ui.hideModal(); ui.hideNetworkInfoArea(); ui.stopConfetti();
            
            // State module should handle setting its own data based on initialGameState
            // For example, pizarraPeerConnection should have already called state.setPlayersData, etc.
            // This callback should primarily be about UI rendering from the new state.

            state.setPlayersData(initialGameState.playersInGameOrder); 
            state.setRemainingAttemptsPerPlayer(initialGameState.remainingAttemptsPerPlayer); 
            state.setCurrentWordObject(initialGameState.currentWordObject); 
            state.setGuessedLetters(new Set(initialGameState.guessedLetters || [])); 
            state.setCurrentPlayerId(initialGameState.startingPlayerId);
            state.setClueUsedThisGame(initialGameState.clueUsed || false);
            state.setCurrentDifficulty(initialGameState.gameSettings.difficulty); 
            state.setGameActive(true);
            state.setGamePhase('playing'); // Make sure game phase is also set

            const isMyTurn = state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId(); // Corrected
            ui.renderFullGameBoard(isMyTurn, handleLetterClickUI); 

            ui.showScreen('game');
            ui.displayMessage("¡El juego en red ha comenzado!", 'info', true);
            
            if (sound && typeof sound.playGameStart === 'function') { 
                sound.playGameStart();
            }
        },
        updateGameFromNetwork: (guessResultPayload) => { 
            console.log('[Main] updateGameFromNetwork received payload:', guessResultPayload);
            // State (currentPlayerId, remainingAttemptsPerPlayer, guessedLetters) is updated by pizarraPeerConnection.js
            // This function now primarily focuses on UI refresh using the new state.
            
            ui.updateStarsDisplay(); 
            updateAlphabetEnablement(); // This calls ui.createAlphabetKeyboard which uses current state
            
            ui.updateWordDisplay();
            ui.updateGuessedLettersDisplay();
            ui.updateScoreDisplayUI();
            ui.updateCurrentPlayerTurnUI();

            const { letter, correct, gameOver, wordSolved, affectedPlayerId, error } = guessResultPayload; 
            
            if (error) {
                 ui.displayMessage(error, 'error');
            } else {
                const playerMakingGuess = state.getPlayersData().find(p => p.id === affectedPlayerId);
                const guesserName = playerMakingGuess ? `${playerMakingGuess.icon}${playerMakingGuess.name}` : 'Alguien';
                const messageText = correct ? 
                    `'${letter.toUpperCase()}' es CORRECTA. (${guesserName})` : 
                    `'${letter.toUpperCase()}' es INCORRECTA. (${guesserName})`;
                ui.displayMessage(messageText, correct ? 'success' : 'error');
            }


            if (gameOver) { // This implies word solved OR player lost (ran out of attempts and didn't solve)
                state.setGameActive(false); // Ensure game state reflects this
                updateAlphabetEnablement(); // Re-render to disable based on new gameActive state
                ui.toggleClueButtonUI(false); // Disable clue button
                // Specific game over message (win/loss) is handled by GAME_OVER_ANNOUNCEMENT
            }
        },
        // --- PATCH: Add new callback for state_sync UI updates ---
        syncGameUIFromNetworkState: (/* networkState is already set in global state via pizarraPeerConnection */) => {
            console.log('[Main] Forcing UI sync from full network state.');
            
            if (state.getGamePhase() === 'lobby') {
                ui.updateLobbyUI();
            } else if (state.getGamePhase() === 'playing' || state.getGamePhase() === 'ended' || state.getGamePhase() === 'game_over') {
                const isMyTurn = state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId(); // Corrected
                ui.renderFullGameBoard(isMyTurn, handleLetterClickUI);

                if (!state.getGameActive()) {
                    ui.updateAllAlphabetButtons(true); 
                    ui.toggleClueButtonUI(false, false); 
                }
            }
        },
        // --- END PATCH ---
        displayClueFromNetwork: (clueData) => {
            // State (clueUsed, remainingAttempts) is already updated by pizarraPeerConnection.js
            ui.displayClueOnUI(clueData.clue); 
            ui.updateStarsDisplay(); 
            ui.displayMessage("Pista revelada para todos.", 'info');
            ui.toggleClueButtonUI(false, true); // Disable clicking, but keep visible
        },
        showNetworkGameOver: (gameOverData) => {
            state.setGameActive(false); ui.updateAllAlphabetButtons(true); ui.toggleClueButtonUI(false, false); 
            let message = gameOverData.reason ? `Juego terminado: ${gameOverData.reason}.` : "¡Juego Terminado!";
            let isWinForLocalPlayer = false;
            
            if (gameOverData.winnerData?.winners?.length > 0) { 
                 const winnerNames = gameOverData.winnerData.winners.map(w => `${w.icon || ''}${w.name}`).join(' y ');
                 isWinForLocalPlayer = gameOverData.winnerData.winners.some(w => w.id === state.getRawNetworkRoomData().myPlayerIdInRoom); // Corrected
                 if(gameOverData.winnerData.isTie) { 
                     message += ` ¡Empate entre ${winnerNames}!`; 
                     isWinForLocalPlayer = gameOverData.winnerData.winners.some(w => w.id === state.getRawNetworkRoomData().myPlayerIdInRoom); // Corrected
                 } else if (winnerNames) {
                     message += ` ¡Ganador(es): ${winnerNames}!`;
                 }
            } else if (gameOverData.finalWord) { 
                message += ` La palabra era: ${gameOverData.finalWord}.`;
            }

            if(gameOverData.finalScores) {
                const currentPlayers = state.getPlayersData();
                gameOverData.finalScores.forEach(ps => { 
                    const pLocal = currentPlayers.find(p => p.id === ps.id); 
                    if(pLocal) pLocal.score = ps.score; 
                });
                state.setPlayersData(currentPlayers); 
                ui.updateScoreDisplayUI();
            }
            
            ui.showModal(message, [{text: "Volver al Menú", action: () => { ui.stopConfetti(); returnToMainMenuUI();}, className: 'action-button'}]);
            if (isWinForLocalPlayer) { sound.triggerVibration([100, 40, 100, 40, 200]); ui.startConfetti(); }
            else { sound.triggerVibration([70,50,70]); }
        }
    };

    // --- Event Listener Setup ---
    function initializeAppEventListeners() {
        gameModeTabs.forEach(tab => tab.addEventListener('click', () => {
            const newMode = tab.dataset.mode;
            if ( (newMode === 'local' && state.getPvpRemoteActive()) || (newMode === 'network' && !state.getPvpRemoteActive()) ) {
                 stopAnyActiveGameOrNetworkSession(true); 
            }
            ui.updateGameModeTabs(newMode); 
            ui.showScreen(newMode === 'local' ? 'localSetup' : 'networkSetup');
        }));
        
        difficultyButtons.forEach(button => {
            button.addEventListener('click', (event) => {
                console.log(`[Main] Difficulty button clicked: ${event.target.dataset.difficulty}`);
                state.setCurrentDifficulty(event.target.dataset.difficulty);
                ui.updateDifficultyButtonUI();
                if (sound && typeof sound.playUiClick === 'function') sound.playUiClick();
                console.log(`[Main] Difficulty set to: ${state.getCurrentDifficulty()}`);
            });
        });
        
        if(startLocalGameButton) startLocalGameButton.addEventListener('click', () => { startLocalGameUI(); if(sound) sound.playUiClick();});
        if(clueButtonEl) clueButtonEl.addEventListener('click', () => { handleClueRequestUI(); if(sound) sound.playUiClick();});
        if(playAgainButtonEl) playAgainButtonEl.addEventListener('click', () => {
            ui.stopConfetti();
            if (state.getPvpRemoteActive()) { 
                ui.showModal("Jugar otra vez en red no está implementado para iniciar desde aquí. El líder puede empezar una nueva partida o puedes volver al menú.", [{text: "OK", action: returnToMainMenuUI}]);
            } else {
                startLocalGameUI(); 
            }
            if(sound) sound.playUiClick();
        });
        if(mainMenuButtonEl) mainMenuButtonEl.addEventListener('click', () => { ui.stopConfetti(); returnToMainMenuUI(); if(sound) sound.playUiClick();});
        if(hostGameButton) hostGameButton.addEventListener('click', () => { hostGameUI(); if(sound) sound.playUiClick();});
        if(joinRandomButton) joinRandomButton.addEventListener('click', () => { joinRandomGameUI(); if(sound) sound.playUiClick();});
        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.addEventListener('click', () => {
            if(state.getMyPeerId() && matchmaking && typeof matchmaking.leaveQueue === 'function') matchmaking.leaveQueue(state.getMyPeerId()); 
            stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup'); ui.displayMessage("Búsqueda cancelada.", "info");
            if(sound) sound.playUiClick();
        });
        if(lobbyToggleReadyButtonEl) lobbyToggleReadyButtonEl.addEventListener('click', () => {
            const myPlayer = state.getRawNetworkRoomData().players.find(p => p.peerId === state.getMyPeerId()); // Corrected
            if(myPlayer) peerConnection.sendPlayerReadyState(!myPlayer.isReady); sound.triggerVibration(25); if(sound) sound.playUiClick();
        });
        if(lobbyStartGameLeaderButtonEl) lobbyStartGameLeaderButtonEl.addEventListener('click', () => { peerConnection.leaderStartGameRequest(); sound.triggerVibration(50); });
        if(lobbyLeaveRoomButtonEl) lobbyLeaveRoomButtonEl.addEventListener('click', () => {
             ui.showModal("¿Seguro que quieres salir de la sala?", [{text: "Sí, Salir", action: returnToMainMenuUI, className: 'action-button-danger'}, {text: "No", action: ui.hideModal, className: 'action-button-secondary'}]);
            sound.triggerVibration(30); if(sound) sound.playUiClick();
        });
        if(modalCloseButtonEl) modalCloseButtonEl.addEventListener('click', () => {ui.hideModal(); if(sound) sound.playUiClick();});
        if(customModalEl) customModalEl.addEventListener('click', (e) => { if (e.target === customModalEl && modalDynamicButtonsEl.children.length === 0) {ui.hideModal(); if(sound) sound.playUiClick();} });
    
        const bodyEl = document.querySelector('body');
        const initAudio = async () => {
            if (sound && typeof sound.initSounds === 'function' && !sound.soundsCurrentlyInitialized) { 
                await sound.initSounds();
            }
            // bodyEl.removeEventListener('click', initAudio); // Removed by {once: true}
            // bodyEl.removeEventListener('touchend', initAudio); // Removed by {once: true}
        };
        bodyEl.addEventListener('click', initAudio, { once: true }); 
        bodyEl.addEventListener('touchend', initAudio, { once: true });

        console.log("App event listeners initialized.");
    }

    // --- Initialize Application ---
    function initializeApp() {
        ui.initializeUiDOMReferences(); 
        initializeAppEventListeners();
        if (typeof DICTIONARY_DATA !== 'undefined' && DICTIONARY_DATA.length > 0) {
            ui.populatePlayerIcons(networkPlayerIconSelect); 
            state.setCurrentDifficulty('easy'); 
            ui.updateDifficultyButtonUI(); 
            returnToMainMenuUI(); 
        } else { ui.showModal("Error Crítico: Diccionario no cargado."); }
        processUrlJoin(); 
    }

    async function processUrlJoin() { 
        const urlParams = new URLSearchParams(window.location.search);
        const roomIdFromUrl = urlParams.get('room');
        if (roomIdFromUrl && roomIdFromUrl.trim()) {
            window.history.replaceState({}, document.title, PIZARRA_BASE_URL); 
            const modalPlayerNameId = 'modal-player-name-urljoin'; 
            const modalPlayerIconId = 'modal-player-icon-urljoin';
            const joinPromptHtml = `
                <p>Intentando unirse a la sala ${state.PIZARRA_PEER_ID_PREFIX}${roomIdFromUrl}.</p>
                <p>¡Configura tu identidad para la partida!</p>
                <div class="modal-form-inputs">
                    <label for="${modalPlayerNameId}">Tu Nombre:</label>
                    <input type="text" id="${modalPlayerNameId}" value="${networkPlayerNameInput?.value || `Pizarrín${Math.floor(Math.random()*100)}`}" maxlength="15">
                    <label for="${modalPlayerIconId}">Tu Ícono:</label>
                    <select id="${modalPlayerIconId}"></select>
                </div>`;
            ui.showModal(joinPromptHtml, [
                { text: "✅ Unirme a la Sala", className: 'action-button-confirm', action: async () => {
                    ui.hideModal(); ui.showModal(`Conectando a ${state.PIZARRA_PEER_ID_PREFIX}${roomIdFromUrl}...`);
                    const nameInputInModal = document.getElementById(modalPlayerNameId); 
                    const iconSelectInModal = document.getElementById(modalPlayerIconId);
                    const joinerPlayerData = getPlayerCustomizationDataFromUI(true, nameInputInModal, iconSelectInModal);
                    state.setPvpRemoteActive(true); 
                    try { 
                        await peerConnection.joinRoomById(roomIdFromUrl.trim(), joinerPlayerData); 
                    } catch (error) { 
                        ui.hideModal(); ui.showModal(`Error al unirse: ${error.message || 'Desconocido'}`); 
                        stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup'); 
                    }
                }},
                { text: "❌ Cancelar", action: () => { ui.hideModal(); ui.showScreen('networkSetup'); }, className: 'action-button-secondary'}
            ], true); 
            const iconSelectInModal = document.getElementById(modalPlayerIconId);
            if (iconSelectInModal) { 
                ui.populatePlayerIcons(iconSelectInModal); 
                if(networkPlayerIconSelect) iconSelectInModal.value = networkPlayerIconSelect.value; 
            }
        }
    }
    initializeApp();
});