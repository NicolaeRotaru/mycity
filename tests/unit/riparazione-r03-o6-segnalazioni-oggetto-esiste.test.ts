import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R03-003 — Una segnalazione di tipo recensione o messaggio si registra solo se l'oggetto esiste.
 * Prima il controllo c'era solo per prodotto e negozio: un id inventato creava la riga e
 * un avviso per ogni amministratore.
 */

const tabelle = vi.hoisted(() => ({ righe: {} as Record<string, string[]> }));
const scritto = vi.hoisted(() => ({ segnalazioni: 0, avvisi: 0 }));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: () => '1.2.3.4', rateLimitAsync: async () => ({ allowed: true, retryAfterSec: 0 }) }));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'segnalazioni') {
        return { insert: () => ({ select: () => ({ single: async () => { scritto.segnalazioni++; return { data: { id: 'seg-1' }, error: null }; } }) }) };
      }
      if (tabella === 'profiles') return { select: () => ({ eq: async () => ({ data: [{ id: 'admin-1' }], error: null }) }) };
      if (tabella === 'notifications') return { insert: async (r: unknown[]) => { scritto.avvisi += r.length; return { error: null }; } };
      return {
        select: () => ({
          eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: (tabelle.righe[tabella] ?? []).includes(id) ? { id } : null, error: null }) }),
        }),
      };
    },
  }),
}));

import { POST } from '@/app/api/segnalazioni/route';

const ID = '11111111-1111-4111-8111-111111111111';
const chiama = (tipo: string, oggettoId = ID) =>
  POST(new Request('https://mycity.test/api/segnalazioni', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tipo, oggettoId, motivo: 'altro' }),
  }) as never);

beforeEach(() => {
  tabelle.righe = {};
  scritto.segnalazioni = 0;
  scritto.avvisi = 0;
});

describe('R03-003 — si segnala solo qualcosa che esiste', () => {
  it.each(['recensione', 'messaggio'])('%s con id inesistente: 404, nessuna riga, nessun avviso agli admin', async (tipo) => {
    const r = await chiama(tipo);
    expect(r.status).toBe(404);
    expect(scritto.segnalazioni).toBe(0);
    expect(scritto.avvisi).toBe(0);
  });

  it('recensione di un prodotto che esiste: registrata e gli admin avvisati', async () => {
    tabelle.righe.reviews = [ID];
    const r = await chiama('recensione');
    expect(r.status).toBeLessThan(300);
    expect(scritto.segnalazioni).toBe(1);
    expect(scritto.avvisi).toBe(1);
  });

  it('recensione di un negozio che esiste (altra tabella): registrata', async () => {
    tabelle.righe.store_reviews = [ID];
    const r = await chiama('recensione');
    expect(r.status).toBeLessThan(300);
    expect(scritto.segnalazioni).toBe(1);
  });

  it('messaggio che esiste: registrato', async () => {
    tabelle.righe.messages = [ID];
    const r = await chiama('messaggio');
    expect(r.status).toBeLessThan(300);
    expect(scritto.segnalazioni).toBe(1);
    expect(scritto.avvisi).toBe(1);
  });
});
