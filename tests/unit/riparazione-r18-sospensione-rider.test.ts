import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R18-025 — sospendere un fattorino gli toglie le consegne non ancora ritirate.
 *
 * La rotta di moderazione (app/api/admin/users/[id]/moderate/route.ts) cambiava solo il
 * profilo: le consegne ASSIGNED restavano al sospeso, che poteva ancora ritirarle. Ora
 * tornano in bacheca (READY, senza fattorino); quelle con la merce già in mano
 * (PICKED_UP, OUT_FOR_DELIVERY) restano, e l'avviso all'amministratore le conta.
 *
 * Il finto Supabase tiene gli ordini in memoria e applica i filtri come il database:
 * un update tocca solo le righe che combaciano con TUTTI i filtri.
 */

type Riga = Record<string, unknown>;
const db = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
  ordini: [] as Record<string, unknown>[],
  erroreBacheca: null as { message: string } | null,
}));

vi.mock('@/lib/audit', () => ({ writeAudit: async () => {} }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true, id: 'm' }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (c: unknown) => unknown) => async (req: Request) =>
    h({ req, user: { id: 'admin-1' }, params: { id: 'fattorino-1' } }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'luca@example.com' } } }) } },
    from: (t: string) => {
      if (t === 'profiles') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: db.profilo ? { ...db.profilo } : null, error: null }) }) }),
          update: (patch: Riga) => {
            const b: Record<string, unknown> = {
              eq: () => b,
              is: () => b,
              then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
                db.profilo = { ...db.profilo, ...patch };
                return Promise.resolve({ error: null, count: 1 }).then(ok, ko);
              },
            };
            return b;
          },
        };
      }
      if (t === 'orders') {
        const filtri: Array<(r: Riga) => boolean> = [];
        let patch: Riga | null = null;
        const b: Record<string, unknown> = {
          update: (p: Riga) => { patch = p; return b; },
          eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return b; },
          // l'update si chiude con .select('id'), il conteggio con .select(…, { head: true })
          select: (_c: string, opz?: { head?: boolean }) => {
            if (patch && !opz?.head) {
              if (db.erroreBacheca) return Promise.resolve({ data: null, error: db.erroreBacheca });
              const toccate = db.ordini.filter((r) => filtri.every((f) => f(r)));
              toccate.forEach((r) => Object.assign(r, patch));
              return Promise.resolve({ data: toccate.map((r) => ({ id: r.id })), error: null });
            }
            return b;
          },
          in: async (c: string, valori: unknown[]) => ({
            count: db.ordini.filter((r) => filtri.every((f) => f(r)) && valori.includes(r[c])).length,
            error: null,
          }),
        };
        return b;
      }
      return { insert: async () => ({ error: null }) };
    },
  }),
}));

import { POST } from '@/app/api/admin/users/[id]/moderate/route';
const MODERA = POST as unknown as (r: Request) => Promise<Response>;

function modera(action: string, reason?: string) {
  return MODERA(new Request('http://x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(reason ? { action, reason } : { action }),
  }));
}

const FATTORINO = {
  id: 'fattorino-1', role: 'rider', store_name: null, full_name: 'Luca', legal_birth_date: '1990-01-01',
  approval_status: 'approved', approved_by: 'admin-0', kyc_id_doc_front_url: 'f', kyc_selfie_url: 's',
  rider_license_url: 'p', rider_insurance_url: 'rc', rider_license_expires_on: '2099-01-01', rider_insurance_expires_on: '2099-01-01',
};

function ordine(id: string, rider_id: string | null, delivery_status: string): Riga {
  return { id, rider_id, delivery_status, rider_lat: 45.05, rider_lng: 9.69, rider_position_updated_at: '2026-11-13T10:00:00Z' };
}

type Risposta = { ok: boolean; consegne_in_corso: number | null; rimesse_in_bacheca?: number | null; avviso?: string };

