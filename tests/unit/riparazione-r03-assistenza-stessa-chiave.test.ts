import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 21/11/2026 (R03-013) — ALL'ASSISTENZA LA STESSA CHIAVE CON UN TESTO DIVERSO FACEVA PERDERE IL
 * SECONDO TESTO IN SILENZIO.
 *
 * La chiave dell'invio (`idempotency_key`) fa nascere l'id del messaggio da persona + chiave: il
 * secondo invio con la stessa chiave urta la chiave primaria (23505) e la rotta rispondeva «già
 * ricevuto», 200, anche se il testo era un altro. Il cliente vedeva la chat aprirsi e il suo secondo
 * messaggio non arrivava a nessuno. Adesso il testo salvato si rilegge: uguale → «già ricevuto» come
 * prima; diverso → 409 detto chiaro; rilettura caduta → 503, niente «ricevuto» alla cieca.
 *
 * Il database finto tiene la chiave primaria vera su `messages` (23505 sul secondo id uguale).
 */

type Riga = Record<string, unknown>;
const stato = vi.hoisted(() => ({
  messaggi: [] as Array<Record<string, unknown>>,
  avvisi: [] as Array<Record<string, unknown>>,
  conversazioni: [] as Array<Record<string, unknown>>,
  rilettureCadono: false,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: async () => ({ allowed: true }) }));
vi.mock('@/lib/api/middleware', () => ({
  withAuth: (h: (c: unknown) => unknown) => async (req: Request) => h({ req, user: { id: 'cliente-1' } }),
}));
vi.mock('@/lib/supabase/server', () => {
  let contatore = 0;
  const tavola = (t: string) => {
    const filtri: Array<(r: Riga) => boolean> = [];
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit']) b[m] = () => b;
    b.eq = (c: string, v: unknown) => (filtri.push((r) => r[c] === v), b);
    b.maybeSingle = async () => {
      if (t === 'profiles') return { data: { id: 'admin-assistenza' }, error: null };
      if (t === 'conversations') return { data: stato.conversazioni.find((r) => filtri.every((f) => f(r))) ?? null, error: null };
      // Come la tabella vera: il messaggio salvato si rilegge per id.
      if (t === 'messages' && stato.rilettureCadono) return { data: null, error: { message: 'connessione persa' } };
      if (t === 'messages') return { data: stato.messaggi.find((r) => filtri.every((f) => f(r))) ?? null, error: null };
      return { data: null, error: null };
    };
    b.insert = (v: Riga) => {
      let esito: { data: unknown; error: unknown } = { data: null, error: null };
      if (t === 'conversations') {
        const riga = { id: 'conv-1', ...v };
        stato.conversazioni.push(riga);
        esito = { data: { id: riga.id }, error: null };
      } else if (t === 'messages') {
        const id = (v.id as string | undefined) ?? `msg-${++contatore}`;
        if (stato.messaggi.some((m) => m.id === id)) {
          esito = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "messages_pkey"' } };
        } else {
          stato.messaggi.push({ ...v, id });
        }
      } else if (t === 'notifications') {
        stato.avvisi.push(v);
      }
      return Object.assign(Promise.resolve(esito), { select: () => ({ single: async () => esito }) });
    };
    return b;
  };
  return { getAdminSupabase: () => ({ from: tavola }) };
});

async function invia(corpo: Record<string, unknown>) {
  const { POST } = await import('@/app/api/support/conversation/route');
  const res = await (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/support/conversation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }),
  );
  return { res, corpo: (await res.json()) as Riga };
}

const CHIAVE = '3f1c2b9e-8d47-4c1a-9b2e-5f6a7c8d9e0f';
const TESTO = 'Il mio ordine non è arrivato';

beforeEach(() => {
  stato.messaggi.length = 0;
  stato.avvisi.length = 0;
  stato.conversazioni.length = 0;
  stato.rilettureCadono = false;
});

describe('R03-013 · la stessa chiave con un testo diverso non si perde in silenzio', () => {
  it('stessa chiave, testo diverso: 409 esplicito, il secondo testo non risulta ricevuto', async () => {
    const primo = await invia({ firstMessage: TESTO, idempotency_key: CHIAVE });
    expect(primo.res.status).toBe(200);
    const secondo = await invia({ firstMessage: 'E vorrei anche cambiare indirizzo', idempotency_key: CHIAVE });
    expect(secondo.res.status, `il secondo testo si perde e la rotta dice «ricevuto»: ${JSON.stringify(secondo.corpo)}`).toBe(409);
    expect(secondo.corpo.giaRicevuto, 'il secondo testo non è stato ricevuto: non si può dire «già ricevuto»').toBeUndefined();
    expect(JSON.stringify(secondo.corpo)).toMatch(/non è stato inviato/);
    expect(stato.messaggi.map((m) => m.body)).toEqual([TESTO]);
    expect(stato.avvisi).toHaveLength(1);
  });

  it('stessa chiave, stesso testo: «già ricevuto» come prima', async () => {
    await invia({ firstMessage: TESTO, idempotency_key: CHIAVE });
    const bis = await invia({ firstMessage: TESTO, idempotency_key: CHIAVE });
    expect(bis.res.status).toBe(200);
    expect(bis.corpo.giaRicevuto).toBe(true);
    expect(stato.messaggi).toHaveLength(1);
  });

  it('se il messaggio salvato non si rilegge, non si risponde «ricevuto» alla cieca', async () => {
    await invia({ firstMessage: TESTO, idempotency_key: CHIAVE });
    stato.rilettureCadono = true;
    const bis = await invia({ firstMessage: 'Un altro testo', idempotency_key: CHIAVE });
    expect(bis.res.status, JSON.stringify(bis.corpo)).toBe(503);
    expect(bis.corpo.giaRicevuto).toBeUndefined();
  });
});
