// util.js
const TILDE = "\u0303";   // combining tilde

/** Normalise a single alphabet letter for game logic.
 *  – Case-insensitive.
 *  – Strips accents on vowels (á → a, ü → u, etc.).
 *  – PRESERVES Ñ/ñ as a distinct letter. */
export function normalizeLetter(raw){
  const lower = raw.toLowerCase();

  // Fast path: keep ñ as-is
  if (lower === 'ñ') return 'ñ';

  // Strip every combining mark EXCEPT the tilde
  const cleaned = lower
      .normalize('NFD')
      .replace(/[\u0300-\u0302\u0304-\u036f]/g, '');

  return cleaned;
}
