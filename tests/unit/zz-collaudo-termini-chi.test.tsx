import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 31/10/2026 (ondata 6, pacchetto «lib/legal/titolare.ts», dal collaudo) — I TERMINI NON DICEVANO
 * CHI GESTISCE IL SERVIZIO.
 *
 * L'informativa e il piede nominavano gia' la persona, ma i Termini restavano «gestita da MyCity»:
 * un marchio, non qualcuno che risponde del contratto. In produzione nessuna delle 14 variabili
 * NEXT_PUBLIC_TITOLARE_* e' messa, e la prova disegna la pagina /terms VERA in quelle condizioni.
 */

const VARIABILI = [
  'NOME', 'INDIRIZZO', 'PIVA', 'REA', 'PEC', 'CAPITALE', 'EMAIL_PRIVACY', 'REFERENTE_PRIVACY',
  'EMAIL_DPO', 'EMAIL_RESI', 'EMAIL_RECLAMI', 'EMAIL_LEGALE', 'EMAIL_SICUREZZA', 'EMAIL_SEGNALAZIONI',
].map((v) => `NEXT_PUBLIC_TITOLARE_${v}`);

const testo = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

function comeInProduzione() {
  for (const v of VARIABILI) vi.stubEnv(v, '');
  vi.resetModules();
}

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe('variante: i Termini dicono chi gestisce il servizio', () => {
  it('senza le variabili, «gestita da» nomina la persona e non solo il marchio', async () => {
    comeInProduzione();
    const { default: TermsPage } = await import('@/app/terms/page');
    const t = testo(renderToStaticMarkup(createElement(TermsPage)));
    const m = t.match(/gestita da ([^(]*)\(/);
    expect(m, 'la frase «gestita da» deve esserci').not.toBeNull();
    expect((m as RegExpMatchArray)[1], `i Termini dicono «gestita da ${(m as RegExpMatchArray)[1]}»`).toContain('Nicolae Rotaru');
  });

  it('e senza sede, partita IVA o PEC inventate accanto al nome', async () => {
    comeInProduzione();
    const { default: TermsPage } = await import('@/app/terms/page');
    const t = testo(renderToStaticMarkup(createElement(TermsPage)));
    const m = t.match(/gestita da ([^(]*)\(/);
    expect((m as RegExpMatchArray)[1]).not.toMatch(/P\.IVA|PEC:|Sede:/);
  });
});
