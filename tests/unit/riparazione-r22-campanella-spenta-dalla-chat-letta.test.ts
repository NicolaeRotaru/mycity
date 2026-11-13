import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R22-009 (13/11/2026) — LA CAMPANELLA DEL NEGOZIO ACCUMULAVA UNA VOCE A OGNI GIRO DI MESSAGGI.
 *
 * Il «letto» ha due segni: il contatore della chat e la voce in campanella. Aprire la chat
 * (POST /api/chat/mark-read) azzerava solo il contatore; a ogni giro il contatore ripartiva da 1
 * e la rotta dei messaggi scriveva una voce nuova. Cinque scambi letti subito = cinque voci accese
 * per una chat già letta.
 *
 * Qui girano le due rotte vere, una dopo l'altra, sullo stesso database finto: il cliente scrive
 * (il «trigger» alza il contatore del negozio), il negozio apre la chat. Cinque volte.
 */

const BUYER = '11111111-1111-4111-8111-111111111111';
const SELLER = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';
const ALTRA = '44444444-4444-4444-8444-444444444444';

type Riga = Record<string, unknown>;
const db: { utente: { id: string }; conv: Riga; notifiche: Riga[]; ruoli: Riga[]; letturaNelMezzo: boolean } = {
  letturaNelMezzo: false,
  utente: { id: BUYER },
  conv: {},
  notifiche: [],
  ruoli: [],
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
  c.maybeSingle = async () => ({ data: scelte()[0] ?? null, error: null });
  c.then = (ok: (x: unknown) => unknown) => {
    if (scrivi) scelte().forEach(scrivi);
    return Promise.resolve({ data: null, error: null }).then(ok);
  };
  return c;
}

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
                // Corsa: chi riceve ha la chat aperta e legge prima che la campanella sia scritta.
                if (db.letturaNelMezzo) { db.conv.seller_unread_count = 0; db.conv.buyer_unread_count = 0; }
                return { data: { id: `m-${Math.random()}`, created_at: '2026-11-13T09:00:00Z' }, error: null };
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
          insert: async (r: Riga) => { db.notifiche.push({ is_read: false, ...r }); return { error: null }; },
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

const chiama = (rotta: unknown, url: string, corpo: Riga) =>
  (rotta as (r: Request) => Promise<Response>)(
    new Request(`http://x${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }),
  );

const vociAccese = (utente: string, link: string) =>
  db.notifiche.filter((n) => n.user_id === utente && n.link === link && n.is_read === false).length;

beforeEach(() => {
  db.letturaNelMezzo = false;
  db.conv = { id: CONV, buyer_id: BUYER, seller_id: SELLER, buyer_unread_count: 0, seller_unread_count: 0 };
  db.ruoli = [{ id: BUYER, role: 'buyer' }, { id: SELLER, role: 'seller' }];
  db.notifiche = [
    // Voci che la lettura di QUESTA chat non deve spegnere.
    { user_id: SELLER, link: `/messages/${ALTRA}`, is_read: false, title: 'Un\'altra chat' },
    { user_id: BUYER, link: `/messages/${CONV}`, is_read: false, title: 'Il negozio ti ha risposto' },
  ];
});

describe('R22-009 · aprire la chat spegne anche la sua voce in campanella', () => {
  it('cinque giri di messaggi letti subito: nessuna voce resta accesa per la chat già letta', async () => {
    for (let giro = 1; giro <= 5; giro++) {
      db.utente = { id: BUYER };
      const r1 = await chiama(inviaMessaggio, '/api/chat/messages', { conversationId: CONV, body: `Giro ${giro}: avete il pane?` });
      expect(r1.status).toBe(200);
      // La campanella avvisa il negozio del giro nuovo: una voce, non zero.
      expect(vociAccese(SELLER, `/messages/${CONV}`), `giro ${giro}: il negozio non è stato avvisato`).toBe(1);

      db.utente = { id: SELLER };
      const r2 = await chiama(segnaLetta, '/api/chat/mark-read', { conversationId: CONV });
      expect(r2.status).toBe(200);
      expect(db.conv.seller_unread_count).toBe(0);
    }
    expect(
      vociAccese(SELLER, `/messages/${CONV}`),
      'la chat è letta, ma in campanella restano accese le voci dei giri passati',
    ).toBe(0);
  });

  it('spegne solo le voci di chi legge e solo per questa conversazione', async () => {
    db.utente = { id: SELLER };
    db.notifiche.push({ user_id: SELLER, link: `/messages/${CONV}`, is_read: false, title: 'Nuovo messaggio da un cliente' });
    const r = await chiama(segnaLetta, '/api/chat/mark-read', { conversationId: CONV });
    expect(r.status).toBe(200);
    expect(vociAccese(SELLER, `/messages/${CONV}`)).toBe(0);
    expect(vociAccese(SELLER, `/messages/${ALTRA}`)).toBe(1);
    expect(vociAccese(BUYER, `/messages/${CONV}`)).toBe(1);
  });

  it('corsa: se chi riceve ha già letto (contatore a 0) la voce non si crea', async () => {
    db.letturaNelMezzo = true;
    db.utente = { id: BUYER };
    const r = await chiama(inviaMessaggio, '/api/chat/messages', { conversationId: CONV, body: 'Avete il pane?' });
    expect(r.status).toBe(200);
    expect(vociAccese(SELLER, `/messages/${CONV}`), 'voce accesa per una chat già letta').toBe(0);
  });
});
