// main.js
import * as state from './pizarraState.js';
import * as logic from './gameLogic.js';
import * as peerConnection from './pizarraPeerConnection.js';
import * as matchmaking from './pizarraMatchmaking.js';
// As per your RCA, importing ui and sound modules
import * as ui from './pizarraUi.js'; // You will need to create pizarraUi.js and export functions like renderFullGameBoard
import * as sound from './pizarraSound.js'; // You will need to create pizarraSound.js and export playGameStart

const PIZARRA_BASE_URL = "https://palabras.martinez.fyi";

document.addEventListener('DOMContentLoaded', () => {
    console.log("Pizarra de Palabras: DOMContentLoaded, initializing main.js with network features, haptics, and confetti.");

    // --- DOM Element References ---
    // (Assume all DOM references from your previous complete main.js are here)
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
                if (state.getGameActive() && area.textContent === text) displayMessage(defaultInstruction, 'info', false, area); // Use getter
                else if (!state.getGameActive() && area.textContent === text && type !== 'success' && type !== 'error') { area.textContent = '\u00A0'; area.className = 'message';}
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
    
    // MODIFIED updateStarsDisplay as per your RCA
    function updateStarsDisplay() {
        if (!starsDisplayEl) return;
        let attemptsToShow = state.DEFAULT_ATTEMPTS_PER_PLAYER; // Default to prevent error if pid is undefined
        let pidToShowAttemptsFor = null;

        if (state.getPvpRemoteActive()) { // Use getPvpRemoteActive()
            pidToShowAttemptsFor = state.getNetworkRoomData().myPlayerIdInRoom; // Show local player's stars
        } else {
            pidToShowAttemptsFor = state.getCurrentPlayerId(); // Show current player's stars in local game
        }

        if (pidToShowAttemptsFor !== null && pidToShowAttemptsFor !== undefined) {
            attemptsToShow = state.getAttemptsFor(pidToShowAttemptsFor);
        }
        starsDisplayEl.textContent = state.STAR_SYMBOL.repeat(attemptsToShow);
    }

    function updateWordDisplay() { /* ... same ... */ 
        if (!wordDisplayContainerEl) return;
        wordDisplayContainerEl.innerHTML = '';
        const currentWord = state.getCurrentWord(); // Use getter
        if (!currentWord) return;
        const guessed = state.getGuessedLetters(); // Use getter
        for (const letter of currentWord) {
            const letterBox = document.createElement('div'); letterBox.classList.add('letter-box');
            if (guessed.has(letter)) letterBox.textContent = letter;
            else { letterBox.textContent = ''; letterBox.classList.add('empty');}
            wordDisplayContainerEl.appendChild(letterBox);
        }
    }
    function updateGuessedLettersDisplay() { /* ... same ... */ 
        if (!correctLettersDisplayEl || !incorrectLettersDisplayEl) return;
        const correctArr = [], incorrectArr = [];
        const guessed = state.getGuessedLetters(); // Use getter
        const currentWord = state.getCurrentWord(); // Use getter
        const sortedGuessedLetters = Array.from(guessed).sort((a,b)=>a.localeCompare(b,'es'));
        for (const letter of sortedGuessedLetters) {
            if (currentWord?.includes(letter)) correctArr.push(letter); else incorrectArr.push(letter);
        }
        correctLettersDisplayEl.textContent = correctArr.join(', ') || 'Ninguna';
        incorrectLettersDisplayEl.textContent = incorrectArr.join(', ') || 'Ninguna';
    }
    function updateDifficultyButtonUI() { /* ... same ... */ difficultyButtons.forEach(b => b.classList.toggle('active', b.dataset.difficulty === state.getCurrentDifficulty())); } // Use getter
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
        const players = state.getPlayersData(); // Use getter
        if (!players || players.length === 0) return;
        players.forEach(player => {
            const card = document.createElement('div'); card.className = 'player-score-card'; card.style.borderColor = player.color;
            const nameSpan = document.createElement('span'); nameSpan.className = 'name'; nameSpan.textContent = `${player.icon} ${player.name}: `;
            const scoreSpan = document.createElement('span'); scoreSpan.className = 'score'; scoreSpan.textContent = player.score;
            card.append(nameSpan, scoreSpan); scoreDisplayAreaEl.appendChild(card);
        });
    }
     function updateCurrentPlayerTurnUI() { /* ... same ... */ 
        if (!currentPlayerTurnDisplaySpan) return;
        const players = state.getPlayersData(); // Use getter
        const currentPId = state.getCurrentPlayerId(); // Use getter
        if (!state.getGameActive() || !players.length) { currentPlayerTurnDisplaySpan.textContent = '-'; return; }
        const currentPlayer = players.find(p => p.id === currentPId);
        if (currentPlayer) {
            let turnText = `${currentPlayer.icon} ${currentPlayer.name}`;
            if (state.getPvpRemoteActive()) { // Use getter
                turnText = (currentPlayer.id === state.getNetworkRoomData().myPlayerIdInRoom) ? `✅ ${turnText} (Tu Turno)` : `⏳ ${turnText}`;
            }
            currentPlayerTurnDisplaySpan.textContent = turnText;
        } else { currentPlayerTurnDisplaySpan.textContent = "Esperando..."; }
    }

    function createAlphabetKeyboard(isMyTurnCurrently = true) {
        if (!alphabetKeyboardContainerEl) return;
        alphabetKeyboardContainerEl.innerHTML = '';
        const guessed = state.getGuessedLetters(); // Use getter
        const gameIsActive = state.getGameActive(); // Use getter
        state.ALPHABET.forEach(letter => {
            const button = document.createElement('button');
            button.classList.add('alphabet-button'); button.textContent = letter; button.dataset.letter = letter;
            button.disabled = !isMyTurnCurrently || guessed.has(letter) || !gameIsActive;
            button.addEventListener('click', () => handleLetterClickUI(letter, button));
            alphabetKeyboardContainerEl.appendChild(button);
        });
    }
    
    function updateAllAlphabetButtons(disableCompletely) {
        if (!alphabetKeyboardContainerEl) return;
        const guessed = state.getGuessedLetters(); // Use getter
        const gameIsActive = state.getGameActive(); // Use getter
        alphabetKeyboardContainerEl.querySelectorAll('.alphabet-button').forEach(button => {
            const letter = button.dataset.letter;
            if (disableCompletely) button.disabled = true;
            else button.disabled = guessed.has(letter) || !gameIsActive;
        });
    }

    // MODIFIED updateAlphabetEnablement as per your RCA
    function updateAlphabetEnablement() {
        if (!state.getGameActive()) { // Use getter
            // If game not active, could create disabled keyboard or just disable all
            createAlphabetKeyboard(false); // Create disabled
            return;
        }
        const myTurnInNetwork = state.getPvpRemoteActive() ? 
                           (state.getNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) : 
                           true; // In local game, if active, it's effectively "my turn" to interact
        createAlphabetKeyboard(myTurnInNetwork); // Recreate keyboard with correct enabled states
    }

    function setupGameBoardUI(isMyTurnCurrently) {
        createAlphabetKeyboard(isMyTurnCurrently); 
        updateWordDisplay(); updateStarsDisplay(); updateGuessedLettersDisplay();
        updateScoreDisplayUI(); updateCurrentPlayerTurnUI(); 
        // updateDifficultyButtonUI(); // Difficulty doesn't change mid-game

        if(clueButtonEl) {
            clueButtonEl.style.display = 'inline-block';
            clueButtonEl.disabled = state.getClueUsedThisGame() || !state.getGameActive() || !isMyTurnCurrently; // Use getters
        }
        if(clueDisplayAreaEl) clueDisplayAreaEl.style.display = state.getClueUsedThisGame() ? 'block' : 'none'; // Use getter
        if(clueTextEl && state.getClueUsedThisGame()) clueTextEl.textContent = state.getCurrentWordObject()?.definition || ""; // Use getter
    }

    function startLocalGameUI() {
        stopConfetti(); stopAnyActiveGameOrNetworkSession(true); state.setPvpRemoteActive(false);
        state.setPlayersData([{ id: 0, name: "Jugador", icon: "✏️", color: state.DEFAULT_PLAYER_COLORS[0], score: 0 }]);
        state.setCurrentPlayerId(0); 
        const initState = logic.initializeGame(state, state.getCurrentDifficulty()); // Use getter for difficulty
        if (!initState.success) { showModal(initState.message || "No se pudo iniciar juego local."); return; }
        setupGameBoardUI(true); showScreen('game');
        displayMessage("Haz clic en una letra para adivinar...", 'info', true);
    }

    function handleLetterClickUI(letter, buttonElement) {
        if (!state.getGameActive() || (buttonElement && buttonElement.disabled)) return; // Use getter
        triggerVibration(25); 
        if (state.getPvpRemoteActive()) { // Use getter
            if (state.getNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) { // Use getters
                if(buttonElement) buttonElement.disabled = true; peerConnection.sendGuessToHost(letter);
            } else displayMessage("No es tu turno.", 'error');
            return;
        }
        if(buttonElement) buttonElement.disabled = true;
        const result = logic.processGuess(letter); // gameLogic.processGuess now uses global state
        updateStarsDisplay(); updateWordDisplay(); updateGuessedLettersDisplay();
        if (result.correct) {
            displayMessage(`¡Muy bien! '${result.letter}' está en la palabra. 👍`, 'success');
            if (result.wordSolved) endGameUI(true);
        } else {
            displayMessage(`'${result.letter}' no está. ¡Pierdes una ${state.STAR_SYMBOL}!`, 'error');
            if (result.gameOver) endGameUI(false);
        }
        updateCurrentPlayerTurnUI(); 
        updateAlphabetEnablement(); // Re-enable/disable letters based on current state after guess
    }

    function handleClueRequestUI() {
        if (!state.getGameActive() || state.getClueUsedThisGame() || // Use getters
            (state.getPvpRemoteActive() && state.getNetworkRoomData().myPlayerIdInRoom !== state.getCurrentPlayerId()) ) {
            if (state.getPvpRemoteActive() && state.getNetworkRoomData().myPlayerIdInRoom !== state.getCurrentPlayerId()) displayMessage("No es tu turno para pedir pista.", "error");
            return;
        }
        triggerVibration(40);
        if (state.getPvpRemoteActive()) { peerConnection.sendClueRequestToHost(); return; } // Use getter
        const clueResult = logic.requestClue(state); 
        if (clueResult.success) {
            if(clueTextEl) clueTextEl.textContent = clueResult.clue;
            if(clueDisplayAreaEl) clueDisplayAreaEl.style.display = 'block';
            if(clueButtonEl) clueButtonEl.disabled = true;
            displayMessage("¡Pista revelada!", 'info');
        } else { displayMessage(clueResult.message || "No se pudo obtener la pista.", 'error'); }
    }

    function endGameUI(isWin) {
        updateAllAlphabetButtons(true); if(clueButtonEl) clueButtonEl.disabled = true; // updateAllAlphabetButtons used as per RCA structure for end
        if(playAgainButtonEl) playAgainButtonEl.style.display = 'inline-block';
        if(mainMenuButtonEl) mainMenuButtonEl.style.display = 'inline-block';
        let finalMessage = ""; const wordObject = state.getCurrentWordObject(); // Use getter
        if (isWin) {
            finalMessage = `¡GANASTE! 🎉 La palabra era: ${wordObject.word}`;
            displayMessage(finalMessage, 'success', true); triggerVibration([100, 40, 100, 40, 200]); startConfetti();
        } else {
            if (wordObject?.word) {
                for(const letter of state.getCurrentWord()) { state.getGuessedLetters().add(letter); } // This modification won't persist due to getGuessedLetters() returning a copy. State modification must use setter.
                // Correct way to reveal word in state for display:
                const finalGuessed = state.getGuessedLetters();
                for(const letter of state.getCurrentWord()) { finalGuessed.add(letter); }
                state.setGuessedLetters(finalGuessed); // Update state with all letters guessed

                updateWordDisplay(); finalMessage = `¡Oh no! 😢 La palabra era: ${wordObject.word}`;
            } else { finalMessage = `¡Oh no! 😢 Intenta de nuevo.`; }
            displayMessage(finalMessage, 'error', true); triggerVibration([70,50,70]);
        }
    }
    function returnToMainMenuUI() { stopConfetti(); stopAnyActiveGameOrNetworkSession(); }
    function stopAnyActiveGameOrNetworkSession(preserveUIScreen = false) { /* ... same, calls state.resetFullLocalStateForNewUIScreen ... */ 
        console.log("[Main] stopAnyActiveGameOrNetworkSession. Preserve UI:", preserveUIScreen);
        const wasPvpActive = state.getPvpRemoteActive();
        if (state.getGameActive()) state.setGameActive(false); 
        if (wasPvpActive) {
            peerConnection.closeAllConnectionsAndSession(); 
            if (state.getNetworkRoomData().roomState === 'seeking_match' && state.getMyPeerId()) matchmaking.leaveQueue(state.getMyPeerId());
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
    async function hostGameUI() { /* ... same, uses state.getCurrentDifficulty ... */ 
        stopAnyActiveGameOrNetworkSession(true); showModal("Creando tu sala de Pizarra..."); triggerVibration(50);
        const hostPlayerData = getPlayerCustomizationDataFromUI(); 
        const gameSettings = { difficulty: state.getCurrentDifficulty(), maxPlayers: parseInt(networkMaxPlayersSelect.value) || 2 };
        try {
            const hostPeerId = await peerConnection.hostNewRoom(hostPlayerData, gameSettings);
            hideModal(); 
            window.pizarraUiUpdateCallbacks.showLobby(true); 
            if (matchmaking?.updateHostedRoomStatus && hostPeerId) {
                 matchmaking.updateHostedRoomStatus(hostPeerId, state.getNetworkRoomData().gameSettings, state.getNetworkRoomData().maxPlayers, state.getNetworkRoomData().players.length, 'hosting_waiting_for_players');
            }
        } catch (error) {
            hideModal(); showModal(`Error al crear la sala: ${error.message || 'Desconocido'}.`);
            stopAnyActiveGameOrNetworkSession(true); showScreen('networkSetup');
        }
    }
    function displayRoomQRCodeAndLink(roomId, maxPlayers) { /* ... same, uses state.PIZARRA_PEER_ID_PREFIX ... */ 
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
        if(networkInfoAreaEl && state.getNetworkRoomData().isRoomLeader) networkInfoAreaEl.style.display = 'block'; // Use getter
    }
    function hideNetworkInfoArea() { /* ... same ... */ if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none';}
    async function joinRandomGameUI() { /* ... same, uses state.getCurrentDifficulty ... */ 
        stopAnyActiveGameOrNetworkSession(true); showModal("Buscando una sala al azar..."); triggerVibration(50); state.setPvpRemoteActive(true);
        const myPlayerData = getPlayerCustomizationDataFromUI(); 
        const preferences = { maxPlayers: parseInt(networkMaxPlayersSelect.value) || 2, gameSettings: { difficulty: state.getCurrentDifficulty() } }; // Use getter
        try {
            const localRawPeerId = await peerConnection.ensurePeerInitialized();
            if (!localRawPeerId) throw new Error("No se pudo obtener ID de PeerJS.");
            matchmaking.joinQueue(localRawPeerId, myPlayerData, preferences, {
                onSearching: () => { /* ... */ },
                onMatchFoundAndJoiningRoom: async (leaderRawPeerIdToJoin, roomDetails) => { /* ... */ },
                onMatchFoundAndHostingRoom: async (myNewRawPeerIdForHosting, initialHostData) => { /* ... */ },
                onError: (errMsg) => { /* ... */ }
            });
        } catch (initError) { /* ... */ }
    }
    function updateLobbyUI() { /* ... same, uses state.getNetworkRoomData(), state.getMyPeerId() ... */ 
        if (!lobbyAreaEl || !state.getPvpRemoteActive() || !state.getNetworkRoomData()) return;
        const roomData = state.getNetworkRoomData();
        // ... rest of updateLobbyUI, ensuring all state reads use getters ...
        if (lobbyRoomIdDisplayEl) lobbyRoomIdDisplayEl.textContent = roomData.roomId ? `${state.PIZARRA_PEER_ID_PREFIX}${roomData.roomId}` : 'N/A';
        if (lobbyDifficultyDisplayEl) lobbyDifficultyDisplayEl.textContent = roomData.gameSettings.difficulty || 'No def.';
        if (lobbyPlayerCountDisplayEl) lobbyPlayerCountDisplayEl.textContent = `${roomData.players.length}/${roomData.maxPlayers}`;
        if (lobbyPlayerListEl) {
            lobbyPlayerListEl.innerHTML = '';
            roomData.players.sort((a,b)=>a.id - b.id).forEach(player => {
                const card = document.createElement('div'); card.className = 'player-lobby-card'; card.style.borderLeftColor = player.color;
                const iconSpan = document.createElement('span'); iconSpan.className = 'icon'; iconSpan.textContent = player.icon;
                const nameSpan = document.createElement('span'); nameSpan.className = 'name';
                nameSpan.textContent = player.name + (player.peerId === state.getMyPeerId() ? " (Vos)" : "") + (player.peerId === roomData.leaderPeerId ? " 👑" : "");
                const statusSpan = document.createElement('span'); statusSpan.className = 'status';
                statusSpan.textContent = player.isConnected === false ? "Desconectado" : (player.isReady ? "Listo ✔️" : "Esperando...");
                statusSpan.classList.add(player.isConnected === false ? 'disconnected' : (player.isReady ? 'ready' : 'not-ready'));
                card.append(iconSpan, nameSpan, statusSpan); lobbyPlayerListEl.appendChild(card);
            });
        }
        if (lobbyToggleReadyButtonEl) {
            const myPlayer = roomData.players.find(p => p.peerId === state.getMyPeerId());
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

    // --- Global UI Callbacks for PeerConnection & Matchmaking ---
    window.pizarraUiUpdateCallbacks = {
        showLobby: (isHost) => { hideModal(); showScreen('lobby'); updateLobbyUI(); if (isHost) displayRoomQRCodeAndLink(state.getNetworkRoomData().roomId, state.getNetworkRoomData().maxPlayers); else hideNetworkInfoArea(); },
        updateLobby: updateLobbyUI,
        showNetworkError: (message, shouldReturnToSetup = false) => { showModal(message); if (shouldReturnToSetup) stopAnyActiveGameOrNetworkSession(); },
        
        // MODIFIED startGameOnNetwork as per your RCA
        startGameOnNetwork: (initialGameState) => {
            console.log('[Main] startGameOnNetwork received initialGameState:', initialGameState);
            hideModal(); hideNetworkInfoArea(); stopConfetti();
            
            // 1. Persist player metadata FIRST – ensures array lengths match for attempts.
            state.setPlayersData(initialGameState.playersInGameOrder); // This calls state.initRemainingAttempts

            // 2. Now copy the exact attempts array sent by the host.
            if (initialGameState.remainingAttemptsPerPlayer) {
                state.setRemainingAttemptsPerPlayer(initialGameState.remainingAttemptsPerPlayer);
            } else {
                // Fallback if host didn't send this specific array, rely on initRemainingAttempts from setPlayersData
                console.warn("[Main] Host did not send remainingAttemptsPerPlayer in initialGameState, relying on default initialization.");
            }

            // 3. Copy the rest of the per-turn state.
            state.setCurrentDifficulty(initialGameState.gameSettings.difficulty);
            state.setCurrentWordObject(initialGameState.currentWordObject); // This sets normalized state.currentWord
            state.setGuessedLetters(new Set(initialGameState.guessedLetters || []));
            state.setCurrentPlayerId(initialGameState.startingPlayerId); // Use getter in state.js setCurrentPlayerID
            state.setClueUsedThisGame(initialGameState.clueUsed || false);
            state.setGameActive(true); // Mark game as active
            state.setGamePhase('playing'); // Use setter

            // 4. Render everything.
            // The user's RCA mentioned ui.renderFullGameBoard(). If that function exists in a pizarraUi.js, it would go here.
            // For now, we call existing functions that achieve this:
            const isMyTurn = state.getNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId(); // Use getters
            setupGameBoardUI(isMyTurn); // This updates word, stars, alphabet, scores, turn display

            showScreen('game');
            displayMessage("¡El juego en red ha comenzado!", 'info', true);
            
            // Call sound.playGameStart() if pizarraSound.js and function exist
            if (sound && typeof sound.playGameStart === 'function') {
                sound.playGameStart();
            } else {
                // console.log("Placeholder: sound.playGameStart() would be called here.");
            }
        },
        
        // MODIFIED updateGameFromNetwork as per your RCA
        updateGameFromNetwork: (guessResultPayload) => { // guessResultPayload is the full result from gameLogic.processGuess via host
            console.log('[Main] updateGameFromNetwork received payload:', guessResultPayload);
            // pizarraPeerConnection.js (client side) already updated:
            // state.setGuessedLetters, state.remainingAttemptsPerPlayer[affectedPid], state.setCurrentPlayerId, state.setGameActive
            
            updateStarsDisplay();        // Uses new state.getAttemptsFor(myPlayerIdInRoom for network)
            updateAlphabetEnablement();   // Uses new state.currentPlayerId to enable/disable

            // Other UI updates based on the comprehensive state
            updateWordDisplay();
            updateGuessedLettersDisplay();
            updateScoreDisplayUI(); // Scores should have been updated in state by peerConnection
            updateCurrentPlayerTurnUI();

            const { letter, correct, gameOver, wordSolved } = guessResultPayload; // Use destructured letter and correct from payload
            displayMessage(correct ? `'${letter}' es CORRECTA.` : `'${letter}' es INCORRECTA.`, correct ? 'success' : 'error');

            if (gameOver) { // gameLogic.processGuess now includes gameOver
                // The GAME_OVER_ANNOUNCEMENT message from host will trigger the actual end game modal & confetti
                // This callback might just disable input if game is over before announcement.
                state.setGameActive(false); // Ensure it's marked inactive
                updateAlphabetEnablement();   // Ensure alphabet is disabled
            }
        },
        displayClueFromNetwork: (clueData) => { /* ... same as before, ensure state.setRemainingAttemptsPerPlayer if clue costs ... */ 
            state.setClueUsedThisGame(clueData.clueUsed);
            if (clueData.remainingAttemptsPerPlayer) { 
                state.setRemainingAttemptsPerPlayer(clueData.remainingAttemptsPerPlayer); 
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
                 isWinForLocalPlayer = gameOverData.winnerData.winners.some(w => w.id === state.getNetworkRoomData().myPlayerIdInRoom); // Use getter
                 if(gameOverData.winnerData.isTie && winners) { message += ` ¡Empate entre ${winners}!`; isWinForLocalPlayer = true; }
                 else if (winners) message += ` ¡Ganador(es): ${winners}!`;
            }
            if(gameOverData.finalScores) {
                gameOverData.finalScores.forEach(ps => { const pLocal = state.getPlayersData().find(p => p.id === ps.id); if(pLocal) pLocal.score = ps.score; }); // Use getter
                updateScoreDisplayUI();
            }
            showModal(message, [{text: "Volver al Menú", action: () => { stopConfetti(); returnToMainMenuUI();}, className: 'action-button'}]);
            if (isWinForLocalPlayer) { triggerVibration([100, 40, 100, 40, 200]); startConfetti(); }
            else { triggerVibration([70,50,70]); }
        }
    };

    function initializeAppEventListeners() { /* ... same as your last full main.js ... */ 
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
            if (state.getPvpRemoteActive()) showModal("Jugar otra vez en red no implementado. Volviendo al menú.", [{text: "OK", action: returnToMainMenuUI}]); // Use getter
            else startLocalGameUI();
        });
        if(mainMenuButtonEl) mainMenuButtonEl.addEventListener('click', () => { stopConfetti(); returnToMainMenuUI(); });
        if(hostGameButton) hostGameButton.addEventListener('click', hostGameUI);
        if(joinRandomButton) joinRandomButton.addEventListener('click', joinRandomGameUI);
        if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.addEventListener('click', () => {
            if(state.getMyPeerId()) matchmaking.leaveQueue(state.getMyPeerId());  // Use getter
            stopAnyActiveGameOrNetworkSession(true); showScreen('networkSetup'); displayMessage("Búsqueda cancelada.", "info");
        });
        if(lobbyToggleReadyButtonEl) lobbyToggleReadyButtonEl.addEventListener('click', () => {
            const myPlayer = state.getNetworkRoomData().players.find(p => p.peerId === state.getMyPeerId()); // Use getters
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

    function initializeApp() { /* ... same as your last full main.js ... */ 
        initializeAppEventListeners();
        if (typeof DICTIONARY_DATA !== 'undefined' && DICTIONARY_DATA.length > 0) {
            populatePlayerIcons(); updateDifficultyButtonUI(); returnToMainMenuUI();
        } else { showModal("Error Crítico: Diccionario no cargado."); }
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