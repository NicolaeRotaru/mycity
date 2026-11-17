/**
 * @vitest-environment jsdom
 */
/**
 * R06-008 — Il filtro «Oggi» nei Guadagni del fattorino tagliava la giornata alla mezzanotte del
 * telefono (`setHours(0, 0, 0, 0)`), non a quella di Piacenza. Su un telefono con un altro fuso
 * «Oggi» contava le consegne di ieri o perdeva quelle di stanotte.
 *
 * Qui la pagina VERA, con l'orologio finto e il fuso del processo diverso da Europe/Rome.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { accendi, clicca } from './aiuti/schermo';

const mondo = vi.hoisted(() => ({ consegne: [] as Array<Record<string, unknown>> }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mondo.consegne, isLoading: false, isError: false, refetch: async () => undefined }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/rider/RiderConnectButton', () => ({ default: () => null }));

import RiderEarningsPage from '@/app/rider/earnings/page';

const fusoDiPartenza = process.env.TZ;
let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  mondo.consegne = [];
  vi.useRealTimers();
  if (fusoDiPartenza === undefined) delete process.env.TZ;
  else process.env.TZ = fusoDiPartenza;
});

const consegna = (id: string, deliveredAt: string) => ({
  id, shipping_cost: null, rider_fee_cents: 300, total_price: 20, delivered_at: deliveredAt,
  rider_payout_status: 'paid', payment_method: 'card', delivery_city: 'Piacenza',
});

/** Quante consegne dice il riquadro «Consegne» dopo aver premuto «Oggi». */
async function consegneDiOggi(fusoTelefono: string, adesso: string, consegne: Array<Record<string, unknown>>) {
  process.env.TZ = fusoTelefono;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(adesso));
  mondo.consegne = consegne;
  schermo = accendi(RiderEarningsPage);
  await act(async () => { await Promise.resolve(); });
  const oggi = Array.from(schermo.radice.querySelectorAll('button')).find((b) => b.textContent === 'Oggi');
  expect(oggi, 'il bottone «Oggi»').toBeTruthy();
  await act(async () => { clicca(oggi!); });
  const etichetta = Array.from(schermo.radice.querySelectorAll('p')).find((p) => p.textContent === 'Consegne');
  return Number(etichetta?.nextElementSibling?.textContent);
}

describe('R06-008 · «Oggi» nei guadagni del fattorino è il giorno di Piacenza', () => {
  it('telefono a Greenwich, sabato 7/11 alle 01:00 di Piacenza: la consegna delle 00:30 è di oggi', async () => {
    // 00:00 UTC = 01:00 a Piacenza. Consegna alle 00:30 di Piacenza (23:30 UTC di venerdì).
    const n = await consegneDiOggi('UTC', '2026-11-07T00:00:00Z', [
      consegna('a', '2026-11-06T23:30:00Z'),
      consegna('b', '2026-11-06T22:00:00Z'), // venerdì alle 23:00 di Piacenza: ieri
    ]);
    expect(n, 'la consegna delle 00:30 di Piacenza è sparita da «Oggi»').toBe(1);
  });

  it('telefono a New York, sabato 7/11 alle 01:00 di Piacenza: le consegne di venerdì non sono di oggi', async () => {
    // A New York sono le 19:00 di venerdì: la mezzanotte del telefono è venerdì alle 06:00 di Piacenza.
    const n = await consegneDiOggi('America/New_York', '2026-11-07T00:00:00Z', [
      consegna('c', '2026-11-06T21:00:00Z'), // venerdì 22:00 di Piacenza
      consegna('d', '2026-11-06T12:00:00Z'), // venerdì 13:00 di Piacenza
      consegna('e', '2026-11-06T23:45:00Z'), // sabato 00:45 di Piacenza: oggi
    ]);
    expect(n, '«Oggi» contava le consegne di venerdì').toBe(1);
  });

  it('estate (UTC+2), telefono a Greenwich: alle 01:30 di Piacenza la consegna dell 00:10 è di oggi', async () => {
    const n = await consegneDiOggi('UTC', '2026-07-10T23:30:00Z', [
      consegna('f', '2026-07-10T22:10:00Z'), // sabato 11/7 00:10 di Piacenza
      consegna('g', '2026-07-10T21:50:00Z'), // venerdì 10/7 23:50 di Piacenza
    ]);
    expect(n).toBe(1);
  });
});
