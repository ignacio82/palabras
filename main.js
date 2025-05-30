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
    const networkInfoTitleEl = document.getElementById('network-info-title');
    const networkInfoTextEl = document.getElementById('network-info-text');
    const qrCodeContainerEl = document.getElementById('qr-code-container');

    function updateAlphabetEnablement() {
        if (!state.getGameActive()) {
            ui.updateAllAlphabetButtons(true); 
            return;
        }
        const myTurn = state.getPvpRemoteActive() ?
                       (state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) : 
                       true; 
        ui.createAlphabetKeyboard(myTurn, handleLetterClickUI); 
    }

    function updateStarsDisplay() { 
        ui.updateStarsDisplay(); 
    }

    function startLocalGameUI() {
        ui.stopConfetti();
        
        const selectedDifficulty = state.getCurrentDifficulty();
        console.log(`[Main] Starting local game with difficulty: ${selectedDifficulty}`);
        
        stopAnyActiveGameOrNetworkSession(true); 
        
        state.setCurrentDifficulty(selectedDifficulty); 
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
        
        ui.renderFullGameBoard(true, handleLetterClickUI); 
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
            // Ensure it's this player's turn before sending to host
            if (state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) {
                if (buttonElement) buttonElement.disabled = true; 
                peerConnection.sendGuessToHost(letter); // Use new function
            } else {
                ui.displayMessage("No es tu turno.", 'error');
            }
            return;
        }

        console.log("[Main] Processing local game guess for letter:", letter);
        
        const result = logic.processGuess(letter); 
        
        console.log("[Main] Guess result:", result);

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
            (state.getPvpRemoteActive() && state.getRawNetworkRoomData().myPlayerIdInRoom !== state.getCurrentPlayerId())) { 
            if (state.getPvpRemoteActive() && state.getRawNetworkRoomData().myPlayerIdInRoom !== state.getCurrentPlayerId()) { 
                ui.displayMessage("No es tu turno para pedir pista.", "error");
            } else if (state.getClueUsedThisGame()){
                ui.displayMessage("Ya usaste la pista para esta palabra.", "error");
            }
            return;
        }
        sound.triggerVibration(40);
        if (state.getPvpRemoteActive()) {
            // Ensure it's this player's turn before sending to host
             if (state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) {
                peerConnection.sendClueRequestToHost(); // Use new function
                if(clueButtonEl) clueButtonEl.disabled = true; 
            } else {
                 ui.displayMessage("No es tu turno para pedir pista.", "error");
            }
            return;
        }
        const clueResult = logic.requestClue(state); 
        if (clueResult.success) {
            ui.displayClueOnUI(clueResult.clue); 
            ui.displayMessage("¡Pista revelada!", 'info');
            if(clueButtonEl) clueButtonEl.disabled = true;
        } else {
            ui.displayMessage(clueResult.message || "No se pudo obtener la pista.", 'error');
        }
    }

    function endGameUI(isWin) { 
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
                for (const letter of state.getCurrentWord()) { finalGuessed.add(letter.toLowerCase()); } 
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
        stopAnyActiveGameOrNetworkSession(); 
    }

    function stopAnyActiveGameOrNetworkSession(preserveUIScreen = false) {
        console.log("[Main] stopAnyActiveGameOrNetworkSession. Preserve UI:", preserveUIScreen);
        
        const currentNetworkData = state.getRawNetworkRoomData(); 
        const rs = currentNetworkData.roomState;
        if (rs === 'creating_room' || rs === 'lobby' || rs === 'awaiting_join_approval' || rs === 'seeking_match') {
            console.log(`[Main] stopAnyActiveGameOrNetworkSession: Aborting due to roomState '${rs}'. Host peer preserved.`);
            // return; // Commented out as per original, let it continue to reset state.
        }

        const wasPvpActive = state.getPvpRemoteActive();
        if (state.getGameActive()) state.setGameActive(false);
        
        if (wasPvpActive) {
            peerConnection.closeAllConnectionsAndSession();
            if (currentNetworkData.roomState === 'seeking_match' && state.getMyPeerId()) { 
                 if (matchmaking && typeof matchmaking.leaveQueue === 'function') { 
                    matchmaking.leaveQueue(state.getMyPeerId());
                }
            }
        }
        
        state.resetFullLocalStateForNewUIScreen(); 
        
        if (!preserveUIScreen) {
            ui.showScreen('localSetup');
            ui.updateDifficultyButtonUI(); 
            if (gameModeTabs.length > 0) ui.updateGameModeTabs('local'); 
        }
        
        if (clueDisplayAreaEl) clueDisplayAreaEl.style.display = 'none';
        if (messageAreaEl) ui.displayMessage('\u00A0', 'info', true); 
        if (cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
        ui.hideNetworkInfoArea();
        ui.stopConfetti();
        ui.updateScoreDisplayUI(); 
        ui.updateCurrentPlayerTurnUI(); 
        updateAlphabetEnablement(); 
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
                matchmaking.updateHostedRoomStatus(hostPeerId, state.getRawNetworkRoomData().gameSettings, state.getRawNetworkRoomData().maxPlayers, state.getRawNetworkRoomData().players.length, 'hosting_waiting_for_players'); 
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

    window.pizarraUiUpdateCallbacks = {
        showLobby: (isHost) => {
            ui.hideModal(); ui.showScreen('lobby'); ui.updateLobbyUI();
            if (isHost) ui.displayRoomQRCodeAndLink(state.getRawNetworkRoomData().roomId, state.getRawNetworkRoomData().maxPlayers, PIZARRA_BASE_URL, state.PIZARRA_PEER_ID_PREFIX); 
            else ui.hideNetworkInfoArea();
        },
        updateLobby: ui.updateLobbyUI,
        showNetworkError: (message, shouldReturnToSetup = false) => {
            ui.showModal(message); if (shouldReturnToSetup) stopAnyActiveGameOrNetworkSession(); 
        },
        startGameOnNetwork: (initialGameState) => { 
            console.log('[Main] startGameOnNetwork received initialGameState:', initialGameState);
            ui.hideModal(); ui.hideNetworkInfoArea(); ui.stopConfetti();
            
            state.setPlayersData(initialGameState.playersInGameOrder); 
            state.setRemainingAttemptsPerPlayer(initialGameState.remainingAttemptsPerPlayer); 
            state.setCurrentWordObject(initialGameState.currentWordObject); 
            state.setGuessedLetters(new Set(initialGameState.guessedLetters || [])); 
            state.setCurrentPlayerId(initialGameState.startingPlayerId);
            state.setClueUsedThisGame(initialGameState.clueUsed || false);
            state.setCurrentDifficulty(initialGameState.gameSettings.difficulty); 
            state.setGameActive(true);
            state.setGamePhase('playing'); 

            const isMyTurn = state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId(); 
            ui.renderFullGameBoard(isMyTurn, handleLetterClickUI); 

            ui.showScreen('game');
            ui.displayMessage("¡El juego en red ha comenzado!", 'info', true);
            
            if (sound && typeof sound.playGameStart === 'function') { 
                sound.playGameStart();
            }
        },
        updateGameFromNetwork: (guessResultPayload) => { 
            console.log('[Main] updateGameFromNetwork received payload:', guessResultPayload);
            
            ui.updateStarsDisplay(); 
            updateAlphabetEnablement(); 
            
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

            if (gameOver) { 
                state.setGameActive(false); 
                updateAlphabetEnablement(); 
                ui.toggleClueButtonUI(false); 
            }
        },
        syncGameUIFromNetworkState: () => {
            console.log('[Main] Forcing UI sync from full network state.');
            
            const currentPhase = state.getGamePhase();
            if (currentPhase === 'lobby') {
                ui.updateLobbyUI();
            } else if (currentPhase === 'playing' || currentPhase === 'ended' || currentPhase === 'game_over') {
                const isMyTurn = state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId(); 
                ui.renderFullGameBoard(isMyTurn, handleLetterClickUI);

                if (!state.getGameActive()) {
                    ui.updateAllAlphabetButtons(true); 
                    ui.toggleClueButtonUI(false, false); 
                }
            }
        },
        displayClueFromNetwork: (clueData) => {
            ui.displayClueOnUI(clueData.clue); 
            ui.updateStarsDisplay(); 
            ui.displayMessage("Pista revelada para todos.", 'info');
            ui.toggleClueButtonUI(false, true); 
        },
        showNetworkGameOver: (gameOverData) => {
            state.setGameActive(false); ui.updateAllAlphabetButtons(true); ui.toggleClueButtonUI(false, false); 
            let message = gameOverData.reason ? `Juego terminado: ${gameOverData.reason}.` : "¡Juego Terminado!";
            let isWinForLocalPlayer = false;
            
            if (gameOverData.winnerData?.winners?.length > 0) { 
                 const winnerNames = gameOverData.winnerData.winners.map(w => `${w.icon || ''}${w.name}`).join(' y ');
                 isWinForLocalPlayer = gameOverData.winnerData.winners.some(w => w.id === state.getRawNetworkRoomData().myPlayerIdInRoom); 
                 if(gameOverData.winnerData.isTie) { 
                     message += ` ¡Empate entre ${winnerNames}!`; 
                     isWinForLocalPlayer = gameOverData.winnerData.winners.some(w => w.id === state.getRawNetworkRoomData().myPlayerIdInRoom); 
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
            const myPlayer = state.getRawNetworkRoomData().players.find(p => p.peerId === state.getMyPeerId()); 
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
        };
        bodyEl.addEventListener('click', initAudio, { once: true }); 
        bodyEl.addEventListener('touchend', initAudio, { once: true });

        console.log("App event listeners initialized.");
    }

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