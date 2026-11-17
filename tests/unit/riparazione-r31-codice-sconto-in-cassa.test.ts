import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * R31-007 — Con i codici sconto spenti (CODICI_SCONTO_IN_CASSA) la cassa non ha il campo:
 * il testo lungo del carrello non deve dire «Se in cassa usi un codice sconto».
 * Le domande frequenti seguono già lo stesso interruttore.
 */
async function chiusura(codiciAcceso: boolean): Promise<string> {
  vi.resetModules();
  vi.doMock('@/lib/funzioni-al-lancio', async (orig) => ({
    ...(await orig<typeof import('@/lib/funzioni-al-lancio')>()),
    CODICI_SCONTO_IN_CASSA: codiciAcceso,
  }));
  const m = await import('@/lib/promesse-pubbliche');
  return m.spiegazioneDellaConsegna('Si paga alla consegna.').chiusura;
}

describe('il testo della consegna segue l’interruttore dei codici sconto', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/funzioni-al-lancio');
    vi.resetModules();
  });

  it('spenti: non promette il codice sconto in cassa, ma dice ancora il totale', async () => {
    const t = await chiusura(false);
    expect(t).not.toMatch(/codice sconto/i);
    expect(t).toContain('Il totale con la consegna lo vedi sempre prima di confermare');
  });

  it('accesi: la frase sul codice sconto c’è', async () => {
    expect(await chiusura(true)).toContain('Se in cassa usi un codice sconto');
  });
});
