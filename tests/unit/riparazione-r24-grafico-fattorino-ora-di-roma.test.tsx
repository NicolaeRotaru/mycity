/**
 * @vitest-environment jsdom
 */
/**
 * R24-014 — Il grafico «Ultimi 7 giorni» nei Guadagni del fattorino tagliava i giorni a mezzanotte
 * di Greenwich (`toISOString().slice(0, 10)`): una consegna alle 00:30 di Piacenza finiva nella
 * colonna del giorno prima, e fra mezzanotte e l'una (le due d'estate) mancava la colonna di oggi.
 *
 * Qui la pagina VERA, con l'orologio finto: d'inverno, d'estate e la notte del cambio d'ora.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { formatPrice } from '@/lib/format';
import { accendi } from './aiuti/schermo';

const mondo = vi.hoisted(() => ({ consegne: [] as Array<Record<string, unknown>> }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mondo.consegne, isLoading: false, isError: false, refetch: async () => undefined }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/rider/RiderConnectButton', () => ({ default: () => null }));

import RiderEarningsPage from '@/app/rider/earnings/page';

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  mondo.consegne = [];
  vi.useRealTimers();
});

const consegna = (id: string, deliveredAt: string, centesimi = 300) => ({
  id, shipping_cost: null, rider_fee_cents: centesimi, total_price: 20, delivered_at: deliveredAt,
  rider_payout_status: 'paid', payment_method: 'card', delivery_city: 'Piacenza',
});

/** Le colonne del grafico, dalla più vecchia a oggi: quante consegne e la lettera del giorno. */
async function colonne(adesso: string, consegne: Array<Record<string, unknown>>) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(adesso));
  mondo.consegne = consegne;
  schermo = accendi(RiderEarningsPage);
  await act(async () => { await Promise.resolve(); });
  const barre = Array.from(schermo.radice.querySelectorAll('[title$="consegne"]'));
  return barre.map((b) => ({
    titolo: b.getAttribute('title') ?? '',
    lettera: b.parentElement?.parentElement?.querySelector('span')?.textContent ?? '',
  }));
}

describe('R24-014 · il grafico del fattorino conta i giorni di Piacenza', () => {
  it('inverno: la consegna di sabato 7/11 alle 00:30 sta nella colonna di sabato, non di venerdì', async () => {
    // Sabato 7/11/2026 01:00 a Piacenza (UTC+1) = 00:00 UTC; consegna alle 00:30 di Piacenza.
    const c = await colonne('2026-11-07T00:00:00Z', [consegna('a', '2026-11-06T23:30:00Z')]);
    expect(c).toHaveLength(7);
    expect(c[6].lettera, 'l ultima colonna deve essere oggi, sabato').toBe('S');
    expect(c[6].titolo, 'la consegna dopo mezzanotte è finita nel giorno prima').toBe(`${formatPrice(3)} · 1 consegne`);
    expect(c[5].titolo).toBe(`${formatPrice(0)} · 0 consegne`);
  });

  it('inverno, alle 00:30: la colonna di oggi c è già', async () => {
    // Sabato 7/11/2026 00:30 a Piacenza = venerdì 6/11 23:30 UTC.
    const c = await colonne('2026-11-06T23:30:00Z', []);
    expect(c[6].lettera, 'le sette colonne finiscono a ieri').toBe('S');
  });

  it('estate: la consegna di sabato 11/7 alle 00:30 (UTC+2) sta nella colonna di sabato', async () => {
    const c = await colonne('2026-07-10T23:00:00Z', [consegna('b', '2026-07-10T22:30:00Z', 450)]);
    expect(c[6].lettera).toBe('S');
    expect(c[6].titolo).toBe(`${formatPrice(4.5)} · 1 consegne`);
    expect(c[5].titolo).toBe(`${formatPrice(0)} · 0 consegne`);
  });

  it('la notte del cambio d ora (domenica 25/10): la consegna delle 00:30 sta nella domenica', async () => {
    // Domenica 25/10/2026: alle 03:00 si torna all'ora solare. Alle 00:30 vale ancora UTC+2.
    const c = await colonne('2026-10-25T09:00:00Z', [
      consegna('c', '2026-10-24T22:30:00Z'),
      consegna('d', '2026-10-24T21:30:00Z', 500),
    ]);
    expect(c[6].lettera).toBe('D');
    expect(c[6].titolo, 'la consegna delle 00:30 di domenica').toBe(`${formatPrice(3)} · 1 consegne`);
    expect(c[5].titolo, 'quella delle 23:30 di sabato resta di sabato').toBe(`${formatPrice(5)} · 1 consegne`);
  });
});
