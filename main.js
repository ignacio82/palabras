// main.js
import * as state from './pizarraState.js';
import * as logic from './gameLogic.js';
import * as peerConnection from './pizarraPeerConnection.js';
import * as matchmaking from './pizarraMatchmaking.js';
import * as ui from './pizarraUi.js';
import * as sound from './pizarraSound.js';

const PIZARRA_BASE_URL = "https://palabras.martinez.fyi"; // Palabras specific

document.addEventListener('DOMContentLoaded', () => {
    console.log("Pizarra de Palabras: DOMContentLoaded, initializing main.js with network features.");

    ui.initializeUiDOMReferences();

    // --- DOM Element References (Mainly for event listeners in main.js) ---
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

    // Elements used by UI callbacks or main logic
    const clueDisplayAreaEl = document.getElementById('clue-display-area'); // Used in returnToMainMenuUI
    const messageAreaEl = document.getElementById('message-area'); // Used in returnToMainMenuUI
    const networkInfoAreaEl = document.getElementById('network-info-area'); // For hideNetworkInfoArea
    const networkInfoTitleEl = document.getElementById('network-info-title');
    const networkInfoTextEl = document.getElementById('network-info-text');
    const qrCodeContainerEl = document.getElementById('qr-code-container');


    // --- UI Update Helper (calls pizarraUi.js, ensures correct context for click handler) ---
    function refreshAlphabetKeyboard() {
        if (!state.getGameActive()) {
            ui.createAlphabetKeyboard(false, handleLetterClickUI); // Disable all if game not active
            return;
        }
        const isMyTurn = state.getPvpRemoteActive() ?
                       (state.getNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) :
                       true;
        ui.createAlphabetKeyboard(isMyTurn, handleLetterClickUI);
    }

    // --- Game Flow Functions ---
    function startLocalGameUI() {
        ui.stopConfetti();
        const selectedDifficulty = state.getCurrentDifficulty(); // Difficulty is already in state
        console.log(`[Main] Starting local game with difficulty: ${selectedDifficulty}`);

        stopAnyActiveGameOrNetworkSession(true); // Preserve current screen (localSetup)

        state.setPvpRemoteActive(false); // Ensure local mode
        // Set up a single local player
        state.setPlayersData([{ id: 0, name: "Jugador", icon: "✏️", color: state.DEFAULT_PLAYER_COLORS[0], score: 0 }]);
        state.setCurrentPlayerId(0); // Local player is ID 0

        const initState = logic.initializeGame(state, selectedDifficulty); // logic.initializeGame uses state
        if (!initState.success) {
            ui.showModal(initState.message || "No se pudo iniciar el juego local.");
            return;
        }

        console.log(`[Main] Local game initialized. Word: ${initState.currentWordObject?.word}`);
        ui.renderFullGameBoard(true, handleLetterClickUI); // Local game, player's turn to interact
        ui.showScreen('game');
        ui.displayMessage("¡Adivina la palabra secreta! ✨", 'info', false); // Non-persistent
    }

    function handleLetterClickUI(letter, buttonElement) {
        if (!state.getGameActive() || (buttonElement && buttonElement.disabled)) {
            console.log("[Main] Letter click ignored: game not active or button disabled.");
            return;
        }
        sound.triggerVibration(25);

        if (state.getPvpRemoteActive()) {
            if (state.getNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) {
                if (buttonElement) buttonElement.disabled = true; // Optimistic disable
                peerConnection.sendGuessToHost(letter); // Network action
            } else {
                ui.displayMessage("No es tu turno. ¡Espera un poquito! ⏳", 'error');
            }
            return;
        }

        // Local game guess processing
        const result = logic.processGuess(letter); // Updates state internally

        ui.renderFullGameBoard(true, handleLetterClickUI); // Re-render based on new state

        if (result.error) {
            ui.displayMessage(result.error, 'error');
        } else if (result.alreadyGuessed) {
             ui.displayMessage(`Ya intentaste la letra '${result.letter.toUpperCase()}'. ¡Prueba otra! 🤔`, 'info');
        } else if (result.correct) {
            sound.playLetterSelectSound(true);
            ui.displayMessage(`¡Genial! '${result.letter.toUpperCase()}' está en la palabra. 👍`, 'success');
            if (result.wordSolved) {
                endGameUI(true); // Local win
                return;
            }
        } else { // Incorrect guess
            sound.playLetterSelectSound(false);
            ui.displayMessage(`'${result.letter.toUpperCase()}' no está. ¡Pierdes una ${state.STAR_SYMBOL}! 😢`, 'error');
            if (result.gameOver) { // Player ran out of attempts and didn't solve
                endGameUI(false); // Local loss
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
                               (state.getNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) :
                               true;
        if (!isMyTurnForClue) {
            ui.displayMessage("No es tu turno para pedir una pista. 🚫", "error");
            return;
        }

        sound.triggerVibration(40);
        if (state.getPvpRemoteActive()) {
            peerConnection.sendClueRequestToHost();
            if(clueButtonEl) clueButtonEl.disabled = true; // Optimistic disable for client
        } else {
            // Local game clue request
            const clueResult = logic.requestClue(); // Updates state (clueUsedThisGame)
            if (clueResult.success) {
                sound.playClueReveal();
                ui.displayClueOnUI(clueResult.clue);
                ui.displayMessage("¡Pista mágica revelada! 🔮", 'info');
                if(clueButtonEl) clueButtonEl.disabled = true; // Disable button after use
            } else {
                sound.playErrorSound();
                ui.displayMessage(clueResult.message || "No se pudo obtener la pista.", 'error');
            }
        }
    }

    function endGameUI(isWin) { // For local game over
        state.setGameActive(false); // Mark game as inactive
        refreshAlphabetKeyboard(); // Disables alphabet
        ui.toggleClueButtonUI(false, false); // Hide and disable clue button

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
                // Reveal the word by marking all its letters as guessed
                const finalGuessed = new Set();
                for (const letter of state.getCurrentWord()) { // getCurrentWord is normalized uppercase
                    finalGuessed.add(letter.toLowerCase()); // Guessed letters are stored lowercase
                }
                state.setGuessedLetters(finalGuessed);
                ui.updateWordDisplay(); // Show the full word
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
        stopAnyActiveGameOrNetworkSession(); // This will reset state and show localSetup
    }

    function stopAnyActiveGameOrNetworkSession(preserveUIScreen = false) {
        console.log("[Main] stopAnyActiveGameOrNetworkSession. Preserve UI:", preserveUIScreen);
        const wasPvpActive = state.getPvpRemoteActive();
        const currentNetworkRoomState = state.getNetworkRoomData().roomState;

        if (state.getGameActive()) state.setGameActive(false);

        if (wasPvpActive) {
            peerConnection.leaveRoom(); // Informs other peers or leader if applicable
            peerConnection.closePeerSession(); // Destroys local Peer object
            if (currentNetworkRoomState === 'seeking_match' && state.getMyPeerId()) {
                 if (matchmaking && typeof matchmaking.leaveQueue === 'function') {
                    matchmaking.leaveQueue(state.getMyPeerId());
                }
            }
        }

        state.resetFullLocalStateForNewUIScreen(); // Resets game and network state

        if (!preserveUIScreen) {
            ui.showScreen('localSetup'); // Default screen after full stop
            ui.updateGameModeTabs('local'); // Default to local tab
        }
        ui.updateDifficultyButtonUI(); // Reflect current difficulty

        if (clueDisplayAreaEl) clueDisplayAreaEl.style.display = 'none';
        if (messageAreaEl) ui.displayMessage('\u00A0', 'info', true); // Clear message area
        if (cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
        if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none'; // Hide network info
        ui.stopConfetti();

        // Clear game-specific UI elements
        ui.updateScoreDisplayUI(); // Clears scores
        ui.updateCurrentPlayerTurnUI(); // Clears turn display
        ui.updateWordDisplay(); // Clears word display
        ui.updateGuessedLettersDisplay(); // Clears guessed letters
        refreshAlphabetKeyboard(); // Disables alphabet
        ui.toggleClueButtonUI(false, false); // Hide and disable clue button
        if(playAgainButtonEl) playAgainButtonEl.style.display = 'none';
        if(mainMenuButtonEl) mainMenuButtonEl.style.display = 'none';
    }

    function getPlayerCustomizationDataFromUI(isModal = false, modalNameInput = null, modalIconSelect = null) {
        // This function remains similar, ensures player name/icon are fetched
        let name, icon;
        const randomSuffix = Math.floor(Math.random() * 1000);
        if (isModal) {
            name = modalNameInput?.value.trim() || `Pizarrín${randomSuffix}`;
            icon = modalIconSelect?.value || state.AVAILABLE_ICONS[0];
        } else {
            name = networkPlayerNameInput?.value.trim() || `Pizarrín${randomSuffix}`;
            icon = networkPlayerIconSelect?.value || state.AVAILABLE_ICONS[0];
        }
        // Color is assigned by state.getLocalPlayerCustomizationForNetwork() or by host
        return { name, icon }; // Return only name and icon, color handled by state/host
    }

    async function hostGameUI() {
        stopAnyActiveGameOrNetworkSession(true); // Preserve networkSetup screen
        ui.showModal("Creando tu sala de Palabras... 🏰✨");
        sound.triggerVibration(50);

        const hostCustomization = state.getLocalPlayerCustomizationForNetwork(); // Gets name, icon, color
        const gameSettings = {
            difficulty: state.getCurrentDifficulty(),
            maxPlayers: parseInt(networkMaxPlayersSelect.value) || state.MAX_PLAYERS_NETWORK
        };

        try {
            // hostNewRoom now takes full player object and game settings
            const hostPeerId = await peerConnection.hostNewRoom(hostCustomization, gameSettings);
            // UI transition to lobby is handled by _finalizeHostSetup -> showLobby callback
            // Matchmaking update is also often handled after hostNewRoom promise resolves successfully
            if (matchmaking?.updateHostedRoomStatus && hostPeerId) {
                 matchmaking.updateHostedRoomStatus(hostPeerId, gameSettings, gameSettings.maxPlayers, 1, 'hosting_waiting_for_players');
            }
        } catch (error) {
            console.error("[Main] Error hosting game:", error);
            ui.hideModal();
            ui.showModal(`Error al crear la sala: ${error.message || 'Desconocido'}. Intenta de nuevo.`, [{text:"OK", action: ui.hideModal}]);
            stopAnyActiveGameOrNetworkSession(true); // Clean up
            ui.showScreen('networkSetup'); // Return to setup
        }
    }

    async function joinRandomGameUI() {
        stopAnyActiveGameOrNetworkSession(true); // Preserve networkSetup screen
        ui.showModal("Buscando una sala de Palabras... 🎲🕵️‍♀️");
        sound.triggerVibration(50);
        state.setPvpRemoteActive(true); // Set mode before ensuring peer

        const joinerCustomization = state.getLocalPlayerCustomizationForNetwork();
        const preferences = {
            maxPlayers: parseInt(networkMaxPlayersSelect.value) || state.MAX_PLAYERS_NETWORK,
            gameSettings: { difficulty: state.getCurrentDifficulty() }
        };

        try {
            const localRawPeerId = await peerConnection.ensurePeerInitialized();
            if (!localRawPeerId) throw new Error("No se pudo obtener ID de PeerJS para matchmaking.");

            if (matchmaking?.joinQueue) {
                matchmaking.joinQueue(localRawPeerId, joinerCustomization, preferences, {
                    onSearching: () => {
                        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'inline-block';
                        if(networkInfoTitleEl) networkInfoTitleEl.textContent = "Buscando una partida divertida... 🧐";
                        if(networkInfoTextEl) networkInfoTextEl.textContent = "Conectando con amigas... ¡qué emoción! 💕";
                        if(qrCodeContainerEl) qrCodeContainerEl.innerHTML = ''; // Clear QR
                        ui.showScreen('networkInfo'); // Show searching status
                    },
                    onMatchFoundAndJoiningRoom: async (leaderRawPeerIdToJoin, roomDetails) => {
                        ui.hideModal(); // Hide "searching" modal
                        ui.showModal(`¡Sala encontrada! (${state.PIZARRA_PEER_ID_PREFIX}${leaderRawPeerIdToJoin}). Uniendo... ⏳`);
                        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
                        try {
                            // joinRoomById initiates connection, success leads to lobby via JOIN_ACCEPTED
                            await peerConnection.joinRoomById(leaderRawPeerIdToJoin, joinerCustomization);
                        } catch (joinError) {
                            ui.hideModal();
                            ui.showModal(`Error al unirse a la sala: ${joinError.message || 'Intenta de nuevo'}`);
                            stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup');
                        }
                    },
                    onMatchFoundAndHostingRoom: async (myNewRawPeerIdForHosting, initialHostData) => {
                        // This means no rooms were found, so we become a host.
                        // Pass the already obtained customization and preferences.
                        ui.hideModal(); // Hide "searching" modal
                        ui.showModal("No hay salas disponibles, ¡creando una nueva para ti! 🚀");
                        try {
                            await peerConnection.hostNewRoom(joinerCustomization, initialHostData.gameSettings);
                             // UI transition to lobby handled by hostNewRoom's success path
                            if (matchmaking?.updateHostedRoomStatus && myNewRawPeerIdForHosting) {
                                matchmaking.updateHostedRoomStatus(myNewRawPeerIdForHosting, initialHostData.gameSettings, initialHostData.maxPlayers, 1, 'hosting_waiting_for_players');
                            }
                        } catch (hostError) {
                            ui.hideModal(); ui.showModal(`Error al crear nueva sala: ${hostError.message}`);
                            stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup');
                        }
                        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
                    },
                    onError: (errMsg) => {
                        ui.hideModal(); ui.showModal(`Error de Matchmaking: ${errMsg}`);
                        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
                        stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup');
                    }
                });
            } else {
                 ui.hideModal(); ui.showModal(`Error: Servicio de matchmaking no disponible.`);
                 stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup');
            }
        } catch (initError) {
            ui.hideModal(); ui.showModal(`Error de Red inicial: ${initError.message || 'No se pudo conectar.'}`);
            stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup');
        }
    }

    // --- Global UI Callbacks for PeerConnection & State Changes ---
    window.pizarraUiUpdateCallbacks = {
        showLobby: (isHost) => { // Called after hostNewRoom or JOIN_ACCEPTED
            ui.hideModal();
            ui.showScreen('lobby');
            ui.updateLobbyUI(); // Renders lobby based on current pizarraState
            if (isHost) {
                ui.displayRoomQRCodeAndLink(state.getNetworkRoomData().roomId, state.getNetworkRoomData().maxPlayers, PIZARRA_BASE_URL, PIZARRA_PEER_ID_PREFIX);
            } else {
                if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none';
            }
        },
        updateLobby: ui.updateLobbyUI, // Direct pass-through if UI module handles all from state
        showNetworkError: (message, shouldReturnToSetupIfCritical = false) => {
            // Use a more descriptive modal if possible
            ui.showModal(`Error de Red  নেটওয়ার্ক ত্রুটি: ${message}`, [{ text: "OK", action: () => {
                ui.hideModal();
                if (shouldReturnToSetupIfCritical) {
                    stopAnyActiveGameOrNetworkSession(); // Full reset to main menu/setup
                }
            }}]);
            sound.playErrorSound();
        },
        // Called when client receives GAME_STARTED or host initiates it
        startGameOnNetwork: (initialGameState) => {
            console.log('[Main] startGameOnNetwork called with initialGameState:', initialGameState);
            ui.hideModal();
            if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none';
            ui.stopConfetti();

            // State module should have been updated by pizarraPeerConnection before this callback
            // This callback is primarily for UI transition and rendering
            ui.renderFullGameBoard(state.getNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId(), handleLetterClickUI);
            ui.showScreen('game');
            ui.displayMessage("¡El juego en red ha comenzado! 🎮🌍", 'info', false);
            sound.playGameStart();
        },
        // Called on GUESS_RESULT for immediate (but not necessarily authoritative) feedback
        updateGameFromNetwork: (guessResultPayload) => {
            console.log('[Main] updateGameFromNetwork (GUESS_RESULT) received:', guessResultPayload);
            // State (currentPlayerId, attempts, guessedLetters etc.) is partially updated by peerConnection
            // based on guessResultPayload, but FULL_GAME_STATE is authoritative.
            // This function can provide quick feedback.
            const { letter, correct, error, affectedPlayerId } = guessResultPayload;
            const playerMakingGuess = state.getPlayersData().find(p => p.id === affectedPlayerId);
            const guesserName = playerMakingGuess ? `${playerMakingGuess.icon}${playerMakingGuess.name}` : 'Alguien';

            if (error) {
                 ui.displayMessage(error, 'error');
            } else if (letter) { // Ensure letter exists before displaying
                const messageText = correct ?
                    `'${letter.toUpperCase()}' es CORRECTA. ¡Bien hecho ${guesserName}! 🎉` :
                    `'${letter.toUpperCase()}' es INCORRECTA. (${guesserName}) Oops! 😥`;
                ui.displayMessage(messageText, correct ? 'success' : 'error', false);
                if (correct) sound.playLetterSelectSound(true); else sound.playLetterSelectSound(false);
            }
            // Full UI re-render will happen on FULL_GAME_STATE via syncGameUIFromNetworkState
            // However, parts can be updated here for responsiveness if desired, e.g., alphabet:
            refreshAlphabetKeyboard();
            ui.updateWordDisplay(); // Reflect if a letter was revealed
            ui.updateGuessedLettersDisplay();
            ui.updateScoreDisplayUI(); // Scores might have changed
            ui.updateCurrentPlayerTurnUI(); // Turn might have changed
            ui.updateStarsDisplay(); // Attempts might have changed
        },
        // Called after FULL_GAME_STATE updates pizarraState
        syncGameUIFromNetworkState: () => {
            console.log('[Main] syncGameUIFromNetworkState: Forcing UI sync from full network state.');
            const currentPhase = state.getGamePhase();
            if (currentPhase === 'lobby') {
                ui.updateLobbyUI();
                ui.showScreen('lobby'); // Ensure lobby is visible
            } else if (currentPhase === 'playing' || currentPhase === 'game_over' || currentPhase === 'ended') {
                const isMyTurn = state.getNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId();
                ui.renderFullGameBoard(isMyTurn, handleLetterClickUI);
                if (!state.getGameActive()) { // If game ended or is over
                    ui.toggleClueButtonUI(false, false); // Hide and disable clue button
                }
                ui.showScreen('game'); // Ensure game area is visible if playing or just ended
            }
        },
        displayClueFromNetwork: (clueData) => { // clueData: {clue, clueUsed}
            sound.playClueReveal();
            ui.displayClueOnUI(clueData.clue);
            ui.displayMessage("¡Pista mágica para todos! 🤫✨", 'info');
            ui.toggleClueButtonUI(false, true); // Disable button, but keep area visible
            // Attempts (stars) will be updated by FULL_GAME_STATE if clue costs anything
        },
        showNetworkGameOver: (gameOverData) => { // { reason, winnerData, finalScores, finalWord }
            state.setGameActive(false); // Ensure game is marked inactive
            refreshAlphabetKeyboard(); // Disable alphabet
            ui.toggleClueButtonUI(false, false);

            let message = gameOverData.reason ? `Juego terminado: ${gameOverData.reason}.` : "¡Juego Terminado!";
            let isWinForLocalPlayer = false;

            if (gameOverData.winnerData?.winners?.length > 0) {
                 const winnerNames = gameOverData.winnerData.winners.map(w => `${w.icon || ''}${w.name || 'Jugador Desconocido'}`).join(' y ');
                 isWinForLocalPlayer = gameOverData.winnerData.winners.some(w => w.id === state.getNetworkRoomData().myPlayerIdInRoom);
                 if(gameOverData.winnerData.isTie) {
                     message += ` ¡Empate entre ${winnerNames}! 🤝`;
                 } else if (winnerNames) {
                     message += ` ¡Ganador(es): ${winnerNames}! 🏆`;
                 }
            } else if (gameOverData.finalWord) {
                message += ` La palabra era: ${gameOverData.finalWord.toUpperCase()}.`;
            }

            // Ensure final scores from gameOverData are reflected in the state if different
            if (gameOverData.finalScores) {
                const currentPlayers = state.getPlayersData(); // Game instance players
                const networkPlayers = state.getRawNetworkRoomData().players; // For networkRoomData consistency
                gameOverData.finalScores.forEach(ps => {
                    const pLocal = currentPlayers.find(p => p.id === ps.id); if (pLocal) pLocal.score = ps.score;
                    const pNet = networkPlayers.find(p => p.id === ps.id); if (pNet) pNet.score = ps.score;
                });
                state.setPlayersData([...currentPlayers]); // Updates localPlayersData
                state.setNetworkRoomData({players: [...networkPlayers]}); // Updates networkRoomData.players
                ui.updateScoreDisplayUI(); // Refresh score display
            }
             // Ensure the final word is displayed if game ended without solve by this player
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
        // New callbacks that might be useful
        handleCriticalDisconnect: () => { // Called by main.js if peerConnection reports critical error
            stopAnyActiveGameOrNetworkSession(); // Full reset
            ui.showModal("Desconectado de la partida. Volviendo al menú principal.", [{text: "OK", action: ui.hideModal}]);
        },
        showLobbyMessage: (messageText, isError = false) => { // For various lobby messages
            const lobbyMessageArea = document.getElementById('lobby-message-area');
            if(lobbyMessageArea) ui.displayMessage(messageText, isError ? 'error' : 'info', false, lobbyMessageArea);
        },
        hideModal: ui.hideModal, // Expose for peerConnection if needed
        showModal: ui.showModal, // Expose for peerConnection if needed
        hideNetworkInfo: () => {if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none';}
    };

    // --- Event Listener Setup ---
    function initializeAppEventListeners() {
        gameModeTabs.forEach(tab => tab.addEventListener('click', () => {
            sound.playUiClick();
            const newMode = tab.dataset.mode;
            const isCurrentlyPvp = state.getPvpRemoteActive();
            if ((newMode === 'local' && isCurrentlyPvp) || (newMode === 'network' && !isCurrentlyPvp)) {
                 stopAnyActiveGameOrNetworkSession(true); // Preserve screen if just switching setup type
            }
            ui.updateGameModeTabs(newMode);
            ui.showScreen(newMode === 'local' ? 'localSetup' : 'networkSetup');
            state.setPvpRemoteActive(newMode === 'network'); // Update state after potential stop session
        }));

        difficultyButtons.forEach(button => {
            button.addEventListener('click', (event) => {
                sound.playUiClick();
                state.setCurrentDifficulty(event.target.dataset.difficulty);
                ui.updateDifficultyButtonUI();
                // If in network setup, potentially update gameSettings in state if leader
                if (state.getPvpRemoteActive() && state.getNetworkRoomData().isRoomLeader) {
                    state.setNetworkRoomData({ gameSettings: { ...state.getNetworkRoomData().gameSettings, difficulty: state.getCurrentDifficulty() } });
                    // Host might want to broadcast this change if lobby UI shows difficulty from host
                    // For now, FULL_GAME_STATE on game start will sync it.
                }
            });
        });

        if(startLocalGameButton) startLocalGameButton.addEventListener('click', () => { sound.playUiClick(); startLocalGameUI(); });
        if(clueButtonEl) clueButtonEl.addEventListener('click', () => { sound.playUiClick(); handleClueRequestUI(); });
        if(playAgainButtonEl) playAgainButtonEl.addEventListener('click', () => {
            sound.playUiClick(); ui.stopConfetti();
            if (state.getPvpRemoteActive()) {
                ui.showModal("Para jugar otra vez en red, el líder de la sala debe iniciar una nueva partida desde la sala de espera, o puedes volver al menú principal.", [{text: "🏠 Volver al Menú", action: returnToMainMenuUI}]);
            } else {
                startLocalGameUI(); // Restart local game
            }
        });
        if(mainMenuButtonEl) mainMenuButtonEl.addEventListener('click', () => { sound.playUiClick(); ui.stopConfetti(); returnToMainMenuUI(); });
        if(hostGameButton) hostGameButton.addEventListener('click', () => { sound.playUiClick(); hostGameUI(); });
        if(joinRandomButton) joinRandomButton.addEventListener('click', () => { sound.playUiClick(); joinRandomGameUI(); });

        if(copyRoomLinkButtonEl) copyRoomLinkButtonEl.addEventListener('click', () => {
            sound.playUiClick();
            const roomLink = `${PIZARRA_BASE_URL}?room=${state.getNetworkRoomData().roomId}`;
            navigator.clipboard.writeText(roomLink).then(() => {
                ui.displayMessage("¡Enlace copiado al portapapeles! ✨", "success", false, document.getElementById('lobby-message-area') || messageAreaEl);
            }).catch(err => {
                console.error('Error al copiar enlace: ', err);
                ui.displayMessage("No se pudo copiar el enlace. 😔", "error", false, document.getElementById('lobby-message-area') || messageAreaEl);
            });
        });

        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.addEventListener('click', () => {
            sound.playUiClick();
            if(state.getMyPeerId() && matchmaking?.leaveQueue) matchmaking.leaveQueue(state.getMyPeerId());
            stopAnyActiveGameOrNetworkSession(true); // Preserve screen (networkSetup)
            ui.showScreen('networkSetup');
            ui.displayMessage("Búsqueda de partida cancelada. 🚫", "info");
        });
        if(lobbyToggleReadyButtonEl) lobbyToggleReadyButtonEl.addEventListener('click', () => {
            sound.playUiClick(); sound.triggerVibration(25);
            const myPlayer = state.getNetworkRoomData().players.find(p => p.peerId === state.getMyPeerId());
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
            if (e.target === customModalEl && modalDynamicButtonsEl && modalDynamicButtonsEl.children.length === 0) {
                sound.playUiClick(); ui.hideModal();
            }
        });

        const bodyEl = document.querySelector('body');
        const initAudio = async () => {
            if (sound?.initSounds && !sound.soundsCurrentlyInitialized) {
                await sound.initSounds();
            }
        };
        bodyEl.addEventListener('click', initAudio, { once: true });
        bodyEl.addEventListener('touchend', initAudio, { once: true });

        console.log("[Main] App event listeners initialized.");
    }

    // --- Initialize Application ---
    function initializeApp() {
        // ui.initializeUiDOMReferences(); // Already called at the top
        initializeAppEventListeners();
        if (typeof DICTIONARY_DATA !== 'undefined' && DICTIONARY_DATA.length > 0) {
            if(networkPlayerIconSelect) ui.populatePlayerIcons(networkPlayerIconSelect);
            state.setCurrentDifficulty('easy'); // Default difficulty
            ui.updateDifficultyButtonUI();
            returnToMainMenuUI(); // Start at the main menu/local setup
        } else {
            ui.showModal("Error Crítico: El diccionario de palabras no está cargado. El juego no puede iniciar. 💔");
        }
        processUrlJoin(); // Check for ?room= HFR parameter
    }

    async function processUrlJoin() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomIdFromUrl = urlParams.get('room');
        if (roomIdFromUrl && roomIdFromUrl.trim()) {
            // Clean URL immediately after reading param
            window.history.replaceState({}, document.title, window.location.pathname);

            const modalPlayerNameId = 'modal-player-name-urljoin';
            const modalPlayerIconId = 'modal-player-icon-urljoin';
            const joinPromptHtml = `
                <p>¡Te invitaron a una sala de Palabras (${PIZARRA_PEER_ID_PREFIX}${roomIdFromUrl})! 🎉</p>
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
                    ui.showModal(`Conectando a ${PIZARRA_PEER_ID_PREFIX}${roomIdFromUrl}... Por favor espera. ⏳`);
                    const nameInputInModal = document.getElementById(modalPlayerNameId);
                    const iconSelectInModal = document.getElementById(modalPlayerIconId);
                    // Get customization, then use state.getLocalPlayerCustomizationForNetwork() which includes color logic
                    if(nameInputInModal && networkPlayerNameInput) networkPlayerNameInput.value = nameInputInModal.value;
                    if(iconSelectInModal && networkPlayerIconSelect) networkPlayerIconSelect.value = iconSelectInModal.value;

                    const joinerCustomization = state.getLocalPlayerCustomizationForNetwork();
                    state.setPvpRemoteActive(true); // Set mode before attempting join
                    ui.updateGameModeTabs('network'); // Reflect mode switch in UI
                    ui.showScreen('networkSetup'); // Show network setup briefly as backdrop

                    try {
                        await peerConnection.joinRoomById(roomIdFromUrl.trim(), joinerCustomization);
                        // Success will lead to lobby via JOIN_ACCEPTED -> showLobby callback
                    } catch (error) {
                        ui.hideModal();
                        ui.showModal(`Error al unirse a la sala: ${error.message || 'Intenta de nuevo o verifica el ID.'}`);
                        stopAnyActiveGameOrNetworkSession(true); // Clean up
                        ui.showScreen('networkSetup'); // Back to setup on failure
                    }
                }},
                { text: "❌ Cancelar", action: () => { ui.hideModal(); ui.showScreen('localSetup'); ui.updateGameModeTabs('local'); }, className: 'action-button-secondary'}
            ];
            ui.showModal(joinPromptHtml, buttonsConfig, true); // isHtmlContent = true

            const iconSelectInModal = document.getElementById(modalPlayerIconId);
            if (iconSelectInModal) {
                ui.populatePlayerIcons(iconSelectInModal);
                if(networkPlayerIconSelect) iconSelectInModal.value = networkPlayerIconSelect.value || state.AVAILABLE_ICONS[0];
            }
        }
    }
    initializeApp();
});