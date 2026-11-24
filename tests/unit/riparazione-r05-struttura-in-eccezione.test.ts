/**
 * `strutturaSenzaIndirizzi` è la rete che pulisce le proprietà dirette a PostHog (dal browser e dal
 * server). Se dentro la struttura qualcosa lancia (un getter rotto, un Proxy revocato), la rete
 * restituiva il valore ORIGINALE: con l'email e l'indirizzo con la ricerca ancora dentro. Un cancello
 * che nel dubbio apre non è un cancello: in eccezione si chiude a chiave (`***`), come quando finisce
 * il budget.
 */
import { describe, expect, it } from 'vitest';
import { strutturaSenzaIndirizzi } from '@/lib/analytics/filmato-senza-dati-personali';
import { VALORE_NASCOSTO } from '@/lib/analytics/indirizzo-senza-dati-personali';

describe('strutturaSenzaIndirizzi quando qualcosa dentro lancia', () => {
  it('un getter che lancia: non torna l\'originale con email e ricerca, torna chiuso a chiave', () => {
    const originale = {
      email: 'mario.rossi@gmail.com',
      pagina: 'https://mycity.example/search?q=mario.rossi%40gmail.com',
      get rotto(): string {
        throw new Error('getter rotto');
      },
    };
    const pulito = strutturaSenzaIndirizzi(originale);
    // Confronti come booleani: stampare l'originale rifarebbe scattare il getter.
    expect(pulito === originale, 'in eccezione è passato il valore originale').toBe(false);
    expect(pulito === VALORE_NASCOSTO, 'in eccezione non si è chiuso a chiave').toBe(true);
  });

  it('un Proxy revocato dentro un elenco: chiuso a chiave, non l\'elenco originale', () => {
    const { proxy, revoke } = Proxy.revocable({ attr__href: '/search?q=3331234567' }, {});
    revoke();
    const originale = [{ attr__href: '/search?q=mario.rossi%40gmail.com' }, proxy];
    const pulito = strutturaSenzaIndirizzi(originale);
    expect(pulito === originale, 'in eccezione è passato l\'elenco originale').toBe(false);
    expect(pulito === VALORE_NASCOSTO, 'in eccezione non si è chiuso a chiave').toBe(true);
  });

  it('senza eccezioni pulisce come prima, pezzo per pezzo', () => {
    const pulito = strutturaSenzaIndirizzi({ email: 'mario.rossi@gmail.com', n: 3 }) as Record<string, unknown>;
    expect(pulito).toEqual({ email: VALORE_NASCOSTO, n: 3 });
  });
});
