// pizarraUi.js - Fixed for mobile, network mode, and easy mode clue display
import * as state from './pizarraState.js';
import { normalizeLetter as normalizeGameLetter } from './util.js';

// --- DOM Element References (fetched once) ---
let localGameSetupSection, networkGameSetupSection, gameAreaEl, lobbyAreaEl, networkInfoAreaEl;
let gameModeSelectionSection;
let starsDisplayEl, currentPlayerTurnDisplaySpan, clueButtonEl, clueDisplayAreaEl, clueTextEl;
let messageAreaEl, wordDisplayContainerEl, alphabetKeyboardContainerEl;
let incorrectLettersDisplayEl, correctLettersDisplayEl, scoreDisplayAreaEl;
let playAgainButtonEl, mainMenuButtonEl, cancelMatchmakingButtonEl;
let difficultyButtons;
let gameModeTabs;

// Network UI
let networkPlayerNameInput, networkPlayerIconSelect, networkMaxPlayersSelect;
let networkInfoTitleEl, qrCodeContainerEl, networkInfoTextEl, copyRoomLinkButtonEl;
let lobbyRoomIdDisplayEl, lobbyDifficultyDisplayEl, lobbyPlayerCountDisplayEl, lobbyPlayerListEl, lobbyMessageAreaEl;
let lobbyToggleReadyButtonEl, lobbyStartGameLeaderButtonEl, lobbyLeaveRoomButtonEl;

// Modal UI
let customModalEl, modalMainContentAreaEl, modalCloseButtonEl, modalDynamicButtonsEl;

// Confetti
let confettiContainerEl;

let uiInitialized = false;
let currentMessageTimeout = null;

// QWERTY layout for the keyboard
const QWERTY_LAYOUT = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ñ'],
    ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
];

export function initializeUiDOMReferences() {
    if (uiInitialized) return;

    gameModeSelectionSection = document.getElementById('game-mode-selection-section');
    localGameSetupSection = document.getElementById('local-game-setup-section');
    networkGameSetupSection = document.getElementById('network-game-setup-section');
    gameAreaEl = document.getElementById('app');
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
    modalMainContentAreaEl = document.getElementById('modal-main-content-area');
    modalCloseButtonEl = document.getElementById('modal-close-button');
    modalDynamicButtonsEl = document.getElementById('modal-dynamic-buttons');

    confettiContainerEl = document.getElementById('confetti-container');
    
    uiInitialized = true;
}

// --- General UI Functions ---
export function displayMessage(text, type = 'info', persistent = false, area = messageAreaEl) {
    if (!area) { return; }
    if (currentMessageTimeout && area === messageAreaEl) clearTimeout(currentMessageTimeout);
    area.textContent = text;
    area.className = `message ${type}`;
    
    if (!persistent && area === messageAreaEl && gameAreaEl && gameAreaEl.style.display !== 'none') {
        currentMessageTimeout = setTimeout(() => {
            if (area.textContent === text) {
                if (state.getGameActive() && (type === 'info' || type === '')) {
                    area.textContent = '\u00A0';
                    area.className = 'message';
                } else if (!state.getGameActive() && type !== 'success' && type !== 'error') {
                    area.textContent = '\u00A0';
                    area.className = 'message';
                }
            }
        }, 3000);
    }
}

export function showModal(messageOrHtml, buttonsConfig = null, isHtmlContent = false) {
    if (!customModalEl || !modalMainContentAreaEl || !modalCloseButtonEl || !modalDynamicButtonsEl) {
        console.error("Modal elements not found.");
        return;
    }
    if (isHtmlContent) {
        modalMainContentAreaEl.innerHTML = messageOrHtml;
    } else {
        modalMainContentAreaEl.textContent = messageOrHtml;
    }
    
    modalDynamicButtonsEl.innerHTML = '';
    if (buttonsConfig?.length > 0) {
        modalCloseButtonEl.style.display = 'none';
        modalDynamicButtonsEl.style.display = 'flex';
        buttonsConfig.forEach(btnConfig => {
            const button = document.createElement('button');
            button.textContent = btnConfig.text;
            button.className = btnConfig.className || 'action-button-secondary';
            button.addEventListener('click', (event) => {
                if (typeof btnConfig.action === 'function') {
                    btnConfig.action(event);
                }
            });
            modalDynamicButtonsEl.appendChild(button);
        });
    } else {
        modalCloseButtonEl.style.display = 'inline-block';
        modalDynamicButtonsEl.style.display = 'none';
    }
    customModalEl.style.display = 'flex';
}
export function hideModal() { if (customModalEl) customModalEl.style.display = 'none'; }

