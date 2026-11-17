import { describe, it, expect } from 'vitest';
import { safeInternalPath } from '@/lib/safe-redirect';

/**
 * La pagina delle storie controlla il link con `safeInternalPath` PRIMA di
 * caricare la foto. Il database poi lo vincola con
 * `link_url ~ '^/([^/\\]|$)' AND link_url !~ '[[:cntrl:]]'` (migrations/403).
 * `[[:cntrl:]]` del database (glibc, UTF-8) è U+0000–U+001F, U+007F–U+009F e
 * U+2028–U+2029; il controllo del sito rifiutava solo C0 e DEL. Un link con un
 * C1 (per esempio U+0085) passava, la foto si caricava, e poi l'inserimento
 * falliva lasciando la foto orfana.
 */

/** La classe [[:cntrl:]] del database, come la definisce glibc (i18n_ctype). */
const CNTRL_DEL_DATABASE: Array<[number, number]> = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x2028, 0x2029],
];

/** Il CHECK `seller_stories_link_dentro_mycity` della 403, riscritto in JS. */
function ilDatabaseAccetta(link: string): boolean {
  const cntrl = CNTRL_DEL_DATABASE.some(([da, a]) =>
    [...link].some((c) => {
      const n = c.codePointAt(0) ?? 0;
      return n >= da && n <= a;
    }),
  );
  return /^\/([^/\\]|$)/.test(link) && !cntrl;
}

describe('il link delle storie: quello che il sito accetta, il database non lo rifiuta', () => {
  it('un C1 nel mezzo (U+0085) non passa', () => {
    expect(safeInternalPath('/negozio/forno\u0085pane', '')).toBe('');
  });

  it('nessun carattere della classe [[:cntrl:]] del database passa il controllo del sito', () => {
    const passati: string[] = [];
    for (const [da, a] of CNTRL_DEL_DATABASE) {
      for (let n = da; n <= a; n += 1) {
        const link = `/negozio/forno${String.fromCodePoint(n)}pane`;
        const esito = safeInternalPath(link, '');
        if (esito && !ilDatabaseAccetta(esito)) passati.push(`U+${n.toString(16).toUpperCase().padStart(4, '0')}`);
      }
    }
    expect(passati, 'il sito accetta caratteri che il database poi rifiuta').toEqual([]);
  });

  it('i link buoni passano ancora, e il database li accetta', () => {
    for (const link of ['/negozio/forno', '/prodotto/123?colore=rosso', '/eventi/sagra\u00a0del\u00a0pane', '/']) {
      const esito = safeInternalPath(link, '');
      expect(esito, link).toBe(link);
      expect(ilDatabaseAccetta(esito), link).toBe(true);
    }
  });
});
