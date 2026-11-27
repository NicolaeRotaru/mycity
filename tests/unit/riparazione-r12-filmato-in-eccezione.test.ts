/**
 * R12-003 — Il cancello del filmato in eccezione lasciava passare il filmato originale.
 *
 * `filmatoSenzaDatiPersonali` pulisce quello che PostHog mette in `$snapshot_data`
 * prima che esca dal browser. Se dentro il filmato qualcosa lancia (un getter
 * rotto, un Proxy revocato), il cancello restituiva il filmato ORIGINALE: con la
 * targa che porta `/search?q=<email>` ancora dentro. Un cancello che nel dubbio
 * apre non e' un cancello: in eccezione si chiude a chiave (`***`), come fa gia'
 * `strutturaSenzaIndirizzi` e come a fine budget.
 */
import { describe, expect, it } from 'vitest';
import { filmatoSenzaDatiPersonali } from '@/lib/analytics/filmato-senza-dati-personali';
import { VALORE_NASCOSTO } from '@/lib/analytics/indirizzo-senza-dati-personali';

/** La targa del filmato rrweb (Meta, tipo 4): porta l'indirizzo intero letto dal browser. */
const targa = (href: string) => ({ type: 4, data: { href, width: 390, height: 844 }, timestamp: 1 });

describe('R12-003 — il cancello del filmato quando qualcosa dentro lancia', () => {
  it('un getter rotto in un fotogramma: non torna il filmato originale con la ricerca, torna chiuso a chiave', () => {
    const fotogrammaRotto = {
      type: 5,
      get data(): unknown {
        throw new Error('getter rotto');
      },
    };
    const originale = [targa('https://mycity.example/search?q=mario.rossi%40gmail.com'), fotogrammaRotto];
    const pulito = filmatoSenzaDatiPersonali(originale);
    // Confronti come booleani: stampare l'originale rifarebbe scattare il getter.
    expect(pulito === originale, 'in eccezione e\' passato il filmato originale').toBe(false);
    expect(pulito === VALORE_NASCOSTO, 'in eccezione non si e\' chiuso a chiave').toBe(true);
  });

  it('un Proxy revocato dentro la targa: chiuso a chiave, non il filmato originale', () => {
    const { proxy, revoke } = Proxy.revocable({ href: '/search?q=3331234567' }, {});
    revoke();
    const originale = [targa('/search?q=mario.rossi%40gmail.com'), { type: 4, data: proxy }];
    const pulito = filmatoSenzaDatiPersonali(originale);
    expect(pulito === originale, 'in eccezione e\' passato il filmato originale').toBe(false);
    expect(pulito === VALORE_NASCOSTO, 'in eccezione non si e\' chiuso a chiave').toBe(true);
  });

  it('senza eccezioni pulisce come prima: la targa perde la ricerca, il DOM passa intero', () => {
    const dom = { type: 2, data: { node: { href: '/stile.css' } } };
    const pulito = filmatoSenzaDatiPersonali([targa('/search?q=mario.rossi%40gmail.com'), dom]) as Array<Record<string, unknown>>;
    expect(Array.isArray(pulito)).toBe(true);
    expect(JSON.stringify(pulito[0])).not.toContain('mario.rossi');
    expect(pulito[1]).toBe(dom);
  });
});
