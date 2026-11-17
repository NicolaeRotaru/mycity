import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R01-007 — UNA VOCE DELLA CHAT SUL CAMPANELLO RESTAVA ACCESA ANCHE SE LA CHAT ERA STATA LETTA.
 *
 * Il negozio ha la chat aperta. Il cliente scrive: il trigger alza il contatore a 1, la rotta dei
 * messaggi lo rilegge (1, quindi «da avvisare») e prepara la voce. In quell'attimo la chat aperta
 * chiama /api/chat/mark-read: contatore a 0 e voci di questa chat spente — ma la voce nuova non
 * c'è ancora. Poi la rotta la scrive, e resta accesa per una chat già letta.
 *
 * Qui girano le due rotte vere sullo stesso database finto, e la lettura cade proprio fra il
 * controllo del contatore e la scrittura della voce.
 */

const BUYER = '11111111-1111-4111-8111-111111111111';
const SELLER = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';

type Riga = Record<string, unknown>;
const db: { utente: { id: string }; conv: Riga; notifiche: Riga[]; ruoli: Riga[]; leggePrimaDellaVoce: string | null } = {
  utente: { id: BUYER },
  conv: {},
  notifiche: [],
  ruoli: [],
  leggePrimaDellaVoce: null,
};

vi.mock('@/lib/email/avviso-messaggio-negozio', () => ({ avvisaNegozioMessaggioNuovo: async () => undefined }));
vi.mock('@/lib/api/dopo-la-risposta', () => ({ dopoLaRisposta: () => undefined }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: true, remaining: 29, retryAfterSec: 0, limit: 30 }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: () => undefined, warn: () => undefined, info: () => undefined } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuth: (h: (ctx: { user: { id: string }; req: Request }) => unknown) => (req: Request) => h({ user: db.utente, req }),
  withAuthRateLimit: (_o: unknown, h: (ctx: { user: { id: string }; req: Request }) => unknown) => (req: Request) =>
    h({ user: db.utente, req }),
}));

/** Una catena PostgREST minima: i filtri `eq` si applicano davvero alle righe. */
function catena(righe: () => Riga[], scrivi?: (r: Riga) => void) {
  const filtri: Array<[string, unknown]> = [];
  const scelte = () => righe().filter((r) => filtri.every(([c, v]) => (r[c] ?? false) === v));
  const c: Record<string, unknown> = {};
  c.eq = (col: string, v: unknown) => { filtri.push([col, v]); return c; };
  c.in = async () => ({ data: righe(), error: null });
  c.limit = async (n: number) => ({ data: scelte().slice(0, n), error: null });
  c.maybeSingle = async () => ({ data: scelte()[0] ? { ...scelte()[0] } : null, error: null });
  c.then = (ok: (x: unknown) => unknown) => {
    if (scrivi) scelte().forEach(scrivi);
    return Promise.resolve({ data: null, error: null }).then(ok);
  };
  return c;
}

const chiama = (rotta: unknown, url: string, corpo: Riga) =>
  (rotta as (r: Request) => Promise<Response>)(
    new Request(`http://x${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }),
  );

function client() {
  return {
    rpc: async () => ({ data: 0, error: null }),
    from: (tavola: string) => {
      if (tavola === 'messages') {
        return {
          insert: (m: Riga) => ({
            select: () => ({
              single: async () => {
                // Il trigger della 026: alza il contatore di chi riceve.
                if (m.sender_id === db.conv.buyer_id) db.conv.seller_unread_count = Number(db.conv.seller_unread_count) + 1;
                else db.conv.buyer_unread_count = Number(db.conv.buyer_unread_count) + 1;
                return { data: { id: `m-${Math.random()}`, created_at: '2026-11-17T09:00:00Z' }, error: null };
              },
            }),
          }),
        };
      }
      if (tavola === 'conversations') {
        return {
          select: () => catena(() => [db.conv]),
          update: (v: Riga) => catena(() => [db.conv], (r) => Object.assign(r, v)),
        };
      }
      if (tavola === 'profiles') return { select: () => catena(() => db.ruoli) };
      if (tavola === 'notifications') {
        return {
          select: () => catena(() => db.notifiche),
          insert: async (r: Riga) => {
            // La corsa: chi riceve ha la chat aperta e la legge adesso, dopo che la rotta dei
            // messaggi ha visto il contatore a 1 e prima che la voce sia scritta.
            const chiLegge = db.leggePrimaDellaVoce;
            if (chiLegge) {
              db.leggePrimaDellaVoce = null;
              const prima = db.utente;
              db.utente = { id: chiLegge };
              const r2 = await chiama(segnaLetta, '/api/chat/mark-read', { conversationId: CONV });
              expect(r2.status).toBe(200);
              db.utente = prima;
            }
            db.notifiche.push({ is_read: false, ...r });
            return { error: null };
          },
          update: (v: Riga) => catena(() => db.notifiche, (r) => Object.assign(r, v)),
        };
      }
      throw new Error(`tavola inattesa ${tavola}`);
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => client(),
  getAdminSupabase: () => client(),
}));

import { POST as inviaMessaggio } from '@/app/api/chat/messages/route';
import { POST as segnaLetta } from '@/app/api/chat/mark-read/route';

const vociAccese = (utente: string) =>
  db.notifiche.filter((n) => n.user_id === utente && n.link === `/messages/${CONV}` && n.is_read === false).length;

beforeEach(() => {
  db.leggePrimaDellaVoce = null;
  db.conv = { id: CONV, buyer_id: BUYER, seller_id: SELLER, buyer_unread_count: 0, seller_unread_count: 0 };
  db.ruoli = [{ id: BUYER, role: 'buyer' }, { id: SELLER, role: 'seller' }];
  db.notifiche = [];
});

describe('R01-007 · la chat letta mentre era aperta non lascia accesa la voce del campanello', () => {
  it('il negozio legge fra il controllo del contatore e la voce: nessuna voce resta accesa', async () => {
    db.utente = { id: BUYER };
    db.leggePrimaDellaVoce = SELLER;
    const r = await chiama(inviaMessaggio, '/api/chat/messages', { conversationId: CONV, body: 'Avete il pane?' });
    expect(r.status).toBe(200);
    expect(db.leggePrimaDellaVoce, 'la lettura nel mezzo non è avvenuta').toBeNull();
    expect(db.conv.seller_unread_count).toBe(0);
    expect(vociAccese(SELLER), 'la chat è già letta, ma la voce in campanella è rimasta accesa').toBe(0);
  });

  it('lo stesso quando scrive il negozio e il cliente ha la chat aperta', async () => {
    db.utente = { id: SELLER };
    db.leggePrimaDellaVoce = BUYER;
    const r = await chiama(inviaMessaggio, '/api/chat/messages', { conversationId: CONV, body: 'Sì, fino alle 19' });
    expect(r.status).toBe(200);
    expect(db.conv.buyer_unread_count).toBe(0);
    expect(vociAccese(BUYER)).toBe(0);
  });

  it('se nessuno legge la voce resta accesa: l avviso non si perde', async () => {
    db.utente = { id: BUYER };
    const r = await chiama(inviaMessaggio, '/api/chat/messages', { conversationId: CONV, body: 'Avete il pane?' });
    expect(r.status).toBe(200);
    expect(db.conv.seller_unread_count).toBe(1);
    expect(vociAccese(SELLER)).toBe(1);
  });
});