export function showScreen(screenName) {
    if(!uiInitialized) initializeUiDOMReferences();
    const screens = {
        localSetup: localGameSetupSection,
        networkSetup: networkGameSetupSection,
        game: gameAreaEl,
        lobby: lobbyAreaEl,
        networkInfo: networkInfoAreaEl
    };
    
    for (const key in screens) if (screens[key]) screens[key].style.display = 'none';
    
    if(playAgainButtonEl) playAgainButtonEl.style.display = 'none';
    if(mainMenuButtonEl) mainMenuButtonEl.style.display = 'none';
    if(cancelMatchmakingButtonEl) cancelMatchmakingButtonEl.style.display = 'none';
    
    if (gameModeSelectionSection) {
        // Hide game mode selection when in game, lobby, or network info screen
        if (screenName === 'game' || screenName === 'lobby' || screenName === 'networkInfo') {
            gameModeSelectionSection.style.display = 'none';
        } else {
            // Show game mode selection for localSetup and networkSetup
            gameModeSelectionSection.style.display = 'block';
        }
    }
    
    if (screens[screenName]) {
        // Ensure setup-container is visible for setup screens and lobby
        const setupContainer = document.getElementById('setup-container');
        if (setupContainer) {
            if (screenName === 'localSetup' || screenName === 'networkSetup' || screenName === 'lobby' || screenName === 'networkInfo') {
                setupContainer.style.display = 'flex'; // Use flex for centering
            } else {
                setupContainer.style.display = 'none';
            }
        }
        
        // Display the target screen
        if (screens[screenName].id === 'app') { // Special handling for the main game app area
             screens[screenName].style.display = 'flex';
        } else {
            screens[screenName].style.display = 'block';
        }

    } else {
        // console.warn(`[pizarraUi] showScreen: Unknown screen name '${screenName}'`);
    }
}


function getAvailableIcons(excludeCurrentPlayer = false) {
    const allIcons = state.AVAILABLE_ICONS;
    const currentPlayers = state.getPvpRemoteActive() ?
        state.getRawNetworkRoomData().players :
        state.getPlayersData();
    
    const usedIcons = new Set();
    if (currentPlayers && Array.isArray(currentPlayers)) {
        currentPlayers.forEach(player => {
            if (player.isConnected !== false && player.icon) {
                if (excludeCurrentPlayer && player.peerId === state.getMyPeerId()) {
                    return;
                }
                usedIcons.add(player.icon);
            }
        });
    }
    
    return allIcons.filter(icon => !usedIcons.has(icon));
}

