// script.js

document.addEventListener('DOMContentLoaded', () => {
    // --- Game Configuration ---
    const WORDS = [
        "SOL", "LUNA", "CASA", "MAMA", "PAPA", "GATO", "PERRO", "AGUA", "PAN", "FLOR",
        "TREN", "PATO", "OSO", "UVA", "PIE", "MANO", "OJO", "LUZ", "MAR", "SAL",
        "PAZ", "REY", "FIN", "OLA", "DIA", "RIO", "PEZ", "LEO", "ANA", "MAS",
        "DOS", "TRES", "SEIS", "ROSA", "DADO", "NIDO", "SAPO", "RANA", "LAPIZ", "MESA",
        "PALA", "PISO", "PILA", "PIPA", "PERA", "PELO", "RATA", "SOPA", "TAZA", "TELA",
        "VASO", "COCO", "MANI", "PINA", "BANCO", "BOTE", "FOCA", "HADA", "KIWI", "LATA"
    ];
    const MAX_ATTEMPTS = 6;
    const STAR_SYMBOL = "🌟";

    // --- DOM Elements ---
    const starsDisplayEl = document.getElementById('stars-display');
    const messageAreaEl = document.getElementById('message-area');
    const wordDisplayContainerEl = document.getElementById('word-display-container');
    const letterInputEl = document.getElementById('letter-input');
    const guessButtonEl = document.getElementById('guess-button');
    const incorrectLettersDisplayEl = document.getElementById('incorrect-letters-display');
    const correctLettersDisplayEl = document.getElementById('correct-letters-display');
    const playAgainButtonEl = document.getElementById('play-again-button');

    // --- Game State Variables ---
    let currentWord = '';
    let guessedLetters = new Set(); // Using a Set for efficient storage and checking of guessed letters
    let remainingAttempts = 0;
    let gameActive = false;
    let messageTimeout = null; // To manage message clearing timeouts

    // --- Core Game Functions ---

    function getRandomWord() {
        return WORDS[Math.floor(Math.random() * WORDS.length)];
    }

    function displayMessage(text, type = 'info', persistent = false) {
        if (messageTimeout) {
            clearTimeout(messageTimeout); // Clear any existing timeout
            messageTimeout = null;
        }
        messageAreaEl.textContent = text;
        messageAreaEl.className = `message ${type}`; // Apply new style

        if (!persistent && (type === 'error' || type === 'success')) {
            messageTimeout = setTimeout(() => {
                if (gameActive) { // Only reset to default if game is still active
                    displayMessage("Adivina la siguiente letra...", 'info');
                } else if (messageAreaEl.textContent === text) { // Avoid clearing win/loss messages
                    messageAreaEl.textContent = '\u00A0'; // Non-breaking space to maintain height
                    messageAreaEl.className = 'message';
                }
            }, 2500); // Message visible for 2.5 seconds
        } else if (!persistent && type === 'info' && text !== "Adivina la siguiente letra...") {
            // For short info messages that should also clear
             messageTimeout = setTimeout(() => {
                if (gameActive) {
                     displayMessage("Adivina la siguiente letra...", 'info');
                }
            }, 2500);
        }
    }

    function updateStarsDisplay() {
        starsDisplayEl.textContent = STAR_SYMBOL.repeat(remainingAttempts);
    }

    function updateWordDisplay() {
        wordDisplayContainerEl.innerHTML = ''; // Clear previous letter boxes
        let allLettersGuessedCorrectly = true;

        for (const letter of currentWord) {
            const letterBox = document.createElement('div');
            letterBox.classList.add('letter-box');
            if (guessedLetters.has(letter)) {
                letterBox.textContent = letter;
            } else {
                letterBox.textContent = '_'; // Show underscore for unguessed letters
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
        const sortedGuessedLetters = Array.from(guessedLetters).sort();

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

    function startGame() {
        gameActive = true;
        currentWord = getRandomWord();
        guessedLetters.clear();
        remainingAttempts = MAX_ATTEMPTS;

        displayMessage("¡Adivina la palabra secreta!", 'info', true); // Persistent initial message
        updateStarsDisplay();
        updateWordDisplay();
        updateGuessedLettersDisplay();

        letterInputEl.value = '';
        letterInputEl.disabled = false;
        letterInputEl.focus(); // Focus on the input field
        guessButtonEl.disabled = false;
        playAgainButtonEl.style.display = 'none'; // Hide play again button
    }

    function endGame(isWin) {
        gameActive = false;
        letterInputEl.disabled = true;
        guessButtonEl.disabled = true;
        playAgainButtonEl.style.display = 'inline-block'; // Show play again button

        if (isWin) {
            displayMessage(`¡GANASTE! 🎉 La palabra era: ${currentWord}`, 'success', true);
        } else {
            // Reveal the word fully if lost
            for(const letter of currentWord) {
                if (!guessedLetters.has(letter)) {
                     guessedLetters.add(letter); // Add missing letters to show them
                }
            }
            updateWordDisplay(); // Update display to show full word
            displayMessage(`¡Oh no! 😢 La palabra era: ${currentWord}`, 'error', true);
        }
    }

    function handleGuess() {
        if (!gameActive) return;

        const guess = letterInputEl.value.toUpperCase();
        letterInputEl.value = ''; // Clear input field immediately
        letterInputEl.focus();    // Keep focus on input field

        if (!guess || guess.length !== 1 || !/^[A-ZÑ]$/.test(guess)) { // Includes Ñ for Spanish
            displayMessage("Por favor, ingresa UNA sola letra (A-Z).", 'error');
            return;
        }

        if (guessedLetters.has(guess)) {
            displayMessage(`Ya intentaste con la letra '${guess}'. ¡Prueba otra!`, 'error');
            return;
        }

        guessedLetters.add(guess);

        if (currentWord.includes(guess)) {
            displayMessage(`¡Muy bien! '${guess}' está en la palabra. 👍`, 'success');
        } else {
            remainingAttempts--;
            displayMessage(`'${guess}' no está. ¡Pierdes una ${STAR_SYMBOL}!`, 'error');
        }

        updateStarsDisplay();
        const allGuessed = updateWordDisplay(); // This updates the word and checks if all letters are revealed
        updateGuessedLettersDisplay();

        if (allGuessed) {
            endGame(true); // Player wins
        } else if (remainingAttempts <= 0) {
            endGame(false); // Player loses
        }
    }

    // --- Event Listeners ---
    guessButtonEl.addEventListener('click', handleGuess);

    letterInputEl.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevent default Enter key action (like form submission)
            handleGuess();
        }
    });

    // Optional: Restrict input to single letters directly in the input field
    letterInputEl.addEventListener('input', () => {
        let value = letterInputEl.value.toUpperCase();
        if (value.length > 1) {
            value = value.charAt(value.length - 1); // Keep only the last entered character
        }
        if (value && !/^[A-ZÑ]$/.test(value)) { // Check if it's a valid letter
             value = ''; // Clear if not a letter
        }
        letterInputEl.value = value;
    });


    playAgainButtonEl.addEventListener('click', startGame);

    // --- Initialize Game ---
    startGame();
});