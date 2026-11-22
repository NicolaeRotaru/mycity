import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R04-004 — La chat viene letta mentre la voce della campanella si sta scrivendo.
 * La rotta dei messaggi legge il contatore dei non letti una volta sola; se chi riceve apre la
 * chat subito dopo quella lettura (mark-read spegne le voci che ci sono, il contatore va a 0),
 * la voce scritta un attimo dopo restava accesa per una chat già letta.
 *
 * Rotta vera, supabase finto. La lettura cade nel punto preciso: dopo la lettura del contatore
 * e prima della scrittura della voce (all'arrivo della lettura dei ruoli).
 */

const BUYER = '11111111-1111-4111-8111-111111111111';
const SELLER = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';

type Riga = Record<string, unknown>;
const db: {
  utente: { id: string }; conv: Riga; notifiche: Riga[]; ruoli: Riga[];
  quando: 'mai' | 'prima-della-voce' | 'dopo-la-voce';
  rilettura: 'ok' | 'cade' | 'due-in-fila';
  voceAltrui: boolean;
} = {
  utente: { id: BUYER },
  conv: {},
  notifiche: [],
  ruoli: [],
  quando: 'mai',
  rilettura: 'ok',
  voceAltrui: false,
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

/** Quello che fa /api/chat/mark-read per il negozio: contatore a 0 e voci già accese spente. */
function ilNegozioApreLaChat() {
  db.conv.seller_unread_count = 0;
  db.notifiche.filter((n) => n.user_id === SELLER && n.link === `/messages/${CONV}`).forEach((n) => { n.is_read = true; });
}

function catena(righe: () => Riga[], scrivi?: (r: Riga) => void, prima?: () => void) {
  const filtri: Array<[string, unknown]> = [];
  const scelte = () => righe().filter((r) => filtri.every(([c, v]) => (r[c] ?? false) === v));
  const c: Record<string, unknown> = {};
  c.eq = (col: string, v: unknown) => { filtri.push([col, v]); return c; };
  c.in = async () => { prima?.(); return { data: righe(), error: null }; };
  c.limit = async (n: number) => ({ data: scelte().slice(0, n), error: null });
  c.maybeSingle = async () => ({ data: scelte()[0] ? { ...scelte()[0] } : null, error: null });
  c.then = (ok: (x: unknown) => unknown) => {
    if (scrivi) scelte().forEach(scrivi);
    return Promise.resolve({ data: null, error: null }).then(ok);
  };
  return c;
}

function client() {
  return {
    from: (tavola: string) => {
      if (tavola === 'messages') {
        return {
          insert: () => ({
            select: () => ({
              single: async () => {
                db.conv.seller_unread_count = Number(db.conv.seller_unread_count) + 1; // il trigger
                return { data: { id: 'm-1', created_at: '2026-11-21T09:00:00Z' }, error: null };
              },
            }),
          }),
        };
      }
      if (tavola === 'conversations') {
        return { select: () => {
          const c = catena(() => [db.conv]);
          // La rilettura del contatore (dopo la voce) può cadere o trovare due messaggi in fila.
          if (db.notifiche.length > 0 && db.rilettura === 'cade') {
            c.maybeSingle = async () => ({ data: null, error: { message: 'lettura caduta' } });
          }
          if (db.notifiche.length > 0 && db.rilettura === 'due-in-fila') {
            c.maybeSingle = async () => ({ data: { ...db.conv, seller_unread_count: 2, buyer_unread_count: 2 }, error: null });
          }
          return c;
        }, update: (v: Riga) => catena(() => [db.conv], (r) => Object.assign(r, v)) };
      }
      if (tavola === 'profiles') {
        return { select: () => catena(() => db.ruoli, undefined, () => { if (db.quando === 'prima-della-voce') ilNegozioApreLaChat(); }) };
      }
      if (tavola === 'notifications') {
        return {
          select: () => catena(() => db.notifiche),
          insert: async (r: Riga) => {
            db.notifiche.push({ is_read: false, ...r });
            if (db.quando === 'dopo-la-voce') ilNegozioApreLaChat();
            if (db.voceAltrui) {
              // un messaggio nuovo, con la sua voce, arriva tra la rilettura e lo spegnimento
              db.notifiche.push({ is_read: false, id: 'altra-voce', user_id: SELLER, link: `/messages/${CONV}` });
            }
            return { error: null };
          },
          update: (v: Riga) => catena(() => db.notifiche, (r) => Object.assign(r, v)),
        };
      }
      throw new Error(`tavola inattesa ${tavola}`);
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({ getServerSupabase: async () => client(), getAdminSupabase: () => client() }));

import { POST as inviaMessaggio } from '@/app/api/chat/messages/route';

const manda = () =>
  (inviaMessaggio as unknown as (r: Request) => Promise<Response>)(
    new Request('http://x/api/chat/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: CONV, body: 'Avete il pane?' }),
    }),
  );
const vociAccese = () => db.notifiche.filter((n) => n.user_id === SELLER && n.link === `/messages/${CONV}` && n.is_read === false).length;

beforeEach(() => {
  db.quando = 'mai';
  db.rilettura = 'ok';
  db.voceAltrui = false;
  db.utente = { id: BUYER };
  db.conv = { id: CONV, buyer_id: BUYER, seller_id: SELLER, buyer_unread_count: 0, seller_unread_count: 0 };
  db.ruoli = [{ id: BUYER, role: 'buyer' }, { id: SELLER, role: 'seller' }];
  db.notifiche = [];
});

describe('R04-004 · la voce della campanella e la chat letta nel mezzo', () => {
  it('senza lettura nel mezzo: il negozio ha la sua voce accesa', async () => {
    expect((await manda()).status).toBe(200);
    expect(vociAccese()).toBe(1);
  });

  it('la chat è letta tra la lettura del contatore e la scrittura della voce: la voce non resta accesa', async () => {
    db.quando = 'prima-della-voce';
    expect((await manda()).status).toBe(200);
    expect(db.conv.seller_unread_count).toBe(0);
    expect(vociAccese(), 'voce accesa per una chat già letta').toBe(0);
  });

  it('la chat è letta subito dopo la scrittura della voce: la spegne la lettura, la voce non resta accesa', async () => {
    db.quando = 'dopo-la-voce';
    expect((await manda()).status).toBe(200);
    expect(vociAccese()).toBe(0);
  });

  it('se la rilettura del contatore cade, la voce resta accesa', async () => {
    db.rilettura = 'cade';
    expect((await manda()).status).toBe(200);
    expect(vociAccese()).toBe(1);
  });

  it('se il contatore riletto è maggiore di zero (due messaggi in fila), la voce resta accesa', async () => {
    db.rilettura = 'due-in-fila';
    expect((await manda()).status).toBe(200);
    expect(vociAccese()).toBe(1);
  });

  it('lo spegnimento tocca solo la voce di questa richiesta, non una arrivata nel frattempo', async () => {
    db.quando = 'dopo-la-voce';
    db.voceAltrui = true;
    expect((await manda()).status).toBe(200);
    expect(db.notifiche.find((n) => n.id === 'altra-voce')?.is_read).toBe(false);
    expect(db.notifiche.filter((n) => n.id !== 'altra-voce').every((n) => n.is_read === true)).toBe(true);
  });
});
