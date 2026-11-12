import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R08-002 — un negozio già approvato senza partita IVA adesso la può inserire
 * (app/api/seller/partita-iva). Prima l'unico modulo (/api/seller/apply)
 * rispondeva 409 a chi era approvato e 403 a chi era sospeso.
 *
 * Il finto Supabase applica i filtri dell'update come il database: tocca la
 * riga solo se combaciano tutti, e restituisce quante righe ha toccato.
 */

type Riga = Record<string, unknown>;
const db = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
  scritture: 0,
  avvisi: [] as string[],
  utente: 'negozio-1',
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: async (t: string) => { db.avvisi.push(t); } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, h: (c: unknown) => unknown) => async (req: Request) =>
    h({ req, user: { id: db.utente } }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.profilo ? { ...db.profilo } : null, error: null }) }) }),
      update: (patch: Riga) => {
        const filtri: Array<(r: Riga) => boolean> = [];
        const b: Record<string, unknown> = {
          eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return b; },
          or: (espr: string) => {
            // l'unica forma usata: «colonna.is.null,colonna.eq.» → vuota
            const col = espr.split('.')[0];
            filtri.push((r) => r[col] == null || r[col] === '');
            return b;
          },
          then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
            const r = db.profilo;
            const tocca = Boolean(r && filtri.every((f) => f(r)));
            if (tocca) { db.profilo = { ...r, ...patch }; db.scritture += 1; }
            return Promise.resolve({ error: null, count: tocca ? 1 : 0 }).then(ok, ko);
          },
        };
        return b;
      },
    }),
  }),
}));

import { POST } from '@/app/api/seller/partita-iva/route';
const INVIA = POST as unknown as (r: Request) => Promise<Response>;

const invia = (partitaIva: unknown) =>
  INVIA(new Request('http://x/api/seller/partita-iva', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ partitaIva }),
  }));

// 01234567897 ha la cifra di controllo giusta (la stessa usata dalle prove dell'approvazione)
const VALIDA = '01234567897';
const STORICO = { id: 'negozio-1', role: 'seller', approval_status: 'approved', business_vat_number: null, store_name: 'Forno Storico' };

beforeEach(() => {
  db.scritture = 0; db.avvisi = []; db.utente = 'negozio-1';
});

describe('R08-002 — la partita IVA di chi è già approvato', () => {
  it('un negozio approvato senza partita IVA la inserisce: 200 e la colonna scritta', async () => {
    db.profilo = { ...STORICO };
    const r = await invia(`IT ${VALIDA}`);
    expect(r.status).toBe(200);
    expect(db.profilo?.business_vat_number).toBe(VALIDA);
    expect(db.avvisi).toHaveLength(1);
  });

  it('anche un negozio sospeso (lo stato che /sell rifiuta con 403)', async () => {
    db.profilo = { ...STORICO, approval_status: 'suspended', business_vat_number: '' };
    expect((await invia(VALIDA)).status).toBe(200);
    expect(db.profilo?.business_vat_number).toBe(VALIDA);
  });

  it('se la partita IVA c’è già risponde 409 e non la cambia', async () => {
    db.profilo = { ...STORICO, business_vat_number: '12345678903' };
    expect((await invia(VALIDA)).status).toBe(409);
    expect(db.profilo?.business_vat_number).toBe('12345678903');
    expect(db.scritture).toBe(0);
  });

  it('una partita IVA sbagliata (cifra di controllo) risponde 400', async () => {
    db.profilo = { ...STORICO };
    expect((await invia('01234567890')).status).toBe(400);
    expect((await invia('00000000000')).status).toBe(400);
    expect(db.scritture).toBe(0);
  });

  it('un cliente non scrive una partita IVA da qui: 403', async () => {
    db.profilo = { ...STORICO, role: 'buyer', approval_status: null };
    expect((await invia(VALIDA)).status).toBe(403);
    expect(db.scritture).toBe(0);
  });

  it('un negozio in attesa usa il modulo /sell: 409', async () => {
    db.profilo = { ...STORICO, approval_status: 'pending' };
    expect((await invia(VALIDA)).status).toBe(409);
  });

  it('due invii insieme ne scrivono uno solo', async () => {
    db.profilo = { ...STORICO };
    const [a, b] = await Promise.all([invia(VALIDA), invia('12345678903')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(db.scritture).toBe(1);
  });
});
