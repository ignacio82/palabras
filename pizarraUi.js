// pizarraUi.js
import * as state from './pizarraState.js';
import { normalizeLetter as normalizeGameLetter } from './util.js'; // Import and alias normalizeLetter

// --- DOM Element References (fetched once) ---
let localGameSetupSection, networkGameSetupSection, gameAreaEl, lobbyAreaEl, networkInfoAreaEl;
let starsDisplayEl, currentPlayerTurnDisplaySpan, clueButtonEl, clueDisplayAreaEl, clueTextEl;
let messageAreaEl, wordDisplayContainerEl, alphabetKeyboardContainerEl;
let incorrectLettersDisplayEl, correctLettersDisplayEl, scoreDisplayAreaEl;
let playAgainButtonEl, mainMenuButtonEl, cancelMatchmakingButtonEl;
let difficultyButtons; // NodeList
let gameModeTabs; // NodeList

// Network UI
let networkPlayerNameInput, networkPlayerIconSelect, networkMaxPlayersSelect;
let networkInfoTitleEl, qrCodeContainerEl, networkInfoTextEl, copyRoomLinkButtonEl;
let lobbyRoomIdDisplayEl, lobbyDifficultyDisplayEl, lobbyPlayerCountDisplayEl, lobbyPlayerListEl, lobbyMessageAreaEl;
let lobbyToggleReadyButtonEl, lobbyStartGameLeaderButtonEl, lobbyLeaveRoomButtonEl;

// Modal UI
let customModalEl, modalMessageTextEl, modalCloseButtonEl, modalDynamicButtonsEl;

// Confetti
let confettiContainerEl;

let uiInitialized = false;
let currentMessageTimeout = null; // Store timeout for the main message area

export function initializeUiDOMReferences() {
    if (uiInitialized) return;

    localGameSetupSection = document.getElementById('local-game-setup-section');
    networkGameSetupSection = document.getElementById('network-game-setup-section');
    gameAreaEl = document.getElementById('game-area');
    lobbyAreaEl = document.getElementById('lobby-area');
    networkInfoAreaEl = document.getElementById('network-info-area');
    gameModeTabs = document.querySelectorAll('.tab-button');

    starsDisplayEl = document.getElementById('stars-display');
    currentPlayerTurnDisplaySpan = document.getElementById('current-player-turn-display')?.querySelector('span');
    clueButtonEl = document.getElementById('clue-button');
    clueDisplayAreaEl = document.getElementById('clue-display-area');
    clueTextEl = document.getElementById('clue-text');
    messageAreaEl = document.getElementById('message-area');
    wordDisplayContainerEl = document.getElementById('word-display-container');
    alphabetKeyboardContainerEl = document.getElementById('alphabet-keyboard-container');
    incorrectLettersDisplayEl = document.getElementById('incorrect-letters-display');
    correctLettersDisplayEl = document.getElementById('correct-letters-display');
    scoreDisplayAreaEl = document.getElementById('score-display-area');
    playAgainButtonEl = document.getElementById('play-again-button');
    mainMenuButtonEl = document.getElementById('main-menu-button');
    cancelMatchmakingButtonEl = document.getElementById('cancel-matchmaking-button');
    difficultyButtons = document.querySelectorAll('.difficulty-button');

    networkPlayerNameInput = document.getElementById('network-player-name');
    networkPlayerIconSelect = document.getElementById('network-player-icon');
    networkMaxPlayersSelect = document.getElementById('network-max-players');
    networkInfoTitleEl = document.getElementById('network-info-title');
    qrCodeContainerEl = document.getElementById('qr-code-container');
    networkInfoTextEl = document.getElementById('network-info-text');
    copyRoomLinkButtonEl = document.getElementById('copy-room-link-button');

    lobbyRoomIdDisplayEl = document.getElementById('lobby-room-id-display')?.querySelector('span');
    lobbyDifficultyDisplayEl = document.getElementById('lobby-difficulty-display');
    lobbyPlayerCountDisplayEl = document.getElementById('lobby-player-count-display');
    lobbyPlayerListEl = document.getElementById('lobby-player-list');
    lobbyMessageAreaEl = document.getElementById('lobby-message-area');
    lobbyToggleReadyButtonEl = document.getElementById('lobby-toggle-ready-button');
    lobbyStartGameLeaderButtonEl = document.getElementById('lobby-start-game-leader-button');
    lobbyLeaveRoomButtonEl = document.getElementById('lobby-leave-room-button');

    customModalEl = document.getElementById('custom-modal');
    modalMessageTextEl = document.getElementById('modal-message-text');
    modalCloseButtonEl = document.getElementById('modal-close-button');
    modalDynamicButtonsEl = document.getElementById('modal-dynamic-buttons');

    confettiContainerEl = document.getElementById('confetti-container');
    
    uiInitialized = true;
    console.log("[pizarraUi] DOM references initialized.");
}

