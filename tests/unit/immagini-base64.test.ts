import { describe, it, expect } from 'vitest';
import { verificaImmagineBase64, MAX_LUNGHEZZA_BASE64 } from '@/lib/immagini-base64';

/**
 * Il controllo del formato guardava i primi 4096 caratteri della stringa e si
 * fermava lì (#207). Una richiesta poteva mandare quattromila caratteri
 * innocui seguiti da sette megabyte di qualunque cosa: passava, e finiva dentro
 * una chiamata a pagamento. E nessuno verificava che il tipo dichiarato
 * corrispondesse al contenuto.
 */

const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAA=';
const PNG = 'iVBORw0KGgoAAAANSUhEUg==';
const WEBP = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '),
]).toString('base64');

describe('la foto che arriva è davvero una foto', () => {
  it('una jpeg dichiarata jpeg passa', () => {
    expect(verificaImmagineBase64(JPEG, 'image/jpeg')).toEqual({ ok: true });
  });

  it('una png dichiarata png passa', () => {
    expect(verificaImmagineBase64(PNG, 'image/png')).toEqual({ ok: true });
  });

  it('una webp dichiarata webp passa', () => {
    expect(verificaImmagineBase64(WEBP, 'image/webp')).toEqual({ ok: true });
  });

  it('una png spacciata per jpeg viene rifiutata', () => {
    const esito = verificaImmagineBase64(PNG, 'image/jpeg');
    expect(esito.ok).toBe(false);
  });

  it('quello che non è una immagine viene rifiutato', () => {
    // "hello world" in base64: alfabeto valido, contenuto che non è una foto.
    expect(verificaImmagineBase64('aGVsbG8gd29ybGQ=', 'image/jpeg').ok).toBe(false);
  });

  it('la spazzatura DOPO i primi 4096 caratteri viene vista (era il difetto)', () => {
    const camuffata = JPEG.replace(/=+$/, '') + 'A'.repeat(5000) + '@@@';
    expect(camuffata.slice(0, 4096)).toMatch(/^[A-Za-z0-9+/]+={0,2}$/); // il vecchio controllo passava
    expect(verificaImmagineBase64(camuffata, 'image/jpeg').ok).toBe(false); // questo no
  });

  it("l'immagine troppo grande è segnalata come tale, non come formato sbagliato", () => {
    const esito = verificaImmagineBase64(JPEG + 'A'.repeat(MAX_LUNGHEZZA_BASE64), 'image/jpeg');
    expect(esito).toMatchObject({ ok: false, troppoGrande: true });
  });

  it('una stringa vuota non è una foto', () => {
    expect(verificaImmagineBase64('', 'image/jpeg').ok).toBe(false);
  });
});
