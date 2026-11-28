import { describe, it, expect } from 'vitest';
import { friendlyError } from '@/lib/errors';
import { formatiDaProporre } from '@/lib/storage/carica-immagine';
import { TIPI_IMMAGINE } from '@/lib/storage/regole-secchi';

/**
 * R01-004 (onda 2) — Quando è il deposito a rifiutare un formato, friendlyError proponeva ancora
 * «… AVIF, HEIC o HEIF». Le caselle delle foto non chiedono HEIC al telefono e quello che arriva lo
 * stesso si converte o si rifiuta (lib/immagini/heic-in-jpeg.ts): proporlo era un invito a sbagliare.
 * La frase ora è la stessa della porta di caricamento (`formatiDaProporre`).
 */
describe('R01-004 · il formato rifiutato dal deposito non propone HEIC e HEIF', () => {
  it.each([
    { message: 'mime type image/tiff is not supported' },
    { message: 'invalid mime type image/svg+xml' },
  ])('«$message»', (errore) => {
    const detto = friendlyError(errore);
    expect(detto).not.toMatch(/HEIC|HEIF/);
    expect(detto).toBe(`Formato non accettato: usa una foto ${formatiDaProporre(TIPI_IMMAGINE)}.`);
  });
});