// --- General UI Functions ---
export function displayMessage(text, type = 'info', persistent = false, area = messageAreaEl) {
    if (!area) { console.warn("displayMessage: Target area not found."); return; }
    if (currentMessageTimeout && area === messageAreaEl) clearTimeout(currentMessageTimeout);
    area.textContent = text;
    area.className = `message ${type}`;
    const defaultInstruction = "Haz clic en una letra para adivinar...";
    if (!persistent && area === messageAreaEl && gameAreaEl && gameAreaEl.style.display !== 'none') {
        currentMessageTimeout = setTimeout(() => {
            if (state.getGameActive() && area.textContent === text) displayMessage(defaultInstruction, 'info', false, area);
            else if (!state.getGameActive() && area.textContent === text && type !== 'success' && type !== 'error') { area.textContent = '\u00A0'; area.className = 'message';}
        }, 3000);
    }
}

export function showModal(messageOrHtml, buttonsConfig = null, isHtmlContent = false) {
    if (!customModalEl || !modalMessageTextEl || !modalCloseButtonEl || !modalDynamicButtonsEl) { console.error("Modal elements not found"); return; }
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
export function hideModal() { if (customModalEl) customModalEl.style.display = 'none'; }

export function showScreen(screenName) {
    if(!uiInitialized) initializeUiDOMReferences();
    const screens = { localSetup: localGameSetupSection, networkSetup: networkGameSetupSection, game: gameAreaEl, lobby: lobbyAreaEl, networkInfo: networkInfoAreaEl };
    for (const key in screens) if (screens[key]) screens[key].style.display = 'none';
    if(playAgainButtonEl) playAgainButtonEl.style.display = 'none';
    if(mainMenuButtonEl) mainMenuButtonEl.style.display = 'none';
    if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
    if (screens[screenName]) screens[screenName].style.display = 'block';
    else console.warn(`[pizarraUi] showScreen: Unknown screen name '${screenName}'`);
}

export function populatePlayerIcons(targetSelectElement) {
    if (!targetSelectElement) { console.warn("[pizarraUi] populatePlayerIcons: No target select element provided."); return; }
    targetSelectElement.innerHTML = ''; 
    state.AVAILABLE_ICONS.forEach(icon => {
        const option = document.createElement('option'); option.value = icon; option.textContent = icon; targetSelectElement.appendChild(option);
    });
    if (state.AVAILABLE_ICONS.length > 0) targetSelectElement.value = state.AVAILABLE_ICONS[0];
}

export function updateDifficultyButtonUI() {
    if (!difficultyButtons) return;
    difficultyButtons.forEach(button => button.classList.toggle('active', button.dataset.difficulty === state.getCurrentDifficulty()));
}

export function updateGameModeTabs(activeMode = 'local') {
    if (!gameModeTabs) return;
    gameModeTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.mode === activeMode));
}


// --- Game-Specific UI Functions ---
export function updateStarsDisplay() {
    if (!starsDisplayEl) return;
    let attemptsToShow = state.DEFAULT_ATTEMPTS_PER_PLAYER;
    let pidToShowAttemptsFor = state.getCurrentPlayerId(); // Default to current player

    if (state.getPvpRemoteActive()) {
        const myPlayerId = state.getNetworkRoomData().myPlayerIdInRoom;
        if (myPlayerId !== null && myPlayerId !== undefined) {
            pidToShowAttemptsFor = myPlayerId; // Show local player's stars in network game
        } else { // Not yet assigned an ID in the room, show for player 0 or default
            pidToShowAttemptsFor = 0;
        }
    }
    attemptsToShow = state.getAttemptsFor(pidToShowAttemptsFor);
    starsDisplayEl.textContent = state.STAR_SYMBOL.repeat(Math.max(0, attemptsToShow));
}

