import { describe, it, expect, vi, afterEach } from 'vitest';
import { firmaDisiscrizione, verificaDisiscrizione } from '@/lib/email/unsubscribe';

/**
 * R08-001, giro del collaudo — prima della nuova chiave, un link cifrato aperto in
 * produzione senza UNSUBSCRIBE_SECRET valeva «link non valido» (null): la chiave si
 * calcolava dentro il try. Spostato il calcolo fuori, la rotta rispondeva 500.
 * Qui si prova che senza segreto un link v3 o v2 torna null, senza lanciare.
 */
const EMAIL = 'lucia.bianchi@example.it';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('R08-001 — senza segreto il link cifrato non è valido, non è un errore', () => {
  it('un gettone cifrato aperto in produzione senza segreto dà null', () => {
    vi.stubEnv('UNSUBSCRIBE_SECRET', 'un-segreto-di-prova');
    const nuovo = firmaDisiscrizione(EMAIL, 'newsletter');
    const vecchio = `v2.${nuovo.slice(3)}`;
    expect(verificaDisiscrizione(nuovo)).toEqual({ email: EMAIL, ambito: 'newsletter' });

    vi.stubEnv('UNSUBSCRIBE_SECRET', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => verificaDisiscrizione(nuovo)).not.toThrow();
    expect(verificaDisiscrizione(nuovo)).toBeNull();
    expect(() => verificaDisiscrizione(vecchio)).not.toThrow();
    expect(verificaDisiscrizione(vecchio)).toBeNull();
  });
});
