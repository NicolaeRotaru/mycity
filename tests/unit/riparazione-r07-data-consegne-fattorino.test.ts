/**
 * @vitest-environment jsdom
 */
/**
 * R07-009 — Nei Guadagni del fattorino, l'elenco delle consegne scriveva la data con
 * `toLocaleDateString('it-IT')` senza fuso: valeva il fuso del telefono. Una consegna fatta alle
 * 00:30 di Piacenza, su un telefono rimasto all'ora di Greenwich (o di un altro paese), compariva
 * col giorno prima.
 *
 * Qui la pagina VERA, con l'orologio finto e il «telefono» messo apposta su un altro fuso: la data
 * deve essere quella di Piacenza.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { accendi } from './aiuti/schermo';

const mondo = vi.hoisted(() => ({ consegne: [] as Array<Record<string, unknown>> }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mondo.consegne, isLoading: false, isError: false, refetch: async () => undefined }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/rider/RiderConnectButton', () => ({ default: () => null }));

import RiderEarningsPage from '@/app/rider/earnings/page';

let schermo: ReturnType<typeof accendi> | null = null;
const fusoDiPrima = process.env.TZ;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  schermo?.smonta();
  schermo = null;
  mondo.consegne = [];
  vi.useRealTimers();
  if (fusoDiPrima === undefined) delete process.env.TZ;
  else process.env.TZ = fusoDiPrima;
});

const consegna = (id: string, deliveredAt: string) => ({
  id, shipping_cost: null, rider_fee_cents: 300, total_price: 20, delivered_at: deliveredAt,
  rider_payout_status: 'paid', payment_method: 'card', delivery_address: 'Via Roma 1', delivery_city: 'Piacenza',
});

/** Le righe «data · pagamento» dell'elenco delle consegne. */
async function righeDellElenco(fusoDelTelefono: string, adesso: string, consegne: Array<Record<string, unknown>>) {
  process.env.TZ = fusoDelTelefono;
  vi.setSystemTime(new Date(adesso));
  mondo.consegne = consegne;
  schermo = accendi(RiderEarningsPage);
  await act(async () => { await Promise.resolve(); });
  return Array.from(schermo.radice.querySelectorAll('p'))
    .map((p) => (p.textContent ?? '').trim())
    .filter((t) => / · (Carta|Contanti)$/.test(t));
}

describe('R07-009 · la data nell elenco delle consegne è quella di Piacenza', () => {
  it('telefono a Greenwich: la consegna delle 00:30 di sabato 21/11 si legge 21/11, non 20/11', async () => {
    // Sabato 21/11/2026 alle 00:30 a Piacenza (UTC+1) = venerdì 20/11 alle 23:30 UTC.
    const righe = await righeDellElenco('UTC', '2026-11-21T08:00:00Z', [consegna('a', '2026-11-20T23:30:00Z')]);
    expect(righe).toEqual(['21/11/2026 · Carta']);
  });

  it('telefono a New York: stessa consegna, stessa data di Piacenza', async () => {
    const righe = await righeDellElenco('America/New_York', '2026-11-21T08:00:00Z', [consegna('b', '2026-11-20T23:30:00Z')]);
    expect(righe).toEqual(['21/11/2026 · Carta']);
  });

  it('estate (UTC+2): la consegna delle 01:30 di sabato 11/7 si legge 11/07', async () => {
    // Sabato 11/7/2026 alle 01:30 a Piacenza = venerdì 10/7 alle 23:30 UTC.
    const righe = await righeDellElenco('UTC', '2026-07-11T10:00:00Z', [consegna('c', '2026-07-10T23:30:00Z')]);
    expect(righe).toEqual(['11/07/2026 · Carta']);
  });

  it('una consegna di pomeriggio resta nel suo giorno (il fuso non sposta niente di giorno)', async () => {
    const righe = await righeDellElenco('UTC', '2026-11-21T18:00:00Z', [consegna('d', '2026-11-21T15:00:00Z')]);
    expect(righe).toEqual(['21/11/2026 · Carta']);
  });
});