export function updateWordDisplay() {
    if (!wordDisplayContainerEl) return;
    wordDisplayContainerEl.innerHTML = '';
    const currentWord = state.getCurrentWord(); 
    if (!currentWord) return;
    
    const guessed = state.getGuessedLetters();
    // console.log(`[pizarraUi] updateWordDisplay: Word "${currentWord}", Guessed letters: [${Array.from(guessed).join(', ')}]`);
    
    for (const letter of currentWord) { // currentWord is already normalized (uppercase, no accents except Ñ)
        const letterBox = document.createElement('div'); 
        letterBox.classList.add('letter-box');
        
        // letter from currentWord is e.g. 'M', 'A', 'Ñ', 'O'
        // guessed letters are stored normalized (lowercase, e.g. 'm', 'a', 'ñ', 'o')
        const normalizedLetterFromWord = normalizeGameLetter(letter); // Ensure this matches how guessed letters are stored
        if (guessed.has(normalizedLetterFromWord)) {
            letterBox.textContent = letter.toUpperCase(); 
            // console.log(`[pizarraUi] updateWordDisplay: Showing letter "${letter}" (normalized: "${normalizedLetterFromWord}")`);
        } else { 
            letterBox.textContent = ''; 
            letterBox.classList.add('empty');
            // console.log(`[pizarraUi] updateWordDisplay: Hiding letter "${letter}" (normalized: "${normalizedLetterFromWord}")`);
        }
        wordDisplayContainerEl.appendChild(letterBox);
    }
}

export function updateGuessedLettersDisplay() {
    if (!correctLettersDisplayEl || !incorrectLettersDisplayEl) return;
    const correctArr = [], incorrectArr = [];
    const guessed = state.getGuessedLetters(); // Contains normalized, lowercase letters
    const currentWord = state.getCurrentWord(); // Contains normalized, uppercase letters
    const sortedGuessedLetters = Array.from(guessed).sort((a,b)=>a.localeCompare(b,'es'));
    
    // console.log(`[pizarraUi] updateGuessedLettersDisplay: Word "${currentWord}", Guessed: [${sortedGuessedLetters.join(', ')}]`);
    
    for (const guessedLetter of sortedGuessedLetters) { // guessedLetter is like 'a', 'm', 'ñ'
        // currentWord is 'MANO'. We need to check if normalized guessedLetter is in normalized currentWord.
        // Since currentWord is already normalized (uppercase), and guessedLetter is normalized (lowercase),
        // we can convert currentWord to lowercase for includes check.
        if (currentWord?.toLowerCase().includes(guessedLetter)) {
            correctArr.push(guessedLetter.toUpperCase());
        } else {
            incorrectArr.push(guessedLetter.toUpperCase());
        }
    }
    
    correctLettersDisplayEl.textContent = correctArr.join(', ') || 'Ninguna';
    incorrectLettersDisplayEl.textContent = incorrectArr.join(', ') || 'Ninguna';
    
    // console.log(`[pizarraUi] updateGuessedLettersDisplay: Correct: [${correctArr.join(', ')}], Incorrect: [${incorrectArr.join(', ')}]`);
}

export function createAlphabetKeyboard(isMyTurnCurrently, onLetterClickCallback) {
    if (!alphabetKeyboardContainerEl) return;
    alphabetKeyboardContainerEl.innerHTML = '';
    const guessed = state.getGuessedLetters(); // This is a Set of normalized (lowercase) letters
    const gameIsActive = state.getGameActive();
    
    // console.log("[pizarraUi] Creating alphabet keyboard. Game active:", gameIsActive, "My turn:", isMyTurnCurrently, "Guessed letters:", Array.from(guessed));
    
    state.ALPHABET.forEach(letter => { // letter here is uppercase, e.g., "A", "Ñ"
        const button = document.createElement('button');
        button.classList.add('alphabet-button'); 
        button.textContent = letter; 
        button.dataset.letter = letter; // Store the original uppercase letter for the callback
        
        // Normalize the button's letter for checking against the (already normalized) guessed set
        const normalizedButtonLetter = normalizeGameLetter(letter); // e.g., "m", "a", "ñ"
        const isGuessed = guessed.has(normalizedButtonLetter);
        
        const shouldDisable = !gameIsActive || !isMyTurnCurrently || isGuessed;
        
        button.disabled = shouldDisable;
        
        if (isGuessed) {
            button.classList.add('guessed'); // CSS will gray it out
        }
        
        button.addEventListener('click', () => {
            if (!button.disabled && typeof onLetterClickCallback === 'function') {
                // console.log("[pizarraUi] Letter clicked:", letter, "Button disabled:", button.disabled);
                onLetterClickCallback(letter, button); // Pass the original uppercase letter
            }
        });
        alphabetKeyboardContainerEl.appendChild(button);
    });
}

