import { describe, it, expect } from 'vitest';
import { friendlyError } from '@/lib/errors';
import { TIPI_IMMAGINE } from '@/lib/storage/regole-secchi';

/**
 * 17/11/2026 (R01-008) — LA FRASE VECCHIA SUI FORMATI FOTO.
 *
 * friendlyError diceva «usa una foto JPG, PNG o WEBP» quando il deposito rifiuta un formato,
 * mentre la porta di caricamento ne accetta sette (anche GIF, AVIF, HEIC, HEIF): chi fotografa
 * con l'iPhone leggeva che la sua foto HEIC non andava bene.
 */
describe('il formato rifiutato elenca i formati che la porta accetta davvero', () => {
  it('ogni formato ammesso compare nella frase', () => {
    const msg = friendlyError(new Error('mime type image/svg+xml is not supported'));
    expect(msg).toMatch(/^Formato non accettato: usa una foto /);
    // 28/11/2026 (R01-004, onda 2) — tolti HEIC e HEIF, che le caselle delle foto pubbliche non offrono.
    for (const tipo of TIPI_IMMAGINE.filter((t) => !/hei[cf]$/.test(t))) {
      const nome = tipo.replace('image/', '').replace('jpeg', 'jpg').toUpperCase();
      expect(msg, `manca ${nome}`).toContain(nome);
    }
    expect(msg).not.toMatch(/HEIC|HEIF/);
  });

  it('anche quando il deposito dice «invalid mime type»', () => {
    const msg = friendlyError({ message: 'invalid mime type image/tiff' });
    expect(msg).toBe('Formato non accettato: usa una foto JPG, PNG, WEBP, GIF o AVIF.');
  });
});