export function populatePlayerIcons(targetSelectElement, excludeCurrentPlayer = false) {
    if (!targetSelectElement) {
        return;
    }
    
    const currentValue = targetSelectElement.value;
    targetSelectElement.innerHTML = '';
    
    const availableIcons = getAvailableIcons(excludeCurrentPlayer);
    const iconsToUse = availableIcons.length > 0 ? availableIcons : state.AVAILABLE_ICONS;
    
    iconsToUse.forEach(icon => {
        const option = document.createElement('option');
        option.value = icon;
        option.textContent = icon;
        targetSelectElement.appendChild(option);
    });
    
    if (iconsToUse.includes(currentValue)) {
        targetSelectElement.value = currentValue;
    } else if (iconsToUse.length > 0) {
        targetSelectElement.value = iconsToUse[0];
    }
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
    let pidToShowAttemptsFor = state.getCurrentPlayerId();

    if (state.getPvpRemoteActive()) {
        const myPlayerId = state.getNetworkRoomData().myPlayerIdInRoom;
        if (myPlayerId !== null && myPlayerId !== undefined) {
            pidToShowAttemptsFor = myPlayerId;
        } else {
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
    
    for (const letter of currentWord) {
        const letterBox = document.createElement('div');
        letterBox.classList.add('letter-box');
        const normalizedLetterFromWord = normalizeGameLetter(letter);
        if (guessed.has(normalizedLetterFromWord)) {
            letterBox.textContent = letter.toUpperCase();
        } else {
            letterBox.textContent = '';
            letterBox.classList.add('empty');
        }
        wordDisplayContainerEl.appendChild(letterBox);
    }
}

export function updateGuessedLettersDisplay() {
    if (!correctLettersDisplayEl || !incorrectLettersDisplayEl) return;
    const correctArr = [], incorrectArr = [];
    const guessed = state.getGuessedLetters();
    const currentWord = state.getCurrentWord();
    const sortedGuessedLetters = Array.from(guessed).sort((a,b)=>a.localeCompare(b,'es'));
    
    for (const guessedLetter of sortedGuessedLetters) {
        if (currentWord?.toLowerCase().includes(guessedLetter)) {
            correctArr.push(guessedLetter.toUpperCase());
        } else {
            incorrectArr.push(guessedLetter.toUpperCase());
        }
    }
    
    correctLettersDisplayEl.textContent = correctArr.join(', ') || 'Ninguna';
    incorrectLettersDisplayEl.textContent = incorrectArr.join(', ') || 'Ninguna';
}

export function createAlphabetKeyboard(isMyTurnCurrently, onLetterClickCallback) {
    if (!alphabetKeyboardContainerEl) return;
    alphabetKeyboardContainerEl.innerHTML = '';
    const guessed = state.getGuessedLetters();
    const gameIsActive = state.getGameActive();

    QWERTY_LAYOUT.forEach(row => {
        const rowDiv = document.createElement('div');
        rowDiv.classList.add('keyboard-row');
        row.forEach(letter => {
            const button = document.createElement('button');
            button.classList.add('alphabet-button');
            button.textContent = letter;
            button.dataset.letter = letter;

            const normalizedButtonLetter = normalizeGameLetter(letter);
            const isGuessed = guessed.has(normalizedButtonLetter);
            const shouldDisable = !gameIsActive || !isMyTurnCurrently || isGuessed;

            button.disabled = shouldDisable;

            if (isGuessed) {
                button.classList.add('guessed');
            }

            button.addEventListener('click', () => {
                if (!button.disabled && typeof onLetterClickCallback === 'function') {
                    onLetterClickCallback(letter, button);
                }
            });
            rowDiv.appendChild(button);
        });
        alphabetKeyboardContainerEl.appendChild(rowDiv);
    });
}

export function updateAllAlphabetButtons(disableCompletely) {
    if (!alphabetKeyboardContainerEl) return;
    const guessed = state.getGuessedLetters();
    const gameIsActive = state.getGameActive();
    alphabetKeyboardContainerEl.querySelectorAll('.alphabet-button').forEach(button => {
        const letterFromButton = button.dataset.letter;
        const normalizedButtonLetter = normalizeGameLetter(letterFromButton);
        const isGuessed = guessed.has(normalizedButtonLetter);

        if (disableCompletely) {
            button.disabled = true;
        } else {
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
    updateWordDisplay();
    updateStarsDisplay();
    updateGuessedLettersDisplay();
    updateScoreDisplayUI();
    updateCurrentPlayerTurnUI();
    createAlphabetKeyboard(isMyTurnCurrently, onLetterClickCallback);
    
    const difficulty = state.getCurrentDifficulty();
    const wordObject = state.getCurrentWordObject();
    const clueIsUsed = state.getClueUsedThisGame();

    if (difficulty === 'easy') {
        if (wordObject?.definition) {
            if(clueTextEl) clueTextEl.textContent = wordObject.definition;
        }
        if(clueDisplayAreaEl) clueDisplayAreaEl.style.display = 'block';
        if(clueButtonEl) clueButtonEl.style.display = 'none';
    } else {
        if(clueButtonEl) {
            clueButtonEl.style.display = 'inline-block';
            clueButtonEl.disabled = clueIsUsed || !state.getGameActive() || !isMyTurnCurrently;
        }
        if(clueDisplayAreaEl) {
            clueDisplayAreaEl.style.display = clueIsUsed ? 'block' : 'none';
        }
        if(clueTextEl && clueIsUsed && wordObject?.definition) {
            clueTextEl.textContent = wordObject.definition;
        } else if (clueTextEl && !clueIsUsed){
            clueTextEl.textContent = "";
        }
    }
}

export function displayClueOnUI(clueDefinition) {
    if(!uiInitialized) initializeUiDOMReferences();
    if(clueTextEl) clueTextEl.textContent = clueDefinition;
    if(clueDisplayAreaEl) clueDisplayAreaEl.style.display = 'block';
}

export function toggleClueButtonUI(enabled, show = true) {
    if (clueButtonEl && state.getCurrentDifficulty() !== 'easy') {
        clueButtonEl.disabled = !enabled;
        clueButtonEl.style.display = show ? 'inline-block' : 'none';
    } else if (clueButtonEl && state.getCurrentDifficulty() === 'easy') {
        clueButtonEl.style.display = 'none';
    }
}

const confettiColors = ["#ff69b4", "#ffc0cb", "#ff1493", "#da70d6", "#9370db", "#ffd700", "#ffb6c1", "#f0f8ff"];
export function createConfettiPiece() {
    if (!confettiContainerEl) { if(uiInitialized) return;}
    const piece = document.createElement('div'); piece.classList.add('confetti-piece');
    piece.style.backgroundColor = confettiColors[Math.floor(Math.random() * confettiColors.length)];
    piece.style.left = Math.random() * window.innerWidth + 'px';
    const randomDrift = Math.random() * 2 - 1; piece.style.setProperty('--drift', randomDrift.toString());
    const fallDuration = Math.random() * 3 + 4; piece.style.animationDuration = fallDuration + 's';
    piece.style.animationDelay = Math.random() * 0.5 + 's';
    confettiContainerEl.appendChild(piece);
    setTimeout(() => piece.remove(), (fallDuration + 1.5) * 1000);
}
export function startConfetti(numberOfPieces = 150) {
    if (!confettiContainerEl) { if(uiInitialized) initializeUiDOMReferences(); if (!confettiContainerEl) return;}
    stopConfetti(); for (let i = 0; i < numberOfPieces; i++) setTimeout(createConfettiPiece, i * 20);
}
export function stopConfetti() { if (confettiContainerEl) confettiContainerEl.innerHTML = ''; }

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
            statusSpan.textContent = player.isConnected === false ? "Desconectado 😢" : (player.isReady ? "Lista ✨" : "Esperando... ⏳");
            statusSpan.classList.add(player.isConnected === false ? 'disconnected' : (player.isReady ? 'ready' : 'not-ready'));
            card.append(iconSpan, nameSpan, statusSpan); lobbyPlayerListEl.appendChild(card);
        });
    }

    if (lobbyToggleReadyButtonEl) {
        const myPlayer = roomData.players?.find(p => p.peerId === state.getMyPeerId());
        if (myPlayer) {
            lobbyToggleReadyButtonEl.textContent = myPlayer.isReady ? "❌ No Lista" : "✨ ¡Estoy Lista!";
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
    
    if (networkPlayerIconSelect && roomData.isRoomLeader) {
        populatePlayerIcons(networkPlayerIconSelect, true);
    }
    
    if(lobbyMessageAreaEl && lobbyMessageAreaEl.textContent.includes("Esperando jugadores...") && roomData.players?.length >= roomData.maxPlayers) {
        displayMessage("¡Sala llena! ¡Listas para empezar! 🎉", "info", true, lobbyMessageAreaEl);
    } else if (lobbyMessageAreaEl && (!lobbyMessageAreaEl.textContent.includes("copiado") && !lobbyMessageAreaEl.textContent.includes("Sala llena"))) {
         displayMessage("Esperando amigas... 💕", "info", true, lobbyMessageAreaEl);
    }
}

export function displayRoomQRCodeAndLink(roomId, maxPlayers, baseShareUrl = "https://palabras.martinez.fyi", peerIdPrefix = state.PIZARRA_PEER_ID_PREFIX) {
    if(!uiInitialized) initializeUiDOMReferences();
    if (!networkInfoAreaEl || !networkInfoTitleEl || !networkInfoTextEl || !qrCodeContainerEl || !copyRoomLinkButtonEl) return;
    const gameLink = `${baseShareUrl}?room=${roomId}`;
    networkInfoTitleEl.textContent = "¡Sala Lista! Invita a tus Amigas 💖";
    networkInfoTextEl.innerHTML = `🆔 ID de Sala: <strong>${peerIdPrefix}${roomId}</strong><br>🔗 Enlace: <a href="${gameLink}" target="_blank" class="underline hover:text-pink-400">${gameLink}</a>`;
    qrCodeContainerEl.innerHTML = '';
    if (window.QRious) {
        const canvas = document.createElement('canvas');
        try {
            new QRious({ element: canvas, value: gameLink, size: 128, padding: 5, level: 'M', foreground: '#8b4cb8', background: '#ffffff' });
            qrCodeContainerEl.appendChild(canvas);
        } catch (e) { qrCodeContainerEl.textContent = "Error QR"; }
    } else { qrCodeContainerEl.textContent = "QR no disponible."; }
    if(networkInfoAreaEl && state.getNetworkRoomData()?.isRoomLeader) networkInfoAreaEl.style.display = 'block';
}

export function hideNetworkInfoArea() { if(networkInfoAreaEl) networkInfoAreaEl.style.display = 'none'; }

export function createJoinRoomModal(roomId, onJoin, onCancel) {
    const modalPlayerNameId = 'modal-player-name-join';
    const modalPlayerIconId = 'modal-player-icon-join';
    
    const joinPromptHtml = `
        <div class="join-room-modal">
            <h3>🎉 ¡Unite a la Sala!</h3>
            <p class="room-info">Sala: <strong>${state.PIZARRA_PEER_ID_PREFIX}${roomId}</strong></p>
            <div class="modal-form-inputs">
                <label for="${modalPlayerNameId}">✨ Tu Nombre:</label>
                <input type="text" id="${modalPlayerNameId}" value="${networkPlayerNameInput?.value || `Pizarrín${Math.floor(Math.random()*1000)}`}" maxlength="15" placeholder="Escribí tu nombre aquí">
                
                <label for="${modalPlayerIconId}">🎭 Tu Ícono:</label>
                <select id="${modalPlayerIconId}"></select>
            </div>
        </div>`;
    
    const buttonsConfig = [
        {
            text: "✅ ¡Unirme!",
            className: 'action-button-confirm',
            action: () => {
                const nameInput = document.getElementById(modalPlayerNameId);
                const iconSelect = document.getElementById(modalPlayerIconId);
                
                const name = nameInput?.value.trim() || `Pizarrín${Math.floor(Math.random()*1000)}`;
                const icon = iconSelect?.value || state.AVAILABLE_ICONS[0];
                
                hideModal();
                onJoin({ name, icon });
            }
        },
        {
            text: "❌ Cancelar",
            action: () => {
                hideModal();
                onCancel();
            },
            className: 'action-button-secondary'
        }
    ];
    
    showModal(joinPromptHtml, buttonsConfig, true);
    
    const iconSelect = document.getElementById(modalPlayerIconId);
    if (iconSelect) {
        populatePlayerIcons(iconSelect, false);
        if (networkPlayerIconSelect) {
            iconSelect.value = networkPlayerIconSelect.value || state.AVAILABLE_ICONS[0];
        }
    }
}