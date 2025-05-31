// main.js - Fixed for network mode, mobile UI, easy mode clues, and auto-restart
import * as state from './pizarraState.js';
import * as logic from './gameLogic.js';
import * as peerConnection from './pizarraPeerConnection.js';
import * as matchmaking from './pizarraMatchmaking.js';
import * as ui from './pizarraUi.js';
import * as sound from './pizarraSound.js';

const PIZARRA_BASE_URL = "https://palabras.martinez.fyi";

function enterPlayMode(){
  document.body.classList.add('playing');
  // console.log("[Main] Entered play mode."); 
}

function exitPlayMode(){
  document.body.classList.remove('playing');
  // console.log("[Main] Exited play mode.");
}

document.addEventListener('DOMContentLoaded', () => {
    // console.log("Pizarra de Palabras: DOMContentLoaded, initializing main.js.");

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

    function handleCancelMatchmaking() {
        // console.log("[Main] handleCancelMatchmaking called.");
        sound.playUiClick();
        exitPlayMode();
        const currentPeerId = state.getMyPeerId();
        if (currentPeerId && matchmaking?.leaveQueue) {
            matchmaking.leaveQueue(currentPeerId);
        }
        stopAnyActiveGameOrNetworkSession(true); 
        ui.showScreen('networkSetup');
        ui.displayMessage("Búsqueda de partida cancelada. 🚫", "info");
        ui.hideModal(); 
        if (cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
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
        // console.log("[Main] startLocalGameUI called.");
        ui.stopConfetti();
        const selectedDifficulty = state.getCurrentDifficulty();
        
        state.resetGameFlowState(); 

        state.setPvpRemoteActive(false);
        if (!state.getPlayersData() || state.getPlayersData().length === 0) {
            state.setPlayersData([{ 
                id: 0, 
                name: "Jugador", 
                icon: "✏️", 
                color: state.DEFAULT_PLAYER_COLORS[0], 
                score: 0 
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

        if (selectedDifficulty === 'easy') {
            state.setClueUsedThisGame(true); // Clue is shown by default in easy mode
        }

        ui.renderFullGameBoard(true, handleLetterClickUI);
        
        if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'none';
        if(document.getElementById('app')) document.getElementById('app').style.display = 'flex';
        
        enterPlayMode();
        ui.displayMessage("¡Adiviná la palabra secreta! ✨", 'info', false);
        if (playAgainButtonEl) playAgainButtonEl.style.display = 'none'; 
        if (mainMenuButtonEl) mainMenuButtonEl.style.display = 'inline-block';
    }

    function handleLetterClickUI(letter, buttonElement) {
        if (!state.getGameActive() || (buttonElement && buttonElement.disabled)) {
            return;
        }
        sound.triggerVibration(25);

        if (state.getPvpRemoteActive()) {
            if (state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) {
                if (buttonElement) buttonElement.disabled = true;
                peerConnection.sendGuessToHost(letter);
            } else {
                ui.displayMessage("No es tu turno. ¡Esperá un poquito! ⏳", 'error');
            }
            return;
        }

        const result = logic.processGuess(letter);
        ui.renderFullGameBoard(true, handleLetterClickUI); // Re-render based on new state

        if (result.error) {
            ui.displayMessage(result.error, 'error');
        } else if (result.alreadyGuessed) {
             ui.displayMessage(`Ya intentaste la letra '${result.letter.toUpperCase()}'. ¡Probá otra! 🤔`, 'info');
        } else if (result.correct) {
            sound.playLetterSelectSound(true);
            ui.displayMessage(`¡Genial! '${result.letter.toUpperCase()}' está en la palabra. 👍`, 'success');
            if (result.wordSolved) {
                endGameUI(true); 
                return;
            }
        } else {
            sound.playLetterSelectSound(false);
            ui.displayMessage(`'${result.letter.toUpperCase()}' no está. ¡Perdés una ${state.STAR_SYMBOL}! 😢`, 'error');
            if (result.gameOver) {
                endGameUI(false);
                return;
            }
        }
    }

    function handleClueRequestUI() {
        if (state.getCurrentDifficulty() === 'easy') return; // Button shouldn't be visible, but guard here.

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
                ui.displayClueOnUI(clueResult.clue); // UI will show it
                ui.displayMessage("¡Pista mágica revelada! 🔮", 'info');
                if(clueButtonEl) clueButtonEl.disabled = true; // Disable after use
            } else {
                sound.playErrorSound();
                ui.displayMessage(clueResult.message || "No se pudo obtener la pista.", 'error');
            }
        }
    }

    function endGameUI(isWin) {
        if (!state.getPvpRemoteActive()) { // Only set game active false here for local games
            state.setGameActive(false);
        }
        
        refreshAlphabetKeyboard(); 
        ui.toggleClueButtonUI(false, false); 

        if (mainMenuButtonEl) mainMenuButtonEl.style.display = 'inline-block';
        if (playAgainButtonEl) playAgainButtonEl.style.display = 'none';

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

        if (!state.getPvpRemoteActive()) {
            const autoRestartDelay = 5000; 
            // console.log(`[Main] Scheduling automatic local game restart in ${autoRestartDelay}ms.`);
            setTimeout(() => {
                if (!state.getPvpRemoteActive() && (state.getGamePhase() === 'ended' || state.getGamePhase() === 'game_over')) {
                     // console.log("[Main] Automatically restarting local game after delay.");
                     ui.hideModal(); 
                     startLocalGameUI();
                }
            }, autoRestartDelay);
        }
    }

    function returnToMainMenuUI() {
        // console.log("[Main] returnToMainMenuUI called.");
        ui.stopConfetti();
        ui.hideModal();
        stopAnyActiveGameOrNetworkSession(); 
    }

    function stopAnyActiveGameOrNetworkSession(preserveUIScreen = false) {
        // console.log(`[Main] stopAnyActiveGameOrNetworkSession called. Preserve UI: ${preserveUIScreen}`);
        exitPlayMode();
        const wasPvpActive = state.getPvpRemoteActive();
        const currentNetworkRoomState = state.getRawNetworkRoomData().roomState;
        const myCurrentPeerId = state.getMyPeerId(); 

        if (state.getGameActive()) {
            state.setGameActive(false);
        }

        if (wasPvpActive) {
            peerConnection.leaveRoom();
            peerConnection.closePeerSession(); 
            if (currentNetworkRoomState === 'seeking_match' && myCurrentPeerId) {
                 if (matchmaking && typeof matchmaking.leaveQueue === 'function') {
                    matchmaking.leaveQueue(myCurrentPeerId);
                }
            }
        }
        
        state.resetFullLocalStateForNewUIScreen();

        if (!preserveUIScreen) {
            if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'block';
            if(document.getElementById('app')) document.getElementById('app').style.display = 'none';
            ui.updateGameModeTabs('local'); 
            ui.showScreen('localSetup'); 
        }
        ui.updateDifficultyButtonUI(); 

        if (clueDisplayAreaEl) clueDisplayAreaEl.style.display = 'none';
        if (messageAreaEl) ui.displayMessage('\u00A0', 'info', true); 
        
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
        // console.log("[Main] stopAnyActiveGameOrNetworkSession completed.");
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
            if (matchmaking?.updateHostedRoomStatus && state.getMyPeerId()) { 
                 matchmaking.updateHostedRoomStatus(state.getMyPeerId(), gameSettings, gameSettings.maxPlayers, 1, 'hosting_waiting_for_players');
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
        stopAnyActiveGameOrNetworkSession(true); 
        sound.triggerVibration(50);
        state.setPvpRemoteActive(true);

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
            if (!localRawPeerId || typeof localRawPeerId !== 'string') { 
                throw new Error("ID de jugador local inválido después de la inicialización de PeerJS.");
            }
            
            if (matchmaking?.joinQueue) {
                matchmaking.joinQueue(localRawPeerId, joinerCustomization, preferences, {
                    onSearching: () => {
                        if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'block'; 
                        if(document.getElementById('app')) document.getElementById('app').style.display = 'none';
                        ui.showScreen('networkSetup'); 
                        exitPlayMode();
                    },
                    onMatchFoundAndJoiningRoom: async (leaderRawPeerIdToJoin, roomDetails) => {
                        ui.hideModal(); 
                        ui.showModal(`¡Sala encontrada! (${state.PIZARRA_PEER_ID_PREFIX}${leaderRawPeerIdToJoin}). Uniendo... ⏳`);
                        try {
                            await peerConnection.joinRoomById(leaderRawPeerIdToJoin, joinerCustomization);
                        } catch (joinError) {
                            console.error(`[Main] Error joining room ${leaderRawPeerIdToJoin}:`, joinError);
                            ui.hideModal();
                            ui.showModal(`Error al unirse a la sala: ${joinError.message || 'Intentá de nuevo'}`);
                            stopAnyActiveGameOrNetworkSession(true); ui.showScreen('networkSetup');
                        }
                    },
                    onMatchFoundAndHostingRoom: async (myNewRawPeerIdForHosting, initialHostData) => {
                        ui.hideModal(); 
                        ui.showModal("No hay salas disponibles, ¡creando una nueva para vos! 🚀");
                        try {
                            await peerConnection.hostNewRoom(joinerCustomization, initialHostData.gameSettings); 
                            if (matchmaking?.updateHostedRoomStatus && state.getMyPeerId()) {
                                matchmaking.updateHostedRoomStatus(state.getMyPeerId(), initialHostData.gameSettings, initialHostData.gameSettings.maxPlayers || preferences.maxPlayers, 1, 'hosting_waiting_for_players');
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

    async function processUrlJoin() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomIdFromUrl = urlParams.get('room');
        if (roomIdFromUrl && roomIdFromUrl.trim()) {
            window.history.replaceState({}, document.title, window.location.pathname);
            exitPlayMode();

            ui.createJoinRoomModal(roomIdFromUrl, 
                async (playerData) => {
                    ui.showModal(`Conectando a ${state.PIZARRA_PEER_ID_PREFIX}${roomIdFromUrl}... Por favor esperá. ⏳`);
                    
                    if (networkPlayerNameInput) networkPlayerNameInput.value = playerData.name;
                    if (networkPlayerIconSelect) networkPlayerIconSelect.value = playerData.icon;

                    state.setPvpRemoteActive(true);
                    ui.updateGameModeTabs('network');
                    if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'block';
                    if(document.getElementById('app')) document.getElementById('app').style.display = 'none';
                    ui.showScreen('networkSetup'); 

                    try {
                        await peerConnection.joinRoomById(roomIdFromUrl.trim(), playerData);
                    } catch (error) {
                        console.error("[Main] URL Join: Error joining room:", error);
                        ui.hideModal(); 
                        ui.showModal(`Error al unirse a la sala: ${error.message || 'Intentá de nuevo o verificá el ID.'}`);
                        stopAnyActiveGameOrNetworkSession(true); 
                        ui.showScreen('networkSetup'); 
                    }
                },
                () => {
                    ui.showScreen('localSetup'); 
                    ui.updateGameModeTabs('local'); 
                    exitPlayMode();
                }
            );
        }
    }

    window.pizarraUiUpdateCallbacks = {
        showLobby: (isHost) => {
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
            ui.updateLobbyUI();
        },
        showNetworkError: (message, shouldReturnToSetupIfCritical = false) => {
            console.error(`[Main] UI Callback: showNetworkError. Message: ${message}, Critical: ${shouldReturnToSetupIfCritical}`);
            ui.showModal(`Error de Red: ${message}`, [{ text: "OK", action: () => {
                ui.hideModal();
                if (shouldReturnToSetupIfCritical) {
                    handleCancelMatchmaking(); 
                }
            }}]);
            sound.playErrorSound();
            exitPlayMode();
        },
        startGameOnNetwork: (initialGameState) => {
            ui.hideModal();
            if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none';
            ui.stopConfetti(); 
            
            if (initialGameState.gameSettings.difficulty === 'easy') {
                state.setClueUsedThisGame(true); // Clue is shown by default in easy mode
            } else {
                state.setClueUsedThisGame(false); // Ensure it's reset for other modes
            }
            state.setCurrentDifficulty(initialGameState.gameSettings.difficulty); // Ensure state reflects difficulty

            if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'none';
            if(document.getElementById('app')) document.getElementById('app').style.display = 'flex';

            ui.renderFullGameBoard(state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId(), handleLetterClickUI);
            
            enterPlayMode();
            ui.displayMessage("¡El juego en red ha comenzado! 🎮🌍", 'info', false);
            sound.playGameStart();
        },
        updateGameFromNetwork: (guessResultPayload) => {
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
                
                // Ensure difficulty and clue state are set correctly before rendering
                const difficulty = state.getRawNetworkRoomData().gameSettings?.difficulty || 'easy';
                state.setCurrentDifficulty(difficulty);
                if (difficulty === 'easy') {
                    state.setClueUsedThisGame(true);
                } // For other modes, clueUsedThisGame should be part of the synced game state.

                const isMyTurn = state.getRawNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId();
                ui.renderFullGameBoard(isMyTurn, handleLetterClickUI);

                if (!state.getGameActive()) { // If game is over/ended
                    ui.toggleClueButtonUI(false, false);
                }
                if(currentPhase === 'playing') enterPlayMode(); else exitPlayMode();
            } else {
                if(document.getElementById('setup-container')) document.getElementById('setup-container').style.display = 'block';
                if(document.getElementById('app')) document.getElementById('app').style.display = 'none';
                ui.showScreen('networkSetup'); 
                exitPlayMode();
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
                
                const updatedPlayers = currentPlayers.map(pLocal => {
                    const pScoreUpdate = gameOverData.finalScores.find(ps => ps.id === pLocal.id);
                    return pScoreUpdate ? { ...pLocal, score: pScoreUpdate.score } : pLocal;
                });
                state.setPlayersData([...updatedPlayers]); 
                
                if(state.getRawNetworkRoomData().isRoomLeader){
                    const updatedNetworkPlayers = networkPlayers.map(pNet => {
                         const pScoreUpdate = gameOverData.finalScores.find(ps => ps.id === pNet.id);
                         return pScoreUpdate ? { ...pNet, score: pScoreUpdate.score } : pNet;
                    });
                    state.setNetworkRoomData({players: [...updatedNetworkPlayers]});
                }
                ui.updateScoreDisplayUI();
            }

            if (gameOverData.finalWord && !logic.checkWinCondition()) { 
                const finalGuessed = new Set();
                for (const letter of gameOverData.finalWord.toUpperCase()) { 
                    finalGuessed.add(state.normalizeString(letter).toLowerCase()); 
                }
                state.setGuessedLetters(finalGuessed);
                ui.updateWordDisplay();
            }
        
            if (state.getRawNetworkRoomData().isRoomLeader) {
                ui.showModal(message + "\nReiniciando automáticamente en unos segundos...", [], true); 
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
            const lobbyMessageArea = document.getElementById('lobby-message-area');
            if(lobbyMessageArea) ui.displayMessage(messageText, isError ? 'error' : 'info', false, lobbyMessageArea);
        },
        hideModal: ui.hideModal,
        showModal: ui.showModal,
        hideNetworkInfo: () => {
            if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none';
        }
    };

    function initializeAppEventListeners() {
        // console.log("[Main] Initializing app event listeners.");
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
                const newDifficulty = event.target.dataset.difficulty;
                sound.playUiClick();
                state.setCurrentDifficulty(newDifficulty);
                ui.updateDifficultyButtonUI();
                if (state.getPvpRemoteActive() && state.getRawNetworkRoomData().isRoomLeader) {
                    state.setNetworkRoomData({ gameSettings: { ...state.getRawNetworkRoomData().gameSettings, difficulty: state.getCurrentDifficulty() } });
                    peerConnection.broadcastFullGameStateToAll(); 
                }
            });
        });

        if(startLocalGameButton) startLocalGameButton.addEventListener('click', () => { sound.playUiClick(); startLocalGameUI(); });
        if(clueButtonEl) clueButtonEl.addEventListener('click', () => { sound.playUiClick(); handleClueRequestUI(); });
        
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
                console.error('[Main] Error al copiar enlace: ', err);
                ui.displayMessage("No se pudo copiar el enlace. 😔", "error", false, document.getElementById('lobby-message-area') || messageAreaEl);
            });
        });
        
        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.addEventListener('click', () => {
            handleCancelMatchmaking();
        });

        if(lobbyToggleReadyButtonEl) lobbyToggleReadyButtonEl.addEventListener('click', () => {
            sound.playUiClick(); sound.triggerVibration(25);
            const myPlayer = state.getRawNetworkRoomData().players.find(p => p.peerId === state.getMyPeerId());
            if(myPlayer) {
                peerConnection.sendPlayerReadyState(!myPlayer.isReady);
            }
        });
        if(lobbyStartGameLeaderButtonEl) lobbyStartGameLeaderButtonEl.addEventListener('click', () => {
            sound.playUiClick(); sound.triggerVibration(50);
            peerConnection.leaderStartGameRequest();
        });
        if(lobbyLeaveRoomButtonEl) lobbyLeaveRoomButtonEl.addEventListener('click', () => {
            sound.playUiClick(); sound.triggerVibration(30);
             ui.showModal("¿Seguro que querés salir de la sala? 🚪🥺", [
                 {text: "Sí, Salir", action: returnToMainMenuUI, className: 'action-button-danger'},
                 {text: "No, Quedarme", action: ui.hideModal, className: 'action-button-secondary'}
                ]);
        });
        if(modalCloseButtonEl) modalCloseButtonEl.addEventListener('click', () => { sound.playUiClick(); ui.hideModal();});
        if(customModalEl) customModalEl.addEventListener('click', (e) => {
            if (e.target === customModalEl) {
                const hasDynamicButtons = modalDynamicButtonsEl && modalDynamicButtonsEl.children.length > 0;
                if (!hasDynamicButtons) { 
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

        // console.log("[Main] App event listeners initialized.");
    }

    function initializeApp() {
        // console.log("[Main] initializeApp called.");
        initializeAppEventListeners(); 
        
        if (typeof DICTIONARY_DATA !== 'undefined' && DICTIONARY_DATA.length > 0) {
            if(networkPlayerIconSelect) ui.populatePlayerIcons(networkPlayerIconSelect);
            state.setCurrentDifficulty('easy'); // Default difficulty
            ui.updateDifficultyButtonUI();
            stopAnyActiveGameOrNetworkSession(); 
        } else {
            console.error("[Main] CRITICAL ERROR: Dictionary not loaded.");
            ui.showModal("Error Crítico: El diccionario de palabras no está cargado. El juego no puede iniciar. 💔");
            exitPlayMode();
        }
        processUrlJoin(); 
        // console.log("[Main] initializeApp completed.");
    }

    initializeApp();
});