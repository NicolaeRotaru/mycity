import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 20/11/2026 (R04-012) — DUE INVII UGUALI ALL'ASSISTENZA NELLO STESSO ISTANTE CREAVANO DUE MESSAGGI
 * E DUE AVVISI.
 *
 * La rotta POST /api/support/conversation non portava nessuna chiave anti-doppione: doppio clic o
 * rete che ritenta, e l'Assistenza riceveva due messaggi uguali e due campanelle «Nuova richiesta di
 * assistenza». Adesso il corpo porta `idempotency_key`: lo stesso invio con la stessa chiave fa un
 * messaggio solo e un avviso solo, e chi arriva secondo riceve una risposta di successo («già
 * ricevuto»). Senza chiave tutto come prima.
 *
 * Il database finto tiene la chiave primaria vera su `messages` (23505 sul secondo id uguale), come
 * Postgres: è lì che due richieste nello stesso istante si fermano.
 */

type Riga = Record<string, unknown>;
const stato = vi.hoisted(() => ({
  messaggi: [] as Array<Record<string, unknown>>,
  avvisi: [] as Array<Record<string, unknown>>,
  conversazioni: [] as Array<Record<string, unknown>>,
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
});

describe('R04-012 · lo stesso invio all’assistenza fa un messaggio e un avviso', () => {
  it('lo stesso invio due volte di fila, con la stessa chiave: un messaggio, un avviso, due risposte di successo', async () => {
    const primo = await invia({ firstMessage: TESTO, idempotency_key: CHIAVE });
    const secondo = await invia({ firstMessage: TESTO, idempotency_key: CHIAVE });
    expect(primo.res.status).toBe(200);
    expect(secondo.res.status, `il ritentativo dello stesso invio deve dire «già ricevuto», non un errore: ${JSON.stringify(secondo.corpo)}`).toBe(200);
    expect(stato.messaggi, 'il ritentativo dello stesso invio crea un secondo messaggio').toHaveLength(1);
    expect(stato.avvisi, 'il ritentativo dello stesso invio fa suonare due volte l’Assistenza').toHaveLength(1);
    expect(secondo.corpo.conversationId).toBe(primo.corpo.conversationId);
    expect(secondo.corpo.supportId).toBe('admin-assistenza');
  });

  it('due invii uguali nello stesso istante (doppio clic): un messaggio, un avviso', async () => {
    const [a, b] = await Promise.all([
      invia({ firstMessage: TESTO, idempotency_key: CHIAVE }),
      invia({ firstMessage: TESTO, idempotency_key: CHIAVE }),
    ]);
    expect([a.res.status, b.res.status]).toEqual([200, 200]);
    expect(stato.messaggi, 'due invii nello stesso istante creano due messaggi').toHaveLength(1);
    expect(stato.avvisi, 'due invii nello stesso istante fanno due avvisi').toHaveLength(1);
  });

  it('due messaggi diversi (chiavi diverse) restano due', async () => {
    await invia({ firstMessage: TESTO, idempotency_key: CHIAVE });
    await invia({ firstMessage: 'E vorrei cambiare indirizzo', idempotency_key: 'a1b2c3d4-0000-4000-8000-000000000002' });
    expect(stato.messaggi).toHaveLength(2);
    expect(stato.avvisi).toHaveLength(2);
  });

  it('il messaggio con la chiave porta un identificativo che nasce da persona + chiave (UUID)', async () => {
    await invia({ firstMessage: TESTO, idempotency_key: CHIAVE });
    const id = stato.messaggi[0]?.id as string;
    expect(id, 'il messaggio con la chiave deve avere un identificativo che nasce dalla chiave').toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('senza chiave si invia come prima (compatibilità)', async () => {
    const r = await invia({ firstMessage: TESTO });
    expect(r.res.status).toBe(200);
    expect(stato.messaggi).toHaveLength(1);
    expect(stato.avvisi).toHaveLength(1);
  });

  it('una chiave dalla forma sbagliata è rifiutata con un 400', async () => {
    const r = await invia({ firstMessage: TESTO, idempotency_key: 'x' });
    expect(r.res.status).toBe(400);
    expect(stato.messaggi).toHaveLength(0);
  });
});
