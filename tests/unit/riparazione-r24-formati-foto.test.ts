import { describe, it, expect } from 'vitest';
import { friendlyError } from '@/lib/errors';
import { TIPI_IMMAGINE } from '@/lib/storage/regole-secchi';

/**
 * 13/11/2026 (R24-017) — LA FRASE VECCHIA SUI FORMATI FOTO.
 *
 * friendlyError diceva «usa una foto JPG, PNG o WEBP» quando lo Storage rifiuta un
 * formato, mentre la porta di caricamento ne accetta sette (anche GIF, AVIF, HEIC,
 * HEIF): chi fotografa con l'iPhone leggeva che la sua foto HEIC non andava bene.
 */
describe('il formato rifiutato elenca i formati che la porta accetta davvero', () => {
  it('ogni formato ammesso compare nella frase', () => {
    const msg = friendlyError(new Error('mime type image/svg+xml is not supported'));
    expect(msg).toMatch(/^Formato non accettato: usa una foto /);
    for (const tipo of TIPI_IMMAGINE) {
      const nome = tipo.replace('image/', '').replace('jpeg', 'jpg').toUpperCase();
      expect(msg, `manca ${nome}`).toContain(nome);
    }
    expect(msg).toContain('HEIC');
  });
});
