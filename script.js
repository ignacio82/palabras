// script.js

document.addEventListener('DOMContentLoaded', () => {
    // --- Game Configuration ---
    const WORDS = [
        "SOL", "LUNA", "CASA", "MAMA", "PAPA", "GATO", "PERRO", "AGUA", "PAN", "FLOR",
        "TREN", "PATO", "OSO", "UVA", "PIE", "MANO", "OJO", "LUZ", "MAR", "SAL",
        "PAZ", "REY", "FIN", "OLA", "DIA", "RIO", "PEZ", "LEO", "ANA", "MAS",
        "DOS", "TRES", "SEIS", "ROSA", "DADO", "NIDO", "SAPO", "RANA", "LAPIZ", "MESA",
        "PALA", "PISO", "PILA", "PIPA", "PERA", "PELO", "RATA", "SOPA", "TAZA", "TELA",
        "VASO", "COCO", "MANI", "PINA", "BANCO", "BOTE", "FOCA", "HADA", "KIWI", "LATA",
        "NIÑO", "NIÑA", "AÑO" // Added words with Ñ
    ];
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

    // --- Game State Variables ---
    let currentWord = '';
    let guessedLetters = new Set();
    let remainingAttempts = 0;
    let gameActive = false;
    let messageTimeout = null;

    // --- Core Game Functions ---

    function getRandomWord() {
        return WORDS[Math.floor(Math.random() * WORDS.length)].toUpperCase();
    }

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
                } else if (messageAreaEl.textContent === text) {
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

        for (const letter of currentWord) {
            const letterBox = document.createElement('div');
            letterBox.classList.add('letter-box');
            if (guessedLetters.has(letter)) {
                letterBox.textContent = letter;
            } else {
                letterBox.textContent = ''; // Handled by CSS border-bottom for underscore look
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
            if (currentWord.includes(letter)) {
                correctArr.push(letter);
            } else {
                incorrectArr.push(letter);
            }
        }
        correctLettersDisplayEl.textContent = correctArr.join(', ') || 'Ninguna';
        incorrectLettersDisplayEl.textContent = incorrectArr.join(', ') || 'Ninguna';
    }

    function createAlphabetKeyboard() {
        alphabetKeyboardContainerEl.innerHTML = ''; // Clear existing buttons
        ALPHABET.forEach(letter => {
            const button = document.createElement('button');
            button.classList.add('alphabet-button');
            button.textContent = letter;
            button.dataset.letter = letter; // Store letter in data attribute for easy access
            button.addEventListener('click', () => {
                if (gameActive && !button.disabled) {
                    handleGuess(letter);
                }
            });
            alphabetKeyboardContainerEl.appendChild(button);
        });
    }

    function startGame() {
        gameActive = true;
        currentWord = getRandomWord();
        guessedLetters.clear();
        remainingAttempts = MAX_ATTEMPTS;

        createAlphabetKeyboard(); // Generate or reset the keyboard
        displayMessage("Haz clic en una letra para adivinar...", 'info', true);
        updateStarsDisplay();
        updateWordDisplay();
        updateGuessedLettersDisplay();

        playAgainButtonEl.style.display = 'none';
    }

    function endGame(isWin) {
        gameActive = false;
        // Disable all alphabet buttons
        document.querySelectorAll('.alphabet-button').forEach(button => button.disabled = true);
        playAgainButtonEl.style.display = 'inline-block';

        if (isWin) {
            displayMessage(`¡GANASTE! 🎉 La palabra era: ${currentWord}`, 'success', true);
        } else {
            for(const letter of currentWord) {
                if (!guessedLetters.has(letter)) {
                     guessedLetters.add(letter);
                }
            }
            updateWordDisplay();
            displayMessage(`¡Oh no! 😢 La palabra era: ${currentWord}`, 'error', true);
        }
    }

    function handleGuess(letter) {
        if (!gameActive || guessedLetters.has(letter)) return;

        // Disable the clicked button on the on-screen keyboard
        const button = alphabetKeyboardContainerEl.querySelector(`.alphabet-button[data-letter="${letter}"]`);
        if (button) {
            button.disabled = true;
        }

        guessedLetters.add(letter);

        if (currentWord.includes(letter)) {
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

    // --- Event Listeners ---
    playAgainButtonEl.addEventListener('click', startGame);

    // --- Initialize Game ---
    startGame();
});