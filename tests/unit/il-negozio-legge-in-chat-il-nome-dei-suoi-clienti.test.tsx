/**
 * @vitest-environment jsdom
 */

/**
 * 1/11/2026 — IN CHAT IL NEGOZIANTE LEGGEVA «CLIENTE» AL POSTO DEL NOME.
 *
 * Il nome del cliente sta in `profiles`, che al negozio non si apre, e la
 * funzione della migrazione 181 non è in produzione. Ora lo dà la rotta server
 * /api/chat/nomi-clienti, che risponde SOLO per le conversazioni in cui chi
 * chiede è il negozio. Due prove:
 *  1. la rotta: il negozio riceve il nome; chi non è il negozio di nessuna
 *     conversazione non riceve nessun nome;
 *  2. la pagina /messages vera: per il negozio la riga dice il nome del cliente
 *     e il sottotitolo «Conversazioni con i clienti».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

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

const globali = globalThis as Record<string, unknown>;

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

const RIGA_DEL_NEGOZIO = {
  id: 'c1',
  buyer_id: 'giulia',
  seller_id: 'u1',
  last_message_at: new Date().toISOString(),
  last_message_preview: 'Avete il pane senza glutine?',
  buyer_unread_count: 0,
  seller_unread_count: 1,
  buyer: null,
  seller: null,
  insegna: 'Pane Quotidiano',
  insegnaNonLetta: false,
  cliente: null,
};

type Opzioni = { queryKey: unknown[]; enabled?: boolean; queryFn?: (c: { signal?: AbortSignal }) => unknown };

beforeEach(() => {
  globali.__UTENTE__ = { id: 'u1', email: 'n@p.it' };
  globali.__ESITO_QUERY__ = undefined;
  globali.__OPZIONI_QUERY__ = [];
});

afterEach(() => {
  document.body.innerHTML = '';
  globali.__UTENTE__ = undefined;
  globali.__DATI_QUERY__ = undefined;
  globali.__ESITO_QUERY__ = undefined;
  globali.__OPZIONI_QUERY__ = undefined;
  vi.unstubAllGlobals();
});

describe('la pagina /messages, per il negozio', () => {
  it('IL CASO CHE ROMPEVA — la riga dice il nome della cliente, non «Cliente», e il sottotitolo parla di clienti', async () => {
    globali.__DATI_QUERY__ = function datiFinti(o: { queryKey: unknown[] }) {
      return o.queryKey[0] === 'chat-nomi-clienti' ? { giulia: 'Giulia Rossi' }
        : o.queryKey[0] === 'support-account' ? null
          : [RIGA_DEL_NEGOZIO];
    };
    const mod = await monta('app/messages/page.tsx');
    const s = accendi(mod.default);
    await attendi();
    await attendi();
    const titoli = Array.from(s.radice.querySelectorAll('h3')).map((h) => (h.textContent ?? '').trim());
    expect(titoli).toEqual(['Giulia Rossi']);
    expect(s.radice.textContent).toContain('Conversazioni con i clienti');
    expect(s.radice.textContent).not.toContain('Conversazioni con i negozi');

    // La domanda va alla rotta server giusta e ne legge la mappa.
    const opz = (globali.__OPZIONI_QUERY__ as Opzioni[]).filter((o) => o.queryKey[0] === 'chat-nomi-clienti').at(-1);
    expect(opz, 'la pagina non chiede i nomi dei clienti').toBeTruthy();
    const fetchFinto = vi.fn(async () => new Response(JSON.stringify({ nomi: { giulia: 'Giulia Rossi' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchFinto);
    await expect(opz!.queryFn!({})).resolves.toEqual({ giulia: 'Giulia Rossi' });
    expect(String((fetchFinto.mock.calls[0] as unknown[])[0])).toBe('/api/chat/nomi-clienti');
    s.smonta();
  }, 60000);
});
