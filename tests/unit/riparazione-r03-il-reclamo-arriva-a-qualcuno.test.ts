import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

/**
 * R03-013 — Il reclamo del cliente arriva a qualcuno.
 *
 * La pagina scriveva la riga in `disputes` dal browser e prometteva «entro 48h»: nessun avviso
 * agli amministratori, nessuno al negozio (a cui intanto il bonifico si fermava), nessuna
 * ricevuta. Ora il reclamo lo apre POST /api/disputes: controlla che l'ordine sia del cliente,
 * lo intesta al negozio dell'ordine, avvisa amministratori e negozio e manda la ricevuta.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, utente: 'maria', email: [] as string[] }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getServerSupabase: async () => finto.db.client,
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async (m: { to: string }) => { finto.email.push(m.to); return { ok: true }; }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => {
  type Gestore = (ctx: { user: { id: string }; req: Request }) => unknown;
  return { withAuthRateLimit: (_o: unknown, h: Gestore) => async (req: Request) => h({ user: { id: finto.utente }, req }) };
});

import { POST } from '@/app/api/disputes/route';

const ORDINE = 'e5f6a7b8-9999-4999-8999-999999999999';
const json = (corpo: unknown) => new Request('http://localhost/api/disputes', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
});
const apri = (corpo: unknown) => (POST as unknown as (r: Request) => Promise<Response>)(json(corpo));
const RECLAMO = { orderId: ORDINE, reason: 'not_received', description: 'Il fattorino non è mai passato e non ho ricevuto niente' };

beforeEach(() => {
  finto.utente = 'maria';
  finto.email = [];
  finto.db = creaFintoDatabase({
    orders: [{ id: ORDINE, user_id: 'maria', seller_id: 'pane' }],
    disputes: [],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'pane', role: 'seller' }, { id: 'maria', role: 'buyer' }],
    notifications: [],
  });
  finto.db.email.maria = 'maria@example.it';
});

describe('R03-013 — il reclamo arriva a qualcuno', () => {
  it('il cliente apre il reclamo: riga contro il negozio dell ordine, avviso agli amministratori, al negozio e ricevuta', async () => {
    const r = await apri({ ...RECLAMO, against_id: 'qualcun-altro' });
    expect(r.status).toBe(201);
    const [riga] = finto.db.tabelle.disputes;
    expect(riga).toMatchObject({ order_id: ORDINE, opener_id: 'maria', against_id: 'pane', status: 'open' });
    const notifiche = finto.db.tabelle.notifications ?? [];
    expect(notifiche.some((n) => n.user_id === 'admin-1'), 'gli amministratori non sanno del reclamo').toBe(true);
    expect(notifiche.some((n) => n.user_id === 'pane'), 'il negozio non sa del reclamo').toBe(true);
    expect(finto.email, 'il cliente non riceve nessuna ricevuta').toContain('maria@example.it');
  });

  it('un ordine che non è suo: 403 e nessun reclamo', async () => {
    finto.utente = 'intruso';
    const r = await apri(RECLAMO);
    expect(r.status).toBe(403);
    expect(finto.db.tabelle.disputes).toHaveLength(0);
  });

  it('descrizione troppo corta: 400', async () => {
    const r = await apri({ ...RECLAMO, description: 'corta' });
    expect(r.status).toBe(400);
  });
});
