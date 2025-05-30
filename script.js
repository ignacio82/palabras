// script.js

document.addEventListener('DOMContentLoaded', () => {
    // --- Game Configuration ---
    // DICTIONARY_DATA is expected to be loaded from dictionary.js
    const MAX_ATTEMPTS = 6;
    const STAR_SYMBOL = "🌟";
    const ALPHABET = "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ".split('');

    // --- DOM Elements ---
    const starsDisplayEl = document.getElementById('stars-display');
    const messageAreaEl = document.getElementById('message-area');
    const wordDisplayContainerEl = document.getElementById('word-display-container');
    const alphabetKeyboardContainerEl = document.getElementById('alphabet-keyboard-container');
    const incorrectLettersDisplayEl = document.getElementById('incorrect-letters-display');
    const correctLettersDisplayEl = document.getElementById('correct-letters-display');
    const playAgainButtonEl = document.getElementById('play-again-button');

    const difficultyButtons = document.querySelectorAll('.difficulty-button');
    const clueButtonEl = document.getElementById('clue-button');
    const clueDisplayAreaEl = document.getElementById('clue-display-area');
    const clueTextEl = document.getElementById('clue-text');
    const gameAreaEl = document.getElementById('game-area'); // Main game area

    // --- Game State Variables ---
    let currentWord = ''; // The word to guess (normalized: uppercase, no accents)
    let currentWordObject = null; // { word: "Original", definition: "...", difficulty: "..." }
    let guessedLetters = new Set();
    let remainingAttempts = 0;
    let gameActive = false;
    let messageTimeout = null;
    let currentDifficulty = "easy"; // Default difficulty
    let clueUsedThisGame = false;

    // --- Helper Functions ---
    function normalizeString(str) {
        if (!str) return "";
        return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    }

    function getRandomWord() {
        if (typeof DICTIONARY_DATA === 'undefined' || DICTIONARY_DATA.length === 0) {
            console.error("¡Diccionario no cargado o vacío!");
            return null;
        }

        const availableWords = DICTIONARY_DATA.filter(item => item.difficulty === currentDifficulty);

        if (availableWords.length === 0) {
            console.warn(`No hay palabras para la dificultad: ${currentDifficulty}`);
            return null;
        }

        const randomIndex = Math.floor(Math.random() * availableWords.length);
        currentWordObject = availableWords[randomIndex];
        return normalizeString(currentWordObject.word); // Return normalized word for guessing
    }

    // --- Display Functions ---
    function displayMessage(text, type = 'info', persistent = false) {
        if (messageTimeout) {
            clearTimeout(messageTimeout);
            messageTimeout = null;
        }
        messageAreaEl.textContent = text;
        messageAreaEl.className = `message ${type}`;

        const defaultInstruction = "Haz clic en una letra para adivinar...";

        if (!persistent && (type === 'error' || type === 'success')) {
            messageTimeout = setTimeout(() => {
                if (gameActive) {
                    displayMessage(defaultInstruction, 'info');
                } else if (messageAreaEl.textContent === text && type !== 'success' && type !== 'error') { // Avoid clearing final win/loss
                    messageAreaEl.textContent = '\u00A0';
                    messageAreaEl.className = 'message';
                }
            }, 2500);
        } else if (!persistent && type === 'info' && text !== defaultInstruction) {
             messageTimeout = setTimeout(() => {
                if (gameActive) {
                     displayMessage(defaultInstruction, 'info');
                }
            }, 2500);
        }
    }

    function updateStarsDisplay() {
        starsDisplayEl.textContent = STAR_SYMBOL.repeat(remainingAttempts);
    }

    function updateWordDisplay() {
        wordDisplayContainerEl.innerHTML = '';
        let allLettersGuessedCorrectly = true;

        for (const letter of currentWord) { // currentWord is already normalized
            const letterBox = document.createElement('div');
            letterBox.classList.add('letter-box');
            if (guessedLetters.has(letter)) {
                letterBox.textContent = letter;
            } else {
                letterBox.textContent = '';
                letterBox.classList.add('empty');
                allLettersGuessedCorrectly = false;
            }
            wordDisplayContainerEl.appendChild(letterBox);
        }
        return allLettersGuessedCorrectly;
    }

    function updateGuessedLettersDisplay() {
        const correctArr = [];
        const incorrectArr = [];
        const sortedGuessedLetters = Array.from(guessedLetters).sort((a, b) => a.localeCompare(b, 'es'));

        for (const letter of sortedGuessedLetters) {
            const normalizedLetter = normalizeString(letter); // Ensure comparison is normalized
            if (currentWord.includes(normalizedLetter)) {
                correctArr.push(letter);
            } else {
                incorrectArr.push(letter);
            }
        }
        correctLettersDisplayEl.textContent = correctArr.join(', ') || 'Ninguna';
        incorrectLettersDisplayEl.textContent = incorrectArr.join(', ') || 'Ninguna';
    }

    function createAlphabetKeyboard() {
        alphabetKeyboardContainerEl.innerHTML = '';
        ALPHABET.forEach(letter => {
            const button = document.createElement('button');
            button.classList.add('alphabet-button');
            button.textContent = letter;
            button.dataset.letter = letter;
            button.addEventListener('click', () => {
                if (gameActive && !button.disabled) {
                    handleGuess(letter);
                }
            });
            alphabetKeyboardContainerEl.appendChild(button);
        });
    }

    function updateDifficultyButtons() {
        difficultyButtons.forEach(button => {
            if (button.dataset.difficulty === currentDifficulty) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    }

    // --- Game Logic Functions ---
    function startGame() {
        gameActive = true;
        guessedLetters.clear();
        remainingAttempts = MAX_ATTEMPTS;
        clueUsedThisGame = false;

        currentWord = getRandomWord(); // This now sets currentWordObject as well

        if (!currentWord) {
            displayMessage(`No hay palabras para la dificultad '${currentDifficulty}'. Por favor, elige otra.`, 'error', true);
            gameActive = false;
            clueButtonEl.style.display = 'none';
            gameAreaEl.style.opacity = '0.5'; // Dim the game area
            // Optionally disable alphabet keyboard if it was already generated
            document.querySelectorAll('.alphabet-button').forEach(button => button.disabled = true);
            return;
        }
        gameAreaEl.style.opacity = '1'; // Ensure game area is fully visible


        createAlphabetKeyboard();
        displayMessage("Haz clic en una letra para adivinar...", 'info', true);
        updateStarsDisplay();
        updateWordDisplay();
        updateGuessedLettersDisplay();
        updateDifficultyButtons();

        clueButtonEl.style.display = 'inline-block';
        clueButtonEl.disabled = false;
        clueDisplayAreaEl.style.display = 'none';
        clueTextEl.textContent = '';

        playAgainButtonEl.style.display = 'none';
    }

    function endGame(isWin) {
        gameActive = false;
        document.querySelectorAll('.alphabet-button').forEach(button => button.disabled = true);
        clueButtonEl.disabled = true; // Disable clue button at game end
        playAgainButtonEl.style.display = 'inline-block';

        if (isWin) {
            displayMessage(`¡GANASTE! 🎉 La palabra era: ${currentWordObject.word}`, 'success', true);
        } else {
            // Reveal the word only if it wasn't fully guessed (e.g. if lost by attempts)
            if (currentWordObject && currentWordObject.word) {
                 // Add all letters of the original word to guessedLetters to display them
                for(const letter of normalizeString(currentWordObject.word)) {
                    guessedLetters.add(letter);
                }
                updateWordDisplay(); // Update to show the full word
                displayMessage(`¡Oh no! 😢 La palabra era: ${currentWordObject.word}`, 'error', true);
            } else {
                 displayMessage(`¡Oh no! 😢 Intenta de nuevo.`, 'error', true);
            }
        }
    }

    function handleGuess(letter) {
        if (!gameActive || guessedLetters.has(letter)) return;

        const button = alphabetKeyboardContainerEl.querySelector(`.alphabet-button[data-letter="${letter}"]`);
        if (button) {
            button.disabled = true;
        }

        guessedLetters.add(letter);
        const normalizedLetter = normalizeString(letter); // Guessed letter is already from ALPHABET (A-Z,Ñ)

        if (currentWord.includes(normalizedLetter)) {
            displayMessage(`¡Muy bien! '${letter}' está en la palabra. 👍`, 'success');
        } else {
            remainingAttempts--;
            displayMessage(`'${letter}' no está. ¡Pierdes una ${STAR_SYMBOL}!`, 'error');
        }

        updateStarsDisplay();
        const allGuessed = updateWordDisplay();
        updateGuessedLettersDisplay();

        if (allGuessed) {
            endGame(true);
        } else if (remainingAttempts <= 0) {
            endGame(false);
        }
    }

    function handleDifficultyChange(event) {
        const newDifficulty = event.target.dataset.difficulty;
        if (newDifficulty && newDifficulty !== currentDifficulty) {
            currentDifficulty = newDifficulty;
            startGame(); // Restart game with new difficulty
        } else if (newDifficulty === currentDifficulty) {
            // If clicking current difficulty, perhaps just highlight it or do nothing
            updateDifficultyButtons();
        }
    }

    function handleClueRequest() {
        if (!gameActive || clueUsedThisGame || !currentWordObject) return;

        clueUsedThisGame = true;
        clueButtonEl.disabled = true;
        clueTextEl.textContent = currentWordObject.definition;
        clueDisplayAreaEl.style.display = 'block';

        // Optional: Cost for a clue
        // remainingAttempts--;
        // updateStarsDisplay();
        // if (remainingAttempts <= 0 && !updateWordDisplay()) { // Check if player lost after clue cost
        //     endGame(false);
        // }

        displayMessage("¡Pista revelada!", 'info');
    }

    // --- Event Listeners ---
    difficultyButtons.forEach(button => {
        button.addEventListener('click', handleDifficultyChange);
    });

    clueButtonEl.addEventListener('click', handleClueRequest);
    playAgainButtonEl.addEventListener('click', startGame);

    // --- Initialize Game ---
    if (typeof DICTIONARY_DATA !== 'undefined' && DICTIONARY_DATA.length > 0) {
        startGame();
    } else {
        displayMessage("Error: No se pudo cargar el diccionario de palabras.", "error", true);
        gameAreaEl.style.opacity = '0.5';
        console.error("DICTIONARY_DATA no está definido o está vacío. Asegúrate que dictionary.js se cargue correctamente y contenga datos.");
    }
});