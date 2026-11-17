/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * R01-010 — Le visualizzazioni e i clic dei prodotti sponsorizzati non arrivavano mai al
 * database. `supabase.rpc(...)` spedisce la richiesta solo quando qualcuno ne aspetta la risposta
 * (`then`/`await`): il carosello la preparava con `void` davanti e non la mandava mai. Il client
 * finto delle prove fa lo stesso (aiuti/finti/supabase-client.mjs: la funzione arriva al database
 * della prova solo all'attesa), quindi qui si conta cosa arriva DAVVERO al database.
 *
 * Si monta il carosello vero con un annuncio, si fa entrare la scheda nello schermo per più di
 * un secondo (la regola della visualizzazione) e la si tocca.
 */

const globali = globalThis as Record<string, unknown>;
const arrivate: Array<{ nome: string; argomenti: unknown }> = [];

type Richiamo = (voci: Array<{ target: Element; isIntersecting: boolean; intersectionRatio: number }>) => void;
const osservatori: Array<{ richiamo: Richiamo; osservati: Element[] }> = [];

class OsservatoreFinto {
  osservati: Element[] = [];
  constructor(richiamo: Richiamo) {
    osservatori.push({ richiamo, osservati: this.osservati });
  }
  observe(el: Element) { this.osservati.push(el); }
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

afterEach(() => {
  document.body.innerHTML = '';
  arrivate.length = 0;
  osservatori.length = 0;
  for (const k of ['__CLIENT_SUPABASE__', '__DATI_QUERY__']) globali[k] = undefined;
  vi.unstubAllGlobals();
});

describe('R01-010 — visualizzazioni e clic degli annunci arrivano al database', () => {
  it('scheda vista per più di un secondo → una visualizzazione; toccata → un clic', async () => {
    globali.__CLIENT_SUPABASE__ = {
      rpc: (nome: string, argomenti: unknown) => {
        arrivate.push({ nome, argomenti });
        return Promise.resolve({ data: null, error: null });
      },
    };
    globali.__DATI_QUERY__ = [
      { id: 'camp-1', product_id: 'p1', product: { id: 'p1', name: 'Focaccia', price: 4, images: [], seller_id: 's1', profiles: { store_name: 'Forno' } } },
    ];
    vi.stubGlobal('IntersectionObserver', OsservatoreFinto);

    const Carosello = (await monta('components/SponsoredCarousel.tsx')).default;
    const s = accendi(Carosello as never, { placement: 'home_top' });
    for (let i = 0; i < 5; i++) await attendi();

    const scheda = document.querySelector('a[data-campagna="camp-1"]');
    expect(scheda, 'controprova: la scheda dell annuncio si deve vedere').toBeTruthy();
    expect(osservatori.length, 'controprova: il carosello deve guardare le schede').toBeGreaterThan(0);
    const o = osservatori[osservatori.length - 1];
    expect(o.osservati).toContain(scheda);

    // Metà scheda nello schermo, per più di un secondo.
    s.agisci(() => o.richiamo([{ target: scheda!, isIntersecting: true, intersectionRatio: 0.6 }]));
    await new Promise((r) => setTimeout(r, 1150));
    for (let i = 0; i < 5; i++) await attendi();
    expect(
      arrivate.filter((a) => a.nome === 'track_sponsored_impression'),
      'la visualizzazione non è arrivata al database',
    ).toEqual([{ nome: 'track_sponsored_impression', argomenti: { p_id: 'camp-1' } }]);

    // Il tocco sulla scheda (la pagina del prodotto, in jsdom, non si apre: si ferma il cambio pagina).
    const fermaIlCambioPagina = (e: Event) => e.preventDefault();
    document.addEventListener('click', fermaIlCambioPagina);
    s.agisci(() => clicca(scheda!));
    for (let i = 0; i < 5; i++) await attendi();
    document.removeEventListener('click', fermaIlCambioPagina);
    expect(
      arrivate.filter((a) => a.nome === 'track_sponsored_click'),
      'il clic non è arrivato al database',
    ).toEqual([{ nome: 'track_sponsored_click', argomenti: { p_id: 'camp-1' } }]);
    s.smonta();
  }, 60000);
});
