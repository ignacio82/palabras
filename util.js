// util.js

/**
 * Normalizes a single letter for game logic comparison.
 * Converts to uppercase and removes diacritics (accents).
 * @param {string} letter - The letter to normalize.
 * @returns {string} The normalized letter.
 */
export function normalizeLetter(letter) {
    if (!letter || typeof letter !== 'string' || letter.length === 0) {
        return "";
    }
    // Assuming single letter, but normalize works on strings too
    return letter.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}