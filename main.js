// main.js
import * as state from './pizarraState.js';
import * as logic from './gameLogic.js';
import * as peerConnection from './pizarraPeerConnection.js';
import * as matchmaking from './pizarraMatchmaking.js';

const PIZARRA_BASE_URL = "https://palabras.martinez.fyi";

document.addEventListener('DOMContentLoaded', () => {
    console.log("Pizarra de Palabras: DOMContentLoaded, initializing main.js with network features, haptics, and confetti.");

    // --- DOM Element References ---
    // ... (all your DOM references remain the same)
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

    const confettiContainerEl = document.getElementById('confetti-container');

    let messageTimeout = null;
    const HAPTICS_ENABLED = true;

    function triggerVibration(pattern = 30) { /* ... same ... */ 
        if (HAPTICS_ENABLED && typeof navigator.vibrate === 'function') {
            try { navigator.vibrate(pattern); } catch (e) { console.warn("Haptic feedback failed:", e); }
        }
    }

    const confettiColors = ["#FF69B4", "#00BFFF", "#FFD700", "#32CD32", "#FF7F50", "#DA70D6", "#f0f0f0", "#fffacd"];
    function createConfettiPiece() { /* ... same ... */ 
        if (!confettiContainerEl) return;
        const piece = document.createElement('div'); piece.classList.add('confetti-piece');
        piece.style.backgroundColor = confettiColors[Math.floor(Math.random() * confettiColors.length)];
        piece.style.left = Math.random() * window.innerWidth + 'px';
        const randomDrift = Math.random() * 2 - 1; piece.style.setProperty('--drift', randomDrift);
        const fallDuration = Math.random() * 3 + 4; piece.style.animationDuration = fallDuration + 's';
        piece.style.animationDelay = Math.random() * 0.5 + 's';
        confettiContainerEl.appendChild(piece);
        setTimeout(() => piece.remove(), (fallDuration + 1) * 1000);
    }
    function startConfetti(numberOfPieces = 120) { /* ... same ... */ if (!confettiContainerEl) return; stopConfetti(); for (let i = 0; i < numberOfPieces; i++) setTimeout(createConfettiPiece, i * 25); }
    function stopConfetti() { /* ... same ... */ if (confettiContainerEl) confettiContainerEl.innerHTML = ''; }
    function displayMessage(text, type = 'info', persistent = false, area = messageAreaEl) { /* ... same ... */ 
        if (!area) return;
        if (messageTimeout && area === messageAreaEl) clearTimeout(messageTimeout);
        area.textContent = text; area.className = `message ${type}`;
        const defaultInstruction = "Haz clic en una letra para adivinar...";
        if (!persistent && area === messageAreaEl && gameAreaEl.style.display !== 'none') {
             messageTimeout = setTimeout(() => {
                if (state.gameActive && area.textContent === text) displayMessage(defaultInstruction, 'info', false, area);
                else if (!state.gameActive && area.textContent === text && type !== 'success' && type !== 'error') { area.textContent = '\u00A0'; area.className = 'message';}
            }, 3000);
        }
    }
    function showModal(messageOrHtml, buttonsConfig = null, isHtmlContent = false) { /* ... same ... */ 
        if (!customModalEl || !modalMessageTextEl || !modalCloseButtonEl || !modalDynamicButtonsEl) return;
        if (isHtmlContent) modalMessageTextEl.innerHTML = messageOrHtml; else modalMessageTextEl.textContent = messageOrHtml;
        modalDynamicButtonsEl.innerHTML = '';
        if (buttonsConfig?.length > 0) {
            modalCloseButtonEl.style.display = 'none'; modalDynamicButtonsEl.style.display = 'flex';
            buttonsConfig.forEach(btnConfig => {
                const button = document.createElement('button'); button.textContent = btnConfig.text;
                button.className = btnConfig.className || 'action-button-secondary';
                button.addEventListener('click', btnConfig.action); 
                modalDynamicButtonsEl.appendChild(button);
            });
        } else {
            modalCloseButtonEl.style.display = 'inline-block'; modalDynamicButtonsEl.style.display = 'none';
        }
        customModalEl.style.display = 'flex';
    }
    function hideModal() { /* ... same ... */ if (customModalEl) customModalEl.style.display = 'none'; }
    function updateStarsDisplay() { /* ... same ... */ 
        if (!starsDisplayEl) return;
        let attemptsToShow = state.MAX_ATTEMPTS; 
        if (state.gameActive || state.pvpRemoteActive) { 
            if (state.pvpRemoteActive && state.networkRoomData.myPlayerIdInRoom !== null) {
                attemptsToShow = state.getAttemptsFor(state.networkRoomData.myPlayerIdInRoom);
            } else if (!state.pvpRemoteActive && state.playersData.length > 0) {
                attemptsToShow = state.getAttemptsFor(state.currentPlayerId);
            } else if (state.remainingAttemptsPerPlayer.length > 0 && state.currentPlayerId < state.remainingAttemptsPerPlayer.length) {
                attemptsToShow = state.getAttemptsFor(state.currentPlayerId);
            }
        }
        starsDisplayEl.textContent = state.STAR_SYMBOL.repeat(attemptsToShow);
    }
    function updateWordDisplay() { /* ... same ... */ 
        if (!wordDisplayContainerEl) return;
        wordDisplayContainerEl.innerHTML = '';
        if (!state.currentWord) return;
        for (const letter of state.currentWord) {
            const letterBox = document.createElement('div'); letterBox.classList.add('letter-box');
            if (state.guessedLetters.has(letter)) letterBox.textContent = letter;
            else { letterBox.textContent = ''; letterBox.classList.add('empty');}
            wordDisplayContainerEl.appendChild(letterBox);
        }
    }
    function updateGuessedLettersDisplay() { /* ... same ... */ 
        if (!correctLettersDisplayEl || !incorrectLettersDisplayEl) return;
        const correctArr = [], incorrectArr = [];
        const sortedGuessedLetters = Array.from(state.guessedLetters).sort((a,b)=>a.localeCompare(b,'es'));
        for (const letter of sortedGuessedLetters) {
            if (state.currentWord?.includes(letter)) correctArr.push(letter); else incorrectArr.push(letter);
        }
        correctLettersDisplayEl.textContent = correctArr.join(', ') || 'Ninguna';
        incorrectLettersDisplayEl.textContent = incorrectArr.join(', ') || 'Ninguna';
    }
    function updateDifficultyButtonUI() { /* ... same ... */ difficultyButtons.forEach(b => b.classList.toggle('active', b.dataset.difficulty === state.currentDifficulty)); }
    function populatePlayerIcons(targetSelectElement = networkPlayerIconSelect) { /* ... same ... */ 
        if (targetSelectElement) {
            targetSelectElement.innerHTML = ''; 
            state.AVAILABLE_ICONS.forEach(icon => {
                const option = document.createElement('option'); option.value = icon; option.textContent = icon;
                targetSelectElement.appendChild(option);
            });
            if (state.AVAILABLE_ICONS.length > 0) targetSelectElement.value = state.AVAILABLE_ICONS[0];
        }
    }
    function updateScoreDisplayUI() { /* ... same ... */ 
        if (!scoreDisplayAreaEl) return;
        scoreDisplayAreaEl.innerHTML = '';
        if (!state.playersData || state.playersData.length === 0) return;
        state.playersData.forEach(player => {
            const card = document.createElement('div'); card.className = 'player-score-card'; card.style.borderColor = player.color;
            const nameSpan = document.createElement('span'); nameSpan.className = 'name'; nameSpan.textContent = `${player.icon} ${player.name}: `;
            const scoreSpan = document.createElement('span'); scoreSpan.className = 'score'; scoreSpan.textContent = player.score;
            card.append(nameSpan, scoreSpan); scoreDisplayAreaEl.appendChild(card);
        });
    }
     function updateCurrentPlayerTurnUI() { /* ... same ... */ 
        if (!currentPlayerTurnDisplaySpan) return;
        if (!state.gameActive || !state.playersData.length) { currentPlayerTurnDisplaySpan.textContent = '-'; return; }
        const currentPlayer = state.playersData.find(p => p.id === state.currentPlayerId);
        if (currentPlayer) {
            let turnText = `${currentPlayer.icon} ${currentPlayer.name}`;
            if (state.pvpRemoteActive) {
                turnText = (currentPlayer.id === state.networkRoomData.myPlayerIdInRoom) ? `✅ ${turnText} (Tu Turno)` : `⏳ ${turnText}`;
            }
            currentPlayerTurnDisplaySpan.textContent = turnText;
        } else { currentPlayerTurnDisplaySpan.textContent = "Esperando..."; }
    }

    // MODIFIED: createAlphabetKeyboard now correctly uses isMyTurn
    function createAlphabetKeyboard(isMyTurnCurrently = true) {
        if (!alphabetKeyboardContainerEl) return;
        alphabetKeyboardContainerEl.innerHTML = '';
        state.ALPHABET.forEach(letter => {
            const button = document.createElement('button');
            button.classList.add('alphabet-button'); button.textContent = letter; button.dataset.letter = letter;
            // A letter button is disabled if:
            // 1. It's not the current player's turn (isMyTurnCurrently is false) OR
            // 2. The letter has already been guessed OR
            // 3. The game is not active.
            button.disabled = !isMyTurnCurrently || state.guessedLetters.has(letter) || !state.gameActive;
            button.addEventListener('click', () => handleLetterClickUI(letter, button));
            alphabetKeyboardContainerEl.appendChild(button);
        });
    }
    
    // MODIFIED: updateAllAlphabetButtons is simplified, primary control via createAlphabetKeyboard's isMyTurn
    function updateAllAlphabetButtons(disableCompletely) {
        if (!alphabetKeyboardContainerEl) return;
        alphabetKeyboardContainerEl.querySelectorAll('.alphabet-button').forEach(button => {
            const letter = button.dataset.letter;
            if (disableCompletely) {
                button.disabled = true;
            } else {
                // Enable based on whether it's guessed and game active, turn is handled by createAlphabetKeyboard
                button.disabled = state.guessedLetters.has(letter) || !state.gameActive;
            }
        });
    }

    // MODIFIED: updateAlphabetEnablement directly calls createAlphabetKeyboard
    function updateAlphabetEnablement() {
        if (!state.gameActive) {
            createAlphabetKeyboard(false); // Create disabled keyboard
            return;
        }
        const myTurn = state.pvpRemoteActive ? 
                       (state.networkRoomData.myPlayerIdInRoom === state.currentPlayerId) : 
                       true;
        createAlphabetKeyboard(myTurn); // Recreate keyboard with correct enabled/disabled states
    }

    function showScreen(screenName) { /* ... same as before ... */
        localGameSetupSection.style.display = 'none'; networkGameSetupSection.style.display = 'none';
        gameAreaEl.style.display = 'none'; lobbyAreaEl.style.display = 'none'; networkInfoAreaEl.style.display = 'none';
        if(playAgainButtonEl) playAgainButtonEl.style.display = 'none'; if(mainMenuButtonEl) mainMenuButtonEl.style.display = 'none';
        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
        const screenMap = { localSetup: localGameSetupSection, networkSetup: networkGameSetupSection, game: gameAreaEl, lobby: lobbyAreaEl, networkInfo: networkInfoAreaEl };
        if (screenMap[screenName]) screenMap[screenName].style.display = 'block';
    }
    
    // MODIFIED: setupGameBoardUI now directly calls createAlphabetKeyboard
    function setupGameBoardUI(isMyTurnCurrently) {
        createAlphabetKeyboard(isMyTurnCurrently); // Explicitly create/recreate keyboard here
        updateWordDisplay(); updateStarsDisplay(); updateGuessedLettersDisplay();
        updateScoreDisplayUI(); updateCurrentPlayerTurnUI(); updateDifficultyButtonUI();
        if(clueButtonEl) {
            clueButtonEl.style.display = 'inline-block';
            clueButtonEl.disabled = state.clueUsedThisGame || !state.gameActive || !isMyTurnCurrently;
        }
        if(clueDisplayAreaEl) clueDisplayAreaEl.style.display = state.clueUsedThisGame ? 'block' : 'none';
        if(clueTextEl && state.clueUsedThisGame) clueTextEl.textContent = state.currentWordObject?.definition || "";
    }

    function startLocalGameUI() { /* ... same ... */ 
        stopConfetti(); stopAnyActiveGameOrNetworkSession(true); state.setPvpRemoteActive(false);
        state.setPlayersData([{ id: 0, name: "Jugador", icon: "✏️", color: state.DEFAULT_PLAYER_COLORS[0], score: 0 }]);
        state.setCurrentPlayerId(0); 
        const initState = logic.initializeGame(state, state.currentDifficulty); 
        if (!initState.success) { showModal(initState.message || "No se pudo iniciar juego local."); return; }
        setupGameBoardUI(true); 
        showScreen('game');
        displayMessage("Haz clic en una letra para adivinar...", 'info', true);
    }
    function handleLetterClickUI(letter, buttonElement) { /* ... same ... */ 
        if (!state.gameActive || (buttonElement && buttonElement.disabled)) return;
        triggerVibration(25); 
        if (state.pvpRemoteActive) {
            if (state.networkRoomData.myPlayerIdInRoom === state.currentPlayerId) {
                if(buttonElement) buttonElement.disabled = true; peerConnection.sendGuessToHost(letter);
            } else displayMessage("No es tu turno.", 'error');
            return;
        }
        if(buttonElement) buttonElement.disabled = true;
        const result = logic.processGuess(letter); 
        updateStarsDisplay(); updateWordDisplay(); updateGuessedLettersDisplay();
        if (result.correct) {
            displayMessage(`¡Muy bien! '${result.letter}' está en la palabra. 👍`, 'success');
            if (result.wordSolved) endGameUI(true);
            // For local single player, if correct and not solved, they continue. Alphabet already has this letter disabled.
        } else {
            displayMessage(`'${result.letter}' no está. ¡Pierdes una ${state.STAR_SYMBOL}!`, 'error');
            if (result.gameOver) endGameUI(false);
        }
        // In local single player, turn doesn't pass. If game not over, alphabet just has one more letter disabled.
        // updateAlphabetEnablement(); // Not strictly needed here for local if only one player
        updateCurrentPlayerTurnUI(); // Refresh (won't change player in local single)
    }
    function handleClueRequestUI() { /* ... same ... */ 
        if (!state.gameActive || state.clueUsedThisGame || (state.pvpRemoteActive && state.networkRoomData.myPlayerIdInRoom !== state.currentPlayerId) ) {
            if (state.pvpRemoteActive && state.networkRoomData.myPlayerIdInRoom !== state.currentPlayerId) displayMessage("No es tu turno para pedir pista.", "error");
            return;
        }
        triggerVibration(40);
        if (state.pvpRemoteActive) { peerConnection.sendClueRequestToHost(); return; }
        const clueResult = logic.requestClue(state); 
        if (clueResult.success) {
            if(clueTextEl) clueTextEl.textContent = clueResult.clue;
            if(clueDisplayAreaEl) clueDisplayAreaEl.style.display = 'block';
            if(clueButtonEl) clueButtonEl.disabled = true;
            displayMessage("¡Pista revelada!", 'info');
        } else { displayMessage(clueResult.message || "No se pudo obtener la pista.", 'error'); }
    }
    function endGameUI(isWin) { /* ... same ... */ 
        updateAllAlphabetButtons(true); if(clueButtonEl) clueButtonEl.disabled = true;
        if(playAgainButtonEl) playAgainButtonEl.style.display = 'inline-block';
        if(mainMenuButtonEl) mainMenuButtonEl.style.display = 'inline-block';
        let finalMessage = "";
        if (isWin) {
            finalMessage = `¡GANASTE! 🎉 La palabra era: ${state.currentWordObject.word}`;
            displayMessage(finalMessage, 'success', true); triggerVibration([100, 40, 100, 40, 200]); startConfetti();
        } else {
            if (state.currentWordObject?.word) {
                for(const letter of state.currentWord) { state.guessedLetters.add(letter); }
                updateWordDisplay(); finalMessage = `¡Oh no! 😢 La palabra era: ${state.currentWordObject.word}`;
            } else { finalMessage = `¡Oh no! 😢 Intenta de nuevo.`; }
            displayMessage(finalMessage, 'error', true); triggerVibration([70,50,70]);
        }
    }
    function returnToMainMenuUI() { /* ... same ... */ stopConfetti(); stopAnyActiveGameOrNetworkSession(); }
    function stopAnyActiveGameOrNetworkSession(preserveUIScreen = false) { /* ... same ... */ 
        console.log("[Main] stopAnyActiveGameOrNetworkSession. Preserve UI:", preserveUIScreen);
        const wasPvpActive = state.pvpRemoteActive;
        if (state.gameActive) state.setGameActive(false); 
        if (wasPvpActive) {
            peerConnection.closeAllConnectionsAndSession(); 
            if (state.networkRoomData.roomState === 'seeking_match' && state.myPeerId) matchmaking.leaveQueue(state.myPeerId);
        }
        state.resetFullLocalStateForNewUIScreen(); 
        if (!preserveUIScreen) {
            showScreen('localSetup'); updateDifficultyButtonUI();
            if (gameModeTabs.length > 0) gameModeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === 'local'));
        }
        if(clueDisplayAreaEl) clueDisplayAreaEl.style.display = 'none';
        if (messageAreaEl) messageAreaEl.textContent = '\u00A0';
        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
        hideNetworkInfoArea(); stopConfetti(); updateScoreDisplayUI(); updateCurrentPlayerTurnUI();
    }
    function getPlayerCustomizationDataFromUI(isModal = false, modalNameInput = null, modalIconSelect = null) { /* ... same ... */ 
        let name, icon;
        if (isModal) {
            name = modalNameInput?.value.trim() || `Pizarrín${Math.floor(Math.random()*100)}`;
            icon = modalIconSelect?.value || state.AVAILABLE_ICONS[0];
        } else {
            name = networkPlayerNameInput?.value.trim() || `Pizarrín${Math.floor(Math.random()*100)}`;
            icon = networkPlayerIconSelect?.value || state.AVAILABLE_ICONS[0];
        }
        return { name, icon, color: state.DEFAULT_PLAYER_COLORS[0] };
    }
    async function hostGameUI() { /* ... same ... */ 
        stopAnyActiveGameOrNetworkSession(true); showModal("Creando tu sala de Pizarra..."); triggerVibration(50);
        const hostPlayerData = getPlayerCustomizationDataFromUI(); 
        const gameSettings = { difficulty: state.currentDifficulty, maxPlayers: parseInt(networkMaxPlayersSelect.value) || 2 };
        try {
            const hostPeerId = await peerConnection.hostNewRoom(hostPlayerData, gameSettings);
            hideModal(); 
            window.pizarraUiUpdateCallbacks.showLobby(true); 
            if (matchmaking?.updateHostedRoomStatus && hostPeerId) {
                 matchmaking.updateHostedRoomStatus(hostPeerId, state.networkRoomData.gameSettings, state.networkRoomData.maxPlayers, state.networkRoomData.players.length, 'hosting_waiting_for_players');
            }
        } catch (error) {
            hideModal(); showModal(`Error al crear la sala: ${error.message || 'Desconocido'}.`);
            stopAnyActiveGameOrNetworkSession(true); showScreen('networkSetup');
        }
    }
    function displayRoomQRCodeAndLink(roomId, maxPlayers) { /* ... same ... */ 
        if (!networkInfoAreaEl || !networkInfoTitleEl || !networkInfoTextEl || !qrCodeContainerEl || !copyRoomLinkButtonEl) return;
        const gameLink = `${PIZARRA_BASE_URL}?room=${roomId}`; 
        networkInfoTitleEl.textContent = "¡Sala Lista! Invita Jugadores";
        networkInfoTextEl.innerHTML = `ID de Sala: <strong>${state.PIZARRA_PEER_ID_PREFIX}${roomId}</strong><br>Enlace: <a href="${gameLink}" target="_blank" class="underline hover:text-pink-400">${gameLink}</a>`;
        qrCodeContainerEl.innerHTML = '';
        if (window.QRious) {
            const canvas = document.createElement('canvas');
            new QRious({ element: canvas, value: gameLink, size: 128, padding: 5, level: 'M', foreground: '#f0f0f0', background: '#4a4e4a' });
            qrCodeContainerEl.appendChild(canvas);
        } else { qrCodeContainerEl.textContent = "QR no disponible."; }
        copyRoomLinkButtonEl.onclick = () => {
            navigator.clipboard.writeText(gameLink)
                .then(() => displayMessage("Enlace copiado", "success", false, lobbyMessageAreaEl || messageAreaEl))
                .catch(() => displayMessage("Error al copiar", "error", false, lobbyMessageAreaEl || messageAreaEl));
            triggerVibration(30);
        };
        if(networkInfoAreaEl && state.networkRoomData.isRoomLeader) networkInfoAreaEl.style.display = 'block';
    }
    function hideNetworkInfoArea() { /* ... same ... */ if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none';}
    async function joinRandomGameUI() { /* ... same ... */ 
        stopAnyActiveGameOrNetworkSession(true); showModal("Buscando una sala al azar..."); triggerVibration(50); state.setPvpRemoteActive(true);
        const myPlayerData = getPlayerCustomizationDataFromUI(); 
        const preferences = { maxPlayers: parseInt(networkMaxPlayersSelect.value) || 2, gameSettings: { difficulty: state.currentDifficulty } };
        try {
            const localRawPeerId = await peerConnection.ensurePeerInitialized();
            if (!localRawPeerId) throw new Error("No se pudo obtener ID de PeerJS.");
            matchmaking.joinQueue(localRawPeerId, myPlayerData, preferences, {
                onSearching: () => {
                    if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'inline-block';
                    if(networkInfoTitleEl) networkInfoTitleEl.textContent = "Buscando Partida...";
                    if(networkInfoTextEl) networkInfoTextEl.textContent = "Intentando encontrar oponentes...";
                    if(qrCodeContainerEl) qrCodeContainerEl.innerHTML = ''; showScreen('networkInfo');
                },
                onMatchFoundAndJoiningRoom: async (leaderRawPeerIdToJoin, roomDetails) => {
                    hideModal(); showModal(`Sala encontrada (${state.PIZARRA_PEER_ID_PREFIX}${leaderRawPeerIdToJoin}). Conectando...`);
                    if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
                    try { await peerConnection.joinRoomById(leaderRawPeerIdToJoin, myPlayerData); } 
                    catch (joinError) { hideModal(); showModal(`Error al unirse: ${joinError.message || 'Desconocido'}`); stopAnyActiveGameOrNetworkSession(true); showScreen('networkSetup'); }
                },
                onMatchFoundAndHostingRoom: async (myNewRawPeerIdForHosting, initialHostData) => {
                    hideModal(); 
                    try { await peerConnection.hostNewRoom(myPlayerData, initialHostData.gameSettings); } 
                    catch (hostError) { showModal(`Error al crear sala: ${hostError.message}`); stopAnyActiveGameOrNetworkSession(true); showScreen('networkSetup'); }
                     if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
                },
                onError: (errMsg) => {
                    hideModal(); showModal(`Error de Matchmaking: ${errMsg}`);
                    if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
                    stopAnyActiveGameOrNetworkSession(true); showScreen('networkSetup');
                }
            });
        } catch (initError) {
            hideModal(); showModal(`Error de Red: ${initError.message || 'No se pudo inicializar.'}`);
            stopAnyActiveGameOrNetworkSession(true); showScreen('networkSetup');
        }
    }
    function updateLobbyUI() { /* ... same ... */ 
        if (!lobbyAreaEl || !state.pvpRemoteActive || !state.networkRoomData) return;
        const roomData = state.networkRoomData;
        if (lobbyRoomIdDisplayEl) lobbyRoomIdDisplayEl.textContent = roomData.roomId ? `${state.PIZARRA_PEER_ID_PREFIX}${roomData.roomId}` : 'N/A';
        if (lobbyDifficultyDisplayEl) lobbyDifficultyDisplayEl.textContent = roomData.gameSettings.difficulty || 'No def.';
        if (lobbyPlayerCountDisplayEl) lobbyPlayerCountDisplayEl.textContent = `${roomData.players.length}/${roomData.maxPlayers}`;
        if (lobbyPlayerListEl) {
            lobbyPlayerListEl.innerHTML = '';
            roomData.players.sort((a,b)=>a.id - b.id).forEach(player => {
                const card = document.createElement('div'); card.className = 'player-lobby-card'; card.style.borderLeftColor = player.color;
                const iconSpan = document.createElement('span'); iconSpan.className = 'icon'; iconSpan.textContent = player.icon;
                const nameSpan = document.createElement('span'); nameSpan.className = 'name';
                nameSpan.textContent = player.name + (player.peerId === state.myPeerId ? " (Vos)" : "") + (player.peerId === roomData.leaderPeerId ? " 👑" : "");
                const statusSpan = document.createElement('span'); statusSpan.className = 'status';
                statusSpan.textContent = player.isConnected === false ? "Desconectado" : (player.isReady ? "Listo ✔️" : "Esperando...");
                statusSpan.classList.add(player.isConnected === false ? 'disconnected' : (player.isReady ? 'ready' : 'not-ready'));
                card.append(iconSpan, nameSpan, statusSpan); lobbyPlayerListEl.appendChild(card);
            });
        }
        if (lobbyToggleReadyButtonEl) {
            const myPlayer = roomData.players.find(p => p.peerId === state.myPeerId);
            if (myPlayer) {
                lobbyToggleReadyButtonEl.textContent = myPlayer.isReady ? "❌ No Listo" : "👍 Marcar Listo";
                lobbyToggleReadyButtonEl.classList.toggle('action-button-danger', myPlayer.isReady);
                lobbyToggleReadyButtonEl.classList.toggle('action-button-confirm', !myPlayer.isReady);
            }
            lobbyToggleReadyButtonEl.disabled = roomData.roomState === 'in_game';
        }
        if (lobbyStartGameLeaderButtonEl) {
            lobbyStartGameLeaderButtonEl.style.display = roomData.isRoomLeader && roomData.roomState !== 'in_game' ? 'inline-block' : 'none';
            const canStart = roomData.players.length >= state.MIN_PLAYERS_NETWORK && roomData.players.every(p => p.isReady && p.isConnected !== false);
            lobbyStartGameLeaderButtonEl.disabled = !canStart;
        }
        if(lobbyMessageAreaEl && !lobbyMessageAreaEl.textContent.includes("copiado")) displayMessage("Esperando jugadores...", "info", true, lobbyMessageAreaEl);
    }

    window.pizarraUiUpdateCallbacks = {
        showLobby: (isHost) => { /* ... same ... */ 
            hideModal(); showScreen('lobby'); updateLobbyUI();
            if (isHost) displayRoomQRCodeAndLink(state.networkRoomData.roomId, state.networkRoomData.maxPlayers);
            else hideNetworkInfoArea();
        },
        updateLobby: updateLobbyUI,
        showNetworkError: (message, shouldReturnToSetup = false) => { /* ... same ... */ 
            showModal(message); if (shouldReturnToSetup) stopAnyActiveGameOrNetworkSession();
        },
        startGameOnNetwork: (initialGameState) => { // MODIFIED
            hideModal(); hideNetworkInfoArea(); stopConfetti();
            state.setPlayersData(initialGameState.playersInGameOrder); // pizarraState.setPlayersData now calls initRemainingAttempts
            state.setCurrentDifficulty(initialGameState.gameSettings.difficulty);
            state.setCurrentWordObject(initialGameState.currentWordObject);
            state.setGuessedLetters(new Set(initialGameState.guessedLetters || []));
            // If initialGameState includes remainingAttemptsPerPlayer, use it, else it's handled by initRemainingAttempts
            if (initialGameState.remainingAttemptsPerPlayer) {
                 state.remainingAttemptsPerPlayer = [...initialGameState.remainingAttemptsPerPlayer];
            }
            state.setCurrentPlayerId(initialGameState.startingPlayerId);
            state.setClueUsedThisGame(initialGameState.clueUsed || false);
            state.setGameActive(true);

            const isMyTurn = state.networkRoomData.myPlayerIdInRoom === state.currentPlayerId;
            setupGameBoardUI(isMyTurn); 
            showScreen('game');
            displayMessage("¡El juego en red ha comenzado!", 'info', true);
        },
        updateGameFromNetwork: (guessResultPayload) => { // MODIFIED
            // State (currentPlayerId, remainingAttemptsPerPlayer) is ALREADY updated by pizarraPeerConnection.js
            // This function focuses on UI refresh using the new state.
            updateStarsDisplay();         // Uses new state.getAttemptsFor
            updateAlphabetEnablement();   // Uses new state.currentPlayerId to enable/disable

            updateWordDisplay();          // Uses state.currentWord and state.guessedLetters
            updateGuessedLettersDisplay();// Uses state.guessedLetters
            updateScoreDisplayUI();       // Uses state.playersData (scores updated by peerConnection)
            updateCurrentPlayerTurnUI();  // Uses state.currentPlayerId

            const { guess, result } = guessResultPayload;
            displayMessage(result.correct ? `'${guess}' es CORRECTA.` : `'${guess}' es INCORRECTA.`, result.correct ? 'success' : 'error');

            if (result.gameOver) { 
                state.setGameActive(false); // Ensure game is marked inactive
                updateAlphabetEnablement();   // Disable alphabet
                // GAME_OVER_ANNOUNCEMENT message from host will trigger the actual end game modal & confetti
            }
        },
        displayClueFromNetwork: (clueData) => { /* ... same ... */ 
            state.setClueUsedThisGame(clueData.clueUsed);
            if (clueData.remainingAttemptsPerPlayer) { // Check if host sent updated attempts array
                state.remainingAttemptsPerPlayer = [...clueData.remainingAttemptsPerPlayer];
            } else if (clueData.remainingAttempts !== undefined) { // Fallback for single player if clue had cost
                // This branch might not be needed if clue has no cost or host sends full array
                const cluePlayerId = state.currentPlayerId; // Assume clue applies to current player if costed
                if(state.remainingAttemptsPerPlayer[cluePlayerId] !== undefined) {
                    state.remainingAttemptsPerPlayer[cluePlayerId] = clueData.remainingAttempts;
                }
            }
            if(clueTextEl) clueTextEl.textContent = clueData.clue;
            if(clueDisplayAreaEl) clueDisplayAreaEl.style.display = 'block';
            if(clueButtonEl) clueButtonEl.disabled = true;
            updateStarsDisplay(); 
            displayMessage("Pista revelada para todos.", 'info');
        },
        showNetworkGameOver: (gameOverData) => { /* ... same ... */ 
            state.setGameActive(false); updateAllAlphabetButtons(true); if(clueButtonEl) clueButtonEl.disabled = true;
            let message = gameOverData.reason ? `Juego terminado: ${gameOverData.reason}.` : "¡Juego Terminado!";
            let isWinForLocalPlayer = false;
            if (gameOverData.winnerData) {
                 const winners = gameOverData.winnerData.winners.map(w => `${w.icon || ''}${w.name}`).join(' y ');
                 isWinForLocalPlayer = gameOverData.winnerData.winners.some(w => w.id === state.networkRoomData.myPlayerIdInRoom);
                 if(gameOverData.winnerData.isTie && winners) { message += ` ¡Empate entre ${winners}!`; isWinForLocalPlayer = true; }
                 else if (winners) message += ` ¡Ganador(es): ${winners}!`;
            }
            if(gameOverData.finalScores) {
                gameOverData.finalScores.forEach(ps => { const pLocal = state.playersData.find(p => p.id === ps.id); if(pLocal) pLocal.score = ps.score; });
                updateScoreDisplayUI();
            }
            showModal(message, [{text: "Volver al Menú", action: () => { stopConfetti(); returnToMainMenuUI();}, className: 'action-button'}]);
            if (isWinForLocalPlayer) { triggerVibration([100, 40, 100, 40, 200]); startConfetti(); }
            else { triggerVibration([70,50,70]); }
        }
    };

    function initializeAppEventListeners() { /* ... same ... */ 
        gameModeTabs.forEach(tab => tab.addEventListener('click', () => {
            stopAnyActiveGameOrNetworkSession(true);
            gameModeTabs.forEach(t => t.classList.remove('active')); tab.classList.add('active');
            showScreen(tab.dataset.mode === 'local' ? 'localSetup' : 'networkSetup');
        }));
        difficultyButtons.forEach(b => b.addEventListener('click', (e) => { state.setCurrentDifficulty(e.target.dataset.difficulty); updateDifficultyButtonUI(); }));
        if(startLocalGameButton) startLocalGameButton.addEventListener('click', startLocalGameUI);
        if(clueButtonEl) clueButtonEl.addEventListener('click', handleClueRequestUI);
        if(playAgainButtonEl) playAgainButtonEl.addEventListener('click', () => {
            stopConfetti();
            if (state.pvpRemoteActive) showModal("Jugar otra vez en red no implementado. Volviendo al menú.", [{text: "OK", action: returnToMainMenuUI}]);
            else startLocalGameUI();
        });
        if(mainMenuButtonEl) mainMenuButtonEl.addEventListener('click', () => { stopConfetti(); returnToMainMenuUI(); });
        if(hostGameButton) hostGameButton.addEventListener('click', hostGameUI);
        if(joinRandomButton) joinRandomButton.addEventListener('click', joinRandomGameUI);
        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.addEventListener('click', () => {
            if(state.myPeerId) matchmaking.leaveQueue(state.myPeerId); 
            stopAnyActiveGameOrNetworkSession(true); showScreen('networkSetup'); displayMessage("Búsqueda cancelada.", "info");
        });
        if(lobbyToggleReadyButtonEl) lobbyToggleReadyButtonEl.addEventListener('click', () => {
            const myPlayer = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
            if(myPlayer) peerConnection.sendPlayerReadyState(!myPlayer.isReady); triggerVibration(25);
        });
        if(lobbyStartGameLeaderButtonEl) lobbyStartGameLeaderButtonEl.addEventListener('click', () => { peerConnection.leaderStartGameRequest(); triggerVibration(50); });
        if(lobbyLeaveRoomButtonEl) lobbyLeaveRoomButtonEl.addEventListener('click', () => {
             showModal("¿Seguro que quieres salir?", [{text: "Sí, Salir", action: stopAnyActiveGameOrNetworkSession, className: 'action-button-danger'}, {text: "No", action: hideModal, className: 'action-button-secondary'}]);
            triggerVibration(30);
        });
        if(modalCloseButtonEl) modalCloseButtonEl.addEventListener('click', hideModal);
        if(customModalEl) customModalEl.addEventListener('click', (e) => { if (e.target === customModalEl && modalDynamicButtonsEl.children.length === 0) hideModal(); });
    }

    function initializeApp() { /* ... same ... */ 
        initializeAppEventListeners();
        if (typeof DICTIONARY_DATA !== 'undefined' && DICTIONARY_DATA.length > 0) {
            populatePlayerIcons(); updateDifficultyButtonUI(); returnToMainMenuUI();
        } else { showModal("Error Crítico: Diccionario no cargado."); }
        processUrlJoin();
    }
    async function processUrlJoin() { /* ... same ... */ 
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
            showModal(joinPromptHtml, [
                { text: "✅ Unirme a la Sala", className: 'action-button-confirm', action: async () => {
                    hideModal(); showModal(`Conectando a ${state.PIZARRA_PEER_ID_PREFIX}${roomIdFromUrl}...`);
                    const nameInputInModal = document.getElementById(modalPlayerNameId); const iconSelectInModal = document.getElementById(modalPlayerIconId);
                    const joinerPlayerData = getPlayerCustomizationDataFromUI(true, nameInputInModal, iconSelectInModal);
                    state.setPvpRemoteActive(true);
                    try { await peerConnection.joinRoomById(roomIdFromUrl.trim(), joinerPlayerData); } 
                    catch (error) { hideModal(); showModal(`Error al unirse: ${error.message || 'Desconocido'}`); stopAnyActiveGameOrNetworkSession(true); showScreen('networkSetup'); }
                }},
                { text: "❌ Cancelar", action: () => { hideModal(); showScreen('networkSetup'); }, className: 'action-button-secondary'}
            ], true);
            const iconSelectInModal = document.getElementById(modalPlayerIconId);
            if (iconSelectInModal) { populatePlayerIcons(iconSelectInModal); if(networkPlayerIconSelect) iconSelectInModal.value = networkPlayerIconSelect.value; }
        }
    }
    initializeApp();
});