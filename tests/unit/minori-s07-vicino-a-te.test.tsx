/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import NearMePage from '@/app/near/page';
import { accendi, clicca } from './aiuti/schermo';

const CASA = { lat: 45.0526, lng: 9.6929 };
const stato = vi.hoisted(() => ({ elenco: { stores: [] as unknown[], productsByStore: {}, reviewsByStore: {} } }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: stato.elenco, isLoading: false, isError: false, refetch: () => undefined }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/NearbyStoresMapLazy', () => ({ default: () => null }));
vi.mock('@/components/StoreListRow', () => ({ default: ({ store }: { store: { store_name: string } }) => <p>{store.store_name}</p> }));

const smonta: Array<() => void> = [];
afterEach(() => { while (smonta.length) smonta.pop()?.(); });

function monta() {
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: CASA.lat, longitude: CASA.lng } }) },
  });
  const s = accendi(NearMePage);
  smonta.push(s.smonta);
  return s;
}
const bottone = (r: HTMLElement, t: string) => [...r.querySelectorAll('button')].find((b) => b.textContent?.includes(t)) as HTMLButtonElement | undefined;

describe('S07 · «Vicino a te»', () => {
  it('senza posizione e con la lista vuota non invita ad «aumentare il raggio» (il cursore non c’è)', () => {
    stato.elenco = { stores: [], productsByStore: {}, reviewsByStore: {} };
    const s = monta();
    expect(s.radice.querySelector('input[type="range"]')).toBeNull();
    expect(s.radice.textContent).not.toMatch(/Aumenta il raggio/);
    expect(s.radice.textContent).toMatch(/non ci sono negozi da mostrare/);
  });

  it('con la posizione dice dei negozi senza posizione e si torna all’elenco intero', () => {
    stato.elenco = {
      stores: [
        { id: 'a', store_name: 'Forno vicino', store_lat: CASA.lat + 0.005, store_lng: CASA.lng },
        { id: 'b', store_name: 'Bottega senza mappa', store_lat: null, store_lng: null },
      ],
      productsByStore: {}, reviewsByStore: {},
    };
    const s = monta();
    s.agisci(() => clicca(bottone(s.radice, 'Ordina per vicinanza')!));
    expect(s.radice.textContent).toContain('Forno vicino');
    expect(s.radice.textContent).not.toContain('Bottega senza mappa');
    expect(s.radice.textContent).toMatch(/1 negozio non ha ancora la posizione sulla mappa/);
    expect(s.radice.textContent).toMatch(/dall’indirizzo di consegna/);
    s.agisci(() => clicca(bottone(s.radice, 'Mostra tutti i negozi')!));
    expect(s.radice.textContent).toContain('Bottega senza mappa');
    expect(s.radice.textContent).toMatch(/2 negozi a Piacenza/);
  });

  it('arrivata la posizione il raggio non cambia da solo: setRadiusKm si chiama solo dal cursore', () => {
    const src = readFileSync('app/near/page.tsx', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const chiamate = src.match(/setRadiusKm\(/g) ?? [];
    expect(chiamate).toHaveLength(1);
    expect(src).toMatch(/onChange=\{\(e\) => setRadiusKm\(Number\(e\.target\.value\)\)\}/);
  });
});
