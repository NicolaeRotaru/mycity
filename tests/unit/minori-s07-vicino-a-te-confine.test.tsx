/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import NearMePage from '@/app/near/page';
import { accendi, clicca } from './aiuti/schermo';

vi.mock('@/lib/constants', async (orig) => ({ ...(await orig<object>()), RAGGIO_CONSEGNA_KM: 7.5 }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { stores: [], productsByStore: {}, reviewsByStore: {} }, isLoading: false, isError: false, refetch: () => undefined }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/NearbyStoresMapLazy', () => ({ default: () => null }));
vi.mock('@/components/StoreListRow', () => ({ default: () => null }));

describe('S07 · «Vicino a te» con un confine non intero (7,5 km)', () => {
  it('il cursore può stare sul valore d’apertura e l’etichetta lo scrive con la virgola', () => {
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 45.05, longitude: 9.69 } }) },
    });
    const s = accendi(NearMePage);
    const b = [...s.radice.querySelectorAll('button')].find((x) => x.textContent?.includes('Ordina per vicinanza'))!;
    s.agisci(() => clicca(b));
    const cursore = s.radice.querySelector('input[type="range"]') as HTMLInputElement;
    const passo = Number(cursore.step);
    const min = Number(cursore.min);
    expect(Number.isInteger((7.5 - min) / passo), `col passo ${passo} da ${min} il 7,5 non si raggiunge`).toBe(true);
    expect(cursore.value).toBe('7.5');
    expect(s.radice.textContent).toContain('Raggio: 7,5 km');
    s.smonta();
  });
});