export function updateAllAlphabetButtons(disableCompletely) {
    if (!alphabetKeyboardContainerEl) return;
    const guessed = state.getGuessedLetters(); // Set of normalized (lowercase) letters
    const gameIsActive = state.getGameActive();
    alphabetKeyboardContainerEl.querySelectorAll('.alphabet-button').forEach(button => {
        const letterFromButton = button.dataset.letter; // Original uppercase letter (e.g., "A", "Ñ")
        const normalizedButtonLetter = normalizeGameLetter(letterFromButton); // Normalized (e.g., "a", "ñ")
        const isGuessed = guessed.has(normalizedButtonLetter);

        if (disableCompletely) {
            button.disabled = true;
        } else {
            // Disable if the game is not active OR if the letter has been guessed.
            // Turn logic is handled by createAlphabetKeyboard which is preferred.
            button.disabled = !gameIsActive || isGuessed;
        }
        
        if (isGuessed) {
            button.classList.add('guessed');
        } else {
            button.classList.remove('guessed');
        }
    });
}

export function updateAlphabetEnablement(onLetterClickCallback) { 
    if(!uiInitialized) initializeUiDOMReferences();
    if (!alphabetKeyboardContainerEl) return;
    if (!state.getGameActive()) { 
        createAlphabetKeyboard(false, onLetterClickCallback); 
        return; 
    }
    const myTurn = state.getPvpRemoteActive() ? 
                   (state.getNetworkRoomData().myPlayerIdInRoom === state.getCurrentPlayerId()) : 
                   true;
    createAlphabetKeyboard(myTurn, onLetterClickCallback);
}

export function updateScoreDisplayUI() {
    if (!scoreDisplayAreaEl) return; scoreDisplayAreaEl.innerHTML = '';
    const players = state.getPlayersData(); if (!players || players.length === 0) return;
    players.forEach(player => {
        const card = document.createElement('div'); card.className = 'player-score-card';
        card.style.borderColor = player.color || state.DEFAULT_PLAYER_COLORS[0];
        const nameSpan = document.createElement('span'); nameSpan.className = 'name'; nameSpan.textContent = `${player.icon || '❓'} ${player.name || 'Jugador'}: `;
        const scoreSpan = document.createElement('span'); scoreSpan.className = 'score'; scoreSpan.textContent = player.score !== undefined ? player.score : 0;
        card.append(nameSpan, scoreSpan); scoreDisplayAreaEl.appendChild(card);
    });
}

export function updateCurrentPlayerTurnUI() {
    if (!currentPlayerTurnDisplaySpan) return;
    const players = state.getPlayersData(); const currentPId = state.getCurrentPlayerId();
    if (!state.getGameActive() || !players.length) { currentPlayerTurnDisplaySpan.textContent = '-'; return; }
    const currentPlayer = players.find(p => p.id === currentPId);
    if (currentPlayer) {
        let turnText = `${currentPlayer.icon || '❓'} ${currentPlayer.name || 'Jugador'}`;
        if (state.getPvpRemoteActive()) {
            turnText = (currentPlayer.id === state.getNetworkRoomData().myPlayerIdInRoom) ? `✅ ${turnText} (Tu Turno)` : `⏳ ${turnText}`;
        }
        currentPlayerTurnDisplaySpan.textContent = turnText;
    } else { currentPlayerTurnDisplaySpan.textContent = "Esperando..."; }
}

