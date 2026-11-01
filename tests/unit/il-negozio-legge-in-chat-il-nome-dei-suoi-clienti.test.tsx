/**
 * @vitest-environment jsdom
 */

/**
 * 1/11/2026 — IN CHAT IL NEGOZIANTE LEGGEVA «CLIENTE» AL POSTO DEL NOME.
 *
 * Il nome del cliente sta in `profiles`, che al negozio non si apre, e la
 * funzione della migrazione 181 non è in produzione. Ora lo dà la rotta server
 * /api/chat/nomi-clienti, che risponde SOLO per le conversazioni in cui chi
 * chiede è il negozio (la prova della rotta sta in
 * la-rotta-dei-nomi-dei-clienti-risponde-solo-al-negozio.test.ts). Qui la pagina /messages vera: per il negozio la riga dice il nome del cliente
 *     e il sottotitolo «Conversazioni con i clienti».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;

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
  // Il canale Realtime finto dell aiuto di montaggio non concatena due .on(): la pagina lo
  // segnala con un avviso innocuo, che qui si zittisce per non sporcare il verdetto.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
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
  vi.restoreAllMocks();
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
