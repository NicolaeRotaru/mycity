/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import NearMePage from '@/app/near/page';
import { RAGGIO_CONSEGNA_KM } from '@/lib/constants';
import { accendi, clicca } from './aiuti/schermo';

/**
 * 28/10/2026 — «VICINO A TE» PARTIVA DA UN 5 SCRITTO A MANO.
 *
 * Il cursore del raggio prendeva il massimo dal confine della cassa (`RAGGIO_CONSEGNA_KM`), ma il
 * punto di partenza era scritto a mano: `useState(5)`. Col confine a 10 (27/10) la pagina si apriva
 * a metà strada; col confine a 5 (correzione di Nicola del 28/10) si apre al massimo, ma solo per
 * caso. Se un giorno il confine scende a 3, la pagina si aprirebbe a 5 km: oltre il massimo del
 * cursore e oltre la cassa, con in lista un negozio a 4 km che poi non si può ordinare.
 *
 * Qui il confine si finge a 3 km e la pagina si monta davvero. L'unico negozio sta a 4 km, cioè fra
 * il confine finto e il vecchio 5 scritto a mano. La pagina deve aprirsi al confine: «Raggio: 3 km»,
 * il cursore in fondo, e il negozio a 4 km fuori dalla lista.
 *
 * Finti: il confine (3 km), l'elenco dei negozi (arriva da useQuery), la mappa, la riga del negozio
 * e la posizione del telefono. La pagina, i suoi stati e il cursore sono veri.
 */

vi.mock('@/lib/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/constants')>()),
  RAGGIO_CONSEGNA_KM: 3,
}));

const CASA = { lat: 45.0526, lng: 9.6929 };
const KM_PER_GRADO = 111.195;
/** L'unico negozio, 4 km a nord della casa: oltre il confine finto (3), dentro il vecchio 5 scritto a mano. */
const ELENCO = {
  stores: [{ id: 'negozio-a-4-km', store_name: 'Bottega a quattro chilometri', store_lat: CASA.lat + 4 / KM_PER_GRADO, store_lng: CASA.lng }],
  productsByStore: {},
  reviewsByStore: {},
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: ELENCO, isLoading: false, isError: false, refetch: () => undefined }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/NearbyStoresMapLazy', () => ({ default: () => null }));
vi.mock('@/components/StoreListRow', () => ({ default: () => null }));

const smontaDopo: Array<() => void> = [];
afterEach(() => {
  while (smontaDopo.length) smontaDopo.pop()?.();
});

describe('«Vicino a te» si apre al confine della cassa, letto da dove è deciso', () => {
  it('la prova finge davvero un confine diverso da quello vero (se no non misura niente)', () => {
    expect(RAGGIO_CONSEGNA_KM).toBe(3);
  });

  it('col confine a 3 km la pagina si apre a 3 km, col cursore in fondo, e il negozio a 4 km non compare', () => {
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) =>
          ok({ coords: { latitude: CASA.lat, longitude: CASA.lng } }),
      },
    });
    const s = accendi(NearMePage);
    smontaDopo.push(s.smonta);
    const bottone = [...s.radice.querySelectorAll('button')].find((b) => b.textContent?.includes('Ordina per vicinanza'));
    expect(bottone, 'la pagina non offre più di ordinare per vicinanza: la prova non arriva al cursore').toBeTruthy();
    s.agisci(() => clicca(bottone as HTMLButtonElement));
    const cursore = s.radice.querySelector('input[type="range"]') as HTMLInputElement | null;
    expect(cursore, 'con la posizione il cursore del raggio non compare').toBeTruthy();
    expect(cursore?.max, 'il massimo del cursore non è il confine della cassa').toBe('3');

    const testo = (s.radice.textContent ?? '').replace(/\s+/g, ' ');
    expect(testo, 'la pagina si apre a un raggio scritto a mano, non al confine della cassa').toContain('Raggio: 3 km');
    expect(testo, 'la pagina conta i negozi oltre il confine della cassa').toContain('0 negozi entro 3 km');
    expect(testo, 'la pagina si apre oltre il confine della cassa').not.toMatch(/entro 5 km/);
  });
});