export function renderFullGameBoard(isMyTurnCurrently, onLetterClickCallback) {
    if(!uiInitialized) initializeUiDOMReferences();
    // console.log("[pizarraUi] renderFullGameBoard called. Is my turn:", isMyTurnCurrently);
    updateWordDisplay();
    updateStarsDisplay();
    updateGuessedLettersDisplay();
    updateScoreDisplayUI();
    updateCurrentPlayerTurnUI();
    createAlphabetKeyboard(isMyTurnCurrently, onLetterClickCallback); 
    
    if(clueButtonEl) {
        clueButtonEl.style.display = 'inline-block';
        clueButtonEl.disabled = state.getClueUsedThisGame() || !state.getGameActive() || !isMyTurnCurrently;
    }
    if(clueDisplayAreaEl) clueDisplayAreaEl.style.display = state.getClueUsedThisGame() ? 'block' : 'none';
    if(clueTextEl && state.getClueUsedThisGame()) clueTextEl.textContent = state.getCurrentWordObject()?.definition || "";
}

export function displayClueOnUI(clueDefinition) { 
    if(!uiInitialized) initializeUiDOMReferences();
    if(clueTextEl) clueTextEl.textContent = clueDefinition;
    if(clueDisplayAreaEl) clueDisplayAreaEl.style.display = 'block';
    if(clueButtonEl) clueButtonEl.disabled = true;
}

export function toggleClueButtonUI(enabled, show = true) {
    if (clueButtonEl) {
        clueButtonEl.disabled = !enabled;
        clueButtonEl.style.display = show ? 'inline-block' : 'none';
    }
}

// --- Confetti UI Functions ---
const confettiColors = ["#FF69B4", "#00BFFF", "#FFD700", "#32CD32", "#FF7F50", "#DA70D6", "#f0f0f0", "#fffacd"];
export function createConfettiPiece() {
    if (!confettiContainerEl) { if(uiInitialized) console.warn("Confetti container not found"); return;}
    const piece = document.createElement('div'); piece.classList.add('confetti-piece');
    piece.style.backgroundColor = confettiColors[Math.floor(Math.random() * confettiColors.length)];
    piece.style.left = Math.random() * window.innerWidth + 'px';
    const randomDrift = Math.random() * 2 - 1; piece.style.setProperty('--drift', randomDrift.toString());
    const fallDuration = Math.random() * 3 + 4; piece.style.animationDuration = fallDuration + 's';
    piece.style.animationDelay = Math.random() * 0.5 + 's';
    confettiContainerEl.appendChild(piece);
    setTimeout(() => piece.remove(), (fallDuration + 1.5) * 1000);
}
export function startConfetti(numberOfPieces = 120) {
    if (!confettiContainerEl) { if(uiInitialized) initializeUiDOMReferences(); if (!confettiContainerEl) return;}
    stopConfetti(); for (let i = 0; i < numberOfPieces; i++) setTimeout(createConfettiPiece, i * 25);
}
export function stopConfetti() { if (confettiContainerEl) confettiContainerEl.innerHTML = ''; }

