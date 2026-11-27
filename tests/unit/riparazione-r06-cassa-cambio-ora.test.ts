import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * R06 — Nelle domeniche del cambio d'ora la giornata di cassa del fattorino
 * dura 25 ore (autunno) o 23 (primavera). La fine della giornata è la
 * mezzanotte del giorno dopo, non l'inizio più 24 ore; «ieri» è il giorno di
 * calendario prima di oggi, non adesso meno 24 ore.
 *
 * Date esplicite: domenica 25/10/2026 (autunno) e domenica 28/3/2027
 * (primavera). Il giro notturno gira con un orologio finto.
 */

type Riga = {
  delivered_at: string;
  total_price: number;
  cash_collected_cents: number;
  rider_fee_cents: number;
  shipping_cost: number;
  pickup_in_store: boolean;
};

/** Un client finto che filtra davvero per `delivered_at` come farebbe il database. */
function clientCassa(righe: Riga[]) {
  const scritte: Array<Record<string, unknown>> = [];
  let da = '';
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.gte = (_c: string, v: string) => {
    da = v;
    return q;
  };
  q.lt = async (_c: string, a: string) => {
    const t0 = new Date(da).getTime();
    const t1 = new Date(a).getTime();
    const dentro = righe.filter((r) => {
      const t = new Date(r.delivered_at).getTime();
      return t >= t0 && t < t1;
    });
    return { data: dentro, error: null };
  };
  const admin = {
    from: (t: string) =>
      t === 'orders'
        ? q
        : {
            upsert: async (riga: Record<string, unknown>) => {
              scritte.push(riga);
              return { error: null };
            },
          },
  };
  return { admin: admin as never, scritte };
}

/** Un contrassegno da 15 € consegnato a quell'istante, senza compenso trattenuto: atteso 1500 centesimi. */
function contrassegno(deliveredAt: string, incassatoCents = 1500): Riga {
  return {
    delivered_at: deliveredAt,
    total_price: 15,
    cash_collected_cents: incassatoCents,
    rider_fee_cents: 0,
    shipping_cost: 0,
    pickup_in_store: false,
  };
}

describe('quadratura — la giornata finisce alla mezzanotte del giorno dopo', () => {
  it('autunno, domenica 25/10/2026: la consegna delle 23:30 entra nella domenica', async () => {
    const { aggiornaQuadratura } = await import('@/lib/cassa/quadratura');
    // 23:30 ora solare (CET, +1) di domenica 25 = 22:30 UTC.
    const righe = [contrassegno('2026-10-25T22:30:00.000Z', 250)];
    const { admin, scritte } = clientCassa(righe);
    await aggiornaQuadratura(admin, 'marco', '2026-10-25');
    expect(scritte).toHaveLength(1);
    expect(scritte[0]).toMatchObject({ for_date: '2026-10-25', expected_cents: 1500, collected_cents: 250, status: 'MISMATCH' });
  });

  it('autunno: la stessa consegna non entra nel lunedì 26/10/2026', async () => {
    const { aggiornaQuadratura } = await import('@/lib/cassa/quadratura');
    const { admin, scritte } = clientCassa([contrassegno('2026-10-25T22:30:00.000Z', 250)]);
    await aggiornaQuadratura(admin, 'marco', '2026-10-26');
    expect(scritte[0]).toMatchObject({ for_date: '2026-10-26', expected_cents: 0, collected_cents: 0 });
  });

  it('primavera, domenica 28/3/2027: la consegna delle 00:30 di lunedì non conta nella domenica', async () => {
    const { aggiornaQuadratura } = await import('@/lib/cassa/quadratura');
    // 00:30 ora legale (CEST, +2) di lunedì 29 = 22:30 UTC di domenica 28.
    const righe = [contrassegno('2027-03-28T22:30:00.000Z', 250), contrassegno('2027-03-28T10:00:00.000Z')];
    const { admin, scritte } = clientCassa(righe);
    await aggiornaQuadratura(admin, 'marco', '2027-03-28');
    expect(scritte[0]).toMatchObject({ for_date: '2027-03-28', expected_cents: 1500, collected_cents: 1500, status: 'OK' });
  });

  it('primavera: la consegna delle 00:30 conta nel lunedì 29/3/2027, una volta sola', async () => {
    const { aggiornaQuadratura } = await import('@/lib/cassa/quadratura');
    const { admin, scritte } = clientCassa([contrassegno('2027-03-28T22:30:00.000Z', 250)]);
    await aggiornaQuadratura(admin, 'marco', '2027-03-29');
    expect(scritte[0]).toMatchObject({ for_date: '2027-03-29', expected_cents: 1500, collected_cents: 250 });
  });
});

describe('riquadra-casse — «ieri» è il giorno di calendario', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock('@/lib/cassa/quadratura');
    vi.doUnmock('@/lib/supabase/server');
    vi.doUnmock('@/lib/logger');
  });

  async function giro(adesso: string, consegne: Array<{ rider_id: string; delivered_at: string }>) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(adesso));
    vi.resetModules();
    const rifatte: string[] = [];
    vi.doMock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
    vi.doMock('@/lib/cassa/quadratura', async (orig) => ({
      ...(await orig<typeof import('@/lib/cassa/quadratura')>()),
      aggiornaQuadratura: async (_a: unknown, riderId: string, giorno: string) => {
        rifatte.push(`${riderId}|${giorno}`);
      },
    }));
    let da = '';
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.gte = (_c: string, v: string) => {
      da = v;
      return q;
    };
    q.not = async () => ({
      data: consegne.filter((c) => new Date(c.delivered_at).getTime() >= new Date(da).getTime()),
      error: null,
    });
    q.upsert = async () => ({ error: null });
    q.insert = async () => ({ error: null });
    vi.doMock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({ from: () => q }) }));
    vi.stubEnv('CRON_SECRET', 's');
    vi.stubEnv('LAVORI_A_ORARIO', 'accesi');
    const { POST } = await import('@/app/api/cron/riquadra-casse/route');
    const r = await (POST as unknown as (r: Request) => Promise<Response>)(
      new Request('http://x/api/cron/riquadra-casse', { headers: { authorization: 'Bearer s' } }),
    );
    return { status: r.status, rifatte };
  }

  it('alle 00:30 di lunedì 29/3/2027 rifà la domenica 28, non il sabato', async () => {
    // 00:30 CEST di lunedì 29 = 22:30 UTC di domenica 28. Adesso − 24 ore è sabato.
    const { status, rifatte } = await giro('2027-03-28T22:30:00.000Z', [
      { rider_id: 'marco', delivered_at: '2027-03-28T18:00:00.000Z' }, // domenica 20:00
    ]);
    expect(status).toBe(200);
    expect(rifatte).toEqual(['marco|2027-03-28']);
  });

  it('alle 23:30 di lunedì 26/10/2026 legge anche la prima mezz\'ora di domenica 25', async () => {
    // 23:30 CET di lunedì 26 = 22:30 UTC. Adesso − 48 ore è domenica 00:30 CEST.
    const { status, rifatte } = await giro('2026-10-26T22:30:00.000Z', [
      { rider_id: 'marco', delivered_at: '2026-10-24T22:15:00.000Z' }, // domenica 25 alle 00:15 CEST
    ]);
    expect(status).toBe(200);
    expect(rifatte).toEqual(['marco|2026-10-25']);
  });
});
