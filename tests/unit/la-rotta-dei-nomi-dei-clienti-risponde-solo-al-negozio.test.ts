/**
 * 1/11/2026 — La rotta /api/chat/nomi-clienti dà il nome del cliente SOLO al
 * negozio della conversazione: il negozio riceve il nome della sua cliente e
 * non quello dei clienti degli altri; chi non è il negozio di nessuna
 * conversazione riceve una mappa vuota.
 */
import { describe, it, expect, vi } from 'vitest';

let UTENTE = { id: 'negozio-1', email: 'n@p.it' };

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, handler: (ctx: { user: typeof UTENTE }) => unknown) =>
    () => handler({ user: UTENTE }),
}));

// Il DB finto: due conversazioni, una del negozio-1 con la cliente Giulia, una di un altro negozio con Marco.
const CONVERSAZIONI = [
  { id: 'c1', seller_id: 'negozio-1', buyer_id: 'giulia' },
  { id: 'c2', seller_id: 'negozio-2', buyer_id: 'marco' },
];
const PROFILI = [
  { id: 'giulia', full_name: 'Giulia Rossi' },
  { id: 'marco', full_name: 'Marco Bianchi' },
];

function tabella(nome: string) {
  let righe: Array<Record<string, unknown>> = nome === 'conversations' ? [...CONVERSAZIONI] : [...PROFILI];
  const catena: Record<string, unknown> = {
    select: () => catena,
    eq: (col: string, v: unknown) => { righe = righe.filter((r) => r[col] === v); return catena; },
    in: (col: string, vs: unknown[]) => { righe = righe.filter((r) => vs.includes(r[col])); return catena; },
    limit: () => catena,
    then: (ok: (v: unknown) => void) => ok({ data: righe, error: null }),
  };
  return catena;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ from: (n: string) => tabella(n) }),
}));

describe('la rotta dei nomi dei clienti', () => {
  it('il negozio riceve il nome della sua cliente, non quello dei clienti degli altri', async () => {
    UTENTE = { id: 'negozio-1', email: 'n@p.it' };
    const { GET } = await import('@/app/api/chat/nomi-clienti/route');
    const r = await (GET as unknown as () => Promise<Response>)();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ nomi: { giulia: 'Giulia Rossi' } });
  });

  it('chi non è il negozio di nessuna conversazione non riceve nessun nome', async () => {
    UTENTE = { id: 'giulia', email: 'g@p.it' };
    const { GET } = await import('@/app/api/chat/nomi-clienti/route');
    const r = await (GET as unknown as () => Promise<Response>)();
    expect(await r.json()).toEqual({ nomi: {} });
  });
});

