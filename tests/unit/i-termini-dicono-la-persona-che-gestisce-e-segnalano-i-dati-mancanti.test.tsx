import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 1/11/2026 (ondata 5, pacchetto «app/terms/page.tsx») — CHI C'E' DIETRO IL SITO.
 *
 * In produzione nessuna delle 14 variabili NEXT_PUBLIC_TITOLARE_* e' messa. I Termini aprivano con
 * «gestita da MyCity», un marchio e non qualcuno che risponde del contratto; la persona compariva
 * solo dopo, in una riga a parte. E il codice non diceva a nessuno che sede, partita IVA e PEC
 * mancavano: il vuoto era silenzioso.
 *
 * Scelta di Nicola: dove c'e' solo il marchio, le pagine nominano la persona che gestisce —
 * «gestita da Nicolae Rotaru (MyCity)» — e un dato obbligatorio mancante viene segnalato.
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

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.restoreAllMocks(); });

describe('i Termini dicono chi gestisce, e il vuoto non e\' silenzioso', () => {
  it('senza variabili, la prima riga dice «gestita da Nicolae Rotaru (MyCity)», non «gestita da MyCity»', async () => {
    comeInProduzione();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { default: TermsPage } = await import('@/app/terms/page');
    const t = testo(renderToStaticMarkup(createElement(TermsPage)));
    expect(t).not.toMatch(/gestita da MyCity\b/);
    expect(t).toMatch(/gestita da Nicolae Rotaru \(MyCity\)/);
  });

  it('il modulo di recesso ha per destinatario la persona, non il solo marchio', async () => {
    comeInProduzione();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { default: TermsPage } = await import('@/app/terms/page');
    const t = testo(renderToStaticMarkup(createElement(TermsPage)));
    const riga = t.match(/Destinatario: ([^\n]*?) Email:/);
    expect(riga, 'il modulo di recesso deve avere un destinatario').not.toBeNull();
    expect((riga as RegExpMatchArray)[1]).toContain('Nicolae Rotaru');
  });

  it('sede, partita IVA e PEC mancanti vengono elencate e segnalate nei registri, senza inventarle', async () => {
    comeInProduzione();
    const avvisi = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('@/lib/legal/titolare');
    const mancanti = mod.datiObbligatoriMancanti(mod.titolare());
    expect(mancanti).toEqual(expect.arrayContaining(['sede', 'partita IVA', 'PEC']));

    const { default: TermsPage } = await import('@/app/terms/page');
    const t = testo(renderToStaticMarkup(createElement(TermsPage)));
    expect(t).not.toMatch(/IT0{6,}|Via Roma 1|mycity@pec\.it/);
    const scritto = avvisi.mock.calls.map((c) => String(c[0])).join('\n');
    expect(scritto).toMatch(/titolare/i);
    expect(scritto).toMatch(/partita IVA/);
  });

  it('con i dati veri messi, non manca niente', async () => {
    vi.stubEnv('NEXT_PUBLIC_TITOLARE_NOME', 'MyCity S.r.l.');
    vi.stubEnv('NEXT_PUBLIC_TITOLARE_INDIRIZZO', 'Via Esempio 3, Piacenza');
    vi.stubEnv('NEXT_PUBLIC_TITOLARE_PIVA', 'IT01234567891');
    vi.stubEnv('NEXT_PUBLIC_TITOLARE_PEC', 'societa@pec.example.it');
    vi.resetModules();
    const mod = await import('@/lib/legal/titolare');
    expect(mod.datiObbligatoriMancanti(mod.titolare())).toEqual([]);
  });
});