beforeEach(() => {
  db.profilo = { ...FATTORINO };
  db.erroreBacheca = null;
  db.ordini = [
    ordine('o-assegnato-1', 'fattorino-1', 'ASSIGNED'),
    ordine('o-assegnato-2', 'fattorino-1', 'ASSIGNED'),
    ordine('o-ritirato', 'fattorino-1', 'PICKED_UP'),
    ordine('o-in-strada', 'fattorino-1', 'OUT_FOR_DELIVERY'),
    ordine('o-consegnato', 'fattorino-1', 'DELIVERED'),
    ordine('o-di-un-altro', 'fattorino-2', 'ASSIGNED'),
  ];
});

const stato = (id: string) => db.ordini.find((r) => r.id === id)!;

describe('R18-025 — la sospensione rimette in bacheca le consegne non ancora ritirate', () => {
  it('le ASSIGNED del sospeso tornano READY senza fattorino né posizione', async () => {
    const r = await modera('suspend', 'controllo in corso');
    expect(r.status).toBe(200);
    for (const id of ['o-assegnato-1', 'o-assegnato-2']) {
      expect(stato(id)).toMatchObject({ rider_id: null, delivery_status: 'READY', rider_lat: null, rider_lng: null, rider_position_updated_at: null });
    }
  });

  it('non tocca le consegne con la merce in mano, le chiuse e quelle di un altro fattorino', async () => {
    await modera('suspend', 'controllo in corso');
    expect(stato('o-ritirato')).toMatchObject({ rider_id: 'fattorino-1', delivery_status: 'PICKED_UP' });
    expect(stato('o-in-strada')).toMatchObject({ rider_id: 'fattorino-1', delivery_status: 'OUT_FOR_DELIVERY' });
    expect(stato('o-consegnato')).toMatchObject({ rider_id: 'fattorino-1', delivery_status: 'DELIVERED' });
    expect(stato('o-di-un-altro')).toMatchObject({ rider_id: 'fattorino-2', delivery_status: 'ASSIGNED' });
  });

  it('l’avviso conta solo quelle rimaste in mano al sospeso, e la risposta dice quante sono tornate in bacheca', async () => {
    const j = (await (await modera('suspend', 'controllo in corso')).json()) as Risposta;
    expect(j.rimesse_in_bacheca).toBe(2);
    expect(j.consegne_in_corso).toBe(2);
    expect(j.avviso).toMatch(/ancora 2 consegne in corso/);
  });

  it('se la bacheca non si riempie, l’avviso lo dice e il conteggio comprende le ASSIGNED rimaste', async () => {
    db.erroreBacheca = { message: 'timeout' };
    const j = (await (await modera('suspend', 'controllo in corso')).json()) as Risposta;
    expect(stato('o-assegnato-1')).toMatchObject({ rider_id: 'fattorino-1', delivery_status: 'ASSIGNED' });
    expect(j.rimesse_in_bacheca).toBeNull();
    expect(j.consegne_in_corso).toBe(4);
    expect(j.avviso).toMatch(/non ho potuto rimettere in bacheca/);
  });

  it('sospendere un negozio non tocca gli ordini dei fattorini', async () => {
    db.profilo = { id: 'fattorino-1', role: 'seller', store_name: 'Forno', full_name: 'Anna', legal_birth_date: null,
      approval_status: 'approved', approved_by: 'admin-0', business_vat_number: '01234567897' };
    await modera('suspend', 'controllo in corso');
    expect(stato('o-assegnato-1')).toMatchObject({ rider_id: 'fattorino-1', delivery_status: 'ASSIGNED' });
  });

  it('riattivare un fattorino non tocca le consegne', async () => {
    db.profilo = { ...FATTORINO, approval_status: 'suspended' };
    expect((await modera('reactivate')).status).toBe(200);
    expect(stato('o-assegnato-1')).toMatchObject({ rider_id: 'fattorino-1', delivery_status: 'ASSIGNED' });
  });
});
