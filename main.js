// main.js
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
    const cancelMatchmakingButtonEl = document.getElementById('cancel-matchmaking-button'); // Keep this reference

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
        sound.playUiClick();
        exitPlayMode();
        if (state.getMyPeerId() && matchmaking?.leaveQueue) {
            matchmaking.leaveQueue(state.getMyPeerId());
        }
        stopAnyActiveGameOrNetworkSession(true); // Preserve UI to stay on network setup
        ui.showScreen('networkSetup');
        ui.displayMessage("Búsqueda de partida cancelada. 🚫", "info");
        ui.hideModal(); // Ensure modal is hidden
        if (cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none'; // Hide separate button if it was shown
    }


    function refreshAlphabetKeyboard() {
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
        ui.stopConfetti();
        const selectedDifficulty = state.getCurrentDifficulty();
        console.log(`[Main] Starting local game with difficulty: ${selectedDifficulty}`);

        stopAnyActiveGameOrNetworkSession(true); 

        state.setPvpRemoteActive(false);
        state.setPlayersData([{ 
            id: 0, 
            name: "Jugador", 
            icon: "✏️", 
            color: state.DEFAULT_PLAYER_COLORS[0], 
            score: 0 
        }]);
        state.setCurrentPlayerId(0);

        const initState = logic.initializeGame(state, selectedDifficulty);
        if (!initState.success) {
            ui.showModal(initState.message || "No se pudo iniciar el juego local.");
            exitPlayMode();
            return;
        }

        console.log(`[Main] Local game initialized. Word: ${initState.currentWordObject?.word}`);
        ui.renderFullGameBoard(true, handleLetterClickUI);
        
        if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'none';
        if(document.getElementById('app')) document.getElementById('app').style.display = 'flex';
        
        enterPlayMode();
        ui.displayMessage("¡Adivina la palabra secreta! ✨", 'info', false);
    }

    function handleLetterClickUI(letter, buttonElement) {
        if (!state.getGameActive() || (buttonElement && buttonElement.disabled)) {
            console.log("[Main] Letter click ignored: game not active or button disabled.");
            return;
        }
        sound.triggerVibration(25);

        if (state.getPvpRemoteActive()) {
            if (state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) {
                if (buttonElement) buttonElement.disabled = true;
                peerConnection.sendGuessToHost(letter);
            } else {
                ui.displayMessage("No es tu turno. ¡Espera un poquito! ⏳", 'error');
            }
            return;
        }

        const result = logic.processGuess(letter);
        ui.renderFullGameBoard(true, handleLetterClickUI);

        if (result.error) {
            ui.displayMessage(result.error, 'error');
        } else if (result.alreadyGuessed) {
             ui.displayMessage(`Ya intentaste la letra '${result.letter.toUpperCase()}'. ¡Prueba otra! 🤔`, 'info');
        } else if (result.correct) {
            sound.playLetterSelectSound(true);
            ui.displayMessage(`¡Genial! '${result.letter.toUpperCase()}' está en la palabra. 👍`, 'success');
            if (result.wordSolved) {
                endGameUI(true); 
                return;
            }
        } else {
            sound.playLetterSelectSound(false);
            ui.displayMessage(`'${result.letter.toUpperCase()}' no está. ¡Pierdes una ${state.STAR_SYMBOL}! 😢`, 'error');
            if (result.gameOver) {
                endGameUI(false);
                return;
            }
        }
    }

    function handleClueRequestUI() {
        if (!state.getGameActive() || state.getClueUsedThisGame()) {
            if (state.getClueUsedThisGame()) ui.displayMessage("Ya usaste la pista para esta palabra. 🤫", "error");
            return;
        }
        const isMyTurnForClue = state.getPvpRemoteActive() ?
                               (state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) :
                               true;
        if (!isMyTurnForClue) {
            ui.displayMessage("No es tu turno para pedir una pista. 🚫", "error");
            return;
        }

        sound.triggerVibration(40);
        if (state.getPvpRemoteActive()) {
            peerConnection.sendClueRequestToHost();
            if(clueButtonEl) clueButtonEl.disabled = true;
        } else {
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
        state.setGameActive(false);
        refreshAlphabetKeyboard();
        ui.toggleClueButtonUI(false, false);

        if (playAgainButtonEl) playAgainButtonEl.style.display = 'inline-block';
        if (mainMenuButtonEl) mainMenuButtonEl.style.display = 'inline-block';

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
    }

    function returnToMainMenuUI() {
        ui.stopConfetti();
        stopAnyActiveGameOrNetworkSession(); 
    }

    function stopAnyActiveGameOrNetworkSession(preserveUIScreen = false) {
        console.log("[Main] stopAnyActiveGameOrNetworkSession. Preserve UI:", preserveUIScreen);
        exitPlayMode();
        const wasPvpActive = state.getPvpRemoteActive();
        const currentNetworkRoomState = state.getRawNetworkRoomData().roomState;

        if (state.getGameActive()) state.setGameActive(false);

        if (wasPvpActive) {
            peerConnection.leaveRoom();
            peerConnection.closePeerSession();
            if (currentNetworkRoomState === 'seeking_match' && state.getMyPeerId()) {
                 if (matchmaking && typeof matchmaking.leaveQueue === 'function') {
                    matchmaking.leaveQueue(state.getMyPeerId());
                }
            }
        }

        state.resetFullLocalStateForNewUIScreen();

        if (!preserveUIScreen) {
            if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'block';
            if(document.getElementById('app')) document.getElementById('app').style.display = 'none';
            ui.updateGameModeTabs('local');
        }
        ui.updateDifficultyButtonUI();

        if (clueDisplayAreaEl) clueDisplayAreaEl.style.display = 'none';
        if (messageAreaEl) ui.displayMessage('\u00A0', 'info', true);
        
        // Ensure cancel matchmaking button is hidden when stopping session generally
        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';

        if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none';
        ui.stopConfetti();

        ui.updateScoreDisplayUI();
        ui.updateCurrentPlayerTurnUI();
        ui.updateWordDisplay();
        ui.updateGuessedLettersDisplay();
        refreshAlphabetKeyboard();
        ui.toggleClueButtonUI(false, false);
        if(playAgainButtonEl) playAgainButtonEl.style.display = 'none';
        if(mainMenuButtonEl) mainMenuButtonEl.style.display = 'none';
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
        return { name, icon };
    }

    async function hostGameUI() {
        stopAnyActiveGameOrNetworkSession(true);
        ui.showModal("Creando tu sala de Palabras... 🏰✨");
        sound.triggerVibration(50);

        const hostCustomization = state.getLocalPlayerCustomizationForNetwork();
        const gameSettings = {
            difficulty: state.getCurrentDifficulty(),
            maxPlayers: parseInt(networkMaxPlayersSelect.value) || state.MAX_PLAYERS_NETWORK
        };

        try {
            const hostPeerId = await peerConnection.hostNewRoom(hostCustomization, gameSettings);
            if (matchmaking?.updateHostedRoomStatus && hostPeerId) {
                 matchmaking.updateHostedRoomStatus(hostPeerId, gameSettings, gameSettings.maxPlayers, 1, 'hosting_waiting_for_players');
            }
             // Do not hide modal here, showLobby callback will handle it or network error
        } catch (error) {
            console.error("[Main] Error hosting game:", error);
            ui.hideModal();
            ui.showModal(`Error al crear la sala: ${error.message || 'Desconocido'}. Intenta de nuevo.`, [{text:"OK", action: ui.hideModal}]);
            stopAnyActiveGameOrNetworkSession(true);
            ui.showScreen('networkSetup');
        }
    }

    async function joinRandomGameUI() {
        stopAnyActiveGameOrNetworkSession(true); // Reset state before starting a new attempt
        sound.triggerVibration(50);
        state.setPvpRemoteActive(true);

        // Show a modal with a cancel button immediately
        ui.showModal("Buscando una sala de Palabras... 🎲🕵️‍♀️", [
            { text: "❌ Cancelar Búsqueda", action: handleCancelMatchmaking, className: 'action-button-danger' }
        ]);

        const joinerCustomization = state.getLocalPlayerCustomizationForNetwork();
        const preferences = {
            maxPlayers: parseInt(networkMaxPlayersSelect.value) || state.MAX_PLAYERS_NETWORK,
            gameSettings: { difficulty: state.getCurrentDifficulty() }
        };

        try {
            const localRawPeerId = await peerConnection.ensurePeerInitialized();
            if (!localRawPeerId) {
                throw new Error("No se pudo obtener ID de PeerJS para matchmaking.");
            }

            if (matchmaking?.joinQueue) {
                matchmaking.joinQueue(localRawPeerId, joinerCustomization, preferences, {
                    onSearching: () => {
                        // Modal is already shown. We can update its text if desired, or do nothing here.
                        console.log("[Main] Matchmaking: onSearching - Modal should be visible.");
                        // No longer showing #network-info-area here, rely on modal.
                        // Ensure other UI elements are hidden if necessary
                        if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'block'; // Keep setup visible in background
                        if(document.getElementById('app')) document.getElementById('app').style.display = 'none';
                        ui.showScreen('networkSetup'); // Or 'networkInfo' if you want a specific background screen for the modal
                        exitPlayMode();
                    },
                    onMatchFoundAndJoiningRoom: async (leaderRawPeerIdToJoin, roomDetails) => {
                        // Modal will be updated by showLobby or error message
                        ui.hideModal(); // Hide searching modal
                        ui.showModal(`¡Sala encontrada! (${state.PIZARRA_PEER_ID_PREFIX}${leaderRawPeerIdToJoin}). Uniendo... ⏳`);
                        // The cancel button from the "searching" modal is gone now.
                        try {
                            await peerConnection.joinRoomById(leaderRawPeerIdToJoin, joinerCustomization);
                            // ui.hideModal() will be called by showLobby if successful
                        } catch (joinError) {
                            ui.hideModal();
                            ui.showModal(`Error al unirse a la sala: ${joinError.message || 'Intenta de nuevo'}`);
                            stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup');
                        }
                    },
                    onMatchFoundAndHostingRoom: async (myNewRawPeerIdForHosting, initialHostData) => {
                         // Modal will be updated by showLobby or error message
                        ui.hideModal(); // Hide searching modal
                        ui.showModal("No hay salas disponibles, ¡creando una nueva para ti! 🚀");
                        try {
                            await peerConnection.hostNewRoom(joinerCustomization, initialHostData.gameSettings);
                            // ui.hideModal() will be called by showLobby if successful
                            if (matchmaking?.updateHostedRoomStatus && myNewRawPeerIdForHosting) { // Should be hostPeerId from hostNewRoom
                                matchmaking.updateHostedRoomStatus(myNewRawPeerIdForHosting, initialHostData.gameSettings, initialHostData.gameSettings.maxPlayers || preferences.maxPlayers, 1, 'hosting_waiting_for_players');
                            }
                        } catch (hostError) {
                            ui.hideModal(); ui.showModal(`Error al crear nueva sala: ${hostError.message}`);
                            stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup');
                        }
                    },
                    onError: (errMsg) => {
                        ui.hideModal(); 
                        ui.showModal(`Error de Matchmaking: ${errMsg}`, [{text: "OK", action: () => {
                            handleCancelMatchmaking(); // Use the centralized cancel logic
                        }}]);
                        // stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup'); // Covered by handleCancelMatchmaking
                    }
                });
            } else {
                 throw new Error("Servicio de matchmaking no disponible.");
            }
        } catch (initError) {
            ui.hideModal(); 
            ui.showModal(`Error de Red: ${initError.message || 'No se pudo conectar.'}`, [{text: "OK", action: () => {
                handleCancelMatchmaking(); // Use the centralized cancel logic
            }}]);
            // stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup'); // Covered by handleCancelMatchmaking
        }
    }

    window.pizarraUiUpdateCallbacks = {
        showLobby: (isHost) => {
            ui.hideModal(); // Ensure any previous modal (like "searching" or "connecting") is hidden
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
        updateLobby: ui.updateLobbyUI,
        showNetworkError: (message, shouldReturnToSetupIfCritical = false) => {
            ui.showModal(`Error de Red: ${message}`, [{ text: "OK", action: () => {
                ui.hideModal();
                if (shouldReturnToSetupIfCritical) {
                    // Use the centralized cancel/reset logic if appropriate
                    handleCancelMatchmaking(); // This resets to networkSetup
                }
            }}]);
            sound.playErrorSound();
            exitPlayMode();
        },
        startGameOnNetwork: (initialGameState) => {
            console.log('[Main] startGameOnNetwork called with initialGameState:', initialGameState);
            ui.hideModal();
            if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none';
            ui.stopConfetti();
            
            if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'none';
            if(document.getElementById('app')) document.getElementById('app').style.display = 'flex';

            ui.renderFullGameBoard(state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId(), handleLetterClickUI);
            
            enterPlayMode();
            ui.displayMessage("¡El juego en red ha comenzado! 🎮🌍", 'info', false);
            sound.playGameStart();
        },
        updateGameFromNetwork: (guessResultPayload) => {
            console.log('[Main] updateGameFromNetwork (GUESS_RESULT) received:', guessResultPayload);
            const { letter, correct, error, affectedPlayerId } = guessResultPayload;
            const playerMakingGuess = state.getPlayersData().find(p => p.id === affectedPlayerId);
            const guesserName = playerMakingGuess ? `${playerMakingGuess.icon}${playerMakingGuess.name}` : 'Alguien';

            if (error) {
                 ui.displayMessage(error, 'error');
            } else if (letter) {
                const messageText = correct ?
                    `'${letter.toUpperCase()}' es CORRECTA. ¡Bien hecho ${guesserName}! 🎉` :
                    `'${letter.toUpperCase()}' es INCORRECTA. (${guesserName}) Oops! 😥`;
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
            console.log('[Main] syncUIFromNetworkState: Forcing UI sync from full network state.');
            const currentPhase = state.getGamePhase();
            if (currentPhase === 'lobby') {
                // If moving to lobby, ensure modal is hidden (e.g. "connecting" modal)
                ui.hideModal();
                if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'block';
                if(document.getElementById('app')) document.getElementById('app').style.display = 'none';
                ui.showScreen('lobby');
                ui.updateLobbyUI();
                exitPlayMode();
            } else if (currentPhase === 'playing' || currentPhase === 'game_over' || currentPhase === 'ended') {
                 // If moving to game, ensure modal is hidden
                ui.hideModal();
                if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'none';
                if(document.getElementById('app')) document.getElementById('app').style.display = 'flex';
                
                const isMyTurn = state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId();
                ui.renderFullGameBoard(isMyTurn, handleLetterClickUI);
                if (!state.getGameActive()) {
                    ui.toggleClueButtonUI(false, false);
                }
                if(currentPhase === 'playing') enterPlayMode(); else exitPlayMode();
            }
        },
        displayClueFromNetwork: (clueData) => {
            sound.playClueReveal();
            ui.displayClueOnUI(clueData.clue);
            ui.displayMessage("¡Pista mágica para todos! 🤫✨", 'info');
            ui.toggleClueButtonUI(false, true);
        },
        showNetworkGameOver: (gameOverData) => {
            state.setGameActive(false);
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
                const currentPlayers = state.getPlayersData();
                const networkPlayers = state.getRawNetworkRoomData().players;
                gameOverData.finalScores.forEach(ps => {
                    const pLocal = currentPlayers.find(p => p.id === ps.id); if (pLocal) pLocal.score = ps.score;
                    const pNet = networkPlayers.find(p => p.id === ps.id); if (pNet) pNet.score = ps.score;
                });
                state.setPlayersData([...currentPlayers]);
                state.setNetworkRoomData({players: [...networkPlayers]});
                ui.updateScoreDisplayUI();
            }
            if (gameOverData.finalWord && !logic.checkWinCondition()) {
                const finalGuessed = new Set();
                for (const letter of gameOverData.finalWord) { finalGuessed.add(letter.toLowerCase()); }
                state.setGuessedLetters(finalGuessed);
                ui.updateWordDisplay();
            }

            ui.showModal(message, [{text: "🏠 Volver al Menú", action: () => { ui.stopConfetti(); returnToMainMenuUI();}, className: 'action-button'}]);
            if (isWinForLocalPlayer) { sound.playWordSolvedSound(); sound.triggerVibration([100, 40, 100, 40, 200]); ui.startConfetti(200); }
            else { sound.playGameOverSound(); sound.triggerVibration([70,50,70]); }
        },
        handleCriticalDisconnect: () => {
            exitPlayMode();
            // Use the centralized cancel/reset logic
            handleCancelMatchmaking(); // This resets to networkSetup and hides modal
            // show a specific modal after the reset if needed
            ui.showModal("Desconectado de la partida. Volviendo al menú principal.", [{text: "OK", action: ui.hideModal}]);
        },
        showLobbyMessage: (messageText, isError = false) => {
            const lobbyMessageArea = document.getElementById('lobby-message-area');
            if(lobbyMessageArea) ui.displayMessage(messageText, isError ? 'error' : 'info', false, lobbyMessageArea);
        },
        hideModal: ui.hideModal,
        showModal: ui.showModal,
        hideNetworkInfo: () => {if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none';}
    };

    function initializeAppEventListeners() {
        gameModeTabs.forEach(tab => tab.addEventListener('click', () => {
            sound.playUiClick();
            exitPlayMode();
            const newMode = tab.dataset.mode;
            const isCurrentlyPvp = state.getPvpRemoteActive();
            if ((newMode === 'local' && isCurrentlyPvp) || (newMode === 'network' && !isCurrentlyPvp)) {
                 stopAnyActiveGameOrNetworkSession(true);
            }
            ui.updateGameModeTabs(newMode);
            if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'block';
            if(document.getElementById('app')) document.getElementById('app').style.display = 'none';
            ui.showScreen(newMode === 'local' ? 'localSetup' : 'networkSetup');
            state.setPvpRemoteActive(newMode === 'network');
        }));

        difficultyButtons.forEach(button => {
            button.addEventListener('click', (event) => {
                sound.playUiClick();
                state.setCurrentDifficulty(event.target.dataset.difficulty);
                ui.updateDifficultyButtonUI();
                if (state.getPvpRemoteActive() && state.getRawNetworkRoomData().isRoomLeader) {
                    state.setNetworkRoomData({ gameSettings: { ...state.getRawNetworkRoomData().gameSettings, difficulty: state.getCurrentDifficulty() } });
                }
            });
        });

        if(startLocalGameButton) startLocalGameButton.addEventListener('click', () => { sound.playUiClick(); startLocalGameUI(); });
        if(clueButtonEl) clueButtonEl.addEventListener('click', () => { sound.playUiClick(); handleClueRequestUI(); });
        if(playAgainButtonEl) playAgainButtonEl.addEventListener('click', () => {
            sound.playUiClick(); ui.stopConfetti();
            if (state.getPvpRemoteActive()) {
                exitPlayMode();
                 ui.showModal("Para jugar otra vez en red, el líder de la sala debe iniciar una nueva partida. Puedes volver al menú.", 
                    [{text: "🏠 Volver al Menú", action: returnToMainMenuUI}, {text: "OK", action: ui.hideModal}]);
            } else {
                startLocalGameUI();
            }
        });
        if(mainMenuButtonEl) mainMenuButtonEl.addEventListener('click', () => { sound.playUiClick(); ui.stopConfetti(); returnToMainMenuUI(); });
        if(hostGameButton) hostGameButton.addEventListener('click', () => { sound.playUiClick(); hostGameUI(); });
        if(joinRandomButton) joinRandomButton.addEventListener('click', () => { sound.playUiClick(); joinRandomGameUI(); });

        if(copyRoomLinkButtonEl) copyRoomLinkButtonEl.addEventListener('click', () => {
            sound.playUiClick();
            const roomId = state.getRawNetworkRoomData().roomId;
            if (!roomId) {
                ui.displayMessage("ID de sala no disponible aún. 😔", "error", false, document.getElementById('lobby-message-area') || messageAreaEl);
                return;
            }
            const roomLink = `${PIZARRA_BASE_URL}?room=${roomId}`;
            navigator.clipboard.writeText(roomLink).then(() => {
                ui.displayMessage("¡Enlace copiado al portapapeles! ✨", "success", false, document.getElementById('lobby-message-area') || messageAreaEl);
            }).catch(err => {
                console.error('Error al copiar enlace: ', err);
                ui.displayMessage("No se pudo copiar el enlace. 😔", "error", false, document.getElementById('lobby-message-area') || messageAreaEl);
            });
        });

        // The cancelMatchmakingButtonEl is now primarily controlled by the modal logic in joinRandomGameUI
        // This listener is a fallback or if it's shown elsewhere.
        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.addEventListener('click', handleCancelMatchmaking);

        if(lobbyToggleReadyButtonEl) lobbyToggleReadyButtonEl.addEventListener('click', () => {
            sound.playUiClick(); sound.triggerVibration(25);
            const myPlayer = state.getRawNetworkRoomData().players.find(p => p.peerId === state.getMyPeerId());
            if(myPlayer) peerConnection.sendPlayerReadyState(!myPlayer.isReady);
        });
        if(lobbyStartGameLeaderButtonEl) lobbyStartGameLeaderButtonEl.addEventListener('click', () => {
            sound.playUiClick(); sound.triggerVibration(50);
            peerConnection.leaderStartGameRequest();
        });
        if(lobbyLeaveRoomButtonEl) lobbyLeaveRoomButtonEl.addEventListener('click', () => {
            sound.playUiClick(); sound.triggerVibration(30);
             ui.showModal("¿Seguro que quieres salir de la sala? 🚪🥺", [
                 {text: "Sí, Salir", action: returnToMainMenuUI, className: 'action-button-danger'},
                 {text: "No, Quedarme", action: ui.hideModal, className: 'action-button-secondary'}
                ]);
        });
        if(modalCloseButtonEl) modalCloseButtonEl.addEventListener('click', () => {sound.playUiClick(); ui.hideModal();});
        if(customModalEl) customModalEl.addEventListener('click', (e) => {
            // Only close if clicking outside the modal-content AND no dynamic buttons are present
            // (as dynamic buttons imply a choice needs to be made).
            // Or, if dynamic buttons ARE present, this click-outside-to-close should be disabled.
            // For now, let's stick to: if modal has dynamic buttons, only buttons close it.
            // If it only has the 'X' (modalCloseButtonEl), then clicking outside is fine.
            if (e.target === customModalEl) {
                const hasDynamicButtons = modalDynamicButtonsEl && modalDynamicButtonsEl.children.length > 0;
                if (!hasDynamicButtons) { // Only allow click-outside-to-close if no dynamic buttons
                    sound.playUiClick(); 
                    ui.hideModal();
                }
            }
        });

        const bodyEl = document.querySelector('body');
        const initAudioOnUserGesture = async () => {
            try {
                if (typeof Tone !== 'undefined' && Tone.start && Tone.context && Tone.context.state !== 'running') {
                    await Tone.start();
                    console.log("[Main] Tone.js AudioContext started on user gesture.");
                }
                if (sound?.initSounds && !sound.soundsCurrentlyInitialized) {
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
        initializeAppEventListeners(); 
        
        if (typeof DICTIONARY_DATA !== 'undefined' && DICTIONARY_DATA.length > 0) {
            if(networkPlayerIconSelect) ui.populatePlayerIcons(networkPlayerIconSelect);
            state.setCurrentDifficulty('easy');
            ui.updateDifficultyButtonUI();
            returnToMainMenuUI(); 
        } else {
            ui.showModal("Error Crítico: El diccionario de palabras no está cargado. El juego no puede iniciar. 💔");
            exitPlayMode();
        }
        processUrlJoin(); 
    }

    async function processUrlJoin() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomIdFromUrl = urlParams.get('room');
        if (roomIdFromUrl && roomIdFromUrl.trim()) {
            window.history.replaceState({}, document.title, window.location.pathname);
            exitPlayMode();

            const modalPlayerNameId = 'modal-player-name-urljoin';
            const modalPlayerIconId = 'modal-player-icon-urljoin';
            const joinPromptHtml = `
                <p>¡Te invitaron a una sala de Palabras (${state.PIZARRA_PEER_ID_PREFIX}${roomIdFromUrl})! 🎉</p>
                <p>Elige tu nombre e ícono:</p>
                <div class="modal-form-inputs">
                    <label for="${modalPlayerNameId}">Tu Nombre:</label>
                    <input type="text" id="${modalPlayerNameId}" value="${networkPlayerNameInput?.value || `Pizarrín${Math.floor(Math.random()*1000)}`}" maxlength="15">
                    <label for="${modalPlayerIconId}">Tu Ícono:</label>
                    <select id="${modalPlayerIconId}"></select>
                </div>`;
            const buttonsConfig = [
                { text: "✅ Unirme a la Sala", className: 'action-button-confirm', action: async () => {
                    ui.hideModal();
                    ui.showModal(`Conectando a ${state.PIZARRA_PEER_ID_PREFIX}${roomIdFromUrl}... Por favor espera. ⏳`);
                    const nameInputInModal = document.getElementById(modalPlayerNameId);
                    const iconSelectInModal = document.getElementById(modalPlayerIconId);
                    
                    if(nameInputInModal && networkPlayerNameInput) networkPlayerNameInput.value = nameInputInModal.value;
                    if(iconSelectInModal && networkPlayerIconSelect) networkPlayerIconSelect.value = iconSelectInModal.value;

                    const joinerCustomization = state.getLocalPlayerCustomizationForNetwork();
                    state.setPvpRemoteActive(true);
                    ui.updateGameModeTabs('network');
                    if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'block';
                    if(document.getElementById('app')) document.getElementById('app').style.display = 'none';
                    ui.showScreen('networkSetup'); // Show the setup screen briefly before lobby/error

                    try {
                        await peerConnection.joinRoomById(roomIdFromUrl.trim(), joinerCustomization);
                         // Success will lead to showLobby callback hiding the modal
                    } catch (error) {
                        ui.hideModal(); // Hide "Connecting..." modal
                        ui.showModal(`Error al unirse a la sala: ${error.message || 'Intenta de nuevo o verifica el ID.'}`);
                        stopAnyActiveGameOrNetworkSession(true); // Reset state
                        ui.showScreen('networkSetup'); // Back to setup
                    }
                }},
                { text: "❌ Cancelar", action: () => { ui.hideModal(); ui.showScreen('localSetup'); ui.updateGameModeTabs('local'); exitPlayMode(); }, className: 'action-button-secondary'}
            ];
            ui.showModal(joinPromptHtml, buttonsConfig, true);

            const iconSelectInModal = document.getElementById(modalPlayerIconId);
            if (iconSelectInModal) {
                ui.populatePlayerIcons(iconSelectInModal);
                if(networkPlayerIconSelect) iconSelectInModal.value = networkPlayerIconSelect.value || state.AVAILABLE_ICONS[0];
            }
        }
    }
    initializeApp();
});