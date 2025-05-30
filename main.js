// main.js
import * as state from './pizarraState.js';
import * as logic from './gameLogic.js';
import * as peerConnection from './pizarraPeerConnection.js';
import * as matchmaking from './pizarraMatchmaking.js';

// User specified base URL:
const PIZARRA_BASE_URL = "https://palabras.martinez.fyi";

document.addEventListener('DOMContentLoaded', () => {
    console.log("Pizarra de Palabras: DOMContentLoaded, initializing main.js with network features.");

    // --- DOM Element References ---
    const gameModeTabs = document.querySelectorAll('.tab-button');
    const localGameSetupSection = document.getElementById('local-game-setup-section');
    const networkGameSetupSection = document.getElementById('network-game-setup-section');
    const difficultyButtons = document.querySelectorAll('.difficulty-button');
    const startLocalGameButton = document.getElementById('start-local-game-button');

    const playerIdentitySetupEl = document.getElementById('player-identity-setup');
    const networkPlayerNameInput = document.getElementById('network-player-name');
    const networkPlayerIconSelect = document.getElementById('network-player-icon');
    const networkMaxPlayersSelect = document.getElementById('network-max-players');
    const hostGameButton = document.getElementById('host-game-button');
    const joinRandomButton = document.getElementById('join-random-button');

    const networkInfoAreaEl = document.getElementById('network-info-area');
    const networkInfoTitleEl = document.getElementById('network-info-title');
    const qrCodeContainerEl = document.getElementById('qr-code-container');
    const networkInfoTextEl = document.getElementById('network-info-text');
    const copyRoomLinkButtonEl = document.getElementById('copy-room-link-button');
    const cancelMatchmakingButtonEl = document.getElementById('cancel-matchmaking-button');

    const lobbyAreaEl = document.getElementById('lobby-area');
    const lobbyTitleEl = document.getElementById('lobby-title');
    const lobbyRoomIdDisplayEl = document.getElementById('lobby-room-id-display')?.querySelector('span');
    const lobbyDifficultyDisplayEl = document.getElementById('lobby-difficulty-display');
    const lobbyPlayerCountDisplayEl = document.getElementById('lobby-player-count-display');
    const lobbyPlayerListEl = document.getElementById('lobby-player-list');
    const lobbyMessageAreaEl = document.getElementById('lobby-message-area');
    const lobbyToggleReadyButtonEl = document.getElementById('lobby-toggle-ready-button');
    const lobbyStartGameLeaderButtonEl = document.getElementById('lobby-start-game-leader-button');
    const lobbyLeaveRoomButtonEl = document.getElementById('lobby-leave-room-button');

    const gameAreaEl = document.getElementById('game-area');
    const starsDisplayEl = document.getElementById('stars-display');
    const currentPlayerTurnDisplaySpan = document.getElementById('current-player-turn-display')?.querySelector('span');
    const clueButtonEl = document.getElementById('clue-button');
    const clueDisplayAreaEl = document.getElementById('clue-display-area');
    const clueTextEl = document.getElementById('clue-text');
    const messageAreaEl = document.getElementById('message-area');
    const wordDisplayContainerEl = document.getElementById('word-display-container');
    const alphabetKeyboardContainerEl = document.getElementById('alphabet-keyboard-container');
    const incorrectLettersDisplayEl = document.getElementById('incorrect-letters-display');
    const correctLettersDisplayEl = document.getElementById('correct-letters-display');
    const scoreDisplayAreaEl = document.getElementById('score-display-area');
    const playAgainButtonEl = document.getElementById('play-again-button');
    const mainMenuButtonEl = document.getElementById('main-menu-button');

    const customModalEl = document.getElementById('custom-modal');
    const modalMessageTextEl = document.getElementById('modal-message-text');
    const modalCloseButtonEl = document.getElementById('modal-close-button');
    const modalDynamicButtonsEl = document.getElementById('modal-dynamic-buttons');

    let messageTimeout = null;

    // --- UI Update Functions ---
    function displayMessage(text, type = 'info', persistent = false, area = messageAreaEl) {
        if (!area) return;
        if (messageTimeout && area === messageAreaEl) clearTimeout(messageTimeout); // Only for main message area

        area.textContent = text;
        area.className = `message ${type}`; // Assumes messageAreaEl has 'message' class by default

        const defaultInstruction = "Haz clic en una letra para adivinar...";
        if (!persistent && area === messageAreaEl && gameAreaEl.style.display !== 'none') {
             messageTimeout = setTimeout(() => {
                if (state.gameActive && area.textContent === text) {
                     displayMessage(defaultInstruction, 'info', false, area);
                } else if (!state.gameActive && area.textContent === text && type !== 'success' && type !== 'error') {
                    area.textContent = '\u00A0';
                    area.className = 'message';
                }
            }, 3000);
        }
    }

    function showModal(message, buttonsConfig = null) {
        if (!customModalEl || !modalMessageTextEl || !modalCloseButtonEl || !modalDynamicButtonsEl) return;
        modalMessageTextEl.textContent = message;
        modalDynamicButtonsEl.innerHTML = '';

        if (buttonsConfig && buttonsConfig.length > 0) {
            modalCloseButtonEl.style.display = 'none';
            modalDynamicButtonsEl.style.display = 'flex';
            buttonsConfig.forEach(btnConfig => {
                const button = document.createElement('button');
                button.textContent = btnConfig.text;
                button.className = btnConfig.className || 'action-button-secondary';
                button.addEventListener('click', () => {
                    hideModal();
                    btnConfig.action?.();
                });
                modalDynamicButtonsEl.appendChild(button);
            });
        } else {
            modalCloseButtonEl.style.display = 'inline-block';
            modalDynamicButtonsEl.style.display = 'none';
        }
        customModalEl.style.display = 'flex';
    }

    function hideModal() {
        if (customModalEl) customModalEl.style.display = 'none';
    }

    function updateStarsDisplay() {
        if (starsDisplayEl) starsDisplayEl.textContent = state.STAR_SYMBOL.repeat(state.remainingAttempts);
    }

    function updateWordDisplay() {
        // ... (same as before)
        if (!wordDisplayContainerEl) return;
        wordDisplayContainerEl.innerHTML = '';
        if (!state.currentWord) return;
        for (const letter of state.currentWord) {
            const letterBox = document.createElement('div');
            letterBox.classList.add('letter-box');
            if (state.guessedLetters.has(letter)) {
                letterBox.textContent = letter;
            } else {
                letterBox.textContent = '';
                letterBox.classList.add('empty');
            }
            wordDisplayContainerEl.appendChild(letterBox);
        }
    }

    function updateGuessedLettersDisplay() {
        // ... (same as before)
        if (!correctLettersDisplayEl || !incorrectLettersDisplayEl) return;
        const correctArr = [];
        const incorrectArr = [];
        const sortedGuessedLetters = Array.from(state.guessedLetters).sort((a,b)=>a.localeCompare(b,'es'));

        for (const letter of sortedGuessedLetters) {
            if (state.currentWord && state.currentWord.includes(letter)) {
                correctArr.push(letter);
            } else {
                incorrectArr.push(letter);
            }
        }
        correctLettersDisplayEl.textContent = correctArr.join(', ') || 'Ninguna';
        incorrectLettersDisplayEl.textContent = incorrectArr.join(', ') || 'Ninguna';
    }

    function createAlphabetKeyboard(isMyTurn = true) {
        if (!alphabetKeyboardContainerEl) return;
        alphabetKeyboardContainerEl.innerHTML = '';
        state.ALPHABET.forEach(letter => {
            const button = document.createElement('button');
            button.classList.add('alphabet-button');
            button.textContent = letter;
            button.dataset.letter = letter;
            button.disabled = !isMyTurn || state.guessedLetters.has(letter); // Disable if not my turn or already guessed
            button.addEventListener('click', () => handleLetterClickUI(letter, button));
            alphabetKeyboardContainerEl.appendChild(button);
        });
    }
    
    function updateAllAlphabetButtons(disable, isMyTurn = true) {
        if (!alphabetKeyboardContainerEl) return;
        const buttons = alphabetKeyboardContainerEl.querySelectorAll('.alphabet-button');
        buttons.forEach(button => {
            const letter = button.dataset.letter;
            button.disabled = disable || !isMyTurn || state.guessedLetters.has(letter);
        });
    }

    function updateDifficultyButtonUI() {
        difficultyButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.difficulty === state.currentDifficulty);
        });
    }

    function showScreen(screenName) {
        // ... (same as before, ensure all relevant sections are handled) ...
        localGameSetupSection.style.display = 'none';
        networkGameSetupSection.style.display = 'none';
        gameAreaEl.style.display = 'none';
        lobbyAreaEl.style.display = 'none';
        networkInfoAreaEl.style.display = 'none';

        if(playAgainButtonEl) playAgainButtonEl.style.display = 'none';
        if(mainMenuButtonEl) mainMenuButtonEl.style.display = 'none';
        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';


        if (screenName === 'localSetup' && localGameSetupSection) localGameSetupSection.style.display = 'block';
        else if (screenName === 'networkSetup' && networkGameSetupSection) networkGameSetupSection.style.display = 'block';
        else if (screenName === 'game' && gameAreaEl) gameAreaEl.style.display = 'block';
        else if (screenName === 'lobby' && lobbyAreaEl) lobbyAreaEl.style.display = 'block';
        else if (screenName === 'networkInfo' && networkInfoAreaEl) networkInfoAreaEl.style.display = 'block';
    }
    
    function populatePlayerIcons() {
        if (networkPlayerIconSelect) {
            networkPlayerIconSelect.innerHTML = '';
            state.AVAILABLE_ICONS.forEach(icon => {
                const option = document.createElement('option'); option.value = icon; option.textContent = icon;
                networkPlayerIconSelect.appendChild(option);
            });
            if (state.AVAILABLE_ICONS.length > 0) networkPlayerIconSelect.value = state.AVAILABLE_ICONS[0];
        }
    }

    function updateScoreDisplayUI() {
        if (!scoreDisplayAreaEl) return;
        scoreDisplayAreaEl.innerHTML = '';
        if (!state.playersData || state.playersData.length === 0) return;

        // In network games, playersData is synced from networkRoomData.players by pizarraPeerConnection
        // For local games, playersData has only one player.
        // This display is more relevant for network games.
        state.playersData.forEach(player => {
            const card = document.createElement('div');
            card.className = 'player-score-card';
            card.style.borderColor = player.color;
            const nameSpan = document.createElement('span');
            nameSpan.className = 'name';
            nameSpan.textContent = `${player.icon} ${player.name}: `;
            const scoreSpan = document.createElement('span');
            scoreSpan.className = 'score';
            scoreSpan.textContent = player.score;
            card.append(nameSpan, scoreSpan);
            scoreDisplayAreaEl.appendChild(card);
        });
    }

    function updateCurrentPlayerTurnUI() {
        if (!currentPlayerTurnDisplaySpan) return;
        if (!state.gameActive || !state.playersData.length) {
            currentPlayerTurnDisplaySpan.textContent = '-';
            return;
        }
        const currentPlayer = state.playersData.find(p => p.id === state.currentPlayerId);
        if (currentPlayer) {
            let turnText = `${currentPlayer.icon} ${currentPlayer.name}`;
            if (state.pvpRemoteActive) {
                turnText = (currentPlayer.id === state.networkRoomData.myPlayerIdInRoom) ? `✅ ${turnText} (Tu Turno)` : `⏳ ${turnText}`;
            }
            currentPlayerTurnDisplaySpan.textContent = turnText;
        } else {
            currentPlayerTurnDisplaySpan.textContent = "Esperando...";
        }
    }


    // --- Game Flow Functions ---
    function startLocalGameUI() {
        stopAnyActiveGameOrNetworkSession(true); // Preserve UI screen for local setup
        state.setPvpRemoteActive(false);
        const initState = logic.initializeGame(state, state.currentDifficulty);

        if (!initState.success) {
            showModal(initState.message || "No se pudo iniciar juego local.");
            return;
        }
        // Single player for local Pizarra for now
        state.setPlayersData([{ id: 0, name: "Jugador", icon: "✏️", color: state.DEFAULT_PLAYER_COLORS[0], score: 0 }]);
        state.setCurrentPlayerId(0);

        setupGameBoardUI(true); // True because it's my turn in a local game
        showScreen('game');
        displayMessage("Haz clic en una letra para adivinar...", 'info', true);
    }

    function setupGameBoardUI(isMyTurnCurrently) {
        createAlphabetKeyboard(isMyTurnCurrently);
        updateWordDisplay();
        updateStarsDisplay();
        updateGuessedLettersDisplay();
        updateScoreDisplayUI(); // Show single player score or clear for local
        updateCurrentPlayerTurnUI();
        updateDifficultyButtonUI();


        if(clueButtonEl) {
            clueButtonEl.style.display = 'inline-block';
            clueButtonEl.disabled = state.clueUsedThisGame || !state.gameActive;
        }
        if(clueDisplayAreaEl) clueDisplayAreaEl.style.display = state.clueUsedThisGame ? 'block' : 'none';
        if(clueTextEl && state.clueUsedThisGame) clueTextEl.textContent = state.currentWordObject?.definition || "";

        updateAllAlphabetButtons(!state.gameActive || !isMyTurnCurrently);
    }


    function handleLetterClickUI(letter, buttonElement) {
        if (!state.gameActive || (buttonElement && buttonElement.disabled)) return;

        if (state.pvpRemoteActive) {
            if (state.networkRoomData.myPlayerIdInRoom === state.currentPlayerId) {
                if(buttonElement) buttonElement.disabled = true; // Optimistic disabling
                peerConnection.sendGuessToHost(letter);
                // UI will update upon GUESS_RESULT from host
            } else {
                displayMessage("No es tu turno.", 'error');
            }
            return;
        }

        // Local game
        if(buttonElement) buttonElement.disabled = true;
        const result = logic.processGuess(state, letter);

        // No need to check result.validGuess as button disabling handles already guessed.
        // processGuess itself also checks for already guessed.

        updateStarsDisplay();
        updateWordDisplay();
        updateGuessedLettersDisplay();

        if (result.correct) {
            displayMessage(`¡Muy bien! '${result.letter}' está en la palabra. 👍`, 'success');
            if (result.wordSolved) endGameUI(true);
        } else {
            displayMessage(`'${result.letter}' no está. ¡Pierdes una ${state.STAR_SYMBOL}!`, 'error');
            if (result.gameOver) endGameUI(false);
        }
        // For local single player, turn doesn't change unless game over.
        updateCurrentPlayerTurnUI(); // Refresh, though it won't change player
    }

    function handleClueRequestUI() {
        if (!state.gameActive || state.clueUsedThisGame) return;

        if (state.pvpRemoteActive) {
            peerConnection.sendClueRequestToHost();
            // UI updates upon CLUE_PROVIDED from host
            return;
        }

        // Local game
        const clueResult = logic.requestClue(state);
        if (clueResult.success) {
            if(clueTextEl) clueTextEl.textContent = clueResult.clue;
            if(clueDisplayAreaEl) clueDisplayAreaEl.style.display = 'block';
            if(clueButtonEl) clueButtonEl.disabled = true;
            displayMessage("¡Pista revelada!", 'info');
        } else {
            displayMessage(clueResult.message || "No se pudo obtener la pista.", 'error');
        }
    }

    function endGameUI(isWin) { // For local game over
        updateAllAlphabetButtons(true); // Disable all alphabet buttons
        if(clueButtonEl) clueButtonEl.disabled = true;

        if(playAgainButtonEl) playAgainButtonEl.style.display = 'inline-block';
        if(mainMenuButtonEl) mainMenuButtonEl.style.display = 'inline-block';

        let finalMessage = "";
        if (isWin) {
            finalMessage = `¡GANASTE! 🎉 La palabra era: ${state.currentWordObject.word}`;
            displayMessage(finalMessage, 'success', true);
        } else {
            if (state.currentWordObject && state.currentWordObject.word) {
                for(const letter of state.currentWord) { state.guessedLetters.add(letter); }
                updateWordDisplay(); // Reveal word
                finalMessage = `¡Oh no! 😢 La palabra era: ${state.currentWordObject.word}`;
            } else {
                finalMessage = `¡Oh no! 😢 Intenta de nuevo.`;
            }
            displayMessage(finalMessage, 'error', true);
        }
        // For network games, a different modal might be shown by network event handlers.
    }

    function returnToMainMenuUI() {
        stopAnyActiveGameOrNetworkSession(); // This function now handles full reset and UI transition
    }

    function stopAnyActiveGameOrNetworkSession(preserveUIScreen = false) {
        console.log("[Main] stopAnyActiveGameOrNetworkSession called. Preserve UI:", preserveUIScreen);
        const wasPvpActive = state.pvpRemoteActive;

        if (state.gameActive) logic.initializeGame(state, state.currentDifficulty); // Resets game logic state
        state.setGameActive(false);

        if (wasPvpActive) {
            peerConnection.closeAllConnectionsAndSession(); // Closes PeerJS
            if (state.networkRoomData.roomState === 'seeking_match' && state.myPeerId) {
                matchmaking.leaveQueue(state.myPeerId);
            }
        }
        state.resetFullLocalStateForNewUIScreen(); // Resets all state variables

        if (!preserveUIScreen) {
            showScreen('localSetup'); // Default screen
            updateDifficultyButtonUI();
            if (gameModeTabs.length > 0) { // Reset tabs to local
                gameModeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === 'local'));
            }
        }
        if(clueDisplayAreaEl) clueDisplayAreaEl.style.display = 'none';
        if (messageAreaEl) messageAreaEl.textContent = '\u00A0';
        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
        hideNetworkInfoArea();
    }


    // --- Network UI and Flow Functions ---
    function getPlayerCustomizationData() {
        return {
            name: networkPlayerNameInput?.value.trim() || `Pizzarista${Math.floor(Math.random()*1000)}`,
            icon: networkPlayerIconSelect?.value || state.AVAILABLE_ICONS[0],
            color: state.DEFAULT_PLAYER_COLORS[state.networkRoomData.players.length % state.DEFAULT_PLAYER_COLORS.length] // Simple color assignment for now
        };
    }

    async function hostGameUI() {
        stopAnyActiveGameOrNetworkSession(true); // Preserve UI (Network Setup)
        showModal("Creando sala de juego...");

        const hostPlayerData = getPlayerCustomizationData();
        const gameSettings = {
            difficulty: state.currentDifficulty, // Host sets difficulty for the room
            maxPlayers: parseInt(networkMaxPlayersSelect.value) || 2
        };

        try {
            const hostPeerId = await peerConnection.hostNewRoom(hostPlayerData, gameSettings);
            // Success is handled by onPeerOpen -> _finalizeHostSetup which calls uiUpdate_ShowLobbyAsHost
            // This means pizarraPeerConnection should call a function in main.js to update UI.
            // Let's assume pizarraPeerConnection uses state changes that main.js observes or has callbacks.
            // For now, let's have a direct function call from peerConnection (if it's refactored that way)
            // or handle it via state change observation.
            // For this example, we'll simulate the state change and UI update path.
            // This will be refined when peerConnection calls back to main.js or updates state watched by main.js.
            // hideModal(); // Assuming peerConnection will manage modal for progress.
            // uiUpdate_ShowLobbyAsHost(); // This function will be defined below
        } catch (error) {
            hideModal();
            showModal(`Error al crear la sala: ${error.message || 'Desconocido'}. Verifica tu conexión e intenta de nuevo.`);
            stopAnyActiveGameOrNetworkSession(true); // Clean up on error
            showScreen('networkSetup');
        }
    }
    
    function displayRoomQRCodeAndLink(roomId, maxPlayers) {
        if (!networkInfoAreaEl || !networkInfoTitleEl || !networkInfoTextEl || !qrCodeContainerEl || !copyRoomLinkButtonEl) return;

        const gameLink = `${PIZARRA_BASE_URL}?room=${roomId}`; // Uses the user-specified URL
        networkInfoTitleEl.textContent = "¡Sala Creada! Invita Jugadores";
        networkInfoTextEl.innerHTML = `Comparte este ID: <strong>${state.PIZARRA_PEER_ID_PREFIX}${roomId}</strong><br>o el enlace: <a href="${gameLink}" target="_blank">${gameLink}</a>`;

        qrCodeContainerEl.innerHTML = ''; // Clear previous QR
        if (window.QRious) {
            const canvas = document.createElement('canvas');
            new QRious({ element: canvas, value: gameLink, size: 128, padding: 4, level: 'M', background: '#fff', foreground: '#333' });
            qrCodeContainerEl.appendChild(canvas);
        } else {
            qrCodeContainerEl.textContent = "QR no disponible.";
        }
        copyRoomLinkButtonEl.onclick = () => {
            navigator.clipboard.writeText(gameLink)
                .then(() => displayMessage("Enlace copiado al portapapeles", "success", false, lobbyMessageAreaEl || messageAreaEl))
                .catch(() => displayMessage("Error al copiar enlace", "error", false, lobbyMessageAreaEl || messageAreaEl));
        };
        networkInfoAreaEl.style.display = 'block';
    }

    function hideNetworkInfoArea() {
        if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none';
        if(qrCodeContainerEl) qrCodeContainerEl.innerHTML = '';
    }


    async function joinRandomGameUI() {
        stopAnyActiveGameOrNetworkSession(true);
        showModal("Buscando una sala al azar...");
        state.setPvpRemoteActive(true); // Set this early

        const myPlayerData = getPlayerCustomizationData();
        const preferences = {
            maxPlayers: parseInt(networkMaxPlayersSelect.value) || 2, // User's preferred max players for a room they might join/host
            gameSettings: { difficulty: state.currentDifficulty } // Preferred difficulty if they end up hosting
        };

        try {
            const localRawPeerId = await peerConnection.ensurePeerInitialized(); // Ensure PeerJS is up
            if (!localRawPeerId) throw new Error("No se pudo obtener ID de PeerJS.");

            matchmaking.joinQueue(localRawPeerId, myPlayerData, preferences, {
                onSearching: () => {
                    if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'inline-block';
                    if(networkInfoTitleEl) networkInfoTitleEl.textContent = "Buscando Partida...";
                    if(networkInfoTextEl) networkInfoTextEl.textContent = "Intentando encontrar oponentes...";
                    if(qrCodeContainerEl) qrCodeContainerEl.innerHTML = ''; // No QR while searching
                    showScreen('networkInfo'); // Show the area with cancel button
                },
                onMatchFoundAndJoiningRoom: async (leaderRawPeerIdToJoin, roomDetails) => {
                    hideModal();
                    showModal(`Sala encontrada (${state.PIZARRA_PEER_ID_PREFIX}${leaderRawPeerIdToJoin}). Conectando...`);
                    if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
                    try {
                        await peerConnection.joinRoomById(leaderRawPeerIdToJoin, myPlayerData);
                        // Success is handled by onConnectionOpen -> JOIN_ACCEPTED -> uiUpdate_ShowLobbyAsClient
                    } catch (joinError) {
                        hideModal();
                        showModal(`Error al unirse a la sala: ${joinError.message || 'Desconocido'}`);
                        stopAnyActiveGameOrNetworkSession(true); showScreen('networkSetup');
                    }
                },
                onMatchFoundAndHostingRoom: async (myNewRawPeerIdForHosting, initialHostData) => {
                    hideModal(); // Hide "searching" modal
                    // Matchmaking decided this client should host
                    // Host new room using the details from matchmaking (which were our preferences)
                    try {
                         await peerConnection.hostNewRoom(myPlayerData, initialHostData.gameSettings); // Host with own data and prefs
                        // Success leads to uiUpdate_ShowLobbyAsHost via _finalizeHostSetup
                    } catch (hostError) {
                        showModal(`Error al crear sala desde matchmaking: ${hostError.message}`);
                        stopAnyActiveGameOrNetworkSession(true); showScreen('networkSetup');
                    }
                     if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
                },
                onError: (errMsg) => {
                    hideModal();
                    showModal(`Error de Matchmaking: ${errMsg}`);
                    if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
                    stopAnyActiveGameOrNetworkSession(true); showScreen('networkSetup');
                },
                // onTimeout could be added here too
            });
        } catch (initError) {
            hideModal();
            showModal(`Error de Red: ${initError.message || 'No se pudo inicializar la conexión.'}`);
            stopAnyActiveGameOrNetworkSession(true); showScreen('networkSetup');
        }
    }

    function updateLobbyUI() {
        if (!lobbyAreaEl || !state.pvpRemoteActive) return;

        const roomData = state.networkRoomData;
        if (lobbyRoomIdDisplayEl) lobbyRoomIdDisplayEl.textContent = roomData.roomId ? `${state.PIZARRA_PEER_ID_PREFIX}${roomData.roomId}` : 'N/A';
        if (lobbyDifficultyDisplayEl) lobbyDifficultyDisplayEl.textContent = roomData.gameSettings.difficulty || 'No definida';
        if (lobbyPlayerCountDisplayEl) lobbyPlayerCountDisplayEl.textContent = `${roomData.players.length}/${roomData.maxPlayers}`;

        if (lobbyPlayerListEl) {
            lobbyPlayerListEl.innerHTML = '';
            roomData.players.sort((a,b) => a.id - b.id).forEach(player => {
                const card = document.createElement('div');
                card.className = 'player-lobby-card';
                card.style.borderLeftColor = player.color;
                const iconSpan = document.createElement('span'); iconSpan.className = 'icon'; iconSpan.textContent = player.icon;
                const nameSpan = document.createElement('span'); nameSpan.className = 'name';
                nameSpan.textContent = player.name + (player.peerId === state.myPeerId ? " (Vos)" : "") + (player.peerId === roomData.leaderPeerId ? " 👑" : "");
                const statusSpan = document.createElement('span'); statusSpan.className = 'status';
                if (!player.isConnected) {
                    statusSpan.textContent = "Desconectado"; statusSpan.classList.add('disconnected');
                } else {
                    statusSpan.textContent = player.isReady ? "Listo ✔️" : "Esperando...";
                    statusSpan.classList.add(player.isReady ? 'ready' : 'not-ready');
                }
                card.append(iconSpan, nameSpan, statusSpan);
                lobbyPlayerListEl.appendChild(card);
            });
        }

        if (lobbyToggleReadyButtonEl) {
            const myPlayer = roomData.players.find(p => p.peerId === state.myPeerId);
            if (myPlayer) {
                lobbyToggleReadyButtonEl.textContent = myPlayer.isReady ? "❌ No Listo" : "👍 Marcar como Listo";
                lobbyToggleReadyButtonEl.classList.toggle('action-button-danger', myPlayer.isReady);
                lobbyToggleReadyButtonEl.classList.toggle('action-button-confirm', !myPlayer.isReady);
            }
            lobbyToggleReadyButtonEl.disabled = roomData.roomState === 'in_game';
        }

        if (lobbyStartGameLeaderButtonEl) {
            lobbyStartGameLeaderButtonEl.style.display = roomData.isRoomLeader && roomData.roomState !== 'in_game' ? 'inline-block' : 'none';
            const canStart = roomData.players.length >= state.MIN_PLAYERS_NETWORK && roomData.players.every(p => p.isReady && p.isConnected);
            lobbyStartGameLeaderButtonEl.disabled = !canStart;
        }
        if (lobbyMessageAreaEl) displayMessage("Bienvenido a la sala. Esperando jugadores...", "info", true, lobbyMessageAreaEl);
    }

    // --- Define UI Update Callbacks for PeerConnection ---
    // These functions are called by pizarraPeerConnection.js when network events occur that require UI updates.
    // This decouples network logic from direct DOM manipulation in that file.
    window.pizarraUiUpdateCallbacks = {
        showLobby: (isHost) => {
            hideModal();
            showScreen('lobby');
            updateLobbyUI();
            if (isHost) {
                displayRoomQRCodeAndLink(state.networkRoomData.roomId, state.networkRoomData.maxPlayers);
            } else {
                hideNetworkInfoArea(); // Clients don't need to show QR for the room they joined
            }
        },
        updateLobby: () => {
            updateLobbyUI();
        },
        showNetworkError: (message, shouldReturnToSetup = false) => {
            showModal(message);
            if (shouldReturnToSetup) {
                stopAnyActiveGameOrNetworkSession(); // Resets state and UI
            }
        },
        startGameOnNetwork: (initialGameState) => { // Called when GAME_STARTED is received/sent
            hideModal();
            hideNetworkInfoArea(); // Hide QR/ID info
            
            state.setPlayersData(initialGameState.playersInGameOrder);
            state.setCurrentDifficulty(initialGameState.gameSettings.difficulty);
            state.setCurrentWordObject(initialGameState.currentWordObject);
            state.setGuessedLetters(new Set(initialGameState.guessedLetters || []));
            state.setRemainingAttempts(initialGameState.remainingAttempts);
            state.setCurrentPlayerId(initialGameState.startingPlayerId);
            state.setClueUsedThisGame(initialGameState.clueUsed || false);
            state.setGameActive(true);

            const isMyTurn = state.networkRoomData.myPlayerIdInRoom === state.currentPlayerId;
            setupGameBoardUI(isMyTurn); // Setup board, alphabet (with correct disabled state)
            showScreen('game');
            displayMessage("¡El juego en red ha comenzado!", 'info', true);
        },
        updateGameFromNetwork: (guessResultData) => { // Called on GUESS_RESULT
            state.setGuessedLetters(new Set(guessResultData.guessedLetters));
            state.setRemainingAttempts(guessResultData.remainingAttempts);
            state.setCurrentPlayerId(guessResultData.nextPlayerId);

            if (guessResultData.scores) {
                guessResultData.scores.forEach(ps => {
                    const playerToUpdateState = state.playersData.find(p => p.id === ps.id);
                    if (playerToUpdateState) playerToUpdateState.score = ps.score;
                });
                updateScoreDisplayUI();
            }
            
            const isMyTurn = state.networkRoomData.myPlayerIdInRoom === state.currentPlayerId;
            setupGameBoardUI(isMyTurn); // Will re-render word, alphabet, stars based on new state
            
            const { guess, result } = guessResultData;
            if (result.correct) {
                displayMessage(`'${guess}' es CORRECTA.`, 'success');
            } else {
                displayMessage(`'${guess}' es INCORRECTA.`, 'error');
            }

            if (result.wordSolved || result.gameOver) {
                state.setGameActive(false); // Logic sets this, UI update needs to reflect
                // endGameUI_Network will be called by GAME_OVER_ANNOUNCEMENT
            }
            updateCurrentPlayerTurnUI();
        },
        displayClueFromNetwork: (clueData) => { // Called on CLUE_PROVIDED
            state.setClueUsedThisGame(clueData.clueUsed);
            if (clueData.remainingAttempts !== undefined) state.setRemainingAttempts(clueData.remainingAttempts);

            if(clueTextEl) clueTextEl.textContent = clueData.clue;
            if(clueDisplayAreaEl) clueDisplayAreaEl.style.display = 'block';
            if(clueButtonEl) clueButtonEl.disabled = true;
            updateStarsDisplay(); // If clue had a cost
            displayMessage("Pista revelada para todos.", 'info');
        },
        showNetworkGameOver: (gameOverData) => { // Called on GAME_OVER_ANNOUNCEMENT
             state.setGameActive(false);
             updateAllAlphabetButtons(true);
             if(clueButtonEl) clueButtonEl.disabled = true;

            let message = gameOverData.reason ? `Juego terminado: ${gameOverData.reason}.` : "¡Juego Terminado!";
            if (gameOverData.winnerData) {
                 const winners = gameOverData.winnerData.winners.map(w => `${w.icon || ''}${w.name}`).join(' y ');
                 if(gameOverData.winnerData.isTie && winners) message += ` ¡Empate entre ${winners}!`;
                 else if (winners) message += ` ¡Ganador(es): ${winners}!`;
            }
            showModal(message, [
                {text: "Volver al Menú Principal", action: returnToMainMenuUI, className: 'action-button'}
            ]);
            // Update final scores if provided in gameOverData.finalScores
            if(gameOverData.finalScores) {
                gameOverData.finalScores.forEach(ps => {
                    const pLocal = state.playersData.find(p => p.id === ps.id);
                    if(pLocal) pLocal.score = ps.score;
                });
                updateScoreDisplayUI();
            }
        }
    };


    // --- Event Listener Setup ---
    function initializeAppEventListeners() {
        // ... (local game listeners: difficulty, startLocalGame, clue, playAgain, mainMenu remain mostly same) ...
        gameModeTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                stopAnyActiveGameOrNetworkSession(true); // Preserve UI for tab switch
                gameModeTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const mode = tab.dataset.mode;
                if (mode === 'local') showScreen('localSetup');
                else if (mode === 'network') showScreen('networkSetup');
            });
        });
        difficultyButtons.forEach(button => button.addEventListener('click', (e) => {
            state.setCurrentDifficulty(e.target.dataset.difficulty); updateDifficultyButtonUI();
        }));
        if(startLocalGameButton) startLocalGameButton.addEventListener('click', startLocalGameUI);
        if(clueButtonEl) clueButtonEl.addEventListener('click', handleClueRequestUI);
        if(playAgainButtonEl) playAgainButtonEl.addEventListener('click', () => {
            if (state.pvpRemoteActive) { // Network game "play again" means back to lobby or new game
                 showModal("Opción 'Jugar Otra Vez' para red no implementada. Volviendo al menú.", [
                     {text: "OK", action: returnToMainMenuUI}
                 ]);
            } else {
                startLocalGameUI(); // Local game restart
            }
        });
        if(mainMenuButtonEl) mainMenuButtonEl.addEventListener('click', returnToMainMenuUI);

        // Network Buttons
        if(hostGameButton) hostGameButton.addEventListener('click', hostGameUI);
        if(joinRandomButton) joinRandomButton.addEventListener('click', joinRandomGameUI);
        if(copyRoomLinkButtonEl) copyRoomLinkButtonEl.addEventListener('click', () => {/* Handled in displayRoomQRAndLink */});
        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.addEventListener('click', () => {
            matchmaking.leaveQueue(state.myPeerId); // myPeerId is raw
            stopAnyActiveGameOrNetworkSession(true); // Preserve networkSetup screen
            showScreen('networkSetup');
            displayMessage("Búsqueda cancelada.", "info");
        });

        // Lobby Buttons
        if(lobbyToggleReadyButtonEl) lobbyToggleReadyButtonEl.addEventListener('click', () => {
            const myPlayer = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
            if(myPlayer) peerConnection.sendPlayerReadyState(!myPlayer.isReady);
        });
        if(lobbyStartGameLeaderButtonEl) lobbyStartGameLeaderButtonEl.addEventListener('click', () => {
            peerConnection.leaderStartGameRequest();
        });
        if(lobbyLeaveRoomButtonEl) lobbyLeaveRoomButtonEl.addEventListener('click', () => {
             showModal("¿Seguro que quieres salir de la sala?", [
                {text: "Sí, Salir", action: () => { stopAnyActiveGameOrNetworkSession(); }, className: 'action-button-danger'},
                {text: "No, Quedarme", action: hideModal, className: 'action-button-secondary'}
            ]);
        });

        // Modal
        if(modalCloseButtonEl) modalCloseButtonEl.addEventListener('click', hideModal);
        if(customModalEl) customModalEl.addEventListener('click', (event) => {
            if (event.target === customModalEl && modalDynamicButtonsEl.children.length === 0) hideModal();
        });
        console.log("App event listeners initialized.");
    }

    // --- Initialize Application ---
    function initializeApp() {
        initializeAppEventListeners();
        if (typeof DICTIONARY_DATA !== 'undefined' && DICTIONARY_DATA.length > 0) {
            populatePlayerIcons();
            updateDifficultyButtonUI();
            returnToMainMenuUI(); // Start at the main setup/menu
        } else {
            showModal("Error Crítico: Diccionario no cargado.");
        }
        // Auto-join if room ID in URL (like Cajitas)
        processUrlJoin();
    }
    
    async function processUrlJoin() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomIdFromUrl = urlParams.get('room');
        if (roomIdFromUrl && roomIdFromUrl.trim()) {
            showModal(`Intentando unirse a la sala ${roomIdFromUrl}... Configure su nombre e ícono.`, [
                { text: "Configurar y Unirse", action: async () => {
                    stopAnyActiveGameOrNetworkSession(true); // Preserve network setup
                    showScreen('networkSetup'); // To set name/icon
                    // After user sets name/icon, they'd click a join button (not yet added for direct ID join)
                    // For now, let's assume they configure and then we try to join.
                    // This needs a "Join by ID" button or better flow.
                    // For this example, we'll just try joining after a short delay.
                    // In a real app, user would confirm after setting identity.
                    hideModal();
                    showModal(`Conectando a ${roomIdFromUrl}...`);
                    const joinerPlayerData = getPlayerCustomizationData();
                    state.setPvpRemoteActive(true);
                    try {
                        await peerConnection.joinRoomById(roomIdFromUrl.trim(), joinerPlayerData);
                        // Success: onConnectionOpen -> JOIN_ACCEPTED -> uiUpdateCallbacks.showLobby
                        // Clear URL param
                        window.history.replaceState({}, document.title, PIZARRA_BASE_URL);

                    } catch (error) {
                        hideModal();
                        showModal(`Error al unirse a la sala ${roomIdFromUrl}: ${error.message || 'Error desconocido'}`);
                        stopAnyActiveGameOrNetworkSession(true); showScreen('networkSetup');
                    }
                }},
                { text: "Cancelar", action: () => {
                    hideModal();
                     window.history.replaceState({}, document.title, PIZARRA_BASE_URL);
                }, className: 'action-button-secondary'}
            ]);
        }
    }

    initializeApp();
});