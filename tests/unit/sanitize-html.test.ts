import { describe, it, expect } from 'vitest';
import { sanitizeRichText } from '@/lib/sanitize-html';

/**
 * Comportamento di sicurezza di lib/sanitize-html.ts (testo ricco delle vetrine).
 *
 * Perche' esiste: il motore sotto (DOMPurify + il DOM di jsdom) e' stato ripinnato
 * il 17/08/2026 per togliere dalla catena i pacchetti solo-ESM che facevano cadere
 * la produzione con ERR_REQUIRE_ESM. Il file non aveva alcun test: un cambio di
 * versione della libreria di sanificazione poteva allentare le difese senza che
 * nulla diventasse rosso. Questi casi fissano il contratto che deve reggere
 * qualunque versione: niente script, niente handler inline, solo link https.
 */
describe('sanitizeRichText', () => {
  it('lascia passare la formattazione ammessa', () => {
    expect(sanitizeRichText('<p><strong>a</strong><em>b</em></p>')).toBe('<p><strong>a</strong><em>b</em></p>');
    expect(sanitizeRichText('<ul><li>x</li></ul>')).toBe('<ul><li>x</li></ul>');
  });

  it('rimuove gli script', () => {
    expect(sanitizeRichText('<p>ciao</p><script>alert(1)</script>')).toBe('<p>ciao</p>');
  });

  it('rimuove gli handler inline', () => {
    expect(sanitizeRichText('<p onclick="alert(1)">x</p>')).toBe('<p>x</p>');
    expect(sanitizeRichText('<img src=x onerror=alert(1)>')).toBe('');
    expect(sanitizeRichText('<svg/onload=alert(1)>')).toBe('');
  });

  it('rimuove iframe, form e input', () => {
    expect(sanitizeRichText('<iframe src="https://evil.example"></iframe>')).toBe('');
    expect(sanitizeRichText('<form><input name="pwd"></form>')).toBe('');
  });

  it('rimuove style, class e id', () => {
    expect(sanitizeRichText('<p style="color:red" class="y" id="z">t</p>')).toBe('<p>t</p>');
  });

  it('svuota gli href non https (javascript:, http:)', () => {
    // L'href viene tolto del tutto: resta il testo, non il collegamento.
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeRichText('<a href="http://insicuro.example">x</a>')).toBe('<a>x</a>');
  });

  it('tiene i link https e li rende sicuri', () => {
    const out = sanitizeRichText('<a href="https://ok.example">x</a>');
    expect(out).toContain('href="https://ok.example"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it('restituisce stringa vuota per input vuoto o assente', () => {
    expect(sanitizeRichText('')).toBe('');
    expect(sanitizeRichText(null)).toBe('');
    expect(sanitizeRichText(undefined)).toBe('');
  });
});