// --- Network/Lobby UI Functions ---
export function updateLobbyUI() {
    if(!uiInitialized) initializeUiDOMReferences();
    if (!lobbyAreaEl || !state.getPvpRemoteActive()) return;
    const roomData = state.getNetworkRoomData();
    if (!roomData) return;

    if (lobbyRoomIdDisplayEl) lobbyRoomIdDisplayEl.textContent = roomData.roomId ? `${state.PIZARRA_PEER_ID_PREFIX}${roomData.roomId}` : 'N/A';
    if (lobbyDifficultyDisplayEl) lobbyDifficultyDisplayEl.textContent = roomData.gameSettings?.difficulty || 'No definida';
    if (lobbyPlayerCountDisplayEl) lobbyPlayerCountDisplayEl.textContent = `${roomData.players?.length || 0}/${roomData.maxPlayers || 'N/A'}`;
    
    if (lobbyPlayerListEl && roomData.players) {
        lobbyPlayerListEl.innerHTML = '';
        roomData.players.sort((a,b)=> (a.id === undefined ? Infinity : a.id) - (b.id === undefined ? Infinity : b.id) ).forEach(player => {
            const card = document.createElement('div'); card.className = 'player-lobby-card';
            card.style.borderLeftColor = player.color || state.DEFAULT_PLAYER_COLORS[0];
            const iconSpan = document.createElement('span'); iconSpan.className = 'icon'; iconSpan.textContent = player.icon || '❓';
            const nameSpan = document.createElement('span'); nameSpan.className = 'name';
            nameSpan.textContent = (player.name || `Jugador ${player.id === undefined ? '?' : player.id +1}`) +
                                 (player.peerId === state.getMyPeerId() ? " (Vos)" : "") +
                                 (player.peerId === roomData.leaderPeerId ? " 👑" : "");
            const statusSpan = document.createElement('span'); statusSpan.className = 'status';
            statusSpan.textContent = player.isConnected === false ? "Desconectado" : (player.isReady ? "Listo ✔️" : "Esperando...");
            statusSpan.classList.add(player.isConnected === false ? 'disconnected' : (player.isReady ? 'ready' : 'not-ready'));
            card.append(iconSpan, nameSpan, statusSpan); lobbyPlayerListEl.appendChild(card);
        });
    }

    if (lobbyToggleReadyButtonEl) {
        const myPlayer = roomData.players?.find(p => p.peerId === state.getMyPeerId());
        if (myPlayer) {
            lobbyToggleReadyButtonEl.textContent = myPlayer.isReady ? "❌ No Listo" : "👍 Marcar Listo";
            lobbyToggleReadyButtonEl.classList.toggle('action-button-danger', myPlayer.isReady);
            lobbyToggleReadyButtonEl.classList.toggle('action-button-confirm', !myPlayer.isReady);
        }
        lobbyToggleReadyButtonEl.disabled = roomData.roomState === 'in_game';
    }
    if (lobbyStartGameLeaderButtonEl) {
        lobbyStartGameLeaderButtonEl.style.display = roomData.isRoomLeader && roomData.roomState !== 'in_game' ? 'inline-block' : 'none';
        const canStart = roomData.players?.length >= state.MIN_PLAYERS_NETWORK && roomData.players.every(p => p.isReady && p.isConnected !== false);
        lobbyStartGameLeaderButtonEl.disabled = !canStart;
    }
    if(lobbyMessageAreaEl && lobbyMessageAreaEl.textContent.includes("Esperando jugadores...") && roomData.players?.length >= roomData.maxPlayers) {
        displayMessage("Sala llena. ¡Listos para empezar!", "info", true, lobbyMessageAreaEl);
    } else if (lobbyMessageAreaEl && (!lobbyMessageAreaEl.textContent.includes("copiado") && !lobbyMessageAreaEl.textContent.includes("Sala llena"))) {
         displayMessage("Esperando jugadores...", "info", true, lobbyMessageAreaEl);
    }
}

export function displayRoomQRCodeAndLink(roomId, maxPlayers, baseShareUrl = "https://palabras.martinez.fyi", peerIdPrefix = state.PIZARRA_PEER_ID_PREFIX) {
    if(!uiInitialized) initializeUiDOMReferences();
    if (!networkInfoAreaEl || !networkInfoTitleEl || !networkInfoTextEl || !qrCodeContainerEl || !copyRoomLinkButtonEl) return;
    const gameLink = `${baseShareUrl}?room=${roomId}`; 
    networkInfoTitleEl.textContent = "¡Sala Lista! Invita Jugadores";
    networkInfoTextEl.innerHTML = `ID de Sala: <strong>${peerIdPrefix}${roomId}</strong><br>Enlace: <a href="${gameLink}" target="_blank" class="underline hover:text-pink-400">${gameLink}</a>`;
    qrCodeContainerEl.innerHTML = '';
    if (window.QRious) {
        const canvas = document.createElement('canvas');
        try {
            new QRious({ element: canvas, value: gameLink, size: 128, padding: 5, level: 'M', foreground: '#f0f0f0', background: '#4a4e4a' });
            qrCodeContainerEl.appendChild(canvas);
        } catch (e) { console.error("QRious error:", e); qrCodeContainerEl.textContent = "Error QR"; }
    } else { qrCodeContainerEl.textContent = "QR no disponible."; }
    // copyRoomLinkButtonEl listener is set in main.js
    if(networkInfoAreaEl && state.getNetworkRoomData()?.isRoomLeader) networkInfoAreaEl.style.display = 'block';
}

export function hideNetworkInfoArea() { if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none'; }