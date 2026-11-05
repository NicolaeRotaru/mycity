/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import NearMePage from '@/app/near/page';
import { RAGGIO_CONSEGNA_KM } from '@/lib/constants';
import { accendi, clicca } from './aiuti/schermo';

/**
 * 5/11/2026 (S04, scheda 2093) — La prova sorella finge solo un confine SOTTO i 5 km (3). Il mutante
 * `useState<number>(Math.min(5, RAGGIO_CONSEGNA_KM))` resta verde lì e col vero 5, ma con un confine
 * più largo riaprirebbe la pagina a metà (5 km invece di 8), come il 27/10. Qui il confine finto è 8
 * e il negozio sta a 6 km: dentro il confine della cassa, fuori dal vecchio 5.
 */

vi.mock('@/lib/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/constants')>()),
  RAGGIO_CONSEGNA_KM: 8,
}));

const CASA = { lat: 45.0526, lng: 9.6929 };
const KM_PER_GRADO = 111.195;
/** L'unico negozio, 6 km a nord della casa: dentro il confine finto (8), oltre il vecchio 5 scritto a mano. */
const ELENCO = {
  stores: [{ id: 'negozio-a-6-km', store_name: 'Bottega a sei chilometri', store_lat: CASA.lat + 6 / KM_PER_GRADO, store_lng: CASA.lng }],
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
    expect(RAGGIO_CONSEGNA_KM).toBe(8);
  });

  it('col confine a 8 km la pagina si apre a 8 km, col cursore in fondo, e il negozio a 6 km compare', () => {
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
    expect(cursore?.max, 'il massimo del cursore non è il confine della cassa').toBe('8');
    expect(cursore?.value, 'il cursore non parte dal confine della cassa').toBe('8');

    const testo = (s.radice.textContent ?? '').replace(/\s+/g, ' ');
    expect(testo, 'la pagina si apre a un raggio scritto a mano, non al confine della cassa').toContain('Raggio: 8 km');
    expect(testo, 'il negozio a 6 km, dentro il confine, non è contato').toMatch(/\b1 negozi[oi]? entro 8 km/);
    expect(testo, 'la pagina si apre oltre il confine della cassa').not.toMatch(/entro 5 km/);
  });
});
