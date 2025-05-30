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
                       (state.getNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) :
                       true; // In local game, if active, it's effectively "my turn" to interact
        // The user's RCA for main.js's updateAlphabetEnablement was:
        // updateAllAlphabetButtons(!myTurn);
        // Assuming updateAllAlphabetButtons is now in ui.js and takes care of guessed letters.
        ui.updateAllAlphabetButtons(!myTurn || !state.getGameActive());
        // To be fully robust like the version in pizarraUi.js, it should recreate the keyboard:
        // ui.createAlphabetKeyboard(myTurn, handleLetterClickUI);
    }

    // As per your RCA, this directly manipulates the DOM element.
    // The element ID in HTML is 'stars-display'. Your RCA used 'stars'.
    function updateStarsDisplay() {
        const starsDisplayElement = document.getElementById('stars-display'); // Correct ID
        if (!starsDisplayElement) return;

        let pidToShowAttemptsFor = null;
        if (state.getPvpRemoteActive()) {
            pidToShowAttemptsFor = state.getNetworkRoomData().myPlayerIdInRoom;
            if (pidToShowAttemptsFor === null || pidToShowAttemptsFor === undefined) {
                // Fallback if myPlayerIdInRoom isn't set yet, perhaps show for current player or default
                pidToShowAttemptsFor = state.getCurrentPlayerId();
            }
        } else {
            pidToShowAttemptsFor = state.getCurrentPlayerId();
        }
        
        const left = state.getAttemptsFor(pidToShowAttemptsFor);
        starsDisplayElement.textContent = state.STAR_SYMBOL.repeat(Math.max(0, left));
    }


    // --- Game Flow Functions ---
    function startLocalGameUI() {
        ui.stopConfetti();
        stopAnyActiveGameOrNetworkSession(true);
        state.setPvpRemoteActive(false);
        state.setPlayersData([{ id: 0, name: "Jugador", icon: "✏️", color: state.DEFAULT_PLAYER_COLORS[0], score: 0 }]);
        state.setCurrentPlayerId(0);

        const initState = logic.initializeGame(state, state.getCurrentDifficulty());
        if (!initState.success) {
            ui.showModal(initState.message || "No se pudo iniciar juego local.");
            return;
        }
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
            if (state.getNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) {
                if (buttonElement) buttonElement.disabled = true;
                peerConnection.sendGuessToHost(letter);
            } else {
                ui.displayMessage("No es tu turno.", 'error');
            }
            return;
        }

        // Local game
        console.log("[Main] Processing local game guess for letter:", letter);
        
        // Disable button immediately to prevent multiple clicks
        if (buttonElement) {
            buttonElement.disabled = true;
            buttonElement.classList.add('guessed');
        }
        
        const result = logic.processGuess(letter); // gameLogic.processGuess updates state
        
        console.log("[Main] Guess result:", result);

        // Update the entire UI to reflect the new state
        ui.updateStarsDisplay(); 
        ui.updateWordDisplay();  
        ui.updateGuessedLettersDisplay(); 
        
        // Recreate alphabet keyboard with proper states
        updateAlphabetEnablement();

        if (result.correct) {
            ui.displayMessage(`¡Muy bien! '${result.letter}' está en la palabra. 👍`, 'success');
            if (result.wordSolved) {
                console.log("[Main] Word solved! Ending game.");
                endGameUI(true);
                return;
            }
        } else {
            ui.displayMessage(`'${result.letter}' no está. ¡Pierdes una ${state.STAR_SYMBOL}!`, 'error');
            if (result.gameOver) {
                console.log("[Main] Game over! Ending game.");
                endGameUI(false);
                return;
            }
        }
        
        ui.updateCurrentPlayerTurnUI();
    }

    function handleClueRequestUI() {
        if (!state.getGameActive() || state.getClueUsedThisGame() ||
            (state.getPvpRemoteActive() && state.getNetworkRoomData().myPlayerIdInRoom !== state.getCurrentPlayerId())) {
            if (state.getPvpRemoteActive() && state.getNetworkRoomData().myPlayerIdInRoom !== state.getCurrentPlayerId()) {
                ui.displayMessage("No es tu turno para pedir pista.", "error");
            }
            return;
        }
        sound.triggerVibration(40);
        if (state.getPvpRemoteActive()) {
            peerConnection.sendClueRequestToHost();
            return;
        }
        const clueResult = logic.requestClue(state); // logic.requestClue updates state
        if (clueResult.success) {
            ui.displayClueOnUI(clueResult.clue); // New function in pizarraUi.js
            ui.displayMessage("¡Pista revelada!", 'info');
        } else {
            ui.displayMessage(clueResult.message || "No se pudo obtener la pista.", 'error');
        }
    }

    function endGameUI(isWin) { // For local game over
        ui.updateAllAlphabetButtons(true); // Disable all alphabet buttons
        ui.toggleClueButtonUI(false); // Disable and hide clue button

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
                for (const letter of state.getCurrentWord()) { finalGuessed.add(letter); }
                state.setGuessedLetters(finalGuessed);
                ui.updateWordDisplay();
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
        stopAnyActiveGameOrNetworkSession(); // This resets state and shows local setup
    }

    function stopAnyActiveGameOrNetworkSession(preserveUIScreen = false) {
        console.log("[Main] stopAnyActiveGameOrNetworkSession. Preserve UI:", preserveUIScreen);
        const wasPvpActive = state.getPvpRemoteActive();
        if (state.getGameActive()) state.setGameActive(false);
        if (wasPvpActive) {
            peerConnection.closeAllConnectionsAndSession();
            if (state.getNetworkRoomData().roomState === 'seeking_match' && state.getMyPeerId()) {
                matchmaking.leaveQueue(state.getMyPeerId());
            }
        }
        state.resetFullLocalStateForNewUIScreen();
        if (!preserveUIScreen) {
            ui.showScreen('localSetup');
            ui.updateDifficultyButtonUI();
            if (gameModeTabs.length > 0) ui.updateGameModeTabs('local');
        }
        if (clueDisplayAreaEl) clueDisplayAreaEl.style.display = 'none';
        if (messageAreaEl) ui.displayMessage('\u00A0', 'info', true); // Clear message
        if (cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
        ui.hideNetworkInfoArea();
        ui.stopConfetti();
        ui.updateScoreDisplayUI();
        ui.updateCurrentPlayerTurnUI();
        ui.updateAlphabetEnablement(handleLetterClickUI); // Reset alphabet keyboard
    }

    function getPlayerCustomizationDataFromUI(isModal = false, modalNameInput = null, modalIconSelect = null) {
        let name, icon;
        if (isModal) {
            name = modalNameInput?.value.trim() || `Pizarrín${Math.floor(Math.random() * 100)}`;
            icon = modalIconSelect?.value || state.AVAILABLE_ICONS[0];
        } else {
            name = networkPlayerNameInput?.value.trim() || `Pizarrín${Math.floor(Math.random() * 100)}`;
            icon = networkPlayerIconSelect?.value || state.AVAILABLE_ICONS[0];
        }
        return { name, icon, color: state.DEFAULT_PLAYER_COLORS[0] }; // Default color, host assigns final
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
            window.pizarraUiUpdateCallbacks.showLobby(true); // This will call ui.displayRoomQRCodeAndLink
            if (matchmaking?.updateHostedRoomStatus && hostPeerId) {
                matchmaking.updateHostedRoomStatus(hostPeerId, state.getNetworkRoomData().gameSettings, state.getNetworkRoomData().maxPlayers, state.getNetworkRoomData().players.length, 'hosting_waiting_for_players');
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
        } catch (initError) {
            ui.hideModal(); ui.showModal(`Error de Red: ${initError.message || 'No se pudo inicializar.'}`);
            stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup');
        }
    }

    // --- Global UI Callbacks for PeerConnection & Matchmaking ---
    window.pizarraUiUpdateCallbacks = {
        showLobby: (isHost) => {
            ui.hideModal(); ui.showScreen('lobby'); ui.updateLobbyUI();
            if (isHost) ui.displayRoomQRCodeAndLink(state.getNetworkRoomData().roomId, state.getNetworkRoomData().maxPlayers, PIZARRA_BASE_URL, state.PIZARRA_PEER_ID_PREFIX);
            else ui.hideNetworkInfoArea();
        },
        updateLobby: ui.updateLobbyUI,
        showNetworkError: (message, shouldReturnToSetup = false) => {
            ui.showModal(message); if (shouldReturnToSetup) stopAnyActiveGameOrNetworkSession();
        },
        startGameOnNetwork: (initialGameState) => { // UPDATED as per your RCA
            console.log('[Main] startGameOnNetwork received initialGameState:', initialGameState);
            ui.hideModal(); ui.hideNetworkInfoArea(); ui.stopConfetti();
            
            state.setPlayersData(initialGameState.playersInGameOrder); // This also calls initRemainingAttempts
            state.setRemainingAttemptsPerPlayer(initialGameState.remainingAttemptsPerPlayer); // Use setter
            
            state.setCurrentWordObject(initialGameState.currentWordObject); // Set word object
            state.setGuessedLetters(new Set(initialGameState.guessedLetters || [])); // Make sure this is also set
            state.setCurrentPlayerId(initialGameState.startingPlayerId);
            state.setClueUsedThisGame(initialGameState.clueUsed || false);
            state.setCurrentDifficulty(initialGameState.gameSettings.difficulty); // Ensure difficulty is synced
            state.setGameActive(true);
            state.setGamePhase('playing');

            // Call ui.renderFullGameBoard() as per your RCA's intention
            // This function in pizarraUi.js will handle all individual UI updates.
            const isMyTurn = state.getNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId();
            ui.renderFullGameBoard(isMyTurn, handleLetterClickUI); // Pass the callback

            ui.showScreen('game');
            ui.displayMessage("¡El juego en red ha comenzado!", 'info', true);
            
            if (sound && typeof sound.playGameStart === 'function') { // Check if sound module and function exist
                sound.playGameStart();
            }
        },
        updateGameFromNetwork: (guessResultPayload) => { // UPDATED as per your RCA
            console.log('[Main] updateGameFromNetwork received payload:', guessResultPayload);
            // State (currentPlayerId, remainingAttemptsPerPlayer, guessedLetters) is ALREADY updated by pizarraPeerConnection.js
            // This function now primarily focuses on UI refresh using the new state.
            
            ui.updateStarsDisplay(); // Uses new state.getAttemptsFor
            // updateAlphabetEnablement below will call ui.createAlphabetKeyboard
            updateAlphabetEnablement(); 
            
            ui.updateWordDisplay();
            ui.updateGuessedLettersDisplay();
            ui.updateScoreDisplayUI();
            ui.updateCurrentPlayerTurnUI();

            const { letter, correct, gameOver, wordSolved } = guessResultPayload; // Use destructured from payload
            ui.displayMessage(correct ? `'${letter}' es CORRECTA.` : `'${letter}' es INCORRECTA.`, correct ? 'success' : 'error');

            if (gameOver) {
                state.setGameActive(false);
                updateAlphabetEnablement(); // Ensure alphabet is disabled
            }
        },
        displayClueFromNetwork: (clueData) => {
            state.setClueUsedThisGame(clueData.clueUsed);
            if (clueData.remainingAttemptsPerPlayer) { 
                state.setRemainingAttemptsPerPlayer(clueData.remainingAttemptsPerPlayer); 
            }
            ui.displayClueOnUI(clueData.clue); // Use the specific UI function
            ui.updateStarsDisplay(); 
            ui.displayMessage("Pista revelada para todos.", 'info');
            ui.toggleClueButtonUI(false, true); // Disable, but keep visible
        },
        showNetworkGameOver: (gameOverData) => {
            state.setGameActive(false); ui.updateAllAlphabetButtons(true); ui.toggleClueButtonUI(false);
            let message = gameOverData.reason ? `Juego terminado: ${gameOverData.reason}.` : "¡Juego Terminado!";
            let isWinForLocalPlayer = false;
            if (gameOverData.winnerData) {
                 const winners = gameOverData.winnerData.winners.map(w => `${w.icon || ''}${w.name}`).join(' y ');
                 isWinForLocalPlayer = gameOverData.winnerData.winners.some(w => w.id === state.getNetworkRoomData().myPlayerIdInRoom);
                 if(gameOverData.winnerData.isTie && winners) { message += ` ¡Empate entre ${winners}!`; isWinForLocalPlayer = true; }
                 else if (winners) message += ` ¡Ganador(es): ${winners}!`;
            }
            if(gameOverData.finalScores) {
                gameOverData.finalScores.forEach(ps => { const pLocal = state.getPlayersData().find(p => p.id === ps.id); if(pLocal) pLocal.score = ps.score; });
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
            stopAnyActiveGameOrNetworkSession(true);
            ui.updateGameModeTabs(tab.dataset.mode); // Use UI function
            ui.showScreen(tab.dataset.mode === 'local' ? 'localSetup' : 'networkSetup');
        }));
        difficultyButtons.forEach(b => b.addEventListener('click', (e) => { state.setCurrentDifficulty(e.target.dataset.difficulty); ui.updateDifficultyButtonUI(); if(sound) sound.playUiClick(); }));
        if(startLocalGameButton) startLocalGameButton.addEventListener('click', () => { startLocalGameUI(); if(sound) sound.playUiClick();});
        if(clueButtonEl) clueButtonEl.addEventListener('click', () => { handleClueRequestUI(); if(sound) sound.playUiClick();});
        if(playAgainButtonEl) playAgainButtonEl.addEventListener('click', () => {
            ui.stopConfetti();
            if (state.getPvpRemoteActive()) ui.showModal("Jugar otra vez en red no implementado. Volviendo al menú.", [{text: "OK", action: returnToMainMenuUI}]);
            else startLocalGameUI();
            if(sound) sound.playUiClick();
        });
        if(mainMenuButtonEl) mainMenuButtonEl.addEventListener('click', () => { ui.stopConfetti(); returnToMainMenuUI(); if(sound) sound.playUiClick();});
        if(hostGameButton) hostGameButton.addEventListener('click', () => { hostGameUI(); if(sound) sound.playUiClick();});
        if(joinRandomButton) joinRandomButton.addEventListener('click', () => { joinRandomGameUI(); if(sound) sound.playUiClick();});
        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.addEventListener('click', () => {
            if(state.getMyPeerId()) matchmaking.leaveQueue(state.getMyPeerId()); 
            stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup'); ui.displayMessage("Búsqueda cancelada.", "info");
            if(sound) sound.playUiClick();
        });
        if(lobbyToggleReadyButtonEl) lobbyToggleReadyButtonEl.addEventListener('click', () => {
            const myPlayer = state.getNetworkRoomData().players.find(p => p.peerId === state.getMyPeerId());
            if(myPlayer) peerConnection.sendPlayerReadyState(!myPlayer.isReady); sound.triggerVibration(25); if(sound) sound.playUiClick();
        });
        if(lobbyStartGameLeaderButtonEl) lobbyStartGameLeaderButtonEl.addEventListener('click', () => { peerConnection.leaderStartGameRequest(); sound.triggerVibration(50); /* game start sound is in callback */});
        if(lobbyLeaveRoomButtonEl) lobbyLeaveRoomButtonEl.addEventListener('click', () => {
             ui.showModal("¿Seguro que quieres salir?", [{text: "Sí, Salir", action: stopAnyActiveGameOrNetworkSession, className: 'action-button-danger'}, {text: "No", action: ui.hideModal, className: 'action-button-secondary'}]);
            sound.triggerVibration(30); if(sound) sound.playUiClick();
        });
        if(modalCloseButtonEl) modalCloseButtonEl.addEventListener('click', () => {ui.hideModal(); if(sound) sound.playUiClick();});
        if(customModalEl) customModalEl.addEventListener('click', (e) => { if (e.target === customModalEl && modalDynamicButtonsEl.children.length === 0) {ui.hideModal(); if(sound) sound.playUiClick();} });
    
        // First user interaction to enable audio context for Tone.js
        const bodyEl = document.querySelector('body');
        const initAudio = async () => {
            if (sound && typeof sound.initSounds === 'function' && !sound.soundsCurrentlyInitialized) { // Check local flag if sound module has one
                await sound.initSounds();
            }
            bodyEl.removeEventListener('click', initAudio);
            bodyEl.removeEventListener('touchend', initAudio);
        };
        bodyEl.addEventListener('click', initAudio);
        bodyEl.addEventListener('touchend', initAudio);

        console.log("App event listeners initialized.");
    }

    // --- Initialize Application ---
    function initializeApp() {
        ui.initializeUiDOMReferences(); // Initialize UI DOM elements
        initializeAppEventListeners();
        if (typeof DICTIONARY_DATA !== 'undefined' && DICTIONARY_DATA.length > 0) {
            ui.populatePlayerIcons(networkPlayerIconSelect); ui.updateDifficultyButtonUI(); returnToMainMenuUI();
        } else { ui.showModal("Error Crítico: Diccionario no cargado."); }
        processUrlJoin();
    }
    async function processUrlJoin() { /* ... same as your last full main.js ... */ 
        const urlParams = new URLSearchParams(window.location.search);
        const roomIdFromUrl = urlParams.get('room');
        if (roomIdFromUrl && roomIdFromUrl.trim()) {
            window.history.replaceState({}, document.title, PIZARRA_BASE_URL); 
            const modalPlayerNameId = 'modal-player-name-urljoin'; const modalPlayerIconId = 'modal-player-icon-urljoin';
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
                    const nameInputInModal = document.getElementById(modalPlayerNameId); const iconSelectInModal = document.getElementById(modalPlayerIconId);
                    const joinerPlayerData = getPlayerCustomizationDataFromUI(true, nameInputInModal, iconSelectInModal);
                    state.setPvpRemoteActive(true);
                    try { await peerConnection.joinRoomById(roomIdFromUrl.trim(), joinerPlayerData); } 
                    catch (error) { ui.hideModal(); ui.showModal(`Error al unirse: ${error.message || 'Desconocido'}`); stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup'); }
                }},
                { text: "❌ Cancelar", action: () => { ui.hideModal(); ui.showScreen('networkSetup'); }, className: 'action-button-secondary'}
            ], true);
            const iconSelectInModal = document.getElementById(modalPlayerIconId);
            if (iconSelectInModal) { ui.populatePlayerIcons(iconSelectInModal); if(networkPlayerIconSelect) iconSelectInModal.value = networkPlayerIconSelect.value; }
        }
    }
    initializeApp();
});